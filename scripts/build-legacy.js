#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { transformSync } = require('esbuild');
const { parse } = require('acorn');

const root = path.resolve(__dirname, '..');
const outputPath = path.join(root, 'torbox-lampa-plugin.legacy.js');

function buildLegacy() {
  const source = fs.readFileSync(path.join(root, 'torbox-lampa-plugin.js'), 'utf8');
  const css = fs.readFileSync(path.join(__dirname, 'legacy.css'), 'utf8');
  const anchor = 'document.head.appendChild(css);';
  if (source.split(anchor).length !== 2) {
    throw new Error('Expected one plugin stylesheet insertion; review legacy CSS integration');
  }
  const input = source.replace(anchor, `css.textContent += ${JSON.stringify(css)};\n${anchor}`);
  const { code, warnings } = transformSync(input, {
    loader: 'js',
    // Chrome 69 supports async/await, object spread and optional catch bindings.
    // ES2018 additionally lowers catch bindings for a conservative parser check.
    target: ['chrome69', 'es2018'],
    format: 'iife',
    charset: 'utf8',
    legalComments: 'inline',
    banner: '/* GENERATED: npm run build:legacy — Samsung Tizen 5.5 / Chromium 69. Do not edit. */',
  });
  if (warnings.length) throw new Error(warnings.map((warning) => warning.text).join('\n'));
  // A modern Node syntax check alone cannot catch accidental ES2020 output.
  parse(code, { ecmaVersion: 2018, sourceType: 'script' });
  return code;
}

if (require.main === module) {
  const code = buildLegacy();
  if (process.argv.includes('--check')) {
    if (!fs.existsSync(outputPath) || fs.readFileSync(outputPath, 'utf8') !== code) {
      console.error('[legacy] Missing or stale build. Run npm run build:legacy and commit the output.');
      process.exitCode = 1;
    } else {
      console.log('[legacy] OK: ES2018 syntax and generated file are current');
    }
  } else {
    fs.writeFileSync(outputPath, code);
    console.log('[legacy] Built torbox-lampa-plugin.legacy.js');
  }
}

module.exports = { buildLegacy };
