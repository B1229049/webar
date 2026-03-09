// script.js
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = "https://msuhvjhznkodpjfjpaia.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1zdWh2amh6bmtvZHBqZmpwYWlhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjQ4MzEwMTMsImV4cCI6MjA4MDQwNzAxM30.32jirKcLxE-sF3ICPD_yitBsO42JorbUgahz_1RAqoY";

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// ---------------- DOM ----------------
const video = document.getElementById("videoElement");
const canvas = document.getElementById("landmarksCanvas");
const tagLayer = document.getElementById("tagLayer");
const ctx = canvas ? canvas.getContext("2d") : null;

if (!video || !canvas || !ctx || !tagLayer) {
  throw new Error(
    "camera.html 缺少必要 DOM：videoElement / landmarksCanvas / tagLayer"
  );
}

function resizeCanvas() {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
}
resizeCanvas();
window.addEventListener("resize", resizeCanvas);

// ---------------- 狀態 ----------------
let modelsReady = false;
let backendReady = false;
let isRecognizing = false;

let userCache = [];
let lastRecognizeTime = 0;
let lastFaceLandmarks = null;
let trackedFaces = [];
let detectorOptions = null;

let mediaPipeCamera = null;
let faceMeshInstance = null;

const tagStates = new Map();
const SMOOTHING = 0.6; // 提高跟隨速度
const RECOGNIZE_INTERVAL_MS = 450; // 辨識更新更快
const MATCH_THRESHOLD = 0.6;

// ---------------- 啟動 ----------------
window.addEventListener("load", () => {
  injectTagStyles();
  main().catch((e) => console.error("主程式錯誤：", e));
});

// ---------------- 主流程 ----------------
async function main() {
  if (!window.faceapi) {
    console.error("faceapi 沒載到，請檢查 camera.html 的 script 標籤");
    alert("face-api.js 尚未正確載入，請檢查 camera.html");
    return;
  }

  if (!faceapi.tf) {
    console.error("TensorFlow.js 沒有載入成功");
    alert("TensorFlow.js 尚未正確載入，請檢查 camera.html");
    return;
  }

  backendReady = await initTfBackend();
  if (!backendReady) {
    alert("TFJS backend 初始化失敗");
    return;
  }

  console.log("[init] 載入 face-api 模型...");
  const MODEL_URL = "https://cdn.jsdelivr.net/npm/@vladmandic/face-api/model";

  try {
    await Promise.all([
      faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_URL),
      faceapi.nets.faceLandmark68Net.loadFromUri(MODEL_URL),
      faceapi.nets.faceRecognitionNet.loadFromUri(MODEL_URL),
    ]);
    modelsReady = true;
    console.log("[init] face-api 模型載入完成");
  } catch (err) {
    console.error("[init] 模型載入失敗：", err);
    alert("face-api 模型載入失敗，請檢查網路或模型路徑");
    return;
  }

  detectorOptions = new faceapi.TinyFaceDetectorOptions({
    inputSize: 320,
    scoreThreshold: 0.4,
  });

  await loadUserCache();
  await startCamera();
  setupFaceMesh();
}

// ---------------- TFJS Backend 初始化 ----------------
async function initTfBackend() {
  console.log("[init] 開始初始化 TFJS backend...");

  try {
    const tf = faceapi.tf;
    if (!tf) {
      throw new Error("faceapi.tf 不存在");
    }

    console.log("[init] tf version:", tf.version_core || "unknown");
    console.log("[init] 直接切換 backend -> cpu");

    await tf.setBackend("cpu");
    await tf.ready();

    const current = tf.getBackend();
    console.log("[init] 目前 backend:", current);

    if (current === "cpu") {
      console.log("[init] 已使用 CPU backend");
      return true;
    }

    return false;
  } catch (err) {
    console.error("[init] TFJS backend 初始化失敗：", err);
    return false;
  }
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

  userCache = (users || [])
    .map((u) => {
      let emb = u.face_embedding;

      if (typeof emb === "string") {
        try {
          emb = JSON.parse(emb);
        } catch (e) {
          console.warn(`[supabase] ${u.name} 的 embedding JSON 解析失敗`);
          return null;
        }
      }

      if (!Array.isArray(emb) || emb.length === 0) return null;

      return {
        ...u,
        embedding: new Float32Array(emb),
      };
    })
    .filter(Boolean);

  console.log("[supabase] 快取建立完成，共", userCache.length, "筆有效資料");
}

// ---------------- 相機 ----------------
async function startCamera() {
  if (video.srcObject) {
    console.log("[camera] 相機已啟動，略過重複開啟");
    return;
  }

  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: "user" },
      audio: false,
    });

    video.srcObject = stream;

    await new Promise((resolve) => {
      video.onloadedmetadata = () => {
        video
          .play()
          .catch((e) => console.warn("[camera] video.play() 失敗：", e))
          .finally(resolve);
      };
    });

    console.log("[camera] 相機啟動成功");
  } catch (err) {
    console.error("[camera] 啟動失敗：", err);
    alert("無法存取相機，請檢查瀏覽器權限或是否有其他程式佔用相機");
  }
}

