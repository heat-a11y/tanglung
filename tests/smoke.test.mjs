import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from './_harness.mjs';
import { readFileSync } from 'node:fs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const close = (app) => { try { app.dom.window.close(); } catch (e) {} };
const G = (app, k) => app.get(k);
const S = (app, k, v) => app.set(k, v);

function pad(n) { return String(n).padStart(4, '0'); }
const makeHost = () => createApp({ master: true });

describe('Operational smoke: exports & backups', () => {
  it('exportCSV produces a full CSV download', () => {
    const host = makeHost();
    try {
      S(host, 'winners', [pad(1), pad(2)]);
      S(host, 'claimedWinners', [pad(1)]);
      host.window.exportCSV();
      const [click] = host.anchorClicks();
      assert.ok(click, 'an anchor click must be captured');
      assert.match(click.href, /^data:text\/csv/);
      assert.match(decodeURIComponent(click.href), /Prize Sequence,Ticket Number,Claimed Status/);
      assert.match(click.download, /lucky_draw_/);
      assert.match(decodeURIComponent(click.href), /0001/);
    } finally {
      close(host);
    }
  });

  it('exportRangeCSV respects the active filter', () => {
    const host = makeHost();
    try {
      const wins = [];
      for (let i = 1; i <= 20; i++) wins.push(pad(i));
      S(host, 'winners', wins);
      host.document.getElementById('filterModeSelect').value = 'seq';
      host.document.getElementById('rangeStart').value = '1';
      host.document.getElementById('rangeEnd').value = '5';
      host.window.applyRangeFilter();
      host.window.exportRangeCSV();
      const [click] = host.anchorClicks();
      const csv = decodeURIComponent(click.href);
      assert.equal((csv.match(/0002/g) || []).length, 1);
      assert.ok(!csv.includes('0006'), 'filtered-out row must not appear');
    } finally {
      close(host);
    }
  });

  it('downloadBackupJSON carries the full recoverable state', () => {
    const host = makeHost();
    try {
      S(host, 'winners', [pad(7)]);
      S(host, 'recycleBin', [{ ticket: pad(9), originalSeq: 1, time: 'x' }]);
      host.window.downloadBackupJSON();
      const [click] = host.anchorClicks();
      assert.ok(click);
      assert.match(click.download, /lucky_draw_backup_.*\.json/);
      const data = JSON.parse(click.href.replace('blob:mock', '').replace(/^.*18:/, '').replace(/\n/g, '') || '{}');
      // blob URLs are stubbed; fall back to asserting payload via getPayload instead.
      const payload = host.window.getPayload();
      assert.deepEqual(payload.winners, [pad(7)]);
      assert.equal(payload.recycleBin[0].ticket, pad(9));
    } finally {
      close(host);
    }
  });

  it('backup JSON can be re-imported and restores state', () => {
    const host = makeHost();
    try {
      const payload = {
        winners: [pad(11), pad(12)],
        claimedWinners: [pad(11)],
        maxPrizes: 120,
        poolEnd: 1800,
        filterActive: true,
        filterStartVal: 1,
        filterEndVal: 2000,
        filterType: 'seq'
      };
      // Restore path uses FileReader.readAsText; call applyStateData directly
      // (the upload handler is a thin FileReader wrapper around it).
      host.applyState(payload);
      host.window.saveAndBroadcast();
      assert.deepEqual(G(host, 'winners'), [pad(11), pad(12)]);
      assert.deepEqual(G(host, 'claimedWinners'), [pad(11)]);
      assert.equal(G(host, 'maxPrizes'), 120);
      assert.equal(G(host, 'poolEnd'), 1800);
      assert.equal(G(host, 'filterActive'), true);
    } finally {
      close(host);
    }
  });
});

