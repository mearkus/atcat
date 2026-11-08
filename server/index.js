// Stratum server: serves the built client from dist/ and hosts multiplayer
// rooms over WebSocket at /ws. The server is authoritative: clients send
// moves, the server validates them with the shared engine.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { createGame, applyMove, checkMove, viewFor, MAX_PLAYERS, MIN_PLAYERS } from '../shared/engine.js';
import { chooseMove, DIFFICULTIES } from '../shared/ai.js';

const PORT = Number(process.env.PORT) || 3000;
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist');
const AI_DELAY_MS = 900;
const DISCONNECTED_TAKEOVER_MS = 30_000; // AI plays for a dropped player after this
const ROOM_IDLE_MS = 30 * 60_000;
const LOBBY_GRACE_MS = 60_000; // keep a dropped player's lobby seat this long

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.json': 'application/json',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/healthz') {
    res.writeHead(200, { 'content-type': 'text/plain' });
    return res.end('ok');
  }
  let file = path.normalize(path.join(ROOT, decodeURIComponent(url.pathname)));
  if (!file.startsWith(ROOT)) {
    res.writeHead(403);
    return res.end();
  }
  fs.stat(file, (err, st) => {
    if (err || st.isDirectory()) file = path.join(ROOT, 'index.html');
    fs.readFile(file, (err2, data) => {
      if (err2) {
        res.writeHead(404, { 'content-type': 'text/plain' });
        return res.end('Not found. Did you run `npm run build`?');
      }
      res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream' });
      res.end(data);
    });
  });
});

/** @type {Map<string, Room>} */
const rooms = new Map();

function newCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  let code;
  do {
    code = Array.from({ length: 4 }, () => alphabet[crypto.randomInt(alphabet.length)]).join('');
  } while (rooms.has(code));
  return code;
}

const cleanName = (s) => String(s || '').replace(/[^\p{L}\p{N} _.-]/gu, '').trim().slice(0, 16) || 'Player';

class Room {
  constructor(code) {
    this.code = code;
    this.seats = []; // { name, isAI, difficulty, token, ws, droppedAt }
    this.hostToken = null;
    this.game = null;
    this.timer = null;
    this.touch();
  }

  touch() {
    this.lastActive = Date.now();
  }

  seatOf(token) {
    return this.seats.findIndex((s) => !s.isAI && s.token === token);
  }

  broadcast() {
    const seats = this.seats.map((s) => ({
      name: s.name,
      isAI: s.isAI,
      difficulty: s.difficulty,
      connected: s.isAI || !!s.ws,
    }));
    this.seats.forEach((s, seat) => {
      if (!s.ws) return;
      send(s.ws, {
        t: 'room',
        code: this.code,
        seat,
        isHost: s.token === this.hostToken,
        seats,
        started: !!this.game,
        view: this.game ? viewFor(this.game, seat) : null,
      });
    });
  }

  start() {
    this.game = createGame({
      players: this.seats.map((s) => ({ name: s.name, isAI: s.isAI, difficulty: s.difficulty })),
    });
    this.broadcast();
    this.schedule();
  }

  // Let AI (or the stand-in for a dropped player) take its turn.
  schedule() {
    clearTimeout(this.timer);
    const g = this.game;
    if (!g || g.over) return;
    const seat = this.seats[g.turn];
    let delay = null;
    if (seat.isAI) delay = AI_DELAY_MS;
    else if (!seat.ws) delay = Math.max(AI_DELAY_MS, DISCONNECTED_TAKEOVER_MS - (Date.now() - (seat.droppedAt || 0)));
    if (delay === null) return;
    this.timer = setTimeout(() => {
      if (this.game !== g || g.over) return;
      const s = this.seats[g.turn];
      if (!s.isAI && s.ws) return; // player came back
      const mv = chooseMove(g, g.turn, s.isAI ? s.difficulty : 'normal');
      if (mv) applyMove(g, g.turn, mv);
      this.touch();
      this.broadcast();
      this.schedule();
    }, delay);
  }
}

function removeLobbySeat(r, s) {
  const i = r.seats.indexOf(s);
  if (i < 0) return;
  r.seats.splice(i, 1);
  if (r.hostToken === s.token) r.hostToken = r.seats.find((x) => !x.isAI)?.token ?? null;
  if (!r.seats.some((x) => !x.isAI)) {
    clearTimeout(r.timer);
    rooms.delete(r.code);
  }
  r.broadcast();
}

function send(ws, msg) {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
}

const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 16 * 1024 });

