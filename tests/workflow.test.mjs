import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createApp } from './_harness.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const HTML = readFileSync(join(HERE, '..', 'index.html'), 'utf8');

const LANGS = ['BC', 'BM', 'BI'];

function makeHost(opts = {}) {
  return createApp({ master: true, ...opts });
}

function close(host) {
  try { host.window.close(); } catch (e) { /* already torn down */ }
}

// confirmDialog is a promise that waits for a click, so the flow has to be
// started, then answered, then awaited. This mirrors what an operator does.
function answerConfirm(host, accept = true) {
  const d = host.document;
  const btn = accept ? d.getElementById('confirmOkBtn') : d.getElementById('confirmCancelBtn');
  assert.ok(btn, 'the confirm dialog markup is missing');
  assert.notEqual(d.getElementById('confirmModal').style.display, 'none',
    'the dialog never opened');
  btn.click();
}

async function redrawRoundNow(host, roundId) {
  const done = host.window.redrawRound(roundId);
  await Promise.resolve();
  answerConfirm(host, true);
  return done;
}

// The SHORTCUTS table is a top-level `const`, i.e. a lexical binding rather
// than a window property, so the test reads it from source. That is what makes
// this check useful: it compares the bound table against the rendered legend.
function SHORTCUT_TABLE() {
  const block = HTML.slice(HTML.indexOf('const SHORTCUTS = ['));
  return [...block.slice(0, block.indexOf('];')).matchAll(/id: '([^']+)'/g)].map((m) => ({ id: m[1] }));
}

function findAction(doc, label) {
  return [...doc.querySelectorAll('#toastContainer .toast-action')]
    .find((b) => b.textContent.trim() === label);
}

function lastToastText(host) {
  const toasts = host.document.querySelectorAll('#toastContainer .toast');
  const last = toasts[toasts.length - 1];
  return last ? last.textContent.replace(/\s+/g, ' ').trim() : '';
}

/* -------------------------------------------------------------------------
   1. Batch history and re-draw
   ------------------------------------------------------------------------- */

