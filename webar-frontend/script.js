// script.js - Web AR + 臉辨識
import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";

const SUPABASE_URL = "你的 supabase url";
const SUPABASE_KEY = "你的 anon key";
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// HTML elements
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

// -------------------- 相機 --------------------
async function startCamera() {
    const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "user" }
    });
    video.srcObject = stream;
}
startCamera();

// -------------------- 載入 face-api.js 模型 --------------------
Promise.all([
    faceapi.nets.tinyFaceDetector.loadFromUri("https://cdn.jsdelivr.net/npm/face-api.js/weights"),
    faceapi.nets.faceLandmark68Net.loadFromUri("https://cdn.jsdelivr.net/npm/face-api.js/weights"),
    faceapi.nets.faceRecognitionNet.loadFromUri("https://cdn.jsdelivr.net/npm/face-api.js/weights")
]).then(() => {
    console.log("face-api.js models loaded");
});

// -------------------- FaceMesh 初始化 --------------------
const FaceMeshCtor = window.FaceMesh;
const faceMesh = new FaceMeshCtor({
    locateFile: (file) =>
        `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh@0.4/${file}`,
});

faceMesh.setOptions({
    maxNumFaces: 1,
    refineLandmarks: true,
    minDetectionConfidence: 0.6,
    minTrackingConfidence: 0.6
});

faceMesh.onResults(onResults);

// -------------------- 臉辨識比對 --------------------
async function recognizeFace() {
    const dbUsers = await supabase.from("users").select("*");

    const detection = await faceapi
        .detectSingleFace(video, new faceapi.TinyFaceDetectorOptions())
        .withFaceLandmarks()
        .withFaceDescriptor();

    if (!detection) return null;

    const desc = detection.descriptor;

    let bestUser = null;
    let bestDist = 999;

    for (const user of dbUsers.data) {
        if (!user.face_embedding) continue;

        const dist = faceapi.euclideanDistance(desc, user.face_embedding);

        if (dist < bestDist) {
            bestDist = dist;
            bestUser = user;
        }
    }

    return bestDist < 0.5 ? bestUser : null;
}

// -------------------- FaceMesh 結果處理 --------------------
async function onResults(results) {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    if (!results.multiFaceLandmarks?.length) return;

    const lm = results.multiFaceLandmarks[0];
    const forehead = lm[10];
    const chin = lm[152];

    const headHeight = (chin.y - forehead.y) * window.innerHeight;

    const screenX = forehead.x * window.innerWidth;
    const screenY = forehead.y * window.innerHeight - headHeight * 0.6;

    treasure.style.left = `${screenX}px`;
    treasure.style.top = `${screenY}px`;

    // 每隔 1 秒做一次辨識
    if (!window.lastCheck || Date.now() - window.lastCheck > 1000) {
        window.lastCheck = Date.now();

        const match = await recognizeFace();
        if (match) showUserCard(match);
    }
}

// -------------------- 顯示使用者資料 --------------------
function showUserCard(user) {
    avatar.src = user.avatar_url || "";
    nameEl.textContent = user.name || "";
    nicknameEl.textContent = user.nickname || "";
    descriptionEl.textContent = user.description || "";
    extraInfoEl.textContent = user.extra_info || "";

    userCard.style.display = "block";
}

// -------------------- 啟動攝影機流到 FaceMesh --------------------
const camera = new Camera(video, {
    onFrame: async () => {
        await faceMesh.send({ image: video });
    },
    width: 1280,
    height: 720
});
camera.start();
