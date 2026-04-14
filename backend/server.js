const express = require("express");
const cors = require("cors");
const scrapeImages = require("./scraper");
const archiver = require("archiver");
const axios = require("axios");

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.post("/fetch-images", async (req, res) => {
    try {
        const data = await scrapeImages(req.body.url);
        res.json(data);
    } catch (err) {
        console.log(err);
        res.status(500).send("Error fetching images");
    }
});

app.post("/download", async (req, res) => {
    // 🔥 FIX: parse items correctly
    let items = req.body.items;

    if (typeof items === "string") {
        try {
            items = JSON.parse(items);
        } catch (e) {
            items = [];
        }
    }

    if (!items || items.length === 0) {
        return res.status(400).send("No items received");
    }

    res.setHeader("Content-Type", "application/zip");
    res.setHeader("Content-Disposition", "attachment; filename=food-images.zip");

    const archive = require("archiver")("zip", { zlib: { level: 9 } });
    archive.pipe(res);

    for (let item of items) {
        try {
            if (!item.image) continue; // ✅ fix undefined issue

            const response = await require("axios")({
                url: item.image,
                method: "GET",
                responseType: "stream"
            });

            let cleanName = item.name
                .replace(/[^a-z0-9]/gi, "_")
                .replace(/_+/g, "_")
                .toLowerCase()
                .substring(0, 50);

            archive.append(response.data, {
                name: `${cleanName}.jpg`
            });

        } catch (err) {
            console.log("skip:", item.image);
        }
    }

    archive.finalize();
});

app.listen(5000, () => {
    console.log("Server running on http://localhost:5000");
});