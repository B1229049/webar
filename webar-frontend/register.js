// 一定要在最上面：ESM 方式載入 Supabase
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// ★★★ 改成你的 Supabase 設定（anon key）★★★
const SUPABASE_URL = "https://msuhvjhznkodpjfjpaia.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1zdWh2amh6bmtvZHBqZmpwYWlhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjQ4MzEwMTMsImV4cCI6MjA4MDQwNzAxM30.32jirKcLxE-sF3ICPD_yitBsO42JorbUgahz_1RAqoY";

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// DOM 取得
const step1 = document.getElementById("step1");
const step2 = document.getElementById("step2");
const stepLabel1 = document.getElementById("stepLabel1");
const stepLabel2 = document.getElementById("stepLabel2");

const goStep2Btn = document.getElementById("goStep2");
const backStep1Btn = document.getElementById("backStep1");

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
let currentMode = "idle"; // idle | preview | captured
let cameraStream = null;
let capturedImage = null;
let modelsReady = false;

// ---------------- Toast 小工具 ----------------
function showToast(msg, duration = 2500) {
  toastEl.textContent = msg;
  toastEl.style.opacity = "1";
  if (toastEl._timer) clearTimeout(toastEl._timer);
  toastEl._timer = setTimeout(() => {
    toastEl.style.opacity = "0";
  }, duration);
}

// ---------------- Step 切換 ----------------
function goStep1() {
  step1.style.display = "block";
  step2.style.display = "none";
  stepLabel1.classList.add("step-active");
  stepLabel2.classList.remove("step-active");
  stopCamera();
}

function goStep2() {
  step1.style.display = "none";
  step2.style.display = "block";
  stepLabel1.classList.remove("step-active");
  stepLabel2.classList.add("step-active");
}

// 按「下一步：拍攝照片」
goStep2Btn.addEventListener("click", () => {
  const name = nameInput.value.trim();
  if (!name) {
    showToast("請先輸入姓名");
    return;
  }
  goStep2();
});

// 按「返回上一步」
backStep1Btn.addEventListener("click", () => {
  goStep1();
});

// ---------------- 相機控制 ----------------
async function startCamera() {
  if (cameraStream) return; // 已啟動就不用再開

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
  // 回到「尚未拍照」的樣子
  regVideo.style.display = "none";
  previewCanvas.style.display = "none";
  placeholder.style.display = "flex";
  currentMode = "idle";
  capturedImage = null;
}

// ---------------- face-api 模型載入 ----------------
const MODEL_URL = "https://cdn.jsdelivr.net/npm/@vladmandic/face-api/model";

async function loadFaceApiModels() {
  await Promise.all([
    faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_URL),
    faceapi.nets.faceLandmark68Net.loadFromUri(MODEL_URL),
    faceapi.nets.faceRecognitionNet.loadFromUri(MODEL_URL),
  ]);
  modelsReady = true;
  console.log("face-api 模型載入完成");
  showToast("臉部模型已載入，可以拍照或上傳照片");
}

window.addEventListener("load", () => {
  if (!window.faceapi) {
    console.error("faceapi 未載入，請確認 HTML 中有 face-api script");
    showToast("臉部模組載入失敗");
    return;
  }
  loadFaceApiModels().catch((e) => {
    console.error(e);
    showToast("臉部模組載入失敗");
  });
});

// ---------------- 拍一張照片（同一框切換） ----------------
takePhotoBtn.addEventListener("click", async () => {
  // 狀態 1：idle → 啟動鏡頭 + 顯示預覽
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

  // 狀態 2：preview → 截圖到 canvas
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

  // 狀態 3：captured → 再按 → 回到鏡頭預覽（重新拍攝）
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

// ---------------- 上傳照片（同一框顯示） ----------------
uploadPhoto.addEventListener("change", () => {
  const file = uploadPhoto.files[0];
  if (!file) return;

  const img = new Image();
  img.onload = () => {
    stopCamera(); // 關鏡頭並重置到 idle，但下面會再改成 captured 顯示

    placeholder.style.display = "none";
    regVideo.style.display = "none";
    previewCanvas.style.display = "block";

    previewCanvas.width = img.width;
    previewCanvas.height = img.height;
    const ctx = previewCanvas.getContext("2d");
    ctx.drawImage(img, 0, 0);

    capturedImage = previewCanvas;
    currentMode = "captured";
    showToast("已載入上傳照片");
  };
  img.src = URL.createObjectURL(file);
});

// ---------------- 註冊：寫入 Supabase ----------------
registerBtn.addEventListener("click", async () => {
  const name = nameInput.value.trim();
  const nickname = nicknameInput.value.trim();
  const description = descriptionInput.value.trim();
  const extraInfo = extraInfoInput.value.trim();

  if (!name) {
    showToast("請先在 Step 1 填寫姓名");
    goStep1();
    return;
  }

  if (!capturedImage) {
    showToast("請先拍照或上傳一張臉部照片");
    return;
  }

  if (!modelsReady) {
    showToast("臉部模型尚未載入完成，請稍候");
    return;
  }

  registerBtn.disabled = true;
  registerBtn.textContent = "註冊中…";

  try {
    // 1. 由 capturedImage 提取 embedding
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
      registerBtn.textContent = "完成註冊";
      return;
    }

    const embedding = Array.from(detection.descriptor);

    // 2. 寫入 Supabase
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
      console.error("Supabase insert error:", error);
      showToast("註冊失敗：" + error.message);
      registerBtn.disabled = false;
      registerBtn.textContent = "完成註冊";
      return;
    }

    console.log("註冊成功：", data);
    showToast("註冊完成！3 秒後回到首頁");

    stopCamera();

    setTimeout(() => {
      window.location.href = "../index.html";
    }, 3000);
  } catch (e) {
    console.error(e);
    showToast("註冊過程發生錯誤");
    registerBtn.disabled = false;
    registerBtn.textContent = "完成註冊";
  }
});
