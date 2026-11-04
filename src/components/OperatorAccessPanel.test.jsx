import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import OperatorAccessPanel from './OperatorAccessPanel';

describe('OperatorAccessPanel', () => {
  it('disables login while pending and displays authentication failures', async () => {
    const user = userEvent.setup();
    let finishLogin;
    const onLogin = vi.fn(
      () => new Promise((resolve) => {
        finishLogin = resolve;
      }),
    );
    render(<OperatorAccessPanel operator={null} onLogin={onLogin} onLogout={vi.fn()} />);

    await user.type(screen.getByLabelText('Username'), 'operator-a');
    await user.type(screen.getByLabelText('Password'), 'invalid');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(await screen.findByRole('button', { name: 'Signing in...' })).toBeDisabled();
    finishLogin({ ok: false, error: 'Operator credentials are invalid.' });
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Operator credentials are invalid.',
    );
  });

  it('exposes logout as a keyboard-operable button after sign-in', () => {
    const onLogout = vi.fn();
    render(
      <OperatorAccessPanel
        operator="operator-a"
        onLogin={vi.fn()}
        onLogout={onLogout}
      />,
    );

    const logout = screen.getByRole('button', { name: 'Sign out' });
    logout.focus();
    expect(logout).toHaveFocus();
    fireEvent.click(logout);
    expect(onLogout).toHaveBeenCalledOnce();
  });
});
