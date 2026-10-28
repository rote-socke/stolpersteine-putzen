import { describe, expect, it } from 'vitest';
import { groupLocations, parseCoordinates, parseDescription, parseKml, parseName } from '../scripts/kml.ts';

describe('parseName', () => {
  it('makes relative hrefs absolute', () => {
    expect(parseName('<b><a href="/biografien/lilly-abele-karl-kloss-str-42/">Lilly Abele</a></b>')).toEqual({
      name: 'Lilly Abele',
      bioUrl: 'https://www.stolpersteine-stuttgart.de/biografien/lilly-abele-karl-kloss-str-42/',
    });
  });
  it('upgrades cannstatt links to https and decodes entities', () => {
    const r = parseName('<b><a href="http://www.stolpersteine-cannstatt.de/node/142" target="_blank">Ernst B&amp;er</a></b>');
    expect(r).toEqual({ name: 'Ernst B&er', bioUrl: 'https://www.stolpersteine-cannstatt.de/node/142' });
  });
  it('handles names without link', () => {
    expect(parseName('<b>Elise Erlanger</b>')).toEqual({ name: 'Elise Erlanger', bioUrl: null });
  });
});

describe('parseDescription', () => {
  it('takes the address before the first <br> and collects links', () => {
    const r = parseDescription('Stöckachstr. 32<br><a href="https://open.spotify.com/episode/x" target="_blank">-gedenkworte</a><br>1GPS: 48.7911|9.201');
    expect(r.address).toBe('Stöckachstr. 32');
    expect(r.links).toEqual([{ label: 'Podcast', url: 'https://open.spotify.com/episode/x' }]);
  });
});

describe('parseCoordinates', () => {
  it('parses lon,lat', () => {
    expect(parseCoordinates('9.159,48.7578').coord).toEqual({ lat: 48.7578, lon: 9.159 });
  });
  it('repairs a double dot', () => {
    const r = parseCoordinates('9.146.423,48.783127');
    expect(r.repaired).toBe(true);
    expect(r.coord).toEqual({ lat: 48.783127, lon: 9.146423 });
  });
  it('drops missing or out-of-area values', () => {
    expect(parseCoordinates('').coord).toBeNull();
    expect(parseCoordinates('19.1,48.78').coord).toBeNull();
  });
});

describe('groupLocations', () => {
  const pm = (name: string, addr: string, coord: string) =>
    `<Placemark><name><![CDATA[<b>${name}</b>]]></name><description><![CDATA[${addr}<br>1GPS: 1|2]]></description><Point><coordinates>${coord}</coordinates></Point></Placemark>`;
  it('groups stones at one address, case/Straße-insensitive, and collapses duplicates', () => {
    const kml = pm('A', 'Hegelstr. 24', '9.1,48.7') + pm('B', 'hegelstraße  24', '9.1,48.7') + pm('B', 'Hegelstr. 24', '9.1,48.7');
    const { stones } = parseKml(kml);
    const { locations } = groupLocations(stones);
    expect(locations).toHaveLength(1);
    expect(locations[0].stones.map((s) => s.name)).toEqual(['A', 'B']);
    expect(locations[0].id).toMatch(/^[0-9a-f]{10}$/);
  });
  it('splits far-apart coordinates with distinct ids', () => {
    const { stones } = parseKml(pm('A', 'Weg 1', '9.1,48.7') + pm('B', 'Weg 1', '9.2,48.8'));
    const { locations } = groupLocations(stones);
    expect(locations).toHaveLength(2);
    expect(new Set(locations.map((l) => l.id)).size).toBe(2);
  });
});
