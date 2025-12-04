// script.js

// ---------------- Supabase 初始化（只在載入時呼叫一次） ----------------
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// TODO：換成你的 anon key（不要用 service_role）
const SUPABASE_URL = "https://msuhvjhznkodpjfjpaia.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1zdWh2amh6bmtvZHBqZmpwYWlhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjQ4MzEwMTMsImV4cCI6MjA4MDQwNzAxM30.32jirKcLxE-sF3ICPD_yitBsO42JorbUgahz_1RAqoY";

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// ---------------- DOM ----------------
const video = document.getElementById("videoElement");
const canvas = document.getElementById("landmarksCanvas");
const ctx = canvas.getContext("2d");

const userTag = document.getElementById("userTag");
const tagName = document.getElementById("tagName");
const tagNickname = document.getElementById("tagNickname");

// 尺寸
function resizeCanvas() {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
}
resizeCanvas();
window.addEventListener("resize", resizeCanvas);

// ---------------- 狀態 ----------------
let modelsReady = false;
let userCache = [];      // 只在載入時寫入一次
let lastRecognizeTime = 0;

// ---------------- 啟動 ----------------
window.addEventListener("load", () => {
  main().catch((e) => console.error("主程式錯誤：", e));
});

async function main() {
  // 1. face-api 模型
  if (!window.faceapi) {
    console.error("faceapi 沒載到，請檢查 index.html 的 script 標籤");
    return;
  }

  console.log("[init] 載入 face-api 模型...");
  const MODEL_URL = "https://cdn.jsdelivr.net/npm/@vladmandic/face-api/model";
  await Promise.all([
    faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_URL),
    faceapi.nets.faceLandmark68Net.loadFromUri(MODEL_URL),
    faceapi.nets.faceRecognitionNet.loadFromUri(MODEL_URL),
  ]);
  modelsReady = true;
  console.log("[init] face-api 模型載入完成");

  // 2. Supabase 只抓一次資料（這裡才會打資料庫）
  await loadUserCache();

  // 3. 相機
  await startCamera();

  // 4. MediaPipe FaceMesh
  setupFaceMesh();
}

// ---------------- Supabase：只抓一次 users → userCache ----------------
// ---------------- Supabase：只抓一次 users → userCache ----------------
async function loadUserCache() {
  console.log("[supabase] 開始載入 users...");

  const { data: users, error } = await supabase
    .from("users")
    .select("id, name, nickname, description, extra_info, face_embedding");

  if (error) {
    console.error("[supabase] 載入 users 失敗：", error);
    return;
  }

  console.log("[supabase] 原始 users 資料：", users);

  if (!users || users.length === 0) {
    console.warn("[supabase] users 表目前沒有資料");
  }

  userCache = [];

  for (const u of users || []) {
    let emb = u.face_embedding;

    // 1) 如果是字串（例如存成 TEXT / JSON），嘗試 JSON.parse
    if (typeof emb === "string") {
      try {
        const parsed = JSON.parse(emb);
        emb = parsed;
      } catch (e) {
        console.warn("[supabase] face_embedding 無法 JSON.parse：", u.id, emb);
        continue;
      }
    }

    // 2) 如果是物件但不是 Array，也跳過
    if (!Array.isArray(emb) || emb.length === 0) {
      console.warn("[supabase] face_embedding 不是 array 或為空：", u.id, emb);
      continue;
    }

    userCache.push({
      id: u.id,
      name: u.name,
      nickname: u.nickname,
      description: u.description,
      extra_info: u.extra_info,
      embedding: new Float32Array(emb),
    });
  }

  console.log("[supabase] userCache 建立完成，筆數 =", userCache.length);
  if (userCache.length > 0) {
    showUserTag(userCache[0]);
    userTag.style.left = "100px";
    userTag.style.top = "100px";
    console.log("[test] 強制顯示第一位使用者的名牌在左上角");

    setTimeout(() => {
      userTag.style.display = "none";
      console.log("[test] 測試名牌隱藏，接下來交給臉部辨識控制");
    }, 3000);
  }
}


// ---------------- 相機 ----------------
async function startCamera() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: "user" },
      audio: false,
    });
    video.srcObject = stream;
    console.log("[camera] 已開啟相機");
  } catch (err) {
    console.error("[camera] 開啟相機失敗：", err);
  }
}

// ---------------- MediaPipe FaceMesh ----------------
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

  console.log("[facemesh] 啟動 Camera + FaceMesh...");
  camera.start();
}

// ---------------- FaceMesh callback：頭部追蹤 + 每秒辨識一次 ----------------
async function onResults(results) {
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  if (!results.multiFaceLandmarks || results.multiFaceLandmarks.length === 0) {
    userTag.style.display = "none";
    return;
  }

  const lm = results.multiFaceLandmarks[0];

  const forehead = lm[10];
  const chin = lm[152];

  const headHeight = (chin.y - forehead.y) * window.innerHeight;
  const screenX = forehead.x * window.innerWidth;
  const screenY = forehead.y * window.innerHeight - headHeight * 0.8;

  // 放在頭上
  userTag.style.left = `${screenX}px`;
  userTag.style.top = `${screenY}px`;

  // 每 1 秒做一次辨識（只用 userCache，完全不打 DB）
  const now = Date.now();
  if (modelsReady && now - lastRecognizeTime > 1000) {
    lastRecognizeTime = now;
    const matchedUser = await recognizeFaceLocal();
    if (matchedUser) {
      showUserTag(matchedUser);
    } else {
      userTag.style.display = "none";
    }
  }
}

// ---------------- 臉部辨識（本地計算，不打 DB） ----------------
async function recognizeFaceLocal() {
  if (!userCache.length) {
    console.warn("[recognize] userCache 為空，無法比對臉部");
    return null;
  }

  const detection = await faceapi
    .detectSingleFace(video, new faceapi.TinyFaceDetectorOptions())
    .withFaceLandmarks()
    .withFaceDescriptor();

  if (!detection) {
    console.log("[recognize] 畫面中偵測不到臉");
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

  console.log("[recognize] 最小距離 =", bestDist, "；使用者 =", bestUser?.name);

  // 門檻可以先放寬一點（例如 0.6），你可以之後再調。
  const THRESHOLD = 0.6;
  if (bestUser && bestDist < THRESHOLD) {
    console.log("[recognize] 通過門檻，辨識為：", bestUser.name);
    return bestUser;
  }

  return null;
}

// ---------------- 顯示浮動使用者名牌 ----------------
function showUserTag(user) {
  console.log("[showUserTag] 顯示：", user.name);  // ← 可以幫你確認有沒有被呼叫
  tagName.textContent = user.name || "";
  tagNickname.textContent = user.nickname ? `@${user.nickname}` : "";

  userTag.style.display = "block";
}
