const express = require("express");
const cors = require("cors");
require("dotenv").config();

const app = express();

app.use(cors());
app.use(express.json());

app.get("/", (req, res) => {
  res.send("AR Vision Link backend is running");
});

app.get("/health", (req, res) => {
  res.status(200).json({ ok: true });
});

// 範例：給前端取使用者資料
app.get("/api/users", async (req, res) => {
  res.json([
    { id: 1, name: "Simon" },
    { id: 2, name: "Test User" }
  ]);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});