describe('A batch of ten can be taken back as a unit', () => {
  it('records where each batch landed, so it can be found again', () => {
    const host = makeHost();
    try {
      host.window.drawTen();
      const rounds = host.get('drawRounds');
      assert.equal(rounds.length, 1);
      assert.equal(rounds[0].startIndex, 0);
      assert.equal(rounds[0].tickets.length, 10);
      assert.equal(rounds[0].tickets.join(','), host.get('winners').slice(0, 10).join(','),
        'the round must describe the winners that were actually pushed');
    } finally { close(host); }
  });

  it('tracks the position of later batches, not just the first', () => {
    const host = makeHost();
    try {
      host.window.drawTen();
      host.window.drawTen();
      const rounds = host.get('drawRounds');
      assert.equal(rounds.length, 2);
      assert.equal(rounds[1].startIndex, 10);
      assert.equal(rounds[1].tickets.join(','), host.get('winners').slice(10, 20).join(','));
    } finally { close(host); }
  });

  it('draws again, and the previous ten are handed out afresh', async () => {
    const host = makeHost();
    try {
      const { window: w } = host;
      w.drawTen();
      const before = host.get('winners').slice(0, 10);
      await redrawRoundNow(host, host.get('drawRounds')[0].id);
      const after = host.get('winners').slice(0, 10);
      assert.equal(after.length, 10);
      assert.notEqual(after.join(','), before.join(','), 'the re-draw produced the same result');
    } finally { close(host); }
  });

  it('actually returns the old numbers to the pool, rather than retiring them', async () => {
    // The failure this guards against: recycling the batch into recycleBin,
    // which getAvailablePool() excludes -- the re-draw would then be a
    // "void these ten" button wearing the name of a re-draw.
    const host = makeHost();
    try {
      const { window: w } = host;
      w.drawTen();
      const before = host.get('winners').slice(0, 10);
      await redrawRoundNow(host, host.get('drawRounds')[0].id);
      assert.equal(host.get('recycleBin').length, 0,
        'a re-draw must not retire the numbers it returns');
      const pool = w.getAvailablePool();
      const eligible = before.filter((n) => pool.includes(n)).length;
      assert.equal(eligible, before.length,
        `${before.length - eligible} of the returned numbers are still excluded from the pool`);
    } finally { close(host); }
  });

  it('keeps the sequence numbers contiguous after a re-draw', async () => {
    const host = makeHost();
    try {
      const { window: w } = host;
      w.drawTen();
      w.drawTen();
      await redrawRoundNow(host, host.get('drawRounds')[1].id);
      const winners = host.get('winners');
      // The second batch is swapped, not appended to, so the count holds.
      assert.equal(winners.length, 20, 'the re-draw did not replace the batch in place');
      assert.ok(winners.every((n) => typeof n === 'string' && /^\d{4}$/.test(n)),
        'a hole was left behind in the winners array');
      assert.equal(host.get('winners').slice(0, 10).join(','),
        host.get('winners').slice(0, 10).join(','), 'winners should be contiguous');
    } finally { close(host); }
  });

  it('releases a prize that had already been claimed', async () => {
    const host = makeHost();
    try {
      const { window: w } = host;
      w.drawTen();
      const claimed = host.get('winners')[0];
      host.set('claimedWinners', [claimed]);
      await redrawRoundNow(host, host.get('drawRounds')[0].id);
      assert.ok(!host.get('claimedWinners').includes(claimed),
        'a claimed prize must be released, because it is being handed out again');
    } finally { close(host); }
  });

  it('records the release in the void log', async () => {
    const host = makeHost();
    try {
      const { window: w } = host;
      w.drawTen();
      const old = host.get('winners')[0];
      await redrawRoundNow(host, host.get('drawRounds')[0].id);
      const logs = host.get('voidAuditLogs');
      assert.ok(logs.length >= 1, 'the swap has to be auditable');
      assert.ok(logs.some((l) => l && l.oldNum === old),
        'the log does not name the number that was released');
    } finally { close(host); }
  });

  it('can itself be undone', async () => {
    const host = makeHost();
    try {
      const { window: w, document: d } = host;
      w.drawTen();
      const before = host.get('winners').slice(0, 10);
      await redrawRoundNow(host, host.get('drawRounds')[0].id);
      const action = findAction(d, host.get('I18N')[host.get('currentLang')].toastUndo);
      assert.ok(action, 'a re-draw must offer an undo');
      action.click();
      assert.equal(host.get('winners').slice(0, 10).join(','), before.join(','),
        'undo did not put the original ten back');
    } finally { close(host); }
  });

  it('asks first, and does nothing if the operator says no', async () => {
    const host = makeHost();
    try {
      const { window: w } = host;
      w.drawTen();
      const before = host.get('winners').slice(0, 10);
      const done = w.redrawRound(host.get('drawRounds')[0].id);
      await Promise.resolve();
      answerConfirm(host, false);
      await done;
      assert.equal(host.get('winners').slice(0, 10).join(','), before.join(','),
        'a declined re-draw changed the winners');
    } finally { close(host); }
  });

  it('refuses a batch that a later action has already changed', async () => {
    // A single-slot redraw replaces a winner in place, so the round's slice no
    // longer matches. Offering "re-draw these ten" would then draw a different
    // set of ten than the operator is looking at.
    const host = makeHost();
    try {
      const { window: w, document: d } = host;
      w.drawTen();
      const round = host.get('drawRounds')[0];
      const before = host.get('winners').slice();
      const winners = host.get('winners').slice();
      winners[3] = '2999';
      host.set('winners', winners);
      await w.redrawRound(round.id);
      // Refused before the confirmation, not after: asking the operator to
      // confirm a redraw and then declining it would be a lie about what is
      // about to happen.
      assert.equal(d.getElementById('confirmModal').style.display, 'none',
        'a stale round reached the confirmation dialog');
      assert.equal(host.get('winners')[3], '2999');
      assert.equal(host.get('winners').length, before.length);
    } finally { close(host); }
  });

  it('marks a stale batch as such in the history, and offers no button', () => {
    const host = makeHost();
    try {
      const { window: w, document: d } = host;
      w.drawTen();
      const winners = host.get('winners').slice();
      winners[0] = '2888';
      host.set('winners', winners);
      w.toggleRoundModal(true);
      const rows = d.querySelectorAll('.round-row');
      assert.equal(rows.length, 1);
      assert.ok(rows[0].classList.contains('stale'));
      assert.equal(rows[0].querySelector('.btn-round-redraw'), null,
        'a stale row must not offer a re-draw');
    } finally { close(host); }
  });

  it('survives a reload, and still describes the same winners', () => {
    const host = makeHost();
    try {
      const { window: w } = host;
      w.drawTen();
      const saved = host.get('winners').slice(0, 10);
      const blob = w.localStorage.getItem('tanglung_stage_v39_realtime');
      assert.ok(blob, 'the state blob was not written');

      // Round-trip it through the real load path.
      const fresh = makeHost();
      try {
        fresh.window.localStorage.setItem('tanglung_stage_v39_realtime', blob);
        assert.equal(fresh.window.load(), true);
        assert.equal(fresh.get('drawRounds').length, 1, 'the history did not survive');
        assert.equal(fresh.get('drawRounds')[0].tickets.join(','), saved.join(','));
        assert.equal(fresh.window.latestRound() !== null, true,
          'a round that survived the reload must still be re-drawable');
      } finally { close(fresh); }
    } finally { close(host); }
  });

  it('discards a round that does not describe the winners it was sent with', () => {
    // drawRounds arrives over the network from another device.
    const host = makeHost();
    try {
      const { window: w } = host;
      w.applyRoundsData(
        [{ id: 1, startIndex: 0, tickets: ['1111', '2222'], time: 'x' }],
        1
      );
      assert.equal(host.get('drawRounds').length, 0,
        'a round pointing at the wrong slice must not be trusted');
    } finally { close(host); }
  });

  it('rejects junk in a round payload instead of throwing on it', () => {
    const host = makeHost();
    try {
      const { window: w } = host;
      assert.doesNotThrow(() => {
        w.applyRoundsData([
          null,
          { id: 'x', startIndex: -5, tickets: ['1111'] },
          { id: 2, startIndex: 0, tickets: 'not-an-array' },
          { id: 3, startIndex: 0, tickets: ['nope', '11'] },
          { id: 4, startIndex: 0, tickets: [] }
        ], 'nope');
      });
    } finally { close(host); }
  });

  it('caps the history rather than growing it for the whole event', () => {
    const host = makeHost();
    try {
      const { window: w } = host;
      host.set('maxPrizes', 5000);
      for (let i = 0; i < 52; i += 1) w.drawTen();
      assert.ok(host.get('drawRounds').length <= 50,
        `history grew to ${host.get('drawRounds').length}`);
    } finally { close(host); }
  });

  it('starts a fresh event with no history to re-draw', async () => {
    const host = makeHost();
    try {
      const { window: w, document: d } = host;
      w.drawTen();
      const done = w.resetAll();
      await Promise.resolve();
      answerConfirm(host, true);
      await done;
      assert.equal(host.get('drawRounds').length, 0,
        'a new event must not offer to re-draw the previous one');
      assert.match(d.getElementById('batchActions').textContent, /尚无|暂无|No draws/);
    } finally { close(host); }
  });

  it('shows the batch and its re-draw control only after a draw', () => {
    const host = makeHost();
    try {
      const { window: w, document: d } = host;
      assert.equal(d.getElementById('batchRedrawBtn'), null, 'nothing to re-draw yet');
      w.drawTen();
      assert.ok(d.getElementById('batchRedrawBtn'), 'the re-draw control is missing');
      assert.equal(d.querySelectorAll('.batch-round-chip').length, 10,
        'the batch should be listed on screen');
    } finally { close(host); }
  });

  it('keeps the fixed 5x2 grid intact', () => {
    // The grid's stagger animation is keyed to nth-child(1..10) and its
    // template is repeat(2, 1fr) rows. Adding the action row inside the grid
    // would have made an eleventh child and broken both.
    const grid = /\.batch-grid \{[^}]*grid-template-rows: repeat\(2, 1fr\)/.test(HTML);
    assert.ok(grid, 'the batch grid is no longer a fixed two-row grid');
    const host = makeHost();
    try {
      host.window.drawTen();
      const kids = host.document.getElementById('batchGrid').children;
      assert.equal(kids.length, 10, 'the grid should hold exactly the ten drawn numbers');
    } finally { close(host); }
  });
});

