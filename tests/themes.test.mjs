import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const html = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'index.html'), 'utf8');
const css = html.match(/<style id="mainStyles">([\s\S]*?)<\/style>/)[1];

const hex2rgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
/* CSS color-mix(in srgb, A p%, B) is p% of A and (100-p)% of B. */
const mixA = (a, b, pctOfA) => a.map((v, i) => v * pctOfA + b[i] * (1 - pctOfA));
const lum = (c) => {
  const a = c.map((v) => {
    v /= 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * a[0] + 0.7152 * a[1] + 0.0722 * a[2];
};
const ratio = (fg, bg) => {
  const l1 = lum(fg);
  const l2 = lum(bg);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
};

/* Neutrals are declared per MODE, not per theme. A theme picks its mode and
   the mode picks the scale, so 10 light themes and 10 dark themes can never
   drift into each other's contrast behaviour. Reading them out of the file
   (rather than hardcoding them here) means editing a scale without re-checking
   its contrast fails this test. */
function readScale(selectorRe) {
  // selectorRe is already a regex fragment; only the block tail is appended.
  const block = css.match(new RegExp(selectorRe + '\\s*\\{([\\s\\S]*?)\\n {4}\\}'));
  if (!block) throw new Error(`could not find token block for ${selectorRe}`);
  const out = {};
  for (const m of block[1].matchAll(/(--[a-z0-9-]+):\s*(#[0-9a-f]{6})\s*;/g)) out[m[1]] = hex2rgb(m[2]);
  // companions like --success-rgb: 14, 112, 61 are used as rgba(var(...), a)
  for (const m of block[1].matchAll(/(--[a-z0-9-]+-rgb):\s*([\d, ]+?)\s*;/g)) {
    out[m[1]] = m[2].trim();
  }
  return out;
}
const LIGHT = readScale(':root,\n    \\[data-mode="light"\\]');
const DARK = readScale('\\[data-mode="dark"\\]');

/* The stage is deliberately dark in BOTH modes: a projector in a dim hall
   washes out on a light ground, and the desktop bar floats over a desktop.
   It therefore lives in the shared block and is merged into every scale. */
const SHARED = (() => {
  for (const m of css.matchAll(/([^{}]+)\{([\s\S]*?)\n {4}\}/g)) {
    if (m[2].includes('--stage-bg:')) {
      const out = {};
      for (const t of m[2].matchAll(/(--[a-z0-9-]+):\s*(#[0-9a-f]{6})\s*;/g)) out[t[1]] = hex2rgb(t[2]);
      return out;
    }
  }
  throw new Error('no token block declares --stage-bg');
})();
for (const scale of [LIGHT, DARK]) Object.assign(scale, SHARED);

const THEMES = {};
for (const m of html.matchAll(
  /^ {6}(\w+): \{\n {8}mode: "(light|dark)",\n {8}name: "([^"]+)",\n {8}colors: \{\n {10}'--accent': '(#[0-9a-f]{6})', '--accent-rgb': '([\d, ]+)',\n {10}'--accent-contrast': '(#[0-9a-f]{6})',\n {10}'--accent-strong': '(#[0-9a-f]{6})', '--accent-strong-rgb': '([\d, ]+)',\n {10}'--accent-deep': '(#[0-9a-f]{6})',\n {10}'--accent-bright': '(#[0-9a-f]{6})', '--accent-bright-rgb': '([\d, ]+)'(?=\n)/gm
)) {
  THEMES[m[1]] = {
    mode: m[2],
    name: m[3],
    accent: hex2rgb(m[4]),
    rgb: m[5].trim(),
    contrast: hex2rgb(m[6]),
    strong: hex2rgb(m[7]),
    strongRgb: m[8].trim(),
    deep: hex2rgb(m[9]),
    bright: hex2rgb(m[10]),
    brightRgb: m[11].trim(),
  };
}
const scaleFor = (mode) => (mode === 'dark' ? DARK : LIGHT);

/* The festival tag sits after `colors` in each entry, so the main regex above
   cannot see it. Entry boundaries have to be walked explicitly here: a lazy
   match from one entry's opener to the first `fest` line it meets would happily
   swallow every base theme in between and tag the whole prefix with one
   festival. Split on the openers, then look inside each slice. */
const FESTIVALS = {};
{
  const openers = [...html.matchAll(/^ {6}(\w+): \{$/gm)];
  for (let i = 0; i < openers.length; i++) {
    const from = openers[i].index + openers[i][0].length;
    const to = i + 1 < openers.length ? openers[i + 1].index : html.length;
    const body = html.slice(from, to);
    const fest = body.match(/^ {8}fest: "([a-zA-Z]+)"$/m);
    if (fest) FESTIVALS[openers[i][1]] = { fest: fest[1], mode: THEMES[openers[i][1]] && THEMES[openers[i][1]].mode };
  }
}

/* Resolve the full token set for one theme, including the color-mix() tints
   the stylesheet derives from --accent. */
function tokensFor(theme) {
  const neutral = scaleFor(theme.mode);
  const surface1 = neutral['--surface-1'];
  const border = neutral['--border'];
  return {
    ...neutral,
    '--accent': theme.accent,
    '--accent-contrast': theme.contrast,
    '--accent-strong': theme.strong,
    '--accent-deep': theme.deep,
    '--accent-bright': theme.bright,
    '--accent-soft': mixA(theme.accent, surface1, 0.08),
    '--accent-soft-2': mixA(theme.accent, surface1, 0.14),
    '--accent-line': mixA(theme.accent, border, 0.26),
  };
}

/* Every foreground/background pair the stylesheet actually creates. 4.5 is
   WCAG AA for body text; 3.0 is AA for UI borders and large display text. */
const PAIRS = [
  ['--text', '--bg', 4.5, 'body text on page'],
  ['--text', '--surface-1', 4.5, 'text on card'],
  ['--text', '--surface-2', 4.5, 'text on raised surface'],
  ['--text', '--surface-3', 4.5, 'text on inset surface'],
  ['--text-2', '--surface-1', 4.5, 'secondary text on card'],
  ['--text-2', '--surface-2', 4.5, 'secondary text on raised surface'],
  ['--text-3', '--surface-1', 4.5, 'muted text on card'],
  ['--text-3', '--surface-2', 4.5, 'muted text on raised surface'],
  ['--text', '--surface-input', 4.5, 'input text'],
  ['--text', '--success-soft', 4.5, 'text on success tint'],
  ['--text', '--danger-soft', 4.5, 'text on danger tint'],
  ['--success', '--success-soft', 4.5, 'success label on success tint'],
  ['--danger', '--danger-soft', 4.5, 'danger label on danger tint'],
  ['--warning', '--warning-soft', 4.5, 'warning label on warning tint'],
  ['--accent', '--surface-1', 4.5, 'accent text on card'],
  ['--accent', '--bg', 4.5, 'accent on page'],
  ['--accent-bright', '--stage-bg', 4.5, 'bright accent on stage background'],
  ['--accent-bright', '--stage-surface', 4.5, 'bright accent on stage card'],
  ['--stage-bg', '--accent-bright', 4.5, 'dark label on bright accent chip'],
  ['--accent', '--surface-1', 3.0, 'accent border on the light winning-number panel'],
  ['--accent-contrast', '--accent', 4.5, 'label on accent button'],
  ['--accent-contrast', '--accent-strong', 4.5, 'label on accent button hover'],
  ['--text', '--accent-soft', 4.5, 'text on accent tint'],
  ['--text', '--accent-soft-2', 4.5, 'text on stronger accent tint'],
  ['--stage-text', '--stage-bg', 4.5, 'stage text on stage background'],
  ['--stage-text', '--stage-surface', 4.5, 'stage text on stage card'],
  ['--stage-text-2', '--stage-surface', 4.5, 'stage muted text on stage card'],
  ['--stage-text-2', '--stage-surface-2', 4.5, 'stage muted text on stage chip'],
  ['--accent-line', '--bg', 1.4, 'card edge against page'],
];

describe('theme palette alignment', () => {
  it('declares every theme it promises', () => {
    // 20 base hues (10 light, 10 dark) plus a light and a dark variant for
    // each of the 8 festivals. The base count is the floor that the contrast
    // and alias tests below were written against, so it is checked separately
    // rather than being allowed to drift with the festival list.
    assert.ok(Object.keys(THEMES).length >= 20, 'the base palette must not shrink');
  });

  it('ships a light and a dark variant of every festival', () => {
    const fests = new Map();
    for (const [id, t] of Object.entries(FESTIVALS)) {
      if (!fests.has(t.fest)) fests.set(t.fest, []);
      fests.get(t.fest).push({ id, mode: t.mode });
    }
    const expected = [
      'chineseNewYear', 'tanglung', 'hariRaya', 'deepavali',
      'gawai', 'christmas', 'vesakDay', 'thaipusam'
    ];
    assert.deepEqual([...fests.keys()].sort(), [...expected].sort(),
      'the festival list should not change without the picker labels following it');
    for (const [fest, list] of fests) {
      assert.deepEqual(list.map((v) => v.mode).sort(), ['dark', 'light'],
        `${fest} must offer both a light and a dark variant`);
    }
  });

  it('gives no base theme a festival tag', () => {
    for (const [id, t] of Object.entries(THEMES)) {
      if (FESTIVALS[id]) continue;
      assert.equal(t.fest, undefined, `${id} is a base hue and should not claim a festival`);
    }
  });

  it('gives every theme a display name', () => {
    for (const [id, t] of Object.entries(THEMES)) {
      assert.ok(t.name && t.name.length > 3, `${id} needs a human-readable name`);
    }
  });

  it('keeps every -rgb companion value in sync with its hex value', () => {
    for (const [id, t] of Object.entries(THEMES)) {
      assert.equal(t.rgb, t.accent.join(', '), `${id}: --accent-rgb does not match --accent`);
      assert.equal(t.strongRgb, t.strong.join(', '), `${id}: --accent-strong-rgb does not match --accent-strong`);
      assert.equal(t.brightRgb, t.bright.join(', '), `${id}: --accent-bright-rgb does not match --accent-bright`);
    }
  });

  it('keeps the base palette at 10 light and 10 dark', () => {
    const base = Object.entries(THEMES).filter(([id]) => !FESTIVALS[id]);
    const light = base.filter(([, t]) => t.mode === 'light');
    const dark = base.filter(([, t]) => t.mode === 'dark');
    assert.equal(light.length, 10, 'expected 10 base light themes');
    assert.equal(dark.length, 10, 'expected 10 base dark themes');
  });

  it('keeps the whole set mode-balanced, festivals included', () => {
    // Every section of the picker has to offer a real choice, so the totals
    // cannot quietly tilt as festivals are added.
    const light = Object.entries(THEMES).filter(([, t]) => t.mode === 'light');
    const dark = Object.entries(THEMES).filter(([, t]) => t.mode === 'dark');
    assert.equal(light.length, dark.length,
      'light and dark must stay equal across base and festival themes combined');
  });

  it('keeps one ink per mode, and every shade readable under it', () => {
    // The bug this guards: picking the ink per-theme by luminance let sky/lime
    // end up with dark ink on a dark shade, collapsing to 1.09:1.
    for (const [id, t] of Object.entries(THEMES)) {
      const want = t.mode === 'light' ? [255, 255, 255] : [11, 13, 16];
      for (const [shade, label] of [[t.accent, 'accent'], [t.strong, 'accent-strong'], [t.deep, 'accent-deep']]) {
        const got = ratio(want, shade);
        assert.ok(got >= 4.5, `${id}/${t.mode}: ${label} under ${t.mode} ink is ${got.toFixed(2)}:1, needs 4.5:1`);
      }
      assert.deepEqual(t.contrast, want, `${id}: --accent-contrast must be the ${t.mode} ink`);
    }
  });

  it('moves accent-strong toward the readable direction for its mode', () => {
    for (const [id, t] of Object.entries(THEMES)) {
      if (t.mode === 'light') {
        assert.ok(lum(t.strong) < lum(t.accent), `${id}: light --accent-strong must be darker than --accent`);
        assert.ok(lum(t.deep) < lum(t.strong), `${id}: light --accent-deep must be darker than --accent-strong`);
      } else {
        // On dark, --accent-strong is painted as text on a dark page, so it
        // must be LIGHTER than the accent, not darker.
        assert.ok(lum(t.strong) > lum(t.accent), `${id}: dark --accent-strong must be lighter than --accent to read as text`);
      }
      assert.ok(lum(t.bright) > lum(t.accent), `${id}: --accent-bright must be lighter than --accent`);
    }
  });

  it('passes WCAG AA on every text/background pair in every theme', () => {
    const failures = [];
    for (const [id, theme] of Object.entries(THEMES)) {
      const t = tokensFor(theme);
      for (const [fg, bg, min, label] of PAIRS) {
        const got = ratio(t[fg], t[bg]);
        if (got < min) {
          failures.push(`${id} (${theme.name}): ${label} = ${got.toFixed(2)}:1, needs ${min}:1`);
        }
      }
    }
    assert.deepEqual(failures, [], `\n${failures.join('\n')}`);
  });
});

describe('design token integrity', () => {
  it('defines every custom property the stylesheet uses', () => {
    const defined = new Set([...css.matchAll(/(--[a-z0-9-]+)\s*:/g)].map((m) => m[1]));
    const used = new Set([...css.matchAll(/var\((--[a-z0-9-]+)/g)].map((m) => m[1]));
    // --proj-timer-font is written by script at runtime.
    const undef = [...used].filter((v) => !defined.has(v) && v !== '--proj-timer-font');
    assert.deepEqual(undef, []);
  });

  it('keeps CSS braces balanced', () => {
    assert.equal((css.match(/{/g) || []).length, (css.match(/}/g) || []).length);
  });

  it('has no gradients or hardcoded black/white surfaces left', () => {
    assert.equal((css.match(/gradient\(/g) || []).length, 0, 'gradients should be gone from a flat design');
    assert.equal((css.match(/background: #000/g) || []).length, 0, 'use --stage-* instead of #000');
  });

  it('ships no emoji or dingbat glyphs anywhere in the file', () => {
    const pictographic = html.match(/\p{Extended_Pictographic}/gu) || [];
    assert.deepEqual(
      pictographic,
      [],
      `emoji found in the file: ${[...new Set(pictographic)].join(' ')}`
    );
    const regional = html.match(/[\u{1F1E6}-\u{1F1FF}]/gu) || [];
    assert.deepEqual(regional, [], 'regional-indicator flag sequences are emoji');
    const keycaps = html.match(/\u{20E3}/gu) || [];
    assert.deepEqual(keycaps, [], 'keycap sequences are emoji');
    const dingbats = [...new Set(html.match(/[\u{2700}-\u{27BF}]/gu) || [])];
    assert.deepEqual(
      dingbats,
      [],
      `use inline SVG icons instead of these glyphs: ${dingbats.join(' ')}`
    );
  });

  it('renders inline SVG glyphs for the close and confirm affordances', () => {
    assert.ok(html.includes('class="icon-glyph"'), 'icon glyph helper must exist');
    assert.ok(css.includes('.icon-glyph'), 'icon glyph needs sizing so it aligns with button text');
  });

  it('leaves no light surface tokens inside the dark stage surfaces', () => {
    const leaks = [];
    for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const selector = m[1].trim().replace(/\s+/g, ' ');
      if (!/^(#projectorView|#pipBarView|\.proj-|\.pip-)/.test(selector)) continue;
      // The winning-number block is a deliberately light panel on the dark card.
      const allowed = /proj-vip-num/.test(selector) ? ['--surface-1', '--surface-result'] : [];
      const found = [...m[2].matchAll(/var\((--(?:surface-[123]|text|text-2|text-3|border|border-subtle|border-strong|bg|bg-2))\)/g)]
        .map((x) => x[1])
        .filter((v) => !allowed.includes(v));
      for (const v of new Set(found)) leaks.push(`${selector} uses ${v}`);
    }
    assert.deepEqual(leaks, []);
  });
});

describe('legacy theme aliases stay resolvable', () => {
  it('maps every pre-redesign id onto a theme that still exists', () => {
    const block = html.match(/const LEGACY_THEME_ALIAS = \{([\s\S]*?)\n {4}\}/);
    assert.ok(block, 'LEGACY_THEME_ALIAS must exist so old saved themes still load');

    const pairs = [...block[1].matchAll(/(\w+):\s*'(\w+)'/g)]
      .map(([, from, to]) => ({ from, to }));

    assert.ok(pairs.length > 0, 'alias table should not be empty');

    const dangling = pairs.filter((e) => !(e.to in THEMES));
    assert.deepEqual(
      dangling,
      [],
      `aliases pointing at themes that no longer exist: ${JSON.stringify(dangling)}`
    );
  });
});

describe('light and dark scales are independently valid', () => {
  it('keeps the status ink readable on every solid status chip in both modes', () => {
    for (const [mode, N] of [['light', LIGHT], ['dark', DARK]]) {
      for (const s of ['success', 'success-strong', 'warning', 'danger', 'danger-strong', 'info']) {
        const got = ratio(N['--on-status'], N['--' + s]);
        assert.ok(got >= 4.5, `${mode}: ink on --${s} is ${got.toFixed(2)}:1, needs 4.5:1`);
      }
    }
  });

  it('keeps each status label readable on its own tint', () => {
    // Regression: darkening the tints until they read as visible chips dragged
    // the status labels down with them (success label was 3.82:1).
    for (const [mode, N] of [['light', LIGHT], ['dark', DARK]]) {
      for (const [fg, bg] of [['success', 'success-soft'], ['warning', 'warning-soft'],
                              ['danger', 'danger-soft'], ['info', 'info-soft']]) {
        const got = ratio(N['--' + fg], N['--' + bg]);
        assert.ok(got >= 4.5, `${mode}: --${fg} on --${bg} is ${got.toFixed(2)}:1, needs 4.5:1`);
      }
    }
  });

  it('makes every status tint visible as a chip, not a wash', () => {
    for (const [mode, N] of [['light', LIGHT], ['dark', DARK]]) {
      for (const s of ['success-soft', 'warning-soft', 'danger-soft', 'info-soft']) {
        const got = ratio(N['--' + s], N['--surface-1']);
        assert.ok(got >= 1.32, `${mode}: --${s} against the card is ${got.toFixed(2)}:1, needs 1.32:1`);
      }
    }
  });

  it('declares the two scales from one shared stage and accent set', () => {
    for (const t of ['--stage-bg', '--stage-surface', '--stage-text', '--scrim']) {
      assert.deepEqual(LIGHT[t], DARK[t], `${t} must be mode-independent`);
    }
    for (const t of ['--bg', '--surface-1', '--text', '--border']) {
      assert.notDeepEqual(LIGHT[t], DARK[t], `${t} must differ between modes, or dark themes are fake`);
    }
  });

  it('keeps the -rgb companions in step with the status hexes', () => {
    for (const N of [LIGHT, DARK]) {
      for (const s of ['success', 'danger']) {
        const [r, g, b] = N[`--${s}`];
        assert.equal(N[`--${s}-rgb`], `${r}, ${g}, ${b}`, `--${s}-rgb is out of step with --${s}`);
      }
    }
  });
});

/* Token-level tests prove the PALETTE is sound. They cannot prove the
   stylesheet actually pairs those tokens correctly -- and that is where the
   real bugs lived: `.tab-btn.active` and `.btn-manual-confirm` both declared
   `color: var(--accent)` on `background: var(--accent)`, rendering the active
   tab and the manual-entry confirm button at 1.00:1 (invisible) in all 20
   themes, while every token-pair test still passed. So walk every rule, pair up
   its color and background tokens, and check the combination actually used. */
describe('every rule pairs its tokens legibly', () => {
  const RULES = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].filter(
    ([sel]) => !/^(@|:root|\[data-mode)/.test(sel.trim().replace(/\s+/g, ' '))
  );

  it('finds the rules to audit', () => {
    assert.ok(RULES.length > 100, `only found ${RULES.length} rules; the parser has drifted`);
  });

  const pairs = [];
  for (const theme of Object.values(THEMES)) {
    const T = tokensFor(theme);
    for (const [, sel, body] of RULES) {
      const fg = body.match(/(?:^|;)\s*color:\s*var\((--[a-z0-9-]+)\)/);
      const bg = body.match(/(?:^|;)\s*background(?:-color)?:\s*var\((--[a-z0-9-]+)\)/);
      if (!fg || !bg || !T[fg[1]] || !T[bg[1]]) continue;
      // Only the element's own declarations are checked; inherited foregrounds
      // resolve through the token PAIRS list above.
      const size = parseFloat((body.match(/font-size:\s*([\d.]+)px/) || [])[1] || '0');
      const weight = parseInt((body.match(/font-weight:\s*(\d+)/) || [])[1] || '400');
      const large = size >= 24 || (size >= 18.66 && weight >= 700);
      pairs.push({
        selector: sel.trim().replace(/\s+/g, ' '),
        fg: fg[1], bg: bg[1],
        min: large ? 3 : 4.5,
        got: ratio(T[fg[1]], T[bg[1]]),
      });
    }
  }

  it('audits a meaningful number of real combinations', () => {
    assert.ok(pairs.length > 400, `only ${pairs.length} rule/theme pairs parsed`);
  });

  it('renders no rule at 1:1 (a same-token color/background is always a bug)', () => {
    const invisible = pairs.filter((p) => p.got < 1.05);
    assert.deepEqual(
      invisible.map((p) => `${p.selector} { color:${p.fg}; background:${p.bg} }`),
      [],
      'these rules paint text in the same colour as their own background, so they are invisible'
    );
  });

  it('meets its contrast floor in every theme', () => {
    const failures = new Map();
    for (const p of pairs) {
      if (p.got >= p.min) continue;
      const key = `${p.selector} { color:${p.fg}; background:${p.bg} } needs ${p.min}`;
      const prev = failures.get(key);
      if (!prev || p.got < prev) failures.set(key, p.got);
    }
    assert.deepEqual(
      [...failures].map(([rule, got]) => `${got.toFixed(2)}:1  ${rule}`),
      [],
      'rule/theme combinations below their WCAG floor'
    );
  });

  it('never pairs a foreground with a background of the same token', () => {
    const same = RULES.filter(([, , body]) => {
      const fg = (body.match(/(?:^|;)\s*color:\s*var\((--[a-z0-9-]+)\)/) || [])[1];
      const bg = (body.match(/(?:^|;)\s*background(?:-color)?:\s*var\((--[a-z0-9-]+)\)/) || [])[1];
      return fg && fg === bg;
    }).map(([, sel]) => sel.trim().replace(/\s+/g, ' '));
    assert.deepEqual(same, [], 'a rule sets color and background to the same custom property');
  });
});

describe('theme words render correctly in every language', () => {
  it('keeps no mode word baked into a theme name', () => {
    // Names used to carry a hardcoded "(淺色)"/"(深色)", which stayed Chinese
    // when the operator switched to BM or BI. The mode is conveyed by the
    // localized group heading and the localized toast suffix instead.
    for (const [id, t] of Object.entries(THEMES)) {
      assert.equal(/[淺深]色/.test(t.name), false, `${id} name still bakes in a Chinese mode word: ${t.name}`);
      assert.equal(/\((?:light|dark)\)/i.test(t.name), false, `${id} name still bakes in an English mode word`);
    }
  });

  it('gives every language its own light and dark mode words', () => {
    for (const m of html.matchAll(/(BC|BM|BI):\s*\{([\s\S]*?)\n {6}\},?\n/g)) {
      const [, lang, body] = m;
      const light = (body.match(/themeModeLight:\s*"([^"]+)"/) || [])[1];
      const dark = (body.match(/themeModeDark:\s*"([^"]+)"/) || [])[1];
      assert.ok(light, `${lang} is missing themeModeLight`);
      assert.ok(dark, `${lang} is missing themeModeDark`);
      assert.notEqual(light, dark, `${lang} uses the same word for light and dark`);
    }
  });

  it('shows every swatch, festivals first, under localized headings', async () => {
    const { createApp } = await import('./_harness.mjs');
    const host = createApp({ master: true });
    try {
      const { window: w, document: d } = host;
      const total = Object.keys(THEMES).length;
      for (const lang of ['BC', 'BM', 'BI']) {
        w.changeLanguage(lang);
        w.toggleThemeModal(true);
        const dict = host.get('I18N')[lang];
        const modal = d.getElementById('themeModal');
        assert.equal(modal.style.display, 'flex', `${lang}: picker did not open`);
        assert.equal(d.querySelectorAll('.theme-swatch').length, total, `${lang}: wrong swatch count`);
        /* One section per festival -- the operator asked for named festivals,
           not a single undifferentiated "festivals" bucket -- plus the two base
           mode sections. */
        const festKeys = [...new Set(Object.values(FESTIVALS).map((f) => f.fest))];
        assert.equal(d.querySelectorAll('.theme-group').length, festKeys.length + 2,
          `${lang}: expected one section per festival plus the two base sections`);
        const groups = [...d.querySelectorAll('.theme-group')];
        const titles = [...d.querySelectorAll('.theme-group-title')].map((e) => e.textContent.trim());

        // Festivals lead, because that is why the picker gets opened at all.
        festKeys.forEach((fest, i) => {
          const key = 'fest' + fest.charAt(0).toUpperCase() + fest.slice(1);
          assert.ok(titles[i] && titles[i].includes(dict[key]),
            `${lang}: section ${i + 1} should be the ${fest} heading, got "${titles[i]}"`);
        });
        assert.ok(titles[festKeys.length].includes(dict.themeGroupLight),
          `${lang}: the base light heading is in the wrong place (${titles[festKeys.length]})`);
        assert.ok(titles[festKeys.length + 1].includes(dict.themeGroupDark),
          `${lang}: the base dark heading is in the wrong place (${titles[festKeys.length + 1]})`);

        // Each festival section holds only its own pair, and both variants of a
        // festival land in the same section -- otherwise the operator has to
        // hunt for the dark one somewhere else on the grid.
        festKeys.forEach((fest, i) => {
          const ids = [...groups[i].querySelectorAll('.theme-swatch')]
            .map((b) => b.getAttribute('onclick').match(/'(\w+)'/)[1]);
          assert.equal(ids.length, 2, `${lang}: ${fest} should show exactly a light and a dark variant`);
          for (const id of ids) {
            assert.equal(FESTIVALS[id].fest, fest, `${lang}: ${id} does not belong under ${fest}`);
          }
        });
        // No base hue may leak into a festival section.
        const baseGroups = groups.slice(festKeys.length);
        const baseIds = [...baseGroups.flatMap((g) => [...g.querySelectorAll('.theme-swatch')])]
          .map((b) => b.getAttribute('onclick').match(/'(\w+)'/)[1]);
        assert.equal(baseIds.length, Object.keys(THEMES).length - Object.keys(FESTIVALS).length,
          `${lang}: the base sections should hold exactly the non-festival themes`);
        // No swatch label may leak a mode word from another language.
        for (const n of d.querySelectorAll('.theme-swatch-name')) {
          assert.equal(/[淺深]色/.test(n.textContent), false, `${lang}: swatch label leaks a Chinese mode word: ${n.textContent}`);
        }
        w.toggleThemeModal(false);
      }
    } finally {
      host.dom.window.close();
    }
  });

  it('previews each festival swatch against the neutrals of its own mode', async () => {
    // The festivals section mixes light and dark cards on purpose, so the
    // heading chrome has to follow the CURRENT mode while each card follows its
    // own. Getting this backwards paints dark-mode cards with light backgrounds.
    const { createApp } = await import('./_harness.mjs');
    const host = createApp({ master: true });
    try {
      const { window: w, document: d } = host;
      w.toggleThemeModal(true);
      const lightBg = w.getComputedStyle(d.querySelector('[data-mode="light"]') || d.body)
        .getPropertyValue('--bg').trim();
      for (const id of Object.keys(FESTIVALS)) {
        const card = d.querySelector(`.theme-swatch[onclick="setTheme('${id}')"]`);
        assert.ok(card, `${id} has no swatch`);
        const bg = card.getAttribute('style').match(/background:\s*(#[0-9a-f]{6})/)[1];
        if (FESTIVALS[id].mode === 'light') {
          assert.equal(bg, lightBg, `${id} is a light theme and should sit on light neutrals`);
        } else {
          assert.notEqual(bg, lightBg, `${id} is a dark theme and should not sit on light neutrals`);
        }
      }
    } finally {
      host.dom.window.close();
    }
  });

  it('applies the mode of the theme that was actually chosen', async () => {
    const { createApp } = await import('./_harness.mjs');
    const host = createApp({ master: true });
    try {
      const { window: w, document: d } = host;
      for (const [id, t] of Object.entries(THEMES)) {
        w.applyTheme(id);
        assert.equal(d.documentElement.getAttribute('data-mode'), t.mode, `${id} should set data-mode=${t.mode}`);
        const bg = w.getComputedStyle(d.body).getPropertyValue('--bg').trim();
        assert.match(bg, /^#[0-9a-f]{6}$/, `${id} left --bg unresolved`);
      }
    } finally {
      host.dom.window.close();
    }
  });
});

/* Every bug fixed above lived in an inline style="..." attribute, not in the
   <style> block, so a stylesheet-only audit waves straight past them. These
   checks read the markup, which is why the theme picker and the crisis toolbox
   both went unnoticed: the picker built its colors from ${n.text}-style runtime
   values and the toolbox hardcoded #fff and rgba(255,255,255,0.05). */
describe('inline styles follow the theme too', () => {
  const INLINE = [...html.matchAll(/style="([^"]*)"/g)].map((m) => m[1]);
  const STATIC = INLINE.filter((v) => !v.includes('${'));

  it('finds the inline styles to audit', () => {
    assert.ok(STATIC.length > 50, `only found ${STATIC.length} static inline styles; parser drift`);
  });

  const problems = [];
  for (const theme of Object.values(THEMES)) {
    const T = tokensFor(theme);
    for (const style of STATIC) {
      const fg = (style.match(/(?:^|;)\s*color:\s*var\((--[a-z0-9-]+)\)/) || [])[1];
      if (!fg || !T[fg]) continue;
      // A gradient counts as every stop it interpolates through: the ink has to
      // survive the whole ramp, not just the midpoint.
      const bgDecl = (style.match(/(?:^|;)\s*background(?:-color)?:[^;]*/) || [''])[0];
      const bgs = [...bgDecl.matchAll(/var\((--[a-z0-9-]+)\)/g)].map((m) => m[1]);
      for (const bg of bgs) {
        if (!T[bg]) continue;
        const got = ratio(T[fg], T[bg]);
        if (got < 4.5) problems.push(`${theme.name} ${theme.mode}: ${style} -> ${got.toFixed(2)}:1`);
      }
    }
  }

  it('never drops an inline label below 4.5:1 in any theme', () => {
    const unique = [...new Set(problems.map((p) => p.replace(/^[^:]+: /, '')))];
    assert.deepEqual(unique, [], 'inline style combinations that are not legible');
  });

  it('has no hardcoded light or dark ink in a color declaration', () => {
    // #fff on a solid chip and #000 on a surface both looked fine in one mode
    // and failed in the other; --on-status / --bg / --text are the paired inks.
    const offenders = [...html.matchAll(/(?:^|[\s;{])color:\s*(#[0-9a-f]{3,8})\b/g)]
      .map((m) => m[1])
      .filter((c) => /^#(fff|ffffff|000|000000)$/i.test(c));
    assert.deepEqual([...new Set(offenders)], [], 'literal white/black text must use a token');
  });

  it('has no literal white/black surface outside the two that need one', () => {
    // Three surfaces are literal on purpose: the audience QR needs an opaque
    // white quiet zone or scanners refuse it, the picture-in-picture window is
    // always the dark stage, and a scrim dims what is behind it in both modes.
    // Every other surface must follow the mode.
    const ALLOWED = [
      { re: /\.qr-box\s*\{[^}]*background:\s*#fff/s, why: 'QR quiet zone must stay opaque white' },
      { re: /background:\s*#000\s*!important/, why: 'the PiP window is always the dark stage' },
      { re: /#spotlightModal\s*\{[\s\S]*?background:\s*rgba\(0,\s*0,\s*0,/, why: 'a scrim dims what is behind it in both modes' },
    ];
    for (const [i, m] of [...html.matchAll(/background(?:-color)?:\s*(#[0-9a-f]{3,8}|rgba\(\s*(?:0|255)[^)]*\))/gi)].entries()) {
      const line = html.slice(0, m.index);
      const context = html.slice(Math.max(0, m.index - 120), m.index + 40);
      const hit = ALLOWED.find((a) => a.re.test(context));
      assert.ok(hit, `literal surface ${m[1]} at offset ${m.index} is not one of the allowed exceptions: ${context.trim().slice(-90)}`);
      void i; void line;
    }
  });
});
