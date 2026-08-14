// 呼吸太鼓 — 氣球為主版(輸送帶式判定)。
//
// 判定方式改成「輸送帶」邏輯,不是固定時間軸捲動:
//   - 目前這個音符固定卡在判定線上不動,持續進行(吹氣球/撐長條)。
//   - 後面的音符像輸送帶一樣持續往判定線方向流動接近。
//   - 這個音符有一段「配額時間」(slotSec);時間到了(等於後面那個音符
//     流到判定線了)如果還沒完成,就直接判定失敗,往下一個音符走。
//   - 氣球提早吹滿(fill>=1)會直接「啵」一聲爆掉,不用等配額時間到。
//
// 氣球畫成真的會被撐大、最後爆掉的圓形氣球(跟吹氣球那款遊戲一樣的視覺),
// 不是長條填充格。
//
// 判定原則:完全不看分類器判斷的「方向」,只看「有沒有氣流／氣流多大」。
// 音符本身(顏色 + 文字)已經告訴玩家該吸氣還是吐氣。

const ONSET = 12;
const RATIO_GREAT = 0.70;
const RATIO_GOOD = 0.35;
const SCROLL_SPEED = 130;   // px/s,輸送帶捲動視覺速度

// 氣球段的蓄力公式,跟 game_balloon.js 完全一致
const BALLOON_LO = 10;
const BALLOON_HI = 150;
const BALLOON_FILL_BASE = 1;
const BALLOON_FILL_MAX = 3;
const BALLOON_LEAK = 0.1;

const SC_GREAT = 300, SC_GOOD = 100;
const GA_MISS = -4.0, GA_GREAT = 3.0, GA_GOOD = 1.2;
const GA_BALLOON_PASS = 12, GA_BALLOON_HALF = 4, GA_BALLOON_FAIL = -6;
const GAUGE_CLEAR = 80;

// ---------------------------------------------------------------------
// 課表(按順序,不用絕對時間):吸氣熱身 -> 吸氣氣球 -> 吐氣熱身(2秒) -> 吐氣氣球
// slotSec = 這個音符最多能卡在判定線上多久,時間到還沒完成就算失敗往下走
// ---------------------------------------------------------------------
function buildChart(){
  return [
    { type:"hold",    kind:"inhale", dur:2.0, slotSec:2.8, holdHit:0 },
    { type:"balloon", kind:"inhale", slotSec:5.0, fill:0 },
    { type:"hold",    kind:"exhale", dur:2.0, slotSec:2.8, holdHit:0 },
    { type:"balloon", kind:"exhale", slotSec:5.0, fill:0 },
  ];
}

let S;

function reset(api){
  S = {
    running:false, done:false,
    notes: buildChart(),
    qIndex: 0,
    activeElapsed: 0,
    score:0, combo:0, bestCombo:0, gauge:30,
    counts:{great:0, good:0, miss:0},
    flash:0, judgeText:null, judgeUntil:0, judgeCol:null,
    liveFlow:0, popFx:[],
    songT:0,
  };
}
function primaryLabel(){
  return S.done ? "再玩一次" : (S.running ? "重新開始" : "開始");
}
function primary(api){
  reset(api); S.running=true;
}

function popJudge(text, col){
  S.judgeText=text; S.judgeCol=col; S.judgeUntil=S.songT+0.6;
}

function advanceQueue(){
  S.qIndex++;
  S.activeElapsed = 0;
}

function judgeHold(note, api){
  const ratio = note.holdHit / Math.max(note.dur, 0.01);
  let result;
  if(ratio >= RATIO_GREAT) result="great";
  else if(ratio >= RATIO_GOOD) result="good";
  else result="miss";
  S.counts[result]++;
  if(result==="miss"){
    S.combo=0; S.gauge=Math.max(0,S.gauge+GA_MISS);
    popJudge("不可", api.colors.dim);
  } else {
    S.combo++; S.bestCombo=Math.max(S.bestCombo,S.combo);
    const base = result==="great"? SC_GREAT : SC_GOOD;
    const bonus = 1+Math.min(S.combo,50)*0.01;
    S.score += Math.round(base*bonus);
    S.gauge = Math.min(100, S.gauge + (result==="great"?GA_GREAT:GA_GOOD));
    popJudge(result==="great"?"良":"可", result==="great"?api.colors.gold:api.colors.green);
  }
}

function judgeBalloon(note, api, popped){
  let result, gaugeDelta, scoreBase;
  if(note.fill>=1.0){ result="great"; gaugeDelta=GA_BALLOON_PASS; scoreBase=SC_GREAT*2; }
  else if(note.fill>=0.6){ result="good"; gaugeDelta=GA_BALLOON_HALF; scoreBase=SC_GOOD*1.5; }
  else { result="miss"; gaugeDelta=GA_BALLOON_FAIL; scoreBase=0; }
  S.counts[result==="great"?"great":result==="good"?"good":"miss"]++;
  if(result==="miss"){ S.combo=0; popJudge("氣球沒吹滿", api.colors.dim); }
  else {
    S.combo++; S.bestCombo=Math.max(S.bestCombo,S.combo); S.score+=Math.round(scoreBase);
    popJudge(popped?"啵！氣球吹爆了！":"氣球有到一半！", result==="great"?api.colors.gold:api.colors.green);
  }
  S.gauge = Math.max(0, Math.min(100, S.gauge+gaugeDelta));
}

