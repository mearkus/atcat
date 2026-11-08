// Stratum rules engine. Pure JS, no dependencies: runs in the browser (solo
// play) and on the server (authoritative multiplayer).
//
// Rules summary
// -------------
// * Every card is a domino of two halves. A half is either your colour
//   ("c"), your colour with a gem ("g"), or neutral stone ("s").
// * On your turn, play one card from your hand (3 cards) onto the board, then
//   draw back up from your deck (12 cards).
// * The first card must cover the centre square. Every later card must
//   overlap at least one existing card or touch one orthogonally.
// * A card must lie flat: both halves must land on stacks of equal height.
// * Stacks are at most MAX_HEIGHT cards tall.
// * You may not completely cover a single card (both halves on top of the
//   two halves of the same card).
// * When no one can play, the game ends. Only the top of each stack counts:
//   score = size of your largest connected group + 2 per visible gem of yours.
//   Ties are broken by total visible squares.

export const MAX_HEIGHT = 3;
export const HAND_SIZE = 3;
export const GEM_POINTS = 2;
export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 4;
export const DIRS = [
  [1, 0],
  [0, 1],
  [-1, 0],
  [0, -1],
];
export const BOARD_SIZES = { 2: 7, 3: 8, 4: 9 };

// [first half, second half, count]
const DECK_RECIPE = [
  ['c', 'c', 5],
  ['c', 'g', 3],
  ['c', 's', 2],
  ['g', 's', 1],
  ['g', 'g', 1],
];

