import React, { useState } from 'react';

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
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="text-purple-100">
            Operator authenticated: <strong className="text-emerald-300">{operator}</strong>
            <span className="ml-2 text-purple-200/80">Role: {role || 'operator'}</span>
            <span className="ml-2 text-purple-300/70">Credentials remain in memory only.</span>
          </div>
          <button
            type="button"
            onClick={onLogout}
            className="rounded-lg border border-purple-300/30 px-3 py-1.5 text-purple-100 hover:text-white"
          >
            Sign out
          </button>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="flex flex-wrap items-end gap-2">
          <div className="mr-auto">
            <div className="font-semibold text-white">Operator sign-in required</div>
            <p className="text-[11px] text-purple-200/70">
              Sign in to verify reports, approve briefs, or listen to private audio.
            </p>
          </div>
          <label className="flex flex-col gap-1 text-purple-200">
            Username
            <input
              autoComplete="username"
              required
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              className="rounded-lg bg-[#120721] border border-purple-300/30 px-2.5 py-1.5 text-white"
            />
          </label>
          <label className="flex flex-col gap-1 text-purple-200">
            Password
            <input
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className="rounded-lg bg-[#120721] border border-purple-300/30 px-2.5 py-1.5 text-white"
            />
          </label>
          <button
            type="submit"
            disabled={isSubmitting}
            className="rounded-lg bg-[#FF6B35] px-3 py-1.5 font-semibold text-white disabled:opacity-60"
          >
            {isSubmitting ? 'Signing in...' : 'Sign in'}
          </button>
          {errorMessage && (
            <p role="alert" className="basis-full text-red-300">{errorMessage}</p>
          )}
        </form>
      )}
    </section>
  );
}
