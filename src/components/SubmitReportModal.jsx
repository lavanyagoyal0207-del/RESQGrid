import React, { useState } from 'react';
const LANGUAGE_NAMES = {
  en: 'English',
  hi: 'Hindi',
  pa: 'Punjabi',
};

const createSubmissionId = () =>
  globalThis.crypto?.randomUUID?.() ||
  `${Date.now()}-${Math.random().toString(16).slice(2)}`;

const VOICE_SAMPLES = [
  {
    label: 'Hindi Voice Note — Mandi Beas Bridge Surge',
    place: 'Mandi',
    type: 'Flood',
    severity: 'High',
    original_text: 'मंडी में पंचवक्त्र मंदिर के पास ब्यास का पानी बहुत तेज बढ़ रहा है, तुरंत बचाव दल भेजें।',
    translated_text: 'Beas water level is rising rapidly near Panchvaktra Temple in Mandi; please dispatch review team.',
  },
  {
    label: 'Punjabi Voice Note — Pandoh NH-21 Blockade',
    place: 'Pandoh',
    type: 'Blocked Road',
    severity: 'Medium',
    original_text: 'ਪੰਡੋਹ ਡੈਮ ਦੇ ਨੇੜੇ ਪਹਾੜ ਤੋਂ ਪੱਥਰ ਡਿੱਗਣ ਨਾਲ ਸੜਕ ਪੂਰੀ ਤਰ੍ਹਾਂ ਬੰਦ ਹੋ ਗਈ ਹੈ।',
    translated_text: 'Road is completely blocked near Pandoh Dam due to boulders falling from the mountain.',
  },
  {
    label: 'Hindi Voice Note — Jogindarnagar Slope Failure',
    place: 'Jogindarnagar',
    type: 'Landslide',
    severity: 'High',
    original_text: 'जोगिंदरनगर हाईवे पर कोटरोपी के पास फिर से मलबा गिरा है, गाड़ियां फंसी हैं।',
    translated_text: 'Fresh landslide debris has fallen near Kotropi on Jogindarnagar highway; vehicles are stranded.',
  },
];

const DEFAULT_PLACES = [
  { place: 'Mandi', district: 'Mandi' },
  { place: 'Jogindarnagar', district: 'Mandi' },
  { place: 'Kullu', district: 'Kullu' },
  { place: 'Manali', district: 'Kullu' },
  { place: 'Shimla', district: 'Shimla' },
  { place: 'Dharamshala', district: 'Kangra' },
  { place: 'Pandoh', district: 'Mandi' },
  { place: 'Aut', district: 'Mandi' },
  { place: 'Chamba', district: 'Chamba' },
  { place: 'Bilaspur', district: 'Bilaspur' },
  { place: 'Hamirpur', district: 'Hamirpur' },
  { place: 'Solan', district: 'Solan' },
  { place: 'Rampur Bushahr', district: 'Shimla' },
  { place: 'Reckong Peo', district: 'Kinnaur' },
  { place: 'Keylong', district: 'Lahaul & Spiti' },
];

