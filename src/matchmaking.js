/**
 * Matchmaking & Room System
 * Handles room creation, joining, quick match queuing, and Socket.IO game flow
 */

const ChessGame = require('./game-engine');
const stockfishAi = require('./stockfish-ai');
const leaderboard = require('./leaderboard');

// ═══════════════════════════════════════
// IN-MEMORY STATE
// ═══════════════════════════════════════

/** Active game rooms: Map<roomId, Room> */
const rooms = new Map();

/** Quick match queue: Array<{ socket, userId, elo, timeControl, timestamp }> */
let matchQueue = [];

/** Socket → Room mapping: Map<socketId, roomId> */
const socketRooms = new Map();

/** Online users: Map<socketId, { userId, username, elo }> */
const onlineUsers = new Map();

// ═══════════════════════════════════════
// ROOM CLASS
// ═══════════════════════════════════════

class Room {
    constructor(id, options = {}) {
        this.id = id;
        this.timeControl = options.timeControl || 'none';
        this.creatorColor = options.creatorColor || 'random';
        this.isPrivate = options.isPrivate !== false;
        this.isVsBot = options.isVsBot || false;
        this.botDifficulty = options.botDifficulty || 'medium';

        this.players = { w: null, b: null };
        this.sockets = { w: null, b: null };
        this.game = new ChessGame();
        this.timeLeft = { w: 0, b: 0 };
        this.timerInterval = null;
        this.createdAt = Date.now();
        this.started = false;
        this.drawOffer = null; // 'w' or 'b' — who offered

        // Parse time control
        if (this.timeControl !== 'none') {
            const parts = this.timeControl.split('+');
            const mins = parseInt(parts[0]);
            const inc = parseInt(parts[1] || 0);
            this.timeConfig = { total: mins * 60, inc };
            this.timeLeft = { w: mins * 60, b: mins * 60 };
        } else {
            this.timeConfig = null;
        }
    }

    addPlayer(socket, userId, username, elo, preferredColor) {
        let color;
        if (!this.players.w && !this.players.b) {
            // First player
            if (preferredColor === 'w') color = 'w';
            else if (preferredColor === 'b') color = 'b';
            else color = Math.random() < 0.5 ? 'w' : 'b';
        } else if (!this.players.w) {
            color = 'w';
        } else if (!this.players.b) {
            color = 'b';
        } else {
            return null; // Room full
        }

        this.players[color] = { userId, username, elo };
        this.sockets[color] = socket;
        socketRooms.set(socket.id, this.id);

        return color;
    }

    isFull() {
        return !!this.players.w && (!!this.players.b || this.isVsBot);
    }

    getPlayerColor(socketId) {
        if (this.sockets.w && this.sockets.w.id === socketId) return 'w';
        if (this.sockets.b && this.sockets.b.id === socketId) return 'b';
        return null;
    }

    getOpponentSocket(color) {
        return color === 'w' ? this.sockets.b : this.sockets.w;
    }

    startGame() {
        this.started = true;
        this.game.reset();
        if (this.timeConfig) {
            this.timeLeft = { w: this.timeConfig.total, b: this.timeConfig.total };
        }
    }

    startTimer() {
        if (!this.timeConfig) return;
        this.stopTimer();
        this.timerInterval = setInterval(() => {
            if (this.game.gameOver) { this.stopTimer(); return; }
            this.timeLeft[this.game.turn] -= 0.1;
            if (this.timeLeft[this.game.turn] <= 0) {
                this.timeLeft[this.game.turn] = 0;
                this.stopTimer();
                // Timeout — the OTHER player wins
                const winner = this.game.turn === 'w' ? 'b' : 'w';
                this.game.endGame(winner, 'timeout');
            }
        }, 100);
    }

    stopTimer() {
        if (this.timerInterval) {
            clearInterval(this.timerInterval);
            this.timerInterval = null;
        }
    }

    addIncrement(color) {
        if (this.timeConfig && this.game.moveLog.length > 1) {
            this.timeLeft[color] += this.timeConfig.inc;
        }
    }

    destroy() {
        this.stopTimer();
        if (this.sockets.w) socketRooms.delete(this.sockets.w.id);
        if (this.sockets.b) socketRooms.delete(this.sockets.b.id);
        rooms.delete(this.id);
    }
}

