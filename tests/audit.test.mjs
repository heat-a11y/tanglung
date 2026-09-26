import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from './_harness.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const close = (app) => { try { app.dom.window.close(); } catch (e) {} };
const G = (app, k) => app.get(k);
const S = (app, k, v) => app.set(k, v);

function pad(n) { return String(n).padStart(4, '0'); }
const makeHost = () => createApp({ master: true });
const makeProjection = () => createApp({ projection: true });

describe('VIP projection slot behaviour', () => {
  it('shows the drawn VIP number on the big projection when the draw finishes', async () => {
    const host = makeHost();
    const proj = makeProjection();
    try {
      host.window.startVip();
      await sleep(80);
      host.window.stopVip();
      const picked = G(host, 'winners')[0];
      assert.ok(picked, 'master should have recorded one VIP winner');

      proj.applyState(host.window.getPayload());

      const slot = proj.document.getElementById('projVipSlot');
      const slotNum = proj.document.getElementById('projVipNum');
      assert.equal(slot.style.display, 'flex', 'projection slot should be visible after the draw');
      assert.equal(slotNum.textContent, picked, 'projection should show the winning number');
      assert.ok(!slot.classList.contains('rolling'), 'not rolling after stop');
    } finally {
      close(host); close(proj);
    }
  });

  it('KEEPS showing the drawn VIP number until the next draw starts (regression: was hiding after 6s)', async () => {
    const host = makeHost();
    const proj = makeProjection();
    try {
      host.window.startVip();
      await sleep(80);
      host.window.stopVip();
      const picked = G(host, 'winners')[0];
      proj.applyState(host.window.getPayload());

      const slot = proj.document.getElementById('projVipSlot');
      const slotNum = proj.document.getElementById('projVipNum');

      await sleep(6300);

      assert.equal(slot.style.display, 'flex', 'projection slot must STILL be visible 6s+ after the draw');
      assert.equal(slotNum.textContent, picked);
    } finally {
      close(host); close(proj);
    }
  });

  it('keeps showing on the master console too (no auto-hide after final number)', async () => {
    const host = makeHost();
    try {
      host.window.startVip();
      await sleep(80);
      host.window.stopVip();
      const slot = host.document.getElementById('projVipSlot');
      assert.equal(slot.style.display, 'flex', 'master projection slot visible after stop');
      await sleep(6300);
      assert.equal(slot.style.display, 'flex', 'master slot still visible 6s+ after stop');
    } finally {
      close(host);
    }
  });

  it('re-shows and animates the slot when the master starts the NEXT draw', async () => {
    const host = makeHost();
    const proj = makeProjection();
    try {
      host.window.startVip();
      await sleep(80);
      host.window.stopVip();
      proj.applyState(host.window.getPayload());

      const slot = proj.document.getElementById('projVipSlot');
      assert.equal(slot.style.display, 'flex', 'slot visible after first draw');

      host.window.startVip();
      proj.applyState(host.window.getPayload());

      assert.equal(slot.style.display, 'flex', 'slot still flex when next roll starts');
      assert.ok(slot.classList.contains('rolling'), 'slot is rolling for next draw');

      host.window.stopVip();
      proj.applyState(host.window.getPayload());

      assert.equal(G(host, 'winners').length, 2, 'two VIP winners drawn');
      assert.equal(slot.style.display, 'flex');
      assert.ok(!slot.classList.contains('rolling'), 'rolling cleared after stop');
      assert.equal(proj.document.getElementById('projVipNum').textContent, G(host, 'winners')[1]);
    } finally {
      close(host); close(proj);
    }
  });

  it('still hides the slot when a roll is abandoned (runaway auto-stop must keep working)', async () => {
    const host = makeHost();
    try {
      host.window.startVipRollAnimation(false);
      const slot = host.document.getElementById('projVipSlot');
      assert.equal(slot.style.display, 'flex');
      assert.ok(slot.classList.contains('rolling'));
      host.window.stopVipRollAnimation();
      assert.equal(slot.style.display, 'none', 'abandoned roll hides the slot');
      assert.equal(G(host, 'isRolling'), false, 'roller no longer rolling');
    } finally {
      close(host);
    }
  });

  it('does not leave stale rolling state on the projection when the same stop event is re-applied', async () => {
    const host = makeHost();
    const proj = makeProjection();
    try {
      host.window.startVip();
      await sleep(60);
      host.window.stopVip();
      const payload = host.window.getPayload();

      proj.applyState(payload);
      proj.applyState(payload);
      const slot = proj.document.getElementById('projVipSlot');
      assert.equal(slot.style.display, 'flex');
      assert.ok(!slot.classList.contains('rolling'), 'no rolling after re-applying stop');
    } finally {
      close(host); close(proj);
    }
  });
});

