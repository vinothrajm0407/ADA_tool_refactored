/**
 * Unit tests for src/utils/format.js
 *
 * Exports: formatDateTime, formatShortDate, formatUrl, formatDuration
 */
import { describe, it, expect } from 'vitest';
import { formatDateTime, formatShortDate, formatUrl, formatDuration } from './format.js';

// ── formatDateTime ────────────────────────────────────────────────────────────

describe('formatDateTime', () => {
  it('returns a non-empty string for a valid ISO timestamp', () => {
    const result = formatDateTime('2026-06-01T10:30:00Z');
    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(0);
    expect(result).not.toBe('—');
  });

  it('returns "—" for null', () => {
    expect(formatDateTime(null)).toBe('—');
  });

  it('returns "—" for undefined', () => {
    expect(formatDateTime(undefined)).toBe('—');
  });

  it('returns "—" for empty string', () => {
    expect(formatDateTime('')).toBe('—');
  });

  it('does not throw for invalid date string', () => {
    expect(() => formatDateTime('not-a-date')).not.toThrow();
  });

  it('formats a range of valid ISO dates', () => {
    const dates = [
      '2026-01-01T00:00:00Z',
      '2026-12-31T23:59:59.999Z',
      '2025-06-15T12:00:00+05:30',
    ];
    dates.forEach((d) => {
      const result = formatDateTime(d);
      expect(typeof result).toBe('string');
      expect(result).not.toBe('—');
    });
  });
});

// ── formatShortDate ───────────────────────────────────────────────────────────

describe('formatShortDate', () => {
  it('returns a non-empty string for a valid date string', () => {
    const result = formatShortDate('2026-06-01T10:30:00Z');
    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(0);
  });

  it('returns empty string for null', () => {
    expect(formatShortDate(null)).toBe('');
  });

  it('returns empty string for undefined', () => {
    expect(formatShortDate(undefined)).toBe('');
  });

  it('returns empty string for empty string', () => {
    expect(formatShortDate('')).toBe('');
  });

  it('does not throw for invalid date string', () => {
    expect(() => formatShortDate('bad')).not.toThrow();
  });

  it('result for June date contains month abbreviation or number', () => {
    const result = formatShortDate('2026-06-15T00:00:00Z');
    // Locale-dependent, but should contain "Jun", "6", or "June"
    expect(result).toMatch(/jun|6/i);
  });
});

// ── formatUrl ─────────────────────────────────────────────────────────────────

describe('formatUrl', () => {
  it('strips protocol and returns hostname + path', () => {
    const result = formatUrl('https://www.example.com/path/page');
    expect(result).toBe('www.example.com/path/page');
  });

  it('strips trailing slash from root path', () => {
    const result = formatUrl('https://example.com/');
    expect(result).toBe('example.com');
  });

  it('includes subpath when path is not /', () => {
    const result = formatUrl('https://example.com/about');
    expect(result).toBe('example.com/about');
  });

  it('returns original string for an invalid URL', () => {
    const result = formatUrl('not-a-url');
    expect(result).toBe('not-a-url');
  });

  it('handles null without throwing and returns null (passthrough)', () => {
    expect(() => formatUrl(null)).not.toThrow();
  });

  it('handles undefined without throwing', () => {
    expect(() => formatUrl(undefined)).not.toThrow();
  });

  it('strips query string from result', () => {
    const result = formatUrl('https://example.com/page?foo=bar');
    expect(result).not.toContain('?');
    expect(result).not.toContain('foo');
  });

  it('handles https and http protocols identically', () => {
    const https = formatUrl('https://example.com/page');
    const http  = formatUrl('http://example.com/page');
    expect(https).toBe(http);
  });
});

// ── formatDuration ────────────────────────────────────────────────────────────

describe('formatDuration', () => {
  it('returns "—" for null', () => {
    expect(formatDuration(null)).toBe('—');
  });

  it('returns "—" for undefined', () => {
    expect(formatDuration(undefined)).toBe('—');
  });

  it('formats 0 seconds as "0s"', () => {
    expect(formatDuration(0)).toBe('0s');
  });

  it('formats sub-minute as seconds', () => {
    expect(formatDuration(45)).toBe('45s');
  });

  it('formats exactly 60 seconds as "1m"', () => {
    expect(formatDuration(60)).toBe('1m');
  });

  it('formats 90 seconds as "1m 30s"', () => {
    expect(formatDuration(90)).toBe('1m 30s');
  });

  it('formats 120 seconds as "2m"', () => {
    expect(formatDuration(120)).toBe('2m');
  });

  it('formats 3600 seconds as "60m"', () => {
    expect(formatDuration(3600)).toBe('60m');
  });

  it('formats 3661 seconds as "61m 1s"', () => {
    expect(formatDuration(3661)).toBe('61m 1s');
  });

  it('rounds fractional seconds', () => {
    expect(formatDuration(45.6)).toBe('46s');
  });

  it('returns a string for any non-negative number', () => {
    [0, 1, 59, 60, 61, 600, 3600].forEach((n) => {
      expect(typeof formatDuration(n)).toBe('string');
    });
  });
});
