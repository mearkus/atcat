import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createGame, applyMove, checkPlacement, computeScores, legalPlacements, rankings, viewFor, MAX_HEIGHT, HEAD_START,
} from '../shared/engine.js';
import { chooseMove } from '../shared/ai.js';

const two = () => createGame({ players: [{ name: 'A' }, { name: 'B' }], seed: 42 });

test('creates decks and hands', () => {
  const g = two();
  assert.equal(g.size, 7);
  for (const p of g.players) {
    assert.equal(p.hand.length, 3);
    assert.equal(p.deck.length, 9);
  }
  const ids = g.players.flatMap((p) => [...p.hand, ...p.deck].map((c) => c.id));
  assert.equal(new Set(ids).size, 24);
});

test('first card must cover the centre', () => {
  const g = two();
  assert.match(checkPlacement(g, 0, 0, 0), /centre/);
  assert.equal(checkPlacement(g, 3, 3, 0), null);
  assert.equal(checkPlacement(g, 2, 3, 0), null);
  assert.match(checkPlacement(g, 6, 3, 0), /Off the board/);
});

test('adjacency, flatness, no full cover, height cap', () => {
  const g = two();
  const s = g.turn;
  applyMove(g, s, { cardId: g.players[s].hand[0].id, x: 3, y: 3, rot: 0 }); // (3,3)-(4,3)
  assert.match(checkPlacement(g, 0, 0, 0), /overlap or touch/);
  assert.equal(checkPlacement(g, 3, 4, 0), null); // touching below
  assert.match(checkPlacement(g, 2, 3, 0), /flat/); // (2,3)=0, (3,3)=1
  assert.match(checkPlacement(g, 3, 3, 0), /completely cover/);
  assert.match(checkPlacement(g, 4, 3, 2), /completely cover/); // same squares reversed
  // Build a tower to the cap.
  for (let y = 0; y < 7; y++) for (let x = 0; x < 7; x++) {
    const st = g.board[y * 7 + x];
    while (st.length < MAX_HEIGHT) st.push({ p: 0, k: 'c', c: 1000 + st.length * 100 + y * 7 + x });
  }
  assert.match(checkPlacement(g, 0, 0, 0), /at most/);
});

test('scoring counts largest group and gems on top only', () => {
  const g = two();
  const put = (x, y, p, k, c) => g.board[y * 7 + x].push({ p, k, c });
  put(0, 0, 0, 'c', 1); put(1, 0, 0, 'g', 1);
  put(2, 0, 0, 'c', 2); put(3, 0, 1, 'c', 2);
  put(5, 5, 0, 'g', 3); put(6, 5, -1, 's', 3);
  put(1, 0, 1, 'c', 4); // covers gem at (1,0), splits group
  const sc = computeScores(g);
  assert.equal(sc[0].largest, 1);
  assert.equal(sc[0].gems, 1);
  assert.equal(sc[0].score, 3 + g.headStart[0]);
  assert.equal(sc[1].largest, 1);
  assert.equal(sc[1].cells, 2);
});

test('viewFor hides opponent hands', () => {
  const g = two();
  const v = viewFor(g, 0);
  assert.ok(Array.isArray(v.players[0].hand));
  assert.equal(v.players[1].hand, null);
  assert.equal(v.players[1].handCount, 3);
  assert.equal(v.players[1].deckCount, 9);
  assert.equal(v.players[1].deck, undefined);
});

for (const n of [2, 3, 4]) {
  for (const diff of ['easy', 'normal', 'hard']) {
    test(`AI-only ${n}p ${diff} game finishes with legal moves`, () => {
      const g = createGame({ players: Array.from({ length: n }, (_, i) => ({ name: `P${i}`, isAI: true })), seed: n * 7 });
      let guard = 0;
      while (!g.over) {
        const seat = g.turn;
        const before = JSON.stringify(g.board);
        const mv = chooseMove(g, seat, diff);
        assert.equal(JSON.stringify(g.board), before, 'AI search must restore the board');
        assert.ok(mv, 'AI found a move');
        applyMove(g, seat, mv);
        assert.ok(++guard < 200);
      }
      assert.equal(g.players.every((p) => p.hand.length === 0) || legalPlacements(g).length === 0, true);
      assert.equal(rankings(g).length, n);
    });
  }
}

test('stronger AI beats easy AI more often', () => {
  let hardWins = 0;
  const N = 20;
  for (let i = 0; i < N; i++) {
    const g = createGame({ players: [{ name: 'H' }, { name: 'E' }], seed: 1000 + i });
    const diffs = i % 2 ? ['normal', 'easy'] : ['hard', 'easy'];
    let r = 1;
    const rand = () => ((r = (r * 16807) % 2147483647) / 2147483647);
    while (!g.over) applyMove(g, g.turn, chooseMove(g, g.turn, diffs[g.turn], rand));
    if (rankings(g)[0].seat === 0) hardWins++;
  }
  assert.ok(hardWins >= N * 0.6, `stronger AI won ${hardWins}/${N}`);
});

test('difficulty ladder: easy beats random play, normal beats easy', () => {
  const play = (a, b, N) => {
    let aWins = 0;
    for (let i = 0; i < N; i++) {
      const g = createGame({ players: [{ name: 'X' }, { name: 'Y' }], seed: 3000 + i });
      const lineup = i % 2 ? [a, b] : [b, a];
      let r = 7 + i;
      const rand = () => ((r = (r * 16807) % 2147483647) / 2147483647);
      while (!g.over) {
        const seat = g.turn;
        const who = lineup[seat];
        let mv;
        if (who === 'random') {
          const pls = legalPlacements(g);
          mv = { cardId: g.players[seat].hand[0].id, ...pls[Math.floor(rand() * pls.length)] };
        } else mv = chooseMove(g, seat, who, rand);
        applyMove(g, seat, mv);
      }
      if (rankings(g)[0].seat === lineup.indexOf(a)) aWins++;
    }
    return aWins;
  };
  const N = 24;
  const easyVsRandom = play('easy', 'random', N);
  assert.ok(easyVsRandom >= N * 0.65, `easy beat random ${easyVsRandom}/${N}`);
  const normalVsEasy = play('normal', 'easy', N);
  assert.ok(normalVsEasy >= N * 0.55, `normal beat easy ${normalVsEasy}/${N}`);
  assert.ok(normalVsEasy < N, 'normal should not win every game against easy');
});

test('earlier turn positions get head-start points, shown in scores and views', () => {
  for (const n of [2, 3, 4]) {
    for (let seed = 1; seed <= 8; seed++) {
      const g = createGame({ players: Array.from({ length: n }, (_, i) => ({ name: `P${i}` })), seed });
      assert.equal(g.firstSeat, g.turn);
      for (let k = 0; k < n; k++) assert.equal(g.headStart[(g.firstSeat + k) % n], HEAD_START[n][k]);
      assert.equal(g.headStart[(g.firstSeat + n - 1) % n], 0, 'last to move gets no head start');
      const sc = computeScores(g);
      for (let s = 0; s < n; s++) {
        assert.equal(sc[s].headStart, g.headStart[s]);
        assert.equal(sc[s].score, g.headStart[s]); // empty board
      }
      const v = viewFor(g, 0);
      assert.deepEqual(v.headStart, g.headStart);
      assert.equal(v.firstSeat, g.firstSeat);
      assert.deepEqual(computeScores(v).map((r) => r.score), sc.map((r) => r.score));
    }
  }
});

test('games saved without head-start data still score', () => {
  const g = two();
  delete g.headStart;
  assert.ok(computeScores(g).every((r) => r.score === 0 && r.headStart === 0));
});