describe('VIP slot dismiss button (synced)', () => {
  const closeBtn = (app) => app.document.getElementById('projVipCloseBtn');
  const btnDisplay = (app) => app.window.getComputedStyle(closeBtn(app)).display;

  it('renders the X inside the VIP slot on the projection', () => {
    const proj = makeProjection();
    try {
      const slot = proj.document.getElementById('projVipSlot');
      const btn = closeBtn(proj);
      assert.ok(btn, 'close button must exist');
      assert.equal(btn.parentElement, slot, 'X must live inside the VIP slot');
      assert.equal(btn.textContent, '✕');
    } finally {
      close(proj);
    }
  });

  it('only offers the X once the number has settled (never mid-roll)', async () => {
    const host = makeHost();
    const proj = makeProjection();
    try {
      host.window.startVip();
      proj.applyState(host.window.getPayload());
      assert.ok(proj.document.getElementById('projVipSlot').classList.contains('rolling'));
      assert.equal(btnDisplay(proj), 'none', 'X must be unavailable while rolling');

      await sleep(60);
      host.window.stopVip();
      proj.applyState(host.window.getPayload());
      assert.equal(btnDisplay(proj), 'flex', 'X available once the number is final');
    } finally {
      close(host); close(proj);
    }
  });

  it('X on the big projection hides the card and is allowed in viewer mode', async () => {
    const host = makeHost();
    const proj = makeProjection();
    try {
      host.window.startVip();
      await sleep(60);
      host.window.stopVip();
      proj.applyState(host.window.getPayload());

      const slot = proj.document.getElementById('projVipSlot');
      assert.equal(slot.style.display, 'flex', 'card visible before pressing X');

      closeBtn(proj).click();

      assert.equal(slot.style.display, 'none', 'X closes the floating card');
      assert.equal(G(proj, 'vipSlotDismissed'), true, 'dismissal recorded on the projection');
      assert.equal(proj.window.getPayload().vipSlotDismissed, true, 'flag travels in the payload');
      assert.equal(G(proj, 'isViewerMode'), true, 'the close happened from a viewer-mode projection');
    } finally {
      close(host); close(proj);
    }
  });

  it('dismissal applied from another device hides the card there too', async () => {
    const host = makeHost();
    const projA = makeProjection();
    const projB = makeProjection();
    try {
      host.window.startVip();
      await sleep(60);
      host.window.stopVip();

      projA.applyState(host.window.getPayload());
      closeBtn(projA).click();

      // master receives the projection's write and republishes; B applies it
      const payload = { ...host.window.getPayload(), vipSlotDismissed: true };
      projB.applyState(payload);

      assert.equal(projB.document.getElementById('projVipSlot').style.display, 'none',
        'every other screen hides the card');
      assert.equal(projB.document.getElementById('projVipNum').textContent,
        G(host, 'winners')[0], 'winning number itself is untouched');
    } finally {
      close(host); close(projA); close(projB);
    }
  });

  it('a late dismissal still hides a card whose draw event was already applied', async () => {
    const host = makeHost();
    const proj = makeProjection();
    try {
      host.window.startVip();
      await sleep(60);
      host.window.stopVip();
      const payload = host.window.getPayload();

      proj.applyState(payload);
      assert.equal(proj.document.getElementById('projVipSlot').style.display, 'flex');

      proj.applyState({ ...payload, vipSlotDismissed: true });
      assert.equal(proj.document.getElementById('projVipSlot').style.display, 'none',
        'dismissal must apply even when the roll key was already seen');
    } finally {
      close(host); close(proj);
    }
  });

  it('the next draw brings the card back on every screen', async () => {
    const host = makeHost();
    const proj = makeProjection();
    try {
      host.window.startVip();
      await sleep(60);
      host.window.stopVip();
      proj.applyState(host.window.getPayload());
      closeBtn(proj).click();
      assert.equal(proj.document.getElementById('projVipSlot').style.display, 'none');

      host.window.startVip();
      proj.applyState(host.window.getPayload());
      const slot = proj.document.getElementById('projVipSlot');
      assert.equal(slot.style.display, 'flex', 'a fresh draw re-opens the card');
      assert.ok(slot.classList.contains('rolling'));

      await sleep(60);
      host.window.stopVip();
      proj.applyState(host.window.getPayload());
      assert.equal(slot.style.display, 'flex', 'final number stays on screen');
      assert.equal(G(proj, 'vipSlotDismissed'), false, 'dismissal flag cleared by the new draw');
      assert.equal(proj.document.getElementById('projVipNum').textContent, G(host, 'winners')[1]);
    } finally {
      close(host); close(proj);
    }
  });

  it('host pressing X hides its own slot and publishes the flag', async () => {
    const host = makeHost();
    try {
      host.window.startVip();
      await sleep(60);
      host.window.stopVip();

      host.window.closeProjVipSlot();

      assert.equal(host.document.getElementById('projVipSlot').style.display, 'none');
      assert.equal(host.window.getPayload().vipSlotDismissed, true);
      assert.equal(host.document.getElementById('vipDisplay').textContent, G(host, 'winners')[0],
        'console VIP display is not cleared by the projection X');
    } finally {
      close(host);
    }
  });

  it('reset clears the dismissal so the next draw behaves normally', async () => {
    const host = makeHost();
    const proj = makeProjection();
    try {
      host.window.startVip();
      await sleep(60);
      host.window.stopVip();
      proj.applyState(host.window.getPayload());
      closeBtn(proj).click();

      host.window.resetAll();

      assert.equal(G(host, 'vipSlotDismissed'), false);
      assert.equal(host.window.getPayload().vipSlotDismissed, false);
    } finally {
      close(host); close(proj);
    }
  });

  it('toolbar toggle brings a mistakenly closed card back, everywhere', async () => {
    const host = makeHost();
    const projA = makeProjection();
    const projB = makeProjection();
    try {
      host.window.startVip();
      await sleep(60);
      host.window.stopVip();
      const payload = host.window.getPayload();
      projA.applyState(payload);
      projB.applyState(payload);

      closeBtn(projA).click();
      assert.equal(projA.document.getElementById('projVipSlot').style.display, 'none');
      assert.equal(projB.document.getElementById('projVipSlot').style.display, 'flex', 'B still shows it');

      // the host receives the projection's write through the live database
      host.applyState({ ...host.window.getPayload(), vipSlotDismissed: true });
      assert.equal(host.document.getElementById('projVipSlot').style.display, 'none', 'host followed the close');

      host.document.getElementById('vipCardBtn').click();
      assert.equal(G(host, 'vipSlotDismissed'), false);
      assert.equal(host.window.getPayload().vipSlotDismissed, false, 're-open is published');

      projA.applyState(host.window.getPayload());
      projB.applyState(host.window.getPayload());
      for (const p of [projA, projB]) {
        assert.equal(p.document.getElementById('projVipSlot').style.display, 'flex',
          'card restored on every screen without a new draw');
        assert.equal(p.document.getElementById('projVipNum').textContent, G(host, 'winners')[0]);
      }
    } finally {
      close(host); close(projA); close(projB);
    }
  });

  it('toolbar toggle never resurrects an empty card', () => {
    const proj = makeProjection();
    try {
      const slot = proj.document.getElementById('projVipSlot');
      assert.equal(slot.style.display, 'none', 'no draw yet');

      proj.document.getElementById('vipCardBtn').click();

      assert.equal(G(proj, 'vipSlotDismissed'), true);
      assert.equal(slot.style.display, 'none', 'no number to show, so nothing appears');
    } finally {
      close(proj);
    }
  });

  it('toolbar button label tracks the shared state', async () => {
    const proj = makeProjection();
    try {
      const btn = proj.document.getElementById('vipCardBtn');
      const t = () => btn.textContent;
      assert.equal(t(), '👑 隐藏贵宾卡');

      btn.click();
      assert.equal(t(), '👑 显示贵宾卡');

      proj.applyState({ vipSlotDismissed: false });
      assert.equal(t(), '👑 隐藏贵宾卡', 'label follows remote state too');
    } finally {
      close(proj);
    }
  });

  it('warns on screen when the dismissal cannot reach other devices', async () => {
    const proj = makeProjection();
    try {
      S(proj, 'syncRef', { child: () => ({ set: () => Promise.reject(new Error('permission denied')) }) });

      proj.window.closeProjVipSlot();
      await sleep(20);

      assert.equal(proj.document.getElementById('projVipSlot').style.display, 'none', 'still hides locally');
      const toast = proj.document.querySelector('#toastContainer .toast');
      assert.ok(toast, 'a warning toast must be shown');
      assert.ok(toast.classList.contains('error'), 'toast is styled as an error');
      assert.match(toast.textContent, /sync failed/i);
    } finally {
      close(proj);
    }
  });
});

