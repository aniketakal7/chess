/**
 * Leaderboard & ELO Rating System
 * Standard ELO with K-factor 32 for new players (<30 games), K-factor 16 otherwise
 */

const db = require('./db');

// ═══════════════════════════════════════
// ELO CALCULATION
// ═══════════════════════════════════════

/**
 * Calculate expected score for player A against player B
 */
function expectedScore(ratingA, ratingB) {
    return 1 / (1 + Math.pow(10, (ratingB - ratingA) / 400));
}

/**
 * Calculate new ratings after a game
 * @param {number} whiteElo - White player's current ELO
 * @param {number} blackElo - Black player's current ELO
 * @param {string} result - 'white', 'black', or 'draw'
 * @param {number} whiteGames - White player's total games played
 * @param {number} blackGames - Black player's total games played
 * @returns {{ whiteNew: number, blackNew: number, whiteChange: number, blackChange: number }}
 */
function calculateElo(whiteElo, blackElo, result, whiteGames, blackGames) {
    const kWhite = whiteGames < 30 ? 32 : 16;
    const kBlack = blackGames < 30 ? 32 : 16;

    const expectedWhite = expectedScore(whiteElo, blackElo);
    const expectedBlack = expectedScore(blackElo, whiteElo);

    let actualWhite, actualBlack;
    if (result === 'white') {
        actualWhite = 1; actualBlack = 0;
    } else if (result === 'black') {
        actualWhite = 0; actualBlack = 1;
    } else {
        actualWhite = 0.5; actualBlack = 0.5;
    }

    const whiteChange = Math.round(kWhite * (actualWhite - expectedWhite));
    const blackChange = Math.round(kBlack * (actualBlack - expectedBlack));

    return {
        whiteNew: whiteElo + whiteChange,
        blackNew: blackElo + blackChange,
        whiteChange,
        blackChange
    };
}

// ═══════════════════════════════════════
// GAME RESULT PROCESSING
// ═══════════════════════════════════════

/**
 * Process the result of a completed game — update ELO and save to DB
 * @param {object} params
 * @returns {object} The saved game data with ELO changes
 */
function processGameResult({
    whiteId, blackId, result, resultReason, pgn, movesCount, timeControl,
    isVsBot = false, botDifficulty = null
}) {
    const whiteUser = db.findUserById(whiteId);
    const blackUser = blackId ? db.findUserById(blackId) : null;

    let whiteChange = 0, blackChange = 0;
    let whiteEloBefore = whiteUser?.elo_rating || 1200;
    let blackEloBefore = blackUser?.elo_rating || 1200;

    // Only update ELO for human vs human games
    if (whiteUser && blackUser && !isVsBot) {
        const elo = calculateElo(
            whiteUser.elo_rating, blackUser.elo_rating,
            result, whiteUser.games_played, blackUser.games_played
        );
        whiteChange = elo.whiteChange;
        blackChange = elo.blackChange;

        // Determine result type for each player
        let whiteResult, blackResult;
        if (result === 'white') { whiteResult = 'win'; blackResult = 'loss'; }
        else if (result === 'black') { whiteResult = 'loss'; blackResult = 'win'; }
        else { whiteResult = 'draw'; blackResult = 'draw'; }

        db.updateElo(whiteId, elo.whiteNew, whiteResult);
        db.updateElo(blackId, elo.blackNew, blackResult);
    }

    // Save game record
    const gameId = db.saveGame({
        whiteId,
        blackId,
        pgn,
        result,
        resultReason,
        timeControl: timeControl || 'casual',
        movesCount,
        whiteEloBefore,
        blackEloBefore,
        whiteEloChange: whiteChange,
        blackEloChange: blackChange,
        isVsBot,
        botDifficulty
    });

    return {
        gameId,
        whiteEloChange: whiteChange,
        blackEloChange: blackChange,
        whiteEloNew: whiteEloBefore + whiteChange,
        blackEloNew: blackEloBefore + blackChange
    };
}

// ═══════════════════════════════════════
// API ROUTE HANDLERS
// ═══════════════════════════════════════

/**
 * GET /api/leaderboard — top players by ELO
 */
function getLeaderboard(req, res) {
    const limit = Math.min(parseInt(req.query.limit) || 100, 200);
    const leaderboard = db.getLeaderboard(limit);
    res.json({ leaderboard });
}

/**
 * GET /api/leaderboard/:userId — specific player rank + stats
 */
function getPlayerStats(req, res) {
    const userId = parseInt(req.params.userId);
    if (isNaN(userId)) return res.status(400).json({ error: 'Invalid user ID' });

    const rank = db.getPlayerRank(userId);
    if (!rank) return res.status(404).json({ error: 'User not found' });

    const recentGames = db.getGameHistory(userId, 10);
    res.json({ player: rank, recentGames });
}

/**
 * GET /api/games/:gameId — specific game details
 */
function getGame(req, res) {
    const gameId = parseInt(req.params.gameId);
    if (isNaN(gameId)) return res.status(400).json({ error: 'Invalid game ID' });

    const game = db.getGameById(gameId);
    if (!game) return res.status(404).json({ error: 'Game not found' });

    res.json({ game });
}

/**
 * GET /api/games — game history for current user
 */
function getGameHistory(req, res) {
    if (!req.user) return res.status(401).json({ error: 'Not authenticated' });

    const limit = Math.min(parseInt(req.query.limit) || 20, 50);
    const games = db.getGameHistory(req.user.id, limit);
    res.json({ games });
}

module.exports = {
    calculateElo,
    processGameResult,
    getLeaderboard,
    getPlayerStats,
    getGame,
    getGameHistory
};
