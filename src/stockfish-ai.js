/**
 * Stockfish AI Integration — Server-side chess engine for strong AI play
 * Uses the stockfish.js WASM package for server-side move calculation
 * 
 * Fallback: If stockfish WASM isn't available, uses a simple evaluation-based AI
 */

let stockfishAvailable = false;
let StockfishModule = null;

// Try to load stockfish — fall back gracefully if not available
try {
    StockfishModule = require('stockfish');
    stockfishAvailable = true;
    console.log('[Stockfish] Module loaded successfully');
} catch (e) {
    console.warn('[Stockfish] Module not available — using fallback minimax AI');
    stockfishAvailable = false;
}

// ═══════════════════════════════════════
// DIFFICULTY SETTINGS
// ═══════════════════════════════════════

const DIFFICULTY_MAP = {
    easy:   { skillLevel: 3,  depth: 5,  moveTime: 500 },
    medium: { skillLevel: 10, depth: 10, moveTime: 1000 },
    hard:   { skillLevel: 18, depth: 15, moveTime: 2000 },
    master: { skillLevel: 20, depth: 20, moveTime: 3000 }
};

// ═══════════════════════════════════════
// STOCKFISH ENGINE WRAPPER
// ═══════════════════════════════════════

class StockfishEngine {
    constructor() {
        this.engine = null;
        this.ready = false;
        this.pendingResolve = null;
        this.bestMove = null;
    }

    async init() {
        if (!stockfishAvailable) return false;
        try {
            // stockfish npm package exports a function that returns a worker-like object
            if (typeof StockfishModule === 'function') {
                this.engine = StockfishModule();
            } else if (StockfishModule.default && typeof StockfishModule.default === 'function') {
                this.engine = StockfishModule.default();
            } else {
                console.warn('[Stockfish] Unexpected module format');
                return false;
            }

            return new Promise((resolve) => {
                const timeout = setTimeout(() => {
                    console.warn('[Stockfish] Init timeout');
                    resolve(false);
                }, 5000);

                this.engine.onmessage = (msg) => {
                    const line = typeof msg === 'string' ? msg : msg.data;
                    if (line === 'uciok') {
                        clearTimeout(timeout);
                        this.ready = true;
                        console.log('[Stockfish] Engine ready');
                        resolve(true);
                    }
                    this._handleMessage(line);
                };

                this.engine.postMessage('uci');
            });
        } catch (e) {
            console.warn('[Stockfish] Init error:', e.message);
            return false;
        }
    }

    _handleMessage(line) {
        if (typeof line !== 'string') return;

        // Parse bestmove response
        if (line.startsWith('bestmove')) {
            const parts = line.split(' ');
            this.bestMove = parts[1];
            if (this.pendingResolve) {
                this.pendingResolve(this.bestMove);
                this.pendingResolve = null;
            }
        }
    }

    /**
     * Get best move for a given FEN position
     * @param {string} fen - FEN string
     * @param {string} difficulty - 'easy', 'medium', 'hard', 'master'
     * @returns {Promise<string|null>} UCI move string (e.g., 'e2e4') or null
     */
    async getBestMove(fen, difficulty = 'medium') {
        if (!this.ready || !this.engine) return null;

        const settings = DIFFICULTY_MAP[difficulty] || DIFFICULTY_MAP.medium;

        return new Promise((resolve) => {
            const timeout = setTimeout(() => {
                this.pendingResolve = null;
                resolve(null);
            }, settings.moveTime + 2000);

            this.pendingResolve = (move) => {
                clearTimeout(timeout);
                resolve(move);
            };

            this.engine.postMessage(`setoption name Skill Level value ${settings.skillLevel}`);
            this.engine.postMessage('ucinewgame');
            this.engine.postMessage(`position fen ${fen}`);
            this.engine.postMessage(`go depth ${settings.depth} movetime ${settings.moveTime}`);
        });
    }

    destroy() {
        if (this.engine) {
            try {
                this.engine.postMessage('quit');
            } catch (e) {}
            this.engine = null;
        }
        this.ready = false;
    }
}

// ═══════════════════════════════════════
// FALLBACK MINIMAX AI
// ═══════════════════════════════════════

