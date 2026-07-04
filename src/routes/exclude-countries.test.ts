import { describe, it, expect } from 'vitest';
import { normalizeExcludeCountries, excludedAlpha2Set } from './exclude-countries.js';
import { ApiError } from '../errors.js';

describe('normalizeExcludeCountries', () => {
  it('returns [] for missing input', () => {
    expect(normalizeExcludeCountries(undefined)).toEqual([]);
    expect(normalizeExcludeCountries(null)).toEqual([]);
    expect(normalizeExcludeCountries([])).toEqual([]);
    expect(normalizeExcludeCountries('')).toEqual([]);
  });

  it('maps alpha-2 codes to alpha-3', () => {
    expect(normalizeExcludeCountries(['CH'])).toEqual(['CHE']);
    expect(normalizeExcludeCountries(['AT', 'DE', 'PL'])).toEqual(['AUT', 'DEU', 'POL']);
  });

  it('accepts alpha-3 codes directly', () => {
    expect(normalizeExcludeCountries(['CHE', 'AUT'])).toEqual(['CHE', 'AUT']);
  });

  it('maps the full required table', () => {
    const pairs: Array<[string, string]> = [
      ['CH', 'CHE'], ['AT', 'AUT'], ['DE', 'DEU'], ['PL', 'POL'], ['CZ', 'CZE'],
      ['SK', 'SVK'], ['FR', 'FRA'], ['IT', 'ITA'], ['GB', 'GBR'], ['UK', 'GBR'],
      ['NL', 'NLD'], ['BE', 'BEL'], ['ES', 'ESP'], ['PT', 'PRT'], ['SI', 'SVN'],
      ['HR', 'HRV'], ['HU', 'HUN'], ['RO', 'ROU'], ['BG', 'BGR'], ['DK', 'DNK'],
      ['SE', 'SWE'], ['NO', 'NOR'], ['FI', 'FIN'],
    ];
    for (const [input, expected] of pairs) {
      expect(normalizeExcludeCountries([input])).toEqual([expected]);
    }
  });

  it('deduplicates across alpha-2/alpha-3/case variants', () => {
    expect(normalizeExcludeCountries(['CH', 'CHE', 'ch'])).toEqual(['CHE']);
  });

  it('accepts a comma-separated string with whitespace', () => {
    expect(normalizeExcludeCountries(' ch , AUT,  de ')).toEqual(['CHE', 'AUT', 'DEU']);
  });

  it('rejects unsupported codes with a clear 400 error', () => {
    expect(() => normalizeExcludeCountries(['XX'])).toThrowError(
      'Unsupported exclude country code: XX'
    );
    try {
      normalizeExcludeCountries(['XX']);
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError);
      expect((err as ApiError).statusCode).toBe(400);
      expect((err as ApiError).code).toBe('VALIDATION_ERROR');
    }
  });

  it('rejects non-string/non-array input', () => {
    expect(() => normalizeExcludeCountries(42)).toThrowError(ApiError);
    expect(() => normalizeExcludeCountries({})).toThrowError(ApiError);
  });
});

describe('excludedAlpha2Set', () => {
  it('converts normalized alpha-3 back to alpha-2 for geography comparison', () => {
    const set = excludedAlpha2Set(['CHE', 'AUT', 'GBR']);
    expect(set.has('CH')).toBe(true);
    expect(set.has('AT')).toBe(true);
    expect(set.has('GB')).toBe(true);
    expect(set.has('IT')).toBe(false);
  });
});
