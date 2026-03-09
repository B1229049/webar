import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = "https://msuhvjhznkodpjfjpaia.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1zdWh2amh6bmtvZHBqZmpwYWlhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjQ4MzEwMTMsImV4cCI6MjA4MDQwNzAxM30.32jirKcLxE-sF3ICPD_yitBsO42JorbUgahz_1RAqoY";

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// DOM
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
let backendReady = false;

// Toast
function showToast(msg, duration = 2500) {
  toastEl.textContent = msg;
  toastEl.style.opacity = "1";
  if (toastEl._timer) clearTimeout(toastEl._timer);
  toastEl._timer = setTimeout(() => {
    toastEl.style.opacity = "0";
  }, duration);
}

// Step 切換
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

goStep2Btn.addEventListener("click", () => {
  const name = nameInput.value.trim();
  if (!name) {
    showToast("請先輸入姓名");
    return;
  }
  goStep2();
});

backStep1Btn.addEventListener("click", () => {
  goStep1();
});

// 相機控制
async function startCamera() {
  if (cameraStream) return;

  try {
    cameraStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: "user" },
      audio: false,
    });
    regVideo.srcObject = cameraStream;

    await new Promise((resolve) => {
      regVideo.onloadedmetadata = () => {
        regVideo.play().catch(() => {});
        resolve();
      };
    });
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

  regVideo.style.display = "none";
  previewCanvas.style.display = "none";
  placeholder.style.display = "flex";
  currentMode = "idle";
  capturedImage = null;
}

// face-api 模型
const MODEL_URL = "https://cdn.jsdelivr.net/npm/@vladmandic/face-api/model";

async function initTfBackend() {
  try {
    if (!window.faceapi || !faceapi.tf) {
      throw new Error("faceapi 或 tf 尚未載入");
    }

    const tf = faceapi.tf;

    if (tf.wasm && typeof tf.wasm.setWasmPaths === "function") {
      const wasmBase = new URL("./", import.meta.url).href;
      console.log("[register] WASM 路徑 =", wasmBase);
      tf.wasm.setWasmPaths(wasmBase);
    }

    try {
      console.log("[register] 嘗試 backend = wasm");
      await tf.setBackend("wasm");
      await tf.ready();
      console.log("[register] 目前 backend =", tf.getBackend());

      if (tf.getBackend() === "wasm") {
        return true;
      }
    } catch (e) {
      console.warn("[register] wasm 初始化失敗：", e);
    }

    try {
      console.log("[register] 回退 backend = cpu");
      await tf.setBackend("cpu");
      await tf.ready();
      console.log("[register] 目前 backend =", tf.getBackend());

      if (tf.getBackend() === "cpu") {
        return true;
      }
    } catch (e) {
      console.error("[register] cpu 初始化失敗：", e);
    }

    return false;
  } catch (e) {
    console.error("[register] backend 初始化總失敗：", e);
    return false;
  }
}

async function loadFaceApiModels() {
  await Promise.all([
    faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_URL),
    faceapi.nets.faceLandmark68Net.loadFromUri(MODEL_URL),
    faceapi.nets.faceRecognitionNet.loadFromUri(MODEL_URL),
  ]);
  modelsReady = true;
  console.log("[register] face-api 模型載入完成");
  showToast("臉部模型已載入，可以拍照或上傳照片");
}

window.addEventListener("load", async () => {
  try {
    if (!window.faceapi) {
      console.error("faceapi 未載入，請確認 HTML 中有 face-api script");
      showToast("臉部模組載入失敗");
      return;
    }

    backendReady = await initTfBackend();
    if (!backendReady) {
      showToast("TFJS backend 初始化失敗");
      return;
    }

    await loadFaceApiModels();
  } catch (e) {
    console.error(e);
    showToast("臉部模組載入失敗");
  }
});

// 拍照
takePhotoBtn.addEventListener("click", async () => {
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

  if (currentMode === "captured") {
    await startCamera();
    if (!cameraStream) return;

    previewCanvas.style.display = "none";
    regVideo.style.display = "block";

    currentMode = "preview";
    showToast("重新拍攝模式");
  }
});

// 上傳照片
uploadPhoto.addEventListener("change", () => {
  const file = uploadPhoto.files[0];
  if (!file) return;

  const img = new Image();
  img.onload = () => {
    stopCamera();

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

// 註冊
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

  if (!backendReady) {
    showToast("TFJS backend 尚未初始化完成");
    return;
  }

  if (!modelsReady) {
    showToast("臉部模型尚未載入完成，請稍候");
    return;
  }

  registerBtn.disabled = true;
  registerBtn.textContent = "註冊中…";

  try {
    const detection = await faceapi
      .detectSingleFace(
        capturedImage,
        new faceapi.TinyFaceDetectorOptions({ inputSize: 320, scoreThreshold: 0.4 })
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