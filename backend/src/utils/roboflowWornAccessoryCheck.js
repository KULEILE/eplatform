// Server-side client for the "ID Photo Worn Accessory Review" Roboflow Workflow — the sole,
// authoritative detector for hats/caps/eyewear/face obstructions on ID-style photos. It replaced
// an earlier client-side hat check (frontend/src/utils/hatCheck.js, a tiny on-device ONNX
// classifier, PINTO0309/HHC) that has since been deleted from this repo entirely — it proved
// unreliable on real citizen photos, misreading multiple different real bare-headed photos as
// "wearing a hat" regardless of how the crop around the head was tuned. This Roboflow Workflow
// takes a different, more robust approach: it
// runs real object detection for hats/caps/eyeglasses AND for face obstructions (masks, scarves,
// hands, hair covering the face), finds the single face in the photo, and only flags an
// accessory as "worn" if its bounding box actually overlaps that face's region — not a
// whole-image "does this feel hat-like" classification, which is exactly the failure mode that
// broke hatCheck.js. It also never gives a blunt binary reject: it returns a review_status
// string (see below) that distinguishes "clearly fine", "needs a human to look", and "multiple
// faces / no face found", so a wrong call doesn't have to mean an outright rejection.
//
// GROUNDED, NOT GUESSED: this module's request shape and the fields read off the response were
// checked directly against the real deployed workflow before writing this file — via the
// Roboflow MCP server's workflows_get (to read the workflow's real step graph and declared
// outputs) and workflows_run (to execute it against a real previously-reported citizen photo —
// the same bare-headed photo that broke hatCheck.js — and inspect the actual response). That
// real run correctly returned review_status "no_detected_worn_accessory_or_face_obstruction"
// with an empty worn_predictions list, face_count 1 — i.e. it got right the exact case that
// hatCheck.js got wrong.
//
// ONE GENUINE GAP IN THAT GROUNDING, DISCLOSED RATHER THAN PAPERED OVER: the MCP workflows_run
// tool wraps its result as `{ "result": [ ... ] }`. This file instead calls the raw HTTPS
// endpoint directly (POST .../workflows/<id>), per the integration spec this was built against,
// and Roboflow's published docs describe that raw endpoint's envelope as `{ "outputs": [ ... ] }`
// — but a live call to the raw REST endpoint could not be made from this build environment (its
// network egress does not allow serverless.roboflow.com; only the MCP tool path was reachable).
// So parseWorkflowEntry() below is deliberately defensive about the outer envelope key (tries
// "outputs", "result", "predictions", and a bare top-level array) and throws a clear, typed error
// naming exactly what it received if none match, rather than silently misreading a shape this
// could not verify end-to-end. Run the smoke test (scripts/smoke-test-roboflow-worn-accessory-
// check.js) once against your real deployment key — if it fails on the envelope shape, the error
// message tells you exactly which key the real response used, and this parser should be a
// one-line fix.
//
// THE ONE-TIME HONEST TRADEOFF THIS MAKES: unlike the old on-device check (free, fully local,
// nothing ever leaves the citizen's browser), this sends the citizen's actual uploaded photo to
// Roboflow's hosted cloud for inference. That's a real data-sharing decision for government
// ID-style photos, made deliberately here at your request rather than silently — see this
// project's chat history for the fuller discussion of that tradeoff. This file enforces that the
// call only ever happens server-side: the API key is read from an environment variable
// (ROBOFLOW_API_KEY — see backend/.env.example) and is never sent to, or readable by, the
// frontend.
//
// review_status is one of (from the workflow's own custom Worn_Accessory_Check code block):
//   - "no_detected_worn_accessory_or_face_obstruction" — clean photo, nothing flagged
//   - "needs_review_worn_accessory"                    — a hat/cap/glasses box overlaps the face
//   - "needs_review_face_obstruction"                  — a mask/scarf/hand/hair box overlaps the face
//   - "needs_manual_review_unassociated_obstruction"   — an obstruction-looking box exists but
//                                                         isn't clearly tied to the one face
//   - "needs_manual_review_face_count"                 — zero or more than one face detected
// The Workflow's own role is detection + routing, not the accept/reject decision — but THIS
// application treats every one of these as a hard rejection, unconditionally (see
// classifyWornAccessoryResult below): no self-declaration or override can get a flagged photo
// through. That is a deliberate choice made for this project, not an inherent property of the
// Workflow itself — a different integration could legitimately route "needs_manual_review_*"
// statuses to a human queue instead of an automatic reject.

const ROBOFLOW_API_URL = 'https://serverless.roboflow.com';
const WORKSPACE_NAME = 'samarelis-workspace';
const WORKFLOW_ID = 'id-photo-worn-accessory-review-1792464255686';