const PIECE_VAL = { P: 100, N: 320, B: 330, R: 500, Q: 900, K: 20000 };
const PST = {
    P: [[0,0,0,0,0,0,0,0],[50,50,50,50,50,50,50,50],[10,10,20,30,30,20,10,10],[5,5,10,25,25,10,5,5],[0,0,0,20,20,0,0,0],[5,-5,-10,0,0,-10,-5,5],[5,10,10,-20,-20,10,10,5],[0,0,0,0,0,0,0,0]],
    N: [[-50,-40,-30,-30,-30,-30,-40,-50],[-40,-20,0,0,0,0,-20,-40],[-30,0,10,15,15,10,0,-30],[-30,5,15,20,20,15,5,-30],[-30,0,15,20,20,15,0,-30],[-30,5,10,15,15,10,5,-30],[-40,-20,0,5,5,0,-20,-40],[-50,-40,-30,-30,-30,-30,-40,-50]],
    B: [[-20,-10,-10,-10,-10,-10,-10,-20],[-10,0,0,0,0,0,0,-10],[-10,0,5,10,10,5,0,-10],[-10,5,5,10,10,5,5,-10],[-10,0,10,10,10,10,0,-10],[-10,10,10,10,10,10,10,-10],[-10,5,0,0,0,0,5,-10],[-20,-10,-10,-10,-10,-10,-10,-20]],
    R: [[0,0,0,0,0,0,0,0],[5,10,10,10,10,10,10,5],[-5,0,0,0,0,0,0,-5],[-5,0,0,0,0,0,0,-5],[-5,0,0,0,0,0,0,-5],[-5,0,0,0,0,0,0,-5],[-5,0,0,0,0,0,0,-5],[0,0,0,5,5,0,0,0]],
    Q: [[-20,-10,-10,-5,-5,-10,-10,-20],[-10,0,0,0,0,0,0,-10],[-10,0,5,5,5,5,0,-10],[-5,0,5,5,5,5,0,-5],[0,0,5,5,5,5,0,-5],[-10,5,5,5,5,5,0,-10],[-10,0,5,0,0,5,0,-10],[-20,-10,-10,-5,-5,-10,-10,-20]],
    K: [[-30,-40,-40,-50,-50,-40,-40,-30],[-30,-40,-40,-50,-50,-40,-40,-30],[-30,-40,-40,-50,-50,-40,-40,-30],[-30,-40,-40,-50,-50,-40,-40,-30],[-20,-30,-30,-40,-40,-30,-30,-20],[-10,-20,-20,-20,-20,-20,-20,-10],[20,20,0,0,0,0,20,20],[20,30,10,0,0,10,30,20]]
};

/**
 * Get a best move using the server-side minimax (fallback when Stockfish isn't available)
 * Uses the ChessGame instance's allLegalMoves
 * @param {ChessGame} game - The chess game instance
 * @param {string} difficulty - 'easy', 'medium', 'hard', 'master'
 * @returns {object|null} { from: [r,c], to: [r,c] }
 */