describe('Batch 10 draw (regression)', () => {
  it('draws exactly 10 unique in-range winners and renders tags', () => {
    const host = makeHost();
    try {
      host.window.drawTen();
      assert.equal(G(host, 'winners').length, 10);
      assert.equal(new Set(G(host, 'winners')).size, 10, 'winners must be unique');
      for (const num of G(host, 'winners')) {
        assert.match(num, /^\d{4}$/);
        assert.ok(parseInt(num, 10) >= 1001 && parseInt(num, 10) <= 3000);
      }
      assert.equal(host.document.getElementById('wonCount').textContent, '10');
      assert.equal(host.document.querySelectorAll('.number-tag').length, 10);
      assert.equal(G(host, 'vipRollEvent'), null);
      const stored = JSON.parse(host.window.localStorage.getItem('tanglung_stage_v39_realtime'));
      assert.equal(stored.winners.length, 10);
    } finally {
      close(host);
    }
  });

  it('never draws the same number twice across consecutive batches', () => {
    const host = makeHost();
    try {
      host.window.drawTen();
      host.window.drawTen();
      assert.equal(G(host, 'winners').length, 20);
      assert.equal(new Set(G(host, 'winners')).size, 20);
    } finally {
      close(host);
    }
  });
});

describe('VIP single draw on console (regression)', () => {
  it('adds exactly one winner and leaves the console display in sync', async () => {
    const host = makeHost();
    try {
      host.window.startVip();
      await sleep(80);
      host.window.stopVip();
      assert.equal(G(host, 'winners').length, 1);
      assert.equal(host.document.getElementById('vipDisplay').textContent, G(host, 'winners')[0]);
      assert.equal(G(host, 'isRolling'), false);
      assert.equal(
        host.document.getElementById('vipToggleBtn').textContent,
        G(host, 'I18N').BC.btnStartRoll
      );
    } finally {
      close(host);
    }
  });

  it('blocks a draw once all prizes are exhausted', () => {
    const host = makeHost();
    try {
      S(host, 'maxPrizes', 1);
      S(host, 'winners', ['0001']);
      host.window.updateUI();
      assert.equal(host.document.getElementById('batchDrawBtn').disabled, true);
      assert.equal(host.document.getElementById('vipToggleBtn').disabled, true);
      host.window.startVip();
      assert.equal(G(host, 'winners').length, 1, 'no new winner when exhausted');
      assert.ok(host.dialogs().some(([k]) => k === 'alert'), 'alerted that draw is finished');
    } finally {
      close(host);
    }
  });
});

