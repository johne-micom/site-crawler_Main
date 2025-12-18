const express = require('express');
const bodyParser = require('body-parser');
const { crawlSite } = require('./crawler');

const app = express();
app.use(bodyParser.json());

app.post('/crawl', async (req, res) => {
  const { base_url, max_depth } = req.body;
  if (!base_url || !max_depth) {
    return res.status(400).json({ error: 'base_url and max_depth are required' });
  }
  try {
    const siteModel = await crawlSite(base_url, max_depth);
    res.json(siteModel);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Crawling failed', details: err.message });
  }
});


const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Crawler API running on port ${PORT}`));


