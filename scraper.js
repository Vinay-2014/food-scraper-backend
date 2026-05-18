const axios = require('axios');
const cheerio = require('cheerio');
const { chromium } = require('playwright');

/* ─────────────────────────────────────
   CLEAN IMAGE URL
───────────────────────────────────── */
function cleanUrl(url) {
  if (!url) return null;
  return url
    .split('?')[0]
    .replace(/-\d+x\d+(\.(jpg|jpeg|png|webp))/i, '$1');
}

/* ─────────────────────────────────────
   VALID TEXT
───────────────────────────────────── */
function isValidName(text) {
  if (!text) return false;
  text = text.trim();
  if (text.length < 2) return false;
  if (text.length > 120) return false;
  if (/^\d+$/.test(text)) return false;
  // Skip generic/useless strings
  const skip = ['image', 'photo', 'picture', 'img', 'thumbnail', 'logo', 'banner', 'icon', 'null', 'undefined', 'true', 'false'];
  if (skip.includes(text.toLowerCase())) return false;
  return true;
}

/* ─────────────────────────────────────
   FIND NAME FROM HTML  (FIXED)
   Now checks: alt, title, aria-label,
   h1-h6, p, span, div with name/title
   classes, and sibling elements
───────────────────────────────────── */
function findName($, img) {
  // 1. Direct image attributes
  const alt = $(img).attr('alt');
  if (isValidName(alt)) return alt.trim();

  const titleAttr = $(img).attr('title');
  if (isValidName(titleAttr)) return titleAttr.trim();

  const ariaLabel = $(img).attr('aria-label');
  if (isValidName(ariaLabel)) return ariaLabel.trim();

  // 2. Walk up parent chain
  let parent = $(img).parent();

  for (let i = 0; i < 8; i++) {
    if (!parent || !parent.length) break;

    // Check headings first
    const heads = parent.children('h1,h2,h3,h4,h5,h6').first();
    if (heads.length) {
      const txt = heads.text().trim();
      if (isValidName(txt)) return txt;
    }

    // Check elements with name/title/dish/label in class or data attributes
    const nameSelectors = [
      '[class*="name"]',
      '[class*="title"]',
      '[class*="dish"]',
      '[class*="item-label"]',
      '[class*="product-name"]',
      '[class*="food-name"]',
      '[class*="menu-item"]',
      '[data-name]',
      '[data-title]',
    ];
    for (const sel of nameSelectors) {
      const el = parent.find(sel).first();
      if (el.length) {
        // Prefer data attributes
        const dataName = el.attr('data-name') || el.attr('data-title');
        if (isValidName(dataName)) return dataName.trim();
        const txt = el.text().trim();
        // Only use if short enough to be a name (not a description)
        if (isValidName(txt) && txt.length < 60) return txt;
      }
    }

    // Check <p> tags (many restaurant sites put name in <p>)
    const p = parent.children('p').first();
    if (p.length) {
      const txt = p.text().trim();
      if (isValidName(txt) && txt.length < 80) return txt;
    }

    // Check <span> tags
    const span = parent.children('span').first();
    if (span.length) {
      const txt = span.text().trim();
      if (isValidName(txt) && txt.length < 80) return txt;
    }

    // Check ANY heading deeper in the subtree (not just direct children)
    const deepHead = parent.find('h1,h2,h3,h4,h5,h6').first();
    if (deepHead.length) {
      const txt = deepHead.text().trim();
      if (isValidName(txt)) return txt;
    }

    parent = parent.parent();
  }

  return '';
}

/* ─────────────────────────────────────
   JSON IMAGE EXTRACTION
───────────────────────────────────── */
function extractFromJson(obj, results) {
  if (!obj) return;

  if (Array.isArray(obj)) {
    obj.forEach(item => extractFromJson(item, results));
    return;
  }

  if (typeof obj === 'object') {
    let foundImage = null;
    let foundName = '';

    const imageKeys = ['image', 'imageurl', 'photo', 'photourl', 'thumbnail', 'heroimage', 'src', 'imageuri', 'imgurl'];

    for (const key in obj) {
      const value = obj[key];
      extractFromJson(value, results);

      if (typeof value === 'string' && value.match(/\.(jpg|jpeg|png|webp|gif)/i)) {
        if (imageKeys.some(k => key.toLowerCase().includes(k))) {
          foundImage = cleanUrl(value);
        }
      }

      if (typeof value === 'string' && value.length > 2 && value.length < 120) {
        if (key.toLowerCase().includes('name') || key.toLowerCase().includes('title')) {
          foundName = value.trim();
        }
      }
    }

    if (foundImage) {
      results.push({ src: foundImage, name: foundName });
    }
  }
}