function stopCamera() {
  try {
    if (mediaPipeCamera && typeof mediaPipeCamera.stop === "function") {
      mediaPipeCamera.stop();
    }
  } catch (e) {
    console.warn("[cleanup] mediaPipeCamera.stop() 失敗：", e);
  }

  mediaPipeCamera = null;

  const stream = video.srcObject;
  if (stream && typeof stream.getTracks === "function") {
    stream.getTracks().forEach((track) => track.stop());
  }
  video.srcObject = null;
}

// ---------------- FaceMesh ----------------
function setupFaceMesh() {
  if (!window.FaceMesh || !window.Camera) {
    console.error("MediaPipe FaceMesh 或 Camera 沒有載入");
    alert("MediaPipe 套件未正確載入，請檢查 camera.html");
    return;
  }

  faceMeshInstance = new window.FaceMesh({
    locateFile: (file) =>
      `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh@0.4/${file}`,
  });

  faceMeshInstance.setOptions({
    maxNumFaces: 5,
    refineLandmarks: true,
    minDetectionConfidence: 0.6,
    minTrackingConfidence: 0.6,
  });

  faceMeshInstance.onResults(onResults);

  mediaPipeCamera = new window.Camera(video, {
    onFrame: async () => {
      if (video.readyState >= 2 && faceMeshInstance) {
        await faceMeshInstance.send({ image: video });
      }
    },
    width: 1280,
    height: 720,
  });

  mediaPipeCamera.start();
  console.log("[mediapipe] FaceMesh 啟動完成");
}

// ---------------- MediaPipe 結果 ----------------
async function onResults(results) {
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  if (!results.multiFaceLandmarks || results.multiFaceLandmarks.length === 0) {
    lastFaceLandmarks = null;
    trackedFaces = [];
    clearAllUserTags();
    return;
  }

  lastFaceLandmarks = results.multiFaceLandmarks;
  updateTagPositionsFromMesh();

  const now = Date.now();
  if (
    modelsReady &&
    backendReady &&
    !isRecognizing &&
    now - lastRecognizeTime > RECOGNIZE_INTERVAL_MS
  ) {
    lastRecognizeTime = now;
    await recognizeFacesLocalMulti();
  }
}

