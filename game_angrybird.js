// 吸氣彈弓鳥 — 偵測吸氣流速(單次爆發,peak inhale)。一口氣裡吸得最用力的
// 那一瞬間(peak flow)直接決定發射力道,吸氣結束(訊號回到安靜)就自動發射。
// 目標是遠方的城牆,需要接近全力吸氣才能打倒它,力道不夠只會被彈開。
const P = {
  ONSET: 10,          // 低於這個流速不算開始吸氣
  REF_MAX: 60,        // peak flow 達到這個值,力道視為 100%(可依裝置實測調整)
  GRAVITY: 620,
  VX_SCALE: 100,       // 力道 1.0 時的水平初速
  VY_SCALE: 100,       // 力道 1.0 時的垂直初速(往上)
  GROUND_Y_RATIO: 0.82,
  WALL: {
    xr: 0.5,           // 城牆位置(畫面寬度比例) — 放得夠遠,弱力道飛不到
    halfW: 3,           // 城牆半寬(px)
    heightRatio: 0.30,   // 城牆高度(畫面高度比例)
    breakThreshold: 0.85,// 力道要達到這個比例以上,城牆才會被打倒
    pts: 50,
  },
};

let S;

function reset(api){
  S = {
    phase: "aim",           // aim(等待吸氣) -> flight(飛行中) -> result(結算,等按鈕)
    peak: 0,                 // 這口氣目前偵測到的最高流速
    power: 0,                 // 換算後的發射力道 0~1
    wrong: false,
    liveFlow: 0,
    bx: 0, by: 0, bvx: 0, bvy: 0, trail: [],
    round: 1,
    score: api.store.get("angrybird_score", 0),
    best: api.store.get("angrybird_best", 0),
    wallBroken: false,
    rubble: [],
    msg: "深吸一口氣，用最大的力氣打倒城牆！",
    msgCol: api.colors.cream,
    shake: 0,
  };
}
function primaryLabel(){
  if(S.phase==="result") return "再射一次";
  return "";
}
function primary(api){
  if(S.phase!=="result") return;
  S.phase="aim"; S.peak=0; S.power=0; S.trail=[]; S.rubble=[];
  S.msg="深吸一口氣，用最大的力氣打倒城牆！"; S.msgCol=api.colors.cream;
  S.round += 1;
  if(S.wallBroken) S.wallBroken=false; // 重新蓋一面牆
}

function launch(api){
  S.power = Math.max(0, Math.min(1, S.peak / P.REF_MAX));
  S.bvx = P.VX_SCALE * S.power;
  S.bvy = -P.VY_SCALE * S.power;
  S.phase = "flight";
  S.trail = [];
}

function update(dt, input, api){
  S.liveFlow = 0; S.wrong = false;

  if(S.phase==="aim"){
    if(input.direction==="inhalation" && input.flow>P.ONSET){
      S.liveFlow = input.flow;
      S.peak = Math.max(S.peak, input.flow); // 只記錄這口氣的最高瞬間值,不做時間累積
      const pct = Math.round(Math.min(1,S.peak/P.REF_MAX)*100);
      S.msg = pct<50? "吸氣中…用最大的力氣吸！" : pct<85? "快到了！再吸大力一點！" : "力道足夠了！鬆口氣發射！";
      S.msgCol = api.colors.gold;
    } else if(input.direction==="exhalation" && input.flow>P.ONSET){
      S.wrong = true;
      S.msg = "這款要用「吸氣」喔～"; S.msgCol=api.colors.gold;
    } else {
      // 沒有訊號(安靜狀態) = 這口氣結束 = 直接用剛剛的 peak 發射
      if(S.peak > 0.01) launch(api);
    }
    return;
  }

  if(S.phase==="flight"){
    const w = api.canvasW || 800, h = api.canvasH || 500;
    const groundY = h*P.GROUND_Y_RATIO;
    const wallX = P.WALL.xr*w;
    const wallTop = groundY - h*P.WALL.heightRatio;

    S.bvy += P.GRAVITY*dt;
    S.bx += S.bvx*dt; S.by += S.bvy*dt;
    S.trail.push({x:S.bx, y:S.by}); if(S.trail.length>60) S.trail.shift();

    // 撞到城牆的範圍(牆還沒倒的話)
    if(!S.wallBroken && S.bx >= wallX-P.WALL.halfW-10 && S.bx <= wallX+P.WALL.halfW+10 && S.by >= wallTop){
      if(S.power >= P.WALL.breakThreshold){
        S.wallBroken = true;
        S.score += P.WALL.pts; api.store.set("angrybird_score", S.score);
        S.best = Math.max(S.best, P.WALL.pts); api.store.set("angrybird_best", S.best);
        S.shake = 1;
        spawnRubble(wallX, wallTop, h);
        S.msg = `轟！城牆倒了！+${P.WALL.pts} 分`; S.msgCol=api.colors.gold;
      } else {
        S.shake = 0.4;
        S.msg = `力道不夠，城牆太堅固了！（力道 ${Math.round(S.power*100)}%，至少要 ${Math.round(P.WALL.breakThreshold*100)}%）`;
        S.msgCol = api.colors.cream;
      }
      S.phase = "result";
      return;
    }

    if(S.by >= groundY || S.bx > w+40){
      S.phase = "result";
      if(S.bx < wallX-P.WALL.halfW){
        S.msg = "沒力道，還沒飛到城牆就掉下來了，再吸大力一點！"; S.msgCol=api.colors.cream;
      } else {
        S.msg = "飛過頭了，太用力了一點～"; S.msgCol=api.colors.cream;
      }
    }
    return;
  }

  // result 階段
  S.shake = Math.max(0, S.shake - dt*3);
  for(const r of S.rubble){ r.vy+=560*dt; r.x+=r.vx*dt; r.y+=r.vy*dt; r.life-=dt; }
  S.rubble = S.rubble.filter(r=>r.life>0);
}