const DEFAULT_TIMEOUT_MS = 15000;
const DEFAULT_RETRIES = 2; // total attempts = 1 + DEFAULT_RETRIES, only for timeouts/429/5xx

class RoboflowWornAccessoryCheckError extends Error {
  constructor(message, { status, retriable = false, cause } = {}) {
    super(message);
    this.name = 'RoboflowWornAccessoryCheckError';
    this.status = status; // HTTP status, when the failure came from a response (undefined otherwise)
    this.retriable = retriable;
    if (cause) this.cause = cause;
  }
}

function sleep(ms) {
  return new Promise((resolve) => { setTimeout(resolve, ms); });
}

// Defensive on purpose — see this file's header for why the exact envelope key wasn't verified
// end-to-end against the raw REST endpoint.
function parseWorkflowEntry(json) {
  const candidates = [json?.outputs, json?.result, json?.predictions, Array.isArray(json) ? json : null];
  const list = candidates.find((c) => Array.isArray(c) && c.length > 0);
  if (!list) {
    throw new RoboflowWornAccessoryCheckError(
      `Roboflow response had no recognizable result list. Top-level keys: ${Object.keys(json || {}).join(', ') || '(none)'}. `
      + 'If this is a real response shape just not one this parser expects yet, update parseWorkflowEntry() in this file.',
      { retriable: false },
    );
  }
  return list[0];
}

/**
 * Calls the real "ID Photo Worn Accessory Review" Roboflow Workflow on one image. Server-side
 * only — never call this from frontend code (the API key must never reach the browser).
 *
 * @param {Buffer} imageBuffer - raw photo bytes (JPEG/PNG), e.g. multer's req.file.buffer.
 * @param {{ timeoutMs?: number, retries?: number }} [options]
 * @returns {Promise<{
 *   review_status: string,
 *   face_count: number,
 *   ignored_accessory_count: number,
 *   worn_predictions: { image: { width: number|null, height: number|null }, predictions: object[] },
 *   obstruction_predictions: { image: { width: number|null, height: number|null }, predictions: object[] },
 *   raw_predictions: { image: { width: number, height: number }, predictions: object[] },
 *   raw_obstructions: { image: { width: number, height: number }, predictions: object[] },
 *   face_predictions: { image: { width: number, height: number }, predictions: object[] },
 *   output_image: string,
 * }>} the workflow's real output fields, grounded against a live run (see file header) — the
 *   exact shape above, including output_image being a base64 JPEG string, not a data: URL.
 * @throws {RoboflowWornAccessoryCheckError}
 */
async function checkWornAccessories(imageBuffer, options = {}) {
  const apiKey = process.env.ROBOFLOW_API_KEY;
  if (!apiKey) {
    throw new RoboflowWornAccessoryCheckError(
      'ROBOFLOW_API_KEY is not set. Add it to backend/.env (get a key at app.roboflow.com/settings/api) — see backend/.env.example.',
      { retriable: false },
    );
  }
  if (!Buffer.isBuffer(imageBuffer) || imageBuffer.length === 0) {
    throw new RoboflowWornAccessoryCheckError('imageBuffer must be a non-empty Buffer.', { retriable: false });
  }

  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxRetries = options.retries ?? DEFAULT_RETRIES;
  const url = `${ROBOFLOW_API_URL}/${WORKSPACE_NAME}/workflows/${WORKFLOW_ID}`;
  const body = JSON.stringify({
    inputs: { image: { type: 'base64', value: imageBuffer.toString('base64') } },
  });

  let lastError;
  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      // eslint-disable-next-line no-await-in-loop
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          // Header auth (inference v1.5.0+), per this integration's spec — never the query
          // string or request body, so the key never ends up in logs or URLs.
          Authorization: `Bearer ${apiKey}`,
        },
        body,
        signal: controller.signal,
      });
      clearTimeout(timer);

      if (!response.ok) {
        // eslint-disable-next-line no-await-in-loop
        const bodyText = await response.text().catch(() => '');
        const retriable = response.status === 429 || response.status >= 500;
        const err = new RoboflowWornAccessoryCheckError(
          `Roboflow request failed with HTTP ${response.status}: ${bodyText.slice(0, 300)}`,
          { status: response.status, retriable },
        );
        if (retriable && attempt < maxRetries) {
          lastError = err;
          // eslint-disable-next-line no-await-in-loop
          await sleep(2 ** attempt * 500);
          continue;
        }
        throw err;
      }

      // eslint-disable-next-line no-await-in-loop
      const json = await response.json();
      return parseWorkflowEntry(json);
    } catch (err) {
      clearTimeout(timer);
      if (err instanceof RoboflowWornAccessoryCheckError) throw err;
      const timedOut = err.name === 'AbortError';
      const wrapped = new RoboflowWornAccessoryCheckError(
        timedOut ? `Roboflow request timed out after ${timeoutMs}ms.` : `Roboflow request failed: ${err.message}`,
        { retriable: true, cause: err },
      );
      if (attempt < maxRetries) {
        lastError = wrapped;
        // eslint-disable-next-line no-await-in-loop
        await sleep(2 ** attempt * 500);
        continue;
      }
      throw wrapped;
    }
  }
  // Unreachable in practice (the loop always returns or throws), but keeps the function's return
  // type honest if maxRetries is ever passed as a negative number.
  throw lastError || new RoboflowWornAccessoryCheckError('Roboflow request failed for an unknown reason.', { retriable: false });
}

