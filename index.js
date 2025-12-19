
// index.js — Express server for Site Crawler (CommonJS)
const express = require('express');
const { crawlSite } = require('./crawler');

const app = express();

// ---- Temporary crash surfacing (helpful on Render). Remove later if you want. ----
process.on('uncaughtException', err => console.error('[uncaughtException]', err));
process.on('unhandledRejection', reason => console.error('[unhandledRejection]', reason));

// Built-in body parsers (no need for body-parser)
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

/**
 * Root route: quick instructions
 */
app.get('/', (_req, res) => {
  res
    .status(200)
    .send(
      'Site Crawler is up.<br/>' +
      'GET: <code>/crawl?baseurl=https://example.com&maxdepth=1</code><br/>' +
      'POST: <code>/crawl</code> with JSON body ' +
      '<code>{"baseurl":"https://example.com","maxdepth":1}</code>'
    );
});

/**
 * Health route: for platform probes and quick checks
 */
app.get('/health', (_req, res) => {
  res.status(200).json({ status: 'ok' });
});

/**
 * GET /crawl — perform the crawl using query parameters (browser-friendly)
 * Example: /crawl?baseurl=https://example.com&maxdepth=1
 */
app.get('/crawl', async (req, res) => {
  const baseurl = req.query.baseurl;
  const maxdepthRaw = req.query.maxdepth;

  // Validate inputs
  if (!baseurl || typeof baseurl !== 'string') {
    return res.status(400).json({
      error: 'baseurl query parameter is required and must be a string',
      example: '/crawl?baseurl=https://example.com&maxdepth=1'
    });
  }

  const maxdepth = maxdepthRaw !== undefined
    ? parseInt(String(maxdepthRaw), 10)
    : undefined;

  if (maxdepth !== undefined && Number.isNaN(maxdepth)) {
    return res.status(400).json({ error: 'maxdepth, if provided, must be a number' });
  }

  try {
    const siteModel = await crawlSite(baseurl, maxdepth);
    return res.status(200).json(siteModel);
  } catch (err) {
    console.error('[GET /crawl] error:', err);
    return res.status(500).json({ error: 'Crawling failed', details: err?.message || 'Unknown error' });
  }
});

/**
 * POST /crawl — perform the crawl using JSON body
 * Body: { baseurl: string, maxdepth?: number }
 */
app.post('/crawl', async (req, res) => {
  const { baseurl, maxdepth } = req.body || {};

  // Validate inputs
  if (!baseurl || typeof baseurl !== 'string') {
    return res.status(400).json({
      error: 'baseurl is required and must be a string',
      example: { baseurl: 'https://example.com', maxdepth: 1 }
    });
  }
  if (maxdepth !== undefined && typeof maxdepth !== 'number') {
    return res.status(400).json({ error: 'maxdepth, if provided, must be a number' });
  }

  try {
    const siteModel = await crawlSite(baseurl, maxdepth);
    return res.status(200).json(siteModel);
  } catch (err) {
    console.error('[POST /crawl] error:', err);
    return res.status(500).json({
      error: 'Crawling failed',
      details: err?.message || 'Unknown error'
    });
  }
});

// Bind to Render-provided port (fallback for local dev)
const PORT = process.env.PORT || 3000;

app.listen(PORT, function(err){
    if (err) console.log("Error in server setup")
    console.log("Server listening on Port", PORT);
})
