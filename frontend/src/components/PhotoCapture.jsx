import React, { useRef, useState } from 'react';
import { useLanguage } from '../context/LanguageContext';
import { api } from '../api/client';
// Dynamically imported (see runComplianceCheck) rather than a static import at the top of the
// file: this module pulls in @vladmandic/face-api, which bundles TensorFlow.js (~1.4MB). A
// static import here would put that weight in the main app bundle, loaded on every single page —
// login, dashboard, everything — even though only a handful of face-photo fields ever need it.
// A dynamic import() lets the bundler split it into its own chunk, fetched only when a citizen
// actually selects a photo on a faceCheck-enabled field.

const MAX_BYTES = 5 * 1024 * 1024; // 5MB — matches backend/src/middleware/upload.js's uploadPhoto limit
const ACCEPTED_TYPES = ['image/png', 'image/jpeg', 'image/webp'];

/**
 * Replaces the old "Simulate photo capture" button on the National ID and Passport application
 * forms with a real photo upload: the citizen picks an image (camera roll or a live camera photo
 * on mobile, via capture="user"), it's uploaded immediately to POST /api/uploads/photo, and the
 * returned reference is what the form eventually submits as photoReference — exactly the same
 * field the backend already expected, just backed by a real image now instead of a fake string.
 *
 * Controlled component: value = photoReference (string|null), onChange(photoReference|null).
 *
 * `faceCheck`: set this on real ID-style face photos (National ID, passport, driving licence/
 * permit photos) — NOT on document scans (ownership proof, insurance proof, receipts), which
 * legitimately contain no face. When set, a selected image is run through a client-side face
 * check (see utils/faceCheck.js) before it's accepted/uploaded: it must show exactly one
 * reasonably-centered, reasonably-sized face, against a background that isn't obviously busy. A
 * photo that fails is rejected with a specific reason so the citizen can retake it, rather than
 * being silently accepted and only caught later by an officer.
 */
export default function PhotoCapture({ value, onChange, label, help, faceCheck = false }) {
  const { t } = useLanguage();
  const [preview, setPreview] = useState(null); // local object URL, shown while/just after uploading
  const [uploading, setUploading] = useState(false);
  const [checking, setChecking] = useState(false); // running the client-side face/background check
  const [error, setError] = useState('');
  const inputRef = useRef(null);

  function runComplianceCheck(objectUrl) {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = async () => {
        try {
          const { checkPhotoCompliance } = await import('../utils/faceCheck');
          resolve(await checkPhotoCompliance(img));
        } catch {
          resolve({ ok: true, skipped: true }); // fail open — never block on an infra hiccup
        }
      };
      img.onerror = () => resolve({ ok: true, skipped: true });
      img.src = objectUrl;
    });
  }

  async function onFileSelected(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setError('');
    if (!ACCEPTED_TYPES.includes(file.type)) {
      setError(t('photoCapture.wrongType'));
      return;
    }
    if (file.size > MAX_BYTES) {
      setError(t('photoCapture.tooLarge'));
      return;
    }

    const objectUrl = URL.createObjectURL(file);

    if (faceCheck) {
      setChecking(true);
      const result = await runComplianceCheck(objectUrl);
      setChecking(false);
      if (!result.ok) {
        setError(t(`photoCapture.${result.reason}`));
        URL.revokeObjectURL(objectUrl);
        if (inputRef.current) inputRef.current.value = '';
        return;
      }
    }

    setPreview(objectUrl);
    setUploading(true);
    const fd = new FormData();
    fd.append('photo', file);
    try {
      const { photoReference } = await api.postForm('/uploads/photo', fd);
      onChange(photoReference);
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
      <p className="mb-2 text-sm font-medium text-slate-700">{label || t('photoCapture.label')}</p>
      {help && <p className="mb-2 text-xs text-slate-500">{help}</p>}

      {displaySrc ? (
        <div className="flex flex-col items-center gap-2">
          <img src={displaySrc} alt={t('photoCapture.previewAlt')} className="h-32 w-28 rounded border border-slate-200 object-cover" />
          {uploading ? (
            <p className="text-sm text-slate-500">{t('common.loading')}</p>
          ) : value ? (
            <>
              <p className="text-sm text-gov-green">✓ {t('photoCapture.uploaded')}</p>
              <button type="button" className="btn-secondary !py-1 !text-xs" onClick={retake}>{t('photoCapture.retake')}</button>
            </>
          ) : null}
        </div>
      ) : checking ? (
        <p className="text-sm text-slate-500">{t('photoCapture.checking')}</p>
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
          <p className="mt-2 text-xs text-slate-400">{t('photoCapture.hint')}</p>
        </>
      )}
      {error && <p className="mt-2 text-sm text-gov-red" role="alert">⚠ {error}</p>}
    </div>
  );
}
