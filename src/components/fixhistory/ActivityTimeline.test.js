import { describe, it, expect } from 'vitest';
import { filterEvents } from './ActivityTimeline';

const ev = [
  { at: '2026-11-19T11:12:00+00:00', kind: 'review', action: 'PR merged', target: 'https://x/', result: '', by: 'lead', ref: 'FIX-86' },
  { at: '2026-11-18T09:09:00+00:00', kind: 'scan', action: 'Page scanned', target: 'https://y/', result: '6 failed', by: '', ref: 'SCAN-91' },
];
const none = { kinds: new Set(), q: '', from: '', to: '' };

describe('filterEvents', () => {
  it('filters by type, text and date range', () => {
    expect(filterEvents(ev, none)).toHaveLength(2);
    expect(filterEvents(ev, { ...none, kinds: new Set(['scan']) }).map(e => e.ref)).toEqual(['SCAN-91']);
    expect(filterEvents(ev, { ...none, q: 'LEAD' }).map(e => e.ref)).toEqual(['FIX-86']);
    expect(filterEvents(ev, { ...none, from: '2026-11-19' }).map(e => e.ref)).toEqual(['FIX-86']);
    expect(filterEvents(ev, { ...none, to: '2026-11-18' }).map(e => e.ref)).toEqual(['SCAN-91']);
  });
});
