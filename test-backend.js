/**
 * Backend Verification Test Suite
 * Tests core components: SQLite DB connection, queries, auth hashing, and ELO math.
 */

const assert = require('assert');
const path = require('path');
const fs = require('fs');

// Set up clean database environment for testing
const testDbDir = path.join(__dirname, 'db');
if (!fs.existsSync(testDbDir)) {
    fs.mkdirSync(testDbDir, { recursive: true });
}
const testDbPath = path.join(testDbDir, 'chess.db');

console.log('--- STARTING BACKEND TESTS ---');

try {
    // 1. Load Modules
    console.log('[Test] Loading modules...');
    const db = require('./src/db');
    const auth = require('./src/auth');
    const leaderboard = require('./src/leaderboard');
    console.log('✓ Modules loaded successfully.');

    // 2. Database Connection
    console.log('[Test] Connecting to SQLite database...');
    const rawDb = db.getDb();
    assert.ok(rawDb, 'Database connection failed');
    console.log('✓ SQLite connected successfully.');

    // 3. Clean up existing test users if any
    console.log('[Test] Clearing existing test data...');
    rawDb.prepare('DELETE FROM sessions').run();
    rawDb.prepare('DELETE FROM games').run();
    rawDb.prepare('DELETE FROM users WHERE username LIKE "test_user_%"').run();
    console.log('✓ Stale test data cleared.');

    // 4. Test User Creation & Fetching
    console.log('[Test] Testing user registration and database helpers...');
    const testPassHash = '$2a$10$abcdefghijklmnopqrstuv'; // Mock hash
    const userId1 = db.createUser('test_user_1', 'test1@premiumchess.com', testPassHash);
    const userId2 = db.createUser('test_user_2', 'test2@premiumchess.com', testPassHash);
    assert.ok(userId1 > 0, 'Failed to create user 1');
    assert.ok(userId2 > 0, 'Failed to create user 2');

    const user1 = db.findUserById(userId1);
    assert.strictEqual(user1.username, 'test_user_1');
    assert.strictEqual(user1.email, 'test1@premiumchess.com');
    assert.strictEqual(user1.elo_rating, 1200, 'Default ELO should be 1200');
    console.log('✓ User creation and retrieval helpers work perfectly.');

    // 5. Test Password Hashing with bcryptjs
    console.log('[Test] Testing password hashing and validation (bcryptjs)...');
    const bcryptjs = require('bcryptjs');
    const rawPassword = 'SecurePassword123!';
    
    // Hash password async
    bcryptjs.hash(rawPassword, 10, (err, hash) => {
        if (err) throw err;
        assert.ok(hash.startsWith('$2a$') || hash.startsWith('$2b$'), 'Invalid bcrypt hash format');
        
        bcryptjs.compare(rawPassword, hash, (err, isValid) => {
            if (err) throw err;
            assert.strictEqual(isValid, true, 'Correct password comparison failed');
            
            bcryptjs.compare('WrongPassword', hash, (err, isInvalidValid) => {
                if (err) throw err;
                assert.strictEqual(isInvalidValid, false, 'Incorrect password accepted');
                console.log('✓ Password hashing and verification works perfectly.');
                
                // 6. Test ELO calculation
                console.log('[Test] Testing ELO calculation logic...');
                const eloResult = leaderboard.calculateElo(1200, 1200, 'white', 0, 0);
                assert.strictEqual(eloResult.whiteChange, 16, 'Expected White Elo change of +16 for equal rating K=32');
                assert.strictEqual(eloResult.blackChange, -16, 'Expected Black Elo change of -16 for equal rating K=32');
                assert.strictEqual(eloResult.whiteNew, 1216);
                assert.strictEqual(eloResult.blackNew, 1184);
                console.log('✓ ELO calculation math is 100% accurate.');

                // 7. Test game saving and retrieval
                console.log('[Test] Testing game saving and retrieval...');
                const savedGameResult = leaderboard.processGameResult({
                    whiteId: userId1,
                    blackId: userId2,
                    result: 'white',
                    resultReason: 'checkmate',
                    pgn: '[Event "Verification Test"]\n[Result "1-0"]\n1. e4 e5 2. Qh5 Nc6 3. Bc4 Nf6 4. Qxf7# 1-0',
                    movesCount: 8,
                    timeControl: '5+3',
                    isVsBot: false
                });

                assert.ok(savedGameResult.gameId > 0, 'Failed to save game result');
                
                // Check if user Elo got updated
                const updatedUser1 = db.findUserById(userId1);
                const updatedUser2 = db.findUserById(userId2);
                assert.strictEqual(updatedUser1.elo_rating, 1216, 'White ELO did not update');
                assert.strictEqual(updatedUser2.elo_rating, 1184, 'Black ELO did not update');
                assert.strictEqual(updatedUser1.wins, 1, 'White wins count did not increment');
                assert.strictEqual(updatedUser2.losses, 1, 'Black losses count did not increment');
                
                const gameObj = db.getGameById(savedGameResult.gameId);
                assert.strictEqual(gameObj.white_id, userId1);
                assert.strictEqual(gameObj.black_id, userId2);
                assert.strictEqual(gameObj.result, 'white');
                assert.strictEqual(gameObj.result_reason, 'checkmate');
                console.log('✓ Game results saved, Elo values updated, and records retrieved correctly.');

                // 8. Test Leaderboard retrieve
                console.log('[Test] Testing leaderboard ranking...');
                const leaderboardList = db.getLeaderboard(10);
                assert.ok(leaderboardList.length >= 2, 'Leaderboard should have at least 2 users');
                assert.strictEqual(leaderboardList[0].id, userId1, 'test_user_1 should be rank 1');
                console.log('✓ Leaderboard rankings are correct.');

                // Cleanup test records
                rawDb.prepare('DELETE FROM sessions').run();
                rawDb.prepare('DELETE FROM games').run();
                rawDb.prepare('DELETE FROM users WHERE username LIKE "test_user_%"').run();

                console.log('\n♔ ALL BACKEND VERIFICATION TESTS PASSED SUCCESSFULLY! ♔\n');
            });
        });
    });

} catch (err) {
    console.error('\n❌ BACKEND VERIFICATION TEST FAILED:\n', err);
    process.exit(1);
}
