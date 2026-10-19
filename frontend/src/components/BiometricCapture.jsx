import React, { useEffect, useRef, useState } from 'react';
import { useLanguage } from '../context/LanguageContext';
import { useAuth } from '../context/AuthContext';
import { api } from '../api/client';
import { extractHandFeatures } from '../utils/handGeometry';

const MAX_BYTES = 5 * 1024 * 1024; // 5MB — matches backend/src/middleware/upload.js's uploadBiometric limit
const ACCEPTED_TYPES = ['image/png', 'image/jpeg', 'image/webp'];

/**
 * A real hand-geometry scan, not just a photo. Earlier, this component (and the fake
 * "biometric_status flips to Enrolled" logic it replaced) only ever captured an IMAGE — nothing
 * was ever measured from it and nothing was ever compared to anything. That was flagged directly
 * and honestly: "it does not scan for real it only capture image not biometrics".
 *
 * It now runs every captured frame through utils/handGeometry.js, client-side, BEFORE accepting
 * it: a photo that doesn't actually show a recognisable open hand (no hand in frame, too
 * close/far, too few fingers visible) is rejected with a specific reason, exactly like
 * PhotoCapture's face-compliance check. Only once a real hand-geometry template is extracted is
 * the frame uploaded (same convention as before — POST /api/uploads/biometric, kept as the
 * stored evidence photo) AND — when `enroll` is true and the logged-in user already has a
 * citizen_id — silently enrolled against that citizen's record (POST /api/biometrics/enroll), so
 * the captured hand becomes something a Police officer can later actually search against (see
 * pages/police/Police.jsx). See database/migrations/052_citizen_hand_biometrics.sql for the
 * storage side of this.
 *
 * `enroll` is false for the two services that capture a hand BEFORE the applicant has a
 * citizen_id (Naturalization, Identity Verification) — there, the parent form carries the
 * template through in its own submission instead, and the officer-approval controller enrols it
 * server-side the moment a citizen_id actually exists. `hand` ('left'|'right') and
 * `enrollSource` (a short label, e.g. "National ID Application") describe where this capture is
 * happening, for citizen_biometrics.enrollment_source.
 *
 * Uses the rear ("environment") camera by default — a citizen scanning their own hand points
 * the device AT their hand, not at their face — falling back to a plain file picker only when
 * the camera genuinely can't be used.
 *
 * Controlled component: value = biometricReference (string|null), onChange(biometricReference|null, template|null).
 * (The 2nd onChange argument is new; existing callers that only take one parameter simply ignore it.)
 */
