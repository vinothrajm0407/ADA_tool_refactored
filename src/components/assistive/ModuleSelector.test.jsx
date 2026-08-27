/**
 * Unit tests for ModuleSelector component.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import ModuleSelector from './ModuleSelector';
import { Monitor, Palette } from 'lucide-react';

const MODULES = [
  {
    id: 'keyboard',
    label: 'Keyboard Navigation',
    description: 'Test keyboard accessibility',
    status: 'active',
    icon: Monitor,
  },
  {
    id: 'contrast',
    label: 'Color Contrast',
    description: 'Analyse colour contrast ratios',
    status: 'active',
    icon: Palette,
  },
  {
    id: 'screen-reader',
    label: 'Screen Reader',
    description: 'Coming soon',
    status: 'planned',
    icon: Monitor,
  },
];

describe('ModuleSelector', () => {
  it('renders all active module labels', () => {
    render(<ModuleSelector modules={MODULES} activeModuleId={null} onSelect={vi.fn()} />);
    expect(screen.getByText('Keyboard Navigation')).toBeInTheDocument();
    expect(screen.getByText('Color Contrast')).toBeInTheDocument();
  });

  it('renders planned module label', () => {
    render(<ModuleSelector modules={MODULES} activeModuleId={null} onSelect={vi.fn()} />);
    expect(screen.getByText('Screen Reader')).toBeInTheDocument();
  });

  it('shows "Soon" badge for planned modules', () => {
    render(<ModuleSelector modules={MODULES} activeModuleId={null} onSelect={vi.fn()} />);
    expect(screen.getByText('Soon')).toBeInTheDocument();
  });

  it('shows "Available Now" section heading', () => {
    render(<ModuleSelector modules={MODULES} activeModuleId={null} onSelect={vi.fn()} />);
    expect(screen.getByText(/available now/i)).toBeInTheDocument();
  });

  it('calls onSelect with module id when active card is clicked', () => {
    const onSelect = vi.fn();
    render(<ModuleSelector modules={MODULES} activeModuleId={null} onSelect={onSelect} />);
    fireEvent.click(screen.getByText('Keyboard Navigation').closest('button'));
    expect(onSelect).toHaveBeenCalledWith('keyboard');
  });

  it('calls onSelect with correct id for second module', () => {
    const onSelect = vi.fn();
    render(<ModuleSelector modules={MODULES} activeModuleId={null} onSelect={onSelect} />);
    fireEvent.click(screen.getByText('Color Contrast').closest('button'));
    expect(onSelect).toHaveBeenCalledWith('contrast');
  });

  it('applies teal border to selected module', () => {
    const { container } = render(
      <ModuleSelector modules={MODULES} activeModuleId="keyboard" onSelect={vi.fn()} />
    );
    const buttons = container.querySelectorAll('button');
    const selected = Array.from(buttons).find((b) => b.textContent.includes('Keyboard Navigation'));
    expect(selected.className).toContain('border-teal');
  });

  it('unselected active module does not have teal border', () => {
    const { container } = render(
      <ModuleSelector modules={MODULES} activeModuleId="keyboard" onSelect={vi.fn()} />
    );
    const buttons = container.querySelectorAll('button');
    const unselected = Array.from(buttons).find((b) => b.textContent.includes('Color Contrast'));
    expect(unselected.className).not.toContain('border-teal bg-teal');
  });

  it('renders without planned modules when none exist', () => {
    const activesOnly = MODULES.filter((m) => m.status === 'active');
    const { queryByText } = render(
      <ModuleSelector modules={activesOnly} activeModuleId={null} onSelect={vi.fn()} />
    );
    expect(queryByText('Soon')).toBeNull();
  });

  it('renders nothing broken with empty modules array', () => {
    expect(() =>
      render(<ModuleSelector modules={[]} activeModuleId={null} onSelect={vi.fn()} />)
    ).not.toThrow();
  });

  it('planned module is not a button (not clickable)', () => {
    const { container } = render(
      <ModuleSelector modules={MODULES} activeModuleId={null} onSelect={vi.fn()} />
    );
    // planned cards are divs, not buttons
    const buttons = container.querySelectorAll('button');
    const buttonTexts = Array.from(buttons).map((b) => b.textContent);
    expect(buttonTexts.some((t) => t.includes('Screen Reader'))).toBe(false);
  });

  it('renders module descriptions', () => {
    render(<ModuleSelector modules={MODULES} activeModuleId={null} onSelect={vi.fn()} />);
    expect(screen.getByText('Test keyboard accessibility')).toBeInTheDocument();
  });
});
