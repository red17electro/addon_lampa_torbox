const { test, expect } = require('@playwright/test');
const path = require('node:path');
const fs = require('node:fs');

// Unlike focus-smoke.spec.js, these tests execute the actual plugin artifacts.
// Lampa's integration surface is stubbed; no TorBox account/network is used.
for (const filename of ['torbox-lampa-plugin.js', 'torbox-lampa-plugin.legacy.js']) {
  test(`${filename}: browser search recovers when the proxy is unreachable`, async ({ page }) => {
    const requests = [];
    await page.route('https://lampa.example.test/', (route) => route.fulfill({
      contentType: 'text/html', body: '<html><head></head><body></body></html>',
    }));
    await page.route('https://proxy.example.test/**', (route) => route.abort('failed'));
    await page.route('https://jr.maxvol.pro/**', (route) => {
      requests.push(route.request());
      return route.fulfill({ contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' },
        body: JSON.stringify({ Results: [{ InfoHash: 'a'.repeat(40) }] }),
      });
    });
    await page.goto('https://lampa.example.test/');
    await page.evaluate(() => {
      window.Lampa = {
        Activity: {}, Lang: { add() {}, translate: (key) => key }, Component: { add() {} },
        Template: { add() {} }, Listener: { follow() {}, remove() {} }, Manifest: {},
      };
    });
    const code = fs.readFileSync(path.resolve(__dirname, '../..', filename), 'utf8');
    const marker = '(function integrate() {';
    expect(code.split(marker)).toHaveLength(2);
    await page.addScriptTag({ content: code.replace(marker, 'window.testApi = { Api, Config };\n' + marker) });
    const result = await page.evaluate(async () => {
      testApi.Config.proxyUrl = 'https://proxy.example.test';
      testApi.Config.apiKey = 'private-test-key';
      const data = await testApi.Api.searchPublicTrackers({ name: 'Example' }, new AbortController().signal);
      return { count: data.entriesByHash.size, routes: data.diagnostics.map((attempt) => attempt.route) };
    });
    expect(result).toEqual({ count: 1, routes: ['proxy', 'direct'] });
    expect(requests).toHaveLength(1);
    expect(requests[0].headers()['x-api-key']).toBeUndefined();
    expect(requests[0].headers().authorization).toBeUndefined();
    expect(requests[0].headers().cookie).toBeUndefined();
    expect(requests[0].headers().referer).toBeUndefined();
  });

  for (const ready of [true, false]) {
    test(`${filename}: ${ready ? 'immediate' : 'deferred'} boot, card button and duplicate-load guard`, async ({ page }) => {
      const errors = [];
      page.on('pageerror', (error) => errors.push(error.message));
      await page.route('https://lampa.example.test/', (route) => route.fulfill({
        contentType: 'text/html',
        body: '<html><head></head><body><div id="card"><div class="view--torrent">Torrent</div></div></body></html>',
      }));
      await page.goto('https://lampa.example.test/');
      await page.evaluate((ready) => {
        window.calls = { components: [], templates: [], settings: [], params: [], pushes: [], plugins: [], notices: [] };
        window.listeners = {};
        // Small DOM-backed jQuery subset used by the movie-card integration.
        window.$ = function wrap(input) {
          let nodes;
          if (typeof input === 'string') {
            const template = document.createElement('template');
            template.innerHTML = input;
            nodes = [template.content.firstElementChild];
          } else nodes = Array.isArray(input) ? input : [input];
          return {
            length: nodes.length,
            find: (selector) => wrap(nodes.flatMap((node) => Array.from(node.querySelectorAll(selector)))),
            after: (other) => { nodes[0].after(other.node); },
            on: (event, handler) => { nodes.forEach((node) => node.addEventListener(event, handler)); },
            node: nodes[0],
          };
        };
        window.Lampa = {
          Lang: { translate: (key) => key, add() {} },
          Component: { add: (name) => calls.components.push(name) },
          Template: { add: (name) => calls.templates.push(name) },
          SettingsApi: {
            addComponent: (component) => calls.settings.push(component.component),
            addParam: (param) => calls.params.push(param.param.name),
          },
          Listener: {
            follow: (name, handler) => { (listeners[name] ||= []).push(handler); return handler; },
            remove: (name, handler) => { listeners[name] = listeners[name].filter((item) => item !== handler); },
          },
          Manifest: { set plugins(plugin) { calls.plugins.push(plugin.name); }, get plugins() { return []; } },
          Noty: { show: (message) => calls.notices.push(message) },
        };
        if (ready) Lampa.Activity = { push: (options) => calls.pushes.push(options) };
      }, ready);

      const pluginPath = path.resolve(__dirname, '../..', filename);
      await page.addScriptTag({ path: pluginPath });
      if (!ready) {
        expect(await page.evaluate(() => calls.components)).toEqual([]);
        await page.evaluate(() => {
          Lampa.Activity = { push: (options) => calls.pushes.push(options) };
          listeners.app.slice().forEach((handler) => handler({ type: 'ready' }));
        });
      }
      await page.addScriptTag({ path: pluginPath });
      await page.evaluate(() => {
        const event = { type: 'complite', data: { movie: { id: 42, title: 'Example' } },
          object: { activity: { render: () => $(document.getElementById('card')) } } };
        listeners.full.forEach((handler) => handler(event));
        listeners.full.forEach((handler) => handler(event));
      });
      await expect(page.locator('.view--torbox')).toHaveCount(1);
      await page.locator('.view--torbox').dispatchEvent('hover:enter');
      const result = await page.evaluate(() => ({
        ...calls, error: localStorage.getItem('torbox_boot_error'),
        stylesheetCount: document.querySelectorAll('#torbox-stable-styles').length,
      }));
      expect(result.components).toEqual(['torbox_main']);
      expect(result.settings).toEqual(['torbox_enh']);
      expect(result.params).toEqual(['torbox_proxy_url', 'torbox_api_key']);
      expect(result.templates).toContain('torbox_episode_item');
      expect(result.plugins).toEqual(['TorBox']);
      expect(result.pushes).toEqual([expect.objectContaining({ component: 'torbox_main', movie: { id: 42, title: 'Example' } })]);
      expect(result.stylesheetCount).toBe(1);
      expect(result.error).toBeNull();
      expect(result.notices).toEqual([]);
      expect(errors).toEqual([]);

      if (filename.includes('.legacy.')) {
        await page.evaluate(() => {
          document.body.insertAdjacentHTML('beforeend', '<div class="torbox-cached-toggle"><span class="torbox-cached-toggle__icon">X</span><span class="torbox-cached-toggle__label">Cached</span></div><div class="torbox-file-item"><div class="torbox-file-item__body">File</div><div class="torbox-file-download">Download</div></div>');
        });
        await expect(page.locator('.torbox-cached-toggle')).toHaveCSS('column-gap', '0px');
        expect(await page.locator('.torbox-cached-toggle__label').evaluate((el) => parseFloat(getComputedStyle(el).marginLeft))).toBeGreaterThan(0);
        expect(await page.locator('.torbox-file-download').evaluate((el) => parseFloat(getComputedStyle(el).marginLeft))).toBeGreaterThan(0);
      }
    });
  }
}
