// ---------------- Supabase 初始化（ESM） ----------------
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// TODO：把下面兩行改成你自己的 Supabase 設定（用 anon public key）
const SUPABASE_URL = "https://msuhvjhznkodpjfjpaia.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1zdWh2amh6bmtvZHBqZmpwYWlhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjQ4MzEwMTMsImV4cCI6MjA4MDQwNzAxM30.32jirKcLxE-sF3ICPD_yitBsO42JorbUgahz_1RAqoY";

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// ---------------- DOM 取得 ----------------
const video = document.getElementById("videoElement");
const canvas = document.getElementById("landmarksCanvas");
const ctx = canvas.getContext("2d");

// 浮動使用者名牌（取代 card.png）
const userTag = document.getElementById("userTag");
const tagName = document.getElementById("tagName");
const tagNickname = document.getElementById("tagNickname");

// 視窗大小 → 設定 canvas 尺寸
function resizeCanvas() {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
}
resizeCanvas();
window.addEventListener("resize", resizeCanvas);

// ---------------- 狀態 ----------------
let modelsReady = false;       // face-api 模型是否載入完成
let userCache = [];           // 本地快取的使用者資料（含 embedding）
let lastRecognizeTime = 0;    // 上一次做臉部辨識的時間戳

// ---------------- 啟動流程 ----------------
window.addEventListener("load", () => {
  main().catch((e) => console.error("主程式錯誤：", e));
});

async function main() {
  // 1. 確認 face-api 在全域存在（index.html 要先載入 face-api.min.js）
  if (!window.faceapi) {
    console.error("faceapi 沒載到，請檢查 index.html 的 <script> 標籤");
    return;
  }

  // 2. 載入 face-api 模型
  const MODEL_URL = "https://cdn.jsdelivr.net/npm/@vladmandic/face-api/model";
  await Promise.all([
    faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_URL),
    faceapi.nets.faceLandmark68Net.loadFromUri(MODEL_URL),
    faceapi.nets.faceRecognitionNet.loadFromUri(MODEL_URL),
  ]);
  modelsReady = true;
  console.log("face-api.js models loaded");

  // 3. 一次性載入使用者資料（只呼叫 Supabase 一次）
  await loadUserCache();

  // 4. 開相機
  await startCamera();

  // 5. 設定 MediaPipe FaceMesh（做頭部追蹤）
  setupFaceMesh();
}

// ---------------- Supabase：只載入一次 users → userCache ----------------
async function loadUserCache() {
  const { data: users, error } = await supabase
    .from("users")
    .select("id, name, nickname, description, extra_info, face_embedding");

  if (error) {
    console.error("載入 users 失敗：", error);
    return;
  }

  userCache = (users || [])
    .filter((u) => Array.isArray(u.face_embedding) && u.face_embedding.length > 0)
    .map((u) => ({
      id: u.id,
      name: u.name,
      nickname: u.nickname,
      description: u.description,
      extra_info: u.extra_info,
      embedding: new Float32Array(u.face_embedding),
    }));

  console.log("已載入使用者快取，共", userCache.length, "筆");
}

// ---------------- 相機 ----------------
async function startCamera() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: "user" },
      audio: false,
    });
    video.srcObject = stream;
  } catch (err) {
    console.error("開啟相機失敗：", err);
  }
}

// ---------------- MediaPipe FaceMesh 設定 ----------------
function setupFaceMesh() {
  const FM = window.FaceMesh;
  const MP_Camera = window.Camera;

  if (!FM || !MP_Camera) {
    console.error("MediaPipe FaceMesh 或 Camera 未載入，請檢查 face_mesh.js / camera_utils.js");
    return;
  }

  const faceMesh = new FM({
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

  const camera = new MP_Camera(video, {
    onFrame: async () => {
      await faceMesh.send({ image: video });
    },
    width: 1280,
    height: 720,
  });

  camera.start();
}

// ---------------- FaceMesh callback：頭部追蹤 + 每秒辨識一次 ----------------
async function onResults(results) {
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  if (!results.multiFaceLandmarks || results.multiFaceLandmarks.length === 0) {
    // 看不到臉 → 名牌隱藏
    userTag.style.display = "none";
    return;
  }

  const lm = results.multiFaceLandmarks[0];

  // Landmark index 10: 額頭附近, 152: 下巴
  const forehead = lm[10];
  const chin = lm[152];

  // 計算頭的高度（像素單位）
  const headHeight = (chin.y - forehead.y) * window.innerHeight;

  // 頭頂大致位置（額頭再往上）
  const screenX = forehead.x * window.innerWidth;
  const screenY = forehead.y * window.innerHeight - headHeight * 0.8;

  // 把使用者名牌放在頭頂上方
  userTag.style.left = `${screenX}px`;
  userTag.style.top = `${screenY}px`;

  // 每 1 秒做一次臉部辨識（完全不打資料庫）
  const now = Date.now();
  if (modelsReady && now - lastRecognizeTime > 1000) {
    lastRecognizeTime = now;
    const matchedUser = await recognizeFaceLocal();
    if (matchedUser) {
      showUserTag(matchedUser);
    } else {
      // 找不到相似的人就隱藏名牌
      userTag.style.display = "none";
    }
  }
}

// ---------------- 臉部辨識（只比對 userCache，本地運算） ----------------
async function recognizeFaceLocal() {
  if (!userCache.length) {
    console.warn("userCache 為空，無法做臉部比對");
    return null;
  }

  // 用 face-api 在目前 video 畫面偵測臉 + 128維 descriptor
  const detection = await faceapi
    .detectSingleFace(video, new faceapi.TinyFaceDetectorOptions())
    .withFaceLandmarks()
    .withFaceDescriptor();

  if (!detection) {
    return null;
  }

  const desc = detection.descriptor;

  let bestUser = null;
  let bestDist = Infinity;

  for (const user of userCache) {
    const dist = faceapi.euclideanDistance(desc, user.embedding);
    if (dist < bestDist) {
      bestDist = dist;
      bestUser = user;
    }
  }

  // threshold 可依實測調整，通常 0.45 ~ 0.6
  const THRESHOLD = 0.5;
  if (bestUser && bestDist < THRESHOLD) {
    console.log("辨識到：", bestUser.name, "距離:", bestDist);
    return bestUser;
  }

  console.log("沒有找到符合門檻的人，最小距離:", bestDist);
  return null;
}

// ---------------- 顯示頭上的使用者名牌 ----------------
function showUserTag(user) {
  tagName.textContent = user.name || "";
  tagNickname.textContent = user.nickname
    ? `@${user.nickname}`
    : "";

  userTag.style.display = "block";
}
