const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { parse } = require('acorn');
const { buildLegacy } = require('../../scripts/build-legacy');

const root = path.resolve(__dirname, '../..');
const source = fs.readFileSync(path.join(root, 'torbox-lampa-plugin.js'), 'utf8');
const legacy = fs.readFileSync(path.join(root, 'torbox-lampa-plugin.legacy.js'), 'utf8');

// Expose the real closure in test copies only, before transforming it. Neither
// production artifact exports internals or needs a module loader on the TV.
function loadPlugin(code, overrides = {}) {
  const marker = '(function integrate() {';
  assert.equal(code.split(marker).length, 2);
  code = code.replace(marker, 'window.testApi = { Utils, Api, Config, parseBoolean, generateSearchCombinations };\n' + marker);
  if (overrides.legacy) {
    code = require('esbuild').transformSync(code, { target: ['chrome69', 'es2018'] }).code;
  }
  const values = new Map();
  const registrations = [];
  const errors = [];
  const context = vm.createContext({
    window: {},
    console: { log() {}, error(...args) { errors.push(args); } },
    localStorage: {
      getItem: (key) => values.has(key) ? values.get(key) : null,
      setItem: (key, value) => values.set(key, String(value)),
      removeItem: (key) => values.delete(key),
    },
    document: {
      getElementById: () => null,
      createElement: () => ({ textContent: '', innerHTML: '' }),
      head: { appendChild() {} },
    },
    Lampa: {
      Lang: { translate: (key) => key, add() {} },
      Activity: {},
      Component: { add: (name) => registrations.push(name) },
      Template: { add() {} },
      Listener: { follow() {}, remove() {} },
      Manifest: {},
    },
    URL, URLSearchParams, AbortController, FormData, atob, btoa,
    setTimeout: overrides.setTimeout || setTimeout,
    clearTimeout,
    fetch: overrides.fetch || (() => { throw new Error('Unexpected live request'); }),
  });
  context.window.Lampa = context.Lampa;
  vm.runInContext(code, context);
  assert.deepEqual(errors, []);
  assert.deepEqual(registrations, ['torbox_main']);
  return context.window.testApi;
}

test('legacy artifact is reproducible and parses as ES2018; modern syntax fails that gate', () => {
  assert.equal(legacy, buildLegacy());
  assert.doesNotThrow(() => parse(legacy, { ecmaVersion: 2018, sourceType: 'script' }));
  assert.throws(() => parse(source, { ecmaVersion: 2018, sourceType: 'script' }));
});

for (const variant of ['modern', 'legacy']) {
  const options = { legacy: variant === 'legacy' };

  test(`${variant}: real search helpers preserve missing fields, nested keywords and zero values`, () => {
    const api = loadPlugin(source, options);
    assert.equal(api.parseBoolean(false, true), false);
    assert.equal(api.parseBoolean(0, true), false);
    assert.equal(api.parseBoolean(null, true), true);
    assert.equal(api.Utils.normalizeProgress(0), 0);
    assert.equal(api.Utils.downloadPhase({ progress: 1 }), 'finalizing');
    assert.equal(api.Utils.downloadPhase({ download_finished: true, files: [{ id: 1 }] }), 'ready');
    assert.deepEqual(JSON.parse(JSON.stringify(api.generateSearchCombinations({}))), []);
    const combos = api.generateSearchCombinations({
      name: 'Example', original_name: 'Original', first_air_date: '2020-01-01',
      season: 1, episode: 2, translations: [null, { data: { title: 'Translated' } }],
      keywords: [{ name: 'Space' }], tags: ['Drama'],
    });
    const queries = combos.map((entry) => entry.query);
    for (const expected of ['Example 2020', 'Example S01E02', 'Example Space', 'Example Drama']) {
      assert.ok(queries.includes(expected), expected);
    }
  });

  test(`${variant}: real TorBox requests preserve proxy, credentials, list normalization and cancellation`, async () => {
    const calls = [];
    const api = loadPlugin(source, { ...options, fetch: async (url, opt) => {
      calls.push({ url, opt });
      if (calls.length === 1) return { status: 200, text: async () => '{"success":true,"data":{"id":7}}' };
      return new Promise((resolve, reject) => {
        opt.signal.addEventListener('abort', () => reject(Object.assign(new Error('Aborted'), { name: 'AbortError' })));
      });
    } });
    api.Config.apiKey = 'test-key';
    api.Config.proxyUrl = 'https://proxy.example.test/?existing=1';
    const result = await api.Api.myList(7);
    assert.equal(result.data[0].id, 7);
    assert.equal(new URL(calls[0].url).origin, 'https://proxy.example.test');
    assert.equal(new URL(calls[0].url).searchParams.get('existing'), '1');
    assert.equal(new URL(new URL(calls[0].url).searchParams.get('url')).hostname, 'api.torbox.app');
    assert.equal(calls[0].opt.headers['X-Api-Key'], 'test-key');
    assert.equal(calls[0].opt.headers.Authorization, undefined);
    const controller = new AbortController();
    const pending = api.Api.myList(7, controller.signal);
    controller.abort();
    await assert.rejects(pending, { name: 'AbortError' });
    assert.equal(calls[1].opt.signal.aborted, true);
  });

  test(`${variant}: request timeout remains a network timeout`, async () => {
    const api = loadPlugin(source, { ...options,
      setTimeout: (callback) => setTimeout(callback, 5),
      fetch: (url, opt) => new Promise((resolve, reject) => {
        opt.signal.addEventListener('abort', () => reject({ name: 'AbortError' }));
      }),
    });
    api.Config.apiKey = 'test-key';
    await assert.rejects(api.Api.myList(7), (error) => error.type === 'network' && error.timeoutMs === 20000);
  });
}