function spawnPop(api){
  const parts=[];
  for(let i=0;i<26;i++){
    const a=Math.random()*Math.PI*2, spd=80+Math.random()*220;
    parts.push({x:0,y:0,vx:Math.cos(a)*spd,vy:Math.sin(a)*spd,life:0.5+Math.random()*0.4,
      col:[api.colors.gold,api.colors.redBr,api.colors.green,api.colors.blue][i%4], sz:3+Math.random()*4});
  }
  S.popFx.push({parts, t:0});
}

function update(dt, input, api){
  S.liveFlow = input.flow||0;
  if(!S.running) return;
  S.songT += dt;

  if(S.qIndex >= S.notes.length){ S.running=false; S.done=true; return; }

  const flow = input.flow||0;
  const blowing = flow >= ONSET;
  const cur = S.notes[S.qIndex];
  S.activeElapsed += dt;

  if(cur.type==="hold"){
    if(blowing){
      const wasZero = cur.holdHit<=0.001;
      cur.holdHit = Math.min(cur.dur, cur.holdHit+dt);
      S.flash=1;
      if(wasZero) popJudge("抓住了！維持住～", api.colors.green);
    }
    if(cur.holdHit >= cur.dur){
      judgeHold(cur, api); advanceQueue();
    } else if(S.activeElapsed >= cur.slotSec){
      judgeHold(cur, api); advanceQueue();
    }
  }

  else if(cur.type==="balloon"){
    if(flow >= BALLOON_LO){
      const frac = Math.max(0, Math.min(1, (flow-BALLOON_LO)/(BALLOON_HI-BALLOON_LO)));
      const rate = BALLOON_FILL_BASE + (BALLOON_FILL_MAX-BALLOON_FILL_BASE)*frac;
      cur.fill = Math.min(1, cur.fill + rate*dt);
      S.flash=1;
      cur._liveMsg = cur.fill>0.8? "快滿了！再撐一下！" : "蓄力中，很好！";
    } else {
      cur.fill = Math.max(0, cur.fill - BALLOON_LEAK*dt);
      cur._liveMsg = flow>0 ? "再用力一點！" : null;
    }
    if(cur.fill>=1.0){
      spawnPop(api);
      judgeBalloon(cur, api, true); advanceQueue();
    } else if(S.activeElapsed >= cur.slotSec){
      judgeBalloon(cur, api, false); advanceQueue();
    }
  }

  S.flash = Math.max(0, S.flash - dt*4);
  for(const fx of S.popFx){
    fx.t += dt;
    for(const p of fx.parts){ p.vy+=420*dt; p.x+=p.vx*dt; p.y+=p.vy*dt; p.life-=dt; }
  }
  S.popFx = S.popFx.filter(fx => fx.parts.some(p=>p.life>0));
}

