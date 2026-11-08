// Interactive tutorial: a scripted game against "Tutor" that teaches one rule
// per step. Uses the same controller interface as LocalController, plus an
// `info.tutorial` object that main.js renders as a coach panel.
import {
  createGame,
  checkPlacement,
  computeScores,
  footprint,
  legalPlacements,
  placeCard,
  stackAt,
  viewFor,
} from '../shared/engine.js';

const TOUCH = typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches;
const ME = 0;
const TUTOR = 1;
const BOT_DELAY_MS = 900;

let nextCardId = 500;
const card = (a, b) => ({ id: nextCardId++, cells: [a, b] });

const cellsOf = (state, m) => footprint(m.x, m.y, m.rot).map(([x, y]) => stackAt(state, x, y));
const topOwner = (stack) => (stack.length ? stack[stack.length - 1].p : null);
const tutorTops = (state) =>
  state.board.flatMap((s, i) => (topOwner(s) === TUTOR ? [i] : []));

// Each step: title, text (HTML), and either `next: true` (read and continue)
// or an action: `hand` (cards to play), `goal(before, after, move)` and `goalHint`.
// `bot` makes Tutor answer after the step. `cells`/`ui` drive highlights.
const STEPS = [
  {
    title: 'Welcome to Stratum',
    text:
      'Players take turns laying <b>domino cards</b> on a shared board, stacking them to build territory and bury each other. ' +
      'In this tutorial you play coral against <b>Tutor</b> (teal). It takes about two minutes.',
    next: true,
  },
  {
    title: 'Your hand',
    text:
      'Each card has two halves. A half is either <b>your colour</b>, your colour with a <b>gem</b> ◆, or neutral <b>stone</b>. ' +
      'In a real game you hold 3 cards and draw after every turn.',
    hand: () => [card('c', 'c'), card('c', 'g'), card('c', 's')],
    ui: '#hand',
    next: true,
  },
  {
    title: 'The first card',
    text:
      'The first card must cover the <b>centre square</b> (highlighted). ' +
      (TOUCH
        ? 'Tap a square to preview the card, then tap <b>Place</b>.'
        : 'Move over the board to preview the card, then click to place it.'),
    hand: () => [card('c', 'c')],
    cells: (s) => [Math.floor(s.size / 2) * s.size + Math.floor(s.size / 2)],
    goal: () => true,
    bot: 'touch',
  },
  {
    title: 'Touch the board',
    text:
      'Every later card must <b>touch</b> or <b>overlap</b> a card on the board. Place this one flat on empty squares, next to a card. ' +
      (TOUCH ? 'Use <b>⟳ Rotate</b> to turn it.' : 'Press <b>R</b> or use <b>⟳ Rotate</b> to turn it.'),
    hand: () => [card('c', 'g')],
    ui: '#btn-rotate',
    goal: (before, after, m) => cellsOf(before, m).every((s) => s.length === 0),
    goalHint: 'For this step, place the card flat on empty squares, touching a card.',
    bot: 'touch',
  },
  {
    title: 'Bury a rival',
    text:
      'Only the top of a stack counts. Cover a highlighted Tutor half to <b>bury</b> it. ' +
      'Both halves must land at the <b>same height</b>. If the preview is red, the hint below says why.',
    hand: () => [card('c', 'c')],
    cells: tutorTops,
    goal: (before, after, m) => cellsOf(before, m).some((s) => topOwner(s) === TUTOR),
    goalHint: 'Cover at least one of Tutor\'s teal halves.',
    bot: 'touch',
  },
  {
    title: 'Stone',
    text:
      'Stone belongs to <b>nobody</b>. Use it to split a rival\'s group or block squares they want. ' +
      'Try it on or next to Tutor\'s cards.',
    hand: () => [card('c', 's')],
    goal: () => true,
    bot: 'touch',
  },
  {
    title: 'Grow your group',
    text:
      'You score <b>1 point per square in your largest connected group</b> plus <b>2 per visible gem</b>. ' +
      'Pick a card that makes your largest group bigger.',
    hand: () => [card('c', 'c'), card('g', 'c'), card('c', 's')],
    ui: '#hand',
    goal: (before, after) => computeScores(after)[ME].largest > computeScores(before)[ME].largest,
    goalHint: 'That move doesn\'t make your largest group bigger. Try connecting to your coral squares.',
  },
  {
    title: 'Scoring and the end',
    text:
      'The scoreboard keeps the live score. ' +
      (TOUCH ? '' : '<b>Hover a player</b> to highlight their largest group. ') +
      'Two more rules: stacks are at most <b>3</b> cards tall, and you can\'t <b>completely cover</b> a single card. ' +
      'When nobody can play, the highest score wins.',
    ui: '#scoreboard',
    next: true,
  },
  {
    title: 'You\'re ready!',
    text: 'That\'s everything. Start a real game against an AI, or invite friends online from the menu.',
    finish: true,
  },
];

