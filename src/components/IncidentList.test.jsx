import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import IncidentList from './IncidentList';

const incident = {
  incident_id: 'INC-1',
  report_count: 2,
  updated_at: '2026-11-04T12:00:00Z',
  type: 'Flood',
  place: 'Mandi',
  grouping_reason: 'Same location and time window.',
  severity: 'High',
  status: 'Unverified',
};

function renderList(overrides = {}) {
  const props = {
    incidents: [incident],
    selectedIncidentId: null,
    onSelectIncident: vi.fn(),
    statusFilter: 'ALL',
    onStatusFilterChange: vi.fn(),
    searchQuery: '',
    onSearchQueryChange: vi.fn(),
    ...overrides,
  };
  render(<IncidentList {...props} />);
  return props;
}

describe('IncidentList', () => {
  it('renders incident details and selects a card by keyboard activation', async () => {
    const user = userEvent.setup();
    const props = renderList();
    const card = screen.getByRole('button', { name: /Flood.*Mandi/i });

    card.focus();
    expect(card).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(props.onSelectIncident).toHaveBeenCalledWith('INC-1');
    expect(screen.getByText('2 reports')).toBeInTheDocument();
  });

  it('forwards status filters and renders an empty state', () => {
    const props = renderList({ incidents: [] });
    fireEvent.click(screen.getByRole('button', { name: 'Confirmed' }));
    expect(props.onStatusFilterChange).toHaveBeenCalledWith('Confirmed');
    expect(screen.getByText('No incidents match current filter')).toBeInTheDocument();
  });

  it('distinguishes unavailable incident data from an empty filtered result', () => {
    renderList({ incidents: [], isDataAvailable: false });
    expect(screen.getByText('Incident data unavailable')).toBeInTheDocument();
    expect(screen.getByText(/No live incident records were loaded/)).toBeInTheDocument();
  });

  it('forwards search text changes', () => {
    const props = renderList();
    fireEvent.change(
      screen.getByPlaceholderText(/Filter by place/i),
      { target: { value: 'Mandi' } },
    );
    expect(props.onSearchQueryChange).toHaveBeenCalledWith('Mandi');
  });
});