describe('Manual entry / replacement (regression)', () => {
  it('adds a manually confirmed ticket', () => {
    const host = makeHost();
    try {
      host.document.getElementById('manualTicketInput').value = '1042';
      host.window.confirmManualEntry();
      assert.ok(G(host, 'winners').includes('1042'));
      assert.equal(host.document.getElementById('manualTicketInput').value, '');
    } finally {
      close(host);
    }
  });

  it('rejects duplicate tickets', () => {
    const host = makeHost();
    try {
      S(host, 'winners', ['1042']);
      host.document.getElementById('manualTicketInput').value = '1042';
      host.window.confirmManualEntry();
      assert.equal(G(host, 'winners').length, 1);
      assert.ok(host.dialogs().some(([k, m]) => k === 'alert' && String(m).includes('already won')));
    } finally {
      close(host);
    }
  });

  it('rejects out-of-range tickets', () => {
    const host = makeHost();
    try {
      host.document.getElementById('manualTicketInput').value = '9999';
      host.window.confirmManualEntry();
      assert.equal(G(host, 'winners').length, 0);
      assert.ok(host.dialogs().some(([k, m]) => k === 'alert' && String(m).includes('Range')));
    } finally {
      close(host);
    }
  });

  it('in-place redraw moves the voided ticket to recycle bin, logs audit, clears claim, and replaces in place', () => {
    const host = makeHost();
    try {
      S(host, 'winners', ['0001', '0002', '0003']);
      S(host, 'claimedWinners', ['0002']);
      const ok = host.window.promptRedrawSlot('0002', 1);
      assert.equal(ok, true);
      const winners = G(host, 'winners');
      assert.equal(winners.length, 3, 'in-place replacement keeps length');
      assert.notEqual(winners[1], '0002');
      assert.match(winners[1], /^\d{4}$/);
      const bin = G(host, 'recycleBin');
      assert.equal(bin.length, 1);
      assert.equal(bin[0].ticket, '0002');
      assert.equal(bin[0].originalSeq, 2);
      const audits = G(host, 'voidAuditLogs');
      assert.equal(audits.length, 1);
      assert.equal(audits[0].oldNum, '0002');
      assert.equal(audits[0].newNum, winners[1]);
      assert.ok(!G(host, 'claimedWinners').includes('0002'), 'claim cleared after redraw');
    } finally {
      close(host);
    }
  });

  it('restores a ticket back to the pool', () => {
    const host = makeHost();
    try {
      S(host, 'recycleBin', [{ ticket: '0050', originalSeq: 2, time: '10:00' }]);
      host.window.restoreToPool('0050', 0);
      assert.equal(G(host, 'recycleBin').length, 0);
    } finally {
      close(host);
    }
  });

  it('restores a ticket as a winner and grows prize quota when full', () => {
    const host = makeHost();
    try {
      S(host, 'winners', ['0001']);
      S(host, 'maxPrizes', 1);
      S(host, 'recycleBin', [{ ticket: '0050', originalSeq: 1, time: '10:00' }]);
      host.window.restoreAsWinner('0050', 0);
      assert.ok(G(host, 'winners').includes('0050'));
      assert.equal(G(host, 'maxPrizes'), 2, 'quota grew since list was full');
      assert.equal(G(host, 'recycleBin').length, 0);
    } finally {
      close(host);
    }
  });

  it('blacklist exclusion sends the ticket to the recycle bin', () => {
    const host = makeHost();
    try {
      host.document.getElementById('blacklistInput').value = '77';
      host.window.excludeBlacklistTicket();
      const bin = G(host, 'recycleBin');
      assert.equal(bin[0].ticket, '0077');
      assert.equal(bin[0].originalSeq, 'Excluded');
      assert.ok(!G(host, 'getAvailablePool')().includes('0077'), 'excluded number leaves the pool');
    } finally {
      close(host);
    }
  });
});

