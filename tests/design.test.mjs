import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createApp } from './_harness.mjs';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const css = html.match(/<style id="mainStyles">([\s\S]*?)<\/style>/)[1];
const close = (app) => { try { app.dom.window.close(); } catch (e) {} };

describe('operator dashboard design', () => {
  it('centres the current draw-stage caption and uses one corner radius', () => {
    assert.match(css, /\.pacing-ribbon\s*\{[^}]*text-align:\s*center/s);
    for (const token of ['--r-sm', '--r-md', '--r-lg', '--r-xl', '--r-pill']) {
      assert.match(css, new RegExp(`${token}:\\s*8px;`), `${token} should use the shared radius`);
    }
    assert.doesNotMatch(css, /border-radius:\s*0\s*;/, 'square corners should not remain');
  });

  it('keeps the wallpaper behind a solid, single-column operator layout', () => {
    assert.match(css, /\.workspace-wallpaper\s*\{[^}]*z-index:\s*0/s);
    assert.match(css, /#operatorView\s*\{[^}]*z-index:\s*1/s);
    assert.match(css, /\.main-stage\s*\{[^}]*background:\s*var\(--surface-result\)/s);
    assert.match(css, /\.billboard-grid\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)/s);
    assert.match(css, /\.action-btn\s*\{[^}]*min-height:\s*50px/s);
  });

  it('exposes background image and opacity controls in the overflow menu', async () => {
    const app = createApp({ master: true });
    try {
      const { document } = app;
      const { localStorage } = app.window;
      const menu = document.getElementById('moreMenuPanel');
      assert.ok(document.querySelector('.workspace-wallpaper'));
      assert.ok(menu.querySelector('#workspaceBackgroundBtn.more-menu-item'));
      assert.ok(menu.querySelector('#workspaceBackgroundClearBtn.more-menu-item'));
      assert.ok(menu.querySelector('#workspaceBackgroundInput') === null,
        'the upload input stays outside the menu');
      assert.ok(document.getElementById('workspaceBackgroundInput'));

      const opacitySlider = document.getElementById('workspaceBackgroundOpacity');
      const arrow = new app.window.KeyboardEvent('keydown', {
        key: 'ArrowDown',
        bubbles: true,
        cancelable: true
      });
      opacitySlider.dispatchEvent(arrow);
      assert.equal(arrow.defaultPrevented, false, 'menu navigation must not block slider adjustment');

      localStorage.setItem('tanglung_workspace_background_v1', 'data:image/jpeg;base64,AA==');
      app.window.loadWorkspaceBackgroundPrefs();
      assert.equal(
        document.documentElement.style.getPropertyValue('--workspace-background-image'),
        'url("data:image/jpeg;base64,AA==")'
      );

      app.window.updateWorkspaceBackgroundOpacity('18');
      assert.equal(document.documentElement.style.getPropertyValue('--workspace-background-opacity'), '0.18');
      assert.equal(document.getElementById('workspaceBackgroundOpacityValue').value, '18%');
      await new Promise((resolve) => setTimeout(resolve, 220));
      assert.equal(localStorage.getItem('tanglung_workspace_background_opacity_v1'), '18');

      localStorage.setItem('tanglung_workspace_background_v1', 'data:image/jpeg;base64,AA==');
      app.window.clearWorkspaceBackground();
      assert.equal(document.documentElement.style.getPropertyValue('--workspace-background-image'), 'none');
      assert.equal(document.documentElement.style.getPropertyValue('--workspace-background-opacity'), '0.18');
      assert.equal(localStorage.getItem('tanglung_workspace_background_v1'), null);
      assert.equal(localStorage.getItem('tanglung_workspace_background_opacity_v1'), null);
    } finally { close(app); }
  });
});
