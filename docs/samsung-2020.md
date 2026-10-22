# Samsung QE55Q80TAUXRU (2020): build and installation

Use `torbox-lampa-plugin.legacy.js` on this TV. The modern file,
`torbox-lampa-plugin.js`, stays the source of truth and is unchanged.
Both builds use the same component ID, manifest version and storage keys.

## Compatibility audit

Samsung lists 2020 TVs as Tizen 5.5 with Chromium M69 in its
[Web Engine Specifications](https://developer.samsung.com/smarttv/develop/specifications/web-engine-specifications.html).

| Feature used by the plugin | Chromium 69 | Handling |
| --- | --- | --- |
| Optional chaining (`?.`, including optional method calls) | Unsupported; prevents parsing the entire file | esbuild lowers it to explicit checks, preserving method receivers |
| Nullish coalescing (`??`) | Unsupported; prevents parsing the entire file | esbuild lowers it while preserving `0`, `false` and empty strings |
| Optional catch binding (`catch {}`) | Supported | Also lowered by the conservative ES2018 output target |
| Flexbox `gap` in badges, cached toggle and file rows | Unsupported | Legacy stylesheet overrides gap with margins |
| `Array.flat()` (search keywords and filters) | Supported starting in Chrome 69 | Retained; no polyfill needed |
| `async`/`await`, object spread, Map/Set, Array.from/includes, Object.entries/values, String.padStart/padEnd, Promise.finally | Supported | Retained |
| fetch, AbortController/Signal, URL/URLSearchParams, FormData | Available in the target Chromium generation | Retained; cancellation and timeout behavior covered by mocked request tests |
| Lampa player, clipboard and Android bridges | Supplied by the host application | Existing behavior retained; verify in the installed Lampa version |

References: [V8 optional chaining](https://v8.dev/features/optional-chaining),
[V8 nullish coalescing](https://v8.dev/features/nullish-coalescing),
[Chrome 69 array methods](https://developer.chrome.com/blog/new-in-chrome-69),
[Chromium 84 flex gap announcement](https://blog.chromium.org/2020/06/),
[esbuild targets](https://esbuild.github.io/api/#target).
esbuild changes syntax, not browser APIs. Revisit this audit when adding new APIs.

An outer `try/catch` cannot catch syntax that the TV cannot parse. This explains
why the modern plugin can fail without showing its own boot-error notification.
It is a plausible cause of a missing TorBox button, not a diagnosis obtained from
this particular TV's console.

## Rebuild and test

From the repository root (Node 20 or later):

```bash
npm ci
npm run build:legacy
npx playwright install chromium
npm test
```

Commit the generated root-level `torbox-lampa-plugin.legacy.js` together with any
source changes. It is deliberately outside ignored `dist/` so a CDN can serve it
directly. Do not edit the generated file. `npm run check:legacy` and `npm run
validate` fail if it is missing or stale; CI uses the same check. No module
loader, external polyfill, or build service is needed on the TV.

The build targets both Chromium 69 and ES2018. Acorn parses the complete output
as an ordinary ES2018 script. Unit tests exercise actual plugin helpers and
mocked requests for both syntax variants, including proxy/key handling, timeout
and cancellation. Browser tests load both actual files with a small Lampa stub,
exercise immediate/deferred boot, duplicate loads, card button launch and legacy
spacing. The older focus tests use standalone navigation fixtures.

These checks run on Node and current desktop Chromium, not Chromium 69 or a
Samsung TV. Actual TV remote navigation, HTTPS certificates, network access,
TorBox account permissions and video/audio codec support still need device QA.
A changed user-agent string would not test the old JavaScript engine.

## Publish through jsDelivr

The local clone's origin is `red17electro/addon_lampa_torbox`. First build, test,
commit the changed files (including the generated plugin) and push to your
public GitHub repository. Nothing is published by `npm run build:legacy`.

After the commit reaches `main`, this is the branch URL to install:

```text
https://cdn.jsdelivr.net/gh/red17electro/addon_lampa_torbox@main/torbox-lampa-plugin.legacy.js
```

For reproducible testing, replace `main` with the full pushed commit SHA:

```text
https://cdn.jsdelivr.net/gh/red17electro/addon_lampa_torbox@COMMIT_SHA/torbox-lampa-plugin.legacy.js
```

`COMMIT_SHA` is a placeholder. Read the SHA with `git rev-parse HEAD` after
committing and make sure that commit has been pushed. A branch URL may serve a
cached older copy; use a new commit URL to test a particular build. jsDelivr's
[GitHub CDN documentation](https://www.jsdelivr.com/?docs=gh) describes release,
commit and branch URLs. The repository must be public for this delivery method.

Check that the URL returns JavaScript beginning with the generated Samsung
banner, not a GitHub page, login page or 404. It will not serve the new file
until the file has been pushed. Test access from your parents' connection and
the TV itself; access from another country does not establish access in Crimea.

## Alternative HTTPS hosting

Upload just `torbox-lampa-plugin.legacy.js` to an HTTPS host/domain reachable from
the TV, for example your own existing server. No GitHub Pages dependency is
required. Serve the raw file at a stable path such as
`https://YOUR_DOMAIN/plugins/torbox-lampa-plugin.legacy.js`, with:

```text
Content-Type: application/javascript; charset=utf-8
Access-Control-Allow-Origin: *
Cache-Control: no-cache
```

`YOUR_DOMAIN` is a placeholder for a domain you control. Use a publicly trusted
certificate with a complete chain accepted by the TV. Keep the file publicly
readable, without authentication, bot challenges or an HTML download wrapper.
CORS permits Lampa loaders that fetch script text. For ordinary script tags it
is not generally required, but providing it supports both loading methods.
Choose a host based on a real test from the parents' network; this work does not
establish that jsDelivr or any other provider is reachable there.

The plugin download host and CORS proxy are separate connections. Moving the
JavaScript file does not fix an unreachable `workers.dev` proxy. The existing
default is `https://my-torbox-proxy.slonce70.workers.dev`; enter a reachable,
trusted proxy in Settings → TorBox if necessary. The supplied worker source is
in `proxy/cloudflare-worker.js`; it can be deployed separately on an accessible
HTTPS domain. Its runtime syntax is server-side and does not run on the TV.
It must support OPTIONS and CORS for `X-Api-Key` and Content-Type. Only the proxy
needs to contact the TorBox API and configured public parsers; playback still
needs access to the returned media URL.

## Install and verify on the TV

1. Remove/disable the previous TorBox plugin entry in Lampa. Install only one
   build: both have the same duplicate-load guard, so whichever runs first wins.
2. In Settings → Plugins → Add plugin, paste the published legacy URL. Fully
   restart Lampa, then open a movie/series card and check for the TorBox button.
3. In Settings → TorBox, enter your TorBox API key. This source has **no embedded
   default API key**. Check the proxy URL as well. Settings are preserved when
   switching between modern and legacy builds.
4. Search a title; check the cached toggle, filters, Up/Down/Right/Back, a movie
   file list and a series episode list. Confirm `OK` plays a file and `Right` →
   download stays separate from playback. Check Back during loading too.
5. Test a known compatible video/audio file. A visible button and successful
   search do not guarantee the TV's player can decode every returned format.

If the button is absent, first check the plugin URL's response, restart Lampa
and ensure only the legacy entry is enabled. If available, inspect the TV's
remote console for `[TorBox] boot strap` and `localStorage.torbox_boot_error`.
If the button appears but searches fail, inspect proxy reachability and parser
errors; if TorBox calls fail, check the API key/account. A `401`/`403`, DNS/TLS
failure or blocked media host requires a different fix from syntax compilation.
Enable `localStorage.torbox_debug = '1'` in the Lampa console for diagnostic logs.

To roll back, disable the legacy entry and reinstall the previous URL on a
device whose engine supports it, then restart Lampa. Existing stored settings
and watched state use the same keys.