describe('Spotlight claim flow (regression)', () => {
  it('opens spotlight, claims, and unclaims a ticket', () => {
    const host = makeHost();
    try {
      S(host, 'winners', ['0001', '0002', '0003']);
      host.window.openSpotlight('0002', 2);
      assert.equal(host.document.getElementById('spotlightModal').style.display, 'flex');
      assert.equal(host.document.getElementById('spotlightNum').textContent, '0002');
      host.window.toggleClaimCurrentSpotlight();
      assert.ok(G(host, 'claimedWinners').includes('0002'));
      assert.equal(host.document.getElementById('spotlightModal').style.display, 'none', 'spotlight auto-closes after claim');

      host.window.openSpotlight('0002', 2);
      host.window.toggleClaimCurrentSpotlight();
      assert.ok(!G(host, 'claimedWinners').includes('0002'), 'toggle removes claim');
    } finally {
      close(host);
    }
  });
});

describe('Winners board / filters (regression)', () => {
  it('seq filter narrows the board and chips track selection', () => {
    const host = makeHost();
    try {
      const winners = [];
      for (let i = 1; i <= 110; i++) winners.push(pad(i));
      S(host, 'winners', winners);
      host.window.updateUI();
      assert.equal(G(host, 'getFilteredWinnersList')().length, 110);

      host.document.getElementById('filterModeSelect').value = 'seq';
      host.document.getElementById('rangeStart').value = '1';
      host.document.getElementById('rangeEnd').value = '70';
      host.window.applyRangeFilter();
      assert.equal(G(host, 'getFilteredWinnersList')().length, 70);

      host.window.setFilterPreset('71-100');
      assert.equal(G(host, 'getFilteredWinnersList')().length, 30);

      host.window.clearRangeFilter();
      assert.equal(G(host, 'getFilteredWinnersList')().length, 110);
      assert.ok(host.document.getElementById('chip-all').classList.contains('active'));
    } finally {
      close(host);
    }
  });

  it('ticket-number filter (byTicket) filters by numeric ticket value', () => {
    const host = makeHost();
    try {
      S(host, 'winners', ['0005', '0015', '0105']);
      host.document.getElementById('filterModeSelect').value = 'ticket';
      host.document.getElementById('rangeStart').value = '1';
      host.document.getElementById('rangeEnd').value = '100';
      host.window.applyRangeFilter();
      const nums = G(host, 'getFilteredWinnersList')().map((i) => i.num);
      assert.deepEqual(nums, ['0005', '0015']);
    } finally {
      close(host);
    }
  });
});

