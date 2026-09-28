import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createApp } from './_harness.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const close = (app) => { try { app.dom.window.close(); } catch (e) {} };
const makeHost = () => createApp({ master: true });
const HTML = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

/* The top bar used to carry fourteen text buttons in a single strip, which
   pushed the brand off the left edge on a laptop and left the six controls an
   operator actually reaches for mid-draw indistinguishable from the eight that
   only matter while setting up. Six stay; the rest live in an overflow menu.

   These tests guard the seams that a relocation like that quietly breaks: the
   ids and handlers the rest of the app resolves by name, the buttons that
   toggle their own label (an icon button that is written to with textContent
   deletes its own icon), and the fact that the menu is a menu and not a
   document-order accident. */

describe('Top bar: the overflow menu', () => {
  it('keeps the six mid-draw controls on the bar itself', () => {
    const host = makeHost();
    try {
      const bar = host.document.querySelector('.top-actions');
      const panel = host.document.getElementById('moreMenuPanel');
      const onBar = (id) => !panel.querySelector('#' + id);
      const barButtons = [...bar.querySelectorAll(':scope > button')];
      const hasHandler = (h) => barButtons.some((b) => b.getAttribute('onclick') === h);

      assert.ok(onBar('syncNavBtn'), 'cloud sync must stay visible');
      assert.ok(onBar('suspenseBtn'), 'conceal mode must stay visible');
      assert.ok(hasHandler('openProjectionTab()'), 'projection must stay visible');
      assert.ok(hasHandler('openPiPOverlay()'), 'picture in picture must stay visible');
      assert.ok(hasHandler('toggleFullScreen()'), 'fullscreen must stay visible');
      assert.ok(onBar('resetBtn'), 'reset must stay visible');
    } finally { close(host); }
  });

  it('collapses the remaining controls into the menu', () => {
    const host = makeHost();
    try {
      const panel = host.document.getElementById('moreMenuPanel');
      for (const id of ['themeBtn', 'crisisBtn', 'soundBtn', 'recycleBtnCount']) {
        assert.ok(panel.querySelector('#' + id), `${id} should live in the menu`);
      }
      const labels = [...panel.querySelectorAll('[data-i18n]')].map((n) => n.getAttribute('data-i18n'));
      for (const key of ['navTheme', 'navRecycle', 'navScript', 'fairOpen', 'navCrisis', 'navTestSound']) {
        assert.ok(labels.includes(key), `${key} should be reachable from the menu`);
      }
      assert.ok(
        [...panel.querySelectorAll('button')].some((b) => b.textContent.trim() === 'CSV'),
        'the CSV export belongs in the menu'
      );
      // Eight rows is a menu; twenty is a page that lost its menu.
      assert.ok(panel.querySelectorAll('button').length <= 12, 'the menu should stay short');
    } finally { close(host); }
  });

  it('opens on click, and reports its state to assistive tech', () => {
    const host = makeHost();
    try {
      const { window: w, document: d } = host;
      const panel = d.getElementById('moreMenuPanel');
      const btn = d.getElementById('moreMenuBtn');

      assert.equal(panel.hidden, true, 'the menu starts closed');
      assert.equal(btn.getAttribute('aria-expanded'), 'false');

      btn.click();
      assert.equal(w.isMoreMenuOpen(), true);
      assert.equal(panel.hidden, false, 'open means not hidden');
      assert.equal(panel.classList.contains('is-open'), true);
      assert.equal(btn.getAttribute('aria-expanded'), 'true');
      assert.equal(btn.getAttribute('aria-haspopup'), 'true');
      assert.equal(panel.getAttribute('aria-labelledby'), 'moreMenuBtn',
        'the panel borrows the trigger name so it needs no hardcoded English label');
    } finally { close(host); }
  });

  it('closes on a second click, an outside click, and Escape', async () => {
    const host = makeHost();
    try {
      const { window: w, document: d } = host;
      const panel = d.getElementById('moreMenuPanel');
      const btn = d.getElementById('moreMenuBtn');

      btn.click();
      btn.click();
      assert.equal(w.isMoreMenuOpen(), false, 'the trigger toggles');

      btn.click();
      d.getElementById('appMainTitle').click();
      assert.equal(w.isMoreMenuOpen(), false, 'clicking elsewhere dismisses it');

      btn.click();
      d.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      assert.equal(w.isMoreMenuOpen(), false, 'Escape dismisses it');
      assert.equal(d.activeElement, btn, 'and focus goes back where it started');
    } finally { close(host); }
  });

  it('stops taking clicks at once, and leaves the tab order when the fade ends', async () => {
    const host = makeHost();
    try {
      const { window: w, document: d } = host;
      const panel = d.getElementById('moreMenuPanel');
      d.getElementById('moreMenuBtn').click();
      d.getElementById('appMainTitle').click();

      // The fade-out is time-based, so the element stays in the document for a
      // moment. What matters is that it stops responding immediately -- the
      // closed stylesheet drops pointer-events the moment the class goes -- and
      // that it does not linger past the fade, where a hidden-but-present
      // panel would still be a tab stop and still be announced.
      assert.equal(w.isMoreMenuOpen(), false, 'closed immediately, not after the fade');
      await sleep(320);
      assert.equal(panel.hidden, true, 'and gone from the tab order once the fade is over');
    } finally { close(host); }
  });

  it('still performs the action of the row that was clicked', () => {
    const host = makeHost();
    try {
      const { window: w, document: d } = host;
      const panel = d.getElementById('moreMenuPanel');
      d.getElementById('moreMenuBtn').click();
      d.getElementById('themeBtn').click();
      assert.equal(w.isMoreMenuOpen(), false, 'the row closes the menu');
      assert.equal(d.getElementById('themeModal').style.display, 'flex',
        'and the dialog it opens still opens');
    } finally { close(host); }
  });

  it('is reachable from the keyboard alone', () => {
    const host = makeHost();
    try {
      const { window: w, document: d } = host;
      const btn = d.getElementById('moreMenuBtn');
      btn.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
      assert.equal(w.isMoreMenuOpen(), true, 'Down opens the menu');
      assert.ok(d.activeElement.classList.contains('more-menu-item'),
        'and lands on the first row, not back on the trigger');

      const first = d.activeElement;
      first.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));
      assert.notEqual(d.activeElement, first, 'Up from the first row wraps to the last');
      assert.ok(d.activeElement.classList.contains('more-menu-item'));
    } finally { close(host); }
  });

  it('closes immediately, with no fade, when reduced motion is set', async () => {
    const host = makeHost();
    try {
      host.window.matchMedia = (q) => ({
        matches: /prefers-reduced-motion:\s*reduce/.test(String(q)),
        media: String(q), addListener() {}, removeListener() {},
        addEventListener() {}, removeEventListener() {}, dispatchEvent() { return false; }
      });
      const { document: d } = host;
      const panel = d.getElementById('moreMenuPanel');
      d.getElementById('moreMenuBtn').click();
      assert.equal(host.window.isMoreMenuOpen(), true);
      d.getElementById('appMainTitle').click();
      assert.equal(panel.hidden, true, 'nothing to fade means no fade window');
    } finally { close(host); }
  });

  it('leaves the panel display rule able to actually hide it', () => {
    // An author-level `display: flex` outranks the user agent's [hidden] rule,
    // so the closed state has to be restated in the stylesheet.
    assert.match(HTML, /\.more-menu-panel\[hidden\]\s*\{[^}]*display:\s*none/);
  });
});

