import React, { useState, useRef, useEffect } from 'react';
import {
  ShieldCheck,
  AlertCircle,
  Mic,
  Square,
  Play,
  Pause,
  RotateCcw,
  UploadCloud,
  Volume2,
} from 'lucide-react';
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
  citizenUser = null,
}) {
  const availablePlaces = places && places.length > 0 ? places : DEFAULT_PLACES;
  const [originalText, setOriginalText] = useState('');
  const [place, setPlace] = useState(() => availablePlaces[0]?.place || 'Mandi');
  const [type, setType] = useState('Flood');
  const [severity, setSeverity] = useState('High');
  const [voiceFileName, setVoiceFileName] = useState('');
  const [audioFile, setAudioFile] = useState(null);
  const [voiceInputTab, setVoiceInputTab] = useState('record'); // 'record' | 'upload'
  const [recordingState, setRecordingState] = useState('idle'); // 'idle' | 'recording' | 'paused' | 'stopped'
  const [recordingDuration, setRecordingDuration] = useState(0);
  const [audioUrl, setAudioUrl] = useState(null);
  const [audioBlob, setAudioBlob] = useState(null);
  const [micError, setMicError] = useState(null);

  const mediaRecorderRef = useRef(null);
  const streamRef = useRef(null);
  const timerRef = useRef(null);
  const audioChunksRef = useRef([]);

  const [isUploading, setIsUploading] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitSuccess, setSubmitSuccess] = useState(null);
  const [voiceReport, setVoiceReport] = useState(null);
  const [idempotencyKey, setIdempotencyKey] = useState(createSubmissionId);
  const [demoSampleSelected, setDemoSampleSelected] = useState(false);

  // Cleanup microphone resources and audio URL on unmount or URL change
  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop());
      }
      if (audioUrl) {
        URL.revokeObjectURL(audioUrl);
      }
    };
  }, [audioUrl]);

  const formatDuration = (totalSeconds) => {
    const mins = Math.floor(totalSeconds / 60);
    const secs = totalSeconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  const startRecording = async () => {
    setMicError(null);
    setSubmitSuccess(null);
    if (audioUrl) {
      URL.revokeObjectURL(audioUrl);
      setAudioUrl(null);
    }
    setAudioBlob(null);
    setAudioFile(null);
    setVoiceFileName('');
    setVoiceReport(null);
    setDemoSampleSelected(false);
    setIdempotencyKey(createSubmissionId());

    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      setMicError('Direct microphone recording is not supported in this browser environment.');
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      audioChunksRef.current = [];

      let chosenMime = '';
      if (typeof window !== 'undefined' && window.MediaRecorder) {
        if (typeof MediaRecorder.isTypeSupported === 'function') {
          if (MediaRecorder.isTypeSupported('audio/webm;codecs=opus')) {
            chosenMime = 'audio/webm;codecs=opus';
          } else if (MediaRecorder.isTypeSupported('audio/webm')) {
            chosenMime = 'audio/webm';
          } else if (MediaRecorder.isTypeSupported('audio/mp4')) {
            chosenMime = 'audio/mp4';
          } else if (MediaRecorder.isTypeSupported('audio/ogg;codecs=opus')) {
            chosenMime = 'audio/ogg;codecs=opus';
          } else if (MediaRecorder.isTypeSupported('audio/wav')) {
            chosenMime = 'audio/wav';
          }
        }
      }

      const recorder = new MediaRecorder(
        stream,
        chosenMime ? { mimeType: chosenMime } : undefined
      );
      mediaRecorderRef.current = recorder;

      recorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      recorder.onstop = () => {
        if (streamRef.current) {
          streamRef.current.getTracks().forEach((track) => track.stop());
          streamRef.current = null;
        }

        const actualType = recorder.mimeType || chosenMime || 'audio/webm';
        const cleanMime = actualType.split(';')[0] || 'audio/webm';
        const blob = new Blob(audioChunksRef.current, { type: cleanMime });

        if (blob.size === 0) {
          setMicError('Audio recording was empty. Please speak clearly into your microphone.');
          setRecordingState('idle');
          return;
        }

        const ext = cleanMime.includes('mp4')
          ? 'mp4'
          : cleanMime.includes('ogg')
          ? 'ogg'
          : cleanMime.includes('wav')
          ? 'wav'
          : 'webm';

        const fileName = `mic_recording_${Date.now()}.${ext}`;
        const file = new File([blob], fileName, { type: cleanMime });
        const url = URL.createObjectURL(blob);

        setAudioBlob(blob);
        setAudioFile(file);
        setAudioUrl(url);
        setVoiceFileName(fileName);
        setRecordingState('stopped');
        setDemoSampleSelected(false);
        setOriginalText('');
      };

      recorder.start(250);
      setRecordingDuration(0);
      setRecordingState('recording');

      if (timerRef.current) clearInterval(timerRef.current);
      timerRef.current = setInterval(() => {
        setRecordingDuration((prev) => prev + 1);
      }, 1000);
    } catch (err) {
      if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
        setMicError('Microphone permission denied. Please allow microphone access in your browser settings to record.');
      } else if (err.name === 'NotFoundError' || err.name === 'DevicesNotFoundError') {
        setMicError('No microphone detected. Please connect an audio input device or upload a recorded file.');
      } else {
        setMicError(err.message || 'Could not access microphone.');
      }
      setRecordingState('idle');
    }
  };

  const pauseRecording = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
      mediaRecorderRef.current.pause();
      if (timerRef.current) clearInterval(timerRef.current);
      setRecordingState('paused');
    }
  };

  const resumeRecording = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'paused') {
      mediaRecorderRef.current.resume();
      setRecordingState('recording');
      if (timerRef.current) clearInterval(timerRef.current);
      timerRef.current = setInterval(() => {
        setRecordingDuration((prev) => prev + 1);
      }, 1000);
    }
  };

  const stopRecording = () => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (
      mediaRecorderRef.current &&
      (mediaRecorderRef.current.state === 'recording' || mediaRecorderRef.current.state === 'paused')
    ) {
      mediaRecorderRef.current.stop();
    }
  };

  const discardRecording = () => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    if (audioUrl) {
      URL.revokeObjectURL(audioUrl);
      setAudioUrl(null);
    }
    setAudioBlob(null);
    setAudioFile(null);
    setVoiceFileName('');
    setRecordingDuration(0);
    setRecordingState('idle');
    setMicError(null);
  };

  if (!isOpen && !isStandalonePage) return null;

  const handleVoiceUpload = (sampleIndex = 0) => {
    discardRecording();
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
    discardRecording();
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
    discardRecording();
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

    if (!citizenUser) {
      setSubmitSuccess({
        message: 'Citizen sign-in is required to submit an emergency report. Please register or log in first.',
        endpoint: 'Authentication Required',
        error: true,
      });
      return;
    }

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
          reporter_name: citizenUser?.name,
          reporter_email: citizenUser?.email,
        });

        if (!result.ok) {
          setIdempotencyKey(createSubmissionId());
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

        discardRecording();
        setVoiceReport(report);
        setSubmitSuccess({
          message: result.data.message || `Voice recording saved for ${place}.`,
          endpoint: 'POST /voice-report',
          error: false,
        });
        setIdempotencyKey(createSubmissionId());
        return;
      } catch (error) {
        setIdempotencyKey(createSubmissionId());
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
        reporter_name: citizenUser?.name,
        reporter_email: citizenUser?.email,
        source: voiceFileName
          ? `Voice Note (${voiceFileName})`
          : 'Citizen Field Report',
      });

      if (!result?.ok) {
        setIdempotencyKey(createSubmissionId());
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
      setIdempotencyKey(createSubmissionId());
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
    <div className="rq-report-modal w-full max-w-2xl mx-auto rounded-2xl border border-slate-700/80 bg-slate-900 shadow-2xl overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-4 bg-slate-950 border-b border-slate-800">
        <div>
          <span className="text-[10px] font-mono uppercase tracking-widest text-orange-400 font-semibold block">
            Field Intake Portal • POST /report
          </span>
          <h2 className="text-lg font-bold text-white">
            Submit Field Incident Report (Hindi / Punjabi / English)
          </h2>
        </div>
        {!isStandalonePage && (
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-semibold text-slate-300 hover:text-white border border-slate-700 transition"
          >
            Close
          </button>
        )}
      </div>

      <form onSubmit={handleSubmit} className="p-5 space-y-4">
        {/* Golden Rule Notice */}
        <div className="rounded-xl bg-slate-950 border border-slate-800 p-3 text-xs text-slate-300 flex items-center justify-between gap-2">
          <span>
            Incoming reports are clustered by AI as <strong className="text-white">Unverified / Corroborated</strong>. Only a human operator can mark an incident as <strong className="text-emerald-300">Confirmed</strong>.
          </span>
          <span className="rounded bg-amber-400/10 border border-amber-400/30 px-2 py-0.5 text-[10px] font-bold text-amber-300 shrink-0">
            AI Suggests Only
          </span>
        </div>

        {citizenUser ? (
          <div className="rounded-xl bg-sky-950/40 border border-sky-400/30 p-2.5 text-xs text-sky-200 flex items-center gap-2">
            <ShieldCheck size={16} className="text-sky-400 shrink-0" />
            <span>
              Reporting as <strong>{citizenUser.name}</strong> ({citizenUser.email}) · Authenticated Citizen
            </span>
          </div>
        ) : (
          <div className="rounded-xl bg-amber-950/40 border border-amber-400/40 p-2.5 text-xs text-amber-200 flex items-center gap-2">
            <AlertCircle size={16} className="text-amber-400 shrink-0" />
            <span>
              <strong>Citizen Sign-in Required:</strong> Please register or log in with your citizen account to submit an emergency report.
            </span>
          </div>
        )}

        {/* Sector & Incident Metadata */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div>
            <label htmlFor="report-place" className="block text-xs font-semibold text-slate-300 mb-1">
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
              className="w-full rounded-xl bg-slate-950 border border-slate-700 px-3 py-2 text-xs text-white focus:outline-none focus:border-orange-500"
            >
              {availablePlaces.map((p) => (
                <option key={p.place} value={p.place}>
                  {p.place} {p.district ? `(${p.district})` : ''}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="report-type" className="block text-xs font-semibold text-slate-300 mb-1">
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
              className="w-full rounded-xl bg-slate-950 border border-slate-700 px-3 py-2 text-xs text-white focus:outline-none focus:border-orange-500"
            >
              <option value="Flood">Flood</option>
              <option value="Landslide">Landslide</option>
              <option value="Blocked Road">Blocked Road</option>
            </select>
          </div>

          <div>
            <label htmlFor="report-severity" className="block text-xs font-semibold text-slate-300 mb-1">
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
              className="w-full rounded-xl bg-slate-950 border border-slate-700 px-3 py-2 text-xs text-white focus:outline-none focus:border-orange-500"
            >
              <option value="High">High</option>
              <option value="Medium">Medium</option>
              <option value="Low">Low</option>
            </select>
          </div>
        </div>

        {/* Voice Note Intake Section */}
        <div className="rounded-xl bg-slate-950/70 border border-slate-800 p-3.5 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <span className="text-xs font-semibold text-white block">
                Voice Note Intake (Speech-to-Text & Translation)
              </span>
              <span className="text-[11px] text-slate-400">
                Record directly from browser microphone or upload pre-recorded audio
              </span>
            </div>

            {/* Mode Switcher */}
            <div className="flex rounded-lg bg-slate-900 border border-slate-700/80 p-0.5 text-xs">
              <button
                type="button"
                onClick={() => setVoiceInputTab('record')}
                disabled={isSubmitting || recordingState === 'recording'}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md font-medium transition cursor-pointer ${
                  voiceInputTab === 'record'
                    ? 'bg-orange-600 text-white shadow-sm'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <Mic className="h-3.5 w-3.5" />
                <span>Direct Microphone</span>
              </button>
              <button
                type="button"
                onClick={() => setVoiceInputTab('upload')}
                disabled={isSubmitting || recordingState === 'recording'}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md font-medium transition cursor-pointer ${
                  voiceInputTab === 'upload'
                    ? 'bg-orange-600 text-white shadow-sm'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <UploadCloud className="h-3.5 w-3.5" />
                <span>Upload Audio File</span>
              </button>
            </div>
          </div>

          {/* Direct Microphone Tab Panel */}
          {voiceInputTab === 'record' && (
            <div className="rounded-xl border border-slate-800/80 bg-slate-900/60 p-3 space-y-3">
              {micError && (
                <div role="alert" className="flex items-start gap-2 rounded-lg bg-red-950/50 border border-red-800/60 p-2.5 text-xs text-red-200">
                  <AlertCircle className="h-4 w-4 shrink-0 text-red-400 mt-0.5" />
                  <span>{micError}</span>
                </div>
              )}

              {recordingState === 'idle' && (
                <div className="flex flex-col sm:flex-row items-center justify-between gap-3 py-1">
                  <div className="text-xs text-slate-300">
                    <p className="font-semibold text-slate-200">Live Microphone Intake</p>
                    <p className="text-[11px] text-slate-400">Speak in Hindi, Punjabi, or English. Audio is transcribed automatically by Whisper upon submission.</p>
                  </div>
                  <button
                    type="button"
                    onClick={startRecording}
                    disabled={isSubmitting}
                    className="cursor-pointer shrink-0 inline-flex items-center gap-2 rounded-xl bg-red-600 hover:bg-red-500 active:bg-red-700 px-4 py-2 text-xs font-semibold text-white shadow-md transition"
                  >
                    <Mic className="h-4 w-4" />
                    <span>Start Recording</span>
                  </button>
                </div>
              )}

              {(recordingState === 'recording' || recordingState === 'paused') && (
                <div className="flex flex-col sm:flex-row items-center justify-between gap-3 py-1">
                  <div className="flex items-center gap-3">
                    <span className="flex items-center gap-2">
                      <span className={`inline-block h-3 w-3 rounded-full ${
                        recordingState === 'recording' ? 'bg-red-500 animate-ping' : 'bg-amber-400'
                      }`} />
                      <span className="font-mono text-xs font-bold text-white tracking-wider">
                        {recordingState === 'recording' ? 'REC' : 'PAUSED'} {formatDuration(recordingDuration)}
                      </span>
                    </span>

                    {recordingState === 'recording' && (
                      <div className="flex items-center gap-0.5 h-4 px-2" aria-hidden="true">
                        <span className="w-1 bg-red-500 rounded-full animate-pulse h-3" />
                        <span className="w-1 bg-red-400 rounded-full animate-pulse h-4" />
                        <span className="w-1 bg-red-500 rounded-full animate-pulse h-2" />
                        <span className="w-1 bg-red-400 rounded-full animate-pulse h-4" />
                        <span className="w-1 bg-red-500 rounded-full animate-pulse h-3" />
                      </div>
                    )}
                  </div>

                  <div className="flex items-center gap-2">
                    {recordingState === 'recording' ? (
                      <button
                        type="button"
                        onClick={pauseRecording}
                        className="cursor-pointer inline-flex items-center gap-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 px-3 py-1.5 text-xs font-medium text-slate-200 transition"
                      >
                        <Pause className="h-3.5 w-3.5" />
                        <span>Pause</span>
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={resumeRecording}
                        className="cursor-pointer inline-flex items-center gap-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 px-3 py-1.5 text-xs font-medium text-slate-200 transition"
                      >
                        <Play className="h-3.5 w-3.5" />
                        <span>Resume</span>
                      </button>
                    )}

                    <button
                      type="button"
                      onClick={stopRecording}
                      className="cursor-pointer inline-flex items-center gap-1.5 rounded-lg bg-red-600 hover:bg-red-500 px-3 py-1.5 text-xs font-semibold text-white shadow-sm transition"
                    >
                      <Square className="h-3.5 w-3.5 fill-current" />
                      <span>Stop Recording</span>
                    </button>
                  </div>
                </div>
              )}

              {recordingState === 'stopped' && audioUrl && (
                <div className="space-y-2 py-1">
                  <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                    <span className="text-emerald-400 font-semibold flex items-center gap-1.5">
                      <Volume2 className="h-4 w-4" />
                      Recorded Audio Ready ({formatDuration(recordingDuration)})
                    </span>
                    <button
                      type="button"
                      onClick={discardRecording}
                      disabled={isSubmitting}
                      className="cursor-pointer inline-flex items-center gap-1 text-[11px] font-medium text-slate-400 hover:text-red-400 transition"
                    >
                      <RotateCcw className="h-3 w-3" />
                      <span>Discard & Re-record</span>
                    </button>
                  </div>

                  {/* HTML5 Audio Preview */}
                  <audio
                    controls
                    src={audioUrl}
                    className="w-full h-9 rounded-lg bg-slate-950 border border-slate-800"
                    aria-label="Recorded voice note preview"
                  />
                </div>
              )}
            </div>
          )}

          {/* Upload Audio File Tab Panel */}
          <div className={voiceInputTab === 'upload' ? 'block' : 'hidden'}>
            <div className="rounded-xl border border-slate-800/80 bg-slate-900/60 p-3 space-y-2.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-xs text-slate-300">
                  Select an audio file from your device (.webm, .wav, .mp3, .ogg, .m4a)
                </span>

                <label className="cursor-pointer inline-flex items-center gap-2 rounded-xl bg-slate-800 hover:bg-slate-700 border border-orange-500/50 px-3.5 py-2 text-xs font-semibold text-orange-400 shadow-sm transition">
                  <UploadCloud className="h-4 w-4" />
                  <span>Choose Audio File</span>
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

              {audioFile && voiceInputTab === 'upload' && !demoSampleSelected && (
                <div className="flex items-center justify-between gap-2 text-xs bg-slate-950/80 rounded-lg p-2 border border-slate-800">
                  <span className="text-emerald-400 truncate">
                    Selected file: {audioFile.name} ({(audioFile.size / 1024).toFixed(1)} KB)
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      setAudioFile(null);
                      setVoiceFileName('');
                    }}
                    className="cursor-pointer text-slate-400 hover:text-red-400 text-xs shrink-0"
                  >
                    Remove
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* Preset Voice Note Simulation Samples */}
          <div className="flex flex-wrap items-center gap-1.5 pt-1">
            <span className="text-[11px] text-slate-500 mr-1">Field samples:</span>
            {VOICE_SAMPLES.map((sample, idx) => (
              <button
                key={sample.label}
                type="button"
                onClick={() => handleVoiceUpload(idx)}
                disabled={isSubmitting || recordingState === 'recording'}
                className="cursor-pointer rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-800 px-2.5 py-1 text-[11px] text-slate-400 hover:text-white transition"
              >
                Sample: {sample.label}
              </button>
            ))}
          </div>

          {isTranscribing && (
            <div className="text-xs text-orange-400 font-mono animate-pulse">
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
                <dt className="text-slate-400">Transcription status</dt>
                <dd className="font-semibold">{voiceReport.transcription_status || 'Pending'}</dd>
              </div>
              <div>
                <dt className="text-slate-400">Detected language</dt>
                <dd className="font-semibold">
                  {voiceReport.detected_language &&
                  voiceReport.detected_language !== 'unknown'
                    ? `${LANGUAGE_NAMES[voiceReport.detected_language] || voiceReport.detected_language} (${voiceReport.detected_language})`
                    : 'Unknown'}
                </dd>
              </div>
              <div>
                <dt className="text-slate-400">Review status</dt>
                <dd className="font-semibold">{voiceReport.review_status || 'Needs Human Review'}</dd>
              </div>
            </dl>
            <div className="mt-2">
              <div className="text-slate-400">Transcribed text</div>
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
          <label htmlFor="report-description" className="block text-xs font-semibold text-slate-300 mb-1.5">
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
            className="w-full rounded-xl bg-slate-950 border border-slate-700 p-3 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-orange-500"
          />
        </div>

        {/* Success / Error Message Banner */}
        {submitSuccess && (
          <div
            role={submitSuccess.error ? 'alert' : 'status'}
            className={`rounded-xl border p-4 text-xs ${
              submitSuccess.error
                ? 'bg-red-500/10 border-red-500/30 text-red-200'
                : 'bg-emerald-500/10 border-emerald-500/30 text-emerald-200'
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
              className="rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 px-4 py-2.5 text-xs font-semibold text-slate-300 hover:text-white transition"
            >
              Cancel
            </button>
          )}
          <button
            type="submit"
            disabled={isSubmitting}
            className="rounded-xl bg-orange-600 hover:bg-orange-500 disabled:cursor-wait disabled:opacity-60 px-5 py-2.5 text-xs font-bold uppercase tracking-wider text-white shadow-md transition"
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