// Two separate class groups purely so the rejection message/reason can name what was actually
// found (hat vs eyewear) — neither one gets any kind of override; both are rejected outright.
const HEAD_COVERING_CLASSES = new Set(['hat', 'cap']);
const EYEWEAR_CLASSES = new Set(['eyeglasses', 'glasses', 'sunglasses']);

function predictedClassNames(predictionGroup) {
  return (predictionGroup?.predictions || []).map((p) => String(p?.class || '').toLowerCase().trim());
}

/**
 * Turns one checkWornAccessories() result into an accept/reject decision for
 * uploads.controller.js. Returns null to accept the photo, or { reason, message } to reject it —
 * `reason` is a key PhotoCapture.jsx looks up via t(`photoCapture.${reason}`) for the citizen-
 * facing (bilingual) message; `message` is the plain-English text sent back in the HTTP response
 * body, for API consumers that aren't the bilingual frontend.
 *
 * NO OVERRIDES: this used to accept a hat/cap-only result when the citizen had self-declared it
 * as a religious head covering (complianceNote === 'religious_head_covering_declared'). That
 * override has been deliberately removed — a detected hat/cap is now rejected unconditionally,
 * same as eyewear, face obstructions, and a wrong face count. See
 * frontend/src/components/PhotoCapture.jsx's header comment for why (this is now the single,
 * final, non-bypassable gate on worn accessories — no self-declaration can get past it).
 *
 * review_status values this switches on are the workflow's own (see this file's header) — a
 * status this function doesn't recognize is treated as "accept" (fail open) rather than blocking
 * on a verdict shape this hasn't seen before. Note this is a DIFFERENT kind of "open" than the
 * no-override rule above: fail-open here only covers an unrecognized *shape* from Roboflow
 * itself, never a recognized rejection — see uploads.controller.js's own fail-open handling for
 * when the Roboflow call fails entirely (network/outage/misconfiguration), which is the other,
 * separate case where a photo can still get through without a clean verdict.
 */
function classifyWornAccessoryResult(result) {
  const status = result?.review_status;

  if (status === 'needs_manual_review_face_count') {
    return {
      reason: 'faceCount',
      message: "Make sure exactly one person's face is clearly visible in the photo, with nothing else in frame.",
    };
  }

  if (status === 'needs_review_face_obstruction') {
    return {
      reason: 'faceObstruction',
      message: 'Something appears to be covering part of your face (such as a mask, scarf, or hand). Home '
        + "Affairs ID photos must show your full face clearly — please retake it without anything covering your face.",
    };
  }

  if (status === 'needs_manual_review_unassociated_obstruction') {
    return {
      reason: 'unclear',
      message: "We couldn't clearly verify this photo. Please retake it with your full face visible against a plain background.",
    };
  }

  if (status === 'needs_review_worn_accessory') {
    const names = predictedClassNames(result.worn_predictions);
    if (names.some((name) => EYEWEAR_CLASSES.has(name))) {
      return {
        reason: 'glasses',
        message: "Eyeglasses, sunglasses or other eyewear were detected in that photo. Home Affairs ID photos "
          + "can't show eyewear — please remove it and retake the photo.",
      };
    }
    if (names.some((name) => HEAD_COVERING_CLASSES.has(name))) {
      return {
        reason: 'hat',
        message: "A hat or cap was detected in that photo. Home Affairs ID photos can't show headwear of any "
          + 'kind — please remove it and retake the photo.',
      };
    }
    // worn_predictions was non-empty but didn't match a class name this function recognizes —
    // conservative: ask for a retake instead of silently accepting an unrecognized worn item.
    return {
      reason: 'unclear',
      message: "We couldn't clearly verify this photo. Please retake it with your full face visible against a plain background.",
    };
  }

  return null; // "no_detected_worn_accessory_or_face_obstruction" — the clean case
}

module.exports = { checkWornAccessories, classifyWornAccessoryResult, RoboflowWornAccessoryCheckError };
