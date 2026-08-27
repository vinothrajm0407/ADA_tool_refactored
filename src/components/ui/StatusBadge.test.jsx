/**
 * Unit tests for StatusBadge and StatusPill components.
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import StatusBadge, { StatusPill } from './StatusBadge';

// ── StatusBadge ───────────────────────────────────────────────────────────────

describe('StatusBadge', () => {
  it('renders the status text', () => {
    render(<StatusBadge status="Passed" />);
    expect(screen.getByText('Passed')).toBeInTheDocument();
  });

  it('applies sage colour class for Passed', () => {
    const { container } = render(<StatusBadge status="Passed" />);
    expect(container.firstChild.className).toContain('text-sage');
  });

  it('applies amber colour class for Needs review', () => {
    const { container } = render(<StatusBadge status="Needs review" />);
    expect(container.firstChild.className).toContain('text-amber');
  });

  it('applies coral colour class for Failed', () => {
    const { container } = render(<StatusBadge status="Failed" />);
    expect(container.firstChild.className).toContain('text-coral');
  });

  it('applies teal colour class for Running', () => {
    const { container } = render(<StatusBadge status="Running" />);
    expect(container.firstChild.className).toContain('text-teal');
  });

  it('falls back to body colour for unknown status', () => {
    const { container } = render(<StatusBadge status="Unknown" />);
    expect(container.firstChild.className).toContain('text-body');
  });

  it('renders as a span element', () => {
    render(<StatusBadge status="Passed" />);
    expect(screen.getByText('Passed').tagName).toBe('SPAN');
  });

  it('includes rounded-full class', () => {
    const { container } = render(<StatusBadge status="Passed" />);
    expect(container.firstChild.className).toContain('rounded-full');
  });
});

// ── StatusPill ────────────────────────────────────────────────────────────────

describe('StatusPill', () => {
  it('renders the severity text', () => {
    render(<StatusPill severity="Critical" />);
    expect(screen.getByText('Critical')).toBeInTheDocument();
  });

  it('applies coral colour class for Critical', () => {
    const { container } = render(<StatusPill severity="Critical" />);
    expect(container.firstChild.className).toContain('text-coral');
  });

  it('applies amber colour class for Moderate', () => {
    const { container } = render(<StatusPill severity="Moderate" />);
    expect(container.firstChild.className).toContain('text-amber');
  });

  it('applies sage colour class for Minor', () => {
    const { container } = render(<StatusPill severity="Minor" />);
    expect(container.firstChild.className).toContain('text-sage');
  });

  it('falls back to body colour for unknown severity', () => {
    const { container } = render(<StatusPill severity="Unknown" />);
    expect(container.firstChild.className).toContain('text-body');
  });

  it('renders as a span element', () => {
    render(<StatusPill severity="Serious" />);
    expect(screen.getByText('Serious').tagName).toBe('SPAN');
  });
});
