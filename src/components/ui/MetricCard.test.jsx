/**
 * Unit tests for MetricCard component.
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import MetricCard from './MetricCard';
import { Activity } from 'lucide-react';

describe('MetricCard', () => {
  it('renders the title', () => {
    render(<MetricCard title="Total Scans" value={42} />);
    expect(screen.getByText('Total Scans')).toBeInTheDocument();
  });

  it('renders the value', () => {
    render(<MetricCard title="Total Scans" value={42} />);
    expect(screen.getByText('42')).toBeInTheDocument();
  });

  it('renders trend text when provided', () => {
    render(<MetricCard title="Score" value={88} trend="+5 from last scan" />);
    expect(screen.getByText('+5 from last scan')).toBeInTheDocument();
  });

  it('does not render trend section when omitted', () => {
    const { queryByText } = render(<MetricCard title="Score" value={88} />);
    expect(queryByText(/from/i)).toBeNull();
  });

  it('renders loading skeleton when loading is true', () => {
    const { container } = render(<MetricCard title="Score" value={0} loading={true} />);
    expect(container.querySelector('.animate-pulse')).not.toBeNull();
  });

  it('does not show title in loading state', () => {
    render(<MetricCard title="Score" value={0} loading={true} />);
    expect(screen.queryByText('Score')).toBeNull();
  });

  it('renders icon when provided', () => {
    const { container } = render(<MetricCard title="T" value={1} icon={Activity} />);
    expect(container.querySelector('svg')).not.toBeNull();
  });

  it('renders without icon prop', () => {
    expect(() => render(<MetricCard title="T" value={1} />)).not.toThrow();
  });

  it('accepts string values', () => {
    render(<MetricCard title="Status" value="Active" />);
    expect(screen.getByText('Active')).toBeInTheDocument();
  });

  it('accepts zero as a valid value', () => {
    render(<MetricCard title="Violations" value={0} />);
    expect(screen.getByText('0')).toBeInTheDocument();
  });
});