// ---------------- 名牌定位（先顯示寶箱） ----------------
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
    const targetY = forehead.y * H - headHeight * 0.7;

    const key = String(tf.user.id);
    activeKeys.add(key);

    let state = tagStates.get(key);

    if (!state) {
      const el = document.createElement("div");
      el.className = "user-tag chest-mode";
      el.innerHTML = `
        <div class="chest-wrap">
          <button class="treasure-chest" type="button" aria-label="開啟名牌寶箱">
            <img class="chest-img" src="./chest.png" alt="寶箱">
          </button>
        </div>
        <div class="nameplate hidden">
          <div class="name">${escapeHtml(tf.user.name || "")}</div>
          <div class="nickname">@${escapeHtml(tf.user.nickname || "")}</div>
        </div>
      `;

      const chestBtn = el.querySelector(".treasure-chest");
      const nameplate = el.querySelector(".nameplate");

      state = {
        el,
        x: targetX,
        y: targetY,
        opened: false,
      };

      chestBtn.addEventListener("click", (ev) => {
        ev.stopPropagation();

        if (state.opened) return;
        state.opened = true;

        el.classList.remove("chest-mode");
        el.classList.add("opened");
        chestBtn.classList.add("pop-open");

        setTimeout(() => {
          chestBtn.style.display = "none";
          nameplate.classList.remove("hidden");
          nameplate.classList.add("show");
        }, 180);
      });

      tagLayer.appendChild(el);
      tagStates.set(key, state);
    } else {
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

// ---------------- 人臉辨識 ----------------
async function recognizeFacesLocalMulti() {
  if (isRecognizing) return;
  isRecognizing = true;

  try {
    if (!backendReady) {
      console.warn("[recognize] backend 尚未就緒，略過辨識");
      return;
    }

    if (!modelsReady) {
      console.warn("[recognize] 模型尚未就緒，略過辨識");
      return;
    }

    if (!userCache.length || !lastFaceLandmarks) return;
    if (!video || video.readyState < 2) return;

    const detections = await faceapi
      .detectAllFaces(video, detectorOptions)
      .withFaceLandmarks()
      .withFaceDescriptors();

    if (!detections || detections.length === 0) {
      trackedFaces = [];
      clearAllUserTags();
      return;
    }

    const videoW = video.videoWidth || 1280;
    const videoH = video.videoHeight || 720;

    const newTracked = [];
    const usedMeshIndices = new Set();
    const usedUserIds = new Set();

    for (const det of detections) {
      const desc = det.descriptor;
      let bestUser = null;
      let bestUserDist = Infinity;

      for (const user of userCache) {
        if (!user.embedding || desc.length !== user.embedding.length) {
          console.warn(
            `⚠️ [Dimension Mismatch] 跳過用戶: ${user.name}。模型產出: ${desc.length}, 資料庫存儲: ${user.embedding?.length}`
          );
          continue;
        }

        const dist = faceapi.euclideanDistance(desc, user.embedding);
        if (dist < bestUserDist) {
          bestUserDist = dist;
          bestUser = user;
        }
      }

      if (
        bestUser &&
        bestUserDist < MATCH_THRESHOLD &&
        !usedUserIds.has(bestUser.id)
      ) {
        const box = det.detection.box;
        const detCx = (box.x + box.width / 2) / videoW;
        const detCy = (box.y + box.height / 2) / videoH;

        let bestMeshIndex = -1;
        let bestMeshDist2 = Infinity;

        lastFaceLandmarks.forEach((lm, idx) => {
          if (usedMeshIndices.has(idx)) return;

          const d2 =
            Math.pow(lm[10].x - detCx, 2) + Math.pow(lm[10].y - detCy, 2);

          if (d2 < bestMeshDist2) {
            bestMeshDist2 = d2;
            bestMeshIndex = idx;
          }
        });

        if (bestMeshIndex !== -1) {
          newTracked.push({
            meshIndex: bestMeshIndex,
            user: bestUser,
          });

          usedMeshIndices.add(bestMeshIndex);
          usedUserIds.add(bestUser.id);

          console.log(
            `✨ [Match] 找到: ${bestUser.name}, 距離: ${bestUserDist.toFixed(
              3
            )}, meshIndex: ${bestMeshIndex}`
          );
        }
      }
    }

    trackedFaces = newTracked;
  } catch (err) {
    console.error("[recognize] 辨識失敗：", err);
  } finally {
    isRecognizing = false;
  }
}

// ---------------- 工具 ----------------
function clearAllUserTags() {
  tagLayer.innerHTML = "";
  tagStates.clear();
}

function escapeHtml(str) {
  return String(str)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

// ---------------- 動態樣式 ----------------
function injectTagStyles() {
  if (document.getElementById("dynamic-tag-styles")) return;

  const style = document.createElement("style");
  style.id = "dynamic-tag-styles";
  style.textContent = `
    .user-tag {
      position: absolute;
      transform: translate(-50%, -50%);
      pointer-events: auto;
      z-index: 20;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 6px;
    }

    .chest-wrap {
      display: flex;
      justify-content: center;
      align-items: center;
      background: transparent;
      box-shadow: none;
      border: none;
      padding: 0;
      margin: 0;
    }

    .treasure-chest {
      border: none;
      outline: none;
      background: transparent;
      cursor: pointer;
      padding: 0;
      margin: 0;
      box-shadow: none;
      appearance: none;
      -webkit-appearance: none;
      transform: scale(1);
      transition: transform 0.14s ease, opacity 0.18s ease;
      filter: drop-shadow(0 4px 10px rgba(0, 0, 0, 0.22));
    }

    .treasure-chest:hover {
      transform: scale(1.06);
    }

    .treasure-chest:active {
      transform: scale(0.96);
    }

    .treasure-chest:focus {
      outline: none;
      box-shadow: none;
    }

    .chest-img {
      width: 120px;
      height: auto;
      max-width: 120px;
      object-fit: contain;
      display: block;
      pointer-events: none;
      user-select: none;
      background: transparent;
    }

    .treasure-chest.pop-open {
      animation: chestPopOpen 0.2s ease forwards;
    }

    @keyframes chestPopOpen {
      0% {
        transform: scale(1);
        opacity: 1;
      }
      45% {
        transform: scale(1.15) translateY(-10px);
        opacity: 1;
      }
      100% {
        transform: scale(0.45) translateY(-24px);
        opacity: 0;
      }
    }

    .nameplate {
      min-width: 120px;
      max-width: 220px;
      padding: 10px 14px;
      border-radius: 14px;
      background: rgba(0, 0, 0, 0.72);
      color: #fff;
      text-align: center;
      box-shadow: 0 6px 18px rgba(0, 0, 0, 0.28);
      backdrop-filter: blur(6px);
      transform: translateY(6px) scale(0.96);
      opacity: 0;
      transition: opacity 0.16s ease, transform 0.16s ease;
      pointer-events: none;
    }

    .nameplate.show {
      opacity: 1;
      transform: translateY(0) scale(1);
    }

    .nameplate.hidden {
      display: none;
    }

    .nameplate .name {
      font-size: 16px;
      font-weight: 700;
      margin-bottom: 4px;
      white-space: nowrap;
    }

    .nameplate .nickname {
      font-size: 13px;
      opacity: 0.9;
      white-space: nowrap;
    }
  `;
  document.head.appendChild(style);
}

// ---------------- 離頁清理 ----------------
function cleanupPage() {
  stopCamera();
  trackedFaces = [];
  lastFaceLandmarks = null;
  clearAllUserTags();
}

window.addEventListener("beforeunload", cleanupPage);
window.addEventListener("pagehide", cleanupPage);