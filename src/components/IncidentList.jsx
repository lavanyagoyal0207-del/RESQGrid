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
    <div className="rq-incident-queue flex flex-col h-full rounded-2xl border overflow-hidden">
      {/* Header & Search */}
      <div className="p-3.5 border-b border-purple-400/20 bg-[#2D1B4E]/50">
        <div className="flex items-center justify-between gap-2 mb-2.5">
          <div>
            <h2 className="font-display text-sm font-bold uppercase tracking-wider text-white">
              AI-Clustered Incident Queue
            </h2>
            <p className="text-[11px] text-purple-200/75">
              Sorted by latest • Orange dot indicates awaiting human confirmation
            </p>
          </div>
          <span className="rounded-lg bg-[#1a0b2e] border border-purple-300/20 px-2.5 py-1 font-mono text-xs font-semibold text-[#FF6B35]">
            {incidents.length} Shown
          </span>
        </div>

        {/* Search Input + Status Filter Pills */}
        <div className="flex flex-col sm:flex-row gap-2">
          <div className="relative flex-1">
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => onSearchQueryChange(e.target.value)}
              placeholder="Filter by place (Mandi, Kullu...) or type..."
              className="w-full rounded-lg bg-[#120721] border border-purple-300/25 px-3 py-1.5 text-xs text-white placeholder-purple-300/45 focus:outline-none focus:border-[#FF6B35]"
            />
          </div>
          <div className="flex items-center gap-1 rounded-lg bg-[#120721] p-1 border border-purple-300/20 overflow-x-auto">
            {['ALL', 'Awaiting', 'Unverified', 'Corroborated', 'Confirmed'].map((st) => (
              <button
                key={st}
                type="button"
                onClick={() => onStatusFilterChange(st)}
                className={`btn-tactical rounded px-2 py-1 text-[10px] font-semibold whitespace-nowrap transition-all ${
                  statusFilter === st
                    ? 'bg-[#FF6B35] text-white'
                    : 'text-purple-200/75 hover:text-white hover:bg-[#2D1B4E]/60'
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
          <div className="rounded-xl bg-[#2D1B4E]/40 border border-purple-300/15 p-6 text-center">
            <p className="font-display text-sm font-semibold text-white">
              {isDataAvailable ? 'No incidents match current filter' : 'Incident data unavailable'}
            </p>
            <p className="text-xs text-purple-200/70 mt-1">
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
