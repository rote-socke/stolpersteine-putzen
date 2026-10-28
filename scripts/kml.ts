import { createHash } from 'node:crypto';

export const BASE_URL = 'https://www.stolpersteine-stuttgart.de';

export type Link = { label: string; url: string };
export type Stone = { name: string; bioUrl: string | null; links: Link[] };
export type RawStone = Stone & { address: string; lat: number | null; lon: number | null };
export type Location = {
  id: string;
  address: string;
  lat: number;
  lon: number;
  district: 'cannstatt' | null;
  stones: Stone[];
};

const ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
};

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === '#') {
      const code = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

const stripTags = (s: string) => s.replace(/<[^>]*>/g, '');
const clean = (s: string) => decodeEntities(stripTags(s)).replace(/\s+/g, ' ').trim();

export function absoluteUrl(href: string): string {
  let url = decodeEntities(href.trim());
  if (url.startsWith('//')) url = 'https:' + url;
  else if (url.startsWith('/')) url = BASE_URL + url;
  return url.replace(/^http:\/\/(www\.stolpersteine-(cannstatt|stuttgart)\.de)/i, 'https://$1');
}

/** Name text and bio link from the CDATA HTML of a placemark name. */
export function parseName(html: string): { name: string; bioUrl: string | null } {
  const a = /<a\s[^>]*href\s*=\s*"([^"]*)"[^>]*>([\s\S]*?)<\/a>/i.exec(html);
  if (a) return { name: clean(a[2]), bioUrl: a[1].trim() ? absoluteUrl(a[1]) : null };
  return { name: clean(html), bioUrl: null };
}

function linkLabel(url: string, text: string): string {
  let host = '';
  try {
    host = new URL(url).hostname.replace(/^www\./, '');
  } catch {
    // keep empty
  }
  if (host === 'open.spotify.com') return 'Podcast';
  const t = text.replace(/^[\s\-–]+/, '').trim();
  if (t.length >= 3 && t.length <= 30) return t.charAt(0).toUpperCase() + t.slice(1);
  return host || 'Link';
}

/** Address (text before the first <br>) and extra links of a description. */
export function parseDescription(html: string): { address: string; links: Link[] } {
  const [first, ...rest] = html.split(/<br\s*\/?>/i);
  const links: Link[] = [];
  for (const part of rest) {
    const re = /<a\s[^>]*href\s*=\s*"([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi;
    for (const m of part.matchAll(re)) {
      const url = absoluteUrl(m[1]);
      if (!/^https?:\/\//.test(url)) continue;
      links.push({ label: linkLabel(url, clean(m[2])), url });
    }
  }
  return { address: clean(first), links };
}

export type Coord = { lat: number; lon: number };
export type CoordResult = { coord: Coord | null; repaired: boolean };

const inStuttgart = (c: Coord) => c.lat >= 48.6 && c.lat <= 48.9 && c.lon >= 9.0 && c.lon <= 9.35;

/** Parses "lon,lat"; repairs a lon with several dots ("9.146.423" -> 9.146423). */
export function parseCoordinates(text: string | null | undefined): CoordResult {
  const parts = (text ?? '').trim().split(/\s*,\s*/);
  if (parts.length < 2) return { coord: null, repaired: false };
  let repaired = false;
  const fix = (s: string) => {
    const bits = s.split('.');
    if (bits.length > 2) {
      repaired = true;
      return bits[0] + '.' + bits.slice(1).join('');
    }
    return s;
  };
  const lon = Number(fix(parts[0]));
  const lat = Number(fix(parts[1]));
  const coord = { lat, lon };
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || !inStuttgart(coord)) {
    return { coord: null, repaired: false };
  }
  return { coord, repaired };
}

export type ParseResult = { stones: RawStone[]; placemarks: number; warnings: string[] };

