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

  it('supports citizen registration tab and submission', async () => {
    const user = userEvent.setup();
    const onCitizenRegister = vi.fn().mockResolvedValue({
      ok: true,
      data: { user: { name: 'Jane Citizen', email: 'jane@example.com', role: 'citizen' } },
    });

    render(
      <OperatorAccessPanel
        operator={null}
        onLogin={vi.fn()}
        onLogout={vi.fn()}
        onCitizenRegister={onCitizenRegister}
      />,
    );

    // Switch to Citizen tab
    await user.click(screen.getByRole('tab', { name: /Citizen portal/i }));

    // Verify fields
    await user.type(screen.getByPlaceholderText('Your full name'), 'Jane Citizen');
    await user.type(screen.getByPlaceholderText('you@example.com'), 'jane@example.com');
    await user.type(screen.getByPlaceholderText('Min 8 characters'), 'password123');

    await user.click(screen.getByRole('button', { name: 'Create Account' }));

    expect(onCitizenRegister).toHaveBeenCalledWith({
      name: 'Jane Citizen',
      email: 'jane@example.com',
      password: 'password123',
    });
  });

  it('displays citizen profile and logout when citizen is signed in', () => {
    const onCitizenLogout = vi.fn();
    render(
      <OperatorAccessPanel
        operator={null}
        citizenUser={{ name: 'Jane Citizen', email: 'jane@example.com' }}
        onLogin={vi.fn()}
        onLogout={vi.fn()}
        onCitizenLogout={onCitizenLogout}
      />,
    );

    expect(screen.getByText('Jane Citizen')).toBeInTheDocument();
    expect(screen.getByText(/Signed-in Citizen/i)).toBeInTheDocument();

    const logout = screen.getByRole('button', { name: 'Sign out' });
    fireEvent.click(logout);
    expect(onCitizenLogout).toHaveBeenCalledOnce();
  });

  it('renders citizen tab by default when defaultTab is citizen', () => {
    render(
      <OperatorAccessPanel
        operator={null}
        citizenUser={null}
        onLogin={vi.fn()}
        onLogout={vi.fn()}
        defaultTab="citizen"
      />,
    );
    expect(screen.getByRole('tab', { name: /Citizen portal/i })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('button', { name: /Sign Up \(New Citizen\)/i })).toBeInTheDocument();
  });

  it('calls onOpenSubmitReport when Submit Report button is clicked for authenticated citizen', () => {
    const onOpenSubmitReport = vi.fn();
    render(
      <OperatorAccessPanel
        operator={null}
        citizenUser={{ name: 'Jane Citizen', email: 'jane@example.com' }}
        onLogin={vi.fn()}
        onLogout={vi.fn()}
        onOpenSubmitReport={onOpenSubmitReport}
      />,
    );

    const submitBtn = screen.getByRole('button', { name: /Submit Report/i });
    fireEvent.click(submitBtn);
    expect(onOpenSubmitReport).toHaveBeenCalledOnce();
  });
});
