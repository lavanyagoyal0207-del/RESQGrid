import React from 'react';
import {
  Activity,
  Bell,
  ClipboardPlus,
  Home,
  LogOut,
  Map,
  Radio,
  ShieldAlert,
  ShieldCheck,
  UsersRound,
} from 'lucide-react';

const CONNECTION = {
  'flask-api': { label: 'Live operational data', dot: 'bg-emerald-400', tone: 'text-emerald-300 border-emerald-500/30 bg-emerald-500/10' },
  'live-operational': { label: 'Live operational data', dot: 'bg-emerald-400', tone: 'text-emerald-300 border-emerald-500/30 bg-emerald-500/10' },
  'online-anonymous': { label: 'API Online · Sign in for operational data', dot: 'bg-sky-400', tone: 'text-sky-300 border-sky-500/30 bg-sky-500/10' },
  'snapshot-retained': { label: 'Last successful snapshot', dot: 'bg-amber-400', tone: 'text-amber-300 border-amber-500/30 bg-amber-500/10' },
  offline: { label: 'API Offline', dot: 'bg-amber-400', tone: 'text-amber-300 border-amber-500/30 bg-amber-500/10' },
  connecting: { label: 'Connecting', dot: 'bg-sky-300', tone: 'text-sky-300 border-sky-500/30 bg-sky-500/10' },
};

const NAV_ITEMS = [
  { id: 'control-room', label: 'Overview', icon: Home },
  { id: 'evidence', label: 'Evidence', icon: ShieldCheck },
  { id: 'operations', label: 'Operations', icon: UsersRound },
  { id: 'phase4', label: 'Intelligence', icon: Activity },
  { id: 'submit-page', label: 'Citizen report', icon: ClipboardPlus },
];