describe('Cross-device state sync (regression)', () => {
  it('applies a full host payload onto a fresh projection/viewer', () => {
    const host = makeHost();
    const viewer = createApp({ viewer: true });
    try {
      S(host, 'winners', [pad(1), pad(2), pad(3)]);
      S(host, 'claimedWinners', [pad(2)]);
      S(host, 'recycleBin', [{ ticket: pad(9), originalSeq: 5, time: 'x' }]);
      S(host, 'maxPrizes', 130);
      S(host, 'poolEnd', 2000);
      S(host, 'isSuspenseMode', true);
      host.window.updateUI();

      viewer.applyState(host.window.getPayload());

      assert.deepEqual(G(viewer, 'winners'), [pad(1), pad(2), pad(3)]);
      assert.deepEqual(G(viewer, 'claimedWinners'), [pad(2)]);
      assert.equal(G(viewer, 'maxPrizes'), 130);
      assert.equal(G(viewer, 'poolEnd'), 2000);
      assert.equal(G(viewer, 'isSuspenseMode'), true);
      assert.ok(!G(viewer, 'getAvailablePool')().includes(pad(9)), 'recycled number excluded on viewer');
    } finally {
      close(host); close(viewer);
    }
  });

  it('host language & theme propagate to viewers', () => {
    const host = makeHost();
    const viewer = createApp({ viewer: true });
    try {
      host.window.changeLanguage('BI');
      host.window.setTheme('jade');
      const payload = host.window.getPayload();
      assert.equal(payload.currentLang, 'BI');
      assert.equal(payload.currentTheme, 'jade');

      viewer.applyState(payload);
      assert.equal(G(viewer, 'currentLang'), 'BI');
      assert.equal(G(viewer, 'currentTheme'), 'jade');
      assert.equal(viewer.document.getElementById('appMainTitle').innerText, G(viewer, 'I18N').BI.brandTitle);
    } finally {
      close(host); close(viewer);
    }
  });

  it('clamps hostile values on apply (maxPrizes, poolEnd)', () => {
    const host = makeHost();
    try {
      host.applyState({
        winners: ['0001'],
        maxPrizes: 999999,
        poolEnd: 123456,
        poolStart: 1
      });
      assert.equal(G(host, 'maxPrizes'), 500);
      assert.equal(G(host, 'poolEnd'), 9999);
    } finally {
      close(host);
    }
  });

  it('sanitizes malformed winners on apply (4-digit strings kept, non-string entries preserved by design)', () => {
    const host = makeHost();
    try {
      host.applyState({ winners: ['abcd', '1234', 42, '0000'] });
      assert.deepEqual(G(host, 'winners'), ['1234', 42, '0000']);
    } finally {
      close(host);
    }
  });

  it('viewer cannot trigger vip roll or batch draw', () => {
    const viewer = createApp({ viewer: true });
    try {
      const before = G(viewer, 'winners').length;
      viewer.window.startVip();
      viewer.window.drawTen();
      assert.equal(G(viewer, 'winners').length, before, 'viewer draws must be no-ops');
      assert.ok(viewer.document.getElementById('batchDrawBtn').classList.contains('viewer-disabled'));
    } finally {
      close(viewer);
    }
  });
});

