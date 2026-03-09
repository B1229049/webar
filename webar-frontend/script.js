// script.js

// ---------------- Supabase 初始化 ----------------
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = "https://msuhvjhznkodpjfjpaia.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1zdWh2amh6bmtvZHBqZmpwYWlhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjQ4MzEwMTMsImV4cCI6MjA4MDQwNzAxM30.32jirKcLxE-sF3ICPD_yitBsO42JorbUgahz_1RAqoY";

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// ---------------- DOM ----------------
const video = document.getElementById("videoElement");
const canvas = document.getElementById("landmarksCanvas");
const ctx = canvas.getContext("2d");
const tagLayer = document.getElementById("tagLayer");

function resizeCanvas() {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
}
resizeCanvas();
window.addEventListener("resize", resizeCanvas);

// ---------------- 狀態 ----------------
let modelsReady = false;
let userCache = [];
let lastRecognizeTime = 0;
let lastFaceLandmarks = null;
let trackedFaces = [];
let detectorOptions = null;

const tagStates = new Map();
const SMOOTHING = 0.2;

// ---------------- 啟動 ----------------
window.addEventListener("load", () => {
  main().catch((e) => console.error("主程式錯誤：", e));
});

async function main() {
  if (!window.faceapi) {
    console.error("faceapi 沒載到，請檢查 camera.html 的 script 標籤");
    return;
  }

  // ⭐ 修復 WASM 404 與初始化錯誤的核心邏輯
  console.log("[init] 配置 TFJS WASM 後端...");
  try {
    if (faceapi.tf && faceapi.tf.wasm) {
      // 告知 face-api 在當前目錄 (./) 尋找你上傳的 .wasm 檔案
      faceapi.tf.wasm.setWasmPaths('./'); 
      
      // 強制切換至 WASM 後端以避開不支援的 WebGL
      await faceapi.tf.setBackend('wasm');
      await faceapi.tf.ready();
      console.log("[init] 目前使用後端：", faceapi.tf.getBackend());
    }
  } catch (e) {
    console.warn("[init] WASM 初始化失敗，嘗試回退預設後端", e);
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

  detectorOptions = new faceapi.TinyFaceDetectorOptions({
    inputSize: 320,
    scoreThreshold: 0.4,
  });

  await loadUserCache(); // 從 Supabase 抓取資料
  await startCamera();
  setupFaceMesh();
}

// ---------------- Supabase 資料處理 ----------------
async function loadUserCache() {
  const { data: users, error } = await supabase
    .from("users")
    .select("id, name, nickname, description, extra_info, face_embedding");

  if (error) {
    console.error("[supabase] 載入失敗：", error);
    return;
  }

  userCache = (users || []).map(u => {
    let emb = u.face_embedding;
    if (typeof emb === "string") emb = JSON.parse(emb);
    return {
      ...u,
      embedding: new Float32Array(emb) // 轉為 face-api 需要的格式
    };
  }).filter(u => u.embedding && u.embedding.length > 0);
  
  console.log("[supabase] 快取建立完成，共", userCache.length, "筆資料");
}

// ---------------- 相機與追蹤 ----------------
async function startCamera() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: "user" },
      audio: false,
    });
    video.srcObject = stream;
  } catch (err) {
    console.error("[camera] 失敗：", err);
  }
}

