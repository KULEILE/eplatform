import React, { useEffect, useRef, useState } from 'react';
import { useLanguage } from '../context/LanguageContext';
import { api } from '../api/client';

const MAX_BYTES = 5 * 1024 * 1024; // 5MB — matches backend/src/middleware/upload.js's uploadBiometric limit
const ACCEPTED_TYPES = ['image/png', 'image/jpeg', 'image/webp'];

/**
 * Replaces the old static "will be enrolled automatically during card production" notice on the
 * National ID application form with a real capture step. This prototype has no fingerprint
 * scanner to integrate with, so the closest honest simulation is a live camera feed the citizen
 * scans their hand with — NOT a plain file picker, which would let someone just choose an
 * existing photo from their gallery and defeats the point of a "scan" entirely. The captured
 * frame is still, underneath, an uploaded image posted to POST /api/uploads/biometric (same
 * convention as photo_reference), but the interaction is a live scan, not an upload form.
 * See database/migrations/034_add_biometric_reference.sql and 036 (which splits one generic
 * capture into a left-hand and a right-hand scan — a real enrolment takes both, not one).
 *
 * Rendered twice by NationalIdApply.jsx (once per hand) with a `label`/`help` override each
 * time, so this component itself stays hand-agnostic — it just scans and uploads one image.
 * Uses the rear ("environment") camera by default rather than the front/selfie camera, since a
 * citizen scanning their own hand needs to point the device at their hand, not at their face.
 *
 * Falls back to a plain file picker only when the camera genuinely can't be used (no
 * mediaDevices API, permission denied, no camera present, or an insecure/non-HTTPS context) —
 * never as the default path, so a real scan is always what's offered first.
 *
 * Controlled component: value = biometricReference (string|null), onChange(biometricReference|null).
 */
export default function BiometricCapture({ value, onChange, label, help }) {
  const { t } = useLanguage();
  const [preview, setPreview] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
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

  async function uploadBlob(blob) {
    setUploading(true);
    const fd = new FormData();
    fd.append('biometric', blob, 'scan.png');
    try {
      const { biometricReference } = await api.postForm('/uploads/biometric', fd);
      onChange(biometricReference);
    } catch (err) {
      setError(err.message || t('common.somethingWentWrong'));
      setPreview(null);
      onChange(null);
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
    canvas.toBlob((blob) => {
      if (!blob) return;
      setPreview(canvas.toDataURL('image/png'));
      stopStream();
      setScanning(false);
      uploadBlob(blob);
    }, 'image/png');
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
    setPreview(URL.createObjectURL(file));
    await uploadBlob(file);
  }

  function retake() {
    setPreview(null);
    onChange(null);
    setError('');
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
              <button type="button" className="btn-secondary !py-1 !text-xs" onClick={retake}>{t('biometricCapture.retake')}</button>
            </>
          ) : null}
        </div>
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