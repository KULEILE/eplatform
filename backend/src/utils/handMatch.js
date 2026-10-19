// Hand-geometry matching — compares the rotation/scale-normalized radial-distance signatures
// produced by frontend/src/utils/handGeometry.js (see that file for how a template is actually
// built; this module only ever sees the finished numbers, never an image).
//
// A template looks like: { signature: number[SIGNATURE_LENGTH] (each 0..1), aspectRatio: number,
// fingerCount: number }.
//
// HONESTY NOTE on scale: searchByHandBiometric (police.controller.js) compares a submitted
// template against EVERY enrolled citizen's stored template in a single request — fine at this
// system's data volume, but a real national-scale deployment would need a pre-filtering/
// indexing strategy (e.g. a coarse first pass on aspectRatio/fingerCount) rather than a full
// scan on every lookup. Not needed here, but worth knowing if this is ever asked about.

const SIGNATURE_LENGTH = 36; // must match frontend/src/utils/handGeometry.js's SIGNATURE_LENGTH
const SHIFT_TOLERANCE = 3; // +/- this many positions (~30 degrees) to tolerate imperfect alignment

function isValidTemplate(t) {
  return !!t && Array.isArray(t.signature) && t.signature.length === SIGNATURE_LENGTH
    && t.signature.every((v) => typeof v === 'number' && Number.isFinite(v))
    && typeof t.aspectRatio === 'number' && Number.isFinite(t.aspectRatio)
    && typeof t.fingerCount === 'number' && Number.isFinite(t.fingerCount);
}

function signatureDistance(a, b, shift) {
  let sum = 0;
  const n = a.length;
  for (let i = 0; i < n; i++) {
    const d = a[i] - b[(i + shift + n) % n];
    sum += d * d;
  }
  return Math.sqrt(sum / n);
}

/** Best alignment distance between two signatures, trying a small range of rotational shifts in
 *  both directions AND a half-turn flip — see handGeometry.js's doc comment on why the
 *  moments-based orientation it normalizes against is only determined up to a 180-degree
 *  ambiguity (a hand "pointing" up vs. down along the same axis measures identically). */
function bestSignatureDistance(a, b) {
  let best = Infinity;
  const n = a.length;
  const half = Math.round(n / 2);
  for (const base of [0, half]) {
    for (let s = -SHIFT_TOLERANCE; s <= SHIFT_TOLERANCE; s++) {
      const d = signatureDistance(a, b, base + s);
      if (d < best) best = d;
    }
  }
  return best;
}

/** 0-100: how alike two hand templates are. Weights were calibrated by hand against this
 *  system's own test captures, not a real biometric dataset — see migration 052's comment and
 *  the delivery README for the honest limits of that calibration. */
function compareTemplates(a, b) {
  if (!isValidTemplate(a) || !isValidTemplate(b)) return 0;
  const sigDist = bestSignatureDistance(a.signature, b.signature); // ~0 (identical) .. ~1 (very different)
  const aspectDiff = Math.abs(a.aspectRatio - b.aspectRatio);
  const fingerDiff = Math.abs(a.fingerCount - b.fingerCount);
  const penalty = sigDist * 70 + aspectDiff * 20 + fingerDiff * 8;
  return Math.max(0, Math.min(100, Math.round(100 - penalty)));
}

/** Best of a citizen's stored left/right templates against one submitted (probe) template — a
 *  Police scan doesn't know in advance which hand was presented. `row` is a DB row carrying
 *  left_hand_template/right_hand_template (already-parsed JSONB objects, or null/undefined). */
function bestScoreForRow(probe, row) {
  let best = 0;
  if (row.left_hand_template && isValidTemplate(row.left_hand_template)) {
    best = Math.max(best, compareTemplates(probe, row.left_hand_template));
  }
  if (row.right_hand_template && isValidTemplate(row.right_hand_template)) {
    best = Math.max(best, compareTemplates(probe, row.right_hand_template));
  }
  return best;
}

module.exports = { SIGNATURE_LENGTH, isValidTemplate, compareTemplates, bestScoreForRow };
