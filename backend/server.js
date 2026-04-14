const express = require("express");
const cors = require("cors");
const scrapeImages = require("./scraper");
const archiver = require("archiver");
const axios = require("axios");

const app = express();

// ✅ FIX 1: PROPER CORS
app.use(cors({
    origin: "*",
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Content-Type"]
}));

// ✅ FIX 2: HANDLE PREFLIGHT (VERY IMPORTANT)
app.options("*", cors());

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ---------------- FETCH IMAGES ----------------
app.post("/fetch-images", async (req, res) => {
    try {
        const data = await scrapeImages(req.body.url);
        res.json(data);
    } catch (err) {
        console.log("SCRAPER ERROR:", err);

        res.status(500).json({
            error: "Failed to fetch images",
            details: err.message
        });
    }
});

// ---------------- DOWNLOAD ZIP ----------------
app.post("/download", async (req, res) => {
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

    const archive = archiver("zip", { zlib: { level: 9 } });
    archive.pipe(res);

    for (let item of items) {
        try {
            if (!item.image) continue;

            const response = await axios({
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

// ✅ FIX 3: LISTEN ON PUBLIC INTERFACE
app.listen(5000, "0.0.0.0", () => {
    console.log("Server running on port 5000");
});