/// <reference types="vitest/config" />
import { defineConfig, type Plugin } from 'vite';
import preact from '@preact/preset-vite';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

/** Files in public/ that the service worker should also keep offline. */
const PUBLIC_PRECACHE = [
  'manifest.webmanifest',
  'icons/icon.svg',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/maskable-512.png',
  'icons/apple-touch-icon.png',
];

/**
 * Writes dist/sw.js from src/sw.js with the list of built files to precache and a cache name
 * that changes whenever any built file changes, so each deploy replaces the old offline copy.
 */
function serviceWorker(): Plugin {
  let outDir = 'dist';
  let files: string[] = [];
  let version = 'dev';
  return {
    name: 'actormaker-sw',
    apply: 'build',
    configResolved(c) {
      outDir = c.build.outDir;
    },
    generateBundle(_opts, bundle) {
      files = Object.keys(bundle).filter((f) => !f.endsWith('.map')).sort();
      const hash = createHash('sha256');
      for (const f of files) {
        const item = bundle[f];
        hash.update(f);
        hash.update(item.type === 'chunk' ? item.code : item.source);
      }
      version = hash.digest('hex').slice(0, 12);
    },
    writeBundle() {
      const precache = ['./', ...[...files, ...PUBLIC_PRECACHE].map((f) => './' + f)];
      const src = readFileSync(resolve(import.meta.dirname, 'src/sw.js'), 'utf8')
        .replace('__CACHE_VERSION__', version)
        .replace('__PRECACHE__', JSON.stringify(precache));
      writeFileSync(resolve(outDir, 'sw.js'), src);
    },
  };
}

export default defineConfig({
  // Relative paths: works at https://<user>.github.io/<repo>/ and on any static host.
  base: './',
  plugins: [preact(), serviceWorker()],
  define: {
    __APP_VERSION__: JSON.stringify(
      `${JSON.parse(readFileSync(resolve(import.meta.dirname, 'package.json'), 'utf8')).version} (${new Date().toISOString().slice(0, 10)})`,
    ),
  },
  build: { target: 'es2020', sourcemap: false },
  test: { include: ['test/**/*.test.ts'] },
});
