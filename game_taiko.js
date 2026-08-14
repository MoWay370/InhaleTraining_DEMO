// 呼吸太鼓 — 三段式課表版。
//   第一段「點狀練習」:快速點狀提示,吸一下/吐一下就好,熱身用。
//   第二段「節奏訓練」:跟原本一樣的長條,維持住整條的時間比例來判定。
//   第三段「氣球挑戰」:不是撐時間,而是像吹氣球一樣要把力量「蓄到滿」才算過關,
//                       蓄力速度跟當下氣流大小成正比,越用力蓄越快。
//
// 判定原則(跟之前討論的一致):完全不看分類器判斷的「方向」,只看「有沒有氣流／
// 氣流多大」。每個音符本身(顏色 + 文字)已經告訴玩家該吸氣還是吐氣,遊戲只確認
// 玩家有沒有確實在吹/吸,不去驗證分類器判斷的方向對不對——這樣才不會被分類器
// 對吐氣辨識率偏低的問題卡住。

const ONSET = 12;           // 一般的「有氣流」門檻
const POINT_THRESH = 20;     // 點狀音符要瞬間達到這個流速才算點中
const POINT_WINDOW = [-0.25, 0.45]; // 點狀音符的判定窗(相對於音符時間點,秒)
const HOLD_LEAD = 0.2;
const JUDGE_DELAY = 0.25;
const RATIO_GREAT = 0.70;
const RATIO_GOOD = 0.35;
const SCROLL_SPEED = 130;   // px/s

const BALLOON_REF_MAX = 130;    // 氣球段:流速達到這個值,力道視為 100%
const BALLOON_LO_FRAC = 0.5;    // 力道要超過 REF_MAX 的這個比例,才會開始蓄力(低於門檻只會消退)
const BALLOON_FILL_MAX = 0.5;   // 全力(100%)時,每秒蓄力多少(0~1)
const BALLOON_LEAK = 0.12;      // 沒吹 / 力道不夠門檻時,每秒消多少

const SC_POINT = 80, SC_GREAT = 300, SC_GOOD = 100;
const GA_HIT = 2.2, GA_MISS = -4.0, GA_GREAT = 3.0, GA_GOOD = 1.2;
const GA_BALLOON_PASS = 12, GA_BALLOON_HALF = 4, GA_BALLOON_FAIL = -6;
const GAUGE_CLEAR = 80;

// ---------------------------------------------------------------------
// 課表:三段式。type: "point"(點狀) / "hold"(長條) / "balloon"(氣球段)
// kind: "inhale" / "exhale" —— 只用來決定顏色跟提示文字,不影響判定邏輯。
// ---------------------------------------------------------------------
function buildChart(){
  const notes = [];
  let t = 1.2;

  // 第一段:點狀熱身(只留 2 個,吐氣、吸氣各一次)
  notes.push({type:"point", kind:"exhale", t}); t += 1.6;
  notes.push({type:"point", kind:"inhale", t}); t += 1.8;

  // 第二段:節奏熱身(只留 2 個長條,簡單帶過)
  notes.push({type:"hold", kind:"inhale", t, dur:1.8, end:t+1.8, holdHit:0, judged:null});
  t += 1.8 + 1.2;
  notes.push({type:"hold", kind:"exhale", t, dur:2.0, end:t+2.0, holdHit:0, judged:null});
  t += 2.0 + 1.6;

  // 第三段:氣球挑戰為主 —— 吐氣一輪、吸氣一輪
  notes.push({type:"balloon", kind:"exhale", t, dur:9, fill:0, judged:null});
  t += 9 + 1.6;
  notes.push({type:"balloon", kind:"inhale", t, dur:9, fill:0, judged:null});
  t += 9 + 1.0;

  return { notes, total: t };
}

let S, CHART;

function reset(api){
  CHART = buildChart();
  S = {
    running:false, done:false, t:-1.0,
    score:0, combo:0, bestCombo:0, gauge:30,
    counts:{great:0, good:0, point:0, miss:0},
    flash:0, judgeText:null, judgeUntil:0, judgeCol:null,
    liveFlow:0, stageLabel:"", rings:[],
  };
}
function primaryLabel(){
  return S.done ? "再玩一次" : (S.running ? "重新開始" : "開始");
}
function primary(api){
  reset(api); S.running=true; S.t=-1.0;
}

