// register.js - 註冊臉部 embedding

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// ★★★ 一樣改成你的 ★★★
const SUPABASE_URL = "https://msuhvjhznkodpjfjpaia.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1zdWh2amh6bmtvZHBqZmpwYWlhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjQ4MzEwMTMsImV4cCI6MjA4MDQwNzAxM30.32jirKcLxE-sF3ICPD_yitBsO42JorbUgahz_1RAqoY";

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const video = document.getElementById("regVideo");
const btn = document.getElementById("registerBtn");

window.addEventListener("load", () => {
  init().catch((e) => console.error("註冊頁錯誤：", e));
});

async function init() {
  if (!window.faceapi) {
    console.error("faceapi 沒載到，請檢查 register.html");
    return;
  }

  // 開相機
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode: "user" },
    audio: false,
  });
  video.srcObject = stream;

  // 載入模型
  const MODEL_URL = "https://cdn.jsdelivr.net/npm/@vladmandic/face-api/model";
  await Promise.all([
    faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_URL),
    faceapi.nets.faceLandmark68Net.loadFromUri(MODEL_URL),
    faceapi.nets.faceRecognitionNet.loadFromUri(MODEL_URL),
  ]);
  console.log("註冊頁 face-api.js models loaded");

  btn.addEventListener("click", onRegisterClick);
}

async function onRegisterClick() {
  const detection = await faceapi
    .detectSingleFace(video, new faceapi.TinyFaceDetectorOptions())
    .withFaceLandmarks()
    .withFaceDescriptor();

  if (!detection) {
    alert("沒看到臉，請再試一次");
    return;
  }

  const embedding = Array.from(detection.descriptor);
  const userId = prompt("請輸入要綁定的使用者 id（數字）：");
  if (!userId) return;

  const { error } = await supabase
    .from("users")
    .update({ face_embedding: embedding })
    .eq("id", userId);

  if (error) {
    console.error("Supabase 更新錯誤：", error);
    alert("更新失敗：" + error.message);
  } else {
    alert("註冊成功！");
  }
}