describe('Top bar: icon buttons that also carry a live label', () => {
  it('does not delete its own icon when the label changes', () => {
    const host = makeHost();
    try {
      const { window: w, document: d } = host;
      const sound = d.getElementById('soundBtn');
      const suspense = d.getElementById('suspenseBtn');
      assert.ok(sound.querySelector('svg'), 'sound starts with an icon');
      assert.ok(suspense.querySelector('svg'), 'suspense starts with an icon');

      w.toggleSound();
      assert.ok(d.getElementById('soundBtn').querySelector('svg'),
        'toggleSound must write to the inner label, not to the button');
      assert.notEqual(d.getElementById('soundLabel').textContent, '');

      w.toggleSuspenseMode();
      assert.ok(d.getElementById('suspenseBtn').querySelector('svg'),
        'toggleSuspenseMode must write to the inner label, not to the button');
    } finally { close(host); }
  });

  it('keeps every icon and every label through all three languages', () => {
    const host = makeHost();
    try {
      const { window: w, document: d } = host;
      for (const lang of ['BC', 'BM', 'BI']) {
        w.changeLanguage(lang);
        for (const b of d.querySelectorAll('.top-actions button')) {
          assert.ok(b.querySelector('svg') || b.classList.contains('more-menu-trigger') === false,
            `${lang}: every bar button keeps its icon`);
        }
        const sync = d.getElementById('syncNavBtn');
        assert.ok(sync.querySelector('svg'), `${lang}: sync keeps its icon`);
        assert.ok(sync.querySelector('[data-i18n="navSync"]').textContent.trim().length > 0,
          `${lang}: sync label is translated`);
      }
    } finally { close(host); }
  });

  it('hides the rows viewer mode has no business showing, and keeps the rest', () => {
    const host = createApp({ viewer: true });
    try {
      const { document: d } = host;
      for (const id of ['themeBtn', 'crisisBtn', 'resetBtn']) {
        assert.equal(d.getElementById(id).style.display, 'none',
          `viewer mode must still take ${id} away`);
      }
      assert.notEqual(d.getElementById('moreMenuBtn').style.display, 'none',
        'but the trigger is the only way into the rows viewer mode keeps');
    } finally { close(host); }
  });
});

