const express = require('express');
const cors = require('cors');
const { scrapeWebsite } = require('./scraper');
const { downloadZip } = require('./utils');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static('public')); // ← add this line here


app.post('/scrape', async (req, res) => {
  try {
    const { url } = req.body;

    if (!url) {
      return res.status(400).json({ error: 'URL required' });
    }

    const images = await scrapeWebsite(url);

    res.json({
      count: images.length,
      images
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Scraping failed' });
  }
});

app.post('/download', async (req, res) => {
  try {
    const { images } = req.body;
    await downloadZip(images, res);
  } catch (err) {
    res.status(500).json({ error: 'Download failed' });
  }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, "0.0.0.0", () => {
  console.log(`Server running on ${PORT}`);
});
