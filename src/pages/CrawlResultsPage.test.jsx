import { describe, it, expect } from 'vitest';
import { normaliseStatus } from './CrawlResultsPage';

describe('normaliseStatus', () => {
  it('a scanned page with violations has not passed', () => {
    expect(normaliseStatus('scanned', 19)).toBe('Has issues');
    expect(normaliseStatus('scanned', 0)).toBe('Passed');
    expect(normaliseStatus('failed', 3)).toBe('Failed');
    expect(normaliseStatus('running')).toBe('Running');
  });
});