function fallbackGetBestMove(game, difficulty) {
    const moves = game.allLegalMoves();
    if (moves.length === 0) return null;

    // Easy mode: 45% random
    if (difficulty === 'easy' && Math.random() < 0.45) {
        return moves[Math.floor(Math.random() * moves.length)];
    }

    const depth = difficulty === 'easy' ? 1 : difficulty === 'medium' ? 2 : difficulty === 'hard' ? 3 : 4;

    // Simple evaluation
    function evalBoard(b) {
        let score = 0;
        for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) {
            const p = b[r][c]; if (!p) continue;
            const cl = p[0], t = p[1], base = PIECE_VAL[t] || 0;
            const pr = cl === 'w' ? r : 7 - r;
            const pst = PST[t] ? PST[t][pr][c] : 0;
            if (cl === 'w') score += base + pst; else score -= base + pst;
        }
        return score;
    }

    // Order moves by MVV-LVA
    function orderMoves(mvs, b) {
        return mvs.map(m => {
            let sc = 0;
            const piece = b[m.from[0]][m.from[1]];
            const target = b[m.to[0]][m.to[1]];
            if (target) sc += 10 * (PIECE_VAL[target[1]] || 0) - (PIECE_VAL[piece[1]] || 0);
            if (piece[1] === 'P' && (m.to[0] === 0 || m.to[0] === 7)) sc += 900;
            return { move: m, score: sc };
        }).sort((a, b) => b.score - a.score).map(x => x.move);
    }

    // Minimax with alpha-beta
    function minimax(d, b, isMax, alpha, beta) {
        if (d === 0) return { score: evalBoard(b) };

        const ac = isMax ? 'w' : 'b';
        // Quick move gen (simplified — just use raw evaluation at low depth)
        const allMoves = [];
        for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) {
            if (!b[r][c] || b[r][c][0] !== ac) continue;
            game._rawMoves(r, c, b, null).forEach(m => {
                const nb = b.map(row => row.slice());
                nb[m[0]][m[1]] = nb[r][c]; nb[r][c] = null;
                // Simple king-in-check filter
                let kingOk = true;
                outer: for (let rr = 0; rr < 8; rr++) for (let cc = 0; cc < 8; cc++)
                    if (nb[rr][cc] === ac + 'K') {
                        for (let ar = 0; ar < 8; ar++) for (let acc = 0; acc < 8; acc++)
                            if (nb[ar][acc] && nb[ar][acc][0] !== ac) {
                                const ams = game._rawMoves(ar, acc, nb, null);
                                if (ams.some(am => am[0] === rr && am[1] === cc)) { kingOk = false; break outer; }
                            }
                        break outer;
                    }
                if (kingOk) allMoves.push({ from: [r, c], to: m });
            });
        }

        if (allMoves.length === 0) return { score: isMax ? -9000000 : 9000000 };

        const ordered = orderMoves(allMoves, b);
        let bestMove = ordered[0];

        if (isMax) {
            let maxEval = -Infinity;
            for (const move of ordered) {
                const nb = b.map(row => row.slice());
                const piece = nb[move.from[0]][move.from[1]];
                if (piece[1] === 'P' && (move.to[0] === 0 || move.to[0] === 7)) nb[move.to[0]][move.to[1]] = 'wQ';
                else nb[move.to[0]][move.to[1]] = piece;
                nb[move.from[0]][move.from[1]] = null;
                const ev = minimax(d - 1, nb, false, alpha, beta).score;
                if (ev > maxEval) { maxEval = ev; bestMove = move; }
                alpha = Math.max(alpha, ev);
                if (beta <= alpha) break;
            }
            return { score: maxEval, move: bestMove };
        } else {
            let minEval = Infinity;
            for (const move of ordered) {
                const nb = b.map(row => row.slice());
                const piece = nb[move.from[0]][move.from[1]];
                if (piece[1] === 'P' && (move.to[0] === 0 || move.to[0] === 7)) nb[move.to[0]][move.to[1]] = 'bQ';
                else nb[move.to[0]][move.to[1]] = piece;
                nb[move.from[0]][move.from[1]] = null;
                const ev = minimax(d - 1, nb, true, alpha, beta).score;
                if (ev < minEval) { minEval = ev; bestMove = move; }
                beta = Math.min(beta, ev);
                if (beta <= alpha) break;
            }
            return { score: minEval, move: bestMove };
        }
    }

    const isMax = game.turn === 'w';
    const result = minimax(depth, game.board, isMax, -Infinity, Infinity);
    return result.move || moves[0];
}

// ═══════════════════════════════════════
// UCI MOVE PARSING
// ═══════════════════════════════════════

/**
 * Convert UCI move string (e.g., 'e2e4', 'a7a8q') to board coordinates
 */
function parseUciMove(uci) {
    if (!uci || uci.length < 4) return null;
    const files = 'abcdefgh';
    const fc = files.indexOf(uci[0]);
    const fr = 8 - parseInt(uci[1]);
    const tc = files.indexOf(uci[2]);
    const tr = 8 - parseInt(uci[3]);
    const promo = uci.length > 4 ? uci[4].toUpperCase() : null;
    if (fc < 0 || tc < 0 || fr < 0 || fr > 7 || tr < 0 || tr > 7) return null;
    return { from: [fr, fc], to: [tr, tc], promo };
}

// ═══════════════════════════════════════
// SINGLETON ENGINE INSTANCE
// ═══════════════════════════════════════

let engineInstance = null;

async function getEngine() {
    if (engineInstance && engineInstance.ready) return engineInstance;
    engineInstance = new StockfishEngine();
    const ok = await engineInstance.init();
    if (!ok) {
        engineInstance = null;
        return null;
    }
    return engineInstance;
}

/**
 * Main API: Get the best move for a chess game
 * Tries Stockfish first, falls back to minimax
 * @param {ChessGame} game - The chess game instance
 * @param {string} difficulty - 'easy', 'medium', 'hard', 'master'
 * @returns {Promise<{ from: [number,number], to: [number,number], promo: string|null }|null>}
 */
async function getBestMove(game, difficulty = 'medium') {
    // Try Stockfish first
    const engine = await getEngine();
    if (engine) {
        try {
            const fen = game.toFen();
            const uci = await engine.getBestMove(fen, difficulty);
            if (uci) {
                const move = parseUciMove(uci);
                if (move) return move;
            }
        } catch (e) {
            console.warn('[Stockfish] Error getting move:', e.message);
        }
    }

    // Fallback to minimax
    const move = fallbackGetBestMove(game, difficulty);
    return move ? { from: move.from, to: move.to, promo: null } : null;
}

module.exports = {
    getBestMove,
    getEngine,
    parseUciMove,
    StockfishEngine,
    isAvailable: () => stockfishAvailable
};
