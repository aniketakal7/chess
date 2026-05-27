/**
 * Database helpers — Pure JavaScript JSON connection and query functions
 * Replaces better-sqlite3 to ensure seamless cross-platform running without compiling C++ binaries.
 */

const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, '..', 'db', 'db.json');

// Memory cache
let data = {
    users: [],
    sessions: [],
    games: []
};

// Initialize JSON database
function initDb() {
    try {
        const dbDir = path.dirname(DB_PATH);
        if (!fs.existsSync(dbDir)) {
            fs.mkdirSync(dbDir, { recursive: true });
        }
        if (fs.existsSync(DB_PATH)) {
            const content = fs.readFileSync(DB_PATH, 'utf-8');
            if (content.trim()) {
                data = JSON.parse(content);
            }
        } else {
            saveToDisk();
        }
        // Ensure default structures exist
        if (!data.users) data.users = [];
        if (!data.sessions) data.sessions = [];
        if (!data.games) data.games = [];
        console.log('[DB] JSON database initialized successfully at', DB_PATH);
    } catch (err) {
        console.error('[DB] Failed to initialize JSON database:', err.message);
    }
}

function saveToDisk() {
    try {
        fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2), 'utf-8');
    } catch (err) {
        console.error('[DB] Failed to save JSON database to disk:', err.message);
    }
}

// Run initialization immediately
initDb();

// Mock getDb to prevent errors if external modules check it
function getDb() {
    return {
        pragma: () => {},
        exec: () => {},
        prepare: () => ({
            run: () => ({ lastInsertRowid: 1 }),
            get: () => null,
            all: () => []
        })
    };
}

// ═══════════════════════════════════════
// USER QUERIES
// ═══════════════════════════════════════

function createUser(username, email, passwordHash) {
    const maxId = data.users.reduce((max, u) => u.id > max ? u.id : max, 0);
    const newId = maxId + 1;
    const newUser = {
        id: newId,
        username,
        email,
        password_hash: passwordHash,
        elo_rating: 1200,
        wins: 0,
        losses: 0,
        draws: 0,
        games_played: 0,
        created_at: new Date().toISOString()
    };
    data.users.push(newUser);
    saveToDisk();
    return newId;
}

function findUserByUsername(username) {
    const lower = username.toLowerCase();
    return data.users.find(u => u.username.toLowerCase() === lower) || null;
}

function findUserByEmail(email) {
    const lower = email.toLowerCase();
    return data.users.find(u => u.email.toLowerCase() === lower) || null;
}

function findUserById(id) {
    const user = data.users.find(u => u.id === parseInt(id));
    if (!user) return null;
    // Return a clone to prevent side-effects
    return { ...user };
}

function updateElo(userId, newElo, resultType) {
    const user = data.users.find(u => u.id === parseInt(userId));
    if (user) {
        user.elo_rating = newElo;
        user.games_played += 1;
        if (resultType === 'win') user.wins += 1;
        else if (resultType === 'loss') user.losses += 1;
        else if (resultType === 'draw') user.draws += 1;
        saveToDisk();
    }
}

// ═══════════════════════════════════════
// SESSION QUERIES
// ═══════════════════════════════════════

function createSession(token, userId, expiresAt) {
    data.sessions.push({
        token,
        user_id: parseInt(userId),
        expires_at: expiresAt
    });
    saveToDisk();
}

function findSession(token) {
    const now = new Date();
    const session = data.sessions.find(s => s.token === token && new Date(s.expires_at) > now);
    return session || null;
}

function deleteSession(token) {
    data.sessions = data.sessions.filter(s => s.token !== token);
    saveToDisk();
}

function cleanExpiredSessions() {
    const now = new Date();
    const initialCount = data.sessions.length;
    data.sessions = data.sessions.filter(s => new Date(s.expires_at) > now);
    if (data.sessions.length !== initialCount) {
        saveToDisk();
    }
}

// ═══════════════════════════════════════
// GAME QUERIES
// ═══════════════════════════════════════

function saveGame(gData) {
    const maxId = data.games.reduce((max, g) => g.id > max ? g.id : max, 0);
    const newId = maxId + 1;
    const newGame = {
        id: newId,
        white_id: gData.whiteId ? parseInt(gData.whiteId) : null,
        black_id: gData.blackId ? parseInt(gData.blackId) : null,
        pgn: gData.pgn,
        result: gData.result, // 'white', 'black', 'draw'
        result_reason: gData.resultReason, // 'checkmate', 'resign', etc.
        time_control: gData.timeControl || 'casual',
        moves_count: gData.movesCount || 0,
        white_elo_before: gData.whiteEloBefore,
        black_elo_before: gData.blackEloBefore,
        white_elo_change: gData.whiteEloChange || 0,
        black_elo_change: gData.blackEloChange || 0,
        is_vs_bot: gData.isVsBot ? 1 : 0,
        bot_difficulty: gData.botDifficulty,
        created_at: new Date().toISOString(),
        ended_at: new Date().toISOString()
    };
    data.games.push(newGame);
    saveToDisk();
    return newId;
}

function getGameHistory(userId, limit = 20) {
    const uId = parseInt(userId);
    const filtered = data.games.filter(g => g.white_id === uId || g.black_id === uId);
    
    // Sort descending by created_at
    filtered.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    
    // Slice by limit
    const limited = filtered.slice(0, limit);
    
    // Map usernames
    return limited.map(g => {
        const whiteUser = data.users.find(u => u.id === g.white_id);
        const blackUser = data.users.find(u => u.id === g.black_id);
        return {
            ...g,
            white_username: whiteUser ? whiteUser.username : (g.is_vs_bot ? 'Player' : null),
            black_username: blackUser ? blackUser.username : (g.is_vs_bot ? 'Stockfish' : null)
        };
    });
}

function getGameById(gameId) {
    const g = data.games.find(g => g.id === parseInt(gameId));
    if (!g) return null;
    const whiteUser = data.users.find(u => u.id === g.white_id);
    const blackUser = data.users.find(u => u.id === g.black_id);
    return {
        ...g,
        white_username: whiteUser ? whiteUser.username : (g.is_vs_bot ? 'Player' : null),
        black_username: blackUser ? blackUser.username : (g.is_vs_bot ? 'Stockfish' : null)
    };
}

// ═══════════════════════════════════════
// LEADERBOARD QUERIES
// ═══════════════════════════════════════

function getLeaderboard(limit = 100) {
    // Only users with games_played > 0
    const active = data.users.filter(u => u.games_played > 0);
    // Sort descending by elo_rating
    active.sort((a, b) => b.elo_rating - a.elo_rating);
    return active.slice(0, limit).map(u => ({
        id: u.id,
        username: u.username,
        elo_rating: u.elo_rating,
        wins: u.wins,
        losses: u.losses,
        draws: u.draws,
        games_played: u.games_played
    }));
}

function getPlayerRank(userId) {
    const user = findUserById(userId);
    if (!user) return null;
    
    // Rank is count of users with higher ELO and games_played > 0, plus 1
    const betterPlayers = data.users.filter(u => u.elo_rating > user.elo_rating && u.games_played > 0);
    const rank = betterPlayers.length + 1;
    
    return { ...user, rank };
}

module.exports = {
    getDb,
    createUser, findUserByUsername, findUserByEmail, findUserById, updateElo,
    createSession, findSession, deleteSession, cleanExpiredSessions,
    saveGame, getGameHistory, getGameById,
    getLeaderboard, getPlayerRank
};
