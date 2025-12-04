window.addEventListener("load", () => {
    const videoElement = document.getElementById("videoElement");
    const treasure = document.getElementById("treasure");
    const canvas = document.getElementById("landmarksCanvas");
    const ctx = canvas.getContext("2d");

    const userCard = document.getElementById("userCard");
    const avatar = document.getElementById("avatar");
    const nameEl = document.getElementById("name");
    const nicknameEl = document.getElementById("nickname");
    const descriptionEl = document.getElementById("description");
    const extraInfoEl = document.getElementById("extraInfo");

    function resizeCanvas() {
        canvas.width = window.innerWidth;
        canvas.height = window.innerHeight;
    }
    resizeCanvas();
    window.addEventListener("resize", resizeCanvas);

    // 1. 開啟相機
    async function startCamera() {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({
                video: { facingMode: "user" },
                audio: false
            });
            videoElement.srcObject = stream;
        } catch (err) {
            console.error("無法開啟相機", err);
            alert("無法開啟相機，請檢查權限或裝置。");
        }
    }
    startCamera();

    // 2. ★★ 這裡改成使用全域的 faceMesh 物件，不是 FaceMesh ★★
    const mpFaceMesh = new faceMesh.FaceMesh({
        locateFile: (file) =>
            `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh@0.3.1646424915/${file}`
    });

    mpFaceMesh.setOptions({
        maxNumFaces: 1,
        refineLandmarks: true,
        minDetectionConfidence: 0.6,
        minTrackingConfidence: 0.6
    });

    mpFaceMesh.onResults(onResults);

    function onResults(results) {
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        if (!results.multiFaceLandmarks || results.multiFaceLandmarks.length === 0) {
            return;
        }

        const landmarks = results.multiFaceLandmarks[0];

        // Debug：畫紅點
        landmarks.forEach((pt) => {
            const x = pt.x * canvas.width;
            const y = pt.y * canvas.height;
            ctx.beginPath();
            ctx.arc(x, y, 2, 0, 2 * Math.PI);
            ctx.fillStyle = "red";
            ctx.fill();
        });

        // 取鼻樑附近幾個點平均，當作頭中心
        const ids = [1, 4, 5];
        let sumX = 0;
        let sumY = 0;

        ids.forEach((id) => {
            sumX += landmarks[id].x;
            sumY += landmarks[id].y;
        });

        const avgX = sumX / ids.length;
        const avgY = sumY / ids.length;

        const screenX = avgX * window.innerWidth;
        const screenY = avgY * window.innerHeight - 120; // 往上移

        treasure.style.left = `${screenX}px`;
        treasure.style.top = `${screenY}px`;
    }

    // 4. CameraUtils：把畫面送進 mpFaceMesh
    const camera = new Camera(videoElement, {
        onFrame: async () => {
            await mpFaceMesh.send({ image: videoElement });
        },
        width: 1280,
        height: 720
    });
    camera.start();

    // 5. 點擊圖片 → 呼叫後端（可選）
    treasure.addEventListener("click", async () => {
        const userId = 1;

        try {
            const res = await fetch(`http://localhost:8000/users/${userId}`);
            if (!res.ok) {
                console.error("後端回傳錯誤", await res.text());
                alert("找不到使用者資料（或後端沒跑）");
                return;
            }

            const data = await res.json();
            console.log("User data:", data);

            avatar.src = data.avatar_url || "";
            nameEl.textContent = data.name || "";
            nicknameEl.textContent = data.nickname ? `暱稱：${data.nickname}` : "";
            descriptionEl.textContent = data.description || "";
            extraInfoEl.textContent = data.extra_info || "";

            userCard.style.display = "block";
        } catch (err) {
            console.error("呼叫 API 失敗", err);
            alert("連線後端失敗，請確認 FastAPI 是否有啟動。");
        }
    });
});
