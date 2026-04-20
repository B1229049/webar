const API_BASE = "https://ar-vision-link.onrender.com";

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

async function loadRoom() {
  const roomCode = getRoomCodeFromUrl();

  if (!roomCode) {
    if (roomCodeText) roomCodeText.textContent = "未提供";
    if (quizTitleText) quizTitleText.textContent = "-";
    if (startedAtText) startedAtText.textContent = "-";
    setStatus("error", "網址缺少 room 參數，例如 join.html?room=ABCD1234");
    if (joinBtn) joinBtn.disabled = true;
    return;
  }

  if (roomCodeText) roomCodeText.textContent = roomCode;
  setStatus("loading", "正在查詢房間資料...");

  try {
    const response = await fetch(
      `${API_BASE}/api/session/${encodeURIComponent(roomCode)}`
    );

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

    if (joinForm) {
      joinForm.classList.remove("hidden");
    }

    if (joinBtn) {
      joinBtn.disabled = false;
    }
  } catch (error) {
    console.error(error);

    if (quizTitleText) quizTitleText.textContent = "-";
    if (startedAtText) startedAtText.textContent = "-";

    setStatus("error", "找不到此房間，請確認房間碼是否正確。");

    if (joinBtn) {
      joinBtn.disabled = true;
    }
  }
}

if (joinBtn) {
  joinBtn.addEventListener("click", async () => {
    const roomCode = getRoomCodeFromUrl();
    const playerName = playerNameInput?.value.trim() || "";

    if (!currentSession) {
      alert("房間資料尚未載入完成");
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

      localStorage.setItem(
        "currentJoinSession",
        JSON.stringify(result.joinData)
      );

      alert("加入成功");

      // 之後可改成正式跳轉
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

loadRoom();