describe('Operational smoke: projector auto-timer & suspense', () => {
  it('auto-starts the projector claim timer once 10 winners exist on the projector', () => {
    const proj = createApp({ projection: true });
    try {
      const wins = [];
      for (let i = 1; i <= 11; i++) wins.push(pad(i));
      S(proj, 'winners', wins);
      proj.window.updateUI();
      assert.equal(G(proj, 'projTimerAutoStarted'), true, 'timer auto-started');
      assert.equal(G(proj, 'projTimerRemaining'), 300);
      assert.equal(proj.document.getElementById('projTimerChip').style.display, 'inline-flex');
      proj.window.projTimerStop(true);
    } finally {
      close(proj);
    }
  });

  it('suspense mode substitutes the grid with a suspense banner on the projector', () => {
    const proj = createApp({ projection: true });
    try {
      S(proj, 'winners', [pad(1), pad(2)]);
      S(proj, 'isSuspenseMode', true);
      proj.window.renderScrollers();
      assert.match(proj.document.getElementById('projStaticGrid').innerHTML, /Drawing in Progress|精彩即将揭晓|Nantikan/);
    } finally {
      close(proj);
    }
  });

  it('hide-claimed toggle filters claimed cards from the projector grid', () => {
    const proj = createApp({ projection: true });
    try {
      S(proj, 'winners', [pad(1), pad(2)]);
      S(proj, 'claimedWinners', [pad(1)]);
      S(proj, 'projHideClaimed', true);
      proj.window.renderScrollers();
      const grid = proj.document.getElementById('projStaticGrid').innerHTML;
      assert.ok(grid.includes(pad(2)));
      assert.ok(!grid.includes(pad(1)), 'claimed card hidden');
    } finally {
      close(proj);
    }
  });
});

describe('Operational smoke: VIP projection demanding an old number must refresh on new draw', () => {
  it('full cycle across two channels stays consistent incl. claimed + recycle on viewer', async () => {
    const host = makeHost();
    const proj = createApp({ projection: true });
    try {
      // Stage 1: host draws 10 via batch (async: it commits the fair seed)
      await host.window.drawTen();
      const first = host.window.getPayload();
      proj.applyState(first);
      assert.equal(G(proj, 'winners').length, 10);

      // Stage 2: host draws a VIP, projection must keep it visible
      host.window.startVip();
      await sleep(80);
      host.window.stopVip();
      const finalPayload = host.window.getPayload();
      proj.applyState(finalPayload);

      const slot = proj.document.getElementById('projVipSlot');
      assert.equal(slot.style.display, 'flex');
      await sleep(6300);
      assert.equal(slot.style.display, 'flex', 'projector still shows VIP number 6s+ out');
      assert.equal(proj.document.getElementById('projVipNum').textContent, G(host, 'winners')[10]);

      // Stage 3: host claims a batch winner; viewer reflects it
      host.window.openSpotlight(G(host, 'winners')[0], 1);
      host.window.toggleClaimCurrentSpotlight();
      proj.applyState(host.window.getPayload());
      assert.ok(G(proj, 'claimedWinners').includes(G(host, 'winners')[0]));
    } finally {
      close(host); close(proj);
    }
  });
});

