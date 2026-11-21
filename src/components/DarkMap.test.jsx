import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import DarkMap from './DarkMap';
import L from 'leaflet';

const mockLayerGroup = {
  addTo: vi.fn().mockReturnThis(),
  clearLayers: vi.fn().mockReturnThis(),
  addLayer: vi.fn().mockReturnThis(),
};

const mockMap = {
  setView: vi.fn().mockReturnThis(),
  on: vi.fn().mockReturnThis(),
  remove: vi.fn().mockReturnThis(),
};

const mockCircle = {
  bindTooltip: vi.fn().mockReturnThis(),
  addTo: vi.fn().mockReturnThis(),
};

vi.mock('leaflet', () => {
  return {
    default: {
      map: vi.fn(() => mockMap),
      tileLayer: vi.fn(() => ({ addTo: vi.fn().mockReturnThis() })),
      layerGroup: vi.fn(() => mockLayerGroup),
      control: {
        zoom: vi.fn(() => ({ addTo: vi.fn().mockReturnThis() })),
      },
      circle: vi.fn(() => mockCircle),
      circleMarker: vi.fn(() => ({
        bindTooltip: vi.fn().mockReturnThis(),
        on: vi.fn().mockReturnThis(),
        addTo: vi.fn().mockReturnThis(),
      })),
      divIcon: vi.fn(() => ({})),
    },
  };
});

describe('DarkMap Hotspots and Risk Assessment Integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const realisticPlacesFixture = [
    { place: 'Mandi', district: 'Mandi', lat: 31.7087, lng: 76.932 },
    { place: 'Kullu', district: 'Kullu', lat: 31.9592, lng: 77.1089 },
  ];

  const realisticRiskAssessmentFixture = {
    label: 'AI-generated recommendation — requires human review',
    generated_at: '2026-11-21T10:15:00Z',
    window_minutes: 30,
    locations: [
      {
        place: 'Mandi',
        lat: 31.7087,
        lng: 76.932,
        incident_count: 2,
        report_count: 5,
        recent_report_count: 3,
        previous_report_count: 1,
        high_severity_incident_count: 2,
        requires_attention: true,
        reasons: [
          '2 active incidents are marked High or Critical.',
          'Report frequency increased from 1 to 3 in consecutive 30-minute windows.',
        ],
      },
      {
        place: 'Kullu',
        lat: 31.9592,
        lng: 77.1089,
        incident_count: 0,
        report_count: 0,
        recent_report_count: 0,
        previous_report_count: 0,
        high_severity_incident_count: 0,
        requires_attention: false,
        reasons: [],
      },
    ],
  };

  const realisticIncidentsFixture = [
    {
      incident_id: 'INC-MANDI-01',
      type: 'Flood',
      place: 'Mandi',
      severity: 'Critical',
      status: 'Confirmed',
      lat: 31.7087,
      lng: 76.932,
      report_ids: ['REP-01', 'REP-02'],
      report_count: 2,
    },
  ];

  it('renders hotspot toggle button and creates circle overlay for locations requiring attention', () => {
    render(
      <DarkMap
        incidents={realisticIncidentsFixture}
        reports={[]}
        places={realisticPlacesFixture}
        riskAssessment={realisticRiskAssessmentFixture}
      />
    );

    // Hotspot button must be ON by default
    const toggleBtn = screen.getByRole('button', { name: /Hotspots: ON/i });
    expect(toggleBtn).toBeInTheDocument();

    // Verify L.circle was called for Mandi (requires_attention: true)
    expect(L.circle).toHaveBeenCalledWith(
      [31.7087, 76.932],
      expect.objectContaining({
        radius: 8000,
        color: '#ff7518',
      })
    );

    // Verify tooltip was attached to hotspot circle with reasons
    expect(mockCircle.bindTooltip).toHaveBeenCalledWith(
      expect.objectContaining({
        textContent: expect.stringContaining('Advisory Risk Hotspot · Mandi'),
      }),
      expect.objectContaining({
        className: 'resq-map-tooltip',
        direction: 'top',
      })
    );
    expect(mockCircle.addTo).toHaveBeenCalledWith(mockLayerGroup);
  });

  it('toggles hotspots OFF and ON, updating the overlay layers', () => {
    render(
      <DarkMap
        incidents={realisticIncidentsFixture}
        reports={[]}
        places={realisticPlacesFixture}
        riskAssessment={realisticRiskAssessmentFixture}
      />
    );

    const toggleBtn = screen.getByRole('button', { name: /Hotspots: ON/i });
    expect(L.circle).toHaveBeenCalledTimes(1);

    // Click toggle button to switch OFF
    fireEvent.click(toggleBtn);
    expect(screen.getByRole('button', { name: /Hotspots: OFF/i })).toBeInTheDocument();

    // In OFF state, L.circle should not have been called again on re-render
    expect(L.circle).toHaveBeenCalledTimes(1);

    // Click toggle button to switch back ON
    fireEvent.click(screen.getByRole('button', { name: /Hotspots: OFF/i }));
    expect(screen.getByRole('button', { name: /Hotspots: ON/i })).toBeInTheDocument();
    expect(L.circle).toHaveBeenCalledTimes(2);
  });

  it('safely handles empty, null, and malformed riskAssessment without throwing', () => {
    const { rerender } = render(
      <DarkMap
        incidents={[]}
        reports={[]}
        places={[]}
        riskAssessment={null}
      />
    );

    // Must show truthful empty state when no incidents/risk data loaded
    expect(
      screen.getByText(
        'No live incident records loaded · Sign in as operator to view active incident markers'
      )
    ).toBeInTheDocument();

    // Malformed locations
    rerender(
      <DarkMap
        incidents={[]}
        reports={[]}
        places={[{ place: null, lat: 'bad', lng: undefined }]}
        riskAssessment={{
          locations: [
            null,
            { place: 'Nowhere', lat: null, lng: NaN, requires_attention: true },
            { place: 123, requires_attention: false },
          ],
        }}
      />
    );

    // Should not throw or call L.circle for malformed locations
    expect(L.circle).not.toHaveBeenCalled();
  });

  it('never substitutes mock data when riskAssessment is null or unavailable', () => {
    render(
      <DarkMap
        incidents={[]}
        reports={[]}
        places={realisticPlacesFixture}
        riskAssessment={null}
      />
    );

    // No circle overlays should be generated
    expect(L.circle).not.toHaveBeenCalled();
    // No mock advisory tooltips
    expect(mockCircle.bindTooltip).not.toHaveBeenCalled();
  });
});
