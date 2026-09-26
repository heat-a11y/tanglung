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
const makeViewer = () => createApp({ viewer: true });
const makePipBar = () => createApp({ url: 'http://localhost/?pipbar=true' });

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

describe('Cross-surface sync (master / viewer / projection / PiP)', () => {
  const surfaces = () => {
    const apps = { host: makeHost(), viewer: makeViewer(), proj: makeProjection(), pip: makePipBar() };
    return {
      ...apps,
      all: Object.values(apps),
      closeAll() { Object.values(apps).forEach(close); }
    };
  };

  it('every surface starts on the same pool, quota and prize count', () => {
    const s = surfaces();
    try {
      for (const [name, app] of Object.entries({ host: s.host, viewer: s.viewer, proj: s.proj, pip: s.pip })) {
        assert.equal(G(app, 'poolStart'), 1001, `${name} poolStart`);
        assert.equal(G(app, 'poolEnd'), 3000, `${name} poolEnd`);
        assert.equal(G(app, 'maxPrizes'), 110, `${name} maxPrizes`);
        assert.equal(app.window.getAvailablePool().length, 2000, `${name} pool size`);
      }
    } finally {
      s.closeAll();
    }
  });

  it('PiP waiting card advertises the real range, not a hardcoded one', () => {
    const s = surfaces();
    try {
      const track = s.pip.document.getElementById('pipTrack');
      assert.match(track.innerHTML, /1001\s*-\s*3000/, 'PiP shows 1001 - 3000');
      assert.doesNotMatch(track.innerHTML, /0001\s*-\s*3000/, 'the old hardcoded 0001 is gone');
    } finally {
      s.closeAll();
    }
  });

  it('a host VIP draw reaches the viewer, the big projection and the PiP ticker', async () => {
    const s = surfaces();
    try {
      s.host.window.startVip();
      await sleep(80);
      s.host.window.stopVip();
      const payload = s.host.window.getPayload();
      const winner = G(s.host, 'winners')[0];

      assert.match(winner, /^1[0-9]{3}$|^[12][0-9]{3}$|^3000$/, `winner ${winner} inside 1001-3000`);
      assert.ok(Number(winner) >= 1001 && Number(winner) <= 3000);

      for (const app of [s.viewer, s.proj, s.pip]) app.applyState(payload);

      assert.equal(s.viewer.document.getElementById('vipDisplay').textContent, winner, 'remote viewer console');
      assert.equal(s.proj.document.getElementById('projVipNum').textContent, winner, 'big projection card');
      assert.equal(s.proj.document.getElementById('projVipSlot').style.display, 'flex', 'projection card visible');

      const track = s.pip.document.getElementById('pipTrack');
      assert.ok(track.innerHTML.includes(winner), `PiP ticker lists the winner (${winner})`);

      for (const app of s.all) {
        assert.equal(G(app, 'poolStart'), 1001);
        assert.equal(G(app, 'poolEnd'), 3000);
        assert.equal(G(app, 'maxPrizes'), 110);
        assert.deepEqual(G(app, 'winners'), G(s.host, 'winners'), 'identical winner list everywhere');
      }
    } finally {
      s.closeAll();
    }
  });

  it('a host batch of 10 propagates to every surface, all within 1001-3000', () => {
    const s = surfaces();
    try {
      s.host.window.drawTen();
      const payload = s.host.window.getPayload();
      for (const app of [s.viewer, s.proj, s.pip]) app.applyState(payload);

      const winners = G(s.host, 'winners');
      assert.equal(winners.length, 10);
      assert.equal(new Set(winners).size, 10, 'no duplicates');
      for (const n of winners) assert.ok(Number(n) >= 1001 && Number(n) <= 3000, `${n} in range`);

      for (const app of s.all) assert.deepEqual(G(app, 'winners'), winners, 'same 10 numbers everywhere');
      assert.equal(s.proj.document.querySelectorAll('.proj-grid-card').length, 10, 'projection grid shows 10');

      const pipHtml = s.pip.document.getElementById('pipTrack').innerHTML;
      for (const n of winners) assert.ok(pipHtml.includes(n), `PiP ticker lists ${n}`);
      const pipCards = pipHtml.match(/class="proj-card"/g) || [];
      assert.equal(pipCards.length % 10, 0, 'PiP repeats the set for seamless scrolling');
      assert.ok(pipCards.length >= 30, `PiP has at least 3 scroll sets (${pipCards.length})`);

      assert.equal(s.host.document.getElementById('poolCount').textContent, '1990', '1990 of 2000 left');
      assert.equal(s.host.document.getElementById('maxPrizesLabel').textContent, '110', 'quota still 110');
    } finally {
      s.closeAll();
    }
  });

  it('closing the VIP card on the projection reaches every other surface', async () => {
    const s = surfaces();
    try {
      s.host.window.startVip();
      await sleep(60);
      s.host.window.stopVip();
      const payload = s.host.window.getPayload();
      for (const app of [s.viewer, s.proj, s.pip]) app.applyState(payload);

      s.proj.document.getElementById('projVipCloseBtn').click();
      const closed = { ...s.host.window.getPayload(), vipSlotDismissed: true };
      for (const app of [s.viewer, s.proj, s.pip]) app.applyState(closed);

      assert.equal(G(s.viewer, 'vipSlotDismissed'), true, 'viewer knows');
      assert.equal(G(s.pip, 'vipSlotDismissed'), true, 'PiP page knows');
      assert.equal(s.proj.document.getElementById('projVipSlot').style.display, 'none', 'projection card hidden');
      assert.equal(s.viewer.document.getElementById('vipDisplay').textContent, G(s.host, 'winners')[0],
        'winning number itself is never erased');
      assert.equal(s.pip.document.getElementById('pipTrack').innerHTML.includes(G(s.host, 'winners')[0]), true,
        'PiP keeps listing the winner');
    } finally {
      s.closeAll();
    }
  });
});

