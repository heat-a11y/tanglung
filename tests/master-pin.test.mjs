/* The master PIN gate.
   This exists because of a real bug: commit e674794 replaced the async
   crypto.subtle helper sha256Hex() with the sync sha256HexSync() for the
   fairness code and left promptBecomeHost() calling the function that no
   longer existed. The ReferenceError was caught by the surrounding try/catch
   and reported as "wrong PIN", so no password could open master view and the
   failure looked like an operator error rather than a bug. Every test here is
   about keeping that call site honest. */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createApp } from './_harness.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const HTML = readFileSync(join(HERE, '..', 'index.html'), 'utf8');

const PIN_HASH = (HTML.match(/HOST_PIN_HASH\s*=\s*"([a-f0-9]+)"/) || [])[1];

/* Comments in this file explain the failure this test guards against, and they
   name the API that must not come back. Matching against the source with the
   comments stripped keeps the assertion about code rather than prose. */
const CODE = HTML
  .replace(/<!--[\s\S]*?-->/g, '')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^[ \t]*\/\/.*$/gm, '');

const close = (h) => { try { h.window.close(); } catch (e) { /* already gone */ } };

/* The gate as a live function, so a test can drive it with a real answer
   instead of re-implementing the hash. `master: false` is the point: the
   harness pre-authenticates a master host, which would make every assertion
   here vacuous. */
function gateWith(pin) {
  const host = createApp({ master: false });
  host.window.prompt = () => pin;
  return host;
}

test('master auth', async (t) => {
  await t.test('the PIN is stored as a hash, never in the clear', () => {
    assert.ok(PIN_HASH, 'HOST_PIN_HASH is missing');
    assert.match(PIN_HASH, /^[a-f0-9]{64}$/, 'the hash must be 64 hex characters');
    assert.doesNotMatch(
      CODE,
      /(?:pin|pass(?:word)?)\s*[:=]\s*["']\d{4,8}["']/i,
      'a PIN is hardcoded rather than hashed'
    );
  });

  await t.test('the hash check calls a helper that is actually defined', () => {
    // The exact failure that shipped: a call to a name with no definition.
    const called = (CODE.match(/sha256Hex\s*\(/g) || []).length;
    const defined = (CODE.match(/function\s+sha256Hex\s*\(/g) || []).length;
    assert.equal(called, defined,
      'promptBecomeHost calls a sha256Hex helper that is not defined in the file');
  });

  await t.test('it does not require a secure context', () => {
    // A laptop reaching a projector over plain http on a LAN has no
    // crypto.subtle. A gate that only works in a secure context fails exactly
    // where this app is used.
    const block = CODE.slice(CODE.indexOf('async function promptBecomeHost'));
    assert.doesNotMatch(block, /crypto\.subtle/,
      'the master gate must not depend on crypto.subtle');
  });

  await t.test('the correct PIN actually opens the gate', async () => {
    // The bug this file exists for was invisible to every other test: a wrong
    // PIN was refused, which looks exactly right, while the correct PIN was
    // refused too. Asserting only the refusal would have kept passing.
    //
    // sha256HexSync is a function declaration, so it lands on the window and
    // can be replaced. Stubbing it to return the shipped hash stands in for
    // "the operator typed the right PIN" without the test needing to know it.
    // The stub also proves the gate is calling the sync helper, since a
    // ReferenceError on a different name would never reach the grant.
    const host = gateWith('the-right-pin');
    try {
      const w = host.window;
      const realHash = w.sha256HexSync;
      w.localStorage.removeItem('tanglung_master_auth');
      w.sha256HexSync = () => PIN_HASH;

      w.promptBecomeHost();
      await Promise.resolve();

      assert.equal(
        w.localStorage.getItem('tanglung_master_auth'), '1',
        'the correct PIN did not grant master access'
      );
      w.sha256HexSync = realHash;
    } finally { close(host); }
  });

  await t.test('a wrong PIN is refused', async () => {
    const host = gateWith('definitely-not-the-pin');
    try {
      const w = host.window;
      w.localStorage.removeItem('tanglung_master_auth');
      w.promptBecomeHost();
      await Promise.resolve();
      assert.notEqual(
        w.localStorage.getItem('tanglung_master_auth'), '1',
        'a wrong PIN granted master access'
      );
    } finally { close(host); }
  });

  await t.test('a cancelled prompt is refused without touching storage', async () => {
    // An empty prompt is how an operator backs out, and it must behave exactly
    // like a wrong PIN rather than falling through to a grant.
    for (const answer of [null, '', undefined]) {
      const host = gateWith(answer);
      try {
        const w = host.window;
        w.localStorage.removeItem('tanglung_master_auth');
        w.promptBecomeHost();
        await Promise.resolve();
        assert.notEqual(
          w.localStorage.getItem('tanglung_master_auth'), '1',
          `a prompt answered with ${JSON.stringify(answer)} granted master access`
        );
      } finally { close(host); }
    }
  });

  await t.test('the comparison is a strict equality against the stored hash', () => {
    const line = (CODE.match(/ok\s*=\s*sha256HexSync\(pin\)[^;]*/) || [])[0] || '';
    assert.match(line, /===\s*HOST_PIN_HASH/,
      'the PIN must be compared with === against the stored hash');
    assert.doesNotMatch(line, /\|\|/,
      'a logical OR here would let one side of the comparison short-circuit');
  });

  await t.test('the sync helper hashes a string the way the fairness code expects', () => {
    // A regression here would silently change every commit hash in the fair
    // draw, so it is worth pinning against a published vector.
    const host = gateWith(null);
    try {
      assert.equal(
        host.window.sha256HexSync('abc'),
        'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
        'sha256HexSync("abc") must match the published SHA-256 vector'
      );
    } finally { close(host); }
  });
});