function popJudge(text, col, api){
  S.judgeText=text; S.judgeCol=col; S.judgeUntil=S.t+0.6;
}

function judgeHold(note, api){
  const ratio = note.holdHit / Math.max(note.dur, 0.01);
  let result;
  if(ratio >= RATIO_GREAT) result="great";
  else if(ratio >= RATIO_GOOD) result="good";
  else result="miss";
  note.judged = result;
  S.counts[result]++;
  if(result==="miss"){
    S.combo=0; S.gauge=Math.max(0,S.gauge+GA_MISS);
    popJudge("不可", api.colors.dim, api);
  } else {
    S.combo++; S.bestCombo=Math.max(S.bestCombo,S.combo);
    const base = result==="great"? SC_GREAT : SC_GOOD;
    const bonus = 1+Math.min(S.combo,50)*0.01;
    S.score += Math.round(base*bonus);
    S.gauge = Math.min(100, S.gauge + (result==="great"?GA_GREAT:GA_GOOD));
    popJudge(result==="great"?"良":"可", result==="great"?api.colors.gold:api.colors.green, api);
  }
}

function judgePoint(note, hit, api){
  note.judged = hit ? "great" : "miss";
  S.counts[hit?"point":"miss"]++;
  if(hit){
    S.combo++; S.bestCombo=Math.max(S.bestCombo,S.combo);
    S.score += SC_POINT; S.gauge=Math.min(100,S.gauge+GA_HIT);
    popJudge("好！", api.colors.gold, api);
    S.rings.push({atJudgeLine:true, life:0.5, col:api.colors.gold});
  } else {
    S.combo=0; S.gauge=Math.max(0,S.gauge+GA_MISS*0.5);
    popJudge("漏拍", api.colors.dim, api);
  }
}

function judgeBalloon(note, api){
  let result, gaugeDelta, scoreBase;
  if(note.fill>=1.0){ result="great"; gaugeDelta=GA_BALLOON_PASS; scoreBase=SC_GREAT*2; }
  else if(note.fill>=0.6){ result="good"; gaugeDelta=GA_BALLOON_HALF; scoreBase=SC_GOOD*1.5; }
  else { result="miss"; gaugeDelta=GA_BALLOON_FAIL; scoreBase=0; }
  note.judged=result;
  S.counts[result==="great"?"great":result==="good"?"good":"miss"]++;
  if(result==="miss"){ S.combo=0; popJudge("氣球沒吹滿", api.colors.dim, api); }
  else { S.combo++; S.bestCombo=Math.max(S.bestCombo,S.combo); S.score+=Math.round(scoreBase);
    popJudge(result==="great"?"氣球吹滿！":"氣球有到一半！", result==="great"?api.colors.gold:api.colors.green, api); }
  S.gauge = Math.max(0, Math.min(100, S.gauge+gaugeDelta));
}

