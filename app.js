// =====================
// Konfigurasi Space Anda
// =====================
const HF_BASE = "https://andinurulfitiriah-object-detection-serenity.hf.space";
const ENDPOINT_UPLOAD = `${HF_BASE}/upload`;
const ENDPOINT_PREDICT = `${HF_BASE}/run/predict`;

document.getElementById("endpointText").textContent = ENDPOINT_PREDICT;

// =====================
// Elemen UI
// =====================
const video = document.getElementById("video");
const overlay = document.getElementById("overlay");
const ctx = overlay.getContext("2d");

const btnStart = document.getElementById("btnStart");
const btnStop = document.getElementById("btnStop");
const btnClear = document.getElementById("btnClear");

const jsonOut = document.getElementById("jsonOut");
const statusText = document.getElementById("statusText");

const intervalMsInput = document.getElementById("intervalMs");
const minConfInput = document.getElementById("minConf");
const drawBoxesInput = document.getElementById("drawBoxes");

// =====================
// State
// =====================
let stream = null;
let timer = null;
let busy = false;

// Canvas untuk mengambil frame (offscreen)
const captureCanvas = document.createElement("canvas");
const captureCtx = captureCanvas.getContext("2d");

// =====================
// Helpers UI
// =====================
function setStatus(type, text) {
    statusText.className = `badge ${type}`;
    statusText.textContent = text;
}

function pretty(obj) {
    return JSON.stringify(obj, null, 2);
}

function clamp(n, min, max) {
    return Math.max(min, Math.min(max, n));
}

// =====================
// 1) Start webcam
// =====================
async function startCamera() {
    // Webcam hanya jalan pada HTTPS / localhost
    stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment" },
        audio: false,
    });

    video.srcObject = stream;

    await new Promise((resolve) => {
        video.onloadedmetadata = () => resolve();
    });

    // samakan ukuran overlay dengan video real
    const w = video.videoWidth || 1280;
    const h = video.videoHeight || 720;

    overlay.width = w;
    overlay.height = h;
    captureCanvas.width = w;
    captureCanvas.height = h;

    setStatus("running", "Kamera aktif");
}

// =====================
// 2) Stop webcam
// =====================
function stopCamera() {
    if (stream) {
        stream.getTracks().forEach(t => t.stop());
        stream = null;
    }
    video.srcObject = null;
    clearOverlay();
    setStatus("idle", "Idle");
}

// =====================
// 3) Ambil frame dari video -> Blob
// =====================
async function captureFrameBlob() {
    const w = captureCanvas.width;
    const h = captureCanvas.height;

    // draw frame video ke canvas
    captureCtx.drawImage(video, 0, 0, w, h);

    // kompres supaya tidak berat (JPEG)
    return await new Promise((resolve) => {
        captureCanvas.toBlob((blob) => resolve(blob), "image/jpeg", 0.8);
    });
}

// =====================
// 4) Upload ke Gradio /upload
// =====================
async function gradioUpload(fileBlob) {
    const fd = new FormData();

    // Gradio upload menggunakan key "files"
    // bisa multi-file, tapi kita pakai 1 file
    const file = new File([fileBlob], "frame.jpg", { type: "image/jpeg" });
    fd.append("files", file);

    const res = await fetch(ENDPOINT_UPLOAD, { method: "POST", body: fd });
    if (!res.ok) throw new Error(`Upload gagal: HTTP ${res.status}`);

    // response umumnya array path, contoh: ["file=/tmp/gradio/xxx/frame.jpg"] atau ["..."]
    const data = await res.json();
    return data;
}

// =====================
// 5) Predict ke Gradio /run/predict
// =====================
async function gradioPredict(uploadResp) {
    // Banyak Space mengembalikan array berisi path string.
    // Kita ambil item pertama sebagai path.
    const first = Array.isArray(uploadResp) ? uploadResp[0] : uploadResp;

    // Payload gradio: {"data":[<input1>, <input2>, ...]}
    // Karena input kita 1 gambar, cukup 1 item.
    const payload = {
        data: [first]
    };

    const res = await fetch(ENDPOINT_PREDICT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
    });

    if (!res.ok) throw new Error(`Predict gagal: HTTP ${res.status}`);

    const out = await res.json();
    return out;
}