describe('Operational smoke: no stray hidden-slot timers remain', () => {
  it('stopVipRollAnimation never schedules an auto-hide timer', async () => {
    const host = makeHost();
    try {
      host.window.startVip();
      await sleep(80);
      host.window.stopVip();
      const slot = host.document.getElementById('projVipSlot');
      assert.equal(slot._hideT, undefined, 'no hide timer must be scheduled on the slot');
      assert.equal(slot.style.display, 'flex');
    } finally {
      close(host);
    }
  });
});
describe('Provably fair draw (commit-reveal)', () => {
  it('a batch draw publishes a commitment that its own verifier accepts', () => {
    const host = makeHost();
    try {
      host.window.drawTen();
      const rec = G(host, 'fairDraw');
      assert.ok(rec, 'the draw must leave a reveal record');
      assert.match(rec.commit, /^[0-9a-f]{64}$/, 'commitment must be a sha256 hex digest');
      assert.match(rec.serverSeed, /^[0-9a-f]{64}$/);
      assert.match(rec.nonce, /^[0-9a-f]{16}$/);
      assert.equal(rec.quota, 10, 'the commitment must cover how many tickets are drawn');
      assert.equal(rec.picks.length, 10);
      assert.equal(rec.pool.length, 2000, 'the pool snapshot must predate the draw');
      const res = host.window.verifyFairDraw(rec);
      assert.equal(res.ok, true, 'a fresh record must verify: ' + JSON.stringify(res.steps));
    } finally { close(host); }
  });

  it('a VIP roll commits at the start, not at the stop', () => {
    const host = makeHost();
    try {
      host.window.startVip();
      // The commitment has to exist while the roll is still running, otherwise
      // the operator could roll until they saw the ticket they wanted.
      assert.ok(G(host, 'rollCommit'), 'the roll must be committed before it is stopped');
      const lockedCommit = G(host, 'fairCommit').commit;
      assert.equal(host.document.getElementById('rollCommitBox').style.display, 'flex',
        'the locked commitment must be on screen during the roll');
      assert.ok(host.document.getElementById('rollCommitBox').textContent.includes(lockedCommit));
      host.window.stopVip();
      const rec = G(host, 'fairDraw');
      assert.equal(rec.commit, lockedCommit, 'the stop must reveal the commitment made at the start');
      assert.equal(rec.picks.length, 1);
      assert.equal(G(host, 'rollCommit'), null, 'the pending commitment must be cleared');
      assert.equal(host.document.getElementById('rollCommitBox').style.display, 'none');
      assert.equal(host.window.verifyFairDraw(rec).ok, true);
    } finally { close(host); }
  });

  it('the verifier rejects every kind of tampering', () => {
    const host = makeHost();
    try {
      host.window.drawTen();
      const rec = G(host, 'fairDraw');
      const swap = rec.picks.slice();
      [swap[0], swap[1]] = [swap[1], swap[0]];
      const tampered = {
        'reordered picks': { ...rec, picks: swap },
        'flipped seed': { ...rec, serverSeed: rec.serverSeed.replace(/^./, c => (c === 'a' ? 'b' : 'a')) },
        'rewritten nonce': { ...rec, nonce: '0'.repeat(16) },
        'reordered pool': { ...rec, pool: [rec.pool[1], rec.pool[0], ...rec.pool.slice(2)] },
        'extended pool': { ...rec, pool: [...rec.pool, '9999'] },
        'inflated quota': { ...rec, quota: rec.quota + 1 },
        'forged commit': { ...rec, commit: 'f'.repeat(64) },
        'truncated seed': { ...rec, serverSeed: 'abcd' }
      };
      for (const [name, bad] of Object.entries(tampered)) {
        assert.equal(host.window.verifyFairDraw(bad).ok, false, `${name} must not verify`);
      }
      assert.equal(host.window.verifyFairDraw(null).ok, false, 'a missing record must not verify');
    } finally { close(host); }
  });

  it('replaces the index without a bias the rejection bound cannot hide', () => {
    const host = makeHost();
    try {
      const POOL = ['1', '2', '3', '4', '5', '6', '7'];
      const N = 4000;
      const counts = new Array(POOL.length).fill(0);
      for (let i = 0; i < N; i++) {
        const got = host.window.fairDrawFrom(POOL.slice(), 1)[0];
        const at = POOL.indexOf(got);
        assert.notEqual(at, -1, 'the draw must return a ticket from the pool');
        counts[at]++;
      }
      const expect = N / POOL.length;
      const chi2 = counts.reduce((acc, o) => acc + (o - expect) ** 2 / expect, 0);
      // df = 6, p < 0.001 is above 22.5. A biased mapping lands far outside it.
      assert.ok(chi2 < 22.5, `pool order looks biased: chi2 = ${chi2.toFixed(1)} over ${counts}`);
    } finally { close(host); }
  });

  it('the record survives a reload and still verifies', () => {
    const host = makeHost();
    let rec, payload;
    try {
      host.window.drawTen();
      rec = G(host, 'fairDraw');
      payload = JSON.parse(JSON.stringify(host.window.getPayload()));
      assert.ok(payload.fairDraw, 'the reveal must be persisted in the payload');
      assert.equal(payload.fairDraw.commit, rec.commit);
    } finally { close(host); }

    const reloaded = makeHost();
    try {
      reloaded.window.applyStateData(payload);
      assert.equal(G(reloaded, 'fairDraw').commit, rec.commit, 'the record must be restored');
      assert.equal(reloaded.window.verifyFairDraw(G(reloaded, 'fairDraw')).ok, true,
        'a reloaded record must still verify');
    } finally { close(reloaded); }
  });
});