function update(dt, input, api){
  S.liveFlow = input.flow||0;
  if(!S.running) return;

  S.t += dt;
  if(S.t > CHART.total + 1.0){ S.running=false; S.done=true; return; }

  const flow = input.flow||0;
  const blowing = flow >= ONSET;

  // 目前所在的段落標籤(給畫面顯示用)
  let stage = "";
  for(const n of CHART.notes){
    if(n.type==="point" && Math.abs(S.t-n.t) < 1.2){ stage="點狀練習"; break; }
    if(n.type==="hold" && S.t>=n.t-1 && S.t<=n.end+1){ stage="節奏訓練"; break; }
    if(n.type==="balloon" && S.t>=n.t-1 && S.t<=n.t+n.dur+1){ stage="氣球挑戰"; break; }
  }
  S.stageLabel = stage;

  for(const n of CHART.notes){
    if(n.judged!==null) continue;

    if(n.type==="point"){
      const rel = S.t - n.t;
      if(rel < POINT_WINDOW[0]) continue;
      if(rel <= POINT_WINDOW[1]){
        if(flow >= POINT_THRESH){ judgePoint(n, true, api); S.flash=1; }
      } else {
        judgePoint(n, false, api);
      }
    }

    else if(n.type==="hold"){
      if(n.t - HOLD_LEAD <= S.t && S.t <= n.end){
        if(blowing){
          const wasZero = n.holdHit<=0.001;
          n.holdHit = Math.min(n.dur, n.holdHit+dt);
          S.flash=1;
          if(wasZero) popJudge("抓住了！維持住～", api.colors.green, api);
        }
      } else if(S.t > n.end + JUDGE_DELAY){
        judgeHold(n, api);
      }
    }

    else if(n.type==="balloon"){
      const end = n.t + n.dur;
      if(S.t >= n.t && S.t <= end){
        const frac = Math.min(1, flow/BALLOON_REF_MAX);
        if(blowing && frac >= BALLOON_LO_FRAC){
          const rate = ((frac-BALLOON_LO_FRAC)/(1-BALLOON_LO_FRAC)) * BALLOON_FILL_MAX;
          n.fill = Math.min(1, n.fill + rate*dt);
          S.flash=1;
          n._liveMsg = n.fill>0.8? "快滿了！再撐一下！" : "蓄力中，很好！";
        } else if(blowing){
          n.fill = Math.max(0, n.fill - BALLOON_LEAK*dt);
          n._liveMsg = "力道不夠，再更用力一點！";
        } else {
          n.fill = Math.max(0, n.fill - BALLOON_LEAK*dt);
          n._liveMsg = null;
        }
        if(n.fill>=1.0){ judgeBalloon(n, api); } // 提早吹滿,馬上結算,不用等到段落結束
      } else if(S.t > end + JUDGE_DELAY){
        judgeBalloon(n, api);
      }
    }
  }
  S.flash = Math.max(0, S.flash - dt*4);
  for(const r of S.rings) r.life -= dt;
  S.rings = S.rings.filter(r=>r.life>0);
}

