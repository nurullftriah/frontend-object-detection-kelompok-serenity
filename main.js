// ====== CONFIG ======
const HF_PREDICT_URL = "https://andinurulfitiriah-object-detection-serenity.hf.space/predict";

// ====== DOM ======
const video = document.getElementById("video");
const canvas = document.getElementById("canvas");         // hidden capture canvas
const overlay = document.getElementById("overlay");       // bbox canvas (visible)
const ctx = canvas.getContext("2d");
const octx = overlay.getContext("2d");

const btnStart = document.getElementById("btnStart");
const btnStop = document.getElementById("btnStop");
const btnClear = document.getElementById("btnClear");

const intervalEl = document.getElementById("interval");
const minConfEl = document.getElementById("minConf");
const drawBoxesEl = document.getElementById("drawBoxes");

const out = document.getElementById("out");
const statusEl = document.getElementById("status");
const endpointText = document.getElementById("endpointText");
endpointText.textContent = HF_PREDICT_URL;

// ====== STATE ======
let stream = null;
let timer = null;
let running = false;

// ====== HELPERS ======
function setStatus(type, text){
  statusEl.classList.remove("idle","ok","err");
  statusEl.classList.add(type);
  statusEl.textContent = `Status: ${text}`;
}

function pretty(obj){
  try { return JSON.stringify(obj, null, 2); }
  catch { return String(obj); }
}

function resizeOverlayToVideo(){
  // overlay canvas harus sama ukuran tampilan video (CSS membuatnya full)
  const rect = video.getBoundingClientRect();
  overlay.width = Math.floor(rect.width);
  overlay.height = Math.floor(rect.height);
}

function clearBoxes(){
  octx.clearRect(0,0,overlay.width, overlay.height);
}

function drawBoxes(detections){
  clearBoxes();
  if (!drawBoxesEl.checked) return;

  // detections bbox diasumsikan [x1, y1, x2, y2] pada ukuran gambar input
  // Kita skalakan dari ukuran frame (canvas.width/height) ke overlay.width/height
  const sx = overlay.width / canvas.width;
  const sy = overlay.height / canvas.height;

  octx.lineWidth = 2;
  octx.font = "14px ui-sans-serif, system-ui, Arial";
  octx.textBaseline = "top";

  detections.forEach((d) => {
    const bbox = d?.bbox;
    if (!bbox || bbox.length < 4) return;

    const [x1, y1, x2, y2] = bbox;
    const x = x1 * sx;
    const y = y1 * sy;
    const w = (x2 - x1) * sx;
    const h = (y2 - y1) * sy;

    octx.strokeStyle = "rgba(45,108,255,0.95)";
    octx.fillStyle = "rgba(45,108,255,0.18)";
    octx.fillRect(x, y, w, h);
    octx.strokeRect(x, y, w, h);

    const label = d?.label ?? "obj";
    const conf = typeof d?.confidence === "number" ? d.confidence : null;
    const text = conf !== null ? `${label} (${conf.toFixed(2)})` : label;

    const pad = 4;
    const tw = octx.measureText(text).width;
    octx.fillStyle = "rgba(0,0,0,0.6)";
    octx.fillRect(x, y, tw + pad*2, 18 + pad);
    octx.fillStyle = "white";
    octx.fillText(text, x + pad, y + pad);
  });
}

function dataURLtoBlob(dataURL){
  const [meta, b64] = dataURL.split(",");
  const mime = meta.match(/data:(.*);base64/)?.[1] ?? "image/jpeg";
  const bin = atob(b64);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return new Blob([arr], { type: mime });
}

// ====== HF CALL (Gradio) ======
// Banyak Space Gradio menerima multipart/form-data key "image".
// Ini paling kompatibel untuk input gambar.
async function callHFPredict(imageBlob){
  const fd = new FormData();
  // nama field "image" umumnya sesuai komponen gradio Image (label "Unggah Gambar")
  fd.append("image", imageBlob, "frame.jpg");

  const res = await fetch(HF_PREDICT_URL, {
    method: "POST",
    body: fd
  });

  // 405 = salah endpoint / salah metode
  if (!res.ok){
    const text = await res.text().catch(() => "");
    throw new Error(`HTTP ${res.status} ${res.statusText}${text ? " - " + text.slice(0,120) : ""}`);
  }

  // Gradio kadang return JSON, kadang text JSON
  const ct = res.headers.get("content-type") || "";
  if (ct.includes("application/json")) return await res.json();
  const t = await res.text();
  try { return JSON.parse(t); } catch { return { raw: t }; }
}

