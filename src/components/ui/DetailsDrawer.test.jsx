import { describe, it, expect } from 'vitest';
import { groupNodes } from './DetailsDrawer';

describe('groupNodes', () => {
  it('collapses identical markup into one representative with a count, first in page order', () => {
    const btn = '<button><i class="ico"></i></button>';
    const groups = groupNodes([
      { html: btn, target: ['.toolbar > button:nth-child(1)'] },
      { html: '<a href="/x"></a>', target: ['a'] },
      { html: `  ${btn}\n`, target: ['.toolbar > button:nth-child(2)'] },   // whitespace differs only
      { html: btn, target: ['.toolbar > button:nth-child(3)'] },
    ]);
    expect(groups).toHaveLength(2);
    expect(groups[0]).toEqual({ html: btn, target: '.toolbar > button:nth-child(1)', count: 3 });
    expect(groups[1].count).toBe(1);
  });

  it('handles missing nodes', () => {
    expect(groupNodes(undefined)).toEqual([]);
  });
});