// ═══════════════════════════════════════
// UTILITY
// ═══════════════════════════════════════

function generateRoomCode() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = '';
    for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
    return code;
}

function getOnlineCount() {
    return onlineUsers.size;
}

// ═══════════════════════════════════════
// SOCKET EVENT HANDLERS
// ═══════════════════════════════════════

function setupSocketHandlers(io) {
    io.on('connection', (socket) => {
        const user = socket.user;
        if (!user) { socket.disconnect(); return; }

        console.log(`[WS] ${user.username} connected (socket: ${socket.id})`);
        onlineUsers.set(socket.id, { userId: user.id, username: user.username, elo: user.elo_rating });
        io.emit('online-count', getOnlineCount());

        // ─── CREATE ROOM ───────────────────
        socket.on('create-room', (data, callback) => {
            const code = generateRoomCode();
            const room = new Room(code, {
                timeControl: data.timeControl || 'none',
                creatorColor: data.color || 'random',
                isPrivate: true,
                isVsBot: data.isVsBot || false,
                botDifficulty: data.botDifficulty || 'medium'
            });

            const preferredColor = data.color === 'random' ? null : data.color;
            const color = room.addPlayer(socket, user.id, user.username, user.elo_rating, preferredColor);
            rooms.set(code, room);
            socket.join(code);

            console.log(`[Room] ${user.username} created room ${code} as ${color}`);

            if (callback) callback({ roomId: code, color });

            // If vs bot, start immediately
            if (room.isVsBot) {
                room.players[room.getPlayerColor(socket.id) === 'w' ? 'b' : 'w'] = {
                    userId: null, username: `Stockfish (${room.botDifficulty})`, elo: '???'
                };
                startOnlineGame(io, room);
            }
        });

        // ─── JOIN ROOM ─────────────────────
        socket.on('join-room', (data, callback) => {
            const code = (data.roomId || '').toUpperCase().trim();
            const room = rooms.get(code);

            if (!room) return callback?.({ error: 'Room not found' });
            if (room.isFull()) return callback?.({ error: 'Room is full' });
            if (room.started) return callback?.({ error: 'Game already in progress' });

            const color = room.addPlayer(socket, user.id, user.username, user.elo_rating);
            if (!color) return callback?.({ error: 'Could not join room' });

            socket.join(code);
            console.log(`[Room] ${user.username} joined room ${code} as ${color}`);

            if (callback) callback({ roomId: code, color });

            if (room.isFull()) {
                startOnlineGame(io, room);
            }
        });

        // ─── QUICK MATCH ───────────────────
        socket.on('quick-match', (data, callback) => {
            // Remove from any existing queue entry
            matchQueue = matchQueue.filter(q => q.socket.id !== socket.id);

            // Find a match within ±200 ELO
            const entry = { socket, userId: user.id, username: user.username, elo: user.elo_rating, timeControl: data.timeControl || 'none', timestamp: Date.now() };
            const match = matchQueue.find(q =>
                Math.abs(q.elo - entry.elo) <= 200 &&
                q.timeControl === entry.timeControl &&
                q.userId !== entry.userId
            );

            if (match) {
                // Found a match!
                matchQueue = matchQueue.filter(q => q.socket.id !== match.socket.id);
                const code = generateRoomCode();
                const room = new Room(code, { timeControl: entry.timeControl, isPrivate: false });

                room.addPlayer(match.socket, match.userId, match.username, match.elo, null);
                room.addPlayer(socket, user.id, user.username, user.elo_rating, null);
                rooms.set(code, room);
                match.socket.join(code);
                socket.join(code);

                console.log(`[Match] Paired ${match.username} vs ${user.username} in room ${code}`);

                // Notify both players
                match.socket.emit('match-found', { roomId: code });
                if (callback) callback({ matched: true, roomId: code });

                startOnlineGame(io, room);
            } else {
                // Add to queue
                matchQueue.push(entry);
                console.log(`[Queue] ${user.username} queued (ELO: ${user.elo_rating})`);
                if (callback) callback({ matched: false, queued: true });
            }
        });

        // ─── CANCEL QUEUE ──────────────────
        socket.on('cancel-queue', () => {
            matchQueue = matchQueue.filter(q => q.socket.id !== socket.id);
        });

        // ─── MOVE ──────────────────────────
        socket.on('move', (data) => {
            const roomId = socketRooms.get(socket.id);
            if (!roomId) return;
            const room = rooms.get(roomId);
            if (!room || !room.started) return;

            const color = room.getPlayerColor(socket.id);
            if (!color || room.game.turn !== color) return;

            const result = room.game.makeMove(data.from[0], data.from[1], data.to[0], data.to[1], data.promo || null);
            if (!result.valid) {
                socket.emit('move-rejected', { error: result.error });
                return;
            }

            // Add time increment
            room.addIncrement(color);
            room.drawOffer = null; // Clear any pending draw offer

            // Broadcast move to room
            io.to(roomId).emit('move-made', {
                from: [data.from[0], data.from[1]],
                to: [data.to[0], data.to[1]],
                promo: data.promo || null,
                san: result.san,
                isCapture: result.isCapture,
                isCastle: result.isCastle,
                isPromotion: result.isPromotion,
                turn: room.game.turn,
                timeLeft: { ...room.timeLeft }
            });

            // Check if game ended
            if (result.result) {
                handleGameEnd(io, room, result.result.result, result.result.reason);
            } else if (room.isVsBot && room.game.turn !== color) {
                // Bot's turn
                makeBotMove(io, room);
            } else {
                // Restart timer for next player
                room.startTimer();
            }
        });

        // ─── RESIGN ────────────────────────
        socket.on('resign', () => {
            const roomId = socketRooms.get(socket.id);
            if (!roomId) return;
            const room = rooms.get(roomId);
            if (!room || !room.started || room.game.gameOver) return;

            const color = room.getPlayerColor(socket.id);
            if (!color) return;

            const winner = color === 'w' ? 'b' : 'w';
            room.game.endGame(winner, 'resign');
            handleGameEnd(io, room, winner, 'resign');
        });

        // ─── DRAW OFFER ────────────────────
        socket.on('draw-offer', () => {
            const roomId = socketRooms.get(socket.id);
            if (!roomId) return;
            const room = rooms.get(roomId);
            if (!room || !room.started || room.game.gameOver || room.isVsBot) return;

            const color = room.getPlayerColor(socket.id);
            if (!color) return;

            room.drawOffer = color;
            const opponentSocket = room.getOpponentSocket(color);
            if (opponentSocket) {
                opponentSocket.emit('draw-offered', { by: color });
            }
        });

        // ─── DRAW ACCEPT ───────────────────
        socket.on('draw-accept', () => {
            const roomId = socketRooms.get(socket.id);
            if (!roomId) return;
            const room = rooms.get(roomId);
            if (!room || !room.started || room.game.gameOver) return;

            const color = room.getPlayerColor(socket.id);
            if (!color || room.drawOffer === color) return; // Can't accept your own offer

            room.game.endGame('draw', 'agreement');
            handleGameEnd(io, room, 'draw', 'agreement');
        });

        // ─── DRAW DECLINE ──────────────────
        socket.on('draw-decline', () => {
            const roomId = socketRooms.get(socket.id);
            if (!roomId) return;
            const room = rooms.get(roomId);
            if (!room) return;

            const color = room.getPlayerColor(socket.id);
            room.drawOffer = null;
            const opponentSocket = room.getOpponentSocket(color);
            if (opponentSocket) {
                opponentSocket.emit('draw-declined');
            }
        });

        // ─── REMATCH ───────────────────────
        socket.on('rematch', () => {
            const roomId = socketRooms.get(socket.id);
            if (!roomId) return;
            const room = rooms.get(roomId);
            if (!room || !room.game.gameOver) return;

            // Swap colors and restart
            const tmpW = room.players.w;
            const tmpSW = room.sockets.w;
            room.players.w = room.players.b;
            room.sockets.w = room.sockets.b;
            room.players.b = tmpW;
            room.sockets.b = tmpSW;

            startOnlineGame(io, room);
        });

        // ─── DISCONNECT ────────────────────
        socket.on('disconnect', () => {
            console.log(`[WS] ${user.username} disconnected`);
            onlineUsers.delete(socket.id);
            io.emit('online-count', getOnlineCount());
            matchQueue = matchQueue.filter(q => q.socket.id !== socket.id);

            const roomId = socketRooms.get(socket.id);
            if (roomId) {
                const room = rooms.get(roomId);
                if (room && room.started && !room.game.gameOver) {
                    const color = room.getPlayerColor(socket.id);
                    if (color && !room.isVsBot) {
                        // Player disconnected — opponent wins
                        const winner = color === 'w' ? 'b' : 'w';
                        room.game.endGame(winner, 'disconnect');
                        handleGameEnd(io, room, winner, 'disconnect');
                    }
                }
                socketRooms.delete(socket.id);
                // Clean up empty rooms after a delay
                setTimeout(() => {
                    const r = rooms.get(roomId);
                    if (r && r.game.gameOver) r.destroy();
                }, 30000);
            }
        });
    });

    // Clean up stale queue entries every 30 seconds
    setInterval(() => {
        const cutoff = Date.now() - 120000; // 2 minute timeout
        matchQueue = matchQueue.filter(q => q.timestamp > cutoff);
    }, 30000);
}