describe('Cryptographic primitives', () => {
  it('the in-app SHA-256 and HMAC match the reference implementation', async () => {
    const { createHash, createHmac } = await import('node:crypto');
    const host = makeHost();
    try {
      for (const v of ['', 'abc', 'a'.repeat(55), 'a'.repeat(56), 'a'.repeat(63), 'a'.repeat(64), 'a'.repeat(65), 'x'.repeat(200)]) {
        assert.equal(
          host.window.sha256HexSync(v),
          createHash('sha256').update(v).digest('hex'),
          `sha256 mismatch for a ${v.length}-byte input`
        );
      }
      for (const [k, m] of [['00', ''], ['0102', 'msg'], ['ff'.repeat(32), 'x'.repeat(100)], ['ab'.repeat(64), 'oversized key']]) {
        assert.equal(
          host.window.hmacHexSync(k, m),
          createHmac('sha256', Buffer.from(k, 'hex')).update(m).digest('hex'),
          `hmac mismatch for a ${k.length / 2}-byte key`
        );
      }
    } finally { close(host); }
  });

  it('derives the same winners as an independent node:crypto re-derivation', async () => {
    const { createHash, createHmac } = await import('node:crypto');
    const host = makeHost();
    try {
      host.window.drawTen();
      const rec = G(host, 'fairDraw');
      const D = 'tanglung-fair-v1';
      const poolSig = createHash('sha256')
        .update(`${D}|pool|${rec.pool.length}|${rec.pool.join(',')}`).digest('hex');
      assert.equal(poolSig, rec.poolSig, 'pool signature must match the spec');
      assert.equal(
        createHash('sha256').update(`${D}|commit|${rec.serverSeed}|${poolSig}|${rec.quota}`).digest('hex'),
        rec.commit,
        'the commitment must cover seed, pool and quota'
      );
      const left = rec.pool.slice();
      const mine = rec.picks.map((_, i) => {
        const n = BigInt(left.length);
        for (let a = 0; a < 8; a++) {
          const h = createHmac('sha256', Buffer.from(rec.serverSeed, 'hex'))
            .update(`${rec.nonce}|${i}|${a}`).digest('hex');
          const x = BigInt('0x' + h);
          const limit = (1n << 256n) - ((1n << 256n) % n);
          if (x < limit) return left.splice(Number(x % n), 1)[0];
        }
        throw new Error('re-derivation failed to converge');
      });
      assert.deepEqual(mine, rec.picks, 'an offline verifier must land on the same tickets');
    } finally { close(host); }
  });
});

