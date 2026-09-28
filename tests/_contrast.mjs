/* Fast local contrast report. Mirrors the maths in themes.test.mjs so a palette
   edit can be checked in milliseconds instead of running the whole suite. */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const html = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'index.html'), 'utf8');
const css = html.match(/<style id="mainStyles">([\s\S]*?)<\/style>/)[1];

const hex2rgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
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
const r2 = (n) => Math.round(n * 100) / 100;

function readScale(selectorRe) {
  const block = css.match(new RegExp(selectorRe + '\\s*\\{([\\s\\S]*?)\\n {4}\\}'));
  if (!block) throw new Error(`could not find token block for ${selectorRe}`);
  const out = {};
  for (const m of block[1].matchAll(/(--[a-z0-9-]+):\s*(#[0-9a-f]{6})\s*;/g)) out[m[1]] = hex2rgb(m[2]);
  for (const m of block[1].matchAll(/(--[a-z0-9-]+-rgb):\s*([\d, ]+?)\s*;/g)) out[m[1]] = m[2].trim();
  return out;
}
const LIGHT = readScale(':root,\n    \\[data-mode="light"\\]');
const DARK = readScale('\\[data-mode="dark"\\]');
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
    mode: m[2], name: m[3], accent: hex2rgb(m[4]), rgb: m[5].trim(), contrast: hex2rgb(m[6]),
    strong: hex2rgb(m[7]), strongRgb: m[8].trim(), deep: hex2rgb(m[9]),
    bright: hex2rgb(m[10]), brightRgb: m[11].trim(),
  };
}
const scaleFor = (mode) => (mode === 'dark' ? DARK : LIGHT);
function tokensFor(theme) {
  const neutral = scaleFor(theme.mode);
  const surface1 = neutral['--surface-1'];
  const border = neutral['--border'];
  return {
    ...neutral,
    '--accent': theme.accent, '--accent-contrast': theme.contrast,
    '--accent-strong': theme.strong, '--accent-deep': theme.deep, '--accent-bright': theme.bright,
    '--accent-soft': mixA(theme.accent, surface1, 0.08),
    '--accent-soft-2': mixA(theme.accent, surface1, 0.14),
    '--accent-line': mixA(theme.accent, border, 0.26),
  };
}

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
  ['--accent', '--surface-1', 3.0, 'accent border on winning-number panel'],
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

const RULES = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].filter(
  ([sel]) => !/^(@|:root|\[data-mode)/.test(sel.trim().replace(/\s+/g, ' '))
);

export function report({ verbose = false } = {}) {
  const fails = [];
  const tight = [];

  for (const mode of ['light', 'dark']) {
    const N = mode === 'dark' ? DARK : LIGHT;
    for (const s of ['success', 'success-strong', 'warning', 'danger', 'danger-strong', 'info']) {
      const got = ratio(N['--on-status'], N['--' + s]);
      if (got < 4.5) fails.push(`${mode}: ink on --${s} = ${r2(got)}:1 (needs 4.5)`);
    }
    for (const [fg, bg] of [['success', 'success-soft'], ['warning', 'warning-soft'],
                            ['danger', 'danger-soft'], ['info', 'info-soft']]) {
      const got = ratio(N['--' + fg], N['--' + bg]);
      if (got < 4.5) fails.push(`${mode}: --${fg} on --${bg} = ${r2(got)}:1 (needs 4.5)`);
    }
    for (const s of ['success-soft', 'warning-soft', 'danger-soft', 'info-soft']) {
      const got = ratio(N['--' + s], N['--surface-1']);
      if (got < 1.32) fails.push(`${mode}: --${s} vs card = ${r2(got)}:1 (needs 1.32)`);
    }
    for (const t of ['--success', '--danger']) {
      const [rr, gg, bb] = N[t];
      if (N[t + '-rgb'] !== `${rr}, ${gg}, ${bb}`) fails.push(`${mode}: ${t}-rgb out of step`);
    }
  }

  for (const [id, theme] of Object.entries(THEMES)) {
    const want = theme.mode === 'light' ? [255, 255, 255] : [11, 13, 16];
    for (const [shade, label] of [[theme.accent, 'accent'], [theme.strong, 'accent-strong'], [theme.deep, 'accent-deep']]) {
      const got = ratio(want, shade);
      if (got < 4.5) fails.push(`${id}: ${label} under ${theme.mode} ink = ${r2(got)}:1 (needs 4.5)`);
    }
    if (theme.rgb !== theme.accent.join(', ')) fails.push(`${id}: --accent-rgb out of step`);
    if (theme.strongRgb !== theme.strong.join(', ')) fails.push(`${id}: --accent-strong-rgb out of step`);
    if (theme.brightRgb !== theme.bright.join(', ')) fails.push(`${id}: --accent-bright-rgb out of step`);
    if (theme.mode === 'light') {
      if (!(lum(theme.strong) < lum(theme.accent))) fails.push(`${id}: light strong not darker than accent`);
      if (!(lum(theme.deep) < lum(theme.strong))) fails.push(`${id}: light deep not darker than strong`);
    } else if (!(lum(theme.strong) > lum(theme.accent))) {
      fails.push(`${id}: dark strong not lighter than accent`);
    }
    if (!(lum(theme.bright) > lum(theme.accent))) fails.push(`${id}: bright not lighter than accent`);

    const T = tokensFor(theme);
    for (const [fg, bg, min, label] of PAIRS) {
      const got = ratio(T[fg], T[bg]);
      if (got < min) fails.push(`${id} (${theme.name}): ${label} = ${r2(got)}:1 (needs ${min})`);
      else if (min === 4.5 && got < min + 0.6) tight.push(`${id} ${label} = ${r2(got)}:1`);
    }
  }

  let pairs = 0;
  for (const theme of Object.values(THEMES)) {
    const T = tokensFor(theme);
    for (const [, sel, body] of RULES) {
      const fg = body.match(/(?:^|;)\s*color:\s*var\((--[a-z0-9-]+)\)/);
      const bg = body.match(/(?:^|;)\s*background(?:-color)?:\s*var\((--[a-z0-9-]+)\)/);
      if (!fg || !bg || !T[fg[1]] || !T[bg[1]]) continue;
      const size = parseFloat((body.match(/font-size:\s*([\d.]+)px/) || [])[1] || '0');
      const weight = parseInt((body.match(/font-weight:\s*(\d+)/) || [])[1] || '400');
      const large = size >= 24 || (size >= 18.66 && weight >= 700);
      const min = large ? 3 : 4.5;
      pairs++;
      const got = ratio(T[fg[1]], T[bg[1]]);
      const rule = `${sel.trim().replace(/\s+/g, ' ')} { color:${fg[1]}; background:${bg[1]} }`;
      if (got < 1.05) fails.push(`${theme.name}: ${rule} is invisible at ${r2(got)}:1`);
      else if (got < min) fails.push(`${theme.name}: ${rule} = ${r2(got)}:1 (needs ${min})`);
    }
  }

  const INLINE = [...html.matchAll(/style="([^"]*)"/g)].map((m) => m[1]).filter((v) => !v.includes('${'));
  const inlineFails = [];
  for (const theme of Object.values(THEMES)) {
    const T = tokensFor(theme);
    for (const style of INLINE) {
      const fg = (style.match(/(?:^|;)\s*color:\s*var\((--[a-z0-9-]+)\)/) || [])[1];
      if (!fg || !T[fg]) continue;
      const bgDecl = (style.match(/(?:^|;)\s*background(?:-color)?:[^;]*/) || [''])[0];
      for (const m of bgDecl.matchAll(/var\((--[a-z0-9-]+)\)/g)) {
        if (!T[m[1]]) continue;
        const got = ratio(T[fg], T[m[1]]);
        if (got < 4.5) inlineFails.push(`${theme.name}: ${style} -> ${r2(got)}:1`);
      }
    }
  }

  console.log(`themes parsed: ${Object.keys(THEMES).length}  css rules: ${RULES.length}  rule/theme pairs: ${pairs}`);
  console.log(`token pair failures: ${fails.length}`);
  for (const f of fails) console.log('  FAIL ' + f);
  console.log(`inline style failures: ${[...new Set(inlineFails)].length}`);
  for (const f of [...new Set(inlineFails)]) console.log('  FAIL ' + f);
  if (verbose) {
    console.log(`tight (within 0.6 of the floor): ${[...new Set(tight)].length}`);
    for (const t of [...new Set(tight)]) console.log('  tight ' + t);
  }
  return fails.length + inlineFails.length;
}

export { LIGHT, DARK, THEMES, tokensFor, ratio, hex2rgb, lum, css, html };

if (import.meta.url === `file://${process.argv[1]}`) {
  process.exit(report({ verbose: process.argv.includes('-v') }) === 0 ? 0 : 1);
}
