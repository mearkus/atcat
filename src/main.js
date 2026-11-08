import './style.css';
import { BoardScene } from './scene.js';
import { LocalController, NetController, ONLINE_AVAILABLE } from './controllers.js';
import { TutorialController } from './tutorial.js';
import { checkPlacement, computeScores, rankings } from '../shared/engine.js';
import { PLAYER_COLORS, cardCanvas, symbolSwatch } from './art.js';
import { playPlace, playTurn, playEnd } from './sound.js';

const $ = (id) => document.getElementById(id);
const el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
};

const app = {
  controller: null,
  info: null,
  scene: null,
  selectedId: null,
  rot: 0,
  hover: null,
  touchPreview: null,
  shownGameOver: null,
  lastTurnKey: '',
};

// ---------- screens ----------
function showScreen(name) {
  $('menu').classList.toggle('hidden', name !== 'menu');
  $('lobby').classList.toggle('hidden', name !== 'lobby');
  $('hud').classList.toggle('hidden', name !== 'game');
  if (name !== 'game') $('gameover').classList.add('hidden');
}

let toastTimer;
function toast(msg, kind = 'error') {
  const t = $('toast');
  t.textContent = msg;
  t.className = kind === 'info' ? 'info' : '';
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.add('hidden'), 2600);
}

function ensureScene() {
  if (app.scene) return app.scene;
  app.scene = new BoardScene($('stage'), {
    onHover: (c) => {
      app.hover = c;
      updateGhost();
    },
    onClick: (c, pointerType) => onBoardClick(c, pointerType),
    onRotate: (d) => rotate(d),
  });
  app.scene.onLand = playPlace;
  return app.scene;
}

function playerName() {
  const n = $('name').value.trim() || 'Player';
  localStorage.setItem('stratum:name', n);
  return n;
}

function useController(c) {
  app.controller?.destroy();
  app.controller = c;
  app.info = null;
  app.selectedId = null;
  app.shownGameOver = null;
  c.onUpdate = onUpdate;
  c.onError = (m) => toast(m);
  c.onClose = (m) => {
    toast(m);
    leaveToMenu();
  };
}

function leaveToMenu() {
  app.controller?.destroy();
  app.controller = null;
  app.info = null;
  app.scene?.clearGhost();
  app.scene?.highlightCells(null);
  renderCoach(null);
  history.replaceState(null, '', location.pathname);
  showScreen('menu');
}

// ---------- menu actions ----------
$('name').value = localStorage.getItem('stratum:name') || '';

function startSolo(opponents, difficulty) {
  const c = new LocalController({ name: playerName(), opponents, difficulty });
  useController(c);
  c.start();
}

$('btn-solo').onclick = () => startSolo(Number($('solo-opponents').value), $('solo-difficulty').value);

function startTutorial() {
  const c = new TutorialController({ name: playerName() });
  useController(c);
  c.start();
}

$('btn-tutorial').onclick = startTutorial;
if (localStorage.getItem('stratum:tutorialDone')) $('btn-tutorial').innerHTML = '<b>Replay the tutorial</b> →';
$('coach-next').onclick = () => app.controller?.next?.();
$('coach-skip').onclick = () => {
  localStorage.setItem('stratum:tutorialDone', '1');
  leaveToMenu();
};
$('coach-play').onclick = () => {
  localStorage.setItem('stratum:tutorialDone', '1');
  startSolo(1, 'easy');
};
$('coach-menu').onclick = () => {
  localStorage.setItem('stratum:tutorialDone', '1');
  leaveToMenu();
};

$('btn-create').onclick = () => {
  const c = new NetController();
  useController(c);
  c.create(playerName());
};

function joinCode(code) {
  if (!/^[A-Za-z]{4}$/.test(code.trim())) return toast('Enter a 4-letter room code');
  const c = new NetController();
  useController(c);
  c.join(code, playerName());
}

$('btn-join').onclick = () => joinCode($('join-code').value);
$('join-code').addEventListener('keydown', (e) => e.key === 'Enter' && joinCode($('join-code').value));

$('btn-rules').onclick = $('btn-help').onclick = () => $('rules').classList.remove('hidden');
$('btn-rules-close').onclick = () => $('rules').classList.add('hidden');
$('rules').onclick = (e) => e.target === $('rules') && $('rules').classList.add('hidden');

