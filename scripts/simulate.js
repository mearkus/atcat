// Balance simulator: plays many bot-vs-bot games with the real engine and AI
// and prints win rates. Usage:
//
//   npm run sim                 # all reports, 400 games each
//   npm run sim -- 1000         # more games per report
//   npm run sim -- 400 seats    # only one report (ladder | styles | seats)
//
// Stand-in players, alongside the easy / normal / hard bots:
//   random  - any legal move (a newcomer)
//   kid     - always grows its biggest group, ignores gems and rivals
//   gems    - grabs gems first, then group size
import { createGame, applyMove, computeScores, legalPlacements, placeCard, unplaceCard, rankings } from '../shared/engine.js';
import { chooseMove } from '../shared/ai.js';

const N = Number(process.argv[2]) || 400;
const only = process.argv[3];

function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), s | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function greedy(g, seat, value, rand) {
  let best = [];
  let bestV = -Infinity;
  for (const card of g.players[seat].hand) {
    for (const pl of legalPlacements(g)) {
      placeCard(g, seat, card, pl.x, pl.y, pl.rot);
      const v = value(computeScores(g)[seat]);
      unplaceCard(g, pl.x, pl.y, pl.rot);
      if (v > bestV + 1e-9) {
        bestV = v;
        best = [{ cardId: card.id, ...pl }];
      } else if (Math.abs(v - bestV) <= 1e-9) best.push({ cardId: card.id, ...pl });
    }
  }
  return best.length ? best[Math.floor(rand() * best.length)] : null;
}

const STYLES = {
  random(g, seat, rand) {
    const pls = legalPlacements(g);
    const hand = g.players[seat].hand;
    const pl = pls[Math.floor(rand() * pls.length)];
    return { cardId: hand[Math.floor(rand() * hand.length)].id, ...pl };
  },
  kid: (g, seat, rand) => greedy(g, seat, (s) => s.largest, rand),
  gems: (g, seat, rand) => greedy(g, seat, (s) => 10 * s.gems + s.largest, rand),
};

function move(g, seat, who, rand) {
  if (STYLES[who]) return STYLES[who](g, seat, rand);
  return chooseMove(g, seat, who, rand);
}

/** Plays one game; returns each seat's share of the win (ties split). */
export function playGame(lineup, seed) {
  const rand = rng(seed * 7919 + 13);
  const g = createGame({ players: lineup.map((d, i) => ({ name: `${d}${i}`, isAI: true })), seed });
  while (!g.over) applyMove(g, g.turn, move(g, g.turn, lineup[g.turn], rand));
  const r = rankings(g);
  const tied = r.filter((x) => x.score === r[0].score && x.cells === r[0].cells);
  const share = new Array(lineup.length).fill(0);
  for (const t of tied) share[t.seat] = 1 / tied.length;
  return { share, firstSeat: g.firstSeat ?? null };
}

const pct = (x) => `${Math.round(100 * x)}%`;

function headToHead(a, b, games = N) {
  let aw = 0;
  for (let i = 0; i < games; i++) {
    // Swap seats every game so neither side gets a seating edge.
    const lineup = i % 2 ? [a, b] : [b, a];
    const { share } = playGame(lineup, 5000 + i);
    aw += share[lineup.indexOf(a)];
  }
  return aw / games;
}

// Win rate by turn position (1st to move, 2nd, ...), not by seat number.
function seats(n, who = 'normal', games = N) {
  const wins = new Array(n).fill(0);
  for (let i = 0; i < games; i++) {
    const g = createGame({ players: Array.from({ length: n }, (_, k) => ({ name: `P${k}`, isAI: true })), seed: 9000 + i });
    const first = g.turn;
    const rand = rng(i + 1);
    while (!g.over) applyMove(g, g.turn, move(g, g.turn, who, rand));
    const r = rankings(g);
    const tied = r.filter((x) => x.score === r[0].score && x.cells === r[0].cells);
    for (const t of tied) wins[(t.seat - first + n) % n] += 1 / tied.length;
  }
  return wins.map((w) => w / games);
}

if (!only || only === 'ladder') {
  console.log(`Difficulty ladder (${N} games each, seats swapped)`);
  for (const [a, b] of [['easy', 'random'], ['normal', 'easy'], ['hard', 'normal'], ['hard', 'easy']]) {
    console.log(`  ${a.padEnd(7)} beats ${b.padEnd(7)} ${pct(headToHead(a, b))}`);
  }
}
if (!only || only === 'styles') {
  console.log(`Stand-in players vs bots (${N} games each)`);
  for (const [a, b] of [['kid', 'easy'], ['kid', 'normal'], ['gems', 'easy'], ['gems', 'normal'], ['random', 'easy']]) {
    console.log(`  ${a.padEnd(7)} beats ${b.padEnd(7)} ${pct(headToHead(a, b))}`);
  }
}
if (!only || only === 'seats') {
  for (const who of ['normal', 'easy', 'kid']) {
    console.log(`Win rate by turn position, ${who} players (${N} games each)`);
    for (const n of [2, 3, 4]) console.log(`  ${n} players: ${seats(n, who).map(pct).join('  ')}   fair ${pct(1 / n)}`);
  }
}