wss.on('connection', (ws) => {
  let room = null;
  let token = null;
  ws.isAlive = true;
  ws.on('pong', () => (ws.isAlive = true));

  const fail = (msg) => send(ws, { t: 'error', msg });
  const isHost = () => room && token === room.hostToken;

  function enter(r, name, wantToken) {
    // Rejoin an existing seat with a saved token.
    let seat = wantToken ? r.seatOf(wantToken) : -1;
    if (seat >= 0) {
      const s = r.seats[seat];
      if (s.ws && s.ws !== ws) s.ws.close(4000, 'Joined from another tab');
      s.ws = ws;
      s.droppedAt = null;
      token = s.token;
    } else {
      if (r.game) return fail('That game has already started');
      if (r.seats.length >= MAX_PLAYERS) return fail('That room is full');
      token = crypto.randomUUID();
      r.seats.push({ name: cleanName(name), isAI: false, difficulty: null, token, ws, droppedAt: null });
      if (!r.hostToken) r.hostToken = token;
    }
    room = r;
    r.touch();
    send(ws, { t: 'joined', code: r.code, token });
    r.broadcast();
    r.schedule();
  }

  ws.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      return fail('Bad message');
    }
    if (!msg || typeof msg !== 'object') return;
    if (room) room.touch();

    switch (msg.t) {
      case 'create': {
        if (room) return fail('Already in a room');
        const r = new Room(newCode());
        rooms.set(r.code, r);
        return enter(r, msg.name);
      }
      case 'join': {
        if (room) return fail('Already in a room');
        const r = rooms.get(String(msg.code || '').toUpperCase().trim());
        if (!r) return fail('No room with that code');
        return enter(r, msg.name, msg.token);
      }
      case 'addAI': {
        if (!isHost()) return fail('Only the host can add AI players');
        if (room.game) return fail('Game already started');
        if (room.seats.length >= MAX_PLAYERS) return fail('Room is full');
        const difficulty = DIFFICULTIES.includes(msg.difficulty) ? msg.difficulty : 'normal';
        const n = room.seats.filter((s) => s.isAI).length + 1;
        room.seats.push({ name: `Bot ${n}`, isAI: true, difficulty, token: null, ws: null });
        return room.broadcast();
      }
      case 'removeSeat': {
        if (!isHost()) return fail('Only the host can remove players');
        if (room.game) return fail('Game already started');
        const s = room.seats[msg.seat];
        if (!s || s.token === room.hostToken) return;
        room.seats.splice(msg.seat, 1);
        if (s.ws) {
          send(s.ws, { t: 'kicked' });
          s.ws.close(4001, 'Removed by host');
        }
        return room.broadcast();
      }
      case 'start':
      case 'restart': {
        if (!isHost()) return fail('Only the host can start the game');
        if (msg.t === 'start' && room.game) return fail('Game already started');
        if (msg.t === 'restart' && !(room.game && room.game.over)) return fail('Game still in progress');
        if (room.seats.length < MIN_PLAYERS) return fail(`Need at least ${MIN_PLAYERS} players`);
        return room.start();
      }
      case 'move': {
        if (!room || !room.game) return fail('No game in progress');
        const seat = room.seatOf(token);
        const err = checkMove(room.game, seat, msg.move);
        if (err) return fail(err);
        applyMove(room.game, seat, msg.move);
        room.broadcast();
        return room.schedule();
      }
      case 'leave': {
        leave(true);
        return send(ws, { t: 'left' });
      }
      default:
        return fail('Unknown message');
    }
  });

  // explicit: the player chose to leave (vs. a dropped connection).
  function leave(explicit) {
    if (!room) return;
    const r = room;
    const seat = r.seatOf(token);
    room = null;
    if (seat < 0) return;
    const s = r.seats[seat];
    if (s.ws !== ws) return; // superseded by a newer connection
    s.ws = null;
    s.droppedAt = Date.now();
    if (!r.game) {
      if (explicit) removeLobbySeat(r, s);
      else setTimeout(() => !s.ws && r.seats.includes(s) && !r.game && removeLobbySeat(r, s), LOBBY_GRACE_MS);
    } else if (explicit && !r.game.over) {
      // Hand the seat over to an AI so the others can keep playing.
      const wasHost = r.hostToken === s.token;
      s.isAI = true;
      s.difficulty = 'normal';
      s.token = null;
      if (wasHost) r.hostToken = r.seats.find((x) => !x.isAI)?.token ?? null;
      r.game.players[seat].isAI = true;
    }
    r.schedule();
    r.broadcast();
  }
  ws.on('close', () => leave(false));
});

// Keepalive and idle-room cleanup.
setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.isAlive) {
      ws.terminate();
      continue;
    }
    ws.isAlive = false;
    ws.ping();
  }
  const now = Date.now();
  for (const [code, r] of rooms) {
    const anyone = r.seats.some((s) => s.ws);
    if (!anyone && now - r.lastActive > ROOM_IDLE_MS) {
      clearTimeout(r.timer);
      rooms.delete(code);
    }
  }
}, 30_000).unref();

server.listen(PORT, () => {
  console.log(`Stratum server listening on http://localhost:${PORT}`);
});