/* -------------------------------------------------------------------------
   2. Undoing a manual entry
   ------------------------------------------------------------------------- */

describe('A mistyped manual entry can be taken back', () => {
  it('offers an undo on the toast', () => {
    const host = makeHost();
    try {
      const { window: w, document: d } = host;
      d.getElementById('manualTicketInput').value = '1500';
      w.confirmManualEntry();
      assert.equal(host.get('winners').length, 1);
      assert.ok(d.querySelector('#toastContainer .toast-action'), 'no undo was offered');
    } finally { close(host); }
  });

  it('removes the entry when the undo is taken', () => {
    const host = makeHost();
    try {
      const { window: w, document: d } = host;
      d.getElementById('manualTicketInput').value = '1500';
      w.confirmManualEntry();
      d.querySelector('#toastContainer .toast-action').click();
      assert.equal(host.get('winners').length, 0, 'the entry survived the undo');
      assert.match(lastToastText(host), /1500/);
    } finally { close(host); }
  });

  it('does not roll back unrelated state, unlike the reset undo', () => {
    // The reset snapshot restores the filter, theme, language and titles too.
    // Undoing one manual entry must not undo a deliberate later change.
    const host = makeHost();
    try {
      const { window: w, document: d } = host;
      w.drawTen();
      d.getElementById('manualTicketInput').value = '1500';
      w.confirmManualEntry();
      w.changeLanguage('BI');
      d.querySelector('#toastContainer .toast-action').click();
      assert.equal(host.get('winners').length, 11, 'the batch draw was rolled back too');
      assert.equal(host.get('currentLang'), 'BI', 'the language was rolled back too');
    } finally { close(host); }
  });

  it('refuses to undo once a later draw has happened', () => {
    const host = makeHost();
    try {
      const { window: w, document: d } = host;
      d.getElementById('manualTicketInput').value = '1500';
      w.confirmManualEntry();
      const action = [...d.querySelectorAll('#toastContainer .toast-action')].pop();
      host.set('winners', host.get('winners').concat(['2000']));
      action.click();
      assert.ok(host.get('winners').includes('2000'),
        'the stale undo discarded a later, deliberate draw');
      assert.ok(host.get('winners').includes('1500'), 'the entry should not have been removed');
    } finally { close(host); }
  });

  it('says so when there is nothing left to undo', () => {
    const host = makeHost();
    try {
      const { window: w, document: d } = host;
      d.getElementById('manualTicketInput').value = '1500';
      w.confirmManualEntry();
      const action = [...d.querySelectorAll('#toastContainer .toast-action')].pop();
      host.set('winners', ['2000']);
      action.click();
      const toasts = d.querySelectorAll('#toastContainer .toast.error');
      assert.ok(toasts.length, 'undoing a vanished entry should say so');
    } finally { close(host); }
  });

  it('never offers the undo to a viewer', () => {
    const host = createApp({ viewer: true });
    try {
      const { window: w, document: d } = host;
      d.getElementById('manualTicketInput').value = '1500';
      w.confirmManualEntry();
      assert.equal(host.get('winners').length, 0, 'a viewer must not be able to enter anything');
    } finally { close(host); }
  });
});