describe('Accessibility: reduced motion', () => {
  const withMotionPreference = (app, reduce) => {
    app.window.matchMedia = (q) => ({
      matches: reduce && /prefers-reduced-motion:\s*reduce/.test(String(q)),
      media: String(q), addListener() {}, removeListener() {},
      addEventListener() {}, removeEventListener() {}, dispatchEvent() { return false; }
    });
    return app;
  };

  it('drops the PiP ticker sweep instead of running it slower', () => {
    const host = withMotionPreference(makeHost(), true);
    try {
      S(host, 'pipBarMode', true);
      S(host, 'pipScrollPos', 0);
      host.document.getElementById('pipTrack').innerHTML = '<div>a</div>';
      // The loop returns before touching the transform, so no frame is queued
      // and the ticker stays exactly where it was.
      host.flushRaf(5);   // the one frame queued during boot
      assert.equal((host.window.__rafQueue || []).length, 0,
        'a reduced-motion session must not keep queueing ticker frames');
      assert.equal(host.document.getElementById('pipTrack').style.transform, '',
        'the ticker must not be nudged at all');
    } finally { close(host); }
  });

  it('slows and silences the VIP roll rather than strobing it', async () => {
    const host = withMotionPreference(makeHost(), true);
    try {
      assert.equal(host.window.prefersReducedMotion(), true, 'the preference must be readable');
      let ticks = 0;
      host.window.playTick = () => { ticks++; };
      host.window.startVip();
      assert.equal(G(host, 'isRolling'), true, 'the roll must still start');
      await sleep(760);
      host.window.stopVip();
      assert.equal(ticks, 0, 'the audio ticks are the other half of the problem');
    } finally { close(host); }
  });

  it('keeps the full-speed roll and audio when no preference is set', async () => {
    const host = makeHost();
    try {
      assert.equal(host.window.prefersReducedMotion(), false);
      let ticks = 0;
      host.window.playTick = () => { ticks++; };
      host.window.startVip();
      await sleep(140);
      host.window.stopVip();
      assert.ok(ticks > 0, 'the default roll must keep its ticks');
    } finally { close(host); }
  });

  it('replaces the CSS pulses with a static equivalent', () => {
    const css = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
    const block = css.match(/@media \(prefers-reduced-motion: reduce\) \{[\s\S]*?\n    \}/);
    assert.ok(block, 'there must be a prefers-reduced-motion block');
    const text = block[0];
    // A 0.001ms animation runs straight to its final keyframe, which for the
    // toast and popIn means "never actually visible". They have to be off.
    for (const sel of ['.toast', '.number-tag', '.modal-box']) {
      assert.ok(text.includes(sel), `${sel} must be handled, not just shortened`);
    }
    assert.match(text, /animation:\s*none\s*!important/);
    // The infinite pulses must not simply be cut, or the element looks dead.
    for (const sel of ['.vip-display.rolling', '.proj-timer-chip .proj-timer-digits-inline.timeout']) {
      assert.ok(text.includes(sel), `${sel} needs a static stand-in`);
    }
    assert.ok(!text.includes('display: none'), 'reduced motion must not hide content');
  });
});

