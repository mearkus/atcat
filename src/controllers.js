// Game controllers share one interface so the UI doesn't care whether the game
// runs locally (solo vs AI) or on the server (online multiplayer).
//
//   controller.onUpdate = (info) => {}   info: { mode, view, seat, started, ... }
//   controller.onError  = (msg) => {}
//   controller.submitMove(move)
//   controller.destroy()
import { createGame, applyMove, checkMove, viewFor } from '../shared/engine.js';
import { chooseMove } from '../shared/ai.js';

const AI_DELAY_MS = 750;

export class LocalController {
  constructor({ name, opponents, difficulty }) {
    this.mode = 'solo';
    this.config = { name, opponents, difficulty };
    this.onUpdate = () => {};
    this.onError = () => {};
    this.timer = null;
  }

  start() {
    clearTimeout(this.timer);
    const { name, opponents, difficulty } = this.config;
    const players = [{ name: name || 'You' }];
    for (let i = 0; i < opponents; i++) players.push({ name: `Bot ${i + 1}`, isAI: true, difficulty });
    this.game = createGame({ players });
    this._emit();
  }

  _emit() {
    const g = this.game;
    this.onUpdate({
      mode: this.mode,
      started: true,
      seat: 0,
      isHost: true,
      view: viewFor(g, 0),
      seats: g.players.map((p) => ({ name: p.name, isAI: p.isAI, difficulty: p.difficulty, connected: true })),
    });
    this._schedule();
  }

  _schedule() {
    clearTimeout(this.timer);
    const g = this.game;
    if (g.over || !g.players[g.turn].isAI) return;
    this.timer = setTimeout(() => {
      const seat = g.turn;
      const mv = chooseMove(g, seat, g.players[seat].difficulty);
      if (mv) applyMove(g, seat, mv);
      this._emit();
    }, AI_DELAY_MS);
  }

  submitMove(move) {
    const err = checkMove(this.game, 0, move);
    if (err) return this.onError(err);
    applyMove(this.game, 0, move);
    this._emit();
  }

  restart() {
    this.start();
  }

  destroy() {
    clearTimeout(this.timer);
    this.onUpdate = this.onError = () => {};
  }
}

// Static hosts (e.g. GitHub Pages) can't run the game server. Builds made with
// VITE_STATIC=1 hide online play unless VITE_SERVER_URL points at a server.
const SERVER_URL = import.meta.env.VITE_SERVER_URL || '';
export const ONLINE_AVAILABLE = !!SERVER_URL || !import.meta.env.VITE_STATIC;

function serverUrl() {
  if (SERVER_URL) return SERVER_URL.replace(/^http/, 'ws').replace(/\/?$/, '/ws').replace(/\/ws\/ws$/, '/ws');
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  return `${proto}://${location.host}/ws`;
}

const tokenKey = (code) => `stratum:token:${code}`;

export class NetController {
  constructor() {
    this.mode = 'online';
    this.onUpdate = () => {};
    this.onError = () => {};
    this.onClose = () => {};
    this.queue = [];
    this.closedByUs = false;
    this.retries = 0;
  }

  _connect() {
    const ws = (this.ws = new WebSocket(serverUrl()));
    ws.onopen = () => {
      this.retries = 0;
      for (const m of this.queue.splice(0)) ws.send(JSON.stringify(m));
    };
    ws.onmessage = (ev) => this._handle(JSON.parse(ev.data));
    ws.onclose = () => {
      if (this.closedByUs) return;
      // Try to get our seat back after a dropped connection.
      if (this.code && this.retries < 6) {
        this.retries++;
        this.onError('Connection lost, reconnecting…');
        setTimeout(() => {
          if (this.closedByUs) return;
          this._connect();
          this._send({ t: 'join', code: this.code, token: sessionStorage.getItem(tokenKey(this.code)) });
        }, 500 * 2 ** this.retries);
      } else {
        this.onClose('Disconnected from server');
      }
    };
  }

  _send(msg) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
    else this.queue.push(msg);
  }

  _handle(msg) {
    switch (msg.t) {
      case 'joined':
        this.code = msg.code;
        sessionStorage.setItem(tokenKey(msg.code), msg.token);
        break;
      case 'room':
        this.onUpdate({ mode: this.mode, ...msg });
        break;
      case 'error':
        // Errors while (re)joining a room end the session; others are just shown.
        if (!this.code || /No room|already started|full/.test(msg.msg)) this.onClose(msg.msg);
        else this.onError(msg.msg);
        break;
      case 'kicked':
        this.closedByUs = true;
        this.onClose('You were removed from the room');
        break;
    }
  }

  create(name) {
    this._connect();
    this._send({ t: 'create', name });
  }

  join(code, name) {
    code = code.toUpperCase().trim();
    this._connect();
    this._send({ t: 'join', code, name, token: sessionStorage.getItem(tokenKey(code)) });
  }

  addAI(difficulty) {
    this._send({ t: 'addAI', difficulty });
  }

  removeSeat(seat) {
    this._send({ t: 'removeSeat', seat });
  }

  startGame() {
    this._send({ t: 'start' });
  }

  restart() {
    this._send({ t: 'restart' });
  }

  submitMove(move) {
    this._send({ t: 'move', move });
  }

  destroy() {
    this.closedByUs = true;
    if (this.code) sessionStorage.removeItem(tokenKey(this.code));
    try {
      if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify({ t: 'leave' }));
      this.ws?.close();
    } catch {
      /* ignore */
    }
    this.onUpdate = this.onError = this.onClose = () => {};
  }
}
