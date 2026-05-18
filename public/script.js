const API = "https://key-ins-motorcycles-entire.trycloudflare.com";

let scrapedImages = [];
let selectedImages = [];

/* ─────────────────────────────────────
   PROXY HELPER  (NEW)
   Routes image src through your backend
   so restaurants can't block hotlinking.
───────────────────────────────────── */
function proxyUrl(src) {
  if (!src) return '';
  return `${API}/proxy?url=${encodeURIComponent(src)}`;
}

function showAlert(msg, type = "success") {
  document.getElementById("alerts").innerHTML =
    `<div class="alert ${type}">${msg}</div>`;
}

function toggleLoader(show) {
  document.getElementById("loader").classList.toggle("hidden", !show);
}

function updateCounts() {
  document.getElementById("count").innerText = scrapedImages.length;
  document.getElementById("selectedCount").innerText = selectedImages.length;
}

async function scrape() {
  const url = document.getElementById("urlInput").value.trim();
  const grid = document.getElementById("grid");

  if (!url) {
    showAlert("Enter URL", "error");
    return;
  }

  grid.innerHTML = "";
  scrapedImages = [];
  selectedImages = [];
  toggleLoader(true);
  document.getElementById("stats").classList.add("hidden");

  try {
    const res = await fetch(`${API}/scrape`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url })
    });

    const data = await res.json();
    scrapedImages = data.images || [];

    toggleLoader(false);

    if (!scrapedImages.length) {
      showAlert("No images found", "error");
      return;
    }

    // Select ALL by default
    selectedImages = [...scrapedImages];

    // Render cards
    scrapedImages.forEach(img => renderCard(img, true));

    updateCounts();
    document.getElementById("stats").classList.remove("hidden");
    showAlert(`Loaded ${scrapedImages.length} images`);

  } catch (err) {
    toggleLoader(false);
    console.error(err);
    showAlert("Scrape failed", "error");
  }
}

/* ─────────────────────────────────────
   RENDER CARD  (FIXED)
   Uses proxyUrl() so images actually load
───────────────────────────────────── */
function renderCard(img, selected = true) {
  const grid = document.getElementById("grid");

  const card = document.createElement("div");
  card.className = "card";
  if (selected) card.classList.add("selected");

  // Use proxy URL so restaurant CDNs don't block the img tag
  const displaySrc = proxyUrl(img.src);
  const displayName = img.name || "No name";

  card.innerHTML = `
    <img src="${displaySrc}" alt="${displayName}" loading="lazy" onerror="this.style.opacity='0.2'">
    <p>${displayName}</p>
    <div class="overlay">✓</div>
  `;

  card.onclick = () => {
    const isSelected = card.classList.contains("selected");
    if (isSelected) {
      card.classList.remove("selected");
      selectedImages = selectedImages.filter(i => i.src !== img.src);
    } else {
      card.classList.add("selected");
      if (!selectedImages.find(i => i.src === img.src)) {
        selectedImages.push(img);
      }
    }
    updateCounts();
  };

  card.ondblclick = (e) => {
    e.stopPropagation();
    showPreview(img.src, img.name);
  };

  grid.appendChild(card);
}

/* ─────────────────────────────────────
   PREVIEW MODAL  (FIXED)
   Also uses proxyUrl() for the large preview
───────────────────────────────────── */
function showPreview(src, name) {
  const modal = document.createElement("div");
  modal.style = `
    position:fixed;top:0;left:0;width:100%;height:100%;
    background:rgba(0,0,0,0.9);display:flex;flex-direction:column;
    justify-content:center;align-items:center;z-index:9999;
  `;

  const displayName = name || "No name found";
  const displaySrc = proxyUrl(src); // ← proxy here too

  modal.innerHTML = `
    <div style="position:relative; text-align:center;">
      <img src="${displaySrc}" style="max-width:85vw;max-height:80vh;border-radius:10px;box-shadow: 0 10px 25px rgba(0,0,0,0.5);">
      <h2 style="color:white; margin-top:20px; font-family:sans-serif; font-weight:600;">${displayName}</h2>
      <button style="
        position:absolute;top:-15px;right:-15px;
        background:#ef4444;color:#fff;border:none;border-radius:999px;
        padding:8px 12px;cursor:pointer;font-weight:bold;font-size:16px;
      ">✕</button>
    </div>
  `;

  modal.onclick = () => modal.remove();
  document.body.appendChild(modal);
}

function selectAll() {
  selectedImages = [...scrapedImages];
  document.querySelectorAll(".card").forEach(c => c.classList.add("selected"));
  updateCounts();
}

function clearSelection() {
  selectedImages = [];
  document.querySelectorAll(".card").forEach(c => c.classList.remove("selected"));
  updateCounts();
}

/* ─────────────────────────────────────
   DOWNLOAD ZIP
───────────────────────────────────── */
const quotes = [
  "Compression in progress. Squishing these pixels with love...",
  "Good things come to those who wait. And to those who scrape.",
  "Baking the ZIP archive... please don't open the oven.",
  "If data were a dessert, this ZIP would be a molten lava cake.",
  "Calculating the exact amount of bytes needed to make you smile..."
];

let quoteInterval;

async function downloadZip() {
  if (!selectedImages.length) {
    showAlert("No images selected", "error");
    return;
  }

  const overlay = document.getElementById("downloadOverlay");
  const quoteText = document.getElementById("quoteText");

  overlay.classList.remove("hidden");
  let qIndex = 0;
  quoteText.innerText = quotes[qIndex];

  quoteInterval = setInterval(() => {
    qIndex = (qIndex + 1) % quotes.length;
    quoteText.style.opacity = 0;
    setTimeout(() => {
      quoteText.innerText = quotes[qIndex];
      quoteText.style.opacity = 1;
    }, 300);
  }, 3500);

  try {
    const res = await fetch(`${API}/download`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ images: selectedImages })
    });

    if (!res.ok) throw new Error("Server rejected download");

    const blob = await res.blob();
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = "processed-images.zip";
    link.click();

    showAlert("Download complete! Enjoy your images. 🎉", "success");

  } catch (err) {
    console.error(err);
    showAlert("Download failed. The server might be overwhelmed.", "error");
  } finally {
    clearInterval(quoteInterval);
    overlay.classList.add("hidden");
  }
}
