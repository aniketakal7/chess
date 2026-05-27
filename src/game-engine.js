/**
 * Server-side Chess Game Engine
 * Full chess logic for server-side validation — prevents cheating in online games
 * Tracks game state, validates moves, detects endgame conditions, generates SAN/PGN
 */

const FILES = 'abcdefgh';

class ChessGame {
    constructor() {
        this.reset();
    }

    reset() {
        this.board = [];
        for (let i = 0; i < 8; i++) this.board.push([null, null, null, null, null, null, null, null]);
        const back = ['R', 'N', 'B', 'Q', 'K', 'B', 'N', 'R'];
        for (let c = 0; c < 8; c++) {
            this.board[0][c] = 'b' + back[c]; this.board[1][c] = 'bP';
            this.board[6][c] = 'wP'; this.board[7][c] = 'w' + back[c];
        }
        this.turn = 'w';
        this.enPassant = null;
        this.castleRights = { w: { K: true, Q: true }, b: { K: true, Q: true } };
        this.moveLog = [];
        this.halfmoveClock = 0;
        this.fullmoveNumber = 1;
        this.positionHistory = [];
        this.gameOver = false;
        this.result = null;
        this.resultReason = null;
        this.positionHistory.push(this._boardKey());
    }

    col(p) { return p ? p[0] : null; }
    typ(p) { return p ? p[1] : null; }
    opp(c) { return c === 'w' ? 'b' : 'w'; }

    _boardKey() {
        const bs = this.board.map(r => r.map(p => p || '-').join('')).join('/');
        const cs = (this.castleRights.w.K ? 'K' : '') + (this.castleRights.w.Q ? 'Q' : '') +
                   (this.castleRights.b.K ? 'k' : '') + (this.castleRights.b.Q ? 'q' : '') || '-';
        const eps = this.enPassant ? FILES[this.enPassant.c] + (8 - this.enPassant.r) : '-';
        return bs + ' ' + this.turn + ' ' + cs + ' ' + eps;
    }

    _rawMoves(r, c, b, ep) {
        const p = b[r][c]; if (!p) return [];
        const cl = p[0], t = p[1], moves = [];
        const slide = (dr, dc) => {
            let nr = r + dr, nc = c + dc;
            while (nr >= 0 && nr < 8 && nc >= 0 && nc < 8) {
                if (b[nr][nc]) { if (b[nr][nc][0] !== cl) moves.push([nr, nc]); break; }
                moves.push([nr, nc]); nr += dr; nc += dc;
            }
        };
        if (t === 'P') {
            const dir = cl === 'w' ? -1 : 1, st = cl === 'w' ? 6 : 1;
            if (b[r + dir] && !b[r + dir][c]) moves.push([r + dir, c]);
            if (r === st && !b[r + dir][c] && !b[r + 2 * dir][c]) moves.push([r + 2 * dir, c]);
            [-1, 1].forEach(dc => {
                if (b[r + dir] && b[r + dir][c + dc] && b[r + dir][c + dc][0] !== cl) moves.push([r + dir, c + dc]);
                if (ep && ep.r === r + dir && ep.c === c + dc) moves.push([r + dir, c + dc]);
            });
        } else if (t === 'N') {
            [[-2, -1], [-2, 1], [-1, -2], [-1, 2], [1, -2], [1, 2], [2, -1], [2, 1]].forEach(d => {
                const nr = r + d[0], nc = c + d[1];
                if (nr >= 0 && nr < 8 && nc >= 0 && nc < 8 && (!b[nr][nc] || b[nr][nc][0] !== cl)) moves.push([nr, nc]);
            });
        } else if (t === 'B') {
            [[-1, -1], [-1, 1], [1, -1], [1, 1]].forEach(d => slide(d[0], d[1]));
        } else if (t === 'R') {
            [[-1, 0], [1, 0], [0, -1], [0, 1]].forEach(d => slide(d[0], d[1]));
        } else if (t === 'Q') {
            [[-1, -1], [-1, 1], [1, -1], [1, 1], [-1, 0], [1, 0], [0, -1], [0, 1]].forEach(d => slide(d[0], d[1]));
        } else if (t === 'K') {
            [[-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1]].forEach(d => {
                const nr = r + d[0], nc = c + d[1];
                if (nr >= 0 && nr < 8 && nc >= 0 && nc < 8 && (!b[nr][nc] || b[nr][nc][0] !== cl)) moves.push([nr, nc]);
            });
        }
        return moves;
    }

