// Real hat/cap detection for ID-style photos, run entirely client-side — called from
// faceCheck.js's checkPhotoCompliance, never on its own.
//
// This exists because an earlier version of faceCheck.js's header comment said "there's no free,
// reliable way to detect hats/glasses client-side". That was wrong for hats specifically: a real,
// credible, free model for exactly this does exist — PINTO0309/HHC
// (https://github.com/PINTO0309/HHC, MIT-licensed), a tiny binary "is this head wearing a hat"
// classifier, published with its own measured F1 scores (0.92-0.97 across its size variants on
// its own test set) rather than being invented for this project. This file wires the "S" variant
// (495KB, F1 0.95 per its README) in via ONNX Runtime Web, running on-device.
//
// WHAT THIS ACTUALLY COSTS, HONESTLY: the model file itself is tiny, but ONNX Runtime Web's
// WebAssembly engine that runs it is ~11MB (see public/models/ort/) — one-time per device, then
// cached by the browser, and only fetched on a page with a faceCheck-enabled photo field, never
// on every page load. That is still a much bigger download than everything else this app loads
// client-side combined (the face-detection + landmark models below are under 300KB together).
// This was a known, deliberate tradeoff when this was built, not an oversight: if Lesotho's
// mobile data costs make this a real complaint, the fix is converting this same HHC model to run
// on the TensorFlow.js runtime this app already loads for face detection (see
// @vladmandic/face-api) instead of adding a second, separate ML runtime — that conversion was
// attempted and hit real tooling friction (a numpy/tensorflowjs version conflict) and was not
// pursued further for this delivery.
//
// WHAT THE MODEL EXPECTS, AND THE ONE REAL APPROXIMATION HERE: PINTO0309/HHC was trained on head
// crops produced by the author's own dedicated head-detector model, with NO extra margin added
// around them. This project has no such head detector — only face-api's face box and 68-point
// landmarks (see faceCheck.js) — so estimateHeadBox() below approximates the same region: it
// extends up from the eyebrows (toward where a hairline/hat brim would sit — there's no landmark
// that marks the hairline directly, so this is a proportional estimate, not a measurement) and
// down to the chin, with a small side margin. This is an honest approximation of the crop the
// model was trained on, not a guarantee of identical framing, which is part of why this uses the
// model's own published default decision threshold (0.5) rather than a project-tuned one — there
// is no local "known good vs known bad" photo set to calibrate a tighter threshold against, the
// same honesty already applied to MIN_FACE_SHARPNESS and MAX_BACKGROUND_EDGE_GRADIENT elsewhere
// in this file's sibling, faceCheck.js, which WERE tuned against real captures.
//
// Fails OPEN like every check in faceCheck.js: if the WASM runtime or the model can't load, or
// inference throws for any reason, this returns { detected: false, skipped: true } rather than
// blocking a legitimate submission on an infrastructure hiccup.

const ORT_WASM_DIR = '/models/ort/'; // ort-wasm-simd-threaded.{mjs,wasm}, copied from node_modules/onnxruntime-web/dist
const MODEL_URL = '/models/hhc_is_s_48x48.onnx';
const INPUT_SIZE = 48; // fixed by the model — see its ONNX input shape [batch, 3, 48, 48]
const HAT_THRESHOLD = 0.5; // PINTO0309/HHC's own published default (WEARING_HAT_SCORE_THRESHOLD in its demo script)

let runtimePromise = null;

async function loadRuntime() {
  if (!runtimePromise) {
    runtimePromise = (async () => {
      const ort = await import('onnxruntime-web/wasm');
      ort.env.wasm.wasmPaths = ORT_WASM_DIR;
      // This model is tiny and only ever runs on one image at a time — a single worker thread is
      // plenty, and avoids this silently trying (and possibly failing, depending on whether this
      // server sends the COOP/COEP headers SharedArrayBuffer needs) to use multiple threads.
      ort.env.wasm.numThreads = 1;
      const session = await ort.InferenceSession.create(MODEL_URL, { executionProviders: ['wasm'] });
      return { ort, session };
    })().catch((err) => {
      runtimePromise = null; // don't cache a failure forever — allow a retry on the next photo
      throw err;
    });
  }
  return runtimePromise;
}

