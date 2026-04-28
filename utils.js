const axios = require('axios');
const archiver = require('archiver');
const sharp = require('sharp');

async function downloadZip(images, res) {
  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', 'attachment; filename=HD-food-images.zip');
  const archive = archiver('zip', { zlib: { level: 0 } });
  archive.pipe(res);

  const processImage = async (img, index) => {
    try {
      const response = await axios.get(img.src, { responseType: 'arraybuffer', timeout: 15000 });
      const buffer = Buffer.from(response.data);
      if (buffer.length < 10000) return;

      const metadata = await sharp(buffer).metadata();
      if (metadata.width < 200 || metadata.height < 200) return;
      const aspect = metadata.width / metadata.height;
      if (aspect > 3 || aspect < 0.3) return;

      let processed;
      if (metadata.width >= 800 || metadata.height >= 800) {
        processed = buffer;
      } else {
        processed = await sharp(buffer)
          .resize(800, 800, { fit: 'contain', background: '#ffffff' })
          .jpeg({ quality: 90 })
          .toBuffer();
      }
      const ext = metadata.format || 'jpg';
      const safeName = (img.name || `food_${index}`).replace(/[^a-z0-9]/gi, '_').slice(0, 50);
      archive.append(processed, { name: `${safeName}.${ext}` });
    } catch (err) {}
  };

  const chunkSize = 5;
  for (let i = 0; i < images.length; i += chunkSize) {
    const chunk = images.slice(i, i + chunkSize);
    await Promise.all(chunk.map((img, idx) => processImage(img, i + idx)));
  }
  await archive.finalize();
}

module.exports = { downloadZip };