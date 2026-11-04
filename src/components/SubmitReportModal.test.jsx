import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import SubmitReportModal from './SubmitReportModal';

describe('SubmitReportModal', () => {
  it('validates a blank text report and reports server failures', async () => {
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
      />,
    );

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
      />,
    );

    await user.click(screen.getByRole('button', { name: /Sample: Hindi Voice Note — Mandi/ }));
    await user.click(screen.getByRole('button', { name: 'Submit Report' }));

    expect(submit).not.toHaveBeenCalled();
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'This illustrative sample is not a real report',
    );
  });
});
