const API_BASE = "https://ar-vision-link.onrender.com";

const roomCodeInput = document.getElementById("roomCodeInput");
const searchBtn = document.getElementById("searchBtn");
const roomCodeText = document.getElementById("roomCodeText");
const quizTitleText = document.getElementById("quizTitleText");
const startedAtText = document.getElementById("startedAtText");
const statusBox = document.getElementById("statusBox");
const playerNameInput = document.getElementById("playerName");
const joinBtn = document.getElementById("joinBtn");
const backBtn = document.getElementById("backBtn");
const joinForm = document.getElementById("joinForm");

let currentSession = null;

function getRoomCodeFromUrl() {
  const params = new URLSearchParams(window.location.search);
  return (params.get("room") || "").trim().toUpperCase();
}

function getCurrentRoomCode() {
  return (roomCodeInput?.value || "").trim().toUpperCase();
}

function formatDateTime(value) {
  if (!value) return "未提供";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleString("zh-TW", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function setStatus(type, message) {
  if (!statusBox) return;
  statusBox.className = `status ${type}`;
  statusBox.textContent = message;
}

function resetRoomDisplay() {
  currentSession = null;
  if (roomCodeText) roomCodeText.textContent = "尚未查詢";
  if (quizTitleText) quizTitleText.textContent = "尚未查詢";
  if (startedAtText) startedAtText.textContent = "尚未查詢";
  if (joinForm) joinForm.classList.add("hidden");
  if (joinBtn) joinBtn.disabled = true;
}

async function loadRoom(roomCode) {
  const code = (roomCode || "").trim().toUpperCase();

  if (!code) {
    resetRoomDisplay();
    setStatus("error", "請先輸入房間代碼。");
    return;
  }

  if (roomCodeInput) roomCodeInput.value = code;
  if (roomCodeText) roomCodeText.textContent = code;
  if (quizTitleText) quizTitleText.textContent = "查詢中...";
  if (startedAtText) startedAtText.textContent = "查詢中...";
  setStatus("loading", "正在查詢房間資料...");

  try {
    const response = await fetch(`${API_BASE}/api/session/${encodeURIComponent(code)}`);
    const result = await response.json();

    if (!response.ok) {
      throw new Error(result.error || "查詢房間失敗");
    }

    currentSession = result.session;

    if (quizTitleText) {
      quizTitleText.textContent = currentSession.quizzes?.title || "未命名測驗";
    }

    if (startedAtText) {
      startedAtText.textContent = formatDateTime(currentSession.started_at);
    }

    setStatus("success", "房間存在，可以加入。");

    if (joinForm) joinForm.classList.remove("hidden");
    if (joinBtn) joinBtn.disabled = false;
  } catch (error) {
    console.error(error);
    currentSession = null;

    if (quizTitleText) quizTitleText.textContent = "找不到";
    if (startedAtText) startedAtText.textContent = "-";

    setStatus("error", "找不到此房間，請確認房間碼是否正確。");

    if (joinForm) joinForm.classList.add("hidden");
    if (joinBtn) joinBtn.disabled = true;
  }
}

if (searchBtn) {
  searchBtn.addEventListener("click", () => {
    loadRoom(getCurrentRoomCode());
  });
}

if (roomCodeInput) {
  roomCodeInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      loadRoom(getCurrentRoomCode());
    }
  });
}

if (joinBtn) {
  joinBtn.addEventListener("click", async () => {
    const roomCode = getCurrentRoomCode();
    const playerName = playerNameInput?.value.trim() || "";

    if (!currentSession) {
      alert("請先查詢有效房間");
      return;
    }

    if (!playerName) {
      alert("請輸入你的名稱");
      playerNameInput?.focus();
      return;
    }

    try {
      joinBtn.disabled = true;
      joinBtn.textContent = "加入中...";

      const response = await fetch(`${API_BASE}/api/join-session`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          roomCode,
          playerName
        })
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || "加入失敗");
      }

      localStorage.setItem("currentJoinSession", JSON.stringify(result.joinData));

      alert("加入成功");

      // 可改成正式跳轉
      // window.location.href = `play.html?room=${encodeURIComponent(roomCode)}`;
    } catch (error) {
      console.error(error);
      alert("加入房間失敗：" + error.message);
    } finally {
      joinBtn.disabled = false;
      joinBtn.textContent = "加入房間";
    }
  });
}

if (backBtn) {
  backBtn.addEventListener("click", () => {
    history.back();
  });
}

// 如果網址有 ?room=XXXX，自動帶入並查詢
const initialRoomCode = getRoomCodeFromUrl();
if (initialRoomCode && roomCodeInput) {
  roomCodeInput.value = initialRoomCode;
  loadRoom(initialRoomCode);
} else {
  resetRoomDisplay();
  setStatus("loading", "請先輸入房間代碼並查詢。");
}