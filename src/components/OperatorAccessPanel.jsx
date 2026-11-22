import React, { useState, useEffect } from 'react';
import { ArrowRight, LockKeyhole, ShieldCheck, UserCheck, UserPlus, LogIn, ClipboardPlus } from 'lucide-react';

export default function OperatorAccessPanel({
  operator,
  role,
  citizenUser,
  defaultTab = 'operator',
  defaultCitizenMode = 'login',
  onLogin,
  onLogout,
  onCitizenRegister,
  onCitizenLogin,
  onCitizenLogout,
  onOpenSubmitReport,
}) {
  const [activeTab, setActiveTab] = useState(
    operator ? 'operator' : citizenUser ? 'citizen' : defaultTab
  );
  const [citizenMode, setCitizenMode] = useState(defaultCitizenMode || 'login');

  useEffect(() => {
    if (defaultTab && !operator && !citizenUser) {
      setActiveTab(defaultTab);
    }
  }, [defaultTab, operator, citizenUser]);

  // Operator form states
  const [operatorUsername, setOperatorUsername] = useState('');
  const [operatorPassword, setOperatorPassword] = useState('');

  // Citizen form states
  const [citizenName, setCitizenName] = useState('');
  const [citizenEmail, setCitizenEmail] = useState('');
  const [citizenPassword, setCitizenPassword] = useState('');

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [successMessage, setSuccessMessage] = useState('');

  const handleOperatorSubmit = async (event) => {
    event.preventDefault();
    setIsSubmitting(true);
    setErrorMessage('');
    setSuccessMessage('');

    try {
      const result = await onLogin({
        username: operatorUsername.trim(),
        password: operatorPassword,
      });
      if (!result?.ok) {
        setErrorMessage(result?.error || 'Operator credentials are invalid.');
        return;
      }
      setOperatorPassword('');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCitizenSubmit = async (event) => {
    event.preventDefault();
    setIsSubmitting(true);
    setErrorMessage('');
    setSuccessMessage('');

    try {
      if (citizenMode === 'login') {
        if (!onCitizenLogin) {
          setErrorMessage('Citizen login is not configured.');
          return;
        }
        const result = await onCitizenLogin({
          email: citizenEmail.trim(),
          password: citizenPassword,
        });
        if (!result?.ok) {
          setErrorMessage(result?.error || 'Invalid email or password.');
          return;
        }
        setCitizenPassword('');
      } else {
        if (!onCitizenRegister) {
          setErrorMessage('Citizen registration is not configured.');
          return;
        }
        const result = await onCitizenRegister({
          name: citizenName.trim(),
          email: citizenEmail.trim(),
          password: citizenPassword,
        });
        if (!result?.ok) {
          setErrorMessage(result?.error || 'Citizen registration failed.');
          return;
        }
        setSuccessMessage('Citizen account registered successfully! You are now logged in.');
        setCitizenPassword('');
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <section className="rq-operator-card rounded-2xl border border-slate-800 bg-slate-900/90 shadow-xl p-4 sm:p-5 text-xs backdrop-blur-sm">
      {operator ? (
        <div className="rq-operator-authenticated flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3.5">
            <div className="rq-operator-emblem flex items-center justify-center h-10 w-10 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-400">
              <ShieldCheck size={22} strokeWidth={2} />
            </div>
            <div className="rq-operator-copy">
              <span className="rq-operator-kicker block text-[10px] font-bold uppercase tracking-widest text-emerald-400">
                AUTHORIZED COMMAND SESSION
              </span>
              <div className="rq-operator-title text-sm font-bold text-white">
                Signed in as <strong>{operator}</strong>
              </div>
              <p className="text-slate-400 text-xs">Role: {role || 'operator'} · Tactical control room unlocked with write privileges.</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onLogout}
            className="button-secondary px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 font-semibold text-xs transition-colors"
          >
            Sign out
          </button>
        </div>
      ) : citizenUser ? (
        <div className="rq-operator-authenticated flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3.5">
            <div className="rq-operator-emblem flex items-center justify-center h-10 w-10 rounded-xl bg-sky-500/10 border border-sky-500/30 text-sky-400">
              <UserCheck size={22} strokeWidth={2} />
            </div>
            <div className="rq-operator-copy">
              <span className="rq-operator-kicker block text-[10px] font-bold uppercase tracking-widest text-sky-400">
                Signed-in Citizen
              </span>
              <div className="rq-operator-title text-sm font-bold text-white">
                Signed in as <strong>{citizenUser.name}</strong>
              </div>
              <p className="text-slate-400 text-xs">{citizenUser.email} · Authenticated for field report and voice intake.</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {onOpenSubmitReport && (
              <button
                type="button"
                onClick={onOpenSubmitReport}
                className="button-primary inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-orange-600 hover:bg-orange-500 text-white font-semibold text-xs shadow-sm transition-colors"
              >
                <ClipboardPlus size={14} /> Submit Report
              </button>
            )}
            <button
              type="button"
              onClick={onCitizenLogout}
              className="button-secondary px-3.5 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 font-semibold text-xs transition-colors"
            >
              Sign out
            </button>
          </div>
        </div>
      ) : (
        <div className="rq-auth-container">
          {/* Dual Role Selector Tabs */}
          <div className="flex border-b border-slate-800 mb-4 pb-1 gap-6" role="tablist" aria-label="Authentication role">
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'operator'}
              className={`pb-2 px-1 text-xs font-semibold tracking-wide transition-colors ${
                activeTab === 'operator'
                  ? 'border-b-2 border-orange-500 text-orange-400 font-bold'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
              onClick={() => { setActiveTab('operator'); setErrorMessage(''); setSuccessMessage(''); }}
            >
              Operator access
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'citizen'}
              className={`pb-2 px-1 text-xs font-semibold tracking-wide transition-colors ${
                activeTab === 'citizen'
                  ? 'border-b-2 border-orange-500 text-orange-400 font-bold'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
              onClick={() => { setActiveTab('citizen'); setCitizenMode('login'); setErrorMessage(''); setSuccessMessage(''); }}
            >
              Citizen portal (Sign up / Login)
            </button>
          </div>

          {activeTab === 'operator' ? (
            <form onSubmit={handleOperatorSubmit} className="rq-operator-form space-y-3">
              <div className="rq-operator-intro flex items-start gap-3 mb-2">
                <span className="rq-operator-emblem flex items-center justify-center h-8 w-8 rounded-lg bg-orange-500/10 border border-orange-500/30 text-orange-400 shrink-0" aria-hidden="true">
                  <LockKeyhole size={18} strokeWidth={2} />
                </span>
                <div className="rq-operator-copy">
                  <span className="rq-operator-kicker block text-[10px] font-bold uppercase tracking-widest text-slate-400">
                    AUTHORIZED PERSONNEL
                  </span>
                  <h2 className="text-sm font-bold text-white">Operator sign-in required</h2>
                  <p className="text-xs text-slate-400">
                    Verify field reports, review audio evidence, and dispatch units. Operational data remains protected.
                  </p>
                </div>
              </div>

              <div className="rq-operator-fields grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 items-end">
                <label className="block">
                  <span className="block text-[11px] font-semibold text-slate-300 mb-1">Username</span>
                  <input
                    autoComplete="username"
                    required
                    value={operatorUsername}
                    onChange={(event) => setOperatorUsername(event.target.value)}
                    placeholder="Enter your operator ID"
                    className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-700 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-orange-500"
                  />
                </label>
                <label className="block">
                  <span className="block text-[11px] font-semibold text-slate-300 mb-1">Password</span>
                  <input
                    type="password"
                    autoComplete="current-password"
                    required
                    value={operatorPassword}
                    onChange={(event) => setOperatorPassword(event.target.value)}
                    placeholder="Enter your password"
                    className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-700 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-orange-500"
                  />
                </label>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="rq-operator-submit inline-flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-orange-600 hover:bg-orange-500 text-white font-semibold text-xs transition-colors disabled:opacity-50 h-[34px]"
                >
                  {isSubmitting ? 'Signing in...' : 'Sign in'}
                  {!isSubmitting && <ArrowRight size={14} aria-hidden="true" />}
                </button>
              </div>
            </form>
          ) : (
            <div className="space-y-3">
              <div className="rq-operator-intro flex items-start gap-3 mb-2">
                <span className="rq-operator-emblem flex items-center justify-center h-8 w-8 rounded-lg bg-sky-500/10 border border-sky-500/30 text-sky-400 shrink-0" aria-hidden="true">
                  {citizenMode === 'register' ? <UserPlus size={18} strokeWidth={2} /> : <LogIn size={18} strokeWidth={2} />}
                </span>
                <div className="rq-operator-copy">
                  <span className="rq-operator-kicker block text-[10px] font-bold uppercase tracking-widest text-sky-400">
                    COMMUNITY EMERGENCY PORTAL
                  </span>
                  <h2 className="text-sm font-bold text-white">
                    {citizenMode === 'register' ? 'Register Citizen Account' : 'Citizen Sign In'}
                  </h2>
                  <p className="text-xs text-slate-400">
                    {citizenMode === 'register'
                      ? 'Create an account to submit text and voice emergency reports.'
                      : 'Sign in to access your citizen reporting dashboard.'}
                  </p>
                </div>
              </div>

              {/* Mode switch */}
              <div className="flex gap-2">
                <button
                  type="button"
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                    citizenMode === 'login' ? 'bg-orange-600 text-white shadow-sm' : 'bg-slate-800 text-slate-400 hover:text-white'
                  }`}
                  onClick={() => { setCitizenMode('login'); setErrorMessage(''); }}
                >
                  Sign In (Existing Citizen)
                </button>
                <button
                  type="button"
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                    citizenMode === 'register' ? 'bg-orange-600 text-white shadow-sm' : 'bg-slate-800 text-slate-400 hover:text-white'
                  }`}
                  onClick={() => { setCitizenMode('register'); setErrorMessage(''); }}
                >
                  Sign Up (New Citizen)
                </button>
              </div>

              <form onSubmit={handleCitizenSubmit} className="rq-operator-form">
                <div className="rq-operator-fields grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 items-end">
                  {citizenMode === 'register' && (
                    <label className="block">
                      <span className="block text-[11px] font-semibold text-slate-300 mb-1">Full Name</span>
                      <input
                        required
                        value={citizenName}
                        onChange={(e) => setCitizenName(e.target.value)}
                        placeholder="Your full name"
                        className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-700 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-orange-500"
                      />
                    </label>
                  )}
                  <label className="block">
                    <span className="block text-[11px] font-semibold text-slate-300 mb-1">Email Address</span>
                    <input
                      type="email"
                      autoComplete="email"
                      required
                      value={citizenEmail}
                      onChange={(e) => setCitizenEmail(e.target.value)}
                      placeholder="you@example.com"
                      className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-700 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-orange-500"
                    />
                  </label>
                  <label className="block">
                    <span className="block text-[11px] font-semibold text-slate-300 mb-1">Password</span>
                    <input
                      type="password"
                      autoComplete={citizenMode === 'register' ? 'new-password' : 'current-password'}
                      required
                      value={citizenPassword}
                      onChange={(e) => setCitizenPassword(e.target.value)}
                      placeholder={citizenMode === 'register' ? 'Min 8 characters' : 'Enter your password'}
                      className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-700 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-orange-500"
                    />
                  </label>
                  <button
                    type="submit"
                    disabled={isSubmitting}
                    className="rq-operator-submit inline-flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-orange-600 hover:bg-orange-500 text-white font-semibold text-xs transition-colors disabled:opacity-50 h-[34px]"
                  >
                    {isSubmitting
                      ? citizenMode === 'register' ? 'Creating...' : 'Signing in...'
                      : citizenMode === 'register' ? 'Create Account' : 'Sign in'}
                    {!isSubmitting && <ArrowRight size={14} aria-hidden="true" />}
                  </button>
                </div>
              </form>
            </div>
          )}

          {errorMessage && (
            <div className="mt-3 p-2.5 rounded-lg bg-red-500/10 border border-red-500/30 text-red-300 text-xs" role="alert">
              {errorMessage}
            </div>
          )}

          {successMessage && (
            <div className="mt-3 p-2.5 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 text-xs">
              {successMessage}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
