// ----------------------------------------------------------
//  Supabase init
// ----------------------------------------------------------
const SUPABASE_URL = "https://msuhvjhznkodpjfjpaia.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1zdWh2amh6bmtvZHBqZmpwYWlhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjQ4MzEwMTMsImV4cCI6MjA4MDQwNzAxM30.32jirKcLxE-sF3ICPD_yitBsO42JorbUgahz_1RAqoY";
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// ----------------------------------------------------------
// DOM
// ----------------------------------------------------------
const video = document.getElementById("videoElement");
const treasure = document.getElementById("treasure");
const canvas = document.getElementById("landmarksCanvas");
const ctx = canvas.getContext("2d");

const userCard = document.getElementById("userCard");
const nameEl = document.getElementById("name");
const nicknameEl = document.getElementById("nickname");
const descriptionEl = document.getElementById("description");
const extraInfoEl = document.getElementById("extraInfo");

canvas.width = window.innerWidth;
canvas.height = window.innerHeight;

// ----------------------------------------------------------
//  儲存所有使用者資料（本地快取）
// ----------------------------------------------------------
let userCache = [];   // { id, name, nickname, description, extra_info, embedding(Float32Array) }

// ----------------------------------------------------------
// 啟動流程
// ----------------------------------------------------------
window.addEventListener("load", () => {
  main().catch(e => console.error("主程式錯誤：", e));
});

async function main() {
  // 1. face-api 模型
  const MODEL_URL = "https://cdn.jsdelivr.net/npm/@vladmandic/face-api/model";
  await Promise.all([
    faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_URL),
    faceapi.nets.faceLandmark68Net.loadFromUri(MODEL_URL),
    faceapi.nets.faceRecognitionNet.loadFromUri(MODEL_URL),
  ]);
  console.log("face-api.js models loaded");

  // ⭐ 2. 只在這一步抓一次資料庫
  await loadUserCache();

  // 3. 相機
  await startCamera();

  // 4. FaceMesh 啟動
  setupFaceMesh();
}

// ----------------------------------------------------------
// 一次性載入所有使用者 → 前端快取
// ----------------------------------------------------------
async function loadUserCache() {
  const { data: users, error } = await supabase
    .from("users")
    .select("id, name, nickname, description, extra_info, face_embedding");

  if (error) {
    console.error("無法載入使用者資料：", error);
    return;
  }

  userCache = users
    .filter(u => u.face_embedding)
    .map(u => ({
      id: u.id,
      name: u.name,
      nickname: u.nickname,
      description: u.description,
      extra_info: u.extra_info,
      embedding: new Float32Array(u.face_embedding),
    }));

  console.log("使用者資料快取成功，共", userCache.length, "筆");
}

// ----------------------------------------------------------
// 相機
// ----------------------------------------------------------
async function startCamera() {
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode: "user" },
    audio: false
  });
  video.srcObject = stream;
}

// ----------------------------------------------------------
// FaceMesh
// ----------------------------------------------------------
function setupFaceMesh() {
  const FM = window.FaceMesh;
  if (!FM) {
    console.error("FaceMesh 未載入");
    return;
  }

  const faceMesh = new FM({
    locateFile: file => `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh@0.4/${file}`
  });

  faceMesh.setOptions({
    maxNumFaces: 1,
    refineLandmarks: true,
    minDetectionConfidence: 0.6,
    minTrackingConfidence: 0.6,
  });

  faceMesh.onResults(onResults);

  const camera = new Camera(video, {
    onFrame: async () => await faceMesh.send({ image: video }),
    width: 1280,
    height: 720,
  });
  camera.start();
}

// ----------------------------------------------------------
// FaceMesh callback
// ----------------------------------------------------------
async function onResults(results) {
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  if (!results.multiFaceLandmarks || results.multiFaceLandmarks.length === 0)
    return;

  const lm = results.multiFaceLandmarks[0];
  const forehead = lm[10];
  const chin = lm[152];

  const headHeight = (chin.y - forehead.y) * window.innerHeight;
  const screenX = forehead.x * window.innerWidth;
  const screenY = forehead.y * window.innerHeight - headHeight * 0.6;

  treasure.style.left = `${screenX}px`;
  treasure.style.top = `${screenY}px`;

  // 🎯 每 1 秒做一次辨識，但不會打 API
  if (!window._lastRecog || Date.now() - window._lastRecog > 1000) {
    window._lastRecog = Date.now();
    const user = await recognizeFaceLocal();
    if (user) showUserCard(user);
  }
}

// ----------------------------------------------------------
// ⭐ 臉部比對（完全本地運算，不再呼叫資料庫）
// ----------------------------------------------------------
async function recognizeFaceLocal() {
  const detection = await faceapi
    .detectSingleFace(video, new faceapi.TinyFaceDetectorOptions())
    .withFaceLandmarks()
    .withFaceDescriptor();

  if (!detection) return null;

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

  // 建議 threshold 0.45 ~ 0.55 之間
  return bestDist < 0.5 ? bestUser : null;
}

// ----------------------------------------------------------
// 顯示卡片
// ----------------------------------------------------------
function showUserCard(user) {
  nameEl.textContent = user.name;
  nicknameEl.textContent = user.nickname;
  descriptionEl.textContent = user.description;
  extraInfoEl.textContent = user.extra_info;
  userCard.style.display = "block";
}