$('btn-menu').onclick = () => {
  const inProgress = app.info?.view && !app.info.view.over;
  const msg = app.controller?.mode === 'online' ? 'Leave this game? An AI will take your seat.' : 'Quit this game?';
  if (!inProgress || confirm(msg)) leaveToMenu();
};
$('btn-camera').onclick = () => app.scene?.resetCamera();
$('btn-leave-lobby').onclick = leaveToMenu;
$('btn-go-menu').onclick = leaveToMenu;
$('btn-again').onclick = () => {
  $('gameover').classList.add('hidden');
  app.controller?.restart();
};
$('btn-add-ai').onclick = () => app.controller?.addAI($('lobby-ai-diff').value);
$('btn-start').onclick = () => app.controller?.startGame();
$('btn-copy').onclick = async () => {
  const url = `${location.origin}${location.pathname}?room=${app.info.code}`;
  try {
    await navigator.clipboard.writeText(url);
    toast('Invite link copied', 'info');
  } catch {
    prompt('Copy this link:', url);
  }
};

// ---------- tutorial coach panel ----------
function setCoachCollapsed(on) {
  $('coach').classList.toggle('collapsed', on);
  $('coach-collapse').textContent = on ? '▸' : '▾';
  $('coach-collapse').setAttribute('aria-expanded', String(!on));
  $('coach-collapse').title = on ? 'Expand' : 'Collapse';
}
$('coach-collapse').onclick = () => setCoachCollapsed(!$('coach').classList.contains('collapsed'));

function renderCoach(t) {
  document.querySelectorAll('.coach-glow').forEach((e) => e.classList.remove('coach-glow'));
  app.coachCells = t?.cells || null;
  document.body.classList.toggle('in-tutorial', !!t);
  document.body.classList.toggle('tut-show-sb', t?.ui === '#scoreboard');
  $('coach').classList.toggle('hidden', !t);
  if (!t) return;
  $('coach-step').textContent = `Step ${t.step} of ${t.total}`;
  if (app.coachStep !== t.step) {
    setCoachCollapsed(false); // reopen on each new step
    clearTimeout(toastTimer);
    $('toast').classList.add('hidden'); // drop leftover errors from the previous step
  }
  app.coachStep = t.step;
  $('coach-title').textContent = t.title;
  $('coach-text').innerHTML = t.text; // static strings from tutorial.js
  $('coach-progress').style.width = `${(100 * t.step) / t.total}%`;
  $('coach-next').classList.toggle('hidden', !t.canNext);
  $('coach-wait').classList.toggle('hidden', !t.waiting);
  $('coach-finish').classList.toggle('hidden', !t.finish);
  $('coach-skip').classList.toggle('hidden', t.finish);
  if (t.ui) document.querySelector(t.ui)?.classList.add('coach-glow');
  app.scene.highlightCells(t.cells, '#ffffff');
}

// ---------- updates ----------
function onUpdate(info) {
  app.info = info;
  if (info.mode === 'online' && info.code) history.replaceState(null, '', `?room=${info.code}`);
  if (!info.started) return renderLobby(info);
  showScreen('game');
  const view = info.view;
  ensureScene().setState(view);
  const hand = view.players[info.seat]?.hand || [];
  if (!hand.some((c) => c.id === app.selectedId)) app.selectedId = hand[0]?.id ?? null;
  app.touchPreview = null;
  renderHUD();
  renderCoach(info.tutorial);
  updateGhost();

  const turnKey = `${view.gameId}:${view.moveNumber}`;
  if (turnKey !== app.lastTurnKey) {
    app.lastTurnKey = turnKey;
    if (view.turn === info.seat && !view.over && view.moveNumber > 0) playTurn();
  }
  if (view.over && app.shownGameOver !== view.gameId) {
    app.shownGameOver = view.gameId;
    setTimeout(() => showGameOver(), 700);
  }
  if (!view.over) $('gameover').classList.add('hidden');
}

function renderLobby(info) {
  showScreen('lobby');
  $('lobby-code').textContent = info.code;
  const ul = $('lobby-seats');
  ul.innerHTML = '';
  info.seats.forEach((s, i) => {
    const li = el('li');
    li.append(symbolSwatch(i));
    li.append(el('span', 'name', s.name + (i === info.seat ? ' (you)' : '')));
    if (s.isAI) li.append(el('span', 'badge', `AI · ${s.difficulty}`));
    else if (!s.connected) li.append(el('span', 'badge', 'offline'));
    if (info.isHost && i !== info.seat) {
      const b = el('button', '', '✕');
      b.title = 'Remove';
      b.onclick = () => app.controller.removeSeat(i);
      li.append(b);
    }
    ul.append(li);
  });
  for (let i = info.seats.length; i < 4; i++) {
    const li = el('li');
    li.append(el('span', 'name muted', 'Open seat'));
    ul.append(li);
  }
  $('lobby-host').classList.toggle('hidden', !info.isHost);
  $('lobby-wait').classList.toggle('hidden', info.isHost);
  $('btn-add-ai').disabled = info.seats.length >= 4;
  $('btn-start').disabled = info.seats.length < 2;
  $('btn-start').textContent = info.seats.length < 2 ? 'Need 2+ players' : `Start game (${info.seats.length} players)`;
}

