// 呼吸太鼓 — 節奏版。畫面上的長條本身就是指令(紅=吸氣、藍=吐氣),
// 玩家跟著長條吸吐。判定「刻意不用方向分類器的判斷結果」——
// 分類器對吐氣的辨識率天生比吸氣低,如果拿它來判斷玩家吸還是吐,
// 吐氣類的長條會很難過。所以這裡的規則簡化成:
//   只要當下有氣流(flow >= ONSET),不管分類器說是吸氣還是吐氣,
//   都直接算「吹對了」——長條本身(靠顏色跟文字)已經告訴玩家該吸還是吐,
//   遊戲不需要再驗證方向是否正確,只需要確認玩家真的有在吹/吸。

const ONSET = 12;
const LEAD = 0.2;          // 長條開始前,提早這麼多秒就可以起算(寬容度)
const JUDGE_DELAY = 0.25;  // 長條結束後,等這麼久才結算(讓最後幾幀資料進來)
const RATIO_GREAT = 0.70;
const RATIO_GOOD = 0.35;
const SCROLL_SPEED = 140;  // px/s
const SC_GREAT = 300, SC_GOOD = 100;
const GA_GREAT = 3.0, GA_GOOD = 1.2, GA_MISS = -4.0;
const GAUGE_CLEAR = 80;

// 課表:(方向標籤, 目標流速僅供顯示, 秒數)。0 = 休息段,不產生音符。
const PROGRAM = [
  ["inhale", 0, 2],
  ["inhale", 60, 2], ["inhale", 0, 2], ["exhale", 60, 3], ["inhale", 0, 2],
  ["inhale", 60, 2], ["inhale", 0, 2], ["exhale", 60, 3], ["inhale", 0, 2],
  ["inhale", 90, 1.5], ["inhale", 0, 2], ["exhale", 50, 5], ["inhale", 0, 2],
  ["inhale", 120, 1], ["inhale", 0, 2], ["exhale", 100, 2], ["inhale", 0, 2],
  ["inhale", 40, 3], ["inhale", 0, 2], ["exhale", 40, 4], ["inhale", 0, 2],
  ["inhale", 30, 3], ["inhale", 0, 2], ["exhale", 30, 4], ["inhale", 0, 2],
];

function buildNotes(){
  let t = 0; const notes = [];
  for(const [kind, flow, dur] of PROGRAM){
    if(flow > 0 && dur > 0){
      notes.push({ t, dur, end: t+dur, kind, flow, holdHit:0, peak:0, judged:null });
    }
    t += dur;
  }
  return { notes, total: t };
}

let S, CHART;

function reset(api){
  CHART = buildNotes();
  S = {
    running:false, done:false, t:-1.0,
    score:0, combo:0, bestCombo:0, gauge:30,
    counts:{great:0, good:0, miss:0},
    flash:0, judgeText:null, judgeUntil:0, judgeCol:null,
    liveFlow:0,
  };
}
function primaryLabel(){
  return S.done ? "再玩一次" : (S.running ? "重新開始" : "開始");
}
function primary(api){
  reset(api); S.running=true; S.t=-1.0;
}

function judge(note, api){
  const ratio = note.holdHit / Math.max(note.dur, 0.01);
  let result;
  if(ratio >= RATIO_GREAT) result="great";
  else if(ratio >= RATIO_GOOD) result="good";
  else result="miss";
  note.judged = result;
  S.counts[result]++;

  if(result==="miss"){
    S.combo=0; S.gauge=Math.max(0,S.gauge+GA_MISS);
    S.judgeText="不可"; S.judgeCol=api.colors.dim;
  } else {
    S.combo++; S.bestCombo=Math.max(S.bestCombo,S.combo);
    const base = result==="great"? SC_GREAT : SC_GOOD;
    const bonus = 1 + Math.min(S.combo,50)*0.01;
    S.score += Math.round(base*bonus);
    S.gauge = Math.min(100, S.gauge + (result==="great"?GA_GREAT:GA_GOOD));
    S.judgeText = result==="great" ? "良" : "可";
    S.judgeCol = result==="great" ? api.colors.gold : api.colors.green;
  }
  S.judgeUntil = S.t + 0.7;
}

function update(dt, input, api){
  S.liveFlow = input.flow||0;
  if(!S.running) return;

  S.t += dt;
  if(S.t > CHART.total + 1.5){
    S.running=false; S.done=true; return;
  }

  // 核心規則:不管分類器判斷的方向是什麼,只看有沒有氣流
  const blowing = (input.flow||0) >= ONSET;

  for(const n of CHART.notes){
    if(n.judged!==null) continue;
    if(n.t - LEAD <= S.t && S.t <= n.end){
      if(blowing){
        n.holdHit = Math.min(n.dur, n.holdHit + dt);
        n.peak = Math.max(n.peak, input.flow||0);
        S.flash = 1;
      }
    } else if(S.t > n.end + JUDGE_DELAY){
      judge(n, api);
    }
  }
  S.flash = Math.max(0, S.flash - dt*4);
}