export default function SubmitReportModal({
  isOpen,
  onClose,
  places,
  onSubmitReport,
  onSubmitVoiceReport,
  isStandalonePage = false,
}) {
  const availablePlaces = places && places.length > 0 ? places : DEFAULT_PLACES;
  const [originalText, setOriginalText] = useState('');
  const [place, setPlace] = useState(() => availablePlaces[0]?.place || 'Mandi');
  const [type, setType] = useState('Flood');
  const [severity, setSeverity] = useState('High');
  const [voiceFileName, setVoiceFileName] = useState('');
  const [audioFile, setAudioFile] = useState(null);
  const [isUploading, setIsUploading] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitSuccess, setSubmitSuccess] = useState(null);
  const [voiceReport, setVoiceReport] = useState(null);
  const [idempotencyKey, setIdempotencyKey] = useState(createSubmissionId);
  const [demoSampleSelected, setDemoSampleSelected] = useState(false);

  if (!isOpen && !isStandalonePage) return null;

  const handleVoiceUpload = (sampleIndex = 0) => {
    setSubmitSuccess(null);
    setAudioFile(null);
    setVoiceReport(null);
    setDemoSampleSelected(true);
    setIdempotencyKey(createSubmissionId());

    const chosen = VOICE_SAMPLES[sampleIndex % VOICE_SAMPLES.length];

    setVoiceFileName(`Demo Sample — ${chosen.place}`);
    setOriginalText(chosen.original_text);
    setPlace(chosen.place);
    setType(chosen.type);
    setSeverity(chosen.severity);
  };

  const clearDemoSample = () => {
    setOriginalText('');
    setVoiceFileName('');
    setAudioFile(null);
    setVoiceReport(null);
    setDemoSampleSelected(false);
    setPlace(availablePlaces[0]?.place || 'Mandi');
    setType('Flood');
    setSeverity('High');
    setIdempotencyKey(createSubmissionId());
    setSubmitSuccess(null);
  };

  const handleFileInputChange = (e) => {
    const file = e.target.files?.[0];

    if (!file) return;

    if (!file.type.startsWith('audio/')) {
      setSubmitSuccess({
        message: 'Please select a valid audio file.',
        endpoint: 'Validation Error',
        error: true,
      });
      setAudioFile(null);
      setVoiceFileName('');
      setVoiceReport(null);
      setDemoSampleSelected(false);
      setIdempotencyKey(createSubmissionId());
      e.target.value = '';
      return;
    }

    setAudioFile(file);
    setDemoSampleSelected(false);
    setVoiceFileName(file.name);
    setSubmitSuccess(null);
    setVoiceReport(null);
    setIdempotencyKey(createSubmissionId());

    // Clear the previous sample transcript.
    setOriginalText('');
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    setSubmitSuccess(null);

    if (demoSampleSelected) {
      setSubmitSuccess({
        message: 'This illustrative sample is not a real report or audio recording. Edit the report text or upload an actual recording before submitting.',
        endpoint: 'Demo Preview',
        error: true,
      });
      return;
    }

    if (audioFile) {
      if (!onSubmitVoiceReport) {
        setSubmitSuccess({
          message: 'Voice report submission is not available.',
          endpoint: 'POST /voice-report',
          error: true,
        });
        return;
      }

      setIsUploading(true);
      setIsTranscribing(true);
      setIsSubmitting(true);

      try {
        const result = await onSubmitVoiceReport(audioFile, {
          place,
          type,
          severity,
          idempotency_key: idempotencyKey,
          submission_id: idempotencyKey,
        });

        if (!result.ok) {
          setSubmitSuccess({
            message: result.error || 'Voice upload failed.',
            endpoint: 'POST /voice-report',
            error: true,
          });
          return;
        }

        const report = result.data?.report;

        if (!report) {
          setSubmitSuccess({
            message: 'The backend did not return the saved voice report.',
            endpoint: 'POST /voice-report',
            error: true,
          });
          return;
        }

        setVoiceReport(report);
        setSubmitSuccess({
          message: result.data.message || `Voice recording saved for ${place}.`,
          endpoint: 'POST /voice-report',
          error: false,
        });

        setAudioFile(null);
        setVoiceFileName('');
        setIdempotencyKey(createSubmissionId());
        return;
      } catch (error) {
        setSubmitSuccess({
          message: error.message || 'Something went wrong.',
          endpoint: 'POST /voice-report',
          error: true,
        });
        return;
      } finally {
        setIsUploading(false);
        setIsTranscribing(false);
        setIsSubmitting(false);
      }
    }

    if (!place || !place.trim()) {
      setSubmitSuccess({
        message: 'Please select a valid Himachal sector/location.',
        endpoint: 'Validation Error',
        error: true,
      });
      return;
    }

    if (!originalText.trim()) {
      setSubmitSuccess({
        message: 'Please describe the incident or select an audio file.',
        endpoint: 'Validation Error',
        error: true,
      });
      return;
    }

    if (originalText.trim().length > 5000) {
      setSubmitSuccess({
        message: 'Report text must be 5000 characters or fewer.',
        endpoint: 'Validation Error',
        error: true,
      });
      return;
    }

    setIsSubmitting(true);
    try {
      const result = await onSubmitReport({
        original_text: originalText.trim(),
        place,
        type,
        severity,
        idempotency_key: idempotencyKey,
        submission_id: idempotencyKey,
        source: voiceFileName
          ? `Voice Note (${voiceFileName})`
          : 'Citizen Field Report',
      });

      if (!result?.ok) {
        setSubmitSuccess({
          message: result?.error || 'Report submission failed.',
          endpoint: 'POST /report',
          error: true,
        });
        return;
      }

      const reportId = result?.data?.report?.report_id;
      setSubmitSuccess({
        message: `Emergency report received. Queued for human verification at ${place}.`,
        reportId: reportId || null,
        endpoint: 'POST /report',
        error: false,
      });
      setOriginalText('');
      setVoiceFileName('');
      setAudioFile(null);
      setVoiceReport(null);
      setDemoSampleSelected(false);
      setIdempotencyKey(createSubmissionId());
    } catch (error) {
      setSubmitSuccess({
        message: error.message || 'Something went wrong.',
        endpoint: 'POST /report',
        error: true,
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const content = (
    <div className="rq-report-modal w-full max-w-2xl mx-auto rounded-2xl border overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-4 bg-[#2D1B4E] border-b border-purple-300/20">
        <div>
          <span className="text-[10px] font-mono uppercase tracking-widest text-[#FF6B35] block">
            Field Intake Portal • POST /report
          </span>
          <h2 className="font-display text-lg font-bold text-white">
            Submit Field Incident Report (Hindi / Punjabi / English)
          </h2>
        </div>
        {!isStandalonePage && (
          <button
            type="button"
            onClick={onClose}
            className="btn-tactical rounded-lg bg-[#1a0b2e] px-3 py-1.5 text-xs font-semibold text-purple-200 hover:text-white border border-purple-300/20"
          >
            Close
          </button>
        )}
      </div>

      <form onSubmit={handleSubmit} className="p-5 space-y-4">
        {/* Golden Rule Notice */}
        <div className="rounded-xl bg-[#120721] border border-purple-300/20 p-3 text-xs text-purple-200/90 flex items-center justify-between gap-2">
          <span>
            Incoming reports are clustered by AI as <strong className="text-white">Unverified / Corroborated</strong>. Only a human operator can mark an incident as <strong className="text-emerald-300">Confirmed</strong>.
          </span>
          <span className="rounded bg-amber-400/20 border border-amber-300/40 px-2 py-0.5 text-[10px] font-bold text-amber-300 shrink-0">
            AI Suggests Only
          </span>
        </div>

        {/* Sector & Incident Metadata */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div>
            <label htmlFor="report-place" className="block text-xs font-semibold text-purple-200 mb-1">
              Himachal Sector (Place)
            </label>
            <select
              id="report-place"
              value={place}
              onChange={(e) => {
                setPlace(e.target.value);
                setIdempotencyKey(createSubmissionId());
              }}
              disabled={isSubmitting}
              className="w-full rounded-xl bg-[#120721] border border-purple-300/30 px-3 py-2 text-xs text-white focus:outline-none focus:border-[#FF6B35]"
            >
              {availablePlaces.map((p) => (
                <option key={p.place} value={p.place}>
                  {p.place} {p.district ? `(${p.district})` : ''}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="report-type" className="block text-xs font-semibold text-purple-200 mb-1">
              Suggested Incident Type
            </label>
            <select
              id="report-type"
              value={type}
              onChange={(e) => {
                setType(e.target.value);
                setIdempotencyKey(createSubmissionId());
              }}
              disabled={isSubmitting}
              className="w-full rounded-xl bg-[#120721] border border-purple-300/30 px-3 py-2 text-xs text-white focus:outline-none focus:border-[#FF6B35]"
            >
              <option value="Flood">Flood</option>
              <option value="Landslide">Landslide</option>
              <option value="Blocked Road">Blocked Road</option>
            </select>
          </div>

          <div>
            <label htmlFor="report-severity" className="block text-xs font-semibold text-purple-200 mb-1">
              Initial Severity Estimate
            </label>
            <select
              id="report-severity"
              value={severity}
              onChange={(e) => {
                setSeverity(e.target.value);
                setIdempotencyKey(createSubmissionId());
              }}
              disabled={isSubmitting}
              className="w-full rounded-xl bg-[#120721] border border-purple-300/30 px-3 py-2 text-xs text-white focus:outline-none focus:border-[#FF6B35]"
            >
              <option value="High">High</option>
              <option value="Medium">Medium</option>
              <option value="Low">Low</option>
            </select>
          </div>
        </div>

        {/* Voice Upload Button: "Upload Voice Note (Hindi/Punjabi)" */}
        <div className="rounded-xl bg-[#2D1B4E]/60 border border-purple-300/25 p-3.5 space-y-2.5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <span className="text-xs font-semibold text-white block">
                Voice Note Intake (ASR Speech-to-Text Preview)
              </span>
              <span className="text-[11px] text-purple-200/75">
                Upload English, Hindi, or Punjabi audio, or load a field voice sample
              </span>
            </div>

            <label className="btn-tactical cursor-pointer inline-flex items-center gap-2 rounded-xl bg-[#2D1B4E] hover:bg-[#3d2666] border border-[#FF6B35]/60 px-3.5 py-2 text-xs font-bold text-[#FF6B35] shadow-[0_0_14px_rgba(255,107,53,0.25)]">
              <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
                <path d="M19 10v2a7 7 0 0 1-14 0v-2M12 19v4M8 23h8" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              <span>Upload Voice Note (English/Hindi/Punjabi)</span>
              <input
                aria-label="Upload audio recording"
                type="file"
                accept="audio/*"
                onChange={handleFileInputChange}
                disabled={isSubmitting}
                className="hidden"
              />
            </label>
          </div>

          {/* Preset Voice Note Simulation Buttons for Instant Testing */}
          <div className="flex flex-wrap items-center gap-1.5 pt-1">
            {VOICE_SAMPLES.map((sample, idx) => (
              <button
                key={sample.label}
                type="button"
                onClick={() => handleVoiceUpload(idx)}
                disabled={isSubmitting}
                className="btn-tactical rounded-lg bg-[#1a0b2e] hover:bg-[#120721] border border-purple-300/20 px-2.5 py-1 text-[11px] text-purple-200 hover:text-white"
              >
                Sample: {sample.label}
              </button>
            ))}
          </div>

          {isTranscribing && (
            <div className="text-xs text-[#FF6B35] font-mono animate-pulse">
              Uploading audio and running multilingual transcription...
            </div>
          )}
          {voiceFileName && !isSubmitting && (
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
              <span className={demoSampleSelected ? 'text-amber-200' : 'text-emerald-300'}>
                {demoSampleSelected
                  ? `Illustrative preview only: ${voiceFileName} — not an audio file and cannot be submitted.`
                  : `Selected audio: ${voiceFileName} (Ready to upload)`}
              </span>
              {demoSampleSelected && (
                <button
                  type="button"
                  onClick={clearDemoSample}
                  className="rounded-lg border border-amber-200/30 px-2.5 py-1 text-[11px] font-semibold text-amber-100 hover:bg-amber-300/10"
                >
                  Clear sample and enter a real report
                </button>
              )}
            </div>
          )}
        </div>

        {voiceReport && (
          <div
            role="status"
            className="rounded-xl bg-amber-400/10 border border-amber-300/40 p-3.5 text-xs text-amber-100"
          >
            <div className="font-bold text-amber-200">
              Voice Report Transcription — Needs Human Review
            </div>
            <dl className="mt-2 grid grid-cols-1 sm:grid-cols-3 gap-2">
              <div>
                <dt className="text-purple-200/75">Transcription status</dt>
                <dd className="font-semibold">{voiceReport.transcription_status || 'Pending'}</dd>
              </div>
              <div>
                <dt className="text-purple-200/75">Detected language</dt>
                <dd className="font-semibold">
                  {voiceReport.detected_language &&
                  voiceReport.detected_language !== 'unknown'
                    ? `${LANGUAGE_NAMES[voiceReport.detected_language] || voiceReport.detected_language} (${voiceReport.detected_language})`
                    : 'Unknown'}
                </dd>
              </div>
              <div>
                <dt className="text-purple-200/75">Review status</dt>
                <dd className="font-semibold">{voiceReport.review_status || 'Needs Human Review'}</dd>
              </div>
            </dl>
            <div className="mt-2">
              <div className="text-purple-200/75">Transcribed text</div>
              <p className="mt-1 whitespace-pre-wrap">
                {voiceReport.original_text || 'No transcript is available; the original audio is retained for review.'}
              </p>
            </div>
            <p className="mt-2 font-semibold">
              This transcript is unverified and requires human review.
            </p>
          </div>
        )}

        {/* Text Box: "Describe incident..." */}
        <div>
          <label htmlFor="report-description" className="block text-xs font-semibold text-purple-200 mb-1.5">
            Field Observation (`original_text`)
          </label>
          <textarea
            id="report-description"
            rows={4}
            value={originalText}
            disabled={isSubmitting}
            readOnly={demoSampleSelected}
            onChange={(e) => {
              setOriginalText(e.target.value);
              setDemoSampleSelected(false);
              setVoiceReport(null);
              setIdempotencyKey(createSubmissionId());
            }}
            placeholder="Describe incident..."
            required={!audioFile}
            className="w-full rounded-xl bg-[#120721] border border-purple-300/30 p-3 text-sm text-white placeholder-purple-300/45 focus:outline-none focus:border-[#FF6B35]"
          />
        </div>

        {/* Success / Error Message Banner */}
        {submitSuccess && (
          <div
            role={submitSuccess.error ? 'alert' : 'status'}
            className={`rounded-xl border p-4 text-xs ${
              submitSuccess.error
                ? 'bg-red-500/20 border-red-400/50 text-red-200'
                : 'bg-emerald-500/20 border-emerald-400/50 text-emerald-200'
            }`}
          >
            <div className={`font-bold ${submitSuccess.error ? 'text-red-300' : 'text-emerald-300'}`}>
              {submitSuccess.error
                ? `Submission Error (${submitSuccess.endpoint})`
                : 'Emergency Report Submitted Successfully'}
            </div>
            <p className="mt-1.5">{submitSuccess.message}</p>
            {submitSuccess.reportId && (
              <div className="mt-3 p-3 rounded-lg bg-emerald-950/70 border border-emerald-500/40 flex flex-wrap items-center justify-between gap-2">
                <span className="text-emerald-300 font-mono text-xs uppercase tracking-wider font-semibold">
                  Reference / Report ID:
                </span>
                <span className="font-mono font-bold text-sm text-white bg-emerald-900/80 px-2.5 py-1 rounded border border-emerald-400/30 select-all">
                  {submitSuccess.reportId}
                </span>
              </div>
            )}
          </div>
        )}

        {/* Submit Actions */}
        <div className="flex items-center justify-end gap-3 pt-2">
          {!isStandalonePage && (
            <button
              type="button"
              onClick={onClose}
              className="btn-tactical rounded-xl bg-[#2D1B4E] px-4 py-2.5 text-xs font-semibold text-purple-200 hover:text-white"
            >
              Cancel
            </button>
          )}
          <button
            type="submit"
            disabled={isSubmitting}
            className="btn-tactical rounded-xl bg-[#FF6B35] hover:bg-[#ff8255] disabled:cursor-wait disabled:opacity-60 px-5 py-2.5 text-xs font-bold uppercase tracking-wider text-white shadow-[0_0_20px_rgba(255,107,53,0.5)]"
          >
            {isSubmitting
              ? audioFile
                ? 'Uploading & Transcribing...'
                : 'Submitting...'
              : 'Submit Report'}
          </button>
        </div>
      </form>
    </div>
  );

  if (isStandalonePage) {
    return <div className="py-6 px-4">{content}</div>;
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4">
      {content}
    </div>
  );
}
