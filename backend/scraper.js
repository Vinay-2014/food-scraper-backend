const puppeteer = require("puppeteer");

async function scrapeImages(url) {
    const browser = await puppeteer.launch({
    headless: true,
    executablePath: "/usr/bin/chromium-browser",
    args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-gpu"
    ]
});

    const page = await browser.newPage();
    await page.goto(url, { waitUntil: "networkidle2", timeout: 0 });

    // Scroll full page
    await page.evaluate(async () => {
        await new Promise((resolve) => {
            let totalHeight = 0;
            const distance = 500;

            const timer = setInterval(() => {
                window.scrollBy(0, distance);
                totalHeight += distance;

                if (totalHeight >= document.body.scrollHeight) {
                    clearInterval(timer);
                    resolve();
                }
            }, 300);
        });
    });

    await new Promise(r => setTimeout(r, 5000));

    const items = await page.evaluate(() => {
        const results = [];
        const seen = new Set();

        document.querySelectorAll("img").forEach(img => {
            let src = img.src;

            if (!src || seen.has(src)) return;

            let name = "";

            // 🔥 Try multiple ways to find name

            // 1. alt text
            if (img.alt && img.alt.length > 3) {
                name = img.alt;
            }

            // 2. title attribute
            else if (img.title && img.title.length > 3) {
                name = img.title;
            }

            // 3. nearby heading
            else {
                let parent = img.parentElement;

                for (let i = 0; i < 3; i++) {
                    if (!parent) break;

                    const heading = parent.querySelector("h1, h2, h3, h4, h5, p, span");

                    if (heading && heading.innerText.length > 3) {
                        name = heading.innerText.trim();
                        break;
                    }

                    parent = parent.parentElement;
                }
            }

            // fallback
            if (!name || name.length < 3) {
                name = "item_" + Math.floor(Math.random() * 10000);
            }

            // filter junk
            if (
                src.includes("http") &&
                !src.includes("logo") &&
                !src.includes("icon")
            ) {
                seen.add(src);

                results.push({
                    name,
                    image: src
                });
            }
        });

        return results;
    });

    await browser.close();
    return items;
}

module.exports = scrapeImages;