/* A localization helper bound to one name is convenient right up until a
   function forgets it, and the failure mode is a thrown ReferenceError on an
   error path -- the one place nobody exercises until it matters. These six all
   did exactly that: the message they meant to show never appeared, because
   asking for it threw first. */

describe('Error paths do not throw while looking up their message', () => {
  const cases = [
    ['exportRangeCSV with an empty filter', (w) => w.exportRangeCSV()],
    ['triggerSpotlightFromSearch with an empty box', (w) => {
      w.document.getElementById('searchInput').value = '';
      w.triggerSpotlightFromSearch();
    }],
    ['copyEmceeScript with no winners', (w) => w.copyEmceeScript()],
    ['exportCSV with no winners', (w) => w.exportCSV()],
    ['openPiPBarPopup with popups blocked', (w) => {
      w.open = () => null;
      w.openPiPBarPopup();
    }]
  ];

  for (const lang of ['BC', 'BM', 'BI']) {
    it(`stays quiet in ${lang}`, () => {
      const host = makeHost();
      try {
        host.window.changeLanguage(lang);
        for (const [name, run] of cases) {
          assert.doesNotThrow(() => run(host.window), `${name} threw in ${lang}`);
        }
      } finally { close(host); }
    });
  }

  it('finds no function that reads a translation it never bound', () => {
    const script = HTML.slice(HTML.indexOf('function setupMoreMenu'));
    const lines = script.split('\n');
    const declaresT = /\b(?:const|let|var)\s+t\s*=/;
    const readsT = /(?<![\w.$])t\.[A-Za-z_]/;

    const open = [];
    for (let i = 0; i < lines.length; i++) {
      const start = lines[i].match(/^ {0,4}(?:async\s+)?function\s+(\w+)\s*\(/);
      if (start) open.push({ name: start[1], line: i + 1, depth: 0 });
      const fn = open[open.length - 1];
      if (!fn) continue;
      for (const ch of lines[i]) {
        if (ch === '{') fn.depth++;
        else if (ch === '}') fn.depth--;
      }
      if (fn.depth <= 0) {
        const body = lines.slice(fn.line - 1, i + 1).join('\n');
        assert.ok(declaresT.test(body) || !readsT.test(body),
          `${fn.name} reads "t." but never binds it; every call is a ReferenceError`);
        open.pop();
      }
    }
    assert.equal(open.length, 0, 'every function in the file should close');
  });
});

/* The gong, the tick and the countdown are all synthesised from oscillators
   rather than fetched, so the only cost on the first sound is unlocking the
   AudioContext. Doing that lazily inside the click that is supposed to make
   noise is what puts silence between the operator and the draw. */

describe('The first gesture unlocks audio before anything needs it', () => {
  it('does not build an AudioContext until the operator touches the page', () => {
    const host = makeHost();
    try {
      // Boot alone must not create one: a context built with no gesture is
      // created suspended anyway, and some browsers log a warning for it.
      assert.equal(host.get('audioCtx'), null, 'boot should leave the context unbuilt');
    } finally { close(host); }
  });

  it('builds it on the first gesture and then stops listening', () => {
    const host = makeHost();
    try {
      const { window: w, document: d } = host;
      d.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'a', bubbles: true }));
      assert.ok(host.get('audioCtx'), 'a gesture should unlock the context');
      const first = host.get('audioCtx');
      d.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'b', bubbles: true }));
      assert.equal(host.get('audioCtx'), first,
        'the priming listeners should detach themselves after one use');
    } finally { close(host); }
  });

  it('keeps working on a machine with no audio at all', () => {
    const host = makeHost();
    try {
      host.window.AudioContext = function () { throw new Error('no output device'); };
      // Priming is best-effort; it must not take the page down with it.
      assert.doesNotThrow(() => {
        host.document.dispatchEvent(new host.window.KeyboardEvent('keydown', { key: 'a', bubbles: true }));
      });
    } finally { close(host); }
  });
});

