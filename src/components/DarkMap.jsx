import React, { useEffect, useRef, useState } from 'react';
import L from 'leaflet';

const SEVERITY_STYLES = {
  Critical: { color: '#ef6464', size: 15 },
  High: { color: '#ff7518', size: 13 },
  Medium: { color: '#ffb347', size: 11 },
  Low: { color: '#b89ad4', size: 9 },
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
  riskAssessment,
}) {
  const mapContainerRef = useRef(null);
  const mapInstanceRef = useRef(null);
  const markersLayerRef = useRef(null);
  const [hoveredItem, setHoveredItem] = useState(null);
  const [showHotspots, setShowHotspots] = useState(true);
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
        className: 'rq-map-place',
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

    // Render computed risk hotspots from authorized risk assessment if enabled
    if (showHotspots && Array.isArray(riskAssessment?.locations)) {
      const placeCoordMap = new Map();
      (places || []).forEach((p) => {
        if (p && isValidCoordinate(p.lat, p.lng)) {
          const placeKey = String(p.place || p.name || '').trim().toLowerCase();
          if (placeKey) {
            placeCoordMap.set(placeKey, [Number(p.lat), Number(p.lng)]);
          }
        }
      });

      riskAssessment.locations.filter((loc) => loc && loc.requires_attention).forEach((loc) => {
        let coords = null;
        if (isValidCoordinate(loc.lat, loc.lng)) {
          coords = [Number(loc.lat), Number(loc.lng)];
        } else if (loc.place && typeof loc.place === 'string') {
          const placeKey = loc.place.trim().toLowerCase();
          coords = placeCoordMap.get(placeKey) || null;
        }

        if (coords) {
          const hotspotZone = L.circle(coords, {
            radius: 8000,
            color: '#ff7518',
            weight: 1.5,
            dashArray: '6 6',
            fillColor: '#ff7518',
            fillOpacity: 0.1,
          });
          const reasons = Array.isArray(loc.reasons) && loc.reasons.length
            ? loc.reasons
            : ['Operational density threshold met'];
          hotspotZone.bindTooltip(
            createTooltip(`Advisory Risk Hotspot · ${loc.place || 'Sector'}`, [
              `${loc.incident_count ?? 0} active incident(s) · ${loc.report_count ?? 0} report(s)`,
              ...reasons,
            ]),
            { direction: 'top', className: 'resq-map-tooltip', opacity: 1 }
          );
          hotspotZone.addTo(layerGroup);
        }
      });
    }

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
      const severityKey = String(incident.severity || 'low').toLowerCase();
      if (showHotspots && reportCount > 1) {
        const haloRadius = severity.size + (selected ? 4 : 0) + Math.min(reportCount * 2, 16);
        const halo = L.circleMarker([Number(incident.lat), Number(incident.lng)], {
          radius: haloRadius,
          color: '#FF6B35',
          weight: 1.5,
          dashArray: '4 4',
          fillColor: '#FF6B35',
          fillOpacity: 0.15,
          interactive: false,
        });
        halo.addTo(layerGroup);
      }

      const marker = L.circleMarker([Number(incident.lat), Number(incident.lng)], {
        className: `rq-map-marker severity-${severityKey}${selected ? ' is-selected' : ''}`,
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

      if (selected && linkedReports.length > 0) {
        linkedReports.forEach((rep) => {
          if (isValidCoordinate(rep.lat, rep.lng)) {
            const repLat = Number(rep.lat);
            const repLng = Number(rep.lng);
            const incLat = Number(incident.lat);
            const incLng = Number(incident.lng);
            if (Math.abs(repLat - incLat) > 0.0005 || Math.abs(repLng - incLng) > 0.0005) {
              const line = L.polyline([[incLat, incLng], [repLat, repLng]], {
                color: '#FF6B35',
                weight: 2,
                dashArray: '4 4',
                opacity: 0.7,
              });
              line.addTo(layerGroup);

              const repMarker = L.circleMarker([repLat, repLng], {
                radius: 5,
                color: '#FF6B35',
                weight: 1.5,
                fillColor: '#f8fafc',
                fillOpacity: 0.85,
              });
              repMarker.bindTooltip(
                createTooltip(rep.report_id, [
                  `${rep.type} · ${rep.place}`,
                  `Clustered into ${incident.incident_id}`,
                ]),
                { direction: 'top', className: 'resq-map-tooltip', opacity: 1 }
              );
              repMarker.addTo(layerGroup);
            }
          }
        });
      }
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
    showHotspots,
    riskAssessment,
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
    <div className="rq-map-panel relative flex h-full min-h-[440px] w-full flex-col overflow-hidden rounded-2xl border border-slate-800 bg-slate-950 shadow-xl">
      <div className="pointer-events-none absolute left-3 right-3 top-3 z-[400] flex flex-wrap items-start justify-between gap-2">
        <div className="rq-map-overlay-card pointer-events-auto rounded-xl border border-slate-700/80 bg-slate-900/95 px-3.5 py-2 shadow-md backdrop-blur-md">
          <h2 className="font-bold text-xs uppercase tracking-wider text-white">
            Himachal Pradesh · {places.length} Monitored Sectors
          </h2>
          <p className="text-[11px] text-slate-400">
            Geospatial markers use verified sector coordinates; dashed rings indicate advisory clusters
          </p>
        </div>

        <div className="rq-map-overlay-card pointer-events-auto flex max-w-full flex-wrap items-center gap-2 rounded-xl border border-slate-700/80 bg-slate-900/95 p-2 shadow-md backdrop-blur-md">
          <label className="text-[11px] font-medium text-slate-300 flex items-center">
            Severity
            <select
              value={severityFilter}
              onChange={(event) => onSeverityFilterChange(event.target.value)}
              className="ml-1.5 rounded-md bg-slate-950 border border-slate-700 px-2 py-1 text-xs text-white focus:outline-none focus:border-orange-500"
            >
              {['ALL', 'Critical', 'High', 'Medium', 'Low'].map((value) => (
                <option key={value} value={value}>{value === 'ALL' ? 'All' : value}</option>
              ))}
            </select>
          </label>
          <label className="text-[11px] font-medium text-slate-300 flex items-center">
            Type
            <select
              value={typeFilter}
              onChange={(event) => onTypeFilterChange(event.target.value)}
              className="ml-1.5 max-w-28 rounded-md bg-slate-950 border border-slate-700 px-2 py-1 text-xs text-white focus:outline-none focus:border-orange-500"
            >
              <option value="ALL">All</option>
              {incidentTypes.map((type) => <option key={type}>{type}</option>)}
            </select>
          </label>
          <label className="text-[11px] font-medium text-slate-300 flex items-center">
            Verification
            <select
              value={verificationFilter}
              onChange={(event) => onVerificationFilterChange(event.target.value)}
              className="ml-1.5 rounded-md bg-slate-950 border border-slate-700 px-2 py-1 text-xs text-white focus:outline-none focus:border-orange-500"
            >
              {['ALL', 'Confirmed', 'Corroborated', 'Unverified', 'Rejected'].map((value) => (
                <option key={value}>{value}</option>
              ))}
            </select>
          </label>
          <button
            type="button"
            onClick={() => setShowHotspots((prev) => !prev)}
            className={`rounded-md border px-2.5 py-1 text-xs font-semibold transition ${
              showHotspots
                ? 'border-orange-500/50 bg-orange-500/15 text-orange-400 shadow-sm'
                : 'border-slate-700 bg-slate-800 text-slate-400 hover:text-slate-200'
            }`}
            title="Toggle computed geographic risk hotspots and cluster indicators"
          >
            Hotspots: {showHotspots ? 'ON' : 'OFF'}
          </button>
          <button
            type="button"
            onClick={handleResetView}
            className="rounded-md border border-slate-700 bg-slate-800 hover:bg-slate-700 px-2.5 py-1 text-xs text-slate-200 font-medium transition"
          >
            Reset
          </button>
        </div>
      </div>

      <div ref={mapContainerRef} className="z-10 min-h-[440px] w-full flex-1" />

      <div className="rq-map-legend relative z-[400] flex flex-wrap items-center justify-between gap-3 border-t border-slate-800 bg-slate-950/95 px-4 py-2.5 text-xs">
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-slate-300">
          {Object.entries(SEVERITY_STYLES).map(([name, style]) => (
            <span key={name} className="flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: style.color }} />
              {name}
            </span>
          ))}
          <span className="text-emerald-400 font-medium">Green: confirmed</span>
          <span className="text-sky-400 font-medium">Blue: corroborated</span>
          <span className="text-slate-400">Dotted: unverified</span>
          <span className="text-orange-400 font-medium">Orange halo: clustered hotspot</span>
        </div>
        <span className="max-w-full truncate font-mono text-slate-400 text-[11px]">
          {hoveredItem
            ? `${hoveredItem.label} · ${hoveredItem.lat.toFixed(4)}, ${hoveredItem.lng.toFixed(4)}${hoveredItem.detail ? ` · ${hoveredItem.detail}` : ''}`
            : incidents.length === 0
              ? 'No live incident records loaded · Sign in as operator to view active incident markers'
              : 'Select an incident marker to open its evidence and response details'}
        </span>
      </div>
    </div>
  );
}
