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

/* The neutral scale is declared once in :root and never varies by theme, so a
   theme is only ever the six --accent-* values below. Reading them out of the
   file (rather than hardcoding them here) means this test fails if a theme is
   edited without re-checking its contrast. */
const NEUTRAL = (() => {
  const root = css.match(/:root \{([\s\S]*?)\n {4}\}/)[1];
  const out = {};
  for (const m of root.matchAll(/(--[a-z0-9-]+):\s*(#[0-9a-f]{6})\s*;/g)) out[m[1]] = hex2rgb(m[2]);
  return out;
})();

const THEMES = {};
for (const m of html.matchAll(
  /^ {6}(\w+): \{\n {8}name: "([^"]+)",\n {8}colors: \{\n {10}'--accent': '(#[0-9a-f]{6})', '--accent-rgb': '([\d, ]+)',\n {10}'--accent-contrast': '(#[0-9a-f]{6})',\n {10}'--accent-strong': '(#[0-9a-f]{6})', '--accent-strong-rgb': '([\d, ]+)',\n {10}'--accent-deep': '(#[0-9a-f]{6})',\n {10}'--accent-bright': '(#[0-9a-f]{6})', '--accent-bright-rgb': '([\d, ]+)'(?=\n)/gm
)) {
  THEMES[m[1]] = {
    name: m[2],
    accent: hex2rgb(m[3]),
    rgb: m[4].trim(),
    contrast: hex2rgb(m[5]),
    strong: hex2rgb(m[6]),
    strongRgb: m[7].trim(),
    deep: hex2rgb(m[8]),
    bright: hex2rgb(m[9]),
    brightRgb: m[10].trim(),
  };
}

/* Resolve the full token set for one theme, including the color-mix() tints
   the stylesheet derives from --accent. */
function tokensFor(theme) {
  const surface1 = NEUTRAL['--surface-1'];
  const border = NEUTRAL['--border'];
  return {
    ...NEUTRAL,
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
  it('declares exactly 20 themes', () => {
    assert.equal(Object.keys(THEMES).length, 20);
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

  it('derives accent-strong and accent-deep darker than the accent', () => {
    for (const [id, t] of Object.entries(THEMES)) {
      assert.ok(lum(t.strong) < lum(t.accent), `${id}: --accent-strong must be darker than --accent`);
      assert.ok(lum(t.deep) < lum(t.strong), `${id}: --accent-deep must be darker than --accent-strong`);
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