describe('Draw results are announced, not just shown', () => {
  it('says who won, in the operator language, after a batch draw', () => {
    const host = makeHost();
    try {
      const { window: w, document: d } = host;
      w.changeLanguage('BI');
      w.drawTen();
      const said = d.getElementById('drawAnnounce').textContent;
      assert.match(said, /10 winners drawn/, said);
      const drawn = [...d.querySelectorAll('#batchGrid .main-num')].map((n) => n.textContent);
      for (const num of drawn) assert.ok(said.includes(num), `${num} is missing from the announcement`);
    } finally { close(host); }
  });

  it('re-announces when the same batch comes round again', () => {
    // A live region only speaks when its content actually changes, and a reset
    // draw can genuinely produce the same ten numbers. Clearing before writing
    // is what stops a repeat result going silent for the one audience that
    // still needs to hear it.
    const host = makeHost();
    try {
      const { window: w, document: d } = host;
      w.changeLanguage('BI');
      const region = d.getElementById('drawAnnounce');
      w.drawTen();
      const first = region.textContent;
      // Replay the very same announcement, exactly as drawTen built it.
      const replay = () => w.announceDraw('announceDrawn', {
        '{n}': String(host.get('winners').length),
        '{list}': host.get('winners').map((n) => `#${n}`).join(', ')
      });
      replay();
      assert.equal(region.textContent, first, 'the same result must render the same words');
      // takeRecords() drains what is pending synchronously; the observer's own
      // callback is only delivered on a later microtask.
      const obs = new w.MutationObserver(() => {});
      obs.observe(region, { childList: true, characterData: true, subtree: true });
      replay();
      const writes = obs.takeRecords().length;
      assert.ok(writes >= 1,
        'repeating an announcement must still mutate the region, or nothing is spoken');
    } finally { close(host); }
  });

  it('replaces the last announcement rather than appending to it', () => {
    const host = makeHost();
    try {
      const { window: w, document: d } = host;
      w.changeLanguage('BI');
      w.drawTen();
      host.set('winners', []);
      host.set('maxPrizes', 200);
      w.drawTen();
      const said = d.getElementById('drawAnnounce').textContent;
      assert.equal((said.match(/winners drawn/g) || []).length, 1,
        `the region should hold one result, not a running log: "${said}"`);
    } finally { close(host); }
  });

  it('announces a single ticket in every language', () => {
    for (const lang of ['BC', 'BM', 'BI']) {
      const host = makeHost();
      try {
        const { window: w, document: d } = host;
        w.changeLanguage(lang);
        // Inside the configured pool, or the entry is rejected before it wins.
        d.getElementById('manualTicketInput').value = '1234';
        w.confirmManualEntry();
        const said = d.getElementById('drawAnnounce').textContent;
        assert.ok(said.includes('1234'), `${lang}: the ticket is missing from "${said}"`);
        assert.ok(!/\{[a-z]\}/i.test(said), `${lang}: an unreplaced placeholder survived: "${said}"`);
      } finally { close(host); }
    }
  });

  it('lives in a polite live region that is hidden but not display:none', () => {
    const host = makeHost();
    try {
      const el = host.document.getElementById('drawAnnounce');
      assert.equal(el.getAttribute('aria-live'), 'polite');
      assert.equal(el.getAttribute('role'), 'status');
      // Visually hidden, not display:none -- a display:none live region is
      // never announced at all.
      assert.equal(el.style.display, '');
      assert.ok(el.classList.contains('visually-hidden'));
    } finally { close(host); }
  });
});

describe('The active tab tells assistive tech which mode is showing', () => {
  for (const [name, id] of [['batch', 'tabBatchBtn'], ['vip', 'tabVipBtn'], ['manual', 'tabManualBtn']]) {
    it(`marks ${name} as current and unmarks the rest`, () => {
      const host = makeHost();
      try {
        const { window: w, document: d } = host;
        w.switchTab(name);
        const current = [...d.querySelectorAll('.tab-btn')].filter((b) => b.getAttribute('aria-current') === 'true');
        assert.equal(current.length, 1, 'exactly one tab can be current');
        assert.equal(current[0].id, id);
        assert.ok(current[0].classList.contains('active'), 'aria-current and the active class must agree');
      } finally { close(host); }
    });
  }

  it('is correct on first paint, before any tab has been clicked', () => {
    const host = makeHost();
    try {
      const batch = host.document.getElementById('tabBatchBtn');
      assert.equal(batch.getAttribute('aria-current'), 'true',
        'the markup has to ship the initial state, not rely on a first click');
      assert.equal(host.document.getElementById('tabVipBtn').getAttribute('aria-current'), null);
    } finally { close(host); }
  });
});

describe('The overflow trigger is named in every language', () => {
  it('carries a localized accessible name, not just a tooltip', () => {
    for (const lang of ['BC', 'BM', 'BI']) {
      const host = makeHost();
      try {
        const { window: w, document: d } = host;
        w.changeLanguage(lang);
        const btn = d.getElementById('moreMenuBtn');
        const label = btn.getAttribute('aria-label');
        assert.ok(label, `${lang}: the trigger has no accessible name`);
        assert.equal(label, host.get('I18N')[lang].navMore, `${lang}: aria-label was not translated`);
        assert.ok(btn.querySelector('svg'), `${lang}: translating the label must not delete the glyph`);
      } finally { close(host); }
    }
  });
});