/* ─────────────────────────────────────
   STATIC SCRAPER
───────────────────────────────────── */
async function scrapeStatic(url) {
  try {
    const { data } = await axios.get(url, {
      timeout: 25000,
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36' }
    });

    const $ = cheerio.load(data);
    const images = [];

    $('img').each((i, el) => {
      let src =
        $(el).attr('src') ||
        $(el).attr('data-src') ||
        $(el).attr('data-lazy-src') ||
        $(el).attr('data-original') ||
        $(el).attr('data-url');

      const srcset = $(el).attr('srcset') || $(el).attr('data-srcset');
      if (srcset) {
        const parts = srcset.split(',');
        src = parts[parts.length - 1].trim().split(' ')[0];
      }

      src = cleanUrl(src);
      if (!src || !src.startsWith('http')) return;
      if (!src.match(/\.(jpg|jpeg|png|webp|gif)/i)) return;

      images.push({ src, name: findName($, el) });
    });

    return images;
  } catch (err) {
    console.log('Static scrape failed:', err.message);
    return [];
  }
}

/* ─────────────────────────────────────
   DYNAMIC SCRAPER
───────────────────────────────────── */
async function scrapeDynamic(url) {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({
    javaScriptEnabled: true,
    viewport: { width: 1440, height: 1200 },
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36'
  });

  const apiImages = [];

  page.on('response', async response => {
    try {
      const responseUrl = response.url();
      if (responseUrl.match(/\.(jpg|jpeg|png|webp|gif)/i)) {
        apiImages.push({ src: cleanUrl(responseUrl), name: '' });
      }

      const type = response.headers()['content-type'] || '';
      if (type.includes('application/json')) {
        const json = await response.json();
        extractFromJson(json, apiImages);
      }
    } catch (err) {}
  });

  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 90000 });
    await page.waitForTimeout(6000);

    await page.evaluate(async () => {
      for (let i = 0; i < 12; i++) {
        window.scrollBy(0, window.innerHeight);
        await new Promise(r => setTimeout(r, 1500));
      }
    });

    await page.waitForTimeout(3000);

    const pageImages = await page.evaluate(() => {
      function clean(url) {
        if (!url) return null;
        return url.split('?')[0].replace(/-\d+x\d+(\.(jpg|jpeg|png|webp))/i, '$1');
      }

      function valid(text) {
        if (!text) return false;
        text = text.trim();
        if (text.length < 2 || text.length > 120) return false;
        const skip = ['image', 'photo', 'picture', 'img', 'thumbnail', 'logo', 'banner', 'icon'];
        if (skip.includes(text.toLowerCase())) return false;
        return true;
      }

      function getName(img) {
        if (valid(img.alt)) return img.alt.trim();
        if (valid(img.title)) return img.title.trim();
        if (valid(img.getAttribute('aria-label'))) return img.getAttribute('aria-label').trim();

        let parent = img.parentElement;
        for (let i = 0; i < 8; i++) {
          if (!parent) break;

          // Headings (direct children first)
          for (const tag of ['h1','h2','h3','h4','h5','h6']) {
            const h = parent.querySelector(tag);
            if (h) {
              const txt = h.innerText?.trim();
              if (valid(txt)) return txt;
            }
          }

          // Name/title class elements
          const nameEl = parent.querySelector('[class*="name"],[class*="title"],[class*="dish"],[class*="item-label"],[class*="product-name"]');
          if (nameEl) {
            const dataName = nameEl.getAttribute('data-name') || nameEl.getAttribute('data-title');
            if (valid(dataName)) return dataName.trim();
            const txt = nameEl.innerText?.trim();
            if (valid(txt) && txt.length < 60) return txt;
          }

          // <p> or <span> sibling text
          const p = parent.querySelector('p');
          if (p) {
            const txt = p.innerText?.trim();
            if (valid(txt) && txt.length < 80) return txt;
          }

          parent = parent.parentElement;
        }
        return '';
      }

      const results = [];

      // IMG TAGS
      document.querySelectorAll('img').forEach(img => {
        let src = img.src;

        if (img.dataset.src) src = img.dataset.src;
        if (img.dataset.lazySrc) src = img.dataset.lazySrc;
        if (img.dataset.original) src = img.dataset.original;

        if (img.srcset) {
          const parts = img.srcset.split(',');
          src = parts[parts.length - 1].trim().split(' ')[0];
        }

        src = clean(src);
        if (!src || !src.startsWith('http')) return;
        if (!src.match(/\.(jpg|jpeg|png|webp|gif)/i)) return;

        results.push({ src, name: getName(img) });
      });

      // CSS BACKGROUND IMAGES
      document.querySelectorAll('*').forEach(el => {
        const style = window.getComputedStyle(el);
        const bg = style.backgroundImage;
        if (bg && bg !== 'none') {
          const match = bg.match(/url\(["']?(.*?)["']?\)/);
          if (match && match[1] && match[1].match(/\.(jpg|jpeg|png|webp|gif)/i)) {
            results.push({ src: clean(match[1]), name: el.innerText?.trim().slice(0, 80) || '' });
          }
        }
      });

      return results;
    });

    await browser.close();
    return [...pageImages, ...apiImages];

  } catch (err) {
    await browser.close();
    console.log('Dynamic scrape failed:', err.message);
    return apiImages;
  }
}

/* ─────────────────────────────────────
   DEDUPLICATE  (FIXED)
   Rules:
   1. Same src + no name on either      → keep 1, drop duplicate
   2. Same src + one has name, one doesn't → keep the named one
   3. Same src + BOTH have DIFFERENT names → keep BOTH (same image,
      different menu items e.g. "Butter Chicken" vs "Paneer Tikka")
   4. Same src + same name              → keep 1
───────────────────────────────────── */
function deduplicate(images) {
  // Use a Map keyed by "src" to collect all unique names per image
  const srcToNames = new Map(); // src → Set of names

  for (const img of images) {
    if (!img.src) continue;

    const src = cleanUrl(img.src);
    const name = (img.name || '').trim();

    if (!srcToNames.has(src)) {
      srcToNames.set(src, new Set());
    }

    if (name) {
      srcToNames.get(src).add(name);
    } else {
      // Mark that a nameless version exists (use empty string sentinel)
      srcToNames.get(src).add('');
    }
  }

  const results = [];

  for (const [src, nameSet] of srcToNames) {
    // Remove empty string — we only want real names
    nameSet.delete('');

    if (nameSet.size === 0) {
      // No valid name found for this image at all
      results.push({ src, name: '' });
    } else {
      // One entry per unique name (same image can appear multiple times
      // if it maps to different menu items)
      for (const name of nameSet) {
        results.push({ src, name });
      }
    }
  }

  return results;
}

/* ─────────────────────────────────────
   MAIN SCRAPER
───────────────────────────────────── */
async function scrapeWebsite(url) {
  console.log('\n========================');
  console.log('STARTING SCRAPE:', url);
  console.log('========================\n');

  console.log('Running static scrape...');
  const staticImages = await scrapeStatic(url);
  console.log(`Static found: ${staticImages.length}`);

  console.log('Running dynamic scrape...');
  const dynamicImages = await scrapeDynamic(url);
  console.log(`Dynamic found: ${dynamicImages.length}`);

  // Merge: put static first (they usually have better name context from cheerio),
  // dynamic second (so dedup prefers static names)
  const merged = [...staticImages, ...dynamicImages];
  const finalImages = deduplicate(merged);

  console.log(`FINAL IMAGES: ${finalImages.length}`);
  return finalImages;
}

module.exports = { scrapeWebsite };
