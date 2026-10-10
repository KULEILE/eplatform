import React, { useRef, useState } from 'react';
import { useLanguage } from '../context/LanguageContext';
import { api } from '../api/client';

const MAX_BYTES = 5 * 1024 * 1024; // 5MB — matches backend/src/middleware/upload.js's uploadBiometric limit
const ACCEPTED_TYPES = ['image/png', 'image/jpeg', 'image/webp'];

/**
 * Replaces the old static "will be enrolled automatically during card production" notice on the
 * National ID application form with a real capture step. This prototype has no fingerprint
 * scanner to integrate with, so — the same simplification PhotoCapture.jsx already makes for
 * photo_reference — biometric enrolment is captured as an uploaded image, posted to
 * POST /api/uploads/biometric, and the returned reference is what the form submits as
 * biometricReference. See database/migrations/034_add_biometric_reference.sql.
 *
 * Controlled component: value = biometricReference (string|null), onChange(biometricReference|null).
 */
export default function BiometricCapture({ value, onChange, label, help }) {
  const { t } = useLanguage();
  const [preview, setPreview] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const inputRef = useRef(null);

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
    setUploading(true);
    const fd = new FormData();
    fd.append('biometric', file);
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

  function retake() {
    setPreview(null);
    onChange(null);
    setError('');
    if (inputRef.current) inputRef.current.value = '';
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
      ) : (
        <>
          <input
            ref={inputRef}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            capture="user"
            onChange={onFileSelected}
            className="mx-auto block text-sm text-slate-600"
          />
          <p className="mt-2 text-xs text-slate-400">{t('biometricCapture.captureHint')}</p>
        </>
      )}
      {error && <p className="mt-2 text-sm text-gov-red" role="alert">⚠ {error}</p>}
    </div>
  );
}