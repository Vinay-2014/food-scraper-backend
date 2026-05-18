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
  const skip = ['image', 'photo', 'picture', 'img', 'thumbnail', 'logo',
    'banner', 'icon', 'null', 'undefined', 'true', 'false', 'loading',
    'placeholder', 'default', 'no image', 'n/a'];
  if (skip.includes(text.toLowerCase())) return false;
  return true;
}

/* ─────────────────────────────────────
   FIND NAME FROM HTML
   Strategy (in order):
   1. alt / title / aria-label / data attrs on image
   2. Headings inside parent card
   3. Elements with name/dish/title class
   4. Sibling text of the image
   5. Shortest leaf text in the card
───────────────────────────────────── */
function findName($, img) {
  // 1. Direct image attributes
  for (const attr of ['alt', 'title', 'aria-label', 'data-name', 'data-title']) {
    const val = $(img).attr(attr);
    if (isValidName(val)) return val.trim();
  }

  // 2. Walk up the DOM
  let parent = $(img).parent();

  for (let i = 0; i < 10; i++) {
    if (!parent || !parent.length) break;

    const levelText = parent.text().trim();
    if (!levelText) { parent = parent.parent(); continue; }

    // Headings (most reliable)
    const heading = parent.find('h1,h2,h3,h4,h5,h6').first();
    if (heading.length) {
      const txt = heading.text().trim();
      if (isValidName(txt) && txt.length < 80) return txt;
    }

    // Elements whose class contains name/dish/title/label
    const nameEl = parent.find([
      '[class*="name"]',
      '[class*="title"]',
      '[class*="dish"]',
      '[class*="item-name"]',
      '[class*="item-title"]',
      '[class*="product-name"]',
      '[class*="food-name"]',
      '[class*="label"]',
      '[class*="caption"]',
    ].join(',')).first();

    if (nameEl.length && !nameEl.find('img').length) {
      const dataVal = nameEl.attr('data-name') || nameEl.attr('data-title');
      if (isValidName(dataVal)) return dataVal.trim();
      const txt = nameEl.text().trim();
      if (isValidName(txt) && txt.length < 80) return txt;
    }

    // Siblings of the image (CRITICAL for most restaurant layouts)
    // e.g. <div><img/><p>Butter Chicken</p></div>
    let siblingName = '';
    $(img).siblings().each((_, sib) => {
      if (siblingName) return false;
      if ($(sib).is('img')) return;
      const txt = $(sib).text().trim();
      if (isValidName(txt) && txt.length < 80) siblingName = txt;
    });
    if (siblingName) return siblingName;

    // Shortest leaf text inside this ancestor
    const candidates = [];
    parent.find('p, span, div, a, li').each((_, el) => {
      if ($(el).find('img').length > 0) return;
      const txt = $(el).clone().children().remove().end().text().trim();
      if (isValidName(txt) && txt.length >= 3 && txt.length < 80) {
        candidates.push(txt);
      }
    });
    if (candidates.length > 0) {
      candidates.sort((a, b) => a.length - b.length);
      return candidates[0];
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

    const imageKeys = ['image', 'imageurl', 'photo', 'photourl', 'thumbnail',
      'heroimage', 'src', 'imageuri', 'imgurl', 'coverimage', 'itemimage'];

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
   JSON-LD STRUCTURED DATA EXTRACTION
   Many restaurant sites embed full menu
   data in <script type="application/ld+json">
───────────────────────────────────── */
function extractJsonLd(html) {
  const results = [];
  const regex = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let match;
  while ((match = regex.exec(html)) !== null) {
    try {
      const json = JSON.parse(match[1]);
      extractFromJson(json, results);
    } catch (e) {}
  }
  return results;
}

/* ─────────────────────────────────────
   STATIC SCRAPER
───────────────────────────────────── */
async function scrapeStatic(url) {
  try {
    const { data } = await axios.get(url, {
      timeout: 25000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36'
      }
    });

    const $ = cheerio.load(data);
    const images = [];

    // JSON-LD first (most reliable name source)
    const jsonLdImages = extractJsonLd(data);
    images.push(...jsonLdImages);

    // IMG tags
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
  const browser = await chromium.launch({
    headless: true,
    executablePath: '/usr/bin/google-chrome'
  });

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

      function isValid(text) {
        if (!text) return false;
        text = text.trim();
        if (text.length < 2 || text.length > 120) return false;
        const skip = ['image', 'photo', 'picture', 'img', 'thumbnail', 'logo',
          'banner', 'icon', 'null', 'undefined', 'loading', 'placeholder'];
        if (skip.includes(text.toLowerCase())) return false;
        return true;
      }

      function getName(img) {
        // 1. Image attributes
        for (const attr of ['alt', 'title', 'aria-label', 'data-name', 'data-title']) {
          const val = img.getAttribute(attr);
          if (isValid(val)) return val.trim();
        }

        // 2. Walk up parents
        let parent = img.parentElement;
        for (let i = 0; i < 10; i++) {
          if (!parent) break;

          // Headings
          const heading = parent.querySelector('h1,h2,h3,h4,h5,h6');
          if (heading) {
            const txt = heading.innerText?.trim();
            if (isValid(txt) && txt.length < 80) return txt;
          }

          // Name/title/dish class elements
          const nameEl = parent.querySelector([
            '[class*="name"]', '[class*="title"]', '[class*="dish"]',
            '[class*="item-name"]', '[class*="product-name"]',
            '[class*="food-name"]', '[class*="label"]', '[class*="caption"]'
          ].join(','));
          if (nameEl && !nameEl.querySelector('img')) {
            const dataVal = nameEl.getAttribute('data-name') || nameEl.getAttribute('data-title');
            if (isValid(dataVal)) return dataVal.trim();
            const txt = nameEl.innerText?.trim();
            if (isValid(txt) && txt.length < 80) return txt;
          }

          // Siblings of the img element
          const imgParentChildren = Array.from(img.parentElement?.children || []);
          for (const sib of imgParentChildren) {
            if (sib === img || sib.tagName === 'IMG') continue;
            const txt = sib.innerText?.trim();
            if (isValid(txt) && txt.length < 80) return txt;
          }

          // Shortest leaf text in parent
          const candidates = [];
          parent.querySelectorAll('p,span,div,a,li').forEach(el => {
            if (el.querySelector('img')) return;
            const txt = el.innerText?.trim();
            if (isValid(txt) && txt.length >= 3 && txt.length < 80) {
              candidates.push(txt);
            }
          });
          if (candidates.length > 0) {
            candidates.sort((a, b) => a.length - b.length);
            return candidates[0];
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
            const txt = el.innerText?.trim().slice(0, 80) || '';
            results.push({ src: clean(match[1]), name: isValid(txt) ? txt : '' });
          }
        }
      });

      // JSON-LD in rendered page
      document.querySelectorAll('script[type="application/ld+json"]').forEach(script => {
        try {
          const json = JSON.parse(script.textContent);
          function extract(obj) {
            if (!obj || typeof obj !== 'object') return;
            if (Array.isArray(obj)) { obj.forEach(extract); return; }
            let imgUrl = null, name = '';
            const imgKeys = ['image', 'imageurl', 'photo', 'thumbnail', 'src', 'imageuri'];
            for (const k in obj) {
              extract(obj[k]);
              if (typeof obj[k] === 'string') {
                if (obj[k].match(/\.(jpg|jpeg|png|webp|gif)/i) &&
                    imgKeys.some(ik => k.toLowerCase().includes(ik))) {
                  imgUrl = obj[k];
                }
                if ((k.toLowerCase().includes('name') || k.toLowerCase().includes('title')) &&
                    obj[k].length < 120) {
                  name = obj[k];
                }
              }
            }
            if (imgUrl) results.push({ src: imgUrl, name });
          }
          extract(json);
        } catch(e) {}
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
   DEDUPLICATE
   - Same src + no name on either      → keep 1
   - Same src + one named, one not     → keep named
   - Same src + different valid names  → keep BOTH
   - Same src + same name              → keep 1
───────────────────────────────────── */
function deduplicate(images) {
  const srcToNames = new Map();

  for (const img of images) {
    if (!img.src) continue;
    const src = cleanUrl(img.src);
    const name = (img.name || '').trim();

    if (!srcToNames.has(src)) srcToNames.set(src, new Set());
    srcToNames.get(src).add(name);
  }

  const results = [];
  for (const [src, nameSet] of srcToNames) {
    nameSet.delete('');
    if (nameSet.size === 0) {
      results.push({ src, name: '' });
    } else {
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

  // Static first — cheerio has better name context from full HTML
  const merged = [...staticImages, ...dynamicImages];
  const finalImages = deduplicate(merged);

  console.log(`FINAL IMAGES: ${finalImages.length}`);
  return finalImages;
}

module.exports = { scrapeWebsite };