function render(g,w,h,api){
  const C=g.colors;
  g.ctx.fillStyle=C.header; g.ctx.fillRect(0,0,w,50);
  g.text("呼吸太鼓",18,25,20,C.cream,"left");
  g.text(`分數 ${S.score}　連段 ${S.combo}`,w-18,18,15,C.gold,"right");
  g.text(`最佳連段 ${S.bestCombo}`,w-18,38,13,C.dim,"right",false);

  const laneY = h*0.42, laneH = 70, judgeX = w*0.22;
  const top=laneY-laneH, bot=laneY+laneH;

  g.rrect(0,top,w,bot,0); g.fill(C.track);
  g.ctx.globalAlpha=0.4; g.rrect(0,top,judgeX,bot,0); g.fill(C.panel); g.ctx.globalAlpha=1;
  g.line(0,top,w,top,"#39405f",1);
  g.line(0,bot,w,bot,"#39405f",1);
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
    g.text("呼吸太鼓：氣球為主",w/2,laneY-30,28,C.cream);
    g.text("先吸氣熱身，接著吹一顆吸氣氣球；再吐氣熱身，最後吹一顆吐氣氣球",w/2,laneY+10,15,C.dim,"center",false);
    g.text("氣球吹滿會爆掉才算過關；時間到了沒完成就直接算失敗、換下一個",w/2,laneY+34,15,C.dim,"center",false);
    return;
  }

  if(S.qIndex < S.notes.length){
    const cur = S.notes[S.qIndex];
    const remainPx = Math.max(0, (cur.slotSec - S.activeElapsed) * SCROLL_SPEED);
    const isInhale = cur.kind==="inhale";
    const base = isInhale? C.redBr : C.blue;
    const label = cur.type==="hold" ? (isInhale?"吸氣":"吐氣") : (isInhale?"吸氣氣球":"吐氣氣球");
    g.text(`【${label}】`, judgeX, top-24, 15, C.gold, "left", false);

    // ---- 目前這個音符,固定畫在判定線上 ----
    if(cur.type==="hold"){
      const wpx = cur.slotSec*SCROLL_SPEED;
      const x0=judgeX, x1=judgeX+wpx;
      g.rrect(x0,laneY-24,x1,laneY+24,14); g.fill(base);
      if(cur.holdHit>0){
        const fx = x0 + (cur.holdHit/cur.dur)*(x1-x0);
        g.rrect(x0,laneY-24,Math.min(x1,fx),laneY+24,14); g.fill(C.gold);
      }
      g.stroke(C.goldDk,2);
      g.text(isInhale?"吸氣":"吐氣",(x0+x1)/2,laneY,14,"#1b1f2e");
    } else if(cur.type==="balloon"){
      const cx = judgeX+70, cy=laneY;
      const R = 22 + cur.fill*70;
      const grd=g.ctx.createRadialGradient(cx-R*0.3,cy-R*0.3,R*0.2,cx,cy,R);
      const hue = isInhale? 5 : 205;
      grd.addColorStop(0,`hsl(${hue},90%,75%)`); grd.addColorStop(1,`hsl(${hue},80%,55%)`);
      g.ctx.fillStyle=grd; g.ctx.beginPath(); g.ctx.ellipse(cx,cy,R*0.92,R,0,0,6.283); g.ctx.fill();
      g.ctx.globalAlpha=0.5; g.circle(cx-R*0.3,cy-R*0.32,R*0.15,"#ffffff"); g.ctx.globalAlpha=1;
      g.line(cx,cy+R,cx,cy+R+18,C.dim,2);
      g.text(`${Math.round(cur.fill*100)}%`, cx, cy, Math.max(14,R*0.35), "#1b1f2e");
      if(cur._liveMsg) g.text(cur._liveMsg, cx, cy-R-18, 14, C.gold, "center", false);
    }

    // 剩餘配額時間的空白區(視覺上會被下一個音符逐漸吃掉)
    const nextX = cur.type==="hold"
      ? judgeX + cur.slotSec*SCROLL_SPEED
      : judgeX + 140 + remainPx;

    // ---- 後面排隊的音符,持續往判定線方向流動接近 ----
    let cursorX = nextX;
    for(let i=S.qIndex+1; i<S.notes.length; i++){
      const n = S.notes[i];
      const nIsInhale = n.kind==="inhale";
      const nBase = nIsInhale? C.redBr : C.blue;
      const wpx = (n.type==="hold" ? n.dur*SCROLL_SPEED : 130);
      const x0=cursorX, x1=cursorX+wpx;
      if(x0 > w+40) break;
      if(n.type==="hold"){
        g.rrect(x0,laneY-24,x1,laneY+24,14); g.fill(nBase); g.stroke(C.goldDk,2);
        if(x1-x0>46) g.text(nIsInhale?"吸氣":"吐氣",(x0+x1)/2,laneY,14,"#1b1f2e");
      } else {
        g.circle((x0+x1)/2, laneY, 22, nBase);
        g.stroke(C.goldDk,2);
        g.text(nIsInhale?"吸":"吐", (x0+x1)/2, laneY, 14, "#1b1f2e");
      }
      cursorX = x1 + 40;
    }
  }

  // 爆炸特效
  for(const fx of S.popFx){
    const cx=judgeX+70, cy=laneY;
    for(const p of fx.parts){
      g.ctx.globalAlpha=Math.max(0,p.life);
      g.circle(cx+p.x, cy+p.y, p.sz, p.col);
      g.ctx.globalAlpha=1;
    }
  }

  // 即時流速
  const mx0=judgeX, mx1=w-40, my=h*0.75;
  g.text("即時氣流",mx0,my-18,13,C.dim,"left",false);
  g.rrect(mx0,my,mx1,my+22,8); g.fill(C.track);
  const frac=Math.min(1,(S.liveFlow||0)/150);
  if(frac>0.02){ g.rrect(mx0,my,mx0+(mx1-mx0)*frac,my+22,8); g.fill(C.gold); }
  g.text(`${Math.round(S.liveFlow||0)}`,mx1+14,my+11,14,C.cream,"left");

  if(S.judgeText && S.songT < S.judgeUntil){
    const age = 0.6-(S.judgeUntil-S.songT);
    g.text(S.judgeText, judgeX+70, laneY-100-age*40, 24, S.judgeCol);
  }

  if(S.done){
    g.text("演奏結束！",w/2,laneY-40,32,C.gold);
    const passed = S.gauge>=GAUGE_CLEAR;
    g.text(passed? "合格 🎉" : "再挑戰一次！",w/2,laneY-4,20,passed?C.green:C.redBr);
    g.text(`良 ${S.counts.great||0}　可 ${S.counts.good||0}　不可 ${S.counts.miss||0}`,w/2,laneY+26,14,C.cream,"center",false);
  }
}

export default { title:"呼吸太鼓", reset, primaryLabel, primary, update, render };
