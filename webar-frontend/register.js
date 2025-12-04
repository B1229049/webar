// register.js - 兩階段註冊 + 上傳 / 拍照 + Supabase + 自動跳轉

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// ★★★ 改成你的 Supabase 設定 ★★★
const SUPABASE_URL = "https://msuhvjhznkodpjfjpaia.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1zdWh2amh6bmtvZHBqZmpwYWlhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjQ4MzEwMTMsImV4cCI6MjA4MDQwNzAxM30.32jirKcLxE-sF3ICPD_yitBsO42JorbUgahz_1RAqoY";

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// DOM 取得
const step1 = document.getElementById("step1");
const step2 = document.getElementById("step2");
const dotStep1 = document.getElementById("dot-step1");
const dotStep2 = document.getElementById("dot-step2");

const nextBtn = document.getElementById("nextBtn");
const backBtn = document.getElementById("backBtn");

const uploadPhoto = document.getElementById("uploadPhoto");
const regVideo = document.getElementById("regVideo");
const takePhotoBtn = document.getElementById("takePhotoBtn");
const previewCanvas = document.getElementById("previewCanvas");
const submitFaceBtn = document.getElementById("submitFaceBtn");

const toastEl = document.getElementById("toast");

// 暫存使用者 ID 與圖片來源
let createdUserId = null;
let capturedImage = null;
let cameraStream = null;

// ---- 小工具：Toast 訊息 ----
function showToast(msg, duration = 3000) {
  toastEl.textContent = msg;
  toastEl.classList.add("show");
  setTimeout(() => {
    toastEl.classList.remove("show");
  }, duration);
}

// ---- Step 切換 ----
function goToStep(step) {
  if (step === 1) {
    step1.style.display = "block";
    step2.style.display = "none";
    dotStep1.classList.add("active");
    dotStep2.classList.remove("active");
  } else {
    step1.style.display = "none";
    step2.style.display = "block";
    dotStep1.classList.remove("active");
    dotStep2.classList.add("active");
  }
}

// ---- Step1：建立使用者資料 ----
nextBtn.addEventListener("click", async () => {
  const name = document.getElementById("name").value.trim();
  const nickname = document.getElementById("nickname").value.trim();
  const description = document.getElementById("description").value.trim();
  const extra = document.getElementById("extra").value.trim();

  if (!name) {
    showToast("姓名是必填欄位喔！");
    return;
  }

  nextBtn.disabled = true;
  nextBtn.textContent = "建立中…";

  const { data, error } = await supabase
    .from("users")
    .insert([
      {
        name,
        nickname,
        description,
        extra_info: extra,
      }
    ])
    .select()
    .single();

  nextBtn.disabled = false;
  nextBtn.textContent = "下一步：註冊臉部 →";

  if (error) {
    console.error("建立使用者失敗：", error);
    showToast("建立使用者失敗：" + error.message);
    return;
  }

  createdUserId = data.id;
  console.log("使用者建立成功，ID =", createdUserId);
  showToast("使用者建立成功！請繼續註冊臉部。");

  // 進到 Step 2
  goToStep(2);
  //startCamera();
});

backBtn.addEventListener("click", () => {
  goToStep(1);
});

// ---- 相機處理 ----
async function startCamera() {
  try {
    cameraStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: "user" }
    });
    regVideo.srcObject = cameraStream;
  } catch (err) {
    console.error("無法開啟相機：", err);
    showToast("無法開啟相機，請檢查權限設定。");
  }
}

// ---- 方式 A：上傳照片 ----
uploadPhoto.addEventListener("change", () => {
  const file = uploadPhoto.files[0];
  if (!file) return;

  const img = new Image();
  img.onload = () => {
    previewCanvas.width = img.width;
    previewCanvas.height = img.height;
    const ctx = previewCanvas.getContext("2d");
    ctx.drawImage(img, 0, 0);
    capturedImage = previewCanvas;
    showToast("已載入上傳照片！");
  };
  img.src = URL.createObjectURL(file);
});

// ---- 方式 B：使用鏡頭拍照 ----
takePhotoBtn.addEventListener("click", async () => {
  if (!regVideo.srcObject) {
    await startCamera();
    showToast("鏡頭已啟動，再按一次拍照");
    return;
  }

  previewCanvas.width = regVideo.videoWidth;
  previewCanvas.height = regVideo.videoHeight;
  previewCanvas.getContext("2d").drawImage(regVideo, 0, 0);

  previewCanvas.style.display = "block";  // ← 照片出現在同一框框內

  capturedImage = previewCanvas;
  showToast("拍照成功！");
});



// ---- face-api 模型載入 ----
const MODEL_URL = "https://cdn.jsdelivr.net/npm/@vladmandic/face-api/model";

async function loadModels() {
  await Promise.all([
    faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_URL),
    faceapi.nets.faceLandmark68Net.loadFromUri(MODEL_URL),
    faceapi.nets.faceRecognitionNet.loadFromUri(MODEL_URL)
  ]);
  console.log("face-api 模型載入完成");
  showToast("臉部模型載入完成，請上傳或拍照。");
}

window.addEventListener("load", () => {
  if (!window.faceapi) {
    console.error("faceapi 未載入，請檢查 <script> 標籤");
    showToast("face-api 載入失敗，請稍後重試");
    return;
  }
  loadModels();
});

// ---- 完成臉部註冊 ----
submitFaceBtn.addEventListener("click", async () => {
  if (!createdUserId) {
    showToast("請先完成 Step 1 建立使用者資料");
    return;
  }
  if (!capturedImage) {
    showToast("請先上傳或拍一張照片！");
    return;
  }

  submitFaceBtn.disabled = true;
  submitFaceBtn.textContent = "分析中，請稍候…";

  const detection = await faceapi
    .detectSingleFace(capturedImage, new faceapi.TinyFaceDetectorOptions())
    .withFaceLandmarks()
    .withFaceDescriptor();

  if (!detection) {
    submitFaceBtn.disabled = false;
    submitFaceBtn.textContent = "完成註冊並啟用臉部辨識";
    showToast("偵測不到臉，請換一張清楚正臉的照片。");
    return;
  }

  const embedding = Array.from(detection.descriptor);

  const { error } = await supabase
    .from("users")
    .update({ face_embedding: embedding })
    .eq("id", createdUserId);

  submitFaceBtn.disabled = false;
  submitFaceBtn.textContent = "完成註冊並啟用臉部辨識";

  if (error) {
    console.error("寫入 embedding 失敗：", error);
    showToast("寫入臉部特徵失敗：" + error.message);
    return;
  }

  showToast("註冊完成！3 秒後自動前往 WebAR 主頁～", 3000);

  // 停止相機
  if (cameraStream) {
    cameraStream.getTracks().forEach((t) => t.stop());
  }

  // 自動跳轉到 index.html（WebAR 頁面）
  setTimeout(() => {
    window.location.href = "../index.html"; // 依你的主頁檔名調整
  }, 3000);
});