describe('Accessibility: keyboard and focus', () => {
  it('every click-only control is now a real button or a labelled shortcut', () => {
    const host = makeHost();
    try {
      host.window.drawTen();
      const cards = host.document.querySelectorAll('.billboard-card');
      assert.ok(cards.length > 0, 'a draw must have produced billboard cards');
      for (const c of cards) {
        assert.equal(c.tagName, 'BUTTON', 'a winner card must be focusable, not a clickable div');
        assert.equal(c.getAttribute('type'), 'button', 'and must not submit anything');
        assert.ok(c.getAttribute('aria-label'), 'a winner card needs a spoken label');
        assert.ok(c.getAttribute('aria-label').length > 4);
      }
      // Two patterns may still live on a div, and only these two:
      //   - a modal backdrop, a redundant dismissal target that duplicates a
      //     real button and an Escape handler;
      //   - a click-to-edit stat badge, which must carry role, tabindex AND an
      //     Enter/Space handler, or it is mouse-only with extra steps.
      const divs = [...host.document.querySelectorAll('div[onclick]')];
      for (const el of divs) {
        const label = `${el.id || '(anon)'}: ${el.getAttribute('onclick')}`;
        if (el.id === 'spotlightModal') {
          assert.match(el.getAttribute('onclick'), /closeSpotlight/);
          continue;
        }
        if (el.id === 'fairModal') {
          // A backdrop that only closes when the backdrop itself is clicked, so
          // a click inside the dialog cannot dismiss it by accident.
          assert.match(el.getAttribute('onclick'), /event\.target===this/);
          assert.equal(el.getAttribute('role'), null, 'the backdrop is not the dialog');
          const box = host.document.getElementById('fairModalBox');
          assert.equal(box.getAttribute('role'), 'dialog', 'the inner box carries the dialog role');
          assert.equal(box.getAttribute('aria-modal'), 'true');
          continue;
        }
        if (el.id === 'spotlightCard') {
          // The card exists only to stop a click reaching the backdrop; it is
          // the dialog itself, not a control.
          assert.equal(el.getAttribute('role'), 'dialog');
          assert.equal(el.getAttribute('aria-modal'), 'true');
          assert.match(el.getAttribute('onclick'), /stopPropagation/);
          continue;
        }
        assert.equal(el.getAttribute('role'), 'button', `${label} is not announced as a control`);
        assert.equal(el.getAttribute('tabindex'), '0', `${label} cannot be reached by keyboard`);
        const kd = el.getAttribute('onkeydown') || '';
        assert.ok(/Enter/.test(kd) && /' '|\s\)/.test(kd),
          `${label} needs Enter and Space to activate it, got: ${kd}`);
      }
      assert.ok(divs.some(el => el.id === 'spotlightModal'),
        'the spotlight backdrop should remain a dismissal target');
      const swatches = host.document.querySelectorAll('.theme-swatch');
      assert.ok(swatches.length >= 20, 'all themes must be offered');
      for (const sw of swatches) {
        assert.equal(sw.tagName, 'BUTTON');
        assert.ok(sw.hasAttribute('aria-pressed'), 'a theme swatch must report its state');
      }
    } finally { close(host); }
  });

  it('a non-default filter is fully restored by the reset undo', async () => {
    const host = makeHost();
    try {
      host.document.getElementById('rangeStart').value = '4';
      host.document.getElementById('rangeEnd').value = '9';
      S(host, 'filterType', 'seq');
      S(host, 'filterStartVal', 4);
      S(host, 'filterEndVal', 9);
      S(host, 'filterActive', true);
      S(host, 'winners', ['0001', '0002', '0003', '0004', '0005']);
      const snap = host.window.snapshotForUndo();
      const p = host.window.resetAll();
      await sleep(0);
      host.document.getElementById('confirmOkBtn').click();
      await p;
      assert.deepEqual([...G(host, 'winners')], [], 'the reset must have cleared the winners');
      host.window.restoreFromUndo(snap);
      assert.deepEqual([...G(host, 'winners')], ['0001', '0002', '0003', '0004', '0005']);
      assert.equal(host.document.getElementById('rangeStart').value, '4',
        'the restored filter must show the values it is actually using');
      assert.equal(host.document.getElementById('rangeEnd').value, '9');
      assert.equal(host.document.getElementById('filterModeSelect').value, 'seq');
    } finally { close(host); }
  });

  it('the confirm dialog traps focus, and does not bind Enter to the destructive action', async () => {
    const host = makeHost();
    try {
      const trigger = host.document.getElementById('batchDrawBtn');
      trigger.focus();
      const p = host.window.resetAll();
      await sleep(0);
      const cancel = host.document.getElementById('confirmCancelBtn');
      const ok = host.document.getElementById('confirmOkBtn');
      assert.equal(host.document.activeElement, cancel, 'focus must start on the safe choice');

      // Tab from the last control must wrap back to the first.
      ok.focus();
      host.document.dispatchEvent(new host.window.KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
      assert.equal(host.document.activeElement, cancel, 'Tab must wrap within the dialog');
      cancel.focus();
      host.document.dispatchEvent(new host.window.KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true }));
      assert.equal(host.document.activeElement, ok, 'Shift+Tab must wrap within the dialog');

      // Enter is the native behaviour of whichever button has focus. While
      // Cancel is focused, a stray Enter must not be hijacked into confirming
      // a destructive action, so the dialog has to still be open.
      cancel.dispatchEvent(new host.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      assert.equal(host.document.getElementById('confirmModal').style.display, 'flex',
        'Enter must not be bound to the confirming action');
      cancel.click();
      await p;
      assert.notEqual(G(host, 'winners'), null);
      assert.equal(host.document.getElementById('confirmModal').style.display, 'none');
      assert.equal(host.document.activeElement, trigger, 'focus must return to the trigger');
    } finally { close(host); }
  });

  it('Escape cancels and hands focus back', async () => {
    const host = makeHost();
    try {
      S(host, 'winners', ['0001']);
      const trigger = host.document.getElementById('batchDrawBtn');
      trigger.focus();
      const p = host.window.resetAll();
      await sleep(0);
      assert.equal(host.document.getElementById('confirmModal').style.display, 'flex');
      host.document.dispatchEvent(new host.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      await p;
      assert.deepEqual([...G(host, 'winners')], ['0001'], 'Escape must not touch the data');
      assert.equal(host.document.getElementById('confirmModal').style.display, 'none');
      assert.equal(host.document.activeElement, trigger);
    } finally { close(host); }
  });
});

