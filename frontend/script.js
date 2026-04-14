let selectedItems = [];

document.getElementById("fetchBtn").addEventListener("click", fetchImages);
document.getElementById("downloadBtn").addEventListener("click", downloadZip);

async function fetchImages() {
    const url = document.getElementById("url").value;
    const gallery = document.getElementById("gallery");

    if (!url) {
        alert("Enter URL");
        return;
    }

    gallery.innerHTML = "Loading...";
    selectedItems = [];

    const res = await fetch("http://localhost:5000/fetch-images", {
        method: "POST",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify({ url })
    });

    const data = await res.json();

    gallery.innerHTML = "";

    data.forEach(item => {
        const box = document.createElement("div");

        const img = document.createElement("img");
        img.src = item.image;
        img.classList.add("selected");

        const name = document.createElement("p");
        name.innerText = item.name;

        // ✅ default selected
        selectedItems.push(item);

        img.onclick = () => {
            img.classList.toggle("selected");

            const exists = selectedItems.find(i => i.image === item.image);

            if (exists) {
                selectedItems = selectedItems.filter(i => i.image !== item.image);
            } else {
                selectedItems.push(item);
            }
        };

        box.appendChild(img);
        box.appendChild(name);
        gallery.appendChild(box);
    });
}

async function downloadZip() {
    if (selectedItems.length === 0) {
        alert("No items selected");
        return;
    }

    const btn = document.getElementById("downloadBtn");
    const text = document.getElementById("btnText");
    const spinner = document.getElementById("loaderSpinner");

    // 🔥 Show loader
    btn.disabled = true;
    text.innerText = "Downloading...";
    spinner.classList.remove("hidden");

    try {
        // 🔥 DIRECT DOWNLOAD (no blob, no waiting)
        const form = document.createElement("form");
        form.method = "POST";
        form.action = "http://127.0.0.1:5000/download";

        const input = document.createElement("input");
        input.type = "hidden";
        input.name = "items";
        input.value = JSON.stringify(selectedItems);

        form.appendChild(input);
        document.body.appendChild(form);

        form.submit(); // 🚀 triggers download instantly
        form.remove();

    } catch (err) {
        console.log(err);
        alert("Download failed");
    }

    // ⏳ small delay then reset button
    setTimeout(() => {
        btn.disabled = false;
        text.innerText = "Download Selected";
        spinner.classList.add("hidden");
    }, 2000);
}