    _isAttacked(r, c, byCol, b, ep) {
        for (let rr = 0; rr < 8; rr++)
            for (let cc = 0; cc < 8; cc++) {
                if (b[rr][cc] && b[rr][cc][0] === byCol) {
                    const ms = this._rawMoves(rr, cc, b, ep);
                    for (let i = 0; i < ms.length; i++)
                        if (ms[i][0] === r && ms[i][1] === c) return true;
                }
            }
        return false;
    }

    _findKing(cl, b) {
        for (let r = 0; r < 8; r++)
            for (let c = 0; c < 8; c++)
                if (b[r][c] === cl + 'K') return [r, c];
        return null;
    }

    _inCheck(cl, b, ep) {
        const k = this._findKing(cl, b);
        return k ? this._isAttacked(k[0], k[1], this.opp(cl), b, ep) : false;
    }

    /**
     * Returns all legal moves for a piece at (r, c)
     */
    legalMovesFor(r, c) {
        const p = this.board[r][c];
        if (!p || p[0] !== this.turn) return [];
        const cl = p[0], t = p[1];
        const legal = this._rawMoves(r, c, this.board, this.enPassant).filter(m => {
            const nb = this.board.map(row => row.slice());
            if (t === 'P' && this.enPassant && m[0] === this.enPassant.r && m[1] === this.enPassant.c) nb[r][m[1]] = null;
            nb[m[0]][m[1]] = nb[r][c]; nb[r][c] = null;
            return !this._inCheck(cl, nb, null);
        });
        if (t === 'K') {
            const row = cl === 'w' ? 7 : 0;
            if (r === row && c === 4) {
                if (this.castleRights[cl].K && !this.board[row][5] && !this.board[row][6] && this.board[row][7] === cl + 'R' &&
                    !this._inCheck(cl, this.board, this.enPassant) &&
                    !this._isAttacked(row, 5, this.opp(cl), this.board, this.enPassant) &&
                    !this._isAttacked(row, 6, this.opp(cl), this.board, this.enPassant))
                    legal.push([row, 6]);
                if (this.castleRights[cl].Q && !this.board[row][3] && !this.board[row][2] && !this.board[row][1] && this.board[row][0] === cl + 'R' &&
                    !this._inCheck(cl, this.board, this.enPassant) &&
                    !this._isAttacked(row, 3, this.opp(cl), this.board, this.enPassant) &&
                    !this._isAttacked(row, 2, this.opp(cl), this.board, this.enPassant))
                    legal.push([row, 2]);
            }
        }
        return legal;
    }

    /**
     * Returns all legal moves for the side to move
     */
    allLegalMoves() {
        const moves = [];
        for (let r = 0; r < 8; r++)
            for (let c = 0; c < 8; c++) {
                if (this.board[r][c] && this.board[r][c][0] === this.turn) {
                    this.legalMovesFor(r, c).forEach(m => moves.push({ from: [r, c], to: m }));
                }
            }
        return moves;
    }