const TOUCH = window.matchMedia('(pointer: coarse)').matches;
const isMyTurn = () => app.info && !app.info.view.over && app.info.view.turn === app.info.seat;

function renderHUD() {
  const { view, seat, seats } = app.info;
  const scores = computeScores(view);

  // Scoreboard
  const sb = $('scoreboard');
  sb.innerHTML = '';
  view.players.forEach((p, i) => {
    const row = el('div', 'sb-row');
    if (view.turn === i) row.classList.add('active');
    if (seats && seats[i] && !seats[i].connected) row.classList.add('offline');
    row.style.borderLeftColor = view.turn === i ? PLAYER_COLORS[i] : 'transparent';
    row.append(symbolSwatch(i));
    const name = p.name + (i === seat ? ' (you)' : '') + (p.isAI ? ' 🤖' : '');
    row.append(el('span', 'sb-name', name));
    row.append(el('span', 'sb-score', String(scores[i].score)));
    row.append(
      el('span', 'sb-meta', `group ${scores[i].largest} · gems ${scores[i].gems} · cards ${p.handCount + p.deckCount}`),
    );
    row.onmouseenter = () => app.scene.highlightCells(scores[i].group, PLAYER_COLORS[i]);
    row.onmouseleave = () => app.scene.highlightCells(app.coachCells, '#ffffff');
    sb.append(row);
  });

  // Turn banner
  const banner = $('turn-banner');
  banner.classList.toggle('mine', isMyTurn());
  if (app.info.mode === 'tutorial') banner.textContent = view.turn === seat ? 'Tutorial' : 'Tutor is playing…';
  else if (view.over) banner.textContent = 'Game over';
  else if (isMyTurn()) banner.textContent = 'Your turn';
  else {
    const p = view.players[view.turn];
    const offline = seats && seats[view.turn] && !seats[view.turn].connected;
    banner.textContent = p.isAI ? `${p.name} is thinking…` : offline ? `Waiting for ${p.name} (offline)…` : `${p.name}'s turn`;
  }
  banner.style.setProperty('--turn-color', PLAYER_COLORS[view.turn] || '#fff');

  renderHand();
}

function renderHand() {
  const { view, seat } = app.info;
  const handEl = $('hand');
  handEl.innerHTML = '';
  const hand = view.players[seat]?.hand || [];
  hand.forEach((card, i) => {
    const d = el('div', 'hand-card');
    if (card.id === app.selectedId) d.classList.add('selected');
    if (!isMyTurn()) d.classList.add('disabled');
    d.append(cardCanvas(card, seat, window.innerWidth < 500 ? 38 : 50));
    d.append(el('span', 'key', String(i + 1)));
    d.onclick = () => selectCard(card.id);
    handEl.append(d);
  });
  $('hand-actions').classList.toggle('hidden', !hand.length || view.over);
  if (view.over) $('hint').textContent = '';
  else if (!hand.length) $('hint').textContent = 'Out of cards. Watch the others finish.';
}

function selectCard(id) {
  app.selectedId = id;
  renderHand();
  updateGhost();
}

function rotate(d = 1) {
  app.rot = (app.rot + d + 4) % 4;
  updateGhost();
}

function selectedCard() {
  const hand = app.info?.view.players[app.info.seat]?.hand || [];
  return hand.find((c) => c.id === app.selectedId) || null;
}

