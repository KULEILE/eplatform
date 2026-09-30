/** Generates human-readable application/document reference numbers, e.g. "BR-2026-483920". */
function generateReference(prefix) {
  const year = new Date().getFullYear();
  const suffix = String(Math.floor(Math.random() * 900000) + 100000);
  return `${prefix}-${year}-${suffix}`;
}

module.exports = { generateReference };
