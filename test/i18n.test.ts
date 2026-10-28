import { describe, expect, it } from 'vitest';
// @ts-expect-error plain JS module without types
import { detectLang, dictionaries, getLang, setLang, t } from '../public/js/i18n.js';

describe('detectLang', () => {
  it('picks German for any de-* entry', () => {
    expect(detectLang(['de-CH'])).toBe('de');
    expect(detectLang(['fr', 'de'])).toBe('de');
    expect(detectLang(['en-US', 'de-AT'])).toBe('de');
  });
  it('falls back to English', () => {
    expect(detectLang(['en-US'])).toBe('en');
    expect(detectLang([])).toBe('en');
    expect(detectLang(undefined)).toBe('en');
    expect(detectLang(['dex'])).toBe('en');
  });
});

const placeholders = (v: unknown): string[] => {
  const texts = typeof v === 'string' ? [v] : Object.values(v as Record<string, string>);
  return [...new Set(texts.flatMap((s) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1])))].sort();
};

describe('dictionaries', () => {
  it('have the same keys', () => {
    expect(Object.keys(dictionaries.en).sort()).toEqual(Object.keys(dictionaries.de).sort());
  });
  it('use the same placeholders and plural forms per key', () => {
    for (const key of Object.keys(dictionaries.de)) {
      expect(placeholders(dictionaries.en[key]), key).toEqual(placeholders(dictionaries.de[key]));
      expect(typeof dictionaries.en[key], key).toBe(typeof dictionaries.de[key]);
    }
  });
  it('interpolates and pluralises', () => {
    setLang('en');
    expect(getLang()).toBe('en');
    expect(t('stones.summary', { count: 1, names: 'A' })).toBe('1 stone · A');
    expect(t('stones.summary', { count: 2, names: 'A, B' })).toBe('2 stones · A, B');
    setLang('de');
    expect(t('stones.summary', { count: 1, names: 'A' })).toBe('1 Stein · A');
    expect(t('stones.summary', { count: 2, names: 'A, B' })).toBe('2 Steine · A, B');
    expect(t('toast.taken', { name: 'Wir' })).toBe('Wir ist schon unterwegs dorthin.');
  });
});
