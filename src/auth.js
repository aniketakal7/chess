/**
 * Authentication module — Register, Login, Logout, Session management
 * Uses bcrypt for password hashing and crypto for session tokens
 */

const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const db = require('./db');

const SALT_ROUNDS = 10;
const SESSION_DURATION_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

// ═══════════════════════════════════════
// MIDDLEWARE
// ═══════════════════════════════════════

/**
 * Express middleware: attaches req.user if a valid session cookie exists
 */
function authMiddleware(req, res, next) {
    const token = req.cookies?.session_token;
    if (!token) {
        req.user = null;
        return next();
    }
    const session = db.findSession(token);
    if (!session) {
        res.clearCookie('session_token');
        req.user = null;
        return next();
    }
    const user = db.findUserById(session.user_id);
    req.user = user || null;
    next();
}

/**
 * Express middleware: requires authentication — returns 401 if not logged in
 */
function requireAuth(req, res, next) {
    if (!req.user) {
        return res.status(401).json({ error: 'Not authenticated' });
    }
    next();
}

// ═══════════════════════════════════════
// ROUTE HANDLERS
// ═══════════════════════════════════════

/**
 * POST /api/auth/register
 * Body: { username, email, password }
 */
async function register(req, res) {
    try {
        const { username, email, password } = req.body;

        // Validation
        if (!username || !email || !password) {
            return res.status(400).json({ error: 'All fields are required' });
        }
        if (username.length < 3 || username.length > 20) {
            return res.status(400).json({ error: 'Username must be 3–20 characters' });
        }
        if (!/^[a-zA-Z0-9_]+$/.test(username)) {
            return res.status(400).json({ error: 'Username can only contain letters, numbers, and underscores' });
        }
        if (password.length < 6) {
            return res.status(400).json({ error: 'Password must be at least 6 characters' });
        }

        // Check duplicates
        if (db.findUserByUsername(username)) {
            return res.status(409).json({ error: 'Username already taken' });
        }
        if (db.findUserByEmail(email)) {
            return res.status(409).json({ error: 'Email already registered' });
        }

        // Create user
        const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
        const userId = db.createUser(username, email, passwordHash);

        // Create session
        const token = crypto.randomUUID();
        const expiresAt = new Date(Date.now() + SESSION_DURATION_MS).toISOString();
        db.createSession(token, userId, expiresAt);

        res.cookie('session_token', token, {
            httpOnly: true,
            maxAge: SESSION_DURATION_MS,
            sameSite: 'lax',
            path: '/'
        });

        const user = db.findUserById(userId);
        res.status(201).json({ user });
    } catch (err) {
        console.error('[Auth] Register error:', err);
        res.status(500).json({ error: 'Registration failed' });
    }
}

/**
 * POST /api/auth/login
 * Body: { username, password }
 */
async function login(req, res) {
    try {
        const { username, password } = req.body;

        if (!username || !password) {
            return res.status(400).json({ error: 'Username and password are required' });
        }

        const user = db.findUserByUsername(username);
        if (!user) {
            return res.status(401).json({ error: 'Invalid username or password' });
        }

        const valid = await bcrypt.compare(password, user.password_hash);
        if (!valid) {
            return res.status(401).json({ error: 'Invalid username or password' });
        }

        // Create session
        const token = crypto.randomUUID();
        const expiresAt = new Date(Date.now() + SESSION_DURATION_MS).toISOString();
        db.createSession(token, user.id, expiresAt);

        res.cookie('session_token', token, {
            httpOnly: true,
            maxAge: SESSION_DURATION_MS,
            sameSite: 'lax',
            path: '/'
        });

        const profile = db.findUserById(user.id);
        res.json({ user: profile });
    } catch (err) {
        console.error('[Auth] Login error:', err);
        res.status(500).json({ error: 'Login failed' });
    }
}

/**
 * GET /api/auth/me — returns current user profile
 */
function me(req, res) {
    if (!req.user) {
        return res.status(401).json({ error: 'Not authenticated' });
    }
    const rank = db.getPlayerRank(req.user.id);
    res.json({ user: { ...req.user, rank: rank?.rank || null } });
}

/**
 * POST /api/auth/logout
 */
function logout(req, res) {
    const token = req.cookies?.session_token;
    if (token) {
        db.deleteSession(token);
        res.clearCookie('session_token');
    }
    res.json({ ok: true });
}

/**
 * Authenticate a Socket.IO connection using the session cookie
 */
function authenticateSocket(socket, next) {
    const cookies = socket.handshake.headers.cookie;
    if (!cookies) return next(new Error('No cookies'));

    const tokenMatch = cookies.match(/session_token=([^;]+)/);
    if (!tokenMatch) return next(new Error('No session token'));

    const session = db.findSession(tokenMatch[1]);
    if (!session) return next(new Error('Invalid session'));

    const user = db.findUserById(session.user_id);
    if (!user) return next(new Error('User not found'));

    socket.user = user;
    next();
}

module.exports = {
    authMiddleware,
    requireAuth,
    register,
    login,
    me,
    logout,
    authenticateSocket
};