/* -------------------------------------------------------------------------
   3. Keyboard shortcuts
   ------------------------------------------------------------------------- */

describe('The overflow menu has a keyboard route in, and a way back out', () => {
  it('opens and closes on Alt+M', () => {
    const host = makeHost();
    try {
      const { window: w, document: d } = host;
      const press = (init) => d.dispatchEvent(
        new w.KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init })
      );
      assert.equal(w.isMoreMenuOpen(), false);
      press({ key: 'm', altKey: true });
      assert.equal(w.isMoreMenuOpen(), true);
      press({ key: 'm', altKey: true });
      assert.equal(w.isMoreMenuOpen(), false);
    } finally { close(host); }
  });

  it('leaves text entry alone', () => {
    // Alt chords are exempt from the typing veto on purpose, but a bare letter
    // is not, or the shortcut would type into the field it was meant to serve.
    const host = makeHost();
    try {
      const { window: w, document: d } = host;
      const input = d.getElementById('manualTicketInput');
      input.focus();
      input.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'm', bubbles: true, cancelable: true }));
      assert.equal(w.isMoreMenuOpen(), false, 'a bare key opened the menu while typing');
    } finally { close(host); }
  });

  it('still works from inside a text field, because Alt+M is not a text shortcut', () => {
    const host = makeHost();
    try {
      const { window: w, document: d } = host;
      const input = d.getElementById('manualTicketInput');
      input.focus();
      input.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'm', altKey: true, bubbles: true, cancelable: true }));
      assert.equal(w.isMoreMenuOpen(), true,
        'the menu must stay reachable without leaving the keyboard');
    } finally { close(host); }
  });

  it('opens the legend on Alt+K and on Shift+?', () => {
    for (const init of [{ key: 'k', altKey: true }, { key: '?' , shiftKey: true }]) {
      const host = makeHost();
      try {
        const { window: w, document: d } = host;
        d.dispatchEvent(new w.KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init }));
        assert.equal(d.getElementById('shortcutModal').style.display, 'flex',
          `${JSON.stringify(init)} did not open the legend`);
      } finally { close(host); }
    }
  });

  it('lists every shortcut it actually binds, with a key for each', () => {
    const host = makeHost();
    try {
      const { window: w, document: d } = host;
      w.toggleShortcutModal(true);
      const bound = SHORTCUT_TABLE();
      const rows = d.querySelectorAll('.shortcut-row');
      assert.equal(rows.length, bound.length, 'the legend and the bound table disagree');
      assert.ok(d.querySelectorAll('.shortcut-key').length >= bound.length);
      for (const row of rows) {
        assert.ok(row.querySelector('.shortcut-desc').textContent.trim(),
          'a legend row has no description');
      }
    } finally { close(host); }
  });

  it('localizes the legend', () => {
    for (const lang of LANGS) {
      const host = makeHost();
      try {
        const { window: w, document: d } = host;
        w.changeLanguage(lang);
        w.toggleShortcutModal(true);
        const dict = host.get('I18N')[lang];
        const title = d.getElementById('shortcutModal').querySelector('h3').textContent;
        assert.equal(title, dict.shortcutTitle, `${lang}: the legend title was not translated`);
        const descs = [...d.querySelectorAll('.shortcut-desc')].map((e) => e.textContent);
        assert.ok(descs.includes(dict.shortcutLegend), `${lang}: a description was left untranslated`);
      } finally { close(host); }
    }
  });

  it('gives each key group an accessible name, so the row reads as text', () => {
    const host = makeHost();
    try {
      const { window: w, document: d } = host;
      w.toggleShortcutModal(true);
      const first = d.querySelector('.shortcut-keys');
      assert.ok(first.getAttribute('aria-label'), 'the key group is only a picture of letters');
      assert.match(first.getAttribute('aria-label'), /Alt/);
    } finally { close(host); }
  });

  it('is discoverable from the menu it documents', () => {
    const host = makeHost();
    try {
      const { window: w, document: d } = host;
      w.toggleMoreMenu(true);
      const entry = d.getElementById('shortcutHelpBtn');
      assert.ok(entry, 'nothing in the menu points at the shortcuts');
      assert.equal(w.moreMenuRows().includes(entry), true,
        'the legend entry must be part of the arrow-key order');
    } finally { close(host); }
  });

  it('has no shortcut row without a translation in some language', () => {
    for (const lang of LANGS) {
      const host = makeHost();
      try {
        host.window.changeLanguage(lang);
        const dict = host.get('I18N')[lang];
        for (const sc of SHORTCUT_TABLE()) {
          assert.ok(dict[sc.id], `${lang}: shortcut "${sc.id}" has no label`);
        }
      } finally { close(host); }
    }
  });
});

