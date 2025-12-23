const API_BASE_URL = "https://andinurulfitiriah-object-detection-serenity.hf.space";

const imageInput = document.getElementById("imageInput");
const previewBox = document.getElementById("previewBox");
const resultEl = document.getElementById("result");
const statusText = document.getElementById("statusText");
const apiLink = document.getElementById("apiLink");

if (apiLink) {
    apiLink.textContent = `${API_BASE_URL}/predict`;
    apiLink.href = `${API_BASE_URL}/predict`;
}

imageInput?.addEventListener("change", () => {
    const file = imageInput.files?.[0];
    if (!file) return;

    const url = URL.createObjectURL(file);
    previewBox.innerHTML = `<img src="${url}" alt="preview" />`;
    resultEl.textContent = "{}";
    setStatus("Siap", "ok");
});

function setStatus(text, cls) {
    if (!statusText) return;
    statusText.innerHTML = `Status: <span class="${cls}">${text}</span>`;
}

async function sendImage() {
    const file = imageInput.files?.[0];

    if (!file) {
        alert("Pilih gambar terlebih dahulu");
        return;
    }

    const formData = new FormData();
    formData.append("file", file);

    try {
        setStatus("Mengirim gambar...", "ok");

        const res = await fetch(`${API_BASE_URL}/predict`, {
            method: "POST",
            body: formData
        });

        if (!res.ok) {
            const txt = await res.text();
            setStatus("Gagal (HTTP " + res.status + ")", "err");
            resultEl.textContent = txt;
            return;
        }

        const data = await res.json();
        resultEl.textContent = JSON.stringify(data, null, 2);
        setStatus("Berhasil", "ok");
    } catch (err) {
        setStatus("Error jaringan / CORS", "err");
        resultEl.textContent = String(err);
    }
}

function resetAll() {
    imageInput.value = "";
    previewBox.innerHTML = `<span class="status">Preview akan muncul di sini</span>`;
    resultEl.textContent = "{}";
    setStatus("Siap", "ok");
}

window.sendImage = sendImage;
window.resetAll = resetAll;
