// api/log.js
// Vercel Serverless Function：接收前端上傳的事件，寫入 Vercel KV
//
// 事前準備（在 Vercel Dashboard 做，一次性）：
//   1. 專案 → Storage → Create Database → 選 "KV"，建立後綁定到本專案
//      （Vercel 會自動把 KV_REST_API_URL / KV_REST_API_TOKEN 等環境變數注入專案）
//   2. 在專案根目錄跑：npm install @vercel/kv
//   3. 部署後，前端呼叫 POST /api/log 即可寫入
//
// 資料結構：
//   logs:YYYY-MM-DD   → List，這天所有事件的完整紀錄（原始明細，可回溯）
//   best:{使用者名稱}  → Hash，該使用者每個 key 的最新值（例如 balloon_best、angrybird_best）

import { kv } from "@vercel/kv";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const body = req.body || {};
    const {
      name,       // 使用者姓名/編號
      type,       // 事件類型："connect" | "disconnect" | "game_start" | "score"
      game,       // 目前遊戲 id："angrybird" | "balloon" | "taiko"（可為 null）
      key,        // type === "score" 時，對應的 store key（例如 "balloon_best"）
      value,      // type === "score" 時，對應的數值
      ts,         // 前端時間戳（ms），沒有就用伺服器時間
    } = body;

    if (!type) {
      return res.status(400).json({ error: "missing type" });
    }

    const record = {
      name: (name || "使用者").slice(0, 40),
      type,
      game: game || null,
      key: key || null,
      value: value ?? null,
      ts: Number.isFinite(ts) ? ts : Date.now(),
    };

    const dateStr = new Date(record.ts).toISOString().slice(0, 10); // YYYY-MM-DD
    const bucket = `logs:${dateStr}`;

    // 寫入當日明細（保留完整歷程，之後可用來畫訓練趨勢圖）
    await kv.rpush(bucket, JSON.stringify(record));

    // 若是成績類事件，額外維護一份「該使用者最新成績」方便快速查詢
    if (record.type === "score" && record.key) {
      await kv.hset(`best:${record.name}`, { [record.key]: record.value });
    }

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error("log.js error:", err);
    return res.status(500).json({ error: "internal error" });
  }
}