describe('Viewer / projection mode UI (regression)', () => {
  it('projection URL hides operator view and shows projector view', () => {
    const proj = createApp({ projection: true });
    try {
      const opView = proj.document.getElementById('operatorView');
      const projView = proj.document.getElementById('projectorView');
      assert.equal(opView.style.display, 'none');
      assert.equal(projView.style.display, 'flex');
      assert.ok(proj.document.getElementById('vipToggleBtn').classList.contains('viewer-disabled'));
      assert.equal(proj.document.getElementById('goHostBtn').style.display, '');
    } finally {
      close(proj);
    }
  });

  it('tab switch activates the VIP panel', () => {
    const host = makeHost();
    try {
      host.window.switchTab('vip');
      assert.ok(host.document.getElementById('vipPanel').classList.contains('active'));
      assert.ok(host.document.getElementById('tabVipBtn').classList.contains('active'));
      assert.ok(!host.document.getElementById('batchPanel').classList.contains('active'));
      host.window.switchTab('batch');
      assert.ok(host.document.getElementById('batchPanel').classList.contains('active'));
    } finally {
      close(host);
    }
  });
});

describe('Pacing, counters & bonus prizes (regression)', () => {
  it('quick-add sponsors raise the prize quota and re-render', () => {
    const host = makeHost();
    try {
      S(host, 'maxPrizes', 110);
      host.window.quickAddPrizes(5);
      assert.equal(G(host, 'maxPrizes'), 115);
      assert.equal(host.document.getElementById('maxPrizesLabel').textContent, '115');
    } finally {
      close(host);
    }
  });

  it('pacing ribbon flips to GRAND near the end and DONE when finished', () => {
    const host = makeHost();
    try {
      const grand = [];
      for (let i = 1; i <= 100; i++) grand.push(pad(i)); // 100 = maxPrizes - 10 (the GRAND threshold)
      S(host, 'winners', grand);
      S(host, 'maxPrizes', 110);
      host.window.updateUI();
      assert.match(host.document.getElementById('pacingRibbon').textContent, /Grand|压轴|Kemuncak/);

      const done = [];
      for (let i = 1; i <= 110; i++) done.push(pad(i));
      S(host, 'winners', done);
      host.window.updateUI();
      assert.match(host.document.getElementById('pacingRibbon').textContent, /全部|圆满|Selesai|Successfully/);
    } finally {
      close(host);
    }
  });
});

