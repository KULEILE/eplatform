import React, { useEffect, useRef, useState } from 'react';
import { useLanguage } from '../context/LanguageContext';
import { extractHandFeatures } from '../utils/handGeometry';

/**
 * A pure scan-and-measure control: opens the camera, lets the user capture a frame, and runs it
 * through the same real hand-geometry extraction BiometricCapture.jsx uses for enrolment — but,
 * unlike BiometricCapture, NOTHING is uploaded or stored anywhere here. This is for a one-off
 * biometric SEARCH probe (see pages/police/Police.jsx), where minimum-necessary-data applies:
 * an officer needs a feature vector to compare against already-enrolled citizens, never a saved
 * photo of whoever they scanned.
 *
 * onCapture(template) fires once a usable hand is captured. The parent decides what happens next
 * (send the template to the server for comparison); remounting this component (e.g. by keying it
 * on something that changes after a search) is the way to scan again.
 */
export default function HandScan({ onCapture }) {
  const { t } = useLanguage();
  const [scanning, setScanning] = useState(false);
  const [cameraUnavailable, setCameraUnavailable] = useState(false);
  const [error, setError] = useState('');
  const [captured, setCaptured] = useState(false);
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const streamRef = useRef(null);
  const fileInputRef = useRef(null);

  function stopStream() {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((tr) => tr.stop());
      streamRef.current = null;
    }
  }
  useEffect(() => () => stopStream(), []);

  async function startScan() {
    setError('');
    setCaptured(false);
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setCameraUnavailable(true);
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
      streamRef.current = stream;
      setScanning(true);
      setTimeout(() => {
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.play().catch(() => {});
        }
      }, 0);
    } catch {
      setCameraUnavailable(true);
    }
  }

  function cancelScan() {
    stopStream();
    setScanning(false);
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
      setError(t(`biometricCapture.${result.reason}`));
      return;
    }
    stopStream();
    setScanning(false);
    setCaptured(true);
    onCapture(result.template);
  }

  function onFileSelected(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setError('');
    const img = new Image();
    img.onload = () => {
      const result = extractHandFeatures(img);
      if (!result.ok) {
        setError(t(`biometricCapture.${result.reason}`));
        if (fileInputRef.current) fileInputRef.current.value = '';
        return;
      }
      setCaptured(true);
      onCapture(result.template);
    };
    img.onerror = () => setError(t('biometricCapture.noHandDetected'));
    img.src = URL.createObjectURL(file);
  }

  function reset() {
    setCaptured(false);
    setError('');
    setCameraUnavailable(false);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  return (
    <div className="rounded-md border border-dashed border-slate-300 p-4 text-center">
      {captured ? (
        <p className="text-sm text-gov-green">
          ✓ {t('police.handScanCaptured')}{' '}
          <button type="button" className="ml-1 text-xs font-semibold underline" onClick={reset}>{t('biometricCapture.retake')}</button>
        </p>
      ) : scanning ? (
        <div className="flex flex-col items-center gap-3">
          <div className="relative mx-auto h-40 w-48 overflow-hidden rounded border-2 border-gov-navy bg-black">
            <video ref={videoRef} muted playsInline className="h-full w-full object-cover" />
            <div className="pointer-events-none absolute inset-2 rounded border-2 border-dashed border-white/70" />
            <div className="pointer-events-none absolute inset-x-2 h-0.5 bg-gov-green/90 shadow-[0_0_6px_2px_rgba(34,197,94,0.7)] animate-[biometric-scan-sweep_1.8s_ease-in-out_infinite]" />
          </div>
          <div className="flex gap-2">
            <button type="button" className="btn-primary !py-1 !text-xs" onClick={captureNow}>{t('biometricCapture.captureNow')}</button>
            <button type="button" className="btn-secondary !py-1 !text-xs" onClick={cancelScan}>{t('common.cancel')}</button>
          </div>
        </div>
      ) : cameraUnavailable ? (
        <>
          <p className="mb-2 text-xs text-gov-amber">⚠ {t('biometricCapture.cameraUnavailable')}</p>
          <input ref={fileInputRef} type="file" accept="image/png,image/jpeg,image/webp" onChange={onFileSelected} className="mx-auto block text-sm text-slate-600" />
        </>
      ) : (
        <button type="button" className="btn-primary !py-1.5 !text-xs" onClick={startScan}>{t('police.startHandScan')}</button>
      )}
      <canvas ref={canvasRef} className="hidden" />
      {error && <p className="mt-2 text-sm text-gov-red" role="alert">⚠ {error}</p>}
    </div>
  );
}
