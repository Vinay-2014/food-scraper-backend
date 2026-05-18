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

  const badWords = [
    'login',
    'sign up',
    'menu',
    'home',
    'cart',
    'order now',
    'view more',
    'click here',
    'read more',
    'add to cart'
  ];

  if (
    badWords.some(word =>
      text.toLowerCase().includes(word)
    )
  ) {
    return false;
  }

  return true;
}

/* ─────────────────────────────────────
   IMPROVED FIND NAME FROM HTML
───────────────────────────────────── */
function findName($, img) {

  const candidates = [];

  // ALT
  const alt = $(img).attr('alt');

  if (isValidName(alt)) {
    candidates.push(alt.trim());
  }

  // TITLE
  const title = $(img).attr('title');

  if (isValidName(title)) {
    candidates.push(title.trim());
  }

  // ARIA LABEL
  const aria = $(img).attr('aria-label');

  if (isValidName(aria)) {
    candidates.push(aria.trim());
  }

  // DATA ATTRIBUTES
  const dataName =
    $(img).attr('data-name') ||
    $(img).attr('data-title');

  if (isValidName(dataName)) {
    candidates.push(dataName.trim());
  }

  // WALK PARENTS
  let parent = $(img).parent();

  for (let i = 0; i < 6; i++) {

    if (!parent || parent.length === 0) {
      break;
    }

    parent.find(
      'h1,h2,h3,h4,h5,h6,span,p,a,strong,div'
    ).each((_, el) => {

      const txt =
        $(el).text().trim();

      if (
        isValidName(txt) &&
        txt.length < 80
      ) {
        candidates.push(txt);
      }
    });

    parent = parent.parent();
  }

  // CLEAN DUPLICATES
  const cleaned =
    [...new Set(candidates)]
      .map(t =>
        t
          .replace(/\s+/g, ' ')
          .replace(/[^\w\s\-&]/g, '')
          .trim()
      )
      .filter(Boolean);

  // BEST MATCH
  if (cleaned.length > 0) {
    return cleaned[0];
  }

  return '';
}

/* ─────────────────────────────────────
   JSON IMAGE EXTRACTION
───────────────────────────────────── */
function extractFromJson(obj, results) {

  if (!obj) return;

  if (Array.isArray(obj)) {

    obj.forEach(item =>
      extractFromJson(item, results)
    );

    return;
  }

  if (typeof obj === 'object') {

    let foundImage = null;
    let foundName = '';

    const imageKeys = [
      'image',
      'imageurl',
      'photo',
      'photourl',
      'thumbnail',
      'heroimage',
      'src'
    ];

    for (const key in obj) {

      const value = obj[key];

      extractFromJson(value, results);

      // IMAGE DETECTION
      if (
        typeof value === 'string' &&
        value.match(/\.(jpg|jpeg|png|webp|gif)/i)
      ) {

        if (
          imageKeys.some(k =>
            key.toLowerCase().includes(k)
          )
        ) {

          foundImage = cleanUrl(value);
        }
      }

      // NAME DETECTION
      if (
        typeof value === 'string' &&
        value.length > 2 &&
        value.length < 120
      ) {

        if (
          key.toLowerCase().includes('name') ||
          key.toLowerCase().includes('title')
        ) {

          foundName = value.trim();
        }
      }
    }

    if (foundImage) {

      results.push({
        src: foundImage,
        name: foundName
      });
    }
  }
}

