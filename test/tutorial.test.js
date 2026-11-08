import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TutorialController, TUTORIAL_STEPS } from '../src/tutorial.js';
import { legalPlacements } from '../shared/engine.js';

const tick = () => new Promise((r) => setTimeout(r, 5));

for (const strategy of ['first', 'last']) {
  test(`tutorial can be completed (${strategy} legal move each step)`, async () => {
    for (let run = 0; run < 5; run++) {
      const t = new TutorialController({ name: 'T', botDelay: 0 });
      let info = null;
      const errors = [];
      t.onUpdate = (i) => (info = i);
      t.onError = (m) => errors.push(m);
      t.start();
      const seen = new Set();
      let rejected = 0;
      for (let guard = 0; guard < 60 && !info.tutorial.finish; guard++) {
        const tut = info.tutorial;
        seen.add(tut.step);
        if (tut.waiting) {
          await tick();
          continue;
        }
        if (tut.canNext) {
          t.next();
          continue;
        }
        const hand = info.view.players[0].hand;
        assert.ok(hand.length, `step ${tut.step} gives the player cards`);
        let pls = legalPlacements(info.view);
        if (strategy === 'last') pls = pls.reverse();
        // Rotate through options with varying offsets so runs differ.
        pls = pls.slice(run % pls.length).concat(pls.slice(0, run % pls.length));
        const before = tut.step;
        let advanced = false;
        for (const c of hand) {
          for (const pl of pls) {
            const n = errors.length;
            t.submitMove({ cardId: c.id, ...pl });
            if (errors.length === n) { advanced = true; break; }
            rejected++;
          }
          if (advanced) break;
        }
        assert.ok(advanced, `found an accepted move on step ${before}`);
        await tick();
      }
      assert.equal(info.tutorial.finish, true);
      assert.equal(seen.size, TUTORIAL_STEPS - 1);
      assert.equal(info.view.over, false);
      t.destroy();
    }
  });
}

test('goal steps reject moves that miss the goal', () => {
  const t = new TutorialController({ botDelay: 0 });
  let info;
  const errors = [];
  t.onUpdate = (i) => (info = i);
  t.onError = (m) => errors.push(m);
  t.start();
  t.next();
  t.next();
  assert.equal(info.tutorial.title, 'The first card');
  t.submitMove({ cardId: info.view.players[0].hand[0].id, x: 0, y: 0, rot: 0 });
  assert.match(errors.pop(), /centre/);
  t.destroy();
});
