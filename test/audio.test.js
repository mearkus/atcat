import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Regression: an instance field named like a method (e.g. `this.step = 0`)
// silently replaces that method and breaks every caller. Node has no Web Audio,
// so check the source of the AudioEngine class directly.
test('AudioEngine fields never shadow its methods', () => {
  const src = readFileSync(new URL('../src/audio.js', import.meta.url), 'utf8');
  const body = src.slice(src.indexOf('class AudioEngine'), src.indexOf('export const audio'));
  const methods = new Set([...body.matchAll(/^ {2}(?:get |set )?([A-Za-z_]\w*)\s*\([^)]*\)\s*\{/gm)].map((m) => m[1]));
  methods.delete('constructor');
  const fields = new Set([...body.matchAll(/this\.([A-Za-z_]\w*)\s*=(?!=)/g)].map((m) => m[1]));
  const clashes = [...fields].filter((f) => methods.has(f));
  assert.ok(methods.has('step') && methods.has('place'), 'method scan found the public sound effects');
  assert.deepEqual(clashes, []);
});
