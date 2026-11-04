import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import LandingPage from './LandingPage';

describe('LandingPage', () => {
  it('presents the emergency value proposition and keeps both actions wired', () => {
    const onReport = vi.fn();
    const onOpenControlRoom = vi.fn();

    render(
      <LandingPage
        apiMode="offline"
        onReport={onReport}
        onOpenControlRoom={onOpenControlRoom}
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
      'API unavailable · no live data',
    );

    fireEvent.click(screen.getByRole('button', { name: /Report an Emergency/ }));
    fireEvent.click(screen.getByRole('button', { name: /Explore Control Room/ }));

    expect(onReport).toHaveBeenCalledOnce();
    expect(onOpenControlRoom).toHaveBeenCalledOnce();
  });
});