function spawnRubble(x, topY, h){
  for(let i=0;i<24;i++){
    const a=Math.random()*Math.PI-Math.PI/2;
    const spd=(80+Math.random()*180);
    S.rubble.push({
      x:(Math.random()*2-1)*P.WALL.halfW, y:(Math.random()*-1)*h*P.WALL.heightRatio,
      vx:Math.cos(a)*spd, vy:-Math.abs(Math.sin(a)*spd)-40,
      life:0.9+Math.random()*0.6, sz:4+Math.random()*6,
    });
  }
}

function drawWall(g, wallX, groundY, h){
  const C=g.colors;
  const wallH = h*P.WALL.heightRatio;
  const left = wallX-P.WALL.halfW, right = wallX+P.WALL.halfW, top = groundY-wallH;
  const rows = 5, cols = 3;
  const bh = wallH/rows, bw = (right-left)/cols;
  for(let r=0;r<rows;r++){
    const offset = (r%2===0) ? 0 : bw*0.5;
    for(let c=-1;c<cols+1;c++){
      const bx1 = left + c*bw + offset;
      const bx2 = bx1 + bw - 3;
      if(bx2<left-2 || bx1>right+2) continue;
      const by1 = groundY - (r+1)*bh;
      const by2 = by1 + bh - 3;
      g.rrect(Math.max(bx1,left), by1, Math.min(bx2,right), by2, 2);
      g.fill("#b8862a"); g.stroke("#6a4a1a",1);
    }
  }
}

function render(g,w,h,api){
  api.canvasW = w; api.canvasH = h; // 讓 update() 拿得到畫布尺寸
  const C=g.colors;
  const sx=(Math.random()*2-1)*S.shake*8, sy=(Math.random()*2-1)*S.shake*8;

  g.ctx.fillStyle=C.header; g.ctx.fillRect(0,0,w,50);
  g.text("吸氣彈弓鳥",18,25,20,C.cream,"left");
  g.text(`分數 ${S.score}`,w-18,18,15,C.gold,"right");
  g.text(`第 ${S.round} 發`,w-18,38,13,C.dim,"right",false);

  const groundY=h*P.GROUND_Y_RATIO+sy;
  g.line(0,groundY,w,groundY,"#6a2530",2);
  g.ctx.fillStyle="#3a2a12"; g.ctx.fillRect(0,groundY,w,h-groundY);

  const slingX=w*0.12+sx, slingY=groundY-70;
  const wallX=P.WALL.xr*w+sx;

  // 城牆(還沒倒才畫)
  if(!S.wallBroken) drawWall(g, wallX, groundY, h);
  else g.text("🏚️",wallX,groundY-30+sy,34,C.dim);

  // 飛散的碎石
  for(const r of S.rubble){
    g.ctx.globalAlpha=Math.max(0,Math.min(1,r.life));
    g.circle(wallX+r.x+sx, groundY-h*P.WALL.heightRatio+r.y+sy, r.sz, "#b8862a");
    g.ctx.globalAlpha=1;
  }

  // 力道條(吸氣中即時顯示目前這口氣抓到的peak)
  if(S.phase==="aim"){
    const barX=slingX, barTop=slingY-90, barBot=slingY-10;
    g.rrect(barX-14,barTop,barX+14,barBot,8); g.fill(C.track); g.stroke(C.goldDk,2);
    const curPower = Math.max(0, Math.min(1, S.peak / P.REF_MAX));
    const fillY = barBot - (barBot-barTop)*curPower;
    g.rrect(barX-10,fillY,barX+10,barBot-2,6); g.fill(curPower>=P.WALL.breakThreshold?C.gold:C.green);
    // 門檻標線
    const threshY = barBot - (barBot-barTop)*P.WALL.breakThreshold;
    g.line(barX-18,threshY,barX+18,threshY,C.redBr,2,[3,3]);
    const pull = curPower*46;
    g.circle(slingX-pull*0.6, slingY+pull*0.5, 16, "#e6402f");
    g.circle(slingX-pull*0.6-6, slingY+pull*0.5-4, 4, "#2a0a10");
  }
  // 彈弓架
  g.line(slingX-14, slingY+30, slingX-14, slingY-40, "#7a5a2a", 6);
  g.line(slingX+14, slingY+30, slingX+14, slingY-40, "#7a5a2a", 6);

  if(S.phase==="flight"){
    for(let i=0;i<S.trail.length;i++){
      const p=S.trail[i]; const a=i/S.trail.length;
      g.ctx.globalAlpha=a*0.5; g.circle(p.x+sx,p.y+sy,4,C.cream); g.ctx.globalAlpha=1;
    }
    g.circle(S.bx+sx, S.by+sy, 16, "#e6402f");
    g.circle(S.bx+sx-6, S.by+sy-4, 4, "#2a0a10");
  }

  // 提示文字
  g.text(S.msg, w/2, 78, Math.min(22,w*0.028), S.msgCol);
  if(S.wrong) g.text("記得是「吸氣」喔～", w/2, 108, 15, C.gold);
  if(S.phase==="aim") g.text(`目前力道 ${Math.round(Math.min(1,S.peak/P.REF_MAX)*100)}%　（需要 ${Math.round(P.WALL.breakThreshold*100)}% 以上）`, w/2, h-18, 15, C.cream);
  if(S.phase==="result") g.text("按「再射一次」繼續", w/2, h-18, 15, C.dim, "center", false);
  g.text(`個人最高單發 ${S.best} 分`, 18, h-14, 13, C.dim, "left", false);
}

export default { title:"吸氣彈弓鳥", reset, primaryLabel, primary, update, render };