describe('Reset, sound & themes (regression)', () => {
  it('resetAll clears state and resets the VIP display', () => {
    const host = makeHost();
    try {
      S(host, 'winners', ['0001']);
      S(host, 'claimedWinners', ['0001']);
      S(host, 'recycleBin', [{ ticket: '0050' }]);
      S(host, 'voidAuditLogs', [{ seq: 1 }]);
      S(host, 'vipRollEvent', { phase: 'stop', ts: 1, num: '0001' });
      host.window.resetAll();
      assert.equal(G(host, 'winners').length, 0);
      assert.equal(G(host, 'claimedWinners').length, 0);
      assert.equal(G(host, 'recycleBin').length, 0);
      assert.equal(G(host, 'voidAuditLogs').length, 0);
      assert.equal(host.document.getElementById('vipDisplay').textContent, '----');
    } finally {
      close(host);
    }
  });

  it('sound toggle flips the label and stays safe', () => {
    const host = makeHost();
    try {
      host.window.toggleSound();
      assert.equal(G(host, 'soundOn'), false);
      assert.match(host.document.getElementById('soundBtn').textContent, /音效: 关|Audio: Off|Bunyi: Bisu/);
      host.window.toggleSound();
      assert.equal(G(host, 'soundOn'), true);
    } finally {
      close(host);
    }
  });

  it('theme changes propagate to the picker and payload', () => {
    const host = makeHost();
    try {
      host.window.setTheme('cobalt');
      assert.equal(G(host, 'currentTheme'), 'cobalt');
      assert.equal(host.window.getPayload().currentTheme, 'cobalt');
    } finally {
      close(host);
    }
  });
});

describe('Default pool & prize quota', () => {
  it('defaults to tickets 1001-3000 with 110 prizes', () => {
    const host = makeHost();
    try {
      assert.equal(G(host, 'poolStart'), 1001);
      assert.equal(G(host, 'poolEnd'), 3000);
      assert.equal(G(host, 'maxPrizes'), 110, 'prize quota unchanged');

      const pool = host.window.getAvailablePool();
      assert.equal(pool.length, 2000, '2000 tickets in the default pool');
      assert.equal(pool[0], '1001');
      assert.equal(pool[pool.length - 1], '3000');

      const payload = host.window.getPayload();
      assert.equal(payload.poolStart, 1001);
      assert.equal(payload.poolEnd, 3000);
      assert.equal(payload.maxPrizes, 110);
    } finally {
      close(host);
    }
  });
});

describe('Projection timer (regression)', () => {
  it('add/reset/stops update the timer chip without touching VIP slot', () => {
    const host = makeHost();
    try {
      S(host, 'projTimerRemaining', 300);
      host.window.projTimerAdd(1);
      assert.equal(G(host, 'projTimerRemaining'), 360);
      assert.equal(host.document.getElementById('projTimerDigits').textContent, '06:00');
      host.window.projTimerStop(true);
      assert.equal(G(host, 'projTimerRemaining'), 300);
      assert.equal(G(host, 'projTimerRunning'), false);
      assert.equal(host.document.getElementById('projVipSlot').style.display, 'none', 'timer must not touch VIP slot');
    } finally {
      close(host);
    }
  });
});

describe('Console VIP display keeps its own number (regression)', () => {
  it('vipDisplay keeps the last number on the console after stop', async () => {
    const host = makeHost();
    try {
      host.window.startVip();
      await sleep(80);
      host.window.stopVip();
      assert.equal(host.document.getElementById('vipDisplay').textContent, G(host, 'winners')[0]);
    } finally {
      close(host);
    }
  });
});