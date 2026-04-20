import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

function generateRoomCode(length = 8) {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < length; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

async function getOrCreateHost(hostName) {
  const trimmedName = (hostName || "").trim();
  if (!trimmedName) {
    throw new Error("hostName 不可為空");
  }

  const { data: existingUsers, error: findError } = await supabase
    .from("user_data")
    .select("*")
    .eq("name", trimmedName)
    .limit(1);

  if (findError) throw findError;

  if (existingUsers && existingUsers.length > 0) {
    return existingUsers[0];
  }

  const { data: newUser, error: insertError } = await supabase
    .from("user_data")
    .insert([
      {
        name: trimmedName,
        nickname: trimmedName,
        is_active: true
      }
    ])
    .select()
    .single();

  if (insertError) throw insertError;
  return newUser;
}

async function createQuiz(hostId, title) {
  const { data, error } = await supabase
    .from("quizzes")
    .insert([
      {
        host_id: hostId,
        title: title || "未命名測驗"
      }
    ])
    .select()
    .single();

  if (error) throw error;
  return data;
}

async function createGameSession(quizId, roomCode) {
  const { data, error } = await supabase
    .from("game_sessions")
    .insert([
      {
        quiz_id: quizId,
        room_code: roomCode
      }
    ])
    .select()
    .single();

  if (error) throw error;
  return data;
}

app.get("/", (req, res) => {
  res.json({
    ok: true,
    message: "AR Vision Link API running"
  });
});

/**
 * 建立房間
 * body:
 * {
 *   hostName: string,
 *   meetingTitle: string,
 *   meetingCode?: string,
 *   meetingLink?: string
 * }
 */
app.post("/api/create-session", async (req, res) => {
  try {
    const hostName = (req.body.hostName || "").trim();
    const meetingTitle = (req.body.meetingTitle || "").trim() || "未命名會議";
    const meetingCode = (req.body.meetingCode || "").trim() || generateRoomCode();
    const meetingLink = (req.body.meetingLink || "").trim() || null;

    if (!hostName) {
      return res.status(400).json({
        error: "hostName 必填"
      });
    }

    const { data: duplicateSession, error: duplicateError } = await supabase
      .from("game_sessions")
      .select("session_id, room_code")
      .eq("room_code", meetingCode)
      .limit(1);

    if (duplicateError) throw duplicateError;

    if (duplicateSession && duplicateSession.length > 0) {
      return res.status(409).json({
        error: "room_code 已存在，請重新產生房間碼"
      });
    }

    const hostUser = await getOrCreateHost(hostName);
    const quiz = await createQuiz(hostUser.user_id, meetingTitle);
    const session = await createGameSession(quiz.quiz_id, meetingCode);

    return res.json({
      success: true,
      room: {
        hostName: hostUser.name,
        hostUserId: hostUser.user_id,
        meetingTitle,
        meetingCode,
        meetingLink,
        quizId: quiz.quiz_id,
        sessionId: session.session_id,
        startedAt: session.started_at
      }
    });
  } catch (error) {
    console.error("create-session error:", error);
    return res.status(500).json({
      error: error.message || "建立房間失敗"
    });
  }
});

/**
 * 用 room_code 查詢房間
 */
app.get("/api/session/:roomCode", async (req, res) => {
  try {
    const roomCode = (req.params.roomCode || "").trim();

    if (!roomCode) {
      return res.status(400).json({
        error: "roomCode 不可為空"
      });
    }

    const { data, error } = await supabase
      .from("game_sessions")
      .select(`
        session_id,
        room_code,
        started_at,
        ended_at,
        quizzes (
          quiz_id,
          title,
          host_id
        )
      `)
      .eq("room_code", roomCode)
      .single();

    if (error || !data) {
      return res.status(404).json({
        error: "找不到房間"
      });
    }

    return res.json({
      success: true,
      session: data
    });
  } catch (error) {
    console.error("get-session error:", error);
    return res.status(500).json({
      error: error.message || "查詢房間失敗"
    });
  }
});

/**
 * 取得某場次排行榜
 */
app.get("/api/session/:sessionId/records", async (req, res) => {
  try {
    const sessionId = Number(req.params.sessionId);

    if (!Number.isInteger(sessionId)) {
      return res.status(400).json({
        error: "sessionId 格式錯誤"
      });
    }

    const { data, error } = await supabase
      .from("player_records")
      .select(`
        record_id,
        session_id,
        user_id,
        total_score,
        correct_count,
        rank,
        created_at,
        user_data (
          user_id,
          name,
          nickname,
          avatar_url
        )
      `)
      .eq("session_id", sessionId)
      .order("rank", { ascending: true });

    if (error) throw error;

    return res.json({
      success: true,
      records: data || []
    });
  } catch (error) {
    console.error("get-records error:", error);
    return res.status(500).json({
      error: error.message || "取得排行榜失敗"
    });
  }
});

/**
 * 寫入玩家結算紀錄
 * body:
 * {
 *   sessionId: number,
 *   userId: number,
 *   totalScore: number,
 *   correctCount: number,
 *   rank: number
 * }
 */
app.post("/api/player-record", async (req, res) => {
  try {
    const sessionId = Number(req.body.sessionId);
    const userId = Number(req.body.userId);
    const totalScore = Number(req.body.totalScore || 0);
    const correctCount = Number(req.body.correctCount || 0);
    const rank = req.body.rank == null ? null : Number(req.body.rank);

    if (!Number.isInteger(sessionId) || !Number.isInteger(userId)) {
      return res.status(400).json({
        error: "sessionId 或 userId 格式錯誤"
      });
    }

    const { data, error } = await supabase
      .from("player_records")
      .insert([
        {
          session_id: sessionId,
          user_id: userId,
          total_score: totalScore,
          correct_count: correctCount,
          rank
        }
      ])
      .select()
      .single();

    if (error) throw error;

    return res.json({
      success: true,
      record: data
    });
  } catch (error) {
    console.error("player-record error:", error);
    return res.status(500).json({
      error: error.message || "寫入玩家紀錄失敗"
    });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});

app.get("/api/session/:roomCode", async (req, res) => {
  try {
    const roomCode = (req.params.roomCode || "").trim().toUpperCase();

    if (!roomCode) {
      return res.status(400).json({ error: "roomCode 不可為空" });
    }

    const { data, error } = await supabase
      .from("game_sessions")
      .select(`
        session_id,
        quiz_id,
        room_code,
        started_at,
        ended_at,
        quizzes (
          quiz_id,
          title,
          host_id
        )
      `)
      .eq("room_code", roomCode)
      .single();

    if (error || !data) {
      return res.status(404).json({ error: "找不到房間" });
    }

    res.json({
      success: true,
      session: data
    });
  } catch (err) {
    res.status(500).json({
      error: err.message || "查詢房間失敗"
    });
  }
});

app.post("/api/join-session", async (req, res) => {
  try {
    const roomCode = (req.body.roomCode || "").trim().toUpperCase();
    const playerName = (req.body.playerName || "").trim();

    if (!roomCode || !playerName) {
      return res.status(400).json({
        error: "roomCode 與 playerName 必填"
      });
    }

    const { data: sessionData, error: sessionError } = await supabase
      .from("game_sessions")
      .select(`
        session_id,
        quiz_id,
        room_code,
        started_at,
        ended_at,
        quizzes (
          quiz_id,
          title,
          host_id
        )
      `)
      .eq("room_code", roomCode)
      .single();

    if (sessionError || !sessionData) {
      return res.status(404).json({
        error: "房間不存在"
      });
    }

    let userId = null;

    const { data: existingUsers, error: findUserError } = await supabase
      .from("user_data")
      .select("user_id, name, nickname")
      .eq("name", playerName)
      .limit(1);

    if (findUserError) {
      throw findUserError;
    }

    if (existingUsers && existingUsers.length > 0) {
      userId = existingUsers[0].user_id;
    } else {
      const { data: insertedUser, error: insertUserError } = await supabase
        .from("user_data")
        .insert([
          {
            name: playerName,
            nickname: playerName,
            is_active: true
          }
        ])
        .select("user_id, name, nickname")
        .single();

      if (insertUserError) {
        throw insertUserError;
      }

      userId = insertedUser.user_id;
    }

    res.json({
      success: true,
      joinData: {
        userId,
        playerName,
        roomCode,
        sessionId: sessionData.session_id,
        quizId: sessionData.quiz_id,
        quizTitle: sessionData.quizzes?.title || "未命名測驗",
        joinedAt: new Date().toISOString()
      }
    });
  } catch (err) {
    res.status(500).json({
      error: err.message || "加入房間失敗"
    });
  }
});