// register.js - 兩階段註冊 + 上傳 / 拍照

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// ★★★ 改成你的 ★★★
const SUPABASE_URL = "https://msuhvjhznkodpjfjpaia.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1zdWh2amh6bmtvZHBqZmpwYWlhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjQ4MzEwMTMsImV4cCI6MjA4MDQwNzAxM30.32jirKcLxE-sF3ICPD_yitBsO42JorbUgahz_1RAqoY";

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// ---- DOM ----
const step1 = document.getElementById("step1");
const step2 = document.getElementById("step2");

const nextBtn = document.getElementById("nextBtn");
const backBtn = document.getElementById("backBtn");

const uploadPhoto = document.getElementById("uploadPhoto");
const regVideo = document.getElementById("regVideo");
const takePhotoBtn = document.getElementById("takePhotoBtn");
const previewCanvas = document.getElementById("previewCanvas");
const submitFaceBtn = document.getElementById("submitFaceBtn");

// 儲存 user id
let createdUserId = null;

// -------------- STEP 1：填寫資料 → Supabase Insert -------------------

nextBtn.addEventListener("click", async () => {
  const name = document.getElementById("name").value;
  const nickname = document.getElementById("nickname").value;
  const description = document.getElementById("description").value;
  const extra = document.getElementById("extra").value;
  const avatarUrl = document.getElementById("avatarUrl").value || null;

  if (!name) {
    alert("姓名必填！");
    return;
  }

  const { data, error } = await supabase
    .from("users")
    .insert([
      {
        name,
        nickname,
        description,
        extra_info: extra,
        avatar_url: avatarUrl
      }
    ])
    .select()
    .single();

  if (error) {
    alert("建立使用者失敗：" + error.message);
    return;
  }

  createdUserId = data.id;
  console.log("使用者建立成功：ID =", createdUserId);

  step1.style.display = "none";
  step2.style.display = "block";

  startCamera();
});

// 返回 Step 1
backBtn.addEventListener("click", () => {
  step2.style.display = "none";
  step1.style.display = "block";
});


// -------------- STEP 2：上傳照片 or 拍照 -------------------

let capturedImage = null;

// A. 上傳照片
uploadPhoto.addEventListener("change", () => {
  const file = uploadPhoto.files[0];
  if (!file) return;

  const img = new Image();
  img.onload = () => {
    previewCanvas.width = img.width;
    previewCanvas.height = img.height;
    previewCanvas.getContext("2d").drawImage(img, 0, 0);
    capturedImage = previewCanvas;
  };
  img.src = URL.createObjectURL(file);
});

// B. 開相機（拍照）
async function startCamera() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: "user" }
    });
    regVideo.srcObject = stream;
  } catch (err) {
    console.error("無法開啟相機", err);
    alert("無法開啟相機，請檢查權限");
  }
}

takePhotoBtn.addEventListener("click", () => {
  previewCanvas.width = regVideo.videoWidth;
  previewCanvas.height = regVideo.videoHeight;

  previewCanvas.getContext("2d").drawImage(regVideo, 0, 0);
  capturedImage = previewCanvas;
  console.log("已拍照");
});


// -------------- 臉部 embedding 提取 + Supabase 更新 -------------------

// 載入模型
const MODEL_URL = "https://cdn.jsdelivr.net/npm/@vladmandic/face-api/model";
Promise.all([
  faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_URL),
  faceapi.nets.faceLandmark68Net.loadFromUri(MODEL_URL),
  faceapi.nets.faceRecognitionNet.loadFromUri(MODEL_URL),
]).then(() => {
  console.log("face-api 模型載入完成");
});


submitFaceBtn.addEventListener("click", async () => {
  if (!capturedImage) {
    alert("請先上傳或拍一張臉部照片！");
    return;
  }

  const detection = await faceapi
    .detectSingleFace(capturedImage, new faceapi.TinyFaceDetectorOptions())
    .withFaceLandmarks()
    .withFaceDescriptor();

  if (!detection) {
    alert("偵測不到臉，請換一張照片或重拍！");
    return;
  }

  const embedding = Array.from(detection.descriptor);

  const { error } = await supabase
    .from("users")
    .update({ face_embedding: embedding })
    .eq("id", createdUserId);

  if (error) {
    alert("寫入 embedding 失敗：" + error.message);
    return;
  }

  alert("註冊完成！現在可到 WebAR 主頁自動辨識～");
});
