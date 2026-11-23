import { describe, it, expect } from 'vitest';
import { autoFixUnavailableReason } from './autoFixSupport';

describe('autoFixUnavailableReason', () => {
  const noAi = { ai: false, rules: ['list', 'image-alt'] };
  it('allows built-in rules and blocks the rest when AI is off', () => {
    expect(autoFixUnavailableReason(noAi, 'list')).toBeNull();
    expect(autoFixUnavailableReason(noAi, 'video-caption')).toMatch(/isn’t available/);
    expect(autoFixUnavailableReason(noAi, 'list', false)).toMatch(/page-wide/); // page-wide always needs AI
  });
  it('never blocks with AI on or when support is unknown', () => {
    expect(autoFixUnavailableReason({ ai: true, rules: [] }, 'video-caption', false)).toBeNull();
    expect(autoFixUnavailableReason(null, 'video-caption')).toBeNull();
  });});