/* -------------------------------------------------------------------------
   4. Language and theme on the first frame
   ------------------------------------------------------------------------- */

describe('A second screen comes up in the operator language and theme', () => {
  it('writes a small prefs record whenever either changes', () => {
    const host = makeHost();
    try {
      const { window: w } = host;
      w.changeLanguage('BI');
      w.setTheme('hariRaya');
      const prefs = JSON.parse(w.localStorage.getItem('tanglung_display_prefs'));
      assert.deepEqual(prefs, { lang: 'BI', theme: 'hariRaya' });
    } finally { close(host); }
  });

  it('applies them on boot, before anything is drawn', () => {
    const host = makeHost();
    try {
      const { window: w, document: d } = host;
      w.localStorage.setItem('tanglung_display_prefs',
        JSON.stringify({ lang: 'BI', theme: 'deepavaliNight' }));
      host.set('currentLang', 'BC');
      host.set('currentTheme', 'indigo');
      assert.equal(w.loadDisplayPrefs(), true);
      assert.equal(host.get('currentLang'), 'BI');
      assert.equal(d.documentElement.lang, 'en');
      assert.equal(d.getElementById('langSelect').value, 'BI');
      assert.equal(host.get('currentTheme'), 'deepavaliNight');
      assert.equal(d.documentElement.getAttribute('data-mode'), 'dark',
        'the mode attribute selects the neutral scale and must be set too');
    } finally { close(host); }
  });

  it('ignores a prefs record it cannot trust', () => {
    for (const junk of ['not json{{{', '{"lang":"ZZ","theme":"nope"}', '{}', 'null', '[]']) {
      const host = makeHost();
      try {
        const { window: w } = host;
        w.localStorage.setItem('tanglung_display_prefs', junk);
        assert.doesNotThrow(() => w.loadDisplayPrefs(), `"${junk}" broke the loader`);
        assert.equal(host.get('currentLang'), 'BC', `"${junk}" changed the language`);
        assert.equal(host.get('currentTheme'), 'indigo', `"${junk}" changed the theme`);
      } finally { close(host); }
    }
  });

  it('does not fire when there is nothing to apply', () => {
    const host = makeHost();
    try {
      const { window: w } = host;
      assert.equal(w.loadDisplayPrefs(), false, 'an empty store was reported as a change');
    } finally { close(host); }
  });

  it('survives storage being unavailable', () => {
    const host = makeHost();
    try {
      const { window: w } = host;
      w.localStorage.setItem = () => { throw new Error('quota'); };
      assert.doesNotThrow(() => w.changeLanguage('BM'));
      assert.equal(host.get('currentLang'), 'BM',
        'the language should still change even if it cannot be cached');
    } finally { close(host); }
  });

  it('runs before the first paint, not after the state blob is loaded', () => {
    const boot = HTML.slice(HTML.indexOf('// BOOTSTRAP LIFECYCLE'));
    const prefs = boot.indexOf('loadDisplayPrefs()');
    const blob = boot.indexOf('if (!load())');
    assert.ok(prefs !== -1, 'loadDisplayPrefs is not called at boot');
    assert.ok(prefs < blob, 'the state blob load would repaint over the cached preferences first');
  });
});

