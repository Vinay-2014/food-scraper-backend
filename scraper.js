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

  return true;
}

/* ─────────────────────────────────────
   FIND NAME FROM HTML
───────────────────────────────────── */
function findName($, img) {

  const alt = $(img).attr('alt');

  if (isValidName(alt)) {
    return alt.trim();
  }

  let parent = $(img).parent();

  for (let i = 0; i < 6; i++) {

    const heads =
      parent.find('h1,h2,h3,h4,h5,h6');

    for (let j = 0; j < heads.length; j++) {

      const txt =
        $(heads[j]).text().trim();

      if (isValidName(txt)) {
        return txt;
      }
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

      // image detection
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

      // name detection
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

    $('img').each((i, el) => {

      let src =
        $(el).attr('src') ||
        $(el).attr('data-src') ||
        $(el).attr('data-lazy-src');

      // srcset
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
      headless: false
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

      // direct image requests
      if (
        responseUrl.match(/\.(jpg|jpeg|png|webp|gif)/i)
      ) {

        apiImages.push({
          src: cleanUrl(responseUrl),
          name: ''
        });
      }

      // json responses
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

    // lazy loading
    await page.waitForTimeout(6000);

    // scroll page
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

    // extra wait
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

          return (
            text.length > 2 &&
            text.length < 120
          );
        }

        function getName(img) {

          if (valid(img.alt)) {
            return img.alt.trim();
          }

          let parent =
            img.parentElement;

          for (let i = 0; i < 6; i++) {

            if (!parent) break;

            const heads =
              parent.querySelectorAll(
                'h1,h2,h3,h4,h5,h6'
              );

            for (const h of heads) {

              const txt =
                h.innerText?.trim();

              if (valid(txt)) {
                return txt;
              }
            }

            parent =
              parent.parentElement;
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

            // best srcset image
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

  const map = new Map();

  for (const img of images) {

    if (!img.src) continue;

    const src =
      cleanUrl(img.src);

    const name =
      (img.name || '')
        .trim();

    // already exists?
    if (map.has(src)) {

      const existing =
        map.get(src);

      // IMPORTANT:
      // Prefer named version
      if (
        !existing.name &&
        name
      ) {

        existing.name = name;
      }

      // ALSO:
      // allow duplicate same-image
      // ONLY if BOTH have valid names
      else if (
        existing.name &&
        name &&
        existing.name !== name
      ) {

        map.set(
          `${src}__${name}`,
          {
            src,
            name
          }
        );
      }

    } else {

      map.set(src, {
        src,
        name
      });
    }
  }

  return Array.from(map.values());
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