/* ─────────────────────────────────────
   JSON-LD STRUCTURED DATA
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

    const { data } =
      await axios.get(url, {
        timeout: 25000,
        headers: {
          'User-Agent':
            'Mozilla/5.0'
        }
      });

    const $ = cheerio.load(data);

    const images = [];

    // JSON-LD FIRST
    images.push(...extractJsonLd(data));

    $('img').each((i, el) => {

      let src =
        $(el).attr('src') ||
        $(el).attr('data-src') ||
        $(el).attr('data-lazy-src');

      // SRCSET
      const srcset =
        $(el).attr('srcset');

      if (srcset) {

        const parts =
          srcset.split(',');

        src =
          parts[parts.length - 1]
            .trim()
            .split(' ')[0];
      }

      src = cleanUrl(src);

      if (
        !src ||
        !src.startsWith('http')
      ) {
        return;
      }

      if (
        !src.match(/\.(jpg|jpeg|png|webp|gif)/i)
      ) {
        return;
      }

      images.push({
        src,
        name: findName($, el)
      });
    });

    return images;

  } catch (err) {

    console.log(
      'Static scrape failed'
    );

    return [];
  }
}

/* ─────────────────────────────────────
   DYNAMIC SCRAPER
───────────────────────────────────── */
async function scrapeDynamic(url) {

  const browser =
    await chromium.launch({
      headless: true,
      executablePath: '/usr/bin/google-chrome'
    });

  const page =
    await browser.newPage({

      javaScriptEnabled: true,

      viewport: {
        width: 1440,
        height: 1200
      },

      userAgent:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36'
    });

  const apiImages = [];

  /* ─────────────────────────────
     API / NETWORK INTERCEPT
  ───────────────────────────── */
  page.on('response', async response => {

    try {

      const responseUrl =
        response.url();

      // DIRECT IMAGE REQUESTS
      if (
        responseUrl.match(/\.(jpg|jpeg|png|webp|gif)/i)
      ) {

        apiImages.push({
          src: cleanUrl(responseUrl),
          name: ''
        });
      }

      // JSON RESPONSES
      const type =
        response.headers()['content-type'] || '';

      if (
        type.includes('application/json')
      ) {

        const json =
          await response.json();

        extractFromJson(
          json,
          apiImages
        );
      }

    } catch (err) {}
  });

  try {

    await page.goto(url, {
      waitUntil: 'domcontentloaded',
      timeout: 90000
    });

    // WAIT FOR LAZY LOAD
    await page.waitForTimeout(6000);

    // SCROLL PAGE
    await page.evaluate(async () => {

      for (let i = 0; i < 12; i++) {

        window.scrollBy(
          0,
          window.innerHeight
        );

        await new Promise(r =>
          setTimeout(r, 1500)
        );
      }
    });

    // EXTRA WAIT
    await page.waitForTimeout(3000);

    const pageImages =
      await page.evaluate(() => {

        function clean(url) {

          if (!url) return null;

          return url
            .split('?')[0]
            .replace(
              /-\d+x\d+(\.(jpg|jpeg|png|webp))/i,
              '$1'
            );
        }

        function valid(text) {

          if (!text) return false;

          text = text.trim();

          if (text.length < 2) return false;
          if (text.length > 120) return false;

          if (/^\d+$/.test(text)) return false;

          const badWords = [
            'login',
            'sign up',
            'menu',
            'home',
            'cart',
            'order now',
            'view more',
            'click here',
            'read more',
            'add to cart'
          ];

          if (
            badWords.some(word =>
              text.toLowerCase().includes(word)
            )
          ) {
            return false;
          }

          return true;
        }

        /* ─────────────────────────────
           IMPROVED GET NAME
        ───────────────────────────── */
        function getName(img) {

          const candidates = [];

          // ALT
          if (valid(img.alt)) {
            candidates.push(img.alt.trim());
          }

          // TITLE
          if (valid(img.title)) {
            candidates.push(img.title.trim());
          }

          // ARIA
          const aria =
            img.getAttribute('aria-label');

          if (valid(aria)) {
            candidates.push(aria.trim());
          }

          // DATA ATTRIBUTES
          const dataName =
            img.getAttribute('data-name') ||
            img.getAttribute('data-title');

          if (valid(dataName)) {
            candidates.push(dataName.trim());
          }

          // WALK PARENTS
          let parent = img.parentElement;

          for (let i = 0; i < 6; i++) {

            if (!parent) break;

            const els =
              parent.querySelectorAll(
                'h1,h2,h3,h4,h5,h6,span,p,a,strong,div'
              );

            for (const el of els) {

              const txt =
                el.innerText?.trim();

              if (
                valid(txt) &&
                txt.length < 80
              ) {
                candidates.push(txt);
              }
            }

            parent = parent.parentElement;
          }

          // CLEAN
          const cleaned =
            [...new Set(candidates)]
              .map(t =>
                t
                  .replace(/\s+/g, ' ')
                  .replace(/[^\w\s\-&]/g, '')
                  .trim()
              )
              .filter(Boolean);

          // BEST RESULT
          if (cleaned.length > 0) {
            return cleaned[0];
          }

          return '';
        }

        const results = [];

        // IMG TAGS
        document
          .querySelectorAll('img')
          .forEach(img => {

            let src =
              img.src;

            // BEST SRCSET IMAGE
            if (img.srcset) {

              const parts =
                img.srcset.split(',');

              src =
                parts[parts.length - 1]
                  .trim()
                  .split(' ')[0];
            }

            src = clean(src);

            if (
              !src ||
              !src.startsWith('http')
            ) {
              return;
            }

            if (
              !src.match(
                /\.(jpg|jpeg|png|webp|gif)/i
              )
            ) {
              return;
            }

            results.push({
              src,
              name: getName(img)
            });
          });

        // CSS BACKGROUND IMAGES
        document
          .querySelectorAll('*')
          .forEach(el => {

            const style =
              window.getComputedStyle(el);

            const bg =
              style.backgroundImage;

            if (
              bg &&
              bg !== 'none'
            ) {

              const match =
                bg.match(/url\("(.*?)"\)/);

              if (
                match &&
                match[1]
              ) {

                results.push({
                  src: clean(match[1]),
                  name:
                    el.innerText?.trim() || ''
                });
              }
            }
          });

        return results;
      });

    await browser.close();

    return [
      ...pageImages,
      ...apiImages
    ];

  } catch (err) {

    await browser.close();

    console.log(
      'Dynamic scrape failed:',
      err.message
    );

    return apiImages;
  }
}

/* ─────────────────────────────────────
   DEDUPLICATE
───────────────────────────────────── */
function deduplicate(images) {

  const srcToNames = new Map();

  for (const img of images) {

    if (!img.src) continue;

    const src = cleanUrl(img.src);
    const name = (img.name || '').trim();

    if (!srcToNames.has(src)) {
      srcToNames.set(src, new Set());
    }

    srcToNames.get(src).add(name);
  }

  const results = [];

  for (const [src, nameSet] of srcToNames) {

    nameSet.delete('');

    if (nameSet.size === 0) {

      results.push({
        src,
        name: ''
      });

    } else {

      for (const name of nameSet) {

        results.push({
          src,
          name
        });
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
  console.log('STARTING SCRAPE');
  console.log('========================\n');

  console.log(
    'Running static scrape...'
  );

  const staticImages =
    await scrapeStatic(url);

  console.log(
    `Static found: ${staticImages.length}`
  );

  console.log(
    'Running dynamic scrape...'
  );

  const dynamicImages =
    await scrapeDynamic(url);

  console.log(
    `Dynamic found: ${dynamicImages.length}`
  );

  const merged = [
    ...staticImages,
    ...dynamicImages
  ];

  const finalImages =
    deduplicate(merged);

  console.log(
    `FINAL IMAGES: ${finalImages.length}`
  );

  return finalImages;
}

/* ─────────────────────────────────────
   EXPORT
───────────────────────────────────── */
module.exports = {
  scrapeWebsite
};
```