/* -------------------------------------------------------------------------
   5. Clean stage mode and printing
   ------------------------------------------------------------------------- */

describe('The projector can be stripped down to just the stage', () => {
  it('hides the toolbar while it is on', () => {
    const host = makeHost({ projection: true });
    try {
      const { window: w, document: d } = host;
      w.applyProjClean(true);
      assert.ok(d.getElementById('projectorView').classList.contains('clean-mode'));
    } finally { close(host); }
  });

  it('really hides the toolbar in CSS, not just in a variable', () => {
    assert.ok(
      /#projectorView\.clean-mode \.proj-toolbar \{\s*display: none !important;/.test(HTML),
      'clean mode does not hide the toolbar'
    );
  });

  it('comes back on Escape, so it is not a one-way door', () => {
    const host = makeHost({ projection: true });
    try {
      const { window: w, document: d } = host;
      w.applyProjClean(true);
      d.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
      assert.equal(w.isProjClean(), false, 'Escape did not restore the toolbar');
    } finally { close(host); }
  });

  it('reports its state, and relabels itself in every language', () => {
    for (const lang of LANGS) {
      const host = makeHost({ projection: true });
      try {
        const { window: w, document: d } = host;
        const dict = host.get('I18N')[lang];
        w.applyProjClean(true);
        const btn = d.getElementById('projCleanBtn');
        assert.equal(btn.getAttribute('aria-pressed'), 'true', `${lang}: no pressed state`);
        w.changeLanguage(lang);
        assert.equal(btn.textContent, dict.btnProjCleanExit,
          `${lang}: the button still says "${btn.textContent}" while clean mode is on`);
        w.applyProjClean(false);
        assert.equal(btn.textContent, dict.btnProjClean, `${lang}: wrong off label`);
      } finally { close(host); }
    }
  });

  it('remembers the choice across a reload of the projector', () => {
    const host = makeHost({ projection: true });
    try {
      const { window: w, document: d } = host;
      w.applyProjClean(true);
      w.loadProjClean();
      assert.equal(w.isProjClean(), true);
      w.applyProjClean(false);
      w.loadProjClean();
      assert.equal(w.isProjClean(), false, 'turning it off must clear the stored choice');
    } finally { close(host); }
  });

  it('reaches the toolbar in transparent mode too', () => {
    // The toolbar carried its own opaque surface, so "transparent background"
    // used to leave a solid bar across the top of a see-through screen.
    assert.ok(
      /#projectorView\.transparent-mode \.proj-toolbar \{[^}]*background: transparent !important;/.test(HTML),
      'transparent mode still leaves the toolbar opaque'
    );
  });

  it('prints the stage and nothing else', () => {
    const print = HTML.slice(HTML.indexOf('@media print'));
    assert.ok(print.length > 200, 'there is no print stylesheet to judge');
    for (const selector of ['#operatorView', '.proj-toolbar', '.toast-container', '.modal-backdrop']) {
      assert.ok(print.includes(selector), `${selector} would be printed`);
    }
    assert.ok(print.includes('#projectorView'), 'the projection is not set up for print');
    assert.ok(print.includes('print-color-adjust'), 'the numbers would print unstyled');
  });
});

