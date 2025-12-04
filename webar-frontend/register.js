import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// ★★★ 改成你自己的 Supabase 設定 ★★★
const SUPABASE_URL = "https://msuhvjhznkodpjfjpaia.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1zdWh2amh6bmtvZHBqZmpwYWlhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjQ4MzEwMTMsImV4cCI6MjA4MDQwNzAxM30.32jirKcLxE-sF3ICPD_yitBsO42JorbUgahz_1RAqoY";

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// DOM
const placeholder = document.getElementById("placeholder");
const regVideo = document.getElementById("regVideo");
const previewCanvas = document.getElementById("previewCanvas");

const takePhotoBtn = document.getElementById("takePhotoBtn");
const uploadPhoto = document.getElementById("uploadPhoto");
const registerBtn = document.getElementById("registerBtn");

const nameInput = document.getElementById("nameInput");
const nicknameInput = document.getElementById("nicknameInput");
const descriptionInput = document.getElementById("descriptionInput");
const extraInfoInput = document.getElementById("extraInfoInput");

const toastEl = document.getElementById("toast");

// 狀態
let currentMode = "idle"; // "idle" | "preview" | "captured"
let cameraStream = null;
let capturedImage = null; // 會指向 previewCanvas
let modelsReady = false;

// ---------- Toast 小工具 ----------
function showToast(msg, duration = 3000) {
  toastEl.textContent = msg;
  toastEl.style.opacity = "1";
  if (toastEl._hideTimer) {
    clearTimeout(toastEl._hideTimer);
  }
  toastEl._hideTimer = setTimeout(() => {
    toastEl.style.opacity = "0";
  }, duration);
}

// ---------- 相機 ----------
async function startCamera() {
  if (cameraStream) return;

  try {
    cameraStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: "user" },
      audio: false,
    });
    regVideo.srcObject = cameraStream;
  } catch (err) {
    console.error("無法開啟相機", err);
    showToast("無法開啟相機，請檢查權限");
  }
}

function stopCamera() {
  if (cameraStream) {
    cameraStream.getTracks().forEach((t) => t.stop());
    cameraStream = null;
    regVideo.srcObject = null;
  }
}

// ---------- face-api 模型載入 ----------
const MODEL_URL = "https://cdn.jsdelivr.net/npm/@vladmandic/face-api/model";

async function loadFaceApiModels() {
  await Promise.all([
    faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_URL),
    faceapi.nets.faceLandmark68Net.loadFromUri(MODEL_URL),
    faceapi.nets.faceRecognitionNet.loadFromUri(MODEL_URL),
  ]);
  modelsReady = true;
  console.log("face-api 模型載入完成");
  showToast("臉部模型載入完成，可以開始上傳或拍照");
}

window.addEventListener("load", () => {
  if (!window.faceapi) {
    console.error("faceapi 未載入，請在 register.html 加上 face-api.js script");
    showToast("face-api 載入失敗，請稍後重試");
    return;
  }
  loadFaceApiModels().catch((e) => {
    console.error(e);
    showToast("臉部模型載入失敗");
  });
});

// ---------- 拍照按鈕：同一框切換邏輯 ----------
takePhotoBtn.addEventListener("click", async () => {
  // 狀態 1：idle → 變成 preview（啟動鏡頭預覽）
  if (currentMode === "idle") {
    await startCamera();
    if (!cameraStream) return;

    placeholder.style.display = "none";
    previewCanvas.style.display = "none";
    regVideo.style.display = "block";

    currentMode = "preview";
    showToast("鏡頭已啟動，再按一次拍照");
    return;
  }

  // 狀態 2：preview → 拍照 → 顯示在 canvas
  if (currentMode === "preview") {
    if (!regVideo.videoWidth || !regVideo.videoHeight) {
      showToast("鏡頭準備中，請再按一次");
      return;
    }

    previewCanvas.width = regVideo.videoWidth;
    previewCanvas.height = regVideo.videoHeight;
    const ctx = previewCanvas.getContext("2d");
    ctx.drawImage(regVideo, 0, 0);

    regVideo.style.display = "none";
    previewCanvas.style.display = "block";

    capturedImage = previewCanvas;
    currentMode = "captured";
    showToast("拍照成功！");
    return;
  }

  // 狀態 3：captured → 再按 → 回到 preview（重新拍攝）
  if (currentMode === "captured") {
    await startCamera();
    if (!cameraStream) return;

    previewCanvas.style.display = "none";
    regVideo.style.display = "block";

    currentMode = "preview";
    showToast("重新拍攝模式");
    return;
  }
});

// ---------- 上傳圖片（直接進入 captured 狀態） ----------
uploadPhoto.addEventListener("change", () => {
  const file = uploadPhoto.files[0];
  if (!file) return;

  const img = new Image();
  img.onload = () => {
    // 顯示 canvas、隱藏其他
    placeholder.style.display = "none";
    regVideo.style.display = "none";
    previewCanvas.style.display = "block";

    previewCanvas.width = img.width;
    previewCanvas.height = img.height;
    const ctx = previewCanvas.getContext("2d");
    ctx.drawImage(img, 0, 0);

    capturedImage = previewCanvas;
    currentMode = "captured";

    // 若有開鏡頭就關掉
    stopCamera();

    showToast("已載入上傳照片");
  };
  img.src = URL.createObjectURL(file);
});

// ---------- 註冊按鈕：寫入 Supabase ----------
registerBtn.addEventListener("click", async () => {
  const name = nameInput.value.trim();
  const nickname = nicknameInput.value.trim();
  const description = descriptionInput.value.trim();
  const extraInfo = extraInfoInput.value.trim();

  if (!name) {
    showToast("姓名是必填欄位");
    return;
  }

  if (!capturedImage) {
    showToast("請先上傳或拍攝一張照片");
    return;
  }

  if (!modelsReady) {
    showToast("臉部模型尚未載入完成，請稍候再試");
    return;
  }

  registerBtn.disabled = true;
  registerBtn.textContent = "註冊中…";

  try {
    // 1. 用 face-api 從 capturedImage 擷取 embedding
    const detection = await faceapi
      .detectSingleFace(
        capturedImage,
        new faceapi.TinyFaceDetectorOptions()
      )
      .withFaceLandmarks()
      .withFaceDescriptor();

    if (!detection) {
      showToast("偵測不到臉，請換照片或重新拍攝");
      registerBtn.disabled = false;
      registerBtn.textContent = "註冊";
      return;
    }

    const embedding = Array.from(detection.descriptor);

    // 2. 寫入 Supabase users
    const { data, error } = await supabase
      .from("users")
      .insert([
        {
          name,
          nickname,
          description,
          extra_info: extraInfo,
          face_embedding: embedding,
        },
      ])
      .select()
      .single();

    if (error) {
      console.error("Supabase insert 錯誤：", error);
      showToast("註冊失敗：" + error.message);
      registerBtn.disabled = false;
      registerBtn.textContent = "註冊";
      return;
    }

    console.log("註冊成功：", data);
    showToast("註冊完成！3 秒後回到首頁");

    // 關掉鏡頭
    stopCamera();

    // 3 秒後回到 ./index.html
    setTimeout(() => {
      window.location.href = "../index.html";
    }, 3000);
  } catch (e) {
    console.error(e);
    showToast("註冊過程發生錯誤");
    registerBtn.disabled = false;
    registerBtn.textContent = "註冊";
  }
});
