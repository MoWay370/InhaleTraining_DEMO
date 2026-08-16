// api/view.js
// 查詢端點：讀出 Redis 裡的訓練紀錄，給 dashboard.html 使用。
// 用法：
//   GET /api/view                     → 預設回傳最近 7 天的所有明細事件
//   GET /api/view?days=30             → 最近 30 天
//   GET /api/view?name=111            → 只看某個使用者（比對 name 欄位）
//   GET /api/view?best=1              → 額外附上所有使用者的 best:* 彙總表

import Redis from "ioredis";

let redis;
function getRedis() {
  if (!redis) {
    if (!process.env.REDIS_URL) {
      throw new Error("Missing REDIS_URL environment variable");
    }
    redis = new Redis(process.env.REDIS_URL, {
      maxRetriesPerRequest: 3,
    });
  }
  return redis;
}

function dateStrDaysAgo(n) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const client = getRedis();
    const days = Math.min(90, Math.max(1, parseInt(req.query.days, 10) || 7));
    const nameFilter = (req.query.name || "").trim();
    const wantBest = req.query.best === "1";

    // 收集最近 N 天的 bucket keys
    const bucketKeys = [];
    for (let i = 0; i < days; i++) {
      bucketKeys.push(`logs:${dateStrDaysAgo(i)}`);
    }

    // 平行讀出每一天的所有事件（每個 bucket 是一個 list）
    const lists = await Promise.all(
      bucketKeys.map((k) => client.lrange(k, 0, -1))
    );

    let records = [];
    lists.forEach((arr) => {
      arr.forEach((raw) => {
        try {
          records.push(JSON.parse(raw));
        } catch {
          // 忽略壞掉的資料列
        }
      });
    });

    if (nameFilter) {
      records = records.filter((r) => r.name === nameFilter);
    }

    // 新的排前面
    records.sort((a, b) => (b.ts || 0) - (a.ts || 0));

    let bestTable = null;
    if (wantBest) {
      // 找出所有出現過的使用者名稱，逐一撈 best:{name} hash
      const names = Array.from(new Set(records.map((r) => r.name).filter(Boolean)));
      const bestEntries = await Promise.all(
        names.map(async (n) => {
          const h = await client.hgetall(`best:${n}`);
          return [n, h];
        })
      );
      bestTable = Object.fromEntries(bestEntries);
    }

    return res.status(200).json({
      ok: true,
      count: records.length,
      records,
      best: bestTable,
    });
  } catch (err) {
    console.error("view.js error:", err);
    return res.status(500).json({ error: "internal error", message: String(err.message || err) });
  }
}
