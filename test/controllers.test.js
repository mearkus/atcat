import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LocalController } from '../src/controllers.js';
import { legalPlacements } from '../shared/engine.js';

const tick = () => new Promise((r) => setTimeout(r, 5));

function solo(difficulty) {
  const c = new LocalController({ name: 'T', opponents: 2, difficulty, aiDelay: 0 });
  const seen = [];
  c.onUpdate = (i) => seen.push(i);
  c.onError = (m) => seen.push({ error: m });
  return { c, seen, last: () => seen.filter((s) => !s.error).at(-1) };
}

async function myTurn(c) {
  for (let i = 0; i < 50 && c.game.turn !== 0; i++) await tick();
  assert.equal(c.game.turn, 0);
}

function playOne(c) {
  const pl = legalPlacements(c.game)[0];
  c.submitMove({ cardId: c.game.players[0].hand[0].id, ...pl });
}

test('solo undo is one step: only your most recent move comes back', async () => {
  const { c, seen, last } = solo('easy');
  c.start();
  await myTurn(c);
  assert.equal(last().canUndo, false);
  playOne(c);
  await myTurn(c);
  const beforeSecond = JSON.stringify(c.game);
  playOne(c);
  assert.equal(last().canUndo, true);
  await myTurn(c); // the bots have replied
  c.undo();
  assert.equal(JSON.stringify(c.game), beforeSecond);
  assert.equal(last().canUndo, false);
  const errors = seen.filter((s) => s.error).length;
  c.undo(); // a second undo in a row does nothing
  assert.equal(JSON.stringify(c.game), beforeSecond);
  assert.equal(seen.filter((s) => s.error).length, errors + 1);
  c.destroy();
});

test('undo restores the exact game state from before your move', async () => {
  const { c } = solo('normal');
  c.start();
  await myTurn(c);
  const snapshot = JSON.stringify(c.game);
  playOne(c);
  await myTurn(c);
  c.undo();
  assert.equal(JSON.stringify(c.game), snapshot);
  c.destroy();
});

test('Hard has no undo', async () => {
  const { c, seen, last } = solo('hard');
  c.start();
  await myTurn(c);
  playOne(c);
  assert.equal(last().undo, false);
  assert.equal(last().canUndo, false);
  c.undo();
  assert.ok(seen.some((s) => s.error));
  c.destroy();
});