// ═══════════════════════════════════════
// GAME FLOW HELPERS
// ═══════════════════════════════════════

function startOnlineGame(io, room) {
    room.startGame();
    io.to(room.id).emit('game-start', {
        roomId: room.id,
        white: room.players.w ? { username: room.players.w.username, elo: room.players.w.elo } : null,
        black: room.players.b ? { username: room.players.b.username, elo: room.players.b.elo } : null,
        timeControl: room.timeControl,
        timeLeft: { ...room.timeLeft },
        isVsBot: room.isVsBot,
        botDifficulty: room.botDifficulty
    });

    // Notify each player of their assigned color
    if (room.sockets.w) room.sockets.w.emit('assigned-color', { color: 'w' });
    if (room.sockets.b) room.sockets.b.emit('assigned-color', { color: 'b' });

    // Start timer if time control is set
    if (room.timeConfig) {
        room.startTimer();
    }

    // If bot plays white, make bot move
    if (room.isVsBot) {
        const botColor = room.players.w?.userId === null ? 'w' : 'b';
        if (room.game.turn === botColor) {
            setTimeout(() => makeBotMove(io, room), 500);
        }
    }
}

async function makeBotMove(io, room) {
    if (room.game.gameOver) return;

    const move = await stockfishAi.getBestMove(room.game, room.botDifficulty);
    if (!move || room.game.gameOver) return;

    const result = room.game.makeMove(move.from[0], move.from[1], move.to[0], move.to[1], move.promo);
    if (!result.valid) return;

    room.addIncrement(room.game.turn === 'w' ? 'b' : 'w');

    io.to(room.id).emit('move-made', {
        from: move.from,
        to: move.to,
        promo: move.promo || null,
        san: result.san,
        isCapture: result.isCapture,
        isCastle: result.isCastle,
        isPromotion: result.isPromotion,
        turn: room.game.turn,
        timeLeft: { ...room.timeLeft }
    });

    if (result.result) {
        handleGameEnd(io, room, result.result.result, result.result.reason);
    } else if (room.timeConfig) {
        room.startTimer();
    }
}

