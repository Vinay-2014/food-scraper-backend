const axios = require('axios');
const archiver = require('archiver');
const sharp = require('sharp');

async function downloadZip(images, res) {
  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', 'attachment; filename=HD-food-images.zip');

  let success = 0;
  let failed = 0;

  const downloadImage = async (img, index, attempt = 1) => {
    try {
      let referer = '';
      try {
        const urlObj = new URL(img.src);
        referer = `${urlObj.protocol}//${urlObj.hostname}/`;
      } catch {}

      const response = await axios.get(img.src, {
        responseType: 'arraybuffer',
        timeout: 20000,
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

      let buffer = Buffer.from(response.data);
      if (buffer.length < 2000) return null;

      // ── Skip sharp entirely for mid-size images ──────────
      // Only run sharp if: file might be too small in dimensions
      // OR file is over 10MB and needs compression
      // This avoids running sharp on every single image
      const needsSharp = buffer.length < 200000 || buffer.length > 10 * 1024 * 1024;

      if (needsSharp) {
        const metadata = await sharp(buffer).metadata();

        // Skip images smaller than 320x320
        if (metadata.width < 320 || metadata.height < 320) return null;

        // Compress if over 10MB
        if (buffer.length > 10 * 1024 * 1024) {
          buffer = await sharp(buffer)
            .jpeg({ quality: 80 })
            .toBuffer();
        }
      }
      // ─────────────────────────────────────────────────────

      const extMatch = img.src.match(/\.(jpg|jpeg|png|webp|gif)/i);
      const contentType = response.headers['content-type'] || '';
      const ext = extMatch
        ? extMatch[1].toLowerCase().replace('jpeg', 'jpg')
        : contentType.includes('png') ? 'png'
        : contentType.includes('webp') ? 'webp'
        : 'jpg';

      const safeName = (img.name || 'food')
        .replace(/[^a-z0-9]/gi, '_')
        .slice(0, 40);

      success++;
      return { buffer, name: `${safeName}_${index + 1}.${ext}` };

    } catch (err) {
      if (attempt < 3) {
        await new Promise(r => setTimeout(r, 800 * attempt));
        return downloadImage(img, index, attempt + 1);
      }
      failed++;
      return null;
    }
  };

  /* ─────────────────────────────────────────────────────────
     WORKER POOL — 25 workers run continuously
     
     OLD (chunks): [15 download] → wait for slowest → [next 15]
                    1 slow image holds up 14 others

     NEW (pool):   25 workers each grab the next image the 
                   moment they finish — no idle waiting ever
  ───────────────────────────────────────────────────────── */
  const WORKERS = 25;
  const results = new Array(images.length).fill(null);
  const queue = images.map((img, i) => ({ img, i }));

  const worker = async () => {
    while (queue.length) {
      const { img, i } = queue.shift();
      results[i] = await downloadImage(img, i);
    }
  };

  // Fire all workers at once — they self-feed from the queue
  await Promise.all(Array.from({ length: WORKERS }, worker));

  const finalResults = results.filter(Boolean);

  console.log(`\n✅ Downloaded: ${success} | ❌ Failed: ${failed} | Total: ${images.length}\n`);

  const archive = archiver('zip', { zlib: { level: 0 } });
  archive.pipe(res);
  for (const file of finalResults) {
    archive.append(file.buffer, { name: file.name });
  }
  await archive.finalize();
}

module.exports = { downloadZip };