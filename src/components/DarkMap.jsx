import React, { useEffect, useRef, useState } from 'react';
import L from 'leaflet';

const SEVERITY_STYLES = {
  Critical: { color: '#ef6464', size: 15 },
  High: { color: '#ef8b4d', size: 13 },
  Medium: { color: '#e7b963', size: 11 },
  Low: { color: '#70b895', size: 9 },
};

function isValidCoordinate(lat, lng) {
  if (lat === null || lat === undefined || lat === '' ||
      lng === null || lng === undefined || lng === '') {
    return false;
  }
  const latitude = Number(lat);
  const longitude = Number(lng);
  return Number.isFinite(latitude) &&
    Number.isFinite(longitude) &&
    Math.abs(latitude) <= 90 &&
    Math.abs(longitude) <= 180;
}

function createTooltip(title, details) {
  const content = document.createElement('div');
  content.className = 'space-y-0.5';
  const heading = document.createElement('strong');
  heading.textContent = title;
  heading.className = 'block text-white';
  content.appendChild(heading);
  details.forEach((detail) => {
    const line = document.createElement('span');
    line.textContent = detail;
    line.className = 'block text-slate-200';
    content.appendChild(line);
  });
  return content;
}

export default function DarkMap({
  incidents,
  places,
  reports,
  selectedIncidentId,
  onSelectIncident,
  severityFilter,
  onSeverityFilterChange,
  typeFilter,
  onTypeFilterChange,
  verificationFilter,
  onVerificationFilterChange,
}) {
  const mapContainerRef = useRef(null);
  const mapInstanceRef = useRef(null);
  const markersLayerRef = useRef(null);
  const [hoveredItem, setHoveredItem] = useState(null);
  const incidentTypes = [...new Set(incidents.map((incident) => incident.type).filter(Boolean))].sort();

  useEffect(() => {
    if (!mapContainerRef.current || mapInstanceRef.current) return undefined;

    const map = L.map(mapContainerRef.current, {
      center: [31.78, 77.05],
      zoom: 8,
      minZoom: 7,
      maxZoom: 14,
      zoomControl: false,
      attributionControl: true,
    });

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>',
      maxZoom: 19,
    }).addTo(map);
    L.control.zoom({ position: 'bottomright' }).addTo(map);
    markersLayerRef.current = L.layerGroup().addTo(map);
    mapInstanceRef.current = map;

    return () => {
      map.remove();
      mapInstanceRef.current = null;
      markersLayerRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapInstanceRef.current;
    const layerGroup = markersLayerRef.current;
    if (!map || !layerGroup) return;
    layerGroup.clearLayers();

    places.filter((place) => isValidCoordinate(place.lat, place.lng)).forEach((place) => {
      const marker = L.circleMarker([Number(place.lat), Number(place.lng)], {
        radius: 5,
        color: '#c4b5fd',
        weight: 1.5,
        fillColor: '#8b5cf6',
        fillOpacity: 0.35,
      });
      marker.bindTooltip(
        createTooltip(place.place || place.name || 'Fixed location', [
          'Predefined location',
          `${Number(place.lat).toFixed(4)}, ${Number(place.lng).toFixed(4)}`,
        ]),
        { direction: 'top', className: 'resq-map-tooltip', opacity: 1 }
      );
      marker.on('mouseover', () => setHoveredItem({
        label: place.place || place.name || 'Fixed location',
        lat: Number(place.lat),
        lng: Number(place.lng),
      }));
      marker.on('mouseout', () => setHoveredItem(null));
      marker.addTo(layerGroup);
    });

    const eligibleIncidents = incidents
      .filter((incident) => incident.status !== 'Rejected')
      .filter((incident) => severityFilter === 'ALL' || incident.severity === severityFilter)
      .filter((incident) => typeFilter === 'ALL' || incident.type === typeFilter)
      .map((incident) => {
        const linkedReports = reports.filter(
          (report) =>
            (incident.report_ids || []).includes(report.report_id) ||
            report.incident_id === incident.incident_id
        );
        const verificationStatus =
          incident.status === 'Confirmed' ||
          linkedReports.some((report) => report.verification_status === 'Confirmed')
            ? 'Confirmed'
            : incident.status === 'Corroborated' ||
                linkedReports.some((report) => report.verification_status === 'Corroborated')
              ? 'Corroborated'
              : linkedReports.length > 0 &&
                  linkedReports.every((report) => report.verification_status === 'Rejected')
                ? 'Rejected'
                : 'Unverified';
        return { incident, linkedReports, verificationStatus };
      })
      .filter(({ verificationStatus }) =>
        verificationFilter === 'ALL' ||
        verificationStatus === verificationFilter
      )
      .filter(({ incident }) => isValidCoordinate(incident.lat, incident.lng))
      .sort(({ incident: left }, { incident: right }) =>
        Number(left.incident_id === selectedIncidentId) -
        Number(right.incident_id === selectedIncidentId)
      );

    eligibleIncidents.forEach(({ incident, linkedReports, verificationStatus }) => {
      const severity = SEVERITY_STYLES[incident.severity] || SEVERITY_STYLES.Low;
      const reportCount = Math.max(
        Number(incident.report_count) || 0,
        (incident.report_ids || []).length,
        linkedReports.length
      );
      const selected = incident.incident_id === selectedIncidentId;
      const marker = L.circleMarker([Number(incident.lat), Number(incident.lng)], {
        radius: severity.size + (selected ? 3 : 0),
        color: selected
          ? '#ffffff'
          : verificationStatus === 'Confirmed'
            ? '#22c55e'
            : verificationStatus === 'Corroborated'
              ? '#38bdf8'
              : '#f8fafc',
        weight: selected ? 3 : verificationStatus === 'Unverified' ? 1.5 : 2.5,
        dashArray: verificationStatus === 'Unverified' ? '3 3' : undefined,
        fillColor: severity.color,
        fillOpacity: 0.95,
        riseOnHover: true,
      });
      marker.bindTooltip(
        createTooltip(incident.incident_id, [
          `${incident.type || 'Incident'} · ${incident.severity || 'Unknown'} severity`,
          `${incident.place || 'Unknown location'} · ${reportCount} report(s)`,
          verificationStatus === 'Confirmed'
            ? 'Human-confirmed'
            : verificationStatus === 'Corroborated'
              ? 'Corroborated reports; not confirmed'
              : verificationStatus,
        ]),
        { direction: 'top', className: 'resq-map-tooltip', opacity: 1 }
      );
      marker.on('mouseover', () => setHoveredItem({
        label: incident.incident_id,
        lat: Number(incident.lat),
        lng: Number(incident.lng),
        detail: `${incident.type} · ${incident.place} · ${reportCount} reports`,
      }));
      marker.on('mouseout', () => setHoveredItem(null));
      marker.on('click', () => onSelectIncident(incident.incident_id));
      marker.addTo(layerGroup);
    });
  }, [
    incidents,
    places,
    reports,
    selectedIncidentId,
    onSelectIncident,
    severityFilter,
    typeFilter,
    verificationFilter,
  ]);

  useEffect(() => {
    const map = mapInstanceRef.current;
    const target = incidents.find(
      (incident) =>
        incident.incident_id === selectedIncidentId &&
        isValidCoordinate(incident.lat, incident.lng)
    );
    if (map && target) {
      map.flyTo([Number(target.lat), Number(target.lng)], 10, { duration: 0.7 });
    }
  }, [selectedIncidentId, incidents]);

  const handleResetView = () => {
    mapInstanceRef.current?.flyTo([31.78, 77.05], 8, { duration: 0.7 });
  };

  return (
    <div className="relative flex h-full min-h-[420px] w-full flex-col overflow-hidden rounded-2xl border border-purple-400/20 bg-[#120721] shadow-[0_12px_40px_rgba(0,0,0,0.6)]">
      <div className="pointer-events-none absolute left-3 right-3 top-3 z-[400] flex flex-wrap items-start justify-between gap-2">
        <div className="pointer-events-auto rounded-xl border border-purple-400/25 bg-[#1a0b2e]/95 px-3 py-2 shadow-lg">
          <h2 className="font-display text-xs font-bold uppercase tracking-wider text-white">
            Himachal Pradesh · {places.length} fixed locations
          </h2>
          <p className="text-[10px] text-purple-200/75">
            Incident markers use stored coordinates; dotted outline indicates unverified
          </p>
        </div>

        <div className="pointer-events-auto flex max-w-full flex-wrap items-center gap-1.5 rounded-xl border border-purple-400/25 bg-[#1a0b2e]/95 p-2 shadow-lg">
          <label className="text-[10px] text-purple-200">
            Severity
            <select
              value={severityFilter}
              onChange={(event) => onSeverityFilterChange(event.target.value)}
              className="ml-1 rounded bg-[#120721] px-1.5 py-1 text-[10px] text-white"
            >
              {['ALL', 'Critical', 'High', 'Medium', 'Low'].map((value) => (
                <option key={value} value={value}>{value === 'ALL' ? 'All' : value}</option>
              ))}
            </select>
          </label>
          <label className="text-[10px] text-purple-200">
            Type
            <select
              value={typeFilter}
              onChange={(event) => onTypeFilterChange(event.target.value)}
              className="ml-1 max-w-28 rounded bg-[#120721] px-1.5 py-1 text-[10px] text-white"
            >
              <option value="ALL">All</option>
              {incidentTypes.map((type) => <option key={type}>{type}</option>)}
            </select>
          </label>
          <label className="text-[10px] text-purple-200">
            Verification
            <select
              value={verificationFilter}
              onChange={(event) => onVerificationFilterChange(event.target.value)}
              className="ml-1 rounded bg-[#120721] px-1.5 py-1 text-[10px] text-white"
            >
              {['ALL', 'Confirmed', 'Corroborated', 'Unverified', 'Rejected'].map((value) => (
                <option key={value}>{value}</option>
              ))}
            </select>
          </label>
          <button
            type="button"
            onClick={handleResetView}
            className="rounded-lg border border-purple-300/20 bg-[#2D1B4E]/80 px-2 py-1 text-[10px] text-purple-100"
          >
            Reset
          </button>
        </div>
      </div>

      <div ref={mapContainerRef} className="z-10 min-h-[420px] w-full flex-1" />

      <div className="relative z-[400] flex flex-wrap items-center justify-between gap-2 border-t border-purple-400/20 bg-[#1a0b2e]/95 px-4 py-2.5 text-[10px]">
        <div className="flex flex-wrap gap-x-3 gap-y-1 text-purple-100">
          {Object.entries(SEVERITY_STYLES).map(([name, style]) => (
            <span key={name} className="flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: style.color }} />
              {name}
            </span>
          ))}
          <span className="text-emerald-300">Green outline: human-confirmed</span>
          <span className="text-sky-300">Blue outline: corroborated, not confirmed</span>
          <span className="text-slate-200">Dotted outline: unverified</span>
        </div>
        <span className="max-w-full truncate font-mono text-purple-200/75">
          {hoveredItem
            ? `${hoveredItem.label} · ${hoveredItem.lat.toFixed(4)}, ${hoveredItem.lng.toFixed(4)}${hoveredItem.detail ? ` · ${hoveredItem.detail}` : ''}`
            : 'Select an incident marker to open its evidence and response details'}
        </span>
      </div>
    </div>
  );
}
