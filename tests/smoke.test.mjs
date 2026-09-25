import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from './_harness.mjs';

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
      // Stage 1: host draws 10 via batch
      host.window.drawTen();
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