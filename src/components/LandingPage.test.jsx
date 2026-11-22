import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import LandingPage from './LandingPage';

describe('LandingPage', () => {
  it('presents the emergency value proposition and keeps both actions wired', () => {
    const onReport = vi.fn();
    const onOpenControlRoom = vi.fn();
    const onOpenOperatorLogin = vi.fn();

    render(
      <LandingPage
        apiMode="offline"
        onReport={onReport}
        onOpenControlRoom={onOpenControlRoom}
        onOpenOperatorLogin={onOpenOperatorLogin}
      />,
    );

    expect(
      screen.getByRole('heading', {
        name: /When Disaster Strikes, Every Second Matters\./,
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByText('One platform. Every report. Faster emergency response.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent(
      'API Offline',
    );

    fireEvent.click(screen.getByRole('button', { name: /Report an Emergency/i }));
    fireEvent.click(screen.getByRole('button', { name: /Explore Control Room/i }));
    fireEvent.click(screen.getByRole('button', { name: /Operator Login/i }));

    expect(onReport).toHaveBeenCalledOnce();
    expect(onOpenControlRoom).toHaveBeenCalledOnce();
    expect(onOpenOperatorLogin).toHaveBeenCalledOnce();
  });
});
