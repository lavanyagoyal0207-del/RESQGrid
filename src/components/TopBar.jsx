import React from 'react';
import {
  Activity,
  Bell,
  ClipboardPlus,
  Home,
  LogOut,
  Map,
  Moon,
  Radio,
  ShieldCheck,
  UsersRound,
} from 'lucide-react';

const CONNECTION = {
  'flask-api': { label: 'Live connection', dot: 'bg-emerald-400', tone: 'text-emerald-200' },
  offline: { label: 'API unavailable', dot: 'bg-amber-400', tone: 'text-amber-200' },
  connecting: { label: 'Connecting', dot: 'bg-sky-300', tone: 'text-sky-200' },
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
}) {
  const connection = apiMode === 'offline' && lastSyncAt
    ? { ...CONNECTION.offline, label: 'Offline · last snapshot' }
    : CONNECTION[apiMode] || CONNECTION.connecting;
  const activeNav = activeView === 'submit-page' ? 'submit-page' : activeView;

  return (
    <header className="rq-header">
      <div className="rq-header-main">
        <button
          type="button"
          className="rq-brand"
          onClick={() => onSelectView('home')}
          aria-label="ResQGrid home"
        >
          <span className="rq-brand-mark"><Moon size={19} strokeWidth={1.7} /></span>
          <span className="rq-brand-copy">
            <span className="rq-brand-name">ResQ<span>Grid</span></span>
            <span className="rq-brand-tagline">Halloween Night Watch</span>
          </span>
        </button>

        <nav className="rq-primary-nav" aria-label="Main navigation">
          {NAV_ITEMS.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              type="button"
              onClick={() => onSelectView(id)}
              className={`rq-nav-link ${activeNav === id ? 'is-active' : ''}`}
              aria-current={activeNav === id ? 'page' : undefined}
            >
              <Icon size={15} strokeWidth={1.8} />
              <span>{label}</span>
              {id === 'evidence' && awaitingReviewCount > 0 && (
                <span className="rq-nav-count" aria-label={`${awaitingReviewCount} reports awaiting review`}>
                  {awaitingReviewCount}
                </span>
              )}
            </button>
          ))}
        </nav>

        <div className="rq-header-actions">
          <span
            className={`rq-connection ${connection.tone} is-${apiMode}`}
            role="status"
            aria-label={`System status: ${connection.label}`}
            title={apiError || (lastSyncAt ? `Last successful sync: ${new Date(lastSyncAt).toLocaleString()}` : '')}
          >
            <span className={`h-2 w-2 rounded-full ${connection.dot} ${apiMode === 'flask-api' ? 'animate-pulse' : ''}`} />
            <span>{connection.label}</span>
          </span>
          <button
            type="button"
            className="rq-icon-button"
            onClick={() => onSelectView('evidence')}
            aria-label={`Open review queue${awaitingReviewCount ? `, ${awaitingReviewCount} awaiting review` : ''}`}
            title="Review queue"
          >
            <Bell size={17} />
            {awaitingReviewCount > 0 && <span className="rq-notification-dot" />}
          </button>
          <button
            type="button"
            className="rq-icon-button rq-refresh-button"
            onClick={onSyncApi}
            disabled={isSyncing}
            aria-label={isSyncing ? 'Refreshing dashboard data' : 'Refresh dashboard data'}
            title={apiError || 'Refresh dashboard data'}
          >
            <Radio className={isSyncing ? 'animate-spin' : ''} size={17} />
          </button>
          {operator ? (
            <div className="rq-profile" title={`Signed in as ${operator} · ${role || 'operator'}`}>
              <span className="rq-profile-avatar">{operator.slice(0, 1).toUpperCase()}</span>
              <span className="rq-profile-copy"><strong>{operator}</strong><small>{role || 'operator'}</small></span>
              <button type="button" className="rq-logout-button" onClick={onLogout} aria-label="Sign out">
                <LogOut size={15} />
              </button>
            </div>
          ) : (
            <button
              type="button"
              className="rq-operator-link"
              onClick={() => onSelectView('control-room')}
              aria-label="Open operator sign-in"
            >
              Operator access <span aria-hidden="true">↗</span>
            </button>
          )}
        </div>
      </div>

      <div className="rq-header-subrow">
        <div className="rq-live-counts" aria-label="Current dashboard totals">
          <span><Map size={13} /> {incidentCount ?? '—'} incidents</span>
          <span><ClipboardPlus size={13} /> {reportCount ?? '—'} reports</span>
        </div>
        <button type="button" className="rq-report-cta" onClick={onOpenSubmitModal}>
          <ClipboardPlus size={15} /> Report an emergency
        </button>
      </div>
    </header>
  );
}