export default function BiometricCapture({ value, onChange, label, help, hand, enroll = true, enrollSource = 'Biometric Capture' }) {
  const { t } = useLanguage();
  const { user } = useAuth();
  const [preview, setPreview] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [checking, setChecking] = useState(false); // running the client-side hand-geometry check
  const [error, setError] = useState('');
  const [enrollWarning, setEnrollWarning] = useState('');
  const [scanning, setScanning] = useState(false); // live camera feed is open
  const [cameraUnavailable, setCameraUnavailable] = useState(false); // fall back to file input
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const streamRef = useRef(null);
  const fileInputRef = useRef(null);

  // Always stop the camera's tracks when the scan ends (captured, cancelled, or the component
  // unmounts) — otherwise the browser's camera-in-use indicator stays on indefinitely.
  function stopStream() {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
  }
  useEffect(() => () => stopStream(), []);

  async function startScan() {
    setError('');
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setCameraUnavailable(true);
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
      streamRef.current = stream;
      setScanning(true);
      // The <video> element only exists once `scanning` renders it, so attach the stream next tick.
      setTimeout(() => {
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.play().catch(() => {});
        }
      }, 0);
    } catch (err) {
      // Permission denied, no camera present, or an insecure context — fall back rather than
      // leaving the citizen stuck with no way to proceed at all.
      setCameraUnavailable(true);
    }
  }

  function cancelScan() {
    stopStream();
    setScanning(false);
  }

  async function uploadBlob(blob, template) {
    setUploading(true);
    setEnrollWarning('');
    const fd = new FormData();
    fd.append('biometric', blob, 'scan.png');
    try {
      const { biometricReference } = await api.postForm('/uploads/biometric', fd);
      // Enrolment (when applicable) is attempted and awaited BEFORE onChange fires below — a
      // caller like pages/Profile.jsx re-reads enrolment status from its onChange handler, and
      // needs the enrolment POST to have already happened, not just been kicked off, for that
      // re-read to see the new state.
      if (enroll && user.citizenId && template) {
        try {
          await api.post('/biometrics/enroll', { hand, template, source: enrollSource });
        } catch (enrollErr) {
          // The capture + upload already succeeded and the form can proceed — enrolment failing
          // (e.g. a transient network hiccup) shouldn't block the application itself. Surfaced
          // as a soft, non-blocking notice rather than a hard error.
          setEnrollWarning(t('biometricCapture.enrollWarning'));
        }
      }
      onChange(biometricReference, template);
    } catch (err) {
      setError(err.message || t('common.somethingWentWrong'));
      setPreview(null);
      onChange(null, null);
    } finally {
      setUploading(false);
    }
  }

  function captureNow() {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);
    setError('');
    const result = extractHandFeatures(canvas);
    if (!result.ok) {
      // Deliberately does NOT stop the camera here — the citizen can see the live feed, adjust
      // their hand, and press "Capture" again immediately, rather than being thrown back to the
      // start of the flow over a bad frame.
      setError(t(`biometricCapture.${result.reason}`));
      return;
    }
    canvas.toBlob((blob) => {
      if (!blob) return;
      setPreview(canvas.toDataURL('image/png'));
      stopStream();
      setScanning(false);
      uploadBlob(blob, result.template);
    }, 'image/png');
  }

  function extractFromImage(url) {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => resolve(extractHandFeatures(img));
      img.onerror = () => resolve({ ok: false, reason: 'noHandDetected' });
      img.src = url;
    });
  }

  async function onFileSelected(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setError('');
    if (!ACCEPTED_TYPES.includes(file.type)) {
      setError(t('biometricCapture.wrongType'));
      return;
    }
    if (file.size > MAX_BYTES) {
      setError(t('biometricCapture.tooLarge'));
      return;
    }
    const objectUrl = URL.createObjectURL(file);
    setChecking(true);
    const result = await extractFromImage(objectUrl);
    setChecking(false);
    if (!result.ok) {
      setError(t(`biometricCapture.${result.reason}`));
      URL.revokeObjectURL(objectUrl);
      if (fileInputRef.current) fileInputRef.current.value = '';
      return;
    }
    setPreview(objectUrl);
    await uploadBlob(file, result.template);
  }

  function retake() {
    setPreview(null);
    onChange(null, null);
    setError('');
    setEnrollWarning('');
    setCameraUnavailable(false);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  const displaySrc = preview || (value ? `/uploads/${value}` : null);

  return (
    <div className="mb-4 rounded-md border border-dashed border-slate-300 p-4 text-center">
      <p className="mb-2 text-sm font-medium text-slate-700">{label || t('homeAffairs.nationalIdForm.biometricCapture')}</p>
      <p className="mb-2 text-xs text-slate-500">{help || t('biometricCapture.hint')}</p>

      {displaySrc ? (
        <div className="flex flex-col items-center gap-2">
          <img src={displaySrc} alt={t('biometricCapture.previewAlt')} className="h-32 w-28 rounded border border-slate-200 object-cover" />
          {uploading ? (
            <p className="text-sm text-slate-500">{t('common.loading')}</p>
          ) : value ? (
            <>
              <p className="text-sm text-gov-green">✓ {t('biometricCapture.uploaded')}</p>
              {enrollWarning && <p className="text-xs text-gov-amber">⚠ {enrollWarning}</p>}
              <button type="button" className="btn-secondary !py-1 !text-xs" onClick={retake}>{t('biometricCapture.retake')}</button>
            </>
          ) : null}
        </div>
      ) : checking ? (
        <p className="text-sm text-slate-500">{t('biometricCapture.checking')}</p>
      ) : scanning ? (
        <div className="flex flex-col items-center gap-3">
          {/* Live camera feed with a scanning-frame overlay and a sweeping line, so this reads as
              an active scan in progress rather than a static photo preview. */}
          <div className="relative mx-auto h-40 w-48 overflow-hidden rounded border-2 border-gov-navy bg-black">
            <video ref={videoRef} muted playsInline className="h-full w-full object-cover" />
            <div className="pointer-events-none absolute inset-2 rounded border-2 border-dashed border-white/70" />
            <div className="pointer-events-none absolute inset-x-2 h-0.5 bg-gov-green/90 shadow-[0_0_6px_2px_rgba(34,197,94,0.7)] animate-[biometric-scan-sweep_1.8s_ease-in-out_infinite]" />
          </div>
          <div className="flex gap-2">
            <button type="button" className="btn-primary !py-1 !text-xs" onClick={captureNow}>{t('biometricCapture.captureNow')}</button>
            <button type="button" className="btn-secondary !py-1 !text-xs" onClick={cancelScan}>{t('common.cancel')}</button>
          </div>
          <p className="text-xs text-slate-400">{t('biometricCapture.scanInProgressHint')}</p>
        </div>
      ) : cameraUnavailable ? (
        <>
          <p className="mb-2 text-xs text-gov-amber">⚠ {t('biometricCapture.cameraUnavailable')}</p>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            onChange={onFileSelected}
            className="mx-auto block text-sm text-slate-600"
          />
          <p className="mt-2 text-xs text-slate-400">{t('biometricCapture.captureHint')}</p>
        </>
      ) : (
        <button type="button" className="btn-primary !py-1.5 !text-xs" onClick={startScan}>{t('biometricCapture.startScan')}</button>
      )}
      <canvas ref={canvasRef} className="hidden" />
      {error && <p className="mt-2 text-sm text-gov-red" role="alert">⚠ {error}</p>}
    </div>
  );
}
