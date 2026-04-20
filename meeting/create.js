const API_BASE = "https://ar-vision-link.onrender.com";

const hostNameInput = document.getElementById("hostName");
const meetingTitleInput = document.getElementById("meetingTitle");
const meetingCodeInput = document.getElementById("meetingCode");
const resultCard = document.getElementById("resultCard");
const resultCode = document.getElementById("resultCode");
const resultTitle = document.getElementById("resultTitle");
const resultHost = document.getElementById("resultHost");
const resultLink = document.getElementById("resultLink");
const generateBtn = document.getElementById("generateBtn");
const createBtn = document.getElementById("createBtn");
const copyBtn = document.getElementById("copyBtn");

function generateMeetingCode(length = 8) {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < length; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

// create.html 與 join.html 在同一路徑
function buildMeetingLink(code) {
  const base =
    window.location.origin && window.location.origin !== "null"
      ? window.location.origin + window.location.pathname.replace(/[^/]*$/, "")
      : "./";

  return `${base}join.html?room=${encodeURIComponent(code)}`;
}

function ensureCode() {
  if (!meetingCodeInput.value.trim()) {
    meetingCodeInput.value = generateMeetingCode();
  }
  return meetingCodeInput.value.trim().toUpperCase();
}

function setLoading(isLoading) {
  createBtn.disabled = isLoading;
  generateBtn.disabled = isLoading;
  copyBtn.disabled = isLoading;
  createBtn.textContent = isLoading ? "建立中..." : "建立房間";
}

generateBtn.addEventListener("click", () => {
  meetingCodeInput.value = generateMeetingCode();
});

createBtn.addEventListener("click", async () => {
  const hostName = hostNameInput.value.trim();
  const meetingTitle = meetingTitleInput.value.trim() || "未命名會議";
  const meetingCode = ensureCode();
  const meetingLink = buildMeetingLink(meetingCode);

  if (!hostName) {
    alert("請輸入主持人名稱");
    hostNameInput.focus();
    return;
  }

  try {
    setLoading(true);

    const response = await fetch(`${API_BASE}/api/create-session`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        hostName,
        meetingTitle,
        meetingCode,
        meetingLink
      })
    });

    const result = await response.json();

    if (!response.ok) {
      throw new Error(result.error || "建立房間失敗");
    }

    const room = result.room;

    localStorage.setItem("latestMeeting", JSON.stringify(room));

    resultCode.textContent = room.meetingCode;
    resultTitle.textContent = room.meetingTitle;
    resultHost.textContent = room.hostName;
    resultLink.textContent = meetingLink;
    resultCard.classList.add("show");
  } catch (error) {
    console.error(error);
    alert("建立房間失敗：" + error.message);
  } finally {
    setLoading(false);
  }
});

copyBtn.addEventListener("click", async () => {
  const meetingCode = ensureCode();
  const meetingLink = buildMeetingLink(meetingCode);

  try {
    await navigator.clipboard.writeText(meetingLink);
    alert("已複製加入連結");
  } catch (error) {
    alert("複製失敗，請手動複製：\n" + meetingLink);
  }
});

meetingCodeInput.value = generateMeetingCode();