export class TutorialController {
  constructor({ name, botDelay = BOT_DELAY_MS } = {}) {
    this.mode = 'tutorial';
    this.botDelay = botDelay;
    this.name = name || 'You';
    this.onUpdate = () => {};
    this.onError = () => {};
    this.timer = null;
  }

  start() {
    clearTimeout(this.timer);
    this.game = createGame({ players: [{ name: this.name }, { name: 'Tutor', isAI: true }], seed: 7 });
    for (const p of this.game.players) {
      p.hand = [];
      p.deck = [];
    }
    this.game.turn = ME;
    this.step = -1;
    this.busy = false;
    this._goto(0);
  }

  get current() {
    return STEPS[this.step];
  }

  _goto(i) {
    this.step = i;
    const st = this.current;
    const me = this.game.players[ME];
    me.hand = st.hand ? st.hand() : [];
    this.goal = st.goal;
    // If the board makes this step's goal impossible, accept any legal move.
    if (st.goal && !this._goalReachable()) this.goal = () => true;
    this.game.turn = ME;
    this._emit();
  }

  _goalReachable() {
    const g = this.game;
    const placements = legalPlacements(g);
    for (const c of g.players[ME].hand) {
      for (const pl of placements) {
        const after = this._simulate(c, pl);
        if (this.current.goal(g, after, pl)) return true;
      }
    }
    return false;
  }

  _simulate(c, m) {
    const after = structuredClone(this.game);
    placeCard(after, ME, c, m.x, m.y, m.rot);
    after.moveNumber++;
    return after;
  }

  _emit() {
    const g = this.game;
    const st = this.current;
    const view = viewFor(g, ME);
    this.onUpdate({
      mode: this.mode,
      started: true,
      seat: ME,
      isHost: true,
      view,
      seats: g.players.map((p) => ({ name: p.name, isAI: p.isAI, difficulty: 'normal', connected: true })),
      tutorial: {
        step: this.step + 1,
        total: STEPS.length,
        title: st.title,
        text: st.text,
        canNext: !!st.next && !this.busy,
        finish: !!st.finish,
        ui: this.busy ? null : st.ui || null,
        cells: !this.busy && st.cells ? st.cells(g) : null,
        waiting: this.busy,
      },
    });
  }

  next() {
    if (this.current.next && !this.busy) this._goto(this.step + 1);
  }

  submitMove(move) {
    const g = this.game;
    if (this.busy || this.current.next || this.current.finish) return this.onError('Read the tip, then press Next');
    const c = g.players[ME].hand.find((h) => h.id === move.cardId);
    if (!c) return this.onError('That card is not in your hand');
    const err = checkPlacement(g, move.x, move.y, move.rot);
    if (err) return this.onError(err);
    const after = this._simulate(c, move);
    if (!this.goal(g, after, move)) return this.onError(this.current.goalHint || 'Try another spot');

    this._place(ME, c, move);
    g.players[ME].hand = g.players[ME].hand.filter((h) => h !== c);
    const st = this.current;
    if (!st.bot) return this._goto(this.step + 1);

    this.busy = true;
    g.turn = TUTOR;
    this._emit();
    this.timer = setTimeout(() => {
      this._botMove();
      this.busy = false;
      this._goto(this.step + 1);
    }, this.botDelay);
  }

  _place(seat, c, m) {
    const g = this.game;
    placeCard(g, seat, c, m.x, m.y, m.rot);
    g.moveNumber++;
    g.lastMove = { seat, card: c, x: m.x, y: m.y, rot: m.rot };
  }

  // Tutor lays a plain card flat on the table, touching the board, preferring
  // spots next to the player's squares so there's something to bury next step.
  _botMove() {
    const g = this.game;
    const c = card('c', 'c');
    const placements = legalPlacements(g).filter((pl) => cellsOf(g, pl).every((s) => s.length === 0));
    let best = null;
    let bestScore = -Infinity;
    for (const pl of placements) {
      let score = 0;
      for (const [x, y] of footprint(pl.x, pl.y, pl.rot)) {
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= g.size || ny >= g.size) continue;
          const o = topOwner(stackAt(g, nx, ny));
          if (o === ME) score += 2;
          else if (o === TUTOR) score -= 1;
        }
      }
      // Stay near the middle so the board doesn't sprawl.
      const mid = (g.size - 1) / 2;
      score -= 0.1 * (Math.abs(pl.x - mid) + Math.abs(pl.y - mid));
      if (score > bestScore) {
        bestScore = score;
        best = pl;
      }
    }
    if (!best) {
      const any = legalPlacements(g);
      if (!any.length) return;
      best = any[0];
    }
    this._place(TUTOR, c, best);
  }

  restart() {
    this.start();
  }

  destroy() {
    clearTimeout(this.timer);
    this.onUpdate = this.onError = () => {};
  }
}

export const TUTORIAL_STEPS = STEPS.length;
