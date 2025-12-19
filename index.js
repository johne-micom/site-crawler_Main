
const express = require('express');
const { crawlSite } = require('./crawler');

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.get('/', (_req, res) =>
  res.status(200).send('Site Crawler is up. POST /crawl with { "baseurl": "...", "maxdepth": 1 }')
);

app.get('/health', (_req, res) => res.status(200).json({ status: 'ok' }));

app.post('/crawl', async (req, res) => {
  const { baseurl, maxdepth = 1 } = req.body || {};
  if (!baseurl) return res.status(400).json({ error: 'baseurl is required' });

  try {
    const result = await crawlSite(baseurl, maxdepth);
    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Crawling failed', details: err.message });
  }
});

const PORT = process.env.PORT || 3000;  // Render injects PORT (often 10000)
app.listen(PORT, () => console




