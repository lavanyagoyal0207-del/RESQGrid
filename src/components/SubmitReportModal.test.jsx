import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
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

  describe('Direct Microphone Recording', () => {
    let originalMediaDevices;
    let originalMediaRecorder;
    let originalCreateObjectURL;
    let originalRevokeObjectURL;
    let mockTrackStop;

    class MockMediaRecorder {
      constructor(stream, options = {}) {
        this.stream = stream;
        this.options = options;
        this.state = 'inactive';
        this.mimeType = options.mimeType || 'audio/webm';
        this.ondataavailable = null;
        this.onstop = null;
      }
      start() {
        this.state = 'recording';
      }
      pause() {
        this.state = 'paused';
      }
      resume() {
        this.state = 'recording';
      }
      stop() {
        this.state = 'inactive';
        if (this.ondataavailable) {
          this.ondataavailable({ data: new Blob(['recorded voice data'], { type: 'audio/webm' }) });
        }
        if (this.onstop) {
          this.onstop();
        }
      }
      static isTypeSupported() {
        return true;
      }
    }

    beforeEach(() => {
      originalMediaDevices = navigator.mediaDevices;
      originalMediaRecorder = window.MediaRecorder;
      originalCreateObjectURL = window.URL.createObjectURL;
      originalRevokeObjectURL = window.URL.revokeObjectURL;

      mockTrackStop = vi.fn();
      const mockStream = {
        getTracks: () => [{ stop: mockTrackStop }],
      };

      Object.defineProperty(navigator, 'mediaDevices', {
        value: {
          getUserMedia: vi.fn().mockResolvedValue(mockStream),
        },
        writable: true,
        configurable: true,
      });

      window.MediaRecorder = MockMediaRecorder;
      window.URL.createObjectURL = vi.fn().mockReturnValue('blob:http://localhost/test-audio');
      window.URL.revokeObjectURL = vi.fn();
    });

    afterEach(() => {
      Object.defineProperty(navigator, 'mediaDevices', {
        value: originalMediaDevices,
        writable: true,
        configurable: true,
      });
      window.MediaRecorder = originalMediaRecorder;
      window.URL.createObjectURL = originalCreateObjectURL;
      window.URL.revokeObjectURL = originalRevokeObjectURL;
    });

    it('records audio directly from microphone without opening file chooser', async () => {
      const user = userEvent.setup();
      render(
        <SubmitReportModal
          isOpen
          onClose={vi.fn()}
          places={[{ place: 'Mandi', district: 'Mandi' }]}
          citizenUser={mockCitizen}
        />,
      );

      // Verify file input is NOT clicked/triggered by Start Recording
      const fileInput = screen.getByLabelText('Upload audio recording');
      const fileClickSpy = vi.spyOn(fileInput, 'click');

      const startBtn = screen.getByRole('button', { name: /Start Recording/i });
      await user.click(startBtn);

      expect(fileClickSpy).not.toHaveBeenCalled();
      expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledWith({ audio: true });

      // Verify recording UI appears: Stop Recording & Pause
      expect(screen.getByRole('button', { name: /Stop Recording/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Pause/i })).toBeInTheDocument();

      // Pause and resume
      await user.click(screen.getByRole('button', { name: /Pause/i }));
      expect(screen.getByText(/PAUSED/)).toBeInTheDocument();
      await user.click(screen.getByRole('button', { name: /Resume/i }));
      expect(screen.getByText(/REC/)).toBeInTheDocument();

      // Stop recording
      await user.click(screen.getByRole('button', { name: /Stop Recording/i }));

      // Preview audio player and discard button are now rendered
      expect(screen.getByLabelText('Recorded voice note preview')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Discard & Re-record/i })).toBeInTheDocument();
      expect(screen.getByText(/Recorded Audio Ready/i)).toBeInTheDocument();
    });

    it('submits recorded audio blob to onSubmitVoiceReport', async () => {
      const user = userEvent.setup();
      const submitVoice = vi.fn().mockResolvedValue({
        ok: true,
        data: {
          report: {
            report_id: 'REP-VOICE-12345',
            place: 'Mandi',
            type: 'Flood',
            severity: 'High',
            transcription_status: 'Completed',
          },
        },
      });

      render(
        <SubmitReportModal
          isOpen
          onClose={vi.fn()}
          places={[{ place: 'Mandi', district: 'Mandi' }]}
          onSubmitVoiceReport={submitVoice}
          citizenUser={mockCitizen}
        />,
      );

      // Start and stop recording
      await user.click(screen.getByRole('button', { name: /Start Recording/i }));
      await user.click(screen.getByRole('button', { name: /Stop Recording/i }));

      // Submit
      await user.click(screen.getByRole('button', { name: 'Submit Report' }));

      await waitFor(() => expect(submitVoice).toHaveBeenCalledOnce());
      const [audioArg, metaArg] = submitVoice.mock.calls[0];
      expect(audioArg).toBeInstanceOf(File);
      expect(audioArg.name).toMatch(/mic_recording_.*\.webm/);
      expect(audioArg.type).toBe('audio/webm');
      expect(metaArg.place).toBe('Mandi');
      expect(metaArg.reporter_email).toBe('jane@example.com');
    });

    it('handles microphone permission denied error', async () => {
      const user = userEvent.setup();
      const notAllowedError = new Error('Permission denied');
      notAllowedError.name = 'NotAllowedError';
      navigator.mediaDevices.getUserMedia = vi.fn().mockRejectedValue(notAllowedError);

      render(
        <SubmitReportModal
          isOpen
          onClose={vi.fn()}
          places={[{ place: 'Mandi', district: 'Mandi' }]}
          citizenUser={mockCitizen}
        />,
      );

      await user.click(screen.getByRole('button', { name: /Start Recording/i }));

      expect(await screen.findByRole('alert')).toHaveTextContent(
        'Microphone permission denied',
      );
    });

    it('handles no microphone device found error', async () => {
      const user = userEvent.setup();
      const notFoundError = new Error('Device not found');
      notFoundError.name = 'NotFoundError';
      navigator.mediaDevices.getUserMedia = vi.fn().mockRejectedValue(notFoundError);

      render(
        <SubmitReportModal
          isOpen
          onClose={vi.fn()}
          places={[{ place: 'Mandi', district: 'Mandi' }]}
          citizenUser={mockCitizen}
        />,
      );

      await user.click(screen.getByRole('button', { name: /Start Recording/i }));

      expect(await screen.findByRole('alert')).toHaveTextContent(
        'No microphone detected',
      );
    });
  });
});