/** Tolerant regex parse: the KML is not well-formed. */
export function parseKml(kml: string): ParseResult {
  const warnings: string[] = [];
  const stones: RawStone[] = [];
  let placemarks = 0;
  const tag = (block: string, t: string) => {
    const m = new RegExp(`<${t}>([\\s\\S]*?)</${t}>`, 'i').exec(block);
    if (!m) return null;
    const cd = /^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/.exec(m[1]);
    return cd ? cd[1] : m[1];
  };
  for (const pm of kml.matchAll(/<Placemark>([\s\S]*?)<\/Placemark>/gi)) {
    placemarks++;
    const block = pm[1];
    const { name, bioUrl } = parseName(tag(block, 'name') ?? '');
    const { address, links } = parseDescription(tag(block, 'description') ?? '');
    if (!name || !address) {
      warnings.push(`dropped placemark without name/address: "${name}" / "${address}"`);
      continue;
    }
    const { coord, repaired } = parseCoordinates(tag(block, 'coordinates'));
    const raw = (tag(block, 'coordinates') ?? '').trim();
    if (!coord) warnings.push(`no valid coordinates for ${name} (${address}): "${raw}"`);
    else if (repaired) warnings.push(`repaired coordinates for ${name} (${address}): "${raw}" -> ${coord.lon},${coord.lat}`);
    stones.push({ name, bioUrl, links, address, lat: coord?.lat ?? null, lon: coord?.lon ?? null });
  }
  return { stones, placemarks, warnings };
}

export function normalizeAddress(address: string): string {
  return address
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase()
    .replace(/stra(ß|ss)e(?=\s|$)/g, 'str.')
    .replace(/str\.?(?=\s|$)/g, 'str.');
}

const sha1 = (s: string) => createHash('sha1').update(s).digest('hex').slice(0, 10);

export function distanceMeters(a: Coord, b: Coord): number {
  const dLat = (b.lat - a.lat) * 111_320;
  const dLon = (b.lon - a.lon) * 111_320 * Math.cos((a.lat * Math.PI) / 180);
  return Math.hypot(dLat, dLon);
}

const MAX_SPREAD_M = 150;

/** Groups stones by normalized address (and by position if far apart). */
export function groupLocations(stones: RawStone[]): { locations: Location[]; warnings: string[] } {
  const warnings: string[] = [];
  const byAddress = new Map<string, RawStone[]>();
  for (const s of stones) {
    const key = normalizeAddress(s.address);
    byAddress.set(key, [...(byAddress.get(key) ?? []), s]);
  }
  const locations: Location[] = [];
  for (const [key, group] of byAddress) {
    // cluster by distance to the first coordinate of each cluster; stones without coordinates join the first
    const clusters: { coords: Coord[]; stones: RawStone[] }[] = [];
    for (const s of group) {
      const c = s.lat !== null && s.lon !== null ? { lat: s.lat, lon: s.lon } : null;
      let cl = c ? clusters.find((k) => k.coords.length > 0 && distanceMeters(k.coords[0], c) <= MAX_SPREAD_M) : clusters[0];
      if (!cl) {
        cl = { coords: [], stones: [] };
        clusters.push(cl);
      }
      cl.stones.push(s);
      if (c) cl.coords.push(c);
    }
    if (clusters.length > 1) warnings.push(`address "${key}" split into ${clusters.length} locations (coordinates > ${MAX_SPREAD_M} m apart)`);
    clusters.forEach((cl, i) => {
      if (cl.coords.length === 0) {
        warnings.push(`dropped location without coordinates: ${cl.stones[0].address} (${cl.stones.map((s) => s.name).join(', ')})`);
        return;
      }
      const lat = cl.coords.reduce((a, c) => a + c.lat, 0) / cl.coords.length;
      const lon = cl.coords.reduce((a, c) => a + c.lon, 0) / cl.coords.length;
      const seen = new Set<string>();
      const outStones: Stone[] = [];
      for (const s of cl.stones) {
        const k = `${s.name}\u0000${s.bioUrl ?? ''}`;
        if (seen.has(k)) continue;
        seen.add(k);
        outStones.push({ name: s.name, bioUrl: s.bioUrl, links: s.links });
      }
      const id = i === 0 ? sha1(key) : sha1(`${key}|${cl.coords[0].lat.toFixed(4)},${cl.coords[0].lon.toFixed(4)}`);
      const isCannstatt = cl.stones.some((s) => s.bioUrl?.startsWith('https://www.stolpersteine-cannstatt.de'));
      locations.push({
        id,
        address: cl.stones[0].address.replace(/\s+/g, ' ').trim(),
        lat: Math.round(lat * 1e6) / 1e6,
        lon: Math.round(lon * 1e6) / 1e6,
        district: isCannstatt ? 'cannstatt' : null,
        stones: outStones,
      });
    });
  }
  locations.sort((a, b) => a.address.localeCompare(b.address, 'de') || a.id.localeCompare(b.id));
  return { locations, warnings };
}