// =====================
// 6) Normalisasi output jadi JSON deteksi
// =====================
function normalizeDetections(gradioOut) {
    // Gradio output biasanya:
    // { data: [ <output_component_value> ], ... }
    // Output component Anda tampaknya JSON (dict/atau string).
    const raw = gradioOut?.data?.[0] ?? gradioOut;

    // Kalau berupa string JSON, parse
    if (typeof raw === "string") {
        try { return JSON.parse(raw); } catch { return { raw }; }
    }

    // Kalau sudah object
    return raw;
}

// =====================
// 7) Render overlay bounding box
// =====================
function clearOverlay() {
    ctx.clearRect(0, 0, overlay.width, overlay.height);
}

function drawBoxes(detectionJson) {
    clearOverlay();

    const minConf = clamp(parseFloat(minConfInput.value || "0.25"), 0, 1);

    // Format yang Anda punya sebelumnya:
    // { total: 1, detections: [ {label, confidence, bbox:[x1,y1,x2,y2]} ] }
    const dets = detectionJson?.detections || [];
    if (!Array.isArray(dets) || dets.length === 0) return;

    ctx.lineWidth = 3;
    ctx.font = "20px ui-sans-serif, system-ui";
    ctx.textBaseline = "top";

    dets.forEach(d => {
        const conf = Number(d.confidence ?? 0);
        if (conf < minConf) return;

        const [x1, y1, x2, y2] = d.bbox || [];
        if ([x1, y1, x2, y2].some(v => typeof v !== "number")) return;

        const w = x2 - x1;
        const h = y2 - y1;

        // Kotak
        ctx.strokeStyle = "rgba(45,108,255,0.95)";
        ctx.strokeRect(x1, y1, w, h);

        // Label
        const label = `${d.label ?? "obj"} ${(conf * 100).toFixed(1)}%`;
        const pad = 6;
        const textW = ctx.measureText(label).width;

        ctx.fillStyle = "rgba(0,0,0,0.65)";
        ctx.fillRect(x1, Math.max(0, y1 - 28), textW + pad * 2, 28);

        ctx.fillStyle = "white";
        ctx.fillText(label, x1 + pad, Math.max(0, y1 - 26));
    });
}

// =====================
// 8) Loop realtime (per interval)
// =====================
async function tick() {
    if (!stream) return;
    if (busy) return; // hindari tabrakan request
    busy = true;

    try {
        setStatus("wait", "Mengirim frame...");

        const blob = await captureFrameBlob();
        const uploadResp = await gradioUpload(blob);
        const gradioOut = await gradioPredict(uploadResp);

        const detJson = normalizeDetections(gradioOut);
        jsonOut.textContent = pretty(detJson);

        if (drawBoxesInput.checked) {
            drawBoxes(detJson);
        } else {
            clearOverlay();
        }

        setStatus("running", "Berjalan");
    } catch (err) {
        setStatus("error", "Error");
        jsonOut.textContent = pretty({ error: String(err?.message || err) });
        // tetap lanjut loop berikutnya
    } finally {
        busy = false;
    }
}

// =====================
// 9) Event handlers
// =====================
btnStart.addEventListener("click", async () => {
    btnStart.disabled = true;
    try {
        await startCamera();

        const intervalMs = Math.max(250, parseInt(intervalMsInput.value || "500", 10));
        timer = setInterval(tick, intervalMs);

        btnStop.disabled = false;
    } catch (e) {
        setStatus("error", "Gagal akses kamera");
        jsonOut.textContent = pretty({ error: String(e?.message || e) });
        btnStart.disabled = false;
    }
});

btnStop.addEventListener("click", () => {
    btnStop.disabled = true;
    if (timer) clearInterval(timer);
    timer = null;
    busy = false;
    stopCamera();
    btnStart.disabled = false;
});

btnClear.addEventListener("click", () => {
    jsonOut.textContent = "{}";
    clearOverlay();
});

// Saat user ubah interval ketika jalan, kita restart interval
intervalMsInput.addEventListener("change", () => {
    if (!timer) return;
    clearInterval(timer);
    const intervalMs = Math.max(250, parseInt(intervalMsInput.value || "500", 10));
    timer = setInterval(tick, intervalMs);
});