    /**
     * Validate and execute a move
     * @param {number} fr - from row
     * @param {number} fc - from col
     * @param {number} tr - to row
     * @param {number} tc - to col
     * @param {string|null} promo - promotion piece ('Q', 'R', 'B', 'N')
     * @returns {{ valid: boolean, san?: string, result?: object, error?: string }}
     */
    makeMove(fr, fc, tr, tc, promo) {
        if (this.gameOver) return { valid: false, error: 'Game is already over' };

        const piece = this.board[fr][fc];
        if (!piece || piece[0] !== this.turn) return { valid: false, error: 'Not your piece' };

        const legal = this.legalMovesFor(fr, fc);
        const isLegal = legal.some(m => m[0] === tr && m[1] === tc);
        if (!isLegal) return { valid: false, error: 'Illegal move' };

        const cl = piece[0], t = piece[1];
        const captured = this.board[tr][tc];
        let isCapture = !!captured;

        // Generate SAN before modifying the board
        const san = this._getSan(fr, fc, tr, tc, piece, isCapture, promo);

        // Update halfmove clock
        if (t === 'P' || captured) this.halfmoveClock = 0;
        else this.halfmoveClock++;

        // En passant capture
        const prevEP = this.enPassant;
        this.enPassant = null;
        if (t === 'P' && prevEP && tr === prevEP.r && tc === prevEP.c) {
            this.board[fr][tc] = null;
            isCapture = true;
            this.halfmoveClock = 0;
        }

        // Set new en passant target
        if (t === 'P' && Math.abs(tr - fr) === 2) {
            this.enPassant = { r: (fr + tr) / 2, c: fc };
        }

        // Castling
        let isCastle = false;
        if (t === 'K') {
            this.castleRights[cl].K = false;
            this.castleRights[cl].Q = false;
            if (tc === 6 && fc === 4) { this.board[tr][5] = cl + 'R'; this.board[tr][7] = null; isCastle = true; }
            if (tc === 2 && fc === 4) { this.board[tr][3] = cl + 'R'; this.board[tr][0] = null; isCastle = true; }
        }
        if (t === 'R') {
            if (fc === 7) this.castleRights[cl].K = false;
            if (fc === 0) this.castleRights[cl].Q = false;
        }
        // Captured rook removes opponent castling
        if (tr === 0 && tc === 7) this.castleRights.b.K = false;
        if (tr === 0 && tc === 0) this.castleRights.b.Q = false;
        if (tr === 7 && tc === 7) this.castleRights.w.K = false;
        if (tr === 7 && tc === 0) this.castleRights.w.Q = false;

        // Execute move
        this.board[tr][tc] = piece;
        this.board[fr][fc] = null;

        // Promotion
        if (t === 'P' && (tr === 0 || tr === 7)) {
            this.board[tr][tc] = cl + (promo || 'Q');
        }

        this.moveLog.push(san);
        if (this.turn === 'b') this.fullmoveNumber++;
        this.turn = this.opp(cl);
        this.positionHistory.push(this._boardKey());

        // Check endgame
        const endResult = this._checkEndgame();

        return {
            valid: true,
            san,
            isCapture,
            isCastle,
            isPromotion: t === 'P' && (tr === 0 || tr === 7),
            result: endResult
        };
    }

    _getDisambiguation(fr, fc, tr, tc, piece) {
        const t = this.typ(piece), cl = this.col(piece);
        if (t === 'P' || t === 'K') return '';
        const sameType = [];
        for (let r = 0; r < 8; r++)
            for (let c = 0; c < 8; c++) {
                if (r === fr && c === fc) continue;
                const p = this.board[r][c];
                if (p && p[0] === cl && p[1] === t) {
                    const legal = this.legalMovesFor(r, c);
                    for (let i = 0; i < legal.length; i++) {
                        if (legal[i][0] === tr && legal[i][1] === tc) { sameType.push([r, c]); break; }
                    }
                }
            }
        if (sameType.length === 0) return '';
        if (sameType.every(s => s[1] !== fc)) return FILES[fc];
        if (sameType.every(s => s[0] !== fr)) return String(8 - fr);
        return FILES[fc] + String(8 - fr);
    }

    _getSan(fr, fc, tr, tc, piece, isCap, promoType) {
        const t = this.typ(piece), cl = this.col(piece);
        if (t === 'K') {
            if (fc === 4 && tc === 6) return 'O-O';
            if (fc === 4 && tc === 2) return 'O-O-O';
        }
        let san = '';
        if (t === 'P') {
            const epCap = this.enPassant && tr === this.enPassant.r && tc === this.enPassant.c;
            if (isCap || epCap) san += FILES[fc] + 'x' + FILES[tc] + (8 - tr);
            else san += FILES[tc] + (8 - tr);
            if (promoType) san += '=' + promoType.toUpperCase();
        } else {
            san += t + this._getDisambiguation(fr, fc, tr, tc, piece);
            if (isCap) san += 'x';
            san += FILES[tc] + (8 - tr);
        }

        // Check/mate symbols by simulating the move
        const nb = this.board.map(row => row.slice());
        if (t === 'P' && this.enPassant && tr === this.enPassant.r && tc === this.enPassant.c) nb[fr][tc] = null;
        nb[tr][tc] = nb[fr][fc]; nb[fr][fc] = null;
        if (t === 'P' && (tr === 0 || tr === 7)) nb[tr][tc] = cl + (promoType || 'Q');
        if (t === 'K') {
            if (tc === 6 && fc === 4) { nb[tr][5] = cl + 'R'; nb[tr][7] = null; }
            if (tc === 2 && fc === 4) { nb[tr][3] = cl + 'R'; nb[tr][0] = null; }
        }
        const opponent = this.opp(cl);
        if (this._inCheck(opponent, nb, null)) {
            // Check if it's checkmate
            const tmpBoard = this.board;
            const tmpTurn = this.turn;
            const tmpEP = this.enPassant;
            this.board = nb;
            this.turn = opponent;
            this.enPassant = null;
            const om = this.allLegalMoves();
            this.board = tmpBoard;
            this.turn = tmpTurn;
            this.enPassant = tmpEP;
            san += om.length === 0 ? '#' : '+';
        }
        return san;
    }

