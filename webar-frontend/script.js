// script.js
// 這支檔案會同時負責：
// 1. Supabase 資料讀取
// 2. MediaPipe FaceMesh 頭部追蹤 + 卡片跟隨

// ---------- 1. Supabase 設定 ----------

import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm'

// ★ 把這兩個改成你自己的 Supabase 資訊
const supabaseUrl = 'https://msuhvjhznkodpjfjpaia.supabase.co'
const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1zdWh2amh6bmtvZHBqZmpwYWlhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjQ4MzEwMTMsImV4cCI6MjA4MDQwNzAxM30.32jirKcLxE-sF3ICPD_yitBsO42JorbUgahz_1RAqoY'  // ← 去 Supabase 後台 API 頁貼上

const supabase = createClient(supabaseUrl, supabaseAnonKey)

/**
 * 從 Supabase 的 users table 取得指定 id 的使用者
 * 欄位假設：id, name, nickname, description, avatar_url, extra_info
 */
async function getUserById(id) {
  const { data, error } = await supabase
    .from('users')
    .select('*')
    .eq('id', id)
    .single()

  if (error) {
    console.error('Supabase 查詢錯誤：', error)
    throw error
  }
  return data
}

// ---------- 2. Web AR + FaceMesh ----------

window.addEventListener('load', () => {
  const videoElement = document.getElementById('videoElement')
  const treasure = document.getElementById('treasure')
  const canvas = document.getElementById('landmarksCanvas')
  const ctx = canvas.getContext('2d')

  const userCard = document.getElementById('userCard')
  const avatar = document.getElementById('avatar')
  const nameEl = document.getElementById('name')
  const nicknameEl = document.getElementById('nickname')
  const descriptionEl = document.getElementById('description')
  const extraInfoEl = document.getElementById('extraInfo')

  // 調整 canvas 尺寸
  function resizeCanvas() {
    canvas.width = window.innerWidth
    canvas.height = window.innerHeight
  }
  resizeCanvas()
  window.addEventListener('resize', resizeCanvas)

  // 1. 開啟相機
  async function startCamera() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user' },
        audio: false
      })
      videoElement.srcObject = stream
    } catch (err) {
      console.error('無法開啟相機', err)
      alert('無法開啟相機，請檢查權限或裝置。')
    }
  }
  startCamera()

  // 2. 建立舊版 FaceMesh 物件（支援 faceMesh / FaceMesh 兩種 global）
  const FaceMeshNS = window.faceMesh || window.FaceMesh
  if (!FaceMeshNS) {
    console.error('MediaPipe FaceMesh 未正確載入，請檢查 <script src="...face_mesh.js">')
    return
  }

  const mpFaceMesh = new FaceMeshNS.FaceMesh({
    locateFile: (file) =>
      `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh@0.3.1646424915/${file}`
  })

  mpFaceMesh.setOptions({
    maxNumFaces: 1,
    refineLandmarks: true,
    minDetectionConfidence: 0.6,
    minTrackingConfidence: 0.6
  })

  mpFaceMesh.onResults(onResults)

  // 3. 處理 FaceMesh 結果：畫紅點 + 移動圖片到頭上
  function onResults(results) {
    ctx.clearRect(0, 0, canvas.width, canvas.height)

    if (!results.multiFaceLandmarks || results.multiFaceLandmarks.length === 0) {
      return
    }

    const landmarks = results.multiFaceLandmarks[0]

    // Debug：畫出紅點（你不想看點點可以註解掉這段）
    landmarks.forEach((pt) => {
      const x = pt.x * canvas.width
      const y = pt.y * canvas.height
      ctx.beginPath()
      ctx.arc(x, y, 2, 0, 2 * Math.PI)
      ctx.fillStyle = 'red'
      ctx.fill()
    })

    // 取鼻樑附近幾個點的平均，當作頭中心
    const ids = [1, 4, 5]
    let sumX = 0
    let sumY = 0

    ids.forEach((id) => {
      sumX += landmarks[id].x
      sumY += landmarks[id].y
    })

    const avgX = sumX / ids.length
    const avgY = sumY / ids.length

    const screenX = avgX * window.innerWidth
    const screenY = avgY * window.innerHeight - 120 // 往上移到頭頂上方

    treasure.style.left = `${screenX}px`
    treasure.style.top = `${screenY}px`
  }

  // 4. CameraUtils：把 video 畫面送進 mpFaceMesh
  const camera = new Camera(videoElement, {
    onFrame: async () => {
      await mpFaceMesh.send({ image: videoElement })
    },
    width: 1280,
    height: 720
  })
  camera.start()

  // 5. 點擊圖片 → 用 Supabase 撈資料 → 顯示在 userCard
  treasure.addEventListener('click', async () => {
    const userId = 1 // 先固定 1，有需要可以改成動態

    try {
      const user = await getUserById(userId)
      console.log('取得使用者資料：', user)

      avatar.src = user.avatar_url || ''
      nameEl.textContent = user.name || ''
      nicknameEl.textContent = user.nickname ? `暱稱：${user.nickname}` : ''
      descriptionEl.textContent = user.description || ''
      extraInfoEl.textContent = user.extra_info || ''

      userCard.style.display = 'block'
    } catch (err) {
      console.error('讀取 Supabase 使用者資料失敗', err)
      alert('讀取雲端使用者資料失敗，請稍後再試。')
    }
  })
})
