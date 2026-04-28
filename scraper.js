const axios = require('axios');
const cheerio = require('cheerio');
const { chromium } = require('playwright-extra');
const stealth = require('puppeteer-extra-plugin-stealth')();
chromium.use(stealth);

/* -----------------------------
   CLEAN URL (Raw Master File Bypass)
----------------------------- */
function cleanUrl(url) {
  if (!url) return null;
  let cleaned = url.split('?')[0]; 
  cleaned = cleaned.replace(/\/s\d+x\d+\//g, '/')
                   .replace(/\/s\d+\//g, '/')
                   .replace(/\/(w|h|width|height|fit|crop|auto)_\d+\//ig, '/')
                   .replace(/_thumb|_small|_sq/g, '');
  return cleaned;
}

/* -----------------------------
   STATIC SCRAPER
----------------------------- */
async function scrapeStatic(url) {
  try {
    const { data } = await axios.get(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }
    });
    const $ = cheerio.load(data);
    let results = [];
    $('img').each((i, el) => {
      let src = $(el).attr('src') || $(el).attr('data-src') || $(el).attr('data-original');
      if ($(el).attr('srcset')) {
        const parts = $(el).attr('srcset').split(',');
        src = parts[parts.length - 1].trim().split(' ')[0];
      }
      src = cleanUrl(src);
      if (src && src.startsWith('http')) results.push({ src, name: $(el).attr('alt') || '' });
    });
    return results;
  } catch (e) { return []; }
}

/* -----------------------------
   DYNAMIC SCRAPER
----------------------------- */
async function scrapeDynamic(url) {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    viewport: { width: 2560, height: 1440 },
    deviceScaleFactor: 2 
  });
  const page = await context.newPage();
  const imageSet = new Set();

  page.on('response', async (response) => {
    try {
      const resUrl = response.url();
      const type = response.headers()['content-type'] || '';
      if (type.includes('image')) imageSet.add(cleanUrl(resUrl));
    } catch (e) {}
  });

  try {
    try { await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 }); } 
    catch (e) {}
    await page.waitForTimeout(5000);
    await page.evaluate(async () => {
      for (let i = 0; i < 8; i++) {
        window.scrollBy(0, window.innerHeight);
        await new Promise(r => setTimeout(r, 1200));
      }
    });

    let domImages = [];
    for (const frame of page.frames()) {
      try {
        const frameImages = await frame.evaluate(() => {
          function clean(url) {
            if (!url) return null;
            return url.split('?')[0].replace(/\/s\d+x\d+\//g, '/').replace(/\/s\d+\//g, '/');
          }
          function getBest(img) {
            const master = img.getAttribute('data-image-url') || img.getAttribute('data-src-full') || img.getAttribute('data-zoom-src');
            if (master) return clean(master);
            return clean(img.src);
          }
          function findName(img) {
            if (img.alt && img.alt.length > 2 && !img.alt.match(/image|logo|placeholder/i)) return img.alt.trim();
            const container = img.closest('article, li, .item, .menu-item, .product, .card');
            if (container) {
              const header = container.querySelector('h1, h2, h3, h4, h5, h6, .name, .title');
              if (header) return header.innerText.split('\n')[0].trim();
            }
            let current = img.parentElement;
            for (let i = 0; i < 4; i++) {
              if (!current) break;
              const lines = current.innerText.split('\n').map(t => t.trim()).filter(t => t.length > 2 && t.length < 50 && !t.match(/^\$/));
              if (lines.length > 0) return lines[0];
              current = current.parentElement;
            }
            return '';
          }
          let results = [];
          document.querySelectorAll('img').forEach(img => {
            const src = getBest(img);
            if (src) results.push({ src, name: findName(img) });
          });
          return results;
        });
        domImages = [...domImages, ...frameImages];
      } catch (e) {}
    }
    await browser.close();
    const networkImages = Array.from(imageSet).map(src => {
      let name = '';
      let filename = src.split('/').pop().split('.')[0];
      if (filename.length > 3 && !filename.match(/\d{5,}/)) {
          name = filename.replace(/[-_]/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
      }
      return { src, name };
    });
    return [...domImages, ...networkImages];
  } catch (err) {
    await browser.close();
    return [];
  }
}

async function scrapeWebsite(url) {
  let images = await scrapeStatic(url);
  if (images.length < 10) images = await scrapeDynamic(url);
  const fingerprintMap = new Map();

  // Keyword Blacklist
  const blacklist = ['visa', 'mastercard', 'amex', 'discover', 'applepay', 'googlepay', 'cashapp', 'logo', 'icon', 'button', 'banner', 'social'];

  images.forEach(img => {
    if (!img.src || img.src.startsWith('data:')) return;
    const urlLower = img.src.toLowerCase();
    if (blacklist.some(word => urlLower.includes(word))) return;

    const fingerprint = img.src.split('/').pop().replace(/\.(jpg|jpeg|png|webp)/i, '').replace(/-\d+x\d+$/i, '');
    if (!fingerprintMap.has(fingerprint)) {
      fingerprintMap.set(fingerprint, img);
    } else {
      const existing = fingerprintMap.get(fingerprint);
      if ((!existing.name || existing.name === 'No name') && img.name) {
        fingerprintMap.set(fingerprint, img);
      }
    }
  });
  return Array.from(fingerprintMap.values());
}

module.exports = { scrapeWebsite };