    _checkEndgame() {
        const moves = this.allLegalMoves();
        // Threefold repetition
        const currentKey = this._boardKey();
        let repCount = 0;
        for (let i = 0; i < this.positionHistory.length; i++) {
            if (this.positionHistory[i] === currentKey) repCount++;
        }
        if (repCount >= 3) {
            this.gameOver = true;
            this.result = 'draw';
            this.resultReason = 'repetition';
            return { result: 'draw', reason: 'repetition' };
        }

        // 50-move rule
        if (this.halfmoveClock >= 100) {
            this.gameOver = true;
            this.result = 'draw';
            this.resultReason = '50move';
            return { result: 'draw', reason: '50move' };
        }

        if (moves.length === 0) {
            this.gameOver = true;
            if (this._inCheck(this.turn, this.board, this.enPassant)) {
                const winner = this.opp(this.turn);
                this.result = winner;
                this.resultReason = 'checkmate';
                return { result: winner, reason: 'checkmate' };
            } else {
                this.result = 'draw';
                this.resultReason = 'stalemate';
                return { result: 'draw', reason: 'stalemate' };
            }
        }

        // Insufficient material
        const pieces = this.board.flat().filter(Boolean);
        if (pieces.length === 2) {
            this.gameOver = true;
            this.result = 'draw';
            this.resultReason = 'insufficient';
            return { result: 'draw', reason: 'insufficient' };
        }

        return null; // game continues
    }

    /**
     * Force end the game (resign, timeout, etc.)
     */
    endGame(result, reason) {
        this.gameOver = true;
        this.result = result;
        this.resultReason = reason;
    }

    /**
     * Generate PGN string for this game
     */
    toPgn(whiteName, blackName, event) {
        const d = new Date();
        const ds = d.getFullYear() + '.' + String(d.getMonth() + 1).padStart(2, '0') + '.' + String(d.getDate()).padStart(2, '0');
        let pgn = '';
        pgn += `[Event "${event || 'Online Game'}"]\n`;
        pgn += `[Site "Premium Chess"]\n`;
        pgn += `[Date "${ds}"]\n`;
        pgn += `[White "${whiteName || 'White'}"]\n`;
        pgn += `[Black "${blackName || 'Black'}"]\n`;

        let res = '*';
        if (this.gameOver) {
            if (this.result === 'w') res = '1-0';
            else if (this.result === 'b') res = '0-1';
            else if (this.result === 'draw') res = '1/2-1/2';
        }
        pgn += `[Result "${res}"]\n\n`;

        const arr = [];
        for (let i = 0; i < this.moveLog.length; i += 2) {
            const n = Math.floor(i / 2) + 1;
            const w = this.moveLog[i];
            const b = this.moveLog[i + 1] || '';
            arr.push(n + '. ' + w + ' ' + b.trim());
        }
        pgn += arr.join(' ').trim() + ' ' + res;
        return pgn;
    }

    /**
     * Get FEN string for Stockfish
     */
    toFen() {
        let fen = '';
        for (let r = 0; r < 8; r++) {
            let empty = 0;
            for (let c = 0; c < 8; c++) {
                const p = this.board[r][c];
                if (!p) { empty++; continue; }
                if (empty > 0) { fen += empty; empty = 0; }
                const ch = p[1];
                fen += p[0] === 'w' ? ch.toUpperCase() : ch.toLowerCase();
            }
            if (empty > 0) fen += empty;
            if (r < 7) fen += '/';
        }
        fen += ' ' + (this.turn === 'w' ? 'w' : 'b');

        let castling = '';
        if (this.castleRights.w.K) castling += 'K';
        if (this.castleRights.w.Q) castling += 'Q';
        if (this.castleRights.b.K) castling += 'k';
        if (this.castleRights.b.Q) castling += 'q';
        fen += ' ' + (castling || '-');

        const ep = this.enPassant ? FILES[this.enPassant.c] + (8 - this.enPassant.r) : '-';
        fen += ' ' + ep;
        fen += ' ' + this.halfmoveClock;
        fen += ' ' + this.fullmoveNumber;
        return fen;
    }
}

module.exports = ChessGame;
