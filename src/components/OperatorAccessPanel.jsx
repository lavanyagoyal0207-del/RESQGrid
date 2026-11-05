import React, { useState } from 'react';
import { ArrowRight, LockKeyhole, ShieldCheck, UserCheck, UserPlus, LogIn, ClipboardPlus } from 'lucide-react';

export default function OperatorAccessPanel({
  operator,
  role,
  citizenUser,
  defaultTab = 'operator',
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
  const [citizenMode, setCitizenMode] = useState('register');

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
      if (citizenMode === 'register') {
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
      } else {
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
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <section className="rq-operator-card rounded-xl border p-3 text-xs">
      {operator ? (
        <div className="rq-operator-authenticated">
          <div className="rq-operator-emblem is-authorized">
            <ShieldCheck size={23} strokeWidth={1.7} />
          </div>
          <div className="rq-operator-copy">
            <span className="rq-operator-kicker">CONTROL ROOM ACCESS</span>
            <div className="rq-operator-title">
              Signed in as <strong>{operator}</strong>
            </div>
            <p>Role: {role || 'operator'} · Tactical control room unlocked.</p>
          </div>
          <button type="button" onClick={onLogout} className="button-secondary">
            Sign out
          </button>
        </div>
      ) : citizenUser ? (
        <div className="rq-operator-authenticated">
          <div className="rq-operator-emblem is-authorized" style={{ color: '#38bdf8' }}>
            <UserCheck size={23} strokeWidth={1.7} />
          </div>
          <div className="rq-operator-copy">
            <span className="rq-operator-kicker" style={{ color: '#38bdf8' }}>CITIZEN ACCOUNT ACTIVE</span>
            <div className="rq-operator-title">
              Signed in as <strong>{citizenUser.name}</strong>
            </div>
            <p>{citizenUser.email} · Signed-in Citizen</p>
          </div>
          <div className="flex items-center gap-2">
            {onOpenSubmitReport && (
              <button
                type="button"
                onClick={onOpenSubmitReport}
                className="button-primary"
                style={{ padding: '0.4rem 0.8rem', fontSize: '0.75rem' }}
              >
                <ClipboardPlus size={14} /> Submit Report
              </button>
            )}
            <button type="button" onClick={onCitizenLogout} className="button-secondary">
              Sign out
            </button>
          </div>
        </div>
      ) : (
        <div className="rq-auth-container">
          {/* Dual Role Selector */}
          <div className="flex border-b border-white/10 mb-3 pb-1 gap-4" role="tablist" aria-label="Authentication role">
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'operator'}
              className={`pb-1 px-1 font-medium transition-colors ${
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
              className={`pb-1 px-1 font-medium transition-colors ${
                activeTab === 'citizen'
                  ? 'border-b-2 border-orange-500 text-orange-400 font-bold'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
              onClick={() => { setActiveTab('citizen'); setErrorMessage(''); setSuccessMessage(''); }}
            >
              Citizen portal (Sign up / Login)
            </button>
          </div>

          {activeTab === 'operator' ? (
            <form onSubmit={handleOperatorSubmit} className="rq-operator-form">
              <div className="rq-operator-intro">
                <span className="rq-operator-emblem" aria-hidden="true">
                  <LockKeyhole size={22} strokeWidth={1.7} />
                </span>
                <div className="rq-operator-copy">
                  <span className="rq-operator-kicker">AUTHORIZED PERSONNEL</span>
                  <h2>Operator sign-in required</h2>
                  <p>
                    Verify reports, approve briefs, and access private evidence.
                    Operational data stays protected.
                  </p>
                </div>
              </div>

              <div className="rq-operator-fields">
                <label>
                  <span>Username</span>
                  <input
                    autoComplete="username"
                    required
                    value={operatorUsername}
                    onChange={(event) => setOperatorUsername(event.target.value)}
                    placeholder="Enter your operator ID"
                  />
                </label>
                <label>
                  <span>Password</span>
                  <input
                    type="password"
                    autoComplete="current-password"
                    required
                    value={operatorPassword}
                    onChange={(event) => setOperatorPassword(event.target.value)}
                    placeholder="Enter your password"
                  />
                </label>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="rq-operator-submit"
                >
                  {isSubmitting ? 'Signing in...' : 'Sign in'}
                  {!isSubmitting && <ArrowRight size={16} aria-hidden="true" />}
                </button>
              </div>
            </form>
          ) : (
            <div>
              <div className="rq-operator-intro">
                <span className="rq-operator-emblem" aria-hidden="true" style={{ color: '#38bdf8' }}>
                  {citizenMode === 'register' ? <UserPlus size={22} strokeWidth={1.7} /> : <LogIn size={22} strokeWidth={1.7} />}
                </span>
                <div className="rq-operator-copy">
                  <span className="rq-operator-kicker" style={{ color: '#38bdf8' }}>COMMUNITY EMERGENCY PORTAL</span>
                  <h2>{citizenMode === 'register' ? 'Register Citizen Account' : 'Citizen Sign In'}</h2>
                  <p>
                    {citizenMode === 'register'
                      ? 'Create an account to submit text and voice emergency reports.'
                      : 'Sign in to access your citizen reporting dashboard.'}
                  </p>
                </div>
              </div>

              {/* Mode switch */}
              <div className="flex gap-2 my-2 text-xs">
                <button
                  type="button"
                  className={`px-2.5 py-1 rounded text-xs transition-colors ${
                    citizenMode === 'register' ? 'bg-orange-600 text-white font-medium' : 'bg-white/5 text-slate-300 hover:bg-white/10'
                  }`}
                  onClick={() => { setCitizenMode('register'); setErrorMessage(''); }}
                >
                  Sign Up (New Citizen)
                </button>
                <button
                  type="button"
                  className={`px-2.5 py-1 rounded text-xs transition-colors ${
                    citizenMode === 'login' ? 'bg-orange-600 text-white font-medium' : 'bg-white/5 text-slate-300 hover:bg-white/10'
                  }`}
                  onClick={() => { setCitizenMode('login'); setErrorMessage(''); }}
                >
                  Sign In (Existing Citizen)
                </button>
              </div>

              <form onSubmit={handleCitizenSubmit} className="rq-operator-form">
                <div className="rq-operator-fields">
                  {citizenMode === 'register' && (
                    <label>
                      <span>Full Name</span>
                      <input
                        required
                        value={citizenName}
                        onChange={(e) => setCitizenName(e.target.value)}
                        placeholder="Your full name"
                      />
                    </label>
                  )}
                  <label>
                    <span>Email Address</span>
                    <input
                      type="email"
                      autoComplete="email"
                      required
                      value={citizenEmail}
                      onChange={(e) => setCitizenEmail(e.target.value)}
                      placeholder="you@example.com"
                    />
                  </label>
                  <label>
                    <span>Password</span>
                    <input
                      type="password"
                      autoComplete={citizenMode === 'register' ? 'new-password' : 'current-password'}
                      required
                      value={citizenPassword}
                      onChange={(e) => setCitizenPassword(e.target.value)}
                      placeholder={citizenMode === 'register' ? 'Min 8 characters' : 'Enter your password'}
                    />
                  </label>
                  <button
                    type="submit"
                    disabled={isSubmitting}
                    className="rq-operator-submit"
                  >
                    {isSubmitting
                      ? (citizenMode === 'register' ? 'Registering...' : 'Signing in...')
                      : (citizenMode === 'register' ? 'Create Account' : 'Sign in')}
                    {!isSubmitting && <ArrowRight size={16} aria-hidden="true" />}
                  </button>
                </div>
              </form>
            </div>
          )}

          {errorMessage && (
            <p role="alert" className="rq-operator-error mt-2">{errorMessage}</p>
          )}
          {successMessage && (
            <p role="status" className="text-emerald-400 mt-2 text-xs">{successMessage}</p>
          )}
        </div>
      )}
    </section>
  );
}
