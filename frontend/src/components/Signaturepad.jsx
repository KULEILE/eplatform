import React, { useRef, useState } from 'react';
import { useLanguage } from '../context/LanguageContext';
import { api } from '../api/client';

/**
 * Feature 3 — officer-enabled citizen signature at collection. Handed to the citizen on the
 * officer's device at the moment of physical collection (National ID, birth certificate,
 * passport, police clearance certificate — see database/migrations/035_add_signature_reference.sql).
 * The citizen draws their signature with a mouse or finger, the officer taps "Confirm" to upload
 * it to POST /api/uploads/signature, and the returned reference is what the collect request
 * submits as signatureReference — same capture-then-reference convention as every other upload
 * component in this app (PhotoCapture, ReceiptCapture, BiometricCapture).
 *
 * Controlled component: value = signatureReference (string|null), onChange(signatureReference|null).
 */
export default function SignaturePad({ value, onChange }) {
  const { t } = useLanguage();
  const canvasRef = useRef(null);
  const drawingRef = useRef(false);
  const [hasStrokes, setHasStrokes] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');

  function pointFromEvent(e) {
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const source = e.touches && e.touches.length > 0 ? e.touches[0] : e;
    return { x: source.clientX - rect.left, y: source.clientY - rect.top };
  }

  function startStroke(e) {
    if (value) return; // already confirmed — must Clear before redrawing
    e.preventDefault();
    drawingRef.current = true;
    const ctx = canvasRef.current.getContext('2d');
    const { x, y } = pointFromEvent(e);
    ctx.beginPath();
    ctx.moveTo(x, y);
  }

  function continueStroke(e) {
    if (!drawingRef.current) return;
    e.preventDefault();
    const ctx = canvasRef.current.getContext('2d');
    const { x, y } = pointFromEvent(e);
    ctx.lineTo(x, y);
    ctx.strokeStyle = '#1e293b';
    ctx.lineWidth = 2.2;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.stroke();
    setHasStrokes(true);
  }

  function endStroke() {
    drawingRef.current = false;
  }

  function clear() {
    const canvas = canvasRef.current;
    canvas.getContext('2d').clearRect(0, 0, canvas.width, canvas.height);
    setHasStrokes(false);
    setError('');
    onChange(null);
  }

  function confirmSignature() {
    if (!hasStrokes) {
      setError(t('signaturePad.required'));
      return;
    }
    setError('');
    setUploading(true);
    canvasRef.current.toBlob(async (blob) => {
      try {
        const fd = new FormData();
        fd.append('signature', blob, 'signature.png');
        const { signatureReference } = await api.postForm('/uploads/signature', fd);
        onChange(signatureReference);
      } catch (err) {
        setError(err.message || t('common.somethingWentWrong'));
      } finally {
        setUploading(false);
      }
    }, 'image/png');
  }

  return (
    <div className="mb-2 rounded-md border border-dashed border-slate-300 p-4">
      <p className="mb-2 text-sm font-medium text-slate-700">{t('signaturePad.label')}</p>
      <p className="mb-2 text-xs text-slate-500">{t('signaturePad.hint')}</p>
      <canvas
        ref={canvasRef}
        width={400}
        height={140}
        className="mx-auto block w-full max-w-sm touch-none rounded border border-slate-300 bg-white"
        style={{ touchAction: 'none' }}
        onMouseDown={startStroke}
        onMouseMove={continueStroke}
        onMouseUp={endStroke}
        onMouseLeave={endStroke}
        onTouchStart={startStroke}
        onTouchMove={continueStroke}
        onTouchEnd={endStroke}
      />
      <div className="mt-3 flex items-center justify-center gap-3">
        <button type="button" className="btn-secondary !py-1 !text-xs" onClick={clear}>{t('signaturePad.clear')}</button>
        {value ? (
          <p className="text-sm text-gov-green">✓ {t('signaturePad.captured')}</p>
        ) : (
          <button type="button" className="btn-primary !py-1 !text-xs" disabled={!hasStrokes || uploading} onClick={confirmSignature}>
            {uploading ? t('common.loading') : t('signaturePad.confirm')}
          </button>
        )}
      </div>
      {error && <p className="mt-2 text-center text-sm text-gov-red" role="alert">⚠ {error}</p>}
    </div>
  );
}