function updateGhost() {
  if (!app.scene || !app.info?.started) return;
  const view = app.info.view;
  const card = selectedCard();
  const cell = app.touchPreview || app.hover;
  const hint = $('hint');
  $('btn-confirm').classList.add('hidden');
  if (app.info.tutorial && (app.info.tutorial.canNext || app.info.tutorial.finish || app.info.tutorial.waiting)) {
    // Reading step: no placing, so no preview or placement hints.
    app.scene.clearGhost();
    hint.textContent = '';
    return;
  }
  if (!card || !cell || view.over) {
    app.scene.clearGhost();
    if (!view.over && card) {
      hint.textContent = isMyTurn()
        ? view.moveNumber === 0
          ? 'Place the first card over the centre square'
          : TOUCH
            ? 'Pick a card, then tap a square to preview it'
            : 'Pick a card, aim at the board, click to place'
        : '';
    }
    return;
  }
  const err = checkPlacement(view, cell.x, cell.y, app.rot);
  app.scene.setGhost(card, app.info.seat, cell.x, cell.y, app.rot, !err && isMyTurn());
  hint.textContent = !isMyTurn() ? 'Not your turn yet' : err || 'Click to place · R to rotate';
  if (app.touchPreview && !err && isMyTurn()) {
    $('btn-confirm').classList.remove('hidden');
    hint.textContent = 'Tap Place to confirm, or tap elsewhere';
  }
}

function tryPlace(cell) {
  const card = selectedCard();
  if (!card || !cell) return;
  if (!isMyTurn()) return toast('Wait for your turn');
  const err = checkPlacement(app.info.view, cell.x, cell.y, app.rot);
  if (err) return toast(err);
  app.touchPreview = null;
  app.scene.clearGhost();
  app.controller.submitMove({ cardId: card.id, x: cell.x, y: cell.y, rot: app.rot });
}

function onBoardClick(cell, pointerType) {
  if (!app.info?.started || !cell) return;
  if (pointerType === 'touch' || pointerType === 'pen') {
    // Touch: first tap previews, tapping the same square again (or "Place") confirms.
    const tp = app.touchPreview;
    if (tp && tp.x === cell.x && tp.y === cell.y) return tryPlace(cell);
    app.touchPreview = cell;
    return updateGhost();
  }
  tryPlace(cell);
}

$('btn-rotate').onclick = () => rotate(1);
$('btn-confirm').onclick = () => tryPlace(app.touchPreview);

window.addEventListener('keydown', (e) => {
  if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
  if (!app.info?.started) return;
  if (e.key === 'r' || e.key === 'R') rotate(e.shiftKey ? -1 : 1);
  else if (e.key === 'Escape') {
    $('rules').classList.add('hidden');
    app.touchPreview = null;
    updateGhost();
  } else if (/^[1-3]$/.test(e.key)) {
    const hand = app.info.view.players[app.info.seat]?.hand || [];
    const c = hand[Number(e.key) - 1];
    if (c) selectCard(c.id);
  }
});

function showGameOver() {
  const { view, seat, isHost, mode } = app.info;
  if (!view.over) return;
  const ranks = rankings(view);
  const won = ranks[0].seat === seat;
  const tie = ranks.length > 1 && ranks[0].score === ranks[1].score && ranks[0].cells === ranks[1].cells;
  $('go-title').textContent = tie ? "It's a tie!" : won ? 'You win! 🎉' : `${view.players[ranks[0].seat].name} wins`;
  const t = $('go-table');
  t.innerHTML = '<tr><th>#</th><th>Player</th><th>Group</th><th>Gems</th><th>Score</th></tr>';
  ranks.forEach((r, i) => {
    const tr = el('tr', i === 0 ? 'winner' : '');
    tr.innerHTML = `<td>${i + 1}</td><td></td><td>${r.largest}</td><td>${r.gems} ×2</td><td class="total">${r.score}</td>`;
    const nameCell = tr.children[1];
    nameCell.append(symbolSwatch(r.seat, 14), ' ', view.players[r.seat].name + (r.seat === seat ? ' (you)' : ''));
    t.append(tr);
  });
  const canRestart = mode === 'solo' || isHost;
  $('btn-again').classList.toggle('hidden', !canRestart);
  $('go-wait').classList.toggle('hidden', canRestart);
  $('gameover').classList.remove('hidden');
  playEnd(won);
}

// ---------- boot ----------
showScreen('menu');
$('online-block').classList.toggle('hidden', !ONLINE_AVAILABLE);
$('online-off').classList.toggle('hidden', ONLINE_AVAILABLE);
const roomParam = ONLINE_AVAILABLE && new URLSearchParams(location.search).get('room');
if (roomParam) {
  $('join-code').value = roomParam.toUpperCase();
  if (localStorage.getItem('stratum:name')) joinCode(roomParam);
}
// Show an empty board behind the menu as a backdrop.
ensureScene().buildBoard(7);
