import React from 'react';
import IncidentCard from './IncidentCard';

export default function IncidentList({
  incidents,
  selectedIncidentId,
  onSelectIncident,
  statusFilter,
  onStatusFilterChange,
  searchQuery,
  onSearchQueryChange,
  isDataAvailable = true,
}) {
  return (
    <div className="rq-incident-queue flex flex-col h-full rounded-2xl border border-slate-800 bg-slate-950 overflow-hidden shadow-lg">
      {/* Header & Search */}
      <div className="p-3.5 border-b border-slate-800 bg-slate-900/90 backdrop-blur-sm">
        <div className="flex items-center justify-between gap-2 mb-2.5">
          <div>
            <h2 className="text-xs font-bold uppercase tracking-wider text-white">
              Clustered Incident Queue
            </h2>
            <p className="text-[11px] text-slate-400">
              Aggregated field reports · Awaiting operator confirmation
            </p>
          </div>
          <span className="rounded-lg bg-slate-950 border border-slate-700 px-2.5 py-1 font-mono text-xs font-semibold text-orange-400">
            {incidents.length} Active
          </span>
        </div>

        {/* Search Input + Status Filter Pills */}
        <div className="flex flex-col sm:flex-row gap-2">
          <div className="relative flex-1">
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => onSearchQueryChange(e.target.value)}
              placeholder="Filter by place, sector (Mandi, Kullu...) or type..."
              className="w-full rounded-lg bg-slate-950 border border-slate-700 px-3 py-1.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-orange-500 transition-colors"
            />
          </div>
          <div className="flex items-center gap-1 rounded-lg bg-slate-950 p-1 border border-slate-800 overflow-x-auto scrollbar-none">
            {['ALL', 'Awaiting', 'Unverified', 'Corroborated', 'Confirmed'].map((st) => (
              <button
                key={st}
                type="button"
                onClick={() => onStatusFilterChange(st)}
                className={`rounded px-2.5 py-1 text-[10px] font-semibold whitespace-nowrap transition-colors cursor-pointer ${
                  statusFilter === st
                    ? 'bg-orange-600 text-white shadow-sm'
                    : 'text-slate-400 hover:text-white hover:bg-slate-800'
                }`}
              >
                {st}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Scrollable Cards List */}
      <div className="flex-1 overflow-y-auto p-3 space-y-2.5 max-h-[520px] lg:max-h-none">
        {incidents.length === 0 ? (
          <div className="rounded-xl bg-slate-900/60 border border-slate-800 p-6 text-center">
            <p className="text-sm font-semibold text-white">
              {isDataAvailable ? 'No incidents match current filter' : 'Incident data unavailable'}
            </p>
            <p className="text-xs text-slate-400 mt-1">
              {isDataAvailable
                ? 'Reset status or severity filters to inspect all Himachal Pradesh sectors.'
                : 'No live incident records were loaded. Check the API connection and operator access, then refresh.'}
            </p>
          </div>
        ) : (
          incidents.map((inc) => (
            <IncidentCard
              key={inc.incident_id}
              incident={inc}
              isSelected={inc.incident_id === selectedIncidentId}
              onClick={() => onSelectIncident(inc.incident_id)}
            />
          ))
        )}
      </div>
    </div>
  );
}