// Small deterministic PRNG so games are reproducible from a seed and the
// whole state stays JSON-serialisable.
export function nextRandom(state) {
  let t = (state.rng = (state.rng + 0x6d2b79f5) | 0);
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

function shuffle(state, arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(nextRandom(state) * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

export function createGame({ players, seed = (Date.now() ^ (Math.random() * 1e9)) | 0 }) {
  const n = players.length;
  if (n < MIN_PLAYERS || n > MAX_PLAYERS) {
    throw new Error(`Stratum needs ${MIN_PLAYERS}-${MAX_PLAYERS} players`);
  }
  const size = BOARD_SIZES[n];
  const state = {
    gameId: (seed >>> 0).toString(36) + '-' + Math.floor(Math.random() * 1e9).toString(36),
    size,
    board: Array.from({ length: size * size }, () => []),
    players: [],
    turn: 0,
    moveNumber: 0,
    over: false,
    lastMove: null,
    rng: seed | 0,
  };
  let nextId = 1;
  state.players = players.map((p, i) => {
    const deck = [];
    for (const [a, b, count] of DECK_RECIPE) {
      for (let k = 0; k < count; k++) deck.push({ id: nextId++, cells: [a, b] });
    }
    shuffle(state, deck);
    return {
      name: p.name || `Player ${i + 1}`,
      isAI: !!p.isAI,
      difficulty: p.difficulty || 'normal',
      hand: deck.splice(0, HAND_SIZE),
      deck,
    };
  });
  // Random starting player.
  state.turn = Math.floor(nextRandom(state) * n);
  return state;
}

export const idx = (state, x, y) => y * state.size + x;
export const inBounds = (state, x, y) => x >= 0 && y >= 0 && x < state.size && y < state.size;

export function footprint(x, y, rot) {
  const [dx, dy] = DIRS[rot & 3];
  return [
    [x, y],
    [x + dx, y + dy],
  ];
}

export function stackAt(state, x, y) {
  return state.board[idx(state, x, y)];
}

/** Returns null when the placement is legal, otherwise a human-readable reason. */
export function checkPlacement(state, x, y, rot) {
  const [[ax, ay], [bx, by]] = footprint(x, y, rot);
  if (!inBounds(state, ax, ay) || !inBounds(state, bx, by)) return 'Off the board';
  const sa = stackAt(state, ax, ay);
  const sb = stackAt(state, bx, by);
  if (sa.length !== sb.length) return 'Card must lie flat: both halves need the same height';
  if (sa.length >= MAX_HEIGHT) return `Stacks can be at most ${MAX_HEIGHT} cards tall`;

  if (state.moveNumber === 0) {
    const c = Math.floor(state.size / 2);
    if (!((ax === c && ay === c) || (bx === c && by === c))) return 'The first card must cover the centre square';
    return null;
  }

  if (sa.length > 0) {
    if (sa[sa.length - 1].c === sb[sb.length - 1].c) return 'You cannot completely cover a single card';
    return null; // overlapping
  }

  // Flat on the table: must touch an existing card.
  for (const [cx, cy] of [
    [ax, ay],
    [bx, by],
  ]) {
    for (const [dx, dy] of DIRS) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (!inBounds(state, nx, ny)) continue;
      if ((nx === ax && ny === ay) || (nx === bx && ny === by)) continue;
      if (stackAt(state, nx, ny).length > 0) return null;
    }
  }
  return 'Card must overlap or touch a card already on the board';
}

export function checkMove(state, seat, move) {
  if (state.over) return 'The game is over';
  if (state.turn !== seat) return 'It is not your turn';
  if (!move || typeof move !== 'object') return 'Invalid move';
  const { cardId, x, y, rot } = move;
  if (![x, y, rot].every(Number.isInteger) || rot < 0 || rot > 3) return 'Invalid move';
  const hand = state.players[seat].hand;
  if (!hand || !hand.some((c) => c.id === cardId)) return 'That card is not in your hand';
  return checkPlacement(state, x, y, rot);
}

/** All legal (x, y, rot) placements; independent of which card is played. */
export function legalPlacements(state) {
  const out = [];
  for (let y = 0; y < state.size; y++) {
    for (let x = 0; x < state.size; x++) {
      for (let rot = 0; rot < 4; rot++) {
        if (checkPlacement(state, x, y, rot) === null) out.push({ x, y, rot });
      }
    }
  }
  return out;
}

export function hasAnyPlacement(state) {
  for (let y = 0; y < state.size; y++) {
    for (let x = 0; x < state.size; x++) {
      // rot 0 and 1 cover every footprint (rot 2/3 are the same squares reversed).
      if (checkPlacement(state, x, y, 0) === null || checkPlacement(state, x, y, 1) === null) return true;
    }
  }
  return false;
}

/** Push a card's halves onto the board (no validation, no turn logic). */
export function placeCard(state, seat, card, x, y, rot) {
  const fp = footprint(x, y, rot);
  for (let i = 0; i < 2; i++) {
    const [cx, cy] = fp[i];
    const k = card.cells[i];
    stackAt(state, cx, cy).push({ p: k === 's' ? -1 : seat, k, c: card.id });
  }
}

export function unplaceCard(state, x, y, rot) {
  for (const [cx, cy] of footprint(x, y, rot)) stackAt(state, cx, cy).pop();
}

/** Validates and applies a move, then advances the turn. Throws on illegal moves. */
export function applyMove(state, seat, move) {
  const err = checkMove(state, seat, move);
  if (err) throw new Error(err);
  const player = state.players[seat];
  const ci = player.hand.findIndex((c) => c.id === move.cardId);
  const [card] = player.hand.splice(ci, 1);
  placeCard(state, seat, card, move.x, move.y, move.rot);
  if (player.deck.length) player.hand.push(player.deck.shift());
  state.moveNumber++;
  state.lastMove = { seat, card, x: move.x, y: move.y, rot: move.rot };
  advanceTurn(state);
  return state;
}

function advanceTurn(state) {
  const n = state.players.length;
  const canPlace = hasAnyPlacement(state);
  if (canPlace) {
    for (let i = 1; i <= n; i++) {
      const j = (state.turn + i) % n;
      if (state.players[j].hand.length > 0) {
        state.turn = j;
        return;
      }
    }
  }
  state.over = true;
  state.turn = -1;
}

/** Scores from the visible top of every stack. */
export function computeScores(state) {
  const { size, board } = state;
  const n = state.players.length;
  const top = board.map((s) => (s.length ? s[s.length - 1] : null));
  const res = Array.from({ length: n }, () => ({ largest: 0, gems: 0, cells: 0, score: 0, group: [] }));
  const seen = new Uint8Array(size * size);
  for (let i = 0; i < top.length; i++) {
    const t = top[i];
    if (!t || t.p < 0) continue;
    const r = res[t.p];
    r.cells++;
    if (t.k === 'g') r.gems++;
    if (seen[i]) continue;
    // Flood fill this group.
    const group = [];
    const q = [i];
    seen[i] = 1;
    while (q.length) {
      const cur = q.pop();
      group.push(cur);
      const cx = cur % size;
      const cy = (cur - cx) / size;
      for (const [dx, dy] of DIRS) {
        const nx = cx + dx;
        const ny = cy + dy;
        if (nx < 0 || ny < 0 || nx >= size || ny >= size) continue;
        const ni = ny * size + nx;
        if (seen[ni]) continue;
        const nt = top[ni];
        if (nt && nt.p === t.p) {
          seen[ni] = 1;
          q.push(ni);
        }
      }
    }
    if (group.length > r.largest) {
      r.largest = group.length;
      r.group = group;
    }
  }
  for (const r of res) r.score = r.largest + GEM_POINTS * r.gems;
  return res;
}

/** Seats ordered by final standing (score, then visible squares). */
export function rankings(state) {
  const scores = computeScores(state);
  return scores
    .map((s, seat) => ({ seat, ...s }))
    .sort((a, b) => b.score - a.score || b.cells - a.cells);
}

/** What a given seat is allowed to see: other players' hands and decks are hidden. */
export function viewFor(state, seat) {
  return {
    gameId: state.gameId,
    size: state.size,
    board: state.board,
    turn: state.turn,
    moveNumber: state.moveNumber,
    over: state.over,
    lastMove: state.lastMove,
    players: state.players.map((p, i) => ({
      name: p.name,
      isAI: p.isAI,
      difficulty: p.difficulty,
      hand: i === seat || state.over ? p.hand : null,
      handCount: p.hand.length,
      deckCount: p.deck ? p.deck.length : p.deckCount,
    })),
  };
}