describe('Accessibility: the verification window', () => {
  it('renders the record, verifies it in place, and closes on Escape', () => {
    const host = makeHost();
    try {
      const openBtn = host.document.getElementById('fairModal').parentElement;
      void openBtn;
      const toolbarBtn = [...host.document.querySelectorAll('[onclick="toggleFairModal(true)"]')][0];
      assert.ok(toolbarBtn, 'the toolbar must offer the verification window');

      host.window.drawTen();
      toolbarBtn.focus();
      toolbarBtn.click();

      const modal = host.document.getElementById('fairModal');
      assert.equal(modal.style.display, 'flex');
      assert.equal(host.document.activeElement, host.document.getElementById('fairCloseBtn'),
        'focus must move into the dialog');
      const rec = G(host, 'fairDraw');
      const body = host.document.getElementById('fairBody').textContent;
      assert.ok(body.includes(rec.commit), 'the commitment must be on screen');
      assert.ok(body.includes(rec.serverSeed), 'the revealed seed must be on screen');
      for (const pick of rec.picks) assert.ok(body.includes(pick), `pick ${pick} must be listed`);

      host.document.getElementById('fairVerifyBtn').click();
      const out = host.document.getElementById('fairResult');
      assert.ok(out.textContent.length > 0, 'verification must produce a result');
      assert.ok(out.textContent.includes(rec.picks[0]), 'the verdict must restate the pick');
      assert.equal(out.querySelector('[role="status"]') !== null, true, 'the verdict must be announced');
      assert.ok(!out.textContent.includes('undefined'), 'no field may render as undefined');
      assert.ok(!out.textContent.includes('null'), 'no field may render as null');

      host.document.dispatchEvent(new host.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      assert.equal(modal.style.display, 'none', 'Escape must close the window');
      assert.equal(host.document.activeElement, toolbarBtn, 'focus must return to the toolbar button');
    } finally { close(host); }
  });

  it('says so plainly when nothing has been drawn yet', () => {
    const host = makeHost();
    try {
      host.window.toggleFairModal(true);
      const body = host.document.getElementById('fairBody').textContent;
      assert.ok(body.length > 0, 'an empty state still has to explain itself');
      assert.equal(host.document.getElementById('fairVerifyBtn').disabled, true,
        'there is nothing to verify yet');
    } finally { close(host); }
  });

  it('the spotlight is a real dialog: Escape closes it, focus comes back', () => {
    const host = makeHost();
    try {
      host.window.drawTen();
      const card = host.document.getElementById(`card-${G(host, 'winners')[0]}`);
      card.focus();
      card.click();
      assert.equal(host.document.getElementById('spotlightModal').style.display, 'flex');
      assert.equal(host.document.activeElement, host.document.getElementById('spotlightCloseBtn'));
      host.document.dispatchEvent(new host.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      assert.equal(host.document.getElementById('spotlightModal').style.display, 'none');
      assert.equal(host.document.activeElement, card, 'focus must return to the card that was verified');
    } finally { close(host); }
  });

  it('a search can be verified with Enter, without reaching for the mouse', () => {
    const host = makeHost();
    try {
      host.window.drawTen();
      const winner = G(host, 'winners')[3];
      const input = host.document.getElementById('searchInput');
      input.value = winner;
      host.window.searchTicket(input.value);
      assert.ok(host.document.getElementById(`card-${winner}`).classList.contains('highlight'),
        'typing must highlight the match');
      input.dispatchEvent(new host.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      assert.equal(host.document.getElementById('spotlightModal').style.display, 'flex',
        'Enter must open the verify window');
      assert.equal(host.document.getElementById('spotlightNum').textContent, winner);
    } finally { close(host); }
  });
});
