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

// 多人名牌容器
const tagLayer = document.getElementById("tagLayer");

// 尺寸
function resizeCanvas() {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
}
resizeCanvas();
window.addEventListener("resize", resizeCanvas);

// ---------------- 狀態 ----------------
let modelsReady = false;
let userCache = [];           // 只在載入時寫入一次
let lastRecognizeTime = 0;

// FaceMesh 目前看到的 landmark
let lastFaceLandmarks = null; // array of faces, each is array of 468 points

// 目前辨識到的人：[{ meshIndex, user }]
let trackedFaces = [];

// face-api 偵測器參數（比較靈敏）
const detectorOptions = new faceapi.TinyFaceDetectorOptions({
  inputSize: 320,      // 解析度，越高越準但越慢，可調 224/320/416
  scoreThreshold: 0.4, // 越低會抓到更多臉
});

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
    maxNumFaces: 5,          // 一次最多偵測 5 張臉
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

// ---------------- FaceMesh callback：每幀更新頭部位置 + 定期觸發辨識 ----------------
async function onResults(results) {
  // 1. 畫面清掉（如果有要畫 landmark 可以在這裡畫）
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  if (!results.multiFaceLandmarks || results.multiFaceLandmarks.length === 0) {
    lastFaceLandmarks = null;
    trackedFaces = [];
    clearAllUserTags();
    return;
  }

  // 把最新的 landmarks 存起來，給辨識 / 給名牌定位用
  lastFaceLandmarks = results.multiFaceLandmarks;

  // 2. 每幀根據 FaceMesh 更新名牌位置（高 FPS）
  updateTagPositionsFromMesh();

  // 3. 每 1 秒跑一次 face-api 做身份辨識（低頻率）
  const now = Date.now();
  if (modelsReady && now - lastRecognizeTime > 1000) {
    lastRecognizeTime = now;
    await recognizeFacesLocalMulti();
  }
}

// ---------------- 依照 FaceMesh landmark 更新名牌位置（每幀呼叫） ----------------
function updateTagPositionsFromMesh() {
  if (!lastFaceLandmarks || trackedFaces.length === 0) {
    clearAllUserTags();
    return;
  }

  const rect = video.getBoundingClientRect();
  const W = rect.width;
  const H = rect.height;

  // 先清空，再依目前 trackedFaces 重建名牌
  clearAllUserTags();

  for (const tf of trackedFaces) {
    const meshIndex = tf.meshIndex;
    const user = tf.user;
    const lm = lastFaceLandmarks[meshIndex];
    if (!lm) continue;

    // 取額頭 + 下巴，估計頭高度，讓名牌浮在頭上
    const forehead = lm[10];
    const chin = lm[152];

    const headHeight = (chin.y - forehead.y) * H;
    const screenX = rect.left + forehead.x * W;
    const screenY = rect.top + forehead.y * H - headHeight * 0.8;

    createUserTag(user, screenX, screenY);
  }
}

// ---------------- 多人臉部辨識（本地計算，不打 DB） ----------------
async function recognizeFacesLocalMulti() {
  if (!userCache.length) {
    console.warn("[recognize] userCache 為空，無法比對臉部");
    return;
  }
  if (!lastFaceLandmarks || !lastFaceLandmarks.length) {
    console.warn("[recognize] 沒有 FaceMesh 資料，略過辨識");
    return;
  }

  const detections = await faceapi
    .detectAllFaces(video, detectorOptions)
    .withFaceLandmarks()
    .withFaceDescriptors();

  if (!detections || detections.length === 0) {
    console.log("[recognize] 畫面中偵測不到臉");
    trackedFaces = [];
    return;
  }

  console.log(`[recognize] face-api 偵測到人數：${detections.length}`);

  const videoW = video.videoWidth || 1280;
  const videoH = video.videoHeight || 720;

  // 先算 FaceMesh 每一張臉的大概中心（用額頭點）
  const meshCenters = lastFaceLandmarks.map((lm) => {
    const f = lm[10]; // 額頭附近
    return { cx: f.x, cy: f.y }; // 已經是 0~1 normalized
  });

  const THRESHOLD = 0.75; // 你可以再微調

  const newTracked = [];

  // 對每一個 face-api 偵測結果：
  for (const det of detections) {
    const desc = det.descriptor;

    // 1) 先用 embedding 找出最像的 user
    let bestUser = null;
    let bestUserDist = Infinity;
    for (const user of userCache) {
      const dist = faceapi.euclideanDistance(desc, user.embedding);
      if (dist < bestUserDist) {
        bestUserDist = dist;
        bestUser = user;
      }
    }

    console.log("[recognize] 候選 user =", bestUser?.name, " dist =", bestUserDist);

    if (!bestUser || bestUserDist >= THRESHOLD) {
      // 未通過門檻就不畫名牌
      continue;
    }

    // 2) 算這個 detection 在 video 中心（normalize 到 0~1）
    const box = det.detection.box;
    const detCx = (box.x + box.width / 2) / videoW;
    const detCy = (box.y + box.height / 2) / videoH;

    // 3) 找離它最近的 FaceMesh 臉，綁定 index
    let bestMeshIndex = -1;
    let bestMeshDist2 = Infinity;
    meshCenters.forEach((mc, idx) => {
      const dx = mc.cx - detCx;
      const dy = mc.cy - detCy;
      const d2 = dx * dx + dy * dy;
      if (d2 < bestMeshDist2) {
        bestMeshDist2 = d2;
        bestMeshIndex = idx;
      }
    });

    if (bestMeshIndex === -1) continue;

    console.log(
      "[recognize] 綁定 FaceMesh index =", bestMeshIndex,
      " => user =", bestUser.name
    );

    newTracked.push({
      meshIndex: bestMeshIndex,
      user: bestUser,
    });
  }

  trackedFaces = newTracked;
}

// ---------------- 建立 / 清除 多人名牌 ----------------
function clearAllUserTags() {
  if (!tagLayer) return;
  tagLayer.innerHTML = "";
}

function createUserTag(user, screenX, screenY) {
  if (!tagLayer) return;

  const tag = document.createElement("div");
  tag.className = "user-tag";
  tag.style.left = `${screenX}px`;
  tag.style.top = `${screenY}px`;

  tag.innerHTML = `
    <div class="name">${user.name || ""}</div>
    <div class="nickname">${user.nickname ? "@" + user.nickname : ""}</div>
  `;

  tagLayer.appendChild(tag);
}
