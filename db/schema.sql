-- Premium Chess Database Schema
-- SQLite

CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    elo_rating INTEGER DEFAULT 1200,
    wins INTEGER DEFAULT 0,
    losses INTEGER DEFAULT 0,
    draws INTEGER DEFAULT 0,
    games_played INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL,
    expires_at DATETIME NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS games (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    white_id INTEGER,
    black_id INTEGER,
    pgn TEXT,
    result TEXT, -- 'white', 'black', 'draw'
    result_reason TEXT, -- 'checkmate', 'resign', 'timeout', 'stalemate', 'agreement', 'repetition', '50move', 'insufficient'
    time_control TEXT,
    moves_count INTEGER DEFAULT 0,
    white_elo_before INTEGER,
    black_elo_before INTEGER,
    white_elo_change INTEGER DEFAULT 0,
    black_elo_change INTEGER DEFAULT 0,
    is_vs_bot INTEGER DEFAULT 0,
    bot_difficulty TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    ended_at DATETIME,
    FOREIGN KEY (white_id) REFERENCES users(id),
    FOREIGN KEY (black_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_users_elo ON users(elo_rating DESC);
CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);
CREATE INDEX IF NOT EXISTS idx_games_white ON games(white_id);
CREATE INDEX IF NOT EXISTS idx_games_black ON games(black_id);
CREATE INDEX IF NOT EXISTS idx_games_created ON games(created_at DESC);