export default function TopBar({
  incidentCount,
  reportCount,
  awaitingReviewCount,
  activeView,
  onSelectView,
  onOpenSubmitModal,
  apiMode,
  lastSyncAt,
  apiError,
  onSyncApi,
  isSyncing,
  operator,
  role,
  onLogout,
  citizenUser,
  onCitizenLogout,
}) {
  const connection = apiMode === 'snapshot-retained' || (apiMode === 'offline' && lastSyncAt)
    ? CONNECTION['snapshot-retained']
    : CONNECTION[apiMode] || CONNECTION.connecting;
  const activeNav = activeView === 'submit-page' ? 'submit-page' : activeView;

  return (
    <header className="rq-header sticky top-0 z-40 border-b border-slate-800/90 bg-slate-950/90 backdrop-blur-md">
      <div className="rq-header-main flex flex-wrap items-center justify-between gap-3 px-4 py-2.5 max-w-7xl mx-auto w-full">
        <button
          type="button"
          className="rq-brand flex items-center gap-2.5 bg-transparent border-0 p-0 text-left cursor-pointer group"
          onClick={() => onSelectView('home')}
          aria-label="ResQGrid home"
        >
          <span className="rq-brand-mark flex items-center justify-center h-8 w-8 rounded-lg bg-orange-600/15 border border-orange-500/30 text-orange-500 shadow-sm transition-colors group-hover:bg-orange-600/25">
            <ShieldAlert size={18} strokeWidth={2.2} />
          </span>
          <span className="rq-brand-copy flex flex-col">
            <span className="rq-brand-name font-bold text-sm tracking-tight text-white">
              ResQ<span className="text-orange-500">Grid</span>
            </span>
            <span className="rq-brand-tagline text-[9px] font-semibold tracking-wider uppercase text-slate-400">
              Disaster Intelligence
            </span>
          </span>
        </button>

        {/* Primary Navigation - scrollable on mobile to prevent clipping */}
        <nav
          className="rq-primary-nav flex items-center gap-1 overflow-x-auto py-1 scrollbar-none max-w-full"
          aria-label="Main navigation"
        >
          {NAV_ITEMS.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              type="button"
              onClick={() => onSelectView(id)}
              className={`rq-nav-link flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-colors cursor-pointer border ${
                activeNav === id
                  ? 'is-active bg-slate-800 text-white border-slate-700 shadow-sm'
                  : 'bg-transparent text-slate-400 border-transparent hover:text-slate-200 hover:bg-slate-900/60'
              }`}
              aria-current={activeNav === id ? 'page' : undefined}
            >
              <Icon size={14} strokeWidth={activeNav === id ? 2.2 : 1.8} />
              <span>{label}</span>
              {id === 'evidence' && awaitingReviewCount > 0 && (
                <span
                  className="rq-nav-count ml-1 px-1.5 py-0.2 rounded-full bg-orange-500/20 text-orange-400 text-[10px] font-bold"
                  aria-label={`${awaitingReviewCount} reports awaiting review`}
                >
                  {awaitingReviewCount}
                </span>
              )}
            </button>
          ))}
        </nav>

        {/* Action Controls & Authentication Status */}
        <div className="rq-header-actions flex items-center gap-2.5">
          <span
            className={`rq-connection inline-flex items-center gap-2 px-2.5 py-1 rounded-full text-[11px] font-medium border ${connection.tone} is-${apiMode}`}
            role="status"
            aria-label={`System status: ${connection.label}`}
            title={apiError || (lastSyncAt ? `Last successful sync: ${new Date(lastSyncAt).toLocaleString()}` : '')}
          >
            <span className={`h-1.5 w-1.5 rounded-full ${connection.dot} ${apiMode === 'flask-api' ? 'animate-pulse' : ''}`} />
            <span className="hidden sm:inline">{connection.label}</span>
          </span>

          <button
            type="button"
            className="rq-icon-button relative p-1.5 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-slate-900 border border-slate-800 transition-colors"
            onClick={() => onSelectView('evidence')}
            aria-label={`Open review queue${awaitingReviewCount ? `, ${awaitingReviewCount} awaiting review` : ''}`}
            title="Review queue"
          >
            <Bell size={15} />
            {awaitingReviewCount > 0 && (
              <span className="rq-notification-dot absolute top-1 right-1 h-2 w-2 rounded-full bg-orange-500 animate-pulse" />
            )}
          </button>

          <button
            type="button"
            className="rq-icon-button rq-refresh-button p-1.5 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-slate-900 border border-slate-800 transition-colors"
            onClick={onSyncApi}
            disabled={isSyncing}
            aria-label={isSyncing ? 'Refreshing dashboard data' : 'Refresh dashboard data'}
            title={apiError || 'Refresh dashboard data'}
          >
            <Radio className={isSyncing ? 'animate-spin text-orange-500' : ''} size={15} />
          </button>

          {operator ? (
            <div
              className="rq-profile flex items-center gap-2 px-2 py-1 rounded-lg bg-slate-900 border border-slate-800 text-xs"
              title={`Signed in as ${operator} · ${role || 'operator'}`}
            >
              <span className="rq-profile-avatar flex items-center justify-center h-6 w-6 rounded bg-orange-600 text-white font-bold text-xs">
                {operator.slice(0, 1).toUpperCase()}
              </span>
              <span className="rq-profile-copy hidden md:flex flex-col text-left">
                <strong className="text-white text-[11px] leading-none">{operator}</strong>
                <small className="text-slate-400 text-[9px] uppercase tracking-wide">{role || 'operator'}</small>
              </span>
              <button
                type="button"
                className="rq-logout-button p-1 rounded text-slate-400 hover:text-red-400 hover:bg-red-500/10 transition-colors"
                onClick={onLogout}
                aria-label="Sign out"
              >
                <LogOut size={13} />
              </button>
            </div>
          ) : citizenUser ? (
            <div
              className="rq-profile flex items-center gap-2 px-2 py-1 rounded-lg bg-slate-900 border border-slate-800 text-xs"
              title={`Signed in as ${citizenUser.name} · Citizen`}
            >
              <span className="rq-profile-avatar flex items-center justify-center h-6 w-6 rounded bg-sky-600 text-white font-bold text-xs">
                {citizenUser.name.slice(0, 1).toUpperCase()}
              </span>
              <span className="rq-profile-copy hidden md:flex flex-col text-left">
                <strong className="text-white text-[11px] leading-none">{citizenUser.name}</strong>
                <small className="text-sky-400 text-[9px] uppercase tracking-wide">Citizen</small>
              </span>
              <button
                type="button"
                className="rq-logout-button p-1 rounded text-slate-400 hover:text-red-400 hover:bg-red-500/10 transition-colors"
                onClick={onCitizenLogout}
                aria-label="Sign out"
              >
                <LogOut size={13} />
              </button>
            </div>
          ) : (
            <button
              type="button"
              className="rq-operator-link px-3 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-800 text-xs font-semibold text-slate-200 transition-colors inline-flex items-center gap-1"
              onClick={() => onSelectView('control-room')}
              aria-label="Open sign-in or register"
            >
              Sign In / Register <span aria-hidden="true">↗</span>
            </button>
          )}
        </div>
      </div>

      {/* Subrow with metrics summary & Emergency CTA */}
      <div className="rq-header-subrow border-t border-slate-800/60 bg-slate-950/60 px-4 py-1.5 max-w-7xl mx-auto w-full flex items-center justify-between text-xs text-slate-400">
        <div className="rq-live-counts flex items-center gap-4 text-[11px] font-medium" aria-label="Current dashboard totals">
          <span className="flex items-center gap-1.5 text-slate-300">
            <Map size={13} className="text-orange-500" /> {incidentCount ?? '—'} incidents
          </span>
          <span className="flex items-center gap-1.5 text-slate-300">
            <ClipboardPlus size={13} className="text-sky-400" /> {reportCount ?? '—'} reports
          </span>
        </div>
        <button
          type="button"
          className="rq-report-cta inline-flex items-center gap-1.5 px-3 py-1 rounded-md bg-orange-600 hover:bg-orange-500 text-white font-semibold text-xs shadow-sm transition-colors"
          onClick={onOpenSubmitModal}
        >
          <ClipboardPlus size={13} /> Report an emergency
        </button>
      </div>
    </header>
  );
}