describe('No ticket number can ever repeat', () => {
  it('the default pool is exactly 2000 distinct tickets, 1001-3000', () => {
    const host = makeHost();
    try {
      const pool = host.window.getAvailablePool();
      assert.equal(pool.length, 2000);
      assert.equal(new Set(pool).size, 2000, 'pool itself has no duplicates');
      assert.equal(pool[0], '1001');
      assert.equal(pool[pool.length - 1], '3000');
      for (const n of pool) assert.ok(Number(n) >= 1001 && Number(n) <= 3000);
    } finally {
      close(host);
    }
  });

  it('110 winners drawn by batch + VIP are unique and in range at every step', async () => {
    const host = makeHost();
    try {
      const seen = new Set();
      const check = (label) => {
        const w = G(host, 'winners');
        assert.equal(w.length, new Set(w).size, `${label}: no duplicate in winners`);
        for (const n of w) {
          assert.ok(Number(n) >= 1001 && Number(n) <= 3000, `${label}: ${n} in range`);
          assert.ok(!G(host, 'recycleBin').some(r => r.ticket === n), `${label}: ${n} not also in recycle bin`);
        }
        for (const n of w) seen.add(n);
      };

      for (let i = 0; i < 10; i++) { host.window.drawTen(); check(`batch ${i + 1}`); }
      assert.equal(G(host, 'winners').length, 100);

      await sleep(60);
      host.window.startVip();
      await sleep(60);
      host.window.stopVip();
      check('after VIP');
      assert.equal(G(host, 'winners').length, 101);
      assert.equal(seen.size, 101, '101 unique tickets taken');

      // quota respected
      while (G(host, 'winners').length < 110) { host.window.drawTen(); }
      check('at quota');
      assert.equal(G(host, 'winners').length, 110);
      assert.equal(seen.size, 110, '110 unique tickets, no repeats');
      assert.equal(G(host, 'maxPrizes'), 110);

      host.clearDialogs();
      host.window.startVip();
      assert.ok(host.dialogs().some(([, m]) => String(m).includes('110')), 'no draw past the 110 quota');
      assert.equal(G(host, 'winners').length, 110, 'still exactly 110');
    } finally {
      close(host);
    }
  });

  it('in-place redraw never re-draws the voided ticket', () => {
    const host = makeHost();
    try {
      host.window.drawTen();
      const before = [...G(host, 'winners')];
      const voided = before[3];

      host.window.promptRedrawSlot(voided, 3);
      const after = G(host, 'winners');
      assert.equal(after.length, 10, 'list length unchanged');
      assert.notEqual(after[3], voided, 'slot 4 holds a different ticket');
      assert.equal(new Set(after).size, 10, 'still unique');
      assert.ok(!after.includes(voided), 'voided ticket is out of the draw');
      assert.ok(G(host, 'recycleBin').some(r => r.ticket === voided), 'voided ticket is in the recycle bin');
      assert.ok(!host.window.getAvailablePool().includes(voided), 'voided ticket is not drawable again');
    } finally {
      close(host);
    }
  });

  it('manual entry refuses a winner, a voided ticket and an out-of-range number', () => {
    const host = makeHost();
    try {
      host.window.drawTen();
      const winner = G(host, 'winners')[0];
      const input = host.document.getElementById('manualTicketInput');

      input.value = winner;
      host.window.confirmManualEntry();
      assert.ok(host.dialogs().some(([, m]) => String(m).includes('already won')), 'existing winner refused');

      host.clearDialogs();
      G(host, 'recycleBin').push({ ticket: '1234', originalSeq: 3, time: 'now' });
      input.value = '1234';
      host.window.confirmManualEntry();
      assert.ok(host.dialogs().some(([, m]) => String(m).includes('void / blacklist')), 'voided ticket refused');
      assert.equal(G(host, 'winners').includes('1234'), false, 'never became a winner');

      host.clearDialogs();
      input.value = '0500';
      host.window.confirmManualEntry();
      assert.ok(host.dialogs().some(([, m]) => String(m).includes('Range')), 'below 1001 refused');

      input.value = '3001';
      host.window.confirmManualEntry();
      assert.ok(host.dialogs().some(([, m]) => String(m).includes('Range')), 'above 3000 refused');

      assert.equal(new Set(G(host, 'winners')).size, G(host, 'winners').length, 'still unique');
    } finally {
      close(host);
    }
  });

  it('restoring a recycle-bin entry that is already a winner cannot duplicate it', () => {
    const host = makeHost();
    try {
      host.window.drawTen();
      const winner = G(host, 'winners')[2];
      G(host, 'recycleBin').push({ ticket: winner, originalSeq: 3, time: 'now' });

      host.window.restoreAsWinner(winner, 0);
      assert.equal(G(host, 'winners').filter(n => n === winner).length, 1, 'exactly one copy');
      assert.equal(G(host, 'winners').length, 10, 'no new winner added');
      assert.equal(G(host, 'recycleBin').length, 0, 'stale bin entry cleared');
      assert.equal(G(host, 'maxPrizes'), 110, 'quota untouched');

      G(host, 'recycleBin').push({ ticket: winner, originalSeq: 3, time: 'now' });
      host.window.restoreToPool(winner, 0);
      assert.equal(G(host, 'winners').length, 10, 'restore-to-pool refused for a live winner');
      assert.ok(!host.window.getAvailablePool().includes(winner), 'winner ticket is not drawable again');
      assert.equal(new Set(G(host, 'winners')).size, 10);
    } finally {
      close(host);
    }
  });

  it('hostile state cannot inject duplicate winners or resurrect a voided ticket', () => {
    const host = makeHost();
    try {
      host.applyState({
        winners: ['1500', '1500', '1500', '2000'],
        recycleBin: ['1234'],
        poolStart: 1001,
        poolEnd: 3000,
        maxPrizes: 110
      });

      const w = G(host, 'winners');
      assert.deepEqual(w, ['1500', '2000'], 'duplicates collapsed, first occurrence kept');

      const pool = host.window.getAvailablePool();
      assert.equal(pool.length, 1997, '2000 - 2 distinct winners - 1 voided');
      assert.ok(!pool.includes('1500'), 'winner excluded');
      assert.ok(!pool.includes('2000'), 'winner excluded');
      assert.ok(!pool.includes('1234'), 'bare-string recycle entry still excludes the ticket');
      assert.equal(new Set(pool).size, pool.length, 'pool unique');
    } finally {
      close(host);
    }
  });

  it('exclusion logic holds across the entire 2000-ticket range', () => {
    const host = makeHost();
    try {
      const winners = [];
      const seen = new Set();

      // walk the real availability API until the pool is empty
      for (let guard = 0; guard < 400; guard++) {
        const pool = host.window.getAvailablePool();
        if (pool.length === 0) break;

        assert.equal(new Set(pool).size, pool.length, 'available pool is always unique');
        for (const n of pool) {
          assert.ok(!seen.has(n), `${n} offered twice`);
          assert.ok(Number(n) >= 1001 && Number(n) <= 3000, `${n} in range`);
        }

        const take = pool.splice(Math.floor(Math.random() * pool.length), Math.min(10, pool.length));
        S(host, 'winners', [...winners, ...take]);
        winners.push(...take);
        for (const n of take) seen.add(n);
      }

      assert.equal(winners.length, 2000, 'the whole pool was consumable');
      assert.equal(seen.size, 2000, '2000 distinct tickets, zero repeats');
      assert.equal(host.window.getAvailablePool().length, 0, 'pool empty at the end');

      const nums = [...seen].map(Number);
      assert.equal(Math.min(...nums), 1001, 'lowest ticket is 1001');
      assert.equal(Math.max(...nums), 3000, 'highest ticket is 3000');
    } finally {
      close(host);
    }
  });

  it('prize quota is hard-capped, so a runaway loop cannot exceed it', () => {
    const host = makeHost();
    try {
      host.applyState({ maxPrizes: 99999, poolStart: 1001, poolEnd: 3000 });
      assert.equal(G(host, 'maxPrizes'), 500, 'hostile quota clamped to 500');
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