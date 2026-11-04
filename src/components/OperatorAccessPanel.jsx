import React, { useState } from 'react';
import { ArrowRight, LockKeyhole, ShieldCheck } from 'lucide-react';

export default function OperatorAccessPanel({
  operator,
  role,
  onLogin,
  onLogout,
}) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  const handleSubmit = async (event) => {
    event.preventDefault();
    setIsSubmitting(true);
    setErrorMessage('');

    try {
      const result = await onLogin({ username: username.trim(), password });
      if (!result.ok) {
        setErrorMessage(result.error || 'Operator sign-in failed.');
        return;
      }

      setPassword('');
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
            <p>Role: {role || 'operator'} · Credentials remain in memory only.</p>
          </div>
          <button type="button" onClick={onLogout} className="button-secondary">
            Sign out
          </button>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="rq-operator-form">
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
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                placeholder="Enter your operator ID"
              />
            </label>
            <label>
              <span>Password</span>
              <input
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(event) => setPassword(event.target.value)}
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
          {errorMessage && (
            <p role="alert" className="rq-operator-error">{errorMessage}</p>
          )}
        </form>
      )}
    </section>
  );
}
