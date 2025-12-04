// script.js - 主頁：WebAR + 臉辨識（全前端）

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// ★★★ 這兩個改成你自己的 ★★★
const SUPABASE_URL = "https://msuhvjhznkodpjfjpaia.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1zdWh2amh6bmtvZHBqZmpwYWlhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjQ4MzEwMTMsImV4cCI6MjA4MDQwNzAxM30.32jirKcLxE-sF3ICPD_yitBsO42JorbUgahz_1RAqoY";

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// DOM
const video = document.getElementById("videoElement");
const treasure = document.getElementById("treasure");
const canvas = document.getElementById("landmarksCanvas");
const ctx = canvas.getContext("2d");

const userCard = document.getElementById("userCard");
const avatar = document.getElementById("avatar");
const nameEl = document.getElementById("name");
const nicknameEl = document.getElementById("nickname");
const descriptionEl = document.getElementById("description");
const extraInfoEl = document.getElementById("extraInfo");

canvas.width = window.innerWidth;
canvas.height = window.innerHeight;

// ---- 啟動流程 ----
window.addEventListener("load", () => {
  main().catch((e) => console.error("主程式錯誤：", e));
});

async function main() {
  // 1. 等待 faceapi 載入
  if (!window.faceapi) {
    console.error("faceapi 沒載到，請檢查 index.html 的 script 標籤");
    return;
  }

  const MODEL_URL = "https://cdn.jsdelivr.net/npm/@vladmandic/face-api/model";

  await Promise.all([
    faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_URL),
    faceapi.nets.faceLandmark68Net.loadFromUri(MODEL_URL),
    faceapi.nets.faceRecognitionNet.loadFromUri(MODEL_URL),
  ]);
  console.log("face-api.js models loaded");

  // 2. 開相機
  await startCamera();

  // 3. 設定 FaceMesh
  setupFaceMesh();
}

// ---- 相機 ----
async function startCamera() {
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode: "user" },
    audio: false,
  });
  video.srcObject = stream;
}

// ---- FaceMesh ----
function setupFaceMesh() {
  const FaceMeshCtor = window.FaceMesh;
  if (!FaceMeshCtor) {
    console.error("MediaPipe FaceMesh 未載入");
    return;
  }

  const faceMesh = new FaceMeshCtor({
    locateFile: (file) =>
      `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh@0.4/${file}`,
  });

  faceMesh.setOptions({
    maxNumFaces: 1,
    refineLandmarks: true,
    minDetectionConfidence: 0.6,
    minTrackingConfidence: 0.6,
  });

  faceMesh.onResults(onResults);

  const camera = new Camera(video, {
    onFrame: async () => {
      await faceMesh.send({ image: video });
    },
    width: 1280,
    height: 720,
  });
  camera.start();
}

// ---- FaceMesh callback：更新寶箱位置 + 偶爾做辨識 ----
async function onResults(results) {
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  if (!results.multiFaceLandmarks || results.multiFaceLandmarks.length === 0) {
    return;
  }

  const lm = results.multiFaceLandmarks[0];
  const forehead = lm[10];
  const chin = lm[152];

  const headHeight = (chin.y - forehead.y) * window.innerHeight;
  const screenX = forehead.x * window.innerWidth;
  const screenY = forehead.y * window.innerHeight - headHeight * 0.6;

  treasure.style.left = `${screenX}px`;
  treasure.style.top = `${screenY}px`;

  // 每 1 秒做一次臉辨識
  if (!window._lastRecognize || Date.now() - window._lastRecognize > 1000) {
    window._lastRecognize = Date.now();
    const matchedUser = await recognizeFace();
    if (matchedUser) {
      showUserCard(matchedUser);
    }
  }
}

// ---- 臉辨識：用 face-api.js 的 descriptor + Supabase 的 face_embedding ----
async function recognizeFace() {
  const { data: users, error } = await supabase.from("users").select("*");
  if (error) {
    console.error("讀取 users 失敗：", error);
    return null;
  }

  const detection = await faceapi
    .detectSingleFace(video, new faceapi.TinyFaceDetectorOptions())
    .withFaceLandmarks()
    .withFaceDescriptor();

  if (!detection) {
    return null;
  }

  const desc = detection.descriptor;
  let bestUser = null;
  let bestDist = 999;

  for (const user of users) {
    if (!user.face_embedding) continue;

    const dist = faceapi.euclideanDistance(desc, user.face_embedding);
    if (dist < bestDist) {
      bestDist = dist;
      bestUser = user;
    }
  }

  // 門檻可以調，越小越嚴格
  if (bestDist < 0.5) {
    console.log("辨識到：", bestUser.name, "距離", bestDist);
    return bestUser;
  } else {
    console.log("沒有找到足夠相似的人，最小距離：", bestDist);
    return null;
  }
}

// ---- 顯示使用者卡片 ----
function showUserCard(user) {
  avatar.src = user.avatar_url || "";
  nameEl.textContent = user.name || "";
  nicknameEl.textContent = user.nickname || "";
  descriptionEl.textContent = user.description || "";
  extraInfoEl.textContent = user.extra_info || "";

  userCard.style.display = "block";
}
