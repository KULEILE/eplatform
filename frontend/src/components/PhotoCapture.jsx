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
 * reasonably-centered, reasonably-sized face, facing the camera, against a background that isn't
 * obviously busy. A photo that fails is rejected with a specific reason so the citizen can retake
 * it, rather than being silently accepted and only caught later by an officer.
 *
 * `faceCheck` fields also require the citizen to tick a confirmation checkbox ("no hat, sunglasses
 * or other obstruction") once the photo is uploaded, before the field counts as filled. For
 * GLASSES/other obstructions this is still a self-declaration, not automated detection — there's
 * no credible free way to detect those yet (see faceCheck.js) — but it puts the requirement in
 * front of the citizen explicitly rather than silently accepting a photo that an officer must
 * then reject. A HAT is different and is really, automatically detected (see hatCheck.js): a
 * photo showing one is rejected outright with its own specific reason ('hat'), handled below
 * separately from the generic rejection flow because of the one deliberate exception to it —
 * see religiousHeadCovering below.
 *
 * `faceCheck` fields also show a short instructions screen BEFORE the citizen reaches the camera/
 * file picker (remove hat, sunglasses, headphones; plain background; hold steady), not just the
 * confirmation checkbox after. There's no way to inject anything into the phone's own native
 * camera UI once it opens, so this is a gate screen shown just before that point, with a
 * "continue" action that then reveals the actual input — this is prevention (stop the mistake
 * before it happens), the obstruction checkbox below is self-declaration (confirm it didn't), and
 * the officer reviewing the application is the final real check — three honest, cheap layers,
 * on top of the one real automated check (the hat detector). Shown again every time the citizen
 * goes to pick a new photo (including after a retake), since that's exactly when the reminder
 * matters most.
 *
 * Religious head covering exception: a photo rejected specifically for reason 'hat' isn't
 * discarded like any other rejection — the file is held in `hatFlagged` state and the citizen is
 * offered a second choice instead of only "retake": declare that this is a religious head
 * covering (not fashion headwear) and upload the exact same photo anyway. That declaration is
 * sent to the backend alongside the photo (see uploadFile's complianceNote) and stored durably
 * next to it (see migration 053 and middleware/upload.js), so an officer reviewing the
 * application can see it was self-declared by the citizen — never silently hidden, and never
 * verified by this system either. This mirrors real Home Affairs practice (fashion headwear
 * blocked, a religious covering allowed with the full face still visible — which every other
 * check here still enforces unchanged) rather than blocking every head covering outright.
 */
export default function PhotoCapture({ value, onChange, label, help, faceCheck = false }) {
  const { t } = useLanguage();
  const [preview, setPreview] = useState(null); // local object URL, shown while/just after uploading
  const [uploading, setUploading] = useState(false);
  const [checking, setChecking] = useState(false); // running the client-side face/background check
  const [error, setError] = useState('');
  // When faceCheck is set, an uploaded photo is held here until the citizen ticks the obstruction
  // confirmation checkbox — onChange(photoReference) only fires once both are true, so the field
  // reads as "incomplete" (same as any other required field) until then.
  const [pendingRef, setPendingRef] = useState(null);
  const [confirmed, setConfirmed] = useState(!!value); // a value already on mount (e.g. resubmit prefill) counts as already confirmed
  // Gates the camera/file input behind the instructions screen on faceCheck fields — see the class
  // doc comment above. Irrelevant (never read) on non-faceCheck fields, which go straight to the
  // input as before.
  const [instructionsAcknowledged, setInstructionsAcknowledged] = useState(false);
  // A photo rejected specifically for reason 'hat' is held here (file + its preview object URL)
  // rather than discarded immediately — see the religious-head-covering paragraph in the class
  // doc comment above — so the citizen can declare it's a religious covering and upload this
  // exact photo without needing to pick it again.
  const [hatFlagged, setHatFlagged] = useState(null);
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

  // Shared by the normal accept path and the "upload anyway, it's a religious head covering"
  // override — the only difference between them is whether complianceNote is set.
  async function uploadFile(file, objectUrl, complianceNote) {
    setPreview(objectUrl);
    setUploading(true);
    const fd = new FormData();
    fd.append('photo', file);
    if (complianceNote) fd.append('complianceNote', complianceNote);
    try {
      const { photoReference } = await api.postForm('/uploads/photo', fd);
      if (faceCheck) {
        // Hold it back from the parent form until the citizen confirms below.
        setPendingRef(photoReference);
        setConfirmed(false);
        onChange(null);
      } else {
        onChange(photoReference);
      }
    } catch (err) {
      setError(err.message || t('common.somethingWentWrong'));
      setPreview(null);
      setPendingRef(null);
      onChange(null);
    } finally {
      setUploading(false);
    }
  }

  async function onFileSelected(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setError('');
    setHatFlagged(null);
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
        if (result.reason === 'hat') {
          // Keep the file and preview alive — see the override UI below — instead of the normal
          // discard-and-let-them-retake path.
          setPreview(objectUrl);
          setHatFlagged({ file, objectUrl });
        } else {
          URL.revokeObjectURL(objectUrl);
          if (inputRef.current) inputRef.current.value = '';
        }
        return;
      }
    }

    await uploadFile(file, objectUrl, null);
  }

  function uploadAsReligiousHeadCovering() {
    if (!hatFlagged) return;
    setError('');
    const { file, objectUrl } = hatFlagged;
    setHatFlagged(null);
    uploadFile(file, objectUrl, 'religious_head_covering_declared');
  }

  function discardHatFlagged() {
    if (hatFlagged) URL.revokeObjectURL(hatFlagged.objectUrl);
    setHatFlagged(null);
    setPreview(null);
    setError('');
    if (inputRef.current) inputRef.current.value = '';
  }

  function onConfirmToggle(e) {
    const checked = e.target.checked;
    setConfirmed(checked);
    onChange(checked ? (pendingRef || value) : null);
  }

  function retake() {
    setPreview(null);
    setPendingRef(null);
    setHatFlagged(null);
    setConfirmed(false);
    setInstructionsAcknowledged(false); // show the instructions again — see class doc comment
    onChange(null);
    setError('');
    if (inputRef.current) inputRef.current.value = '';
  }

  const effectiveRef = pendingRef || value;
  const displaySrc = preview || (effectiveRef ? `/uploads/${effectiveRef}` : null);

  return (
    <div className="mb-4 rounded-md border border-dashed border-slate-300 p-4 text-center">
      <p className="mb-2 text-sm font-medium text-slate-700">{label || t('photoCapture.label')}</p>
      {help && <p className="mb-2 text-xs text-slate-500">{help}</p>}

      {displaySrc ? (
        <div className="flex flex-col items-center gap-2">
          <img src={displaySrc} alt={t('photoCapture.previewAlt')} className="h-32 w-28 rounded border border-slate-200 object-cover" />
          {uploading ? (
            <p className="text-sm text-slate-500">{t('common.loading')}</p>
          ) : effectiveRef ? (
            <>
              <p className="text-sm text-gov-green">✓ {t('photoCapture.uploaded')}</p>
              {faceCheck && (
                <label className="flex max-w-xs items-start gap-2 text-left text-xs text-slate-600">
                  <input type="checkbox" className="mt-0.5" checked={confirmed} onChange={onConfirmToggle} />
                  <span>{t('photoCapture.obstructionConfirm')}</span>
                </label>
              )}
              <button type="button" className="btn-secondary !py-1 !text-xs" onClick={retake}>{t('photoCapture.retake')}</button>
            </>
          ) : hatFlagged ? (
            <div className="max-w-xs rounded-md bg-amber-50 p-3 text-left text-xs text-slate-700">
              <p className="mb-2">{t('photoCapture.religiousHeadCoveringNote')}</p>
              <div className="flex flex-col gap-2">
                <button type="button" className="btn-primary !py-1 !text-xs" onClick={uploadAsReligiousHeadCovering}>
                  {t('photoCapture.religiousHeadCoveringConfirm')}
                </button>
                <button type="button" className="btn-secondary !py-1 !text-xs" onClick={discardHatFlagged}>
                  {t('photoCapture.retake')}
                </button>
              </div>
            </div>
          ) : null}
        </div>
      ) : checking ? (
        <p className="text-sm text-slate-500">{t('photoCapture.checking')}</p>
      ) : faceCheck && !instructionsAcknowledged ? (
        <div className="rounded-md bg-amber-50 p-3 text-left text-sm text-slate-700">
          <p className="mb-2 font-semibold text-slate-800">{t('photoCapture.instructions.title')}</p>
          <ul className="mb-3 list-disc space-y-1 pl-4 text-xs">
            <li>{t('photoCapture.instructions.noHat')}</li>
            <li>{t('photoCapture.instructions.noGlasses')}</li>
            <li>{t('photoCapture.instructions.noHeadphones')}</li>
            <li>{t('photoCapture.instructions.lookStraight')}</li>
            <li>{t('photoCapture.instructions.plainBackground')}</li>
            <li>{t('photoCapture.instructions.steady')}</li>
          </ul>
          <button
            type="button"
            className="btn-primary !py-1 !text-xs"
            onClick={() => setInstructionsAcknowledged(true)}
          >
            {t('photoCapture.instructions.continue')}
          </button>
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
          <p className="mt-2 text-xs text-slate-400">{t('photoCapture.hint')}</p>
        </>
      )}
      {error && <p className="mt-2 text-sm text-gov-red" role="alert">⚠ {error}</p>}
    </div>
  );
}
