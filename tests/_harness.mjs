import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { JSDOM } from 'jsdom';

const __dirname = dirname(fileURLToPath(import.meta.url));
const HTML_PATH = join(__dirname, '..', 'index.html');

const INTro = String.raw`
uid: (function () { "use strict"; })
`;

function stripExternalScripts(html) {
  return html
    .replace(/<script\s+src=["'][^"']*["']\s*><\/script>/g, '')
    .replace(/<script\s+src=["'][^"']*["']\s*\/>/g, '');
}

function buildStubScript(opts) {
  const rafQueue = 'window.__rafQueue = [];';
  const rafOverride = `
    window.requestAnimationFrame = function (cb) { window.__rafQueue.push(cb); return window.__rafQueue.length; };
    window.cancelAnimationFrame = function () {};
  `;
  const dialogs = `
    window.__dialogs = [];
    window.alert = function (m) { window.__dialogs.push(['alert', String(m)]); };
    window.confirm = function (m) { window.__dialogs.push(['confirm', String(m)]); return true; };
    window.prompt = function (m, dflt) { window.__dialogs.push(['prompt', String(m)]); return dflt === undefined ? null : dflt; };
  `;
  const firebase = `
    window.firebase = {
      apps: [],
      initializeApp() { return {}; },
      database() {
        return {
          ref() {
            const ref = {
              _cb: null,
              _last: null,
              on(type, cb) { this._cb = cb; },
              emit(val) { if (this._cb) this._cb({ val: () => val }); },
              once() { return Promise.resolve({ val: () => this._last }); },
              set(v) { this._last = v; return Promise.resolve(); },
              child() { return { set() { return Promise.resolve(); } }; }
            };
            return ref;
          }
        };
      }
    };
  `;
  const qrcode = `
    window.QRCode = class { constructor(el, opts) { this.el = el; this.opts = opts || {}; } };
  `;
  const audio = `
    window.AudioContext = class {
      constructor() { this.state = 'running'; this.currentTime = 0; this.destination = {}; }
      resume() {}
      createOscillator() {
        return {
          type: '', frequency: { setValueAtTime() {} },
          connect() {}, start() {}, stop() {}
        };
      }
      createGain() {
        return { gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() {} };
      }
    };
    window.webkitAudioContext = window.AudioContext;
  `;
  const bcast = `
    if (!window.BroadcastChannel) {
      window._bcMessages = [];
      window.BroadcastChannel = class {
        constructor(name) { this.name = name; this._on = null; window._bcMessages.push(['new', name]); }
        postMessage(d) { window._bcMessages.push(['post', d]); if (this._on) this._on({ data: d }); }
        set onmessage(f) { this._on = f; }
        get onmessage() { return this._on; }
        addEventListener() {}
        close() {}
      };
    }
  `;
  const html5canvas = `
    if (window.HTMLCanvasElement && window.HTMLCanvasElement.prototype) {
      window.HTMLCanvasElement.prototype.getContext = function () {
        return {
          canvas: this, width: 0, height: 0,
          clearRect() {}, beginPath() {}, lineTo() {}, moveTo() {},
          stroke() {}, fill() {}, closePath() {}, fillRect() {},
          strokeStyle: '', lineWidth: 1, fillStyle: '', globalAlpha: 1,
          setTransform() {}, save() {}, restore() {}, translate() {}, scale() {}, rotate() {}
        };
      };
    }
  `;
  const downloads = `
    window.__anchorClicks = [];
    if (window.HTMLAnchorElement && window.HTMLAnchorElement.prototype) {
      window.HTMLAnchorElement.prototype.click = function () {
        window.__anchorClicks.push({ href: this.href, download: this.download });
      };
    }
    if (window.URL) {
      window.URL.createObjectURL = function () { return 'blob:mock'; };
      window.URL.revokeObjectURL = function () {};
    }
  `;
  const innerTextShim = `
    Object.defineProperty(window.HTMLElement.prototype, 'innerText', {
      configurable: true,
      get() { return this.textContent; },
      set(v) { this.textContent = v; }
    });
  `;
  const accessors = `
    window.__get = function (k) { return eval(k); };
    window.__set = function (k, v) { eval(k + ' = arguments[1];'); };
  `;
  const mode = `
    if (${String(opts.master)}) { try { localStorage.setItem('tanglung_master_auth', '1'); } catch (e) {} }
    if (${String(opts.noAudioCtx)}) { window.audioCtx = null; }
  `;
  return `<script>${rafQueue}\n${rafOverride}\n${innerTextShim}\n${accessors}\n${downloads}\n${dialogs}\n${firebase}\n${qrcode}\n${audio}\n${bcast}\n${html5canvas}\n${mode}</script>`;
}

export function createApp({ master = false, projection = false, viewer = false, url = 'http://localhost/' } = {}) {
  if (projection) {
    url = 'http://localhost/?projection=true&viewer=true';
  } else if (viewer) {
    url = 'http://localhost/?viewer=true';
  }

  let html = readFileSync(HTML_PATH, 'utf8');
  html = stripExternalScripts(html);
  html = html.replace('</head>', `${buildStubScript({ master })}\n</head>`);

  const dom = new JSDOM(html, {
    url,
    runScripts: 'dangerously',
    resources: undefined,
    pretendToBeVisual: false
  });
  const { window } = dom;
  const { document } = window;

  const app = {
    dom,
    window,
    document,
    /**
     * Executes any queued requestAnimationFrame callbacks (returned by the
     * harness stub) so tests can drive frame-based rendering deterministically.
     */
    flushRaf(limit = 100) {
      const q = window.__rafQueue || [];
      let n = 0;
      while (q.length && n < limit) {
        const cb = q.shift();
        n++;
        try { cb(); } catch (e) {}
      }
      return n;
    },
    /**
     * Calls the accumulated window.alert/confirm/prompt entries for assertions.
     */
    dialogs() {
      return window.__dialogs || [];
    },
    clearDialogs() {
      window.__dialogs = [];
    },
    /**
     * Triggers state application as if it arrived from Firebase / BroadcastChannel.
     */
    applyState(payload) {
      window.applyStateData(payload);
    },
    /**
     * Force-applies any payload the last firebase set() received (host push).
     */
    lastPushedRef() {
      return window.firebase && window.firebase._lastRef || null;
    },
    /**
     * Read a top-level `let`/`const` binding from the page's own (global
     * lexical) scope, e.g. get('winners'). These are NOT window properties,
     * so plain `window.<name>` reads return undefined.
     */
    get(name) {
      return window.__get(name);
    },
    /**
     * Write a top-level `let` binding in the page's own scope, e.g.
     * set('maxPrizes', 120).
     */
    set(name, value) {
      return window.__set(name, value);
    },
    /**
     * Anchors whose click() was invoked (harness stub) — used to inspect
     * download exports without real navigation.
     */
    anchorClicks() {
      return window.__anchorClicks || [];
    }
  };

  const errors = [];
  window.addEventListener('error', (e) => errors.push(String(e.message || e)));
  window.addEventListener('unhandledrejection', (e) => errors.push(String(e.reason)));

  // Narrow events: window 'error' isn't reliably surfaced for scripts;
  // capture inline script syntax errors via the jsdom virtual console.
  const vc = dom.virtualConsole;
  vc.on('jsdomError', (err) => errors.push(String(err.message)));

  app.__collectErrors = errors;
  return app;
}

export const _internals = { INTro };