function handleGameEnd(io, room, result, reason) {
    room.stopTimer();

    // Process ELO and save game to DB
    let gameResult = null;
    if (room.players.w && (room.players.b || room.isVsBot)) {
        const resultStr = result === 'w' ? 'white' : result === 'b' ? 'black' : 'draw';
        try {
            gameResult = leaderboard.processGameResult({
                whiteId: room.players.w.userId,
                blackId: room.players.b?.userId || null,
                result: resultStr,
                resultReason: reason,
                pgn: room.game.toPgn(room.players.w.username, room.players.b?.username || 'Stockfish'),
                movesCount: room.game.moveLog.length,
                timeControl: room.timeControl,
                isVsBot: room.isVsBot,
                botDifficulty: room.botDifficulty
            });
        } catch (e) {
            console.error('[Game] Error saving game result:', e);
        }
    }

    io.to(room.id).emit('game-over', {
        result,
        reason,
        pgn: room.game.toPgn(room.players.w?.username, room.players.b?.username),
        eloChanges: gameResult ? {
            white: { change: gameResult.whiteEloChange, newElo: gameResult.whiteEloNew },
            black: { change: gameResult.blackEloChange, newElo: gameResult.blackEloNew }
        } : null
    });
}

module.exports = {
    setupSocketHandlers,
    rooms,
    getOnlineCount
};
