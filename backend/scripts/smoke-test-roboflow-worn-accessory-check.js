// Smoke test for backend/src/utils/roboflowWornAccessoryCheck.js — runs the real function
// against one real image and asserts the expected output keys exist. Not a test-framework test
// (this project has no jest/mocha configured — see backend/package.json) — a plain Node script,
// matching the style of database/run-migrations.js and database/seed/seed.js.
//
// USAGE:
//   cd backend
//   cp .env.example .env   # if you haven't already; set ROBOFLOW_API_KEY (app.roboflow.com/settings/api)
//   node scripts/smoke-test-roboflow-worn-accessory-check.js /path/to/a/real/id-style/photo.jpg
//
// Exits non-zero (and prints what went wrong) on any failure, so it's safe to use as a one-line
// "did I wire this up correctly" check before trusting the integration with real traffic.

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { checkWornAccessories, RoboflowWornAccessoryCheckError } = require('../src/utils/roboflowWornAccessoryCheck');

const EXPECTED_KEYS = [
  'review_status',
  'face_count',
  'ignored_accessory_count',
  'worn_predictions',
  'obstruction_predictions',
  'raw_predictions',
  'raw_obstructions',
  'face_predictions',
  'output_image',
];

const KNOWN_REVIEW_STATUSES = new Set([
  'no_detected_worn_accessory_or_face_obstruction',
  'needs_review_worn_accessory',
  'needs_review_face_obstruction',
  'needs_manual_review_unassociated_obstruction',
  'needs_manual_review_face_count',
]);

async function main() {
  const imagePath = process.argv[2];
  if (!imagePath) {
    console.error('Usage: node scripts/smoke-test-roboflow-worn-accessory-check.js <path-to-image.jpg>');
    process.exitCode = 1;
    return;
  }
  const resolvedPath = path.resolve(imagePath);
  if (!fs.existsSync(resolvedPath)) {
    console.error(`No such file: ${resolvedPath}`);
    process.exitCode = 1;
    return;
  }

  const imageBuffer = fs.readFileSync(resolvedPath);
  console.log(`Calling the ID Photo Worn Accessory Review workflow on ${resolvedPath} (${imageBuffer.length} bytes)...`);

  let result;
  try {
    result = await checkWornAccessories(imageBuffer);
  } catch (err) {
    if (err instanceof RoboflowWornAccessoryCheckError) {
      console.error(`FAILED — ${err.name}: ${err.message}`);
      if (err.status) console.error(`  HTTP status: ${err.status}`);
    } else {
      console.error('FAILED — unexpected error (not RoboflowWornAccessoryCheckError):', err);
    }
    process.exitCode = 1;
    return;
  }

  const missingKeys = EXPECTED_KEYS.filter((key) => !(key in result));
  if (missingKeys.length > 0) {
    console.error(`FAILED — response is missing expected key(s): ${missingKeys.join(', ')}`);
    console.error('Full response:', JSON.stringify(result, null, 2));
    process.exitCode = 1;
    return;
  }

  if (!KNOWN_REVIEW_STATUSES.has(result.review_status)) {
    console.error(`FAILED — unrecognized review_status: "${result.review_status}" (expected one of: ${[...KNOWN_REVIEW_STATUSES].join(', ')})`);
    process.exitCode = 1;
    return;
  }

  console.log('PASSED — all expected keys present, review_status recognized.');
  console.log(`  review_status: ${result.review_status}`);
  console.log(`  face_count: ${result.face_count}`);
  console.log(`  worn_predictions: ${result.worn_predictions.predictions.length} box(es)`);
  console.log(`  obstruction_predictions: ${result.obstruction_predictions.predictions.length} box(es)`);
  console.log(`  ignored_accessory_count: ${result.ignored_accessory_count}`);
  console.log('  output_image: present, base64 length', result.output_image.length);
}

main();
