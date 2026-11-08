// AI opponents for Stratum. Uses only information the seat may legally see
// (its own hand plus the public board), so it never peeks at other hands.
import { computeScores, legalPlacements, placeCard, unplaceCard, DIRS } from './engine.js';

export const DIFFICULTIES = ['easy', 'normal', 'hard'];

const isSymmetric = (card) => card.cells[0] === card.cells[1];

/** Heuristic value of the current board for `seat` (higher is better). */
export function evaluate(state, seat) {
  const scores = computeScores(state);
  const mine = scores[seat];
  let bestOpp = 0;
  let oppSum = 0;
  for (let i = 0; i < scores.length; i++) {
    if (i === seat) continue;
    bestOpp = Math.max(bestOpp, scores[i].score);
    oppSum += scores[i].score;
  }
  const others = scores.length - 1;
  const oppTerm = others === 1 ? bestOpp : 0.6 * bestOpp + (0.4 * oppSum) / others;
  return mine.score - oppTerm + 0.15 * mine.cells + 0.05 * frontier(state, seat, mine.group);
}

// Open squares/low stacks next to our main group: room to grow.
function frontier(state, seat, group) {
  const { size, board } = state;
  const inGroup = new Set(group);
  let n = 0;
  for (const i of inGroup) {
    const x = i % size;
    const y = (i - x) / size;
    for (const [dx, dy] of DIRS) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= size || ny >= size) continue;
      const ni = ny * size + nx;
      if (inGroup.has(ni)) continue;
      const s = board[ni];
      if (s.length < 3 && (!s.length || s[s.length - 1].p !== seat)) n++;
    }
  }
  return n;
}

function candidateMoves(state, seat) {
  const hand = state.players[seat].hand;
  const placements = legalPlacements(state);
  const moves = [];
  for (const card of hand) {
    for (const pl of placements) {
      // rot 2/3 duplicate rot 0/1 for symmetric cards (shifted by one square).
      if (isSymmetric(card) && pl.rot >= 2) continue;
      moves.push({ card, ...pl });
    }
  }
  return moves;
}

function scoreMoves(state, seat, moves) {
  for (const m of moves) {
    placeCard(state, seat, m.card, m.x, m.y, m.rot);
    m.value = evaluate(state, seat);
    unplaceCard(state, m.x, m.y, m.rot);
  }
  return moves.sort((a, b) => b.value - a.value);
}

// Worst-case reply by the next opponent, assuming they hold a plain
// two-colour card (we cannot see their hand).
function worstReply(state, seat, opp) {
  const generic = { id: -1, cells: ['c', 'c'] };
  let worst = Infinity;
  for (const pl of legalPlacements(state)) {
    if (pl.rot >= 2) continue;
    placeCard(state, opp, generic, pl.x, pl.y, pl.rot);
    const v = evaluate(state, seat);
    unplaceCard(state, pl.x, pl.y, pl.rot);
    if (v < worst) worst = v;
  }
  return worst === Infinity ? evaluate(state, seat) : worst;
}

/**
 * Pick a move for `seat`. The state is temporarily mutated during search but
 * restored before returning. Returns { cardId, x, y, rot } or null.
 */
export function chooseMove(state, seat, difficulty = 'normal', random = Math.random) {
  const moves = candidateMoves(state, seat);
  if (!moves.length) return null;
  const pick = (m) => ({ cardId: m.card.id, x: m.x, y: m.y, rot: m.rot });

  if (difficulty === 'easy') {
    if (random() < 0.5) return pick(moves[Math.floor(random() * moves.length)]);
    scoreMoves(state, seat, moves);
    // Choose among the top half at random: plausible but sloppy.
    const pool = moves.slice(0, Math.max(1, Math.ceil(moves.length / 2)));
    return pick(pool[Math.floor(random() * pool.length)]);
  }

  scoreMoves(state, seat, moves);

  if (difficulty === 'hard' && state.players.length > 1) {
    const n = state.players.length;
    const opp = (seat + 1) % n;
    const top = moves.slice(0, 8);
    let best = top[0];
    let bestVal = -Infinity;
    for (const m of top) {
      placeCard(state, seat, m.card, m.x, m.y, m.rot);
      state.moveNumber++;
      const v = worstReply(state, seat, opp) + 0.25 * m.value;
      state.moveNumber--;
      unplaceCard(state, m.x, m.y, m.rot);
      if (v > bestVal) {
        bestVal = v;
        best = m;
      }
    }
    return pick(best);
  }

  // Normal: best move, random among near-ties for variety.
  const topVal = moves[0].value;
  const ties = moves.filter((m) => m.value >= topVal - 0.01);
  return pick(ties[Math.floor(random() * ties.length)]);
}
