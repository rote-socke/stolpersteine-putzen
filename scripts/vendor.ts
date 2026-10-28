// Copies the browser libraries the app needs from node_modules into
// public/vendor/ (git-ignored), so the app loads no CDN.
import { cpSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..');
const modules = join(root, 'node_modules');
const out = join(root, 'public', 'vendor');

const copies: Array<[from: string, to: string]> = [
  ['leaflet/dist/leaflet.js', 'leaflet/leaflet.js'],
  ['leaflet/dist/leaflet.css', 'leaflet/leaflet.css'],
  ['leaflet/dist/images', 'leaflet/images'],
  // Plain browser script that defines the global `qrcode`.
  ['qrcode-generator/dist/qrcode.js', 'qrcode/qrcode.js'],
];

rmSync(out, { recursive: true, force: true });
for (const [from, to] of copies) {
  const target = join(out, to);
  mkdirSync(join(target, '..'), { recursive: true });
  cpSync(join(modules, from), target, { recursive: true });
  console.log(`vendor: ${from} -> public/vendor/${to}`);
}