/**
 * Approximates a head-only crop (eyebrows-to-chin, extended upward for hair/hat, a small side
 * margin) from face-api's face box + 68-point landmarks — see the file header for why this is an
 * approximation of, not identical to, the crop the model was actually trained on.
 *
 * @returns {{x:number,y:number,width:number,height:number}} in SOURCE image pixel coordinates.
 */
function estimateHeadBox(faceBox, landmarks, imgW, imgH) {
  const jaw = landmarks.getJawOutline(); // 17 points: left ear -> chin -> right ear
  const leftBrow = landmarks.getLeftEyeBrow();
  const rightBrow = landmarks.getRightEyeBrow();
  const chinY = jaw[8].y;
  const browTopY = Math.min(...leftBrow.map((p) => p.y), ...rightBrow.map((p) => p.y));
  const browToChin = Math.max(1, chinY - browTopY);

  const top = Math.max(0, browTopY - browToChin * 1.1);
  const bottom = Math.min(imgH, chinY + browToChin * 0.12);
  const jawMinX = Math.min(...jaw.map((p) => p.x));
  const jawMaxX = Math.max(...jaw.map((p) => p.x));
  const left = Math.max(0, jawMinX - faceBox.width * 0.08);
  const right = Math.min(imgW, jawMaxX + faceBox.width * 0.08);

  return { x: left, y: top, width: Math.max(1, right - left), height: Math.max(1, bottom - top) };
}

/**
 * @param {HTMLImageElement} imgEl - an already-loaded (complete) image element.
 * @param {{x:number,y:number,width:number,height:number}} faceBox - detections[0].detection.box
 * @param {object} landmarks - detections[0].landmarks (face-api FaceLandmarks68), required
 * @returns {Promise<{ detected: boolean, confidence: number, skipped?: boolean }>}
 */
export async function detectHat(imgEl, faceBox, landmarks) {
  try {
    if (!landmarks) return { detected: false, confidence: 0, skipped: true };
    const { ort, session } = await loadRuntime();

    const imgW = imgEl.naturalWidth || imgEl.width;
    const imgH = imgEl.naturalHeight || imgEl.height;
    const head = estimateHeadBox(faceBox, landmarks, imgW, imgH);
    if (head.width < 8 || head.height < 8) return { detected: false, confidence: 0, skipped: true };

    const canvas = document.createElement('canvas');
    canvas.width = INPUT_SIZE;
    canvas.height = INPUT_SIZE;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(imgEl, head.x, head.y, head.width, head.height, 0, 0, INPUT_SIZE, INPUT_SIZE);

    let pixels;
    try {
      pixels = ctx.getImageData(0, 0, INPUT_SIZE, INPUT_SIZE).data; // RGBA — canvas data is already RGB-ordered, no BGR swap needed
    } catch {
      return { detected: false, confidence: 0, skipped: true }; // tainted canvas (cross-origin source)
    }

    // NCHW float32 [1, 3, 48, 48], values 0-1, channel order R,G,B — matches PINTO0309/HHC's own
    // preprocessing (resize -> convert to RGB -> divide by 255 -> transpose HWC to CHW), inspected
    // directly from its demo_hhc.py rather than guessed.
    const plane = INPUT_SIZE * INPUT_SIZE;
    const float32 = new Float32Array(3 * plane);
    for (let i = 0; i < plane; i++) {
      float32[i] = pixels[i * 4] / 255;
      float32[i + plane] = pixels[i * 4 + 1] / 255;
      float32[i + plane * 2] = pixels[i * 4 + 2] / 255;
    }

    const inputTensor = new ort.Tensor('float32', float32, [1, 3, INPUT_SIZE, INPUT_SIZE]);
    const results = await session.run({ images: inputTensor });
    // The model's output is a single sigmoid probability per image (NOT two class logits needing
    // softmax — confirmed by inspecting the ONNX graph directly: output name "prob_wearing_hat",
    // shape [batch]). An earlier draft of this integration assumed a 2-class softmax output,
    // which would have been a real bug: softmax over a single value always returns 1.0, which
    // would have made this report "wearing a hat" at 100% confidence on every single photo.
    const hatProb = results.prob_wearing_hat?.data?.[0];
    if (typeof hatProb !== 'number' || !Number.isFinite(hatProb)) {
      return { detected: false, confidence: 0, skipped: true };
    }

    return { detected: hatProb >= HAT_THRESHOLD, confidence: Math.round(hatProb * 100) };
  } catch {
    return { detected: false, confidence: 0, skipped: true };
  }
}
