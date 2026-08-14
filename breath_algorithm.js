// =====================================================================
//  breath_algorithm.js — 已凍結的呼吸聲學算法(可 import 的獨立模組)
// =====================================================================
//  輸入:裝置只提供的 FFT 頻帶資料  bands = {1: e1, 2: e2, ... 20: e20}
//  輸出:analyze(bands) -> { active, direction, flow, confidence }
//
//  設計原則:與遊戲 UI 完全脫鉤。遊戲只呼叫 analyze();要換更準的模型時,
//  只改這支檔案裡的 MODEL 常數(凍結產物),遊戲一行都不用動。
//
//  MODEL 目前是「以物理為基礎的透明算法」(能量門檻 + 高低頻能量比 + 能量→流量代理)。
//  等你用裝置實測資料訓練出係數,把 MODEL 換掉即可(格式見下)。
// =====================================================================

export const MODEL = {
  version: "web-1.0",
  bands: [1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20],

  // 是否「正在吹」:低頻總能量門檻
  active: { minEnergy: 500000, lowBands: [1,2,3] },

  // 方向判定:score>0 視為吐氣。沿用你原程式的 e3/e1,再加高/低頻能量比。
  direction: {
    wE3E1: 0.6, bE3E1: 0.8,          // 0.6*(e3/e1 - 0.8)
    wHighLow: 0.4, bHighLow: 0.5,    // 0.4*(high/low - 0.5)
    lowBands: [1,2,3],
    highBands: [6,7,8,9,10,11,12,13,14,15,16,17,18,19,20],
  },

  // FFT 能量 -> 流量代理(遊戲會自我校準 baseline,所以「單調遞增」比絕對值重要)
  flow: {
    weightBands: [1,2,3,4,5,6,7,8,9,10],  // 主要用中低頻能量
    gain: 0.11,        // 整體增益
    curve: "sqrt",     // sqrt / linear / log
    energyScale: 1e6,  // 先把能量正規化到 ~O(1)
    max: 220,
  },
};

// ------- 小工具 -------
function bandSum(bands, keys) {
  let s = 0;
  for (const k of keys) s += (bands[k] || 0);
  return s;
}

// ------- 特徵(訓練/推論共用,若日後接模型用得到) -------
export function featurizeBands(bands) {
  const b = MODEL.bands.map((k) => bands[k] || 0);
  const total = b.reduce((a, x) => a + x, 0) + 1e-9;
  const logB = b.map((x) => Math.log1p(x));
  const centroid = b.reduce((a, x, i) => a + (i + 1) * x, 0) / total;
  const low = bandSum(bands, MODEL.direction.lowBands) + 1e-9;
  const high = bandSum(bands, MODEL.direction.highBands) + 1e-9;
  const e3e1 = (bands[3] || 0) / ((bands[1] || 0) + 1e-9);
  return [...logB, Math.log1p(total), centroid, e3e1, high / low];
}

// ------- 是否正在吹 -------
export function isActive(bands) {
  return bandSum(bands, MODEL.active.lowBands) >= MODEL.active.minEnergy;
}

// ------- 方向:吸氣 / 吐氣 -------
export function predictDirection(bands) {
  const D = MODEL.direction;
  const low = bandSum(bands, D.lowBands) + 1e-9;
  const high = bandSum(bands, D.highBands) + 1e-9;
  const e3e1 = (bands[3] || 0) / ((bands[1] || 0) + 1e-9);
  const score = D.wE3E1 * (e3e1 - D.bE3E1) + D.wHighLow * (high / low - D.bHighLow);
  const mode = score > 0 ? "exhalation" : "inhalation";
  const confidence = Math.max(0, Math.min(1, 0.5 + Math.abs(score) * 0.5));
  return { mode, confidence, score };
}

// ------- 流量估計(能量代理;可被訓練模型取代) -------
export function estimateFlow(bands) {
  const F = MODEL.flow;
  let e = bandSum(bands, F.weightBands) / F.energyScale;
  if (e < 0) e = 0;
  let v;
  if (F.curve === "sqrt") v = Math.sqrt(e);
  else if (F.curve === "log") v = Math.log1p(e);
  else v = e;
  return Math.min(F.max, F.gain * v * 100);
}

// ------- 對外主函式:一次給遊戲要的全部 -------
export function analyze(bands) {
  if (!bands) return { active: false, direction: null, flow: 0, confidence: 0 };
  const active = isActive(bands);
  if (!active) return { active: false, direction: null, flow: 0, confidence: 0 };
  const dir = predictDirection(bands);
  const flow = estimateFlow(bands);
  return { active: true, direction: dir.mode, flow, confidence: dir.confidence };
}

// ------- 解析裝置的 [FFT] 文字行 -> bands 物件 -------
// 例:"[FFT] 1k:1234567 2k:890123 3k:..."
export function parseFFTLine(line) {
  if (!line || line.indexOf("[FFT]") < 0) return null;
  const bands = {};
  const re = /(\d+)\s*k\s*:\s*([-+]?\d*\.?\d+)/gi;
  let m, found = false;
  while ((m = re.exec(line)) !== null) {
    const k = parseInt(m[1], 10);
    const v = parseFloat(m[2]);
    if (k >= 1 && k <= 20 && !Number.isNaN(v)) { bands[k] = v; found = true; }
  }
  return found ? bands : null;
}

export function status() {
  return `算法 v${MODEL.version}(透明式;可換訓練模型)`;
}

export default { MODEL, analyze, parseFFTLine, predictDirection, estimateFlow,
                 isActive, featurizeBands, status };
