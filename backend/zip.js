const fs = require("fs");
const axios = require("axios");
const archiver = require("archiver");
const path = require("path");

async function downloadAndZip(imageUrls, zipPath) {
    const output = fs.createWriteStream(zipPath);
    const archive = archiver("zip", { zlib: { level: 9 } });

    archive.pipe(output);

    for (let url of imageUrls) {
        try {
            const response = await axios({
                url,
                method: "GET",
                responseType: "stream"
            });

            // ✅ Extract proper file name
            let fileName = url.split("/").pop().split("?")[0];

            if (!fileName || fileName.length < 5) {
                fileName = "image_" + Date.now() + ".jpg";
            }

            archive.append(response.data, { name: fileName });

        } catch (err) {
            console.log("Failed:", url);
        }
    }

    await archive.finalize();

    return zipPath;
}

module.exports = downloadAndZip;