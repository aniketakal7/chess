/**
 * Premium Chess Server
 * Express + Socket.IO server for online multiplayer chess
 */

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cookieParser = require('cookie-parser');
const path = require('path');

// Import modules
const auth = require('./src/auth');
const matchmaking = require('./src/matchmaking');
const leaderboardRoutes = require('./src/leaderboard');
const db = require('./src/db');

// ═══════════════════════════════════════
// SERVER SETUP
// ═══════════════════════════════════════

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: '*',
        credentials: true
    },
    pingTimeout: 30000,
    pingInterval: 10000
});

const PORT = process.env.PORT || 3000;

// ═══════════════════════════════════════
// MIDDLEWARE
// ═══════════════════════════════════════

app.use(express.json());
app.use(cookieParser());
app.use(auth.authMiddleware);

// Serve static files — the index.html is in the root directory
app.use(express.static(path.join(__dirname)));

// ═══════════════════════════════════════
// AUTH API ROUTES
// ═══════════════════════════════════════

app.post('/api/auth/register', auth.register);
app.post('/api/auth/login', auth.login);
app.get('/api/auth/me', auth.me);
app.post('/api/auth/logout', auth.logout);

// ═══════════════════════════════════════
// LEADERBOARD & GAME API ROUTES
// ═══════════════════════════════════════

app.get('/api/leaderboard', leaderboardRoutes.getLeaderboard);
app.get('/api/leaderboard/:userId', leaderboardRoutes.getPlayerStats);
app.get('/api/games', auth.requireAuth, leaderboardRoutes.getGameHistory);
app.get('/api/games/:gameId', leaderboardRoutes.getGame);

// ═══════════════════════════════════════
// ONLINE STATUS
// ═══════════════════════════════════════

app.get('/api/status', (req, res) => {
    res.json({
        online: matchmaking.getOnlineCount(),
        activeGames: matchmaking.rooms.size,
        server: 'Premium Chess v1.0'
    });
});

// ═══════════════════════════════════════
// SOCKET.IO SETUP
// ═══════════════════════════════════════

// Socket authentication middleware
io.use(auth.authenticateSocket);

// Setup game socket handlers
matchmaking.setupSocketHandlers(io);

// ═══════════════════════════════════════
// PERIODIC CLEANUP
// ═══════════════════════════════════════

// Clean expired sessions every hour
setInterval(() => {
    try {
        db.cleanExpiredSessions();
    } catch (e) {
        console.error('[Cleanup] Session cleanup error:', e.message);
    }
}, 60 * 60 * 1000);

// ═══════════════════════════════════════
// START SERVER
// ═══════════════════════════════════════

server.listen(PORT, () => {
    console.log('');
    console.log('  ♔ ═══════════════════════════════════════ ♔');
    console.log('  ║                                         ║');
    console.log('  ║     PREMIUM CHESS SERVER                ║');
    console.log(`  ║     Running on http://localhost:${PORT}     ║`);
    console.log('  ║                                         ║');
    console.log('  ♔ ═══════════════════════════════════════ ♔');
    console.log('');
    console.log('  [DB] JSON database initialized');
    console.log('  [WS] Socket.IO ready for connections');
    console.log('');
});
