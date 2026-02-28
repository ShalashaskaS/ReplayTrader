import { copyFileSync, mkdirSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const dist = join(root, 'node_modules', '@duckdb', 'duckdb-wasm', 'dist');
const dest = join(root, 'public', 'duckdb');

if (!existsSync(dest)) {
  mkdirSync(dest, { recursive: true });
}

const files = [
  'duckdb-mvp.wasm',
  'duckdb-eh.wasm',
  'duckdb-browser-mvp.worker.js',
  'duckdb-browser-eh.worker.js',
];

for (const f of files) {
  const src = join(dist, f);
  if (existsSync(src)) {
    copyFileSync(src, join(dest, f));
    console.log(`✓ Copied ${f}`);
  } else {
    console.warn(`⚠ Missing ${f}`);
  }
}

console.log('DuckDB WASM assets copied to public/duckdb/');