function render(g,w,h,api){
  const C=g.colors;
  g.ctx.fillStyle=C.header; g.ctx.fillRect(0,0,w,50);
  g.text("呼吸太鼓",18,25,20,C.cream,"left");
  g.text(`分數 ${S.score}　連段 ${S.combo}`,w-18,18,15,C.gold,"right");
  g.text(`最佳連段 ${S.bestCombo}`,w-18,38,13,C.dim,"right",false);

  const laneY = h*0.42, laneH = 60, judgeX = w*0.16;
  const top=laneY-laneH, bot=laneY+laneH;

  // 跑道
  g.rrect(0,top,w,bot,0); g.fill(C.track);
  g.ctx.globalAlpha=0.4; g.rrect(0,top,judgeX,bot,0); g.fill(C.panel); g.ctx.globalAlpha=1;
  g.line(0,top,w,top,"#39405f",1);
  g.line(0,bot,w,bot,"#39405f",1);
  // 判定線
  if(S.flash>0.05){ g.ctx.globalAlpha=S.flash*0.5; g.rrect(judgeX-6,top,judgeX+6,bot,0); g.fill(C.gold); g.ctx.globalAlpha=1; }
  g.line(judgeX,top-10,judgeX,bot+10,C.cream,3);

  // 魂條
  const gx0=60, gx1=w-60, gy=64;
  g.text("魂",gx0-20,gy,13,C.dim,"right",false);
  g.rrect(gx0,gy-9,gx1,gy+9,6); g.fill(C.track);
  const clearX=gx0+(gx1-gx0)*GAUGE_CLEAR/100;
  const gw=(gx1-gx0)*S.gauge/100;
  g.rrect(gx0,gy-9,gx0+Math.max(2,gw),gy+9,6); g.fill(S.gauge>=GAUGE_CLEAR?C.gold:C.redBr);
  g.line(clearX,gy-14,clearX,gy+14,C.cream,2);
  g.text(`${Math.round(S.gauge)}%`,gx1+14,gy,14,C.cream,"left");

  if(!S.running && !S.done){
    g.text("跟著長條吸氣、吐氣",w/2,laneY-24,28,C.cream);
    g.text("紅色長條＝吸氣　藍色長條＝吐氣　整條吹好就是「良」",w/2,laneY+20,16,C.dim,"center",false);
    g.text("判定只看你有沒有在吹/吸，不管方向對不對，跟著顏色做就好",w/2,laneY+48,14,C.dim,"center",false);
    return;
  }

  // 音符
  for(const n of CHART.notes){
    const x0 = judgeX + (n.t - S.t)*SCROLL_SPEED;
    const x1 = judgeX + (n.end - S.t)*SCROLL_SPEED;
    if(x1 < -40 || x0 > w+40) continue;
    const isInhale = n.kind==="inhale";
    let base = isInhale? C.redBr : C.blue;
    if(n.judged==="miss") base = "#5c6280";
    g.rrect(x0,laneY-26,x1,laneY+26,14); g.fill(base);
    if(n.holdHit>0){
      const fx = x0 + (n.holdHit/n.dur)*(x1-x0);
      g.rrect(x0,laneY-26,fx,laneY+26,14); g.fill(C.gold);
    }
    g.stroke(C.goldDk,2);
    const label = isInhale? "吸氣" : "吐氣";
    if(x1-x0 > 46) g.text(label,(x0+x1)/2,laneY,15,"#1b1f2e");
  }

  // 目前流速表
  const mx0=judgeX, mx1=w-40, my=h*0.72;
  g.text("即時氣流",mx0,my-18,13,C.dim,"left",false);
  g.rrect(mx0,my,mx1,my+22,8); g.fill(C.track);
  const frac=Math.min(1,(S.liveFlow||0)/150);
  if(frac>0.02) g.rrect(mx0,my,mx0+(mx1-mx0)*frac,my+22,8); g.fill(C.gold);
  g.text(`${Math.round(S.liveFlow||0)}`,mx1+14,my+11,14,C.cream,"left");

  // 判定字浮出
  if(S.judgeText && S.t < S.judgeUntil){
    const age = 0.7-(S.judgeUntil-S.t);
    g.text(S.judgeText, judgeX, laneY-70-age*40, 30, S.judgeCol);
  }

  if(S.done){
    g.text("演奏結束！",w/2,laneY-30,32,C.gold);
    const passed = S.gauge>=GAUGE_CLEAR;
    g.text(passed? "合格 🎉" : "再挑戰一次！",w/2,laneY+6,20,passed?C.green:C.redBr);
    g.text(`良 ${S.counts.great}　可 ${S.counts.good}　不可 ${S.counts.miss}`,w/2,laneY+36,15,C.cream,"center",false);
  }
}

export default { title:"呼吸太鼓", reset, primaryLabel, primary, update, render };
