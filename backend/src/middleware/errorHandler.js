// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  console.error(err);
  if (err && err.code === '23505') {
    return res.status(409).json({ error: 'A record with that value already exists.' });
  }
  if (err && err.code === '23503') {
    return res.status(400).json({ error: 'Related record not found (foreign key violation).' });
  }
  const status = err.status || 500;
  res.status(status).json({ error: err.message || 'Unexpected server error.' });
}

module.exports = errorHandler;
