const express = require('express');
const cors = require('cors');
const axios = require('axios');
const { scrapeWebsite } = require('./scraper');
const { downloadZip } = require('./utils');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

/* ─────────────────────────────────────
   SCRAPE ENDPOINT
───────────────────────────────────── */
app.post('/scrape', async (req, res) => {
  try {
    const { url } = req.body;
    if (!url) return res.status(400).json({ error: 'URL required' });

    const images = await scrapeWebsite(url);
    res.json({ count: images.length, images });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Scraping failed' });
  }
});

/* ─────────────────────────────────────
   DOWNLOAD ENDPOINT
───────────────────────────────────── */
app.post('/download', async (req, res) => {
  try {
    const { images } = req.body;
    await downloadZip(images, res);
  } catch (err) {
    res.status(500).json({ error: 'Download failed' });
  }
});

/* ─────────────────────────────────────
   IMAGE PROXY ENDPOINT  (NEW)
   Fixes blank images in frontend preview.
   Restaurants block direct hotlinking —
   this proxies through your server so the
   browser sees YOUR domain, not theirs.

   Usage: GET /proxy?url=https://...
───────────────────────────────────── */
app.get('/proxy', async (req, res) => {
  const { url } = req.query;

  if (!url) return res.status(400).send('url param required');

  // Basic validation — only allow http/https image URLs
  if (!url.startsWith('http')) return res.status(400).send('Invalid URL');
  if (!url.match(/\.(jpg|jpeg|png|webp|gif)/i) &&
      !url.match(/image|photo|thumb|cdn/i)) {
    return res.status(400).send('Not an image URL');
  }

  try {
    let referer = '';
    try {
      const urlObj = new URL(url);
      referer = `${urlObj.protocol}//${urlObj.hostname}/`;
    } catch {}

    const response = await axios.get(url, {
      responseType: 'arraybuffer',
      timeout: 15000,
      maxRedirects: 5,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36',
        'Accept': 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Referer': referer,
        'sec-fetch-dest': 'image',
        'sec-fetch-mode': 'no-cors',
        'sec-fetch-site': 'cross-site',
      }
    });

    const contentType = response.headers['content-type'] || 'image/jpeg';
    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.send(Buffer.from(response.data));

  } catch (err) {
    console.error('Proxy failed:', err.message);
    res.status(502).send('Could not fetch image');
  }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, "0.0.0.0", () => {
  console.log(`Server running on port ${PORT}`);
});
