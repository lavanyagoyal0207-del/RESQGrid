import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import SubmitReportModal from './SubmitReportModal';

describe('SubmitReportModal', () => {
  const mockCitizen = {
    name: 'Jane Citizen',
    email: 'jane@example.com',
    role: 'citizen',
  };

  it('prompts citizen to sign in when not authenticated and prevents report submission', async () => {
    const user = userEvent.setup();
    const submit = vi.fn();
    render(
      <SubmitReportModal
        isOpen
        onClose={vi.fn()}
        places={[{ place: 'Mandi', district: 'Mandi' }]}
        onSubmitReport={submit}
        citizenUser={null}
      />,
    );

    expect(screen.getByText(/Citizen Sign-in Required/)).toBeInTheDocument();

    const description = screen.getByLabelText(/Field Observation/);
    await user.type(description, 'Flood water is rising.');
    await user.click(screen.getByRole('button', { name: 'Submit Report' }));

    expect(submit).not.toHaveBeenCalled();
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Citizen sign-in is required to submit an emergency report.',
    );
  });

  it('validates a blank text report and reports server failures for authenticated citizen', async () => {
    const user = userEvent.setup();
    const submit = vi.fn().mockResolvedValue({
      ok: false,
      error: 'Backend unavailable.',
    });
    render(
      <SubmitReportModal
        isOpen
        onClose={vi.fn()}
        places={[{ place: 'Mandi', district: 'Mandi' }]}
        onSubmitReport={submit}
        citizenUser={mockCitizen}
      />,
    );

    expect(screen.getByText(/Reporting as/)).toBeInTheDocument();
    expect(screen.getByText(/Jane Citizen/)).toBeInTheDocument();

    const description = screen.getByLabelText(/Field Observation/);
    expect(description).toBeRequired();
    await user.type(
      description,
      'Water is rising near the bridge.',
    );
    await user.click(screen.getByRole('button', { name: 'Submit Report' }));
    await waitFor(() => expect(submit).toHaveBeenCalledOnce());
    expect(await screen.findByRole('alert')).toHaveTextContent('Backend unavailable.');
  });

  it('validates an incorrect audio media type and identifies samples as demos', async () => {
    render(
      <SubmitReportModal
        isOpen
        onClose={vi.fn()}
        places={[{ place: 'Mandi', district: 'Mandi' }]}
        onSubmitReport={vi.fn()}
        onSubmitVoiceReport={vi.fn()}
        citizenUser={mockCitizen}
      />,
    );

    const file = new File(['not audio'], 'note.txt', { type: 'text/plain' });
    fireEvent.change(screen.getByLabelText('Upload audio recording'), {
      target: { files: [file] },
    });
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Please select a valid audio file.',
    );
    expect(screen.getAllByRole('button', { name: /Sample:/ })).toHaveLength(3);
  });

  it('keeps illustrative report samples out of citizen intake', async () => {
    const user = userEvent.setup();
    const submit = vi.fn().mockResolvedValue({ ok: true });
    render(
      <SubmitReportModal
        isOpen
        onClose={vi.fn()}
        places={[{ place: 'Mandi', district: 'Mandi' }]}
        onSubmitReport={submit}
        citizenUser={mockCitizen}
      />,
    );

    await user.click(screen.getByRole('button', { name: /Sample: Hindi Voice Note — Mandi/ }));
    await user.click(screen.getByRole('button', { name: 'Submit Report' }));

    expect(submit).not.toHaveBeenCalled();
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'This illustrative sample is not a real report',
    );
  });

  it('displays submission-success message and reference ID upon successful citizen report', async () => {
    const user = userEvent.setup();
    const submit = vi.fn().mockResolvedValue({
      ok: true,
      data: {
        report: {
          report_id: 'REP-CITIZEN-12345',
          place: 'Mandi',
          type: 'Flood',
          severity: 'High',
        },
      },
    });
    render(
      <SubmitReportModal
        isOpen
        onClose={vi.fn()}
        places={[{ place: 'Mandi', district: 'Mandi' }]}
        onSubmitReport={submit}
        citizenUser={mockCitizen}
      />,
    );

    const description = screen.getByLabelText(/Field Observation/);
    await user.type(description, 'Bridge road is flooded near Mandi.');
    await user.click(screen.getByRole('button', { name: 'Submit Report' }));

    await waitFor(() => expect(submit).toHaveBeenCalledOnce());
    expect(await screen.findByRole('status')).toHaveTextContent(
      'Emergency Report Submitted Successfully',
    );
    expect(screen.getByText('REP-CITIZEN-12345')).toBeInTheDocument();
  });
});