function render(g,w,h,api){
  const C=g.colors;
  g.ctx.fillStyle=C.header; g.ctx.fillRect(0,0,w,50);
  g.text("呼吸太鼓",18,25,20,C.cream,"left");
  g.text(`分數 ${S.score}　連段 ${S.combo}`,w-18,18,15,C.gold,"right");
  g.text(`最佳連段 ${S.bestCombo}`,w-18,38,13,C.dim,"right",false);

  const laneY = h*0.40, laneH = 55, judgeX = w*0.16;
  const top=laneY-laneH, bot=laneY+laneH;

  g.rrect(0,top,w,bot,0); g.fill(C.track);
  g.ctx.globalAlpha=0.4; g.rrect(0,top,judgeX,bot,0); g.fill(C.panel); g.ctx.globalAlpha=1;
  g.line(0,top,w,top,"#39405f",1);
  g.line(0,bot,w,bot,"#39405f",1);
  if(S.flash>0.05){ g.ctx.globalAlpha=S.flash*0.5; g.rrect(judgeX-6,top,judgeX+6,bot,0); g.fill(C.gold); g.ctx.globalAlpha=1; }
  g.line(judgeX,top-10,judgeX,bot+10,C.cream,3);
  // 點狀命中的擴散光環
  for(const r of S.rings){
    const age = 0.5-r.life;
    g.ctx.globalAlpha=Math.max(0,r.life*2);
    g.circle(judgeX, laneY, 20+age*60, r.col, false);
    g.ctx.globalAlpha=1;
  }

  // 魂條
  const gx0=60, gx1=w-60, gy=64;
  g.text("魂",gx0-20,gy,13,C.dim,"right",false);
  g.rrect(gx0,gy-9,gx1,gy+9,6); g.fill(C.track);
  const clearX=gx0+(gx1-gx0)*GAUGE_CLEAR/100;
  const gw=(gx1-gx0)*S.gauge/100;
  g.rrect(gx0,gy-9,gx0+Math.max(2,gw),gy+9,6); g.fill(S.gauge>=GAUGE_CLEAR?C.gold:C.redBr);
  g.line(clearX,gy-14,clearX,gy+14,C.cream,2);
  g.text(`${Math.round(S.gauge)}%`,gx1+14,gy,14,C.cream,"left");

  if(S.stageLabel) g.text(`【${S.stageLabel}】`, judgeX, top-24, 15, C.gold, "left", false);

  if(!S.running && !S.done){
    g.text("呼吸太鼓：氣球為主",w/2,laneY-30,28,C.cream);
    g.text("先來個熱身點、熱身長條，接著就是重頭戲——把氣球蓄到滿！",w/2,laneY+10,15,C.dim,"center",false);
    g.text("氣球段：力道要夠大才會蓄力，越接近最大氣流蓄越快，蓄滿才算過關",w/2,laneY+34,15,C.dim,"center",false);
    return;
  }

  // 音符渲染
  for(const n of CHART.notes){
    const isInhale = n.kind==="inhale";
    let base = isInhale? C.redBr : C.blue;

    if(n.type==="point"){
      const x = judgeX + (n.t - S.t)*SCROLL_SPEED;
      if(x < -40 || x > w+40) continue;
      let col = base;
      if(n.judged==="great") col = C.gold;
      else if(n.judged==="miss") col = "#5c6280";
      g.circle(x, laneY, 20, col);
      g.stroke(C.goldDk,2);
      const label = isInhale? "吸" : "吐";
      g.text(label, x, laneY, 15, "#1b1f2e");
    }

    else if(n.type==="hold"){
      const x0 = judgeX + (n.t - S.t)*SCROLL_SPEED;
      const x1 = judgeX + (n.end - S.t)*SCROLL_SPEED;
      if(x1 < -40 || x0 > w+40) continue;
      let col = base;
      if(n.judged==="miss") col = "#5c6280";
      g.rrect(x0,laneY-24,x1,laneY+24,14); g.fill(col);
      if(n.holdHit>0){
        const fx = x0 + (n.holdHit/n.dur)*(x1-x0);
        g.rrect(x0,laneY-24,fx,laneY+24,14); g.fill(C.gold);
      }
      g.stroke(C.goldDk,2);
      if(x1-x0>46) g.text(isInhale?"吸氣":"吐氣", (x0+x1)/2, laneY, 14, "#1b1f2e");
    }

    else if(n.type==="balloon"){
      const x0 = judgeX + (n.t - S.t)*SCROLL_SPEED;
      const x1 = judgeX + ((n.t+n.dur) - S.t)*SCROLL_SPEED;
      if(x1 < -60 || x0 > w+60) continue;
      const cy = laneY;
      const active = S.t>=n.t && S.t<=n.t+n.dur && n.judged===null;
      // 底槽
      g.rrect(x0, cy-30, x1, cy+30, 16); g.fill(C.track); g.stroke(C.goldDk,2);
      const fillW = (x1-x0)*n.fill;
      g.rrect(x0, cy-30, x0+Math.max(4,fillW), cy+30, 16);
      g.fill(n.fill>=1?C.gold:C.blue);
      const label = active
        ? (n._liveMsg ? `${n._liveMsg}　${Math.round(n.fill*100)}%` : `${Math.round(n.fill*100)}%`)
        : (n.judged? (n.judged==="great"?"氣球滿了！":n.judged==="good"?"半滿":"沒吹滿") : "吐氣把氣球吹滿");
      if(x1-x0>80) g.text(label,(x0+x1)/2, cy, 14, "#1b1f2e");
    }
  }

  // 即時流速
  const mx0=judgeX, mx1=w-40, my=h*0.72;
  g.text("即時氣流",mx0,my-18,13,C.dim,"left",false);
  g.rrect(mx0,my,mx1,my+22,8); g.fill(C.track);
  const frac=Math.min(1,(S.liveFlow||0)/150);
  if(frac>0.02){ g.rrect(mx0,my,mx0+(mx1-mx0)*frac,my+22,8); g.fill(C.gold); }
  g.text(`${Math.round(S.liveFlow||0)}`,mx1+14,my+11,14,C.cream,"left");

  if(S.judgeText && S.t < S.judgeUntil){
    const age = 0.6-(S.judgeUntil-S.t);
    g.text(S.judgeText, judgeX, laneY-70-age*40, 26, S.judgeCol);
  }

  if(S.done){
    g.text("演奏結束！",w/2,laneY-30,32,C.gold);
    const passed = S.gauge>=GAUGE_CLEAR;
    g.text(passed? "合格 🎉" : "再挑戰一次！",w/2,laneY+6,20,passed?C.green:C.redBr);
    g.text(`良 ${S.counts.great||0}　可 ${S.counts.good||0}　點中 ${S.counts.point||0}　不可 ${S.counts.miss||0}`,w/2,laneY+36,14,C.cream,"center",false);
  }
}

export default { title:"呼吸太鼓", reset, primaryLabel, primary, update, render };