// ====== MAIN LOOP ======
async function tick(){
  if (!running) return;

  try{
    setStatus("idle", "Mengambil frame...");

    // set ukuran capture canvas mengikuti video asli
    const vw = video.videoWidth || 640;
    const vh = video.videoHeight || 480;
    canvas.width = vw;
    canvas.height = vh;

    // gambar frame ke canvas
    ctx.drawImage(video, 0, 0, vw, vh);

    // kirim JPEG blob
    const dataURL = canvas.toDataURL("image/jpeg", 0.85);
    const blob = dataURLtoBlob(dataURL);

    setStatus("idle", "Mengirim ke API...");
    const resp = await callHFPredict(blob);

    // Normalisasi output (bisa beda bentuk tergantung app.py kamu)
    // Target bentuk:
    // { total: n, detections: [{label, confidence, bbox:[x1,y1,x2,y2]}] }
    let normalized = resp;

    // Kalau Gradio mengembalikan array/tuple, coba mapping sederhana
    // (biar tetap kelihatan outputnya)
    if (Array.isArray(resp)) {
      normalized = { result: resp };
    }

    // Filter confidence minimum jika format sesuai
    const minConf = Number(minConfEl.value || 0);
    const dets = normalized?.detections;
    if (Array.isArray(dets)) {
      const filtered = dets.filter(d => (typeof d.confidence === "number" ? d.confidence >= minConf : true));
      normalized = { ...normalized, detections: filtered, total: filtered.length };
      drawBoxes(filtered);
    } else {
      clearBoxes();
    }

    out.textContent = pretty(normalized);
    setStatus("ok", "Berhasil");
  } catch (err){
    clearBoxes();
    out.textContent = pretty({ error: String(err?.message || err) });
    setStatus("err", "Error");
  } finally {
    const ms = Math.max(250, Number(intervalEl.value || 500));
    timer = setTimeout(tick, ms);
  }
}

// ====== CAMERA CONTROL ======
async function startCamera(){
  if (stream) return;

  // coba kamera belakang jika HP (facingMode environment)
  stream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode: { ideal: "environment" } },
    audio: false,
  });

  video.srcObject = stream;

  await new Promise((resolve) => {
    video.onloadedmetadata = () => resolve();
  });

  // set overlay sesuai ukuran tampilan video
  resizeOverlayToVideo();
  window.addEventListener("resize", resizeOverlayToVideo);

  setStatus("idle", "Kamera aktif");
}

function stopCamera(){
  if (!stream) return;
  stream.getTracks().forEach(t => t.stop());
  stream = null;
  video.srcObject = null;
  window.removeEventListener("resize", resizeOverlayToVideo);
  clearBoxes();
}

function startLoop(){
  running = true;
  btnStart.disabled = true;
  btnStop.disabled = false;
  tick();
}

function stopLoop(){
  running = false;
  btnStart.disabled = false;
  btnStop.disabled = true;
  if (timer) clearTimeout(timer);
  timer = null;
  setStatus("idle", "Idle");
}

// ====== EVENTS ======
btnStart.addEventListener("click", async () => {
  try{
    await startCamera();
    startLoop();
  } catch (e){
    out.textContent = pretty({ error: "Tidak bisa akses kamera. Pastikan izin kamera diaktifkan.", detail: String(e) });
    setStatus("err", "Izin kamera ditolak");
  }
});

btnStop.addEventListener("click", () => {
  stopLoop();
  stopCamera();
});

btnClear.addEventListener("click", () => {
  out.textContent = "{}";
  clearBoxes();
  setStatus("idle", "Idle");
});

// Info awal
setStatus("idle", "Idle");
