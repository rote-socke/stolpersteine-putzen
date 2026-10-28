import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { groupLocations, parseKml } from './kml.ts';

const SOURCE = 'https://www.stolpersteine-stuttgart.de/stolpersteine.kml';
const OUT = join(import.meta.dirname, '..', 'public', 'data', 'locations.json');

const res = await fetch(SOURCE);
if (!res.ok) throw new Error(`Download failed: ${res.status} ${res.statusText}`);
const kml = await res.text();

const parsed = parseKml(kml);
const grouped = groupLocations(parsed.stones);
const warnings = [...parsed.warnings, ...grouped.warnings];
const { locations } = grouped;

const out =
  `{"generatedAt":${JSON.stringify(new Date().toISOString().replace(/\.\d+Z$/, 'Z'))},"source":${JSON.stringify(SOURCE)},"locations":[\n` +
  locations.map((l) => JSON.stringify(l)).join(',\n') +
  '\n]}\n';
mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, out);

const cannstatt = locations.filter((l) => l.district === 'cannstatt');
console.log(`Placemarks: ${parsed.placemarks}`);
console.log(`Locations: ${locations.length} (cannstatt: ${cannstatt.length}, cannstatt stones: ${cannstatt.reduce((n, l) => n + l.stones.length, 0)})`);
console.log(`Stones: ${locations.reduce((n, l) => n + l.stones.length, 0)}`);
if (warnings.length) console.log(`Warnings (${warnings.length}):\n` + warnings.map((w) => `  - ${w}`).join('\n'));
