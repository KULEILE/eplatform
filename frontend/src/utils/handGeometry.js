// Real hand-geometry feature extraction, run entirely client-side on a captured still frame
// (see components/BiometricCapture.jsx and components/HandScan.jsx for where this is actually
// called) — no image or video frame ever needs to leave the browser just to produce the
// numbers this returns.
//
// WHY THIS, AND NOT A FINGERPRINT OR PALM PRINT: an ordinary phone/webcam camera cannot
// resolve fingerprint ridges (roughly 0.3-0.5mm apart; needs near-macro focus and raking light)
// or palm-skin texture reliably. Hand GEOMETRY — the shape of an open hand's silhouette:
// finger lengths/spacing relative to the palm — is the one biometric technique an ordinary
// camera photo can actually, honestly support. It is a real, published biometrics technique
// (hand-geometry recognition), not something invented for this system.
//
// HOW IT WORKS, in order:
//  1. Classify every pixel as skin/not-skin using a standard RGB skin-colour rule.
//  2. Find the skin blob's centroid and its ORIENTATION — the axis the hand is "pointing"
//     along — from the blob's image moments (the same maths used generally in shape analysis
//     to find a shape's major axis). This is what lets two scans of the same hand match even if
//     the hand was held at a different angle each time.
//  3. Walk a ray outward from the centroid at SIGNATURE_LENGTH evenly-spaced angles (measured
//     relative to that axis, not relative to the photo), and record the distance to the edge of
//     the blob along each ray. Fingers show up as peaks in this "radial signature"; the gaps
//     between fingers show up as valleys. Every distance is normalized by the blob's own
//     furthest point, so a hand photographed closer to or further from the camera still
//     produces the same SHAPE of signature.
//  4. A few sanity/quality checks run on the way (no hand found, hand too small/large in frame,
//     fewer than 3 finger-like peaks detected) and are reported back with a specific reason the
//     caller can show the citizen/officer, rather than silently accepting a bad capture — this
//     is the real fix for "it does not scan for real, it only captures an image": a photo that
//     doesn't actually show a recognisable open hand is now REJECTED, not accepted.
//
// HONEST LIMITS: this is a real measurement, genuinely compared against other real
// measurements (see backend/src/utils/handMatch.js) — but it is a simpler, cheaper technique
// than the palm-vein or ridge-based fingerprint systems some national ID systems use dedicated
// scanner hardware for, and its scoring was calibrated by hand against this system's own test
// captures rather than a certified biometric dataset. It is built to reliably tell two clearly
// different hands apart and to recognise the same hand again from a webcam/phone photo, which is
// what this system needs — it is not a claim of forensic-grade accuracy.

export const SIGNATURE_LENGTH = 36; // keep in sync with backend/src/utils/handMatch.js
const WORK_SIZE = 360; // longest side the source image is scaled to before processing

// Standard RGB skin-colour rule (after Kovac, Peer & Solina) — cheap, no model/weights to ship,
// and good enough for "is there a hand-sized patch of skin-coloured pixels here", which is all
// this needs. It is explicitly NOT trying to tell skin tones apart or do anything
// identity-related itself — only the SHAPE extracted afterwards (steps 2-3 above) is ever used
// for matching, never the colour.
function isSkinPixel(r, g, b) {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  return r > 95 && g > 40 && b > 20 && (max - min) > 15 && Math.abs(r - g) > 15 && r > g && r > b;
}