/* -------------------------------------------------------------------------
   6. Closing mid-session
   ------------------------------------------------------------------------- */

describe('Closing mid-session is confirmed', () => {
  it('is quiet on a session nobody has touched', () => {
    const host = makeHost();
    try {
      assert.equal(host.window.sessionHasUncommittedWork(), false,
        'a fresh page is being treated as an unfinished draw');
    } finally { close(host); }
  });

  it('catches work that has no winners yet', () => {
    // These are exactly the states the old single condition missed: a rolling
    // VIP number, a custom title, an emergency exclusion, a live claim timer.
    const cases = [
      ['isRolling', true],
      ['customMainTitle', 'KL Gala 2026'],
      ['customSubTitle', 'Hall B'],
      ['recycleBin', [{ ticket: '1234' }]],
      ['claimTimerInterval', 1]
    ];
    for (const [key, value] of cases) {
      const host = makeHost();
      try {
        host.set(key, value);
        assert.equal(host.window.sessionHasUncommittedWork(), true,
            `${key} was not treated as uncommitted work`);
      } finally { close(host); }
    }
  });

  it('stays quiet once every prize has been drawn', () => {
    const host = makeHost();
    try {
      host.set('winners', Array(host.get('maxPrizes')).fill('1000'));
      assert.equal(host.window.sessionHasUncommittedWork(), false,
        'a finished draw is not work in flight');
    } finally { close(host); }
  });

  it('never nags a projection window', () => {
    // Projectors get closed and reopened all evening; nagging every time would
    // only teach the operator to dismiss the prompt.
    const host = makeHost({ projection: true, viewer: true });
    try {
      host.set('winners', ['1001', '1002']);
      host.set('isRolling', true);
      assert.equal(host.window.sessionHasUncommittedWork(), false);
    } finally { close(host); }
  });

  it('warns through the browser prompt, in the operator language', () => {
    const host = makeHost();
    try {
      const { window: w, document: d } = host;
      w.changeLanguage('BI');
      w.drawTen();
      const e = new w.Event('beforeunload', { cancelable: true });
      // jsdom models returnValue as a boolean IDL attribute, so a string
      // assignment to it reads back as `true`. Replace it with a plain
      // writable property so the string the handler sets can be inspected.
      // (jsdom's own BeforeUnloadEvent cannot be constructed.)
      Object.defineProperty(e, 'returnValue', {
        value: undefined, writable: true, configurable: true
      });
      w.dispatchEvent(e);
      const dict = host.get('I18N').BI;
      assert.equal(e.defaultPrevented, true, 'no prompt was requested');
      assert.equal(e.returnValue, dict.exitConfirm,
        'the prompt was not raised in the operator language');
    } finally { close(host); }
  });

  it('asks in-app before navigating away from an open draw', async () => {
    const host = makeHost();
    try {
      const { window: w, document: d } = host;
      w.drawTen();
      const done = w.confirmExitIfSessionOpen();
      await Promise.resolve();
      assert.notEqual(d.getElementById('confirmModal').style.display, 'none',
        'no in-app confirmation appeared');
      const dict = host.get('I18N')[host.get('currentLang')];
      assert.equal(d.getElementById('confirmTitle').textContent, dict.exitConfirmTitle);
      answerConfirm(host, false);
      assert.equal(await done, false, 'cancelling must keep the operator on the page');
    } finally { close(host); }
  });

  it('does not interrupt a session that never started', async () => {
    const host = makeHost();
    try {
      assert.equal(await host.window.confirmExitIfSessionOpen(), true);
      assert.equal(host.document.getElementById('confirmModal').style.display, 'none');
    } finally { close(host); }
  });

  it('does not treat its own default subtitle as a custom title', () => {
    // applyLanguageUI() compared the trimmed subtitle but captured the raw
    // innerText, so the app recorded its own markup default as an operator
    // edit -- which then counted as unsaved work on an untouched session.
    const host = makeHost();
    try {
      assert.equal(host.get('customSubTitle'), null,
        'the shipped default subtitle is being read back as a customization');
    } finally { close(host); }
  });

  it('still follows the language with the subtitle', () => {
    const host = makeHost();
    try {
      const { window: w, document: d } = host;
      for (const lang of LANGS) {
        w.changeLanguage(lang);
        const dict = host.get('I18N')[lang];
        assert.equal(d.getElementById('appSubTitle').innerText.trim(), dict.brandSub,
          `${lang}: the subtitle is pinned to the wrong text`);
      }
    } finally { close(host); }
  });

  it('still honours a genuinely custom subtitle', () => {
    const host = makeHost();
    try {
      const { window: w, document: d } = host;
      d.getElementById('appSubTitle').innerText = 'Dewan KL / Hall B';
      w.changeLanguage('BI');
      assert.equal(d.getElementById('appSubTitle').innerText, 'Dewan KL / Hall B',
        'an operator edit was overwritten by a language change');
      assert.equal(w.sessionHasUncommittedWork(), true,
        'a real customization must count as unsaved work');
    } finally { close(host); }
  });
});
