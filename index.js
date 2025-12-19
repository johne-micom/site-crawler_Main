
// index.js — Express server for Site Crawler (CommonJS)
const express = require('express');
const { crawlSite } = require('./crawler');

const app = express();

// Built-in body parsers (no need for body-parser)
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

/**
 * Root route: friendly message + quick instructions
 */
app.get('/', (_req, res) => {
  res
    .status(200)
    .send(
      'Site Crawler is up.<br/>Use <code>POST /crawl</code> with JSON body: ' +
      '<code>{ "baseurl": "https://example.com", "maxdepth": 1 }</code>'
    );
});

/**
 * Health route: for platform probes and quick checks
 */
app.get('/health', (_req, res) => {
  res.status(200).json({ status: 'ok' });
});

/**
 * GET /crawl — helper route for browser visits
 * Shows usage instructions instead of a 404/“Cannot GET /crawl”
 */
app.get('/crawl', (_req, res) => {
  res
    .status(200)
    .send(
      'This endpoint expects a POST with JSON.<br/>' +
      'Example:<br/>' +
      '<pre>curl -X POST https://YOUR-APP.onrender.com/crawl \\\n' +
      '  -H "Content-Type: application/json" \\\n' +
      '  -d \'{"baseurl":"https://example.com","maxdepth":1}\'</pre>'
    );
});

/**
 * POST /crawl — main crawler API
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
    // Perform the crawl (enhanced crawler.js handles depth, extraction, etc.)
    const siteModel = await crawlSite(baseurl, maxdepth);

    // Successful response
    return res.status(200).json(siteModel);
  } catch (err) {
    // Log for diagnostics, return structured error
    console.error('[POST /crawl] error:', err);
    return res.status(500).json({
      error: 'Crawling failed',
      details: err?.message || 'Unknown error'
    });
  }
});

// Bind to Render-provided port// Bind to Render-provided port (fallback for local dev)
const PORT = process.env.PORT || 3000;