function drawToWorkCanvas(source) {
  const srcW = source.videoWidth || source.naturalWidth || source.width;
  const srcH = source.videoHeight || source.naturalHeight || source.height;
  const scale = WORK_SIZE / Math.max(srcW, srcH);
  const w = Math.max(1, Math.round(srcW * scale));
  const h = Math.max(1, Math.round(srcH * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(source, 0, 0, w, h);
  return { ctx, w, h };
}

/**
 * source: an HTMLImageElement, HTMLVideoElement, or HTMLCanvasElement (already drawn to).
 * Returns { ok: true, template: { signature, aspectRatio, fingerCount } }
 *      or { ok: false, reason: 'noHandDetected' | 'handTooFar' | 'handTooClose' | 'tooFewFingersVisible' }.
 */
export function extractHandFeatures(source) {
  const { ctx, w, h } = drawToWorkCanvas(source);
  const { data } = ctx.getImageData(0, 0, w, h);

  let sumX = 0;
  let sumY = 0;
  let count = 0;
  const mask = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      if (isSkinPixel(data[i], data[i + 1], data[i + 2])) {
        mask[y * w + x] = 1;
        sumX += x;
        sumY += y;
        count += 1;
      }
    }
  }

  const frameArea = w * h;
  if (count < frameArea * 0.015) return { ok: false, reason: 'noHandDetected' };
  if (count < frameArea * 0.05) return { ok: false, reason: 'handTooFar' };
  if (count > frameArea * 0.75) return { ok: false, reason: 'handTooClose' };

  const cx = sumX / count;
  const cy = sumY / count;

  // Orientation from second-order central image moments. Only determined up to a 180-degree
  // ambiguity (a hand pointing "up" vs. "down" along the same axis gives the same line) —
  // backend/src/utils/handMatch.js's comparison tries both rather than this file guessing which
  // end is which.
  let mu20 = 0;
  let mu02 = 0;
  let mu11 = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!mask[y * w + x]) continue;
      const dx = x - cx;
      const dy = y - cy;
      mu20 += dx * dx;
      mu02 += dy * dy;
      mu11 += dx * dy;
    }
  }
  const theta = 0.5 * Math.atan2(2 * mu11, mu20 - mu02);

  // Radial distance signature: walk outward from the centroid, recording the furthest skin
  // pixel found along each ray. A fingertip is narrow — at typical hand proportions it subtends
  // only around 10 degrees as seen from the palm's centroid — so SIGNATURE_LENGTH rays cast one
  // per bucket (10 degrees apart for SIGNATURE_LENGTH=36) can land squarely BETWEEN two
  // fingertips and miss both, even though the finger is right there. To avoid that, several
  // finer rays (SUPERSAMPLE per bucket) are cast across each bucket's angular width and the
  // MAXIMUM of those is kept as that bucket's value — a fingertip is picked up by whichever of
  // the fine rays happens to cross it, without changing SIGNATURE_LENGTH (and so without
  // changing anything about how two signatures are later compared).
  const SUPERSAMPLE = 4;
  const maxRadius = Math.sqrt(w * w + h * h);
  const rawSignature = new Array(SIGNATURE_LENGTH).fill(0);
  for (let k = 0; k < SIGNATURE_LENGTH; k++) {
    let best = 0;
    for (let s = 0; s < SUPERSAMPLE; s++) {
      const angle = theta + (2 * Math.PI * (k * SUPERSAMPLE + s)) / (SIGNATURE_LENGTH * SUPERSAMPLE);
      const dx = Math.cos(angle);
      const dy = Math.sin(angle);
      let r = 0;
      for (let step = 1; step < maxRadius; step++) {
        const x = Math.round(cx + dx * step);
        const y = Math.round(cy + dy * step);
        if (x < 0 || x >= w || y < 0 || y >= h) break;
        if (mask[y * w + x]) r = step;
      }
      if (r > best) best = r;
    }
    rawSignature[k] = best;
  }

  const peakRadius = Math.max(...rawSignature);
  if (peakRadius === 0) return { ok: false, reason: 'noHandDetected' };
  const signature = rawSignature.map((r) => r / peakRadius);

  // Finger-peak count, used both as a quality gate and as a coarse extra matching feature: an
  // open hand shown to the camera should produce several separate HIGH regions in the signature
  // (fingertips, each a few buckets wide near its peak) separated by LOW regions (the gaps
  // between fingers). Counting threshold-crossings (contiguous runs above FINGER_THRESHOLD,
  // wrapping around the circular array) rather than exact point-by-point local maxima is what
  // makes this robust to a fingertip's reading landing on a short plateau across 2-3 adjacent
  // buckets instead of a single isolated sample — a strict "higher than both immediate
  // neighbours" test would otherwise miss a real fingertip for exactly that reason.
  const FINGER_THRESHOLD = 0.65;
  let fingerCount = 0;
  let prevHigh = signature[SIGNATURE_LENGTH - 1] >= FINGER_THRESHOLD;
  for (let k = 0; k < SIGNATURE_LENGTH; k++) {
    const high = signature[k] >= FINGER_THRESHOLD;
    if (high && !prevHigh) fingerCount += 1;
    prevHigh = high;
  }
  if (fingerCount < 3) return { ok: false, reason: 'tooFewFingersVisible' };

  const nonZero = rawSignature.filter((r) => r > 0);
  const minRadius = nonZero.length ? Math.min(...nonZero) : peakRadius;
  const aspectRatio = minRadius > 0 ? peakRadius / minRadius : peakRadius;

  return { ok: true, template: { signature, aspectRatio, fingerCount } };
}