function setupFaceMesh() {
  const faceMesh = new window.FaceMesh({
    locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh@0.4/${file}`,
  });

  faceMesh.setOptions({
    maxNumFaces: 5,
    refineLandmarks: true,
    minDetectionConfidence: 0.6,
    minTrackingConfidence: 0.6,
  });

  faceMesh.onResults(onResults);

  const camera = new window.Camera(video, {
    onFrame: async () => { await faceMesh.send({ image: video }); },
    width: 1280,
    height: 720,
  });
  camera.start();
}

async function onResults(results) {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (!results.multiFaceLandmarks || results.multiFaceLandmarks.length === 0) {
    lastFaceLandmarks = null;
    trackedFaces = [];
    clearAllUserTags();
    return;
  }
  lastFaceLandmarks = results.multiFaceLandmarks;
  updateTagPositionsFromMesh(); // 每幀同步名牌位置

  const now = Date.now();
  if (modelsReady && now - lastRecognizeTime > 1000) {
    lastRecognizeTime = now;
    await recognizeFacesLocalMulti();
  }
}

// ---------------- AR 名牌邏輯 ----------------
function updateTagPositionsFromMesh() {
  if (!lastFaceLandmarks || !tagLayer) return;

  const rect = tagLayer.getBoundingClientRect();
  const W = rect.width;
  const H = rect.height;
  const activeKeys = new Set();

  for (const tf of trackedFaces) {
    const lm = lastFaceLandmarks[tf.meshIndex];
    if (!lm) continue;

    const forehead = lm[10];
    const chin = lm[152];
    const headHeight = (chin.y - forehead.y) * H;
    const targetX = forehead.x * W;
    const targetY = forehead.y * H - headHeight * 0.6; // 調整名牌高度

    const key = String(tf.user.id);
    activeKeys.add(key);

    let state = tagStates.get(key);
    if (!state) {
      const el = document.createElement("div");
      el.className = "user-tag";
      el.innerHTML = `<div class="name">${tf.user.name}</div><div class="nickname">@${tf.user.nickname || ''}</div>`;
      tagLayer.appendChild(el);
      state = { el, x: targetX, y: targetY };
      tagStates.set(key, state);
    } else {
      // Lerp 平滑化處理
      state.x += (targetX - state.x) * SMOOTHING;
      state.y += (targetY - state.y) * SMOOTHING;
    }
    state.el.style.left = `${state.x}px`;
    state.el.style.top = `${state.y}px`;
  }

  for (const [key, state] of tagStates.entries()) {
    if (!activeKeys.has(key)) {
      state.el.remove();
      tagStates.delete(key);
    }
  }
}

// ---------------- 臉部辨識比對 ----------------
async function recognizeFacesLocalMulti() {
  if (!userCache.length || !lastFaceLandmarks) return;

  const detections = await faceapi.detectAllFaces(video, detectorOptions)
    .withFaceLandmarks().withFaceDescriptors();

  if (!detections || detections.length === 0) {
    trackedFaces = [];
    return;
  }

  const videoW = video.videoWidth || 1280;
  const videoH = video.videoHeight || 720;
  const meshCenters = lastFaceLandmarks.map(lm => ({ cx: lm[10].x, cy: lm[10].y }));
  const THRESHOLD = 0.6; 

  const newTracked = [];
  for (const det of detections) {
    let bestUser = null;
    let bestUserDist = Infinity;
    for (const user of userCache) {
      const dist = faceapi.euclideanDistance(det.descriptor, user.embedding);
      if (dist < bestUserDist) {
        bestUserDist = dist;
        bestUser = user;
      }
    }

    if (!bestUser || bestUserDist >= THRESHOLD) continue;

    const box = det.detection.box;
    const detCx = (box.x + box.width / 2) / videoW;
    const detCy = (box.y + box.height / 2) / videoH;

    let bestMeshIndex = -1;
    let bestMeshDist2 = Infinity;
    meshCenters.forEach((mc, idx) => {
      const d2 = Math.pow(mc.cx - detCx, 2) + Math.pow(mc.cy - detCy, 2);
      if (d2 < bestMeshDist2) {
        bestMeshDist2 = d2;
        bestMeshIndex = idx;
      }
    });

    if (bestMeshIndex !== -1) {
      newTracked.push({ meshIndex: bestMeshIndex, user: bestUser });
    }
  }
  trackedFaces = newTracked;
}

function clearAllUserTags() {
  if (tagLayer) tagLayer.innerHTML = "";
  tagStates.clear();
}