import { Client } from "https://cdn.jsdelivr.net/npm/@gradio/client/dist/index.min.js";

const SPACE = "andinurulfitiriah/object-detection-serenity"; // ini sesuai screenshot kamu
const API_NAME = "/predict"; // sesuai screenshot

const video = document.getElementById("video");
const canvas = document.getElementById("canvas");
const out = document.getElementById("out");
const statusEl = document.getElementById("status");
const btnStart = document.getElementById("btnStart");
const btnStop = document.getElementById("btnStop");
const intervalInput = document.getElementById("interval");

let stream = null;
let timer = null;
let client = null;
let busy = false;

function setStatus(t) {
  statusEl.textContent = `Status: ${t}`;
}

async function initClient() {
  if (!client) client = await Client.connect(SPACE);
  return client;
}

function captureFrameAsDataURL() {
  const ctx = canvas.getContext("2d");
  // sesuaikan canvas dengan ukuran video agar tidak distorsi
  canvas.width = video.videoWidth || 480;
  canvas.height = video.videoHeight || 360;
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
  // kirim sebagai jpeg agar kecil
  return canvas.toDataURL("image/jpeg", 0.85);
}

async function predictOnce() {
  if (busy) return;
  busy = true;

  try {
    setStatus("Mengirim frame...");
    const c = await initClient();

    const dataUrl = captureFrameAsDataURL();

    // Gradio Image input menerima dict { url: "...base64..." } (sesuai “Accepts 1 parameter”)
    const result = await c.predict(API_NAME, [
      { url: dataUrl } // ini kunci utamanya
    ]);

    out.textContent = JSON.stringify(result, null, 2);
    setStatus("OK");
  } catch (e) {
    out.textContent = JSON.stringify({ error: String(e) }, null, 2);
    setStatus("Error");
  } finally {
    busy = false;
  }
}

async function startCamera() {
  stream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode: "environment" }, // di HP akan pakai kamera belakang kalau bisa
    audio: false
  });
  video.srcObject = stream;

  await new Promise((r) => (video.onloadedmetadata = r));
  await video.play();
}

function stopCamera() {
  if (stream) {
    stream.getTracks().forEach((t) => t.stop());
    stream = null;
  }
}

btnStart.addEventListener("click", async () => {
  btnStart.disabled = true;
  btnStop.disabled = false;

  try {
    setStatus("Inisialisasi kamera...");
    await startCamera();

    setStatus("Mulai deteksi...");
    const interval = Math.max(200, Number(intervalInput.value || 500));

    timer = setInterval(predictOnce, interval);
  } catch (e) {
    setStatus("Error");
    out.textContent = JSON.stringify({ error: String(e) }, null, 2);
    btnStart.disabled = false;
    btnStop.disabled = true;
  }
});

btnStop.addEventListener("click", () => {
  btnStop.disabled = true;
  btnStart.disabled = false;

  if (timer) clearInterval(timer);
  timer = null;

  stopCamera();
  setStatus("Idle");
});
