/* Generates harmonised accent ramps in OKLCH -- the space modern palettes are
   actually specified in -- so switching theme does not change how bright the
   whole interface feels, and no accent comes out neon or muddy.

   For each theme hue: pin a perceptual lightness L, then take the largest
   in-gamut chroma at that L and hue, capped so the result reads as a brand
   colour rather than a highlighter.

   usage: node tests/_palette.mjs [lightL] [darkL] [chromaScale]           */
const clamp = (v) => Math.max(0, Math.min(1, v));
const toHex = (c) => '#' + c.map((v) => Math.round(clamp(v / 255) * 255).toString(16).padStart(2, '0')).join('');
const parse = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const lum = (c) => {
  const a = c.map((v) => {
    v /= 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * a[0] + 0.7152 * a[1] + 0.0722 * a[2];
};
const ratio = (fg, bg) => {
  const l1 = lum(fg), l2 = lum(bg);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
};

function oklab2rgb(L, a, b) {
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.291485548 * b;
  const l = l_ * l_ * l_, m = m_ * m_ * m_, s = s_ * s_ * s_;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}
const lch2rgb = (L, C, H) =>
  oklab2rgb(L, C * Math.cos((H * Math.PI) / 180), C * Math.sin((H * Math.PI) / 180));
const inGamut = (c) => c.every((v) => v >= -0.0005 && v <= 1.0005);
const encode = (c) => c.map((v) => (v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055));

function solve(L, H, cap) {
  if (inGamut(lch2rgb(L, cap, H))) return encode(lch2rgb(L, cap, H)).map((v) => clamp(v) * 255);
  let lo = 0, hi = cap;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (inGamut(lch2rgb(L, mid, H))) lo = mid; else hi = mid;
  }
  return encode(lch2rgb(L, lo, H)).map((v) => clamp(v) * 255);
}

const STAGE_BG = parse('#0b0d10');
const STAGE_SURFACE = parse('#151920');
const WHITE = [255, 255, 255];
const INK = parse('#0b0d10');
const DARK_CARD = parse(process.argv[6] || '#14171c');

// id, mode, OKLCH hue, chroma weight (1 = full saturation, lower = more muted)
const PLAN = [
  ['indigo', 'light', 275, 1.00], ['blue', 'light', 252, 1.00], ['sky', 'light', 232, 0.85],
  ['cyan', 'light', 215, 0.75], ['teal', 'light', 195, 0.70], ['emerald', 'light', 165, 0.80],
  ['green', 'light', 148, 0.95], ['lime', 'light', 128, 1.00], ['amber', 'light', 75, 0.95],
  ['orange', 'light', 52, 1.00],
  ['red', 'dark', 27, 1.00], ['rose', 'dark', 8, 1.00], ['pink', 'dark', 350, 1.00],
  ['fuchsia', 'dark', 328, 1.00], ['purple', 'dark', 305, 1.00], ['violet', 'dark', 288, 1.00],
  ['slate', 'dark', 248, 0.70], ['graphite', 'dark', 245, 0.14], ['steel', 'dark', 228, 0.55],
  ['mocha', 'dark', 70, 0.50],
].map(([id, mode, H, w]) => ({ id, mode, H, cap: 0.21 * w }));

const LIGHT_L = Number(process.argv[2] || 0.55);
const DARK_L = Number(process.argv[3] || 0.70);
const L_TARGET = {
  light: { accent: LIGHT_L, strong: LIGHT_L - 0.11, deep: LIGHT_L - 0.175, bright: 0.790 },
  dark: { accent: DARK_L, strong: DARK_L + 0.085, deep: DARK_L - 0.075, bright: DARK_L + 0.105 },
};

const rows = [];
for (const { id, mode, H, cap } of PLAN) {
  const t = L_TARGET[mode];
  const ramp = {
    accent: solve(t.accent, H, cap),
    strong: solve(t.strong, H, cap),
    deep: solve(t.deep, H, cap),
    bright: solve(t.bright, H, cap),
  };
  const ink = mode === 'light' ? WHITE : INK;
  const card = mode === 'light' ? WHITE : DARK_CARD;
  const problems = [];
  const chk = (a, b, need, label) => { if (ratio(a, b) < need) problems.push(`${label} ${ratio(a, b).toFixed(2)}`); };
  chk(ink, ramp.accent, 4.5, 'ink/accent');
  chk(ink, ramp.strong, 4.5, 'ink/strong');
  chk(ink, ramp.deep, 4.5, 'ink/deep');
  chk(ramp.accent, card, 4.5, 'accent/card');
  chk(ramp.bright, STAGE_BG, 4.5, 'bright/stage');
  chk(ramp.bright, STAGE_SURFACE, 4.5, 'bright/stageCard');
  chk(ink, ramp.accent, 5.1, 'ink/accent(margin)');
  if (mode === 'light') {
    if (!(lum(ramp.strong) < lum(ramp.accent))) problems.push('strong not darker');
    if (!(lum(ramp.deep) < lum(ramp.strong))) problems.push('deep not darker');
  } else if (!(lum(ramp.strong) > lum(ramp.accent))) problems.push('strong not lighter');
  if (!(lum(ramp.bright) > lum(ramp.accent))) problems.push('bright not lighter');

  rows.push({ id, mode, ramp, problems });
  const s = (c) => `${toHex(c)}`;
  console.log(
    `${id.padEnd(9)} ${mode.padEnd(5)} ${s(ramp.accent)}  strong ${s(ramp.strong)}  ` +
    `deep ${s(ramp.deep)}  bright ${s(ramp.bright)}` + (problems.length ? `  <-- ${problems.join(', ')}` : '')
  );
}

const spread = (mode, key) => {
  const ls = rows.filter((r) => r.mode === mode).map((r) => lum(r.ramp[key]));
  return `${Math.min(...ls).toFixed(3)}..${Math.max(...ls).toFixed(3)} (${(Math.max(...ls) / Math.min(...ls)).toFixed(2)}x)`;
};
console.log(`\nlightL=${LIGHT_L} darkL=${DARK_L}`);
console.log('light accent spread ', spread('light', 'accent'));
console.log('dark  accent spread ', spread('dark', 'accent'));
const bad = rows.filter((r) => r.problems.length);
console.log(bad.length ? `${bad.length} NEED TUNING: ${bad.map((b) => b.id).join(', ')}` : 'all 20 ramps satisfy every constraint');

if (process.argv.includes('--emit')) {
  console.log('\n--- paste block ---');
  for (const r of rows) {
    const f = (c) => [toHex(c), c.map((v) => Math.round(v)).join(', ')];
    const [ah, ar] = f(r.ramp.accent), [sh, sr] = f(r.ramp.strong), [dh] = f(r.ramp.deep), [bh, br] = f(r.ramp.bright);
    console.log(
      `      ${r.id}: {\n` +
      `        mode: "${r.mode}",\n` +
      `        colors: {\n` +
      `          '--accent': '${ah}', '--accent-rgb': '${ar}',\n` +
      `          '--accent-contrast': '${r.mode === 'light' ? '#ffffff' : '#0b0d10'}',\n` +
      `          '--accent-strong': '${sh}', '--accent-strong-rgb': '${sr}',\n` +
      `          '--accent-deep': '${dh}',\n` +
      `          '--accent-bright': '${bh}', '--accent-bright-rgb': '${br}'\n` +
      `        }\n` +
      `      },`
    );
  }
}
