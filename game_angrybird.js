// 吸氣彈弓鳥 — 偵測吸氣流速(peak inhale)。吸氣時像拉彈弓一樣蓄力,
// 吸氣結束(放開)那瞬間發射,蓄力越多飛越遠,把小鳥射去撞倒豬堡壘。
const P = {
  ONSET: 10,          // 低於這個流速不算開始吸氣
  MIN_LAUNCH: 14,      // 蓄力太少(幾乎沒吸)不會發射,提示重來
  CHARGE_SCALE: 0.017, // 吸氣流速 -> 蓄力累積速度的比例
  MAX_POWER: 1.0,      // 蓄力上限(正規化 0~1)
  GRAVITY: 620,
  VX_SCALE: 620,       // 蓄力 1.0 時的水平初速
  VY_SCALE: 460,       // 蓄力 1.0 時的垂直初速(往上)
  GROUND_Y_RATIO: 0.82,
  TARGETS: [           // 豬堡壘,x 用畫面寬度比例表示,越遠分數越高
    { xr: 0.42, pts: 10, r: 22, hit: false, label: "近堡" },
    { xr: 0.62, pts: 20, r: 20, hit: false, label: "中堡" },
    { xr: 0.83, pts: 35, r: 18, hit: false, label: "遠堡" },
  ],
};

let S;
function freshTargets(){ return P.TARGETS.map(t=>({...t, hit:false, knock:0})); }

function reset(api){
  S = {
    phase: "aim",           // aim(蓄力中) -> flight(飛行中) -> result(結算,等按鈕)
    power: 0,               // 目前蓄力 0~1
    wrong: false,
    liveFlow: 0,
    bx: 0, by: 0, bvx: 0, bvy: 0, trail: [],
    round: 1,
    score: api.store.get("angrybird_score", 0),
    best: api.store.get("angrybird_best", 0),
    targets: freshTargets(),
    msg: "深吸一口氣蓄力，放開就發射～",
    msgCol: api.colors.cream,
    shake: 0,
    lastHitLabel: null,
  };
}
function primaryLabel(){
  if(S.phase==="result") return "再射一次";
  return "";
}
function primary(api){
  if(S.phase!=="result") return;
  S.phase="aim"; S.power=0; S.trail=[]; S.msg="深吸一口氣蓄力，放開就發射～"; S.msgCol=api.colors.cream;
  S.round += 1;
  if(S.targets.every(t=>t.hit)) S.targets = freshTargets(); // 全部打倒就重新擺一輪
}

function launch(api){
  const pw = S.power;
  S.bvx = P.VX_SCALE * pw;
  S.bvy = -P.VY_SCALE * pw;
  S.phase = "flight";
  S.trail = [];
}

function update(dt, input, api){
  S.liveFlow = 0; S.wrong = false;

  if(S.phase==="aim"){
    if(input.direction==="inhalation" && input.flow>P.ONSET){
      S.liveFlow = input.flow;
      S.power = Math.min(P.MAX_POWER, S.power + input.flow*P.CHARGE_SCALE*dt);
      S.msg = S.power<0.4? "吸氣蓄力中…" : S.power<0.75? "力道不錯，再吸一點！" : "拉滿了！鬆口氣就發射～";
      S.msgCol = api.colors.gold;
    } else if(input.direction==="exhalation" && input.flow>P.ONSET){
      S.wrong = true;
      S.msg = "這款要用「吸氣」蓄力喔～"; S.msgCol=api.colors.gold;
    } else {
      // 沒有訊號(安靜狀態) = 放開手 = 發射
      if(S.power >= P.MIN_LAUNCH*P.CHARGE_SCALE*0.3 ){ /* no-op, replaced below */ }
      if(S.power > 0.03){
        launch(api);
      }
    }
    return;
  }

  if(S.phase==="flight"){
    const w = api.canvasW || 800, h = api.canvasH || 500;
    const groundY = h*P.GROUND_Y_RATIO;
    S.bvy += P.GRAVITY*dt;
    S.bx += S.bvx*dt; S.by += S.bvy*dt;
    S.trail.push({x:S.bx, y:S.by}); if(S.trail.length>60) S.trail.shift();

    // 撞擊判定(飛越目標上方一定範圍內算命中)
    for(const t of S.targets){
      if(t.hit) continue;
      const tx = t.xr*w;
      if(Math.abs(S.bx - tx) < t.r+10 && S.by > groundY - 90){
        t.hit = true; t.knock = 1;
        S.score += t.pts; api.store.set("angrybird_score", S.score);
        S.best = Math.max(S.best, t.pts); api.store.set("angrybird_best", S.best);
        S.lastHitLabel = t.label;
        S.shake = 1;
        S.msg = `命中${t.label}！+${t.pts} 分`; S.msgCol=api.colors.gold;
        S.phase = "result";
        return;
      }
    }

    if(S.by >= groundY || S.bx > w+40){
      S.phase = "result";
      if(!S.lastHitLabelSetThisShot){
        S.msg = "可惜，沒打中，再吸大力一點！"; S.msgCol=api.colors.cream;
      }
    }
    return;
  }

  // result 階段:什麼都不做,等使用者按「再射一次」
  S.shake = Math.max(0, S.shake - dt*3);
}

function render(g,w,h,api){
  api.canvasW = w; api.canvasH = h; // 讓 update() 拿得到畫布尺寸
  const C=g.colors;
  const sx=(Math.random()*2-1)*S.shake*6, sy=(Math.random()*2-1)*S.shake*6;

  g.ctx.fillStyle=C.header; g.ctx.fillRect(0,0,w,50);
  g.text("吸氣彈弓鳥",18,25,20,C.cream,"left");
  g.text(`分數 ${S.score}`,w-18,18,15,C.gold,"right");
  g.text(`第 ${S.round} 發`,w-18,38,13,C.dim,"right",false);

  const groundY=h*P.GROUND_Y_RATIO+sy;
  g.line(0,groundY,w,groundY,"#6a2530",2);
  // 天空底色由外層清掉,這裡只補地面色塊
  g.ctx.fillStyle="#3a2a12"; g.ctx.fillRect(0,groundY,w,h-groundY);

  const slingX=w*0.12+sx, slingY=groundY-70;

  // 目標豬堡壘
  for(const t of S.targets){
    const tx=t.xr*w+sx, ty=groundY-t.r-2+sy;
    if(t.hit){
      g.ctx.globalAlpha=0.35;
      g.circle(tx,ty+8,t.r*1.1,"#5a7a3a");
      g.ctx.globalAlpha=1;
      g.text("💥",tx,ty-6,26,C.gold);
    } else {
      g.circle(tx,ty,t.r,"#8fbf5a");
      g.circle(tx-t.r*0.35,ty-t.r*0.2,t.r*0.22,"#fff");
      g.circle(tx+t.r*0.35,ty-t.r*0.2,t.r*0.22,"#fff");
      g.circle(tx-t.r*0.35,ty-t.r*0.2,t.r*0.10,"#2a0a10");
      g.circle(tx+t.r*0.35,ty-t.r*0.2,t.r*0.10,"#2a0a10");
      g.text(`+${t.pts}`,tx,ty+t.r+16,12,C.dim,"center",false);
    }
  }

  // 蓄力條(彈弓拉繩視覺化)
  if(S.phase==="aim"){
    const barX=slingX, barTop=slingY-90, barBot=slingY-10;
    g.rrect(barX-14,barTop,barX+14,barBot,8); g.fill(C.track); g.stroke(C.goldDk,2);
    const fillY = barBot - (barBot-barTop)*S.power;
    g.rrect(barX-10,fillY,barX+10,barBot-2,6); g.fill(S.power>0.75?C.gold:C.green);
    // 拉弓的鳥(蓄力越多往後拉越多,同時往下沉一點模擬拉弦)
    const pull = S.power*46;
    g.circle(slingX-pull*0.6, slingY+pull*0.5, 16, "#e6402f");
    g.circle(slingX-pull*0.6-6, slingY+pull*0.5-4, 4, "#2a0a10");
  }
  // 彈弓架
  g.line(slingX-14, slingY+30, slingX-14, slingY-40, "#7a5a2a", 6);
  g.line(slingX+14, slingY+30, slingX+14, slingY-40, "#7a5a2a", 6);

  if(S.phase==="flight"){
    // 飛行軌跡
    for(let i=0;i<S.trail.length;i++){
      const p=S.trail[i]; const a=i/S.trail.length;
      g.ctx.globalAlpha=a*0.5; g.circle(p.x+sx,p.y+sy,4,C.cream); g.ctx.globalAlpha=1;
    }
    g.circle(S.bx+sx, S.by+sy, 16, "#e6402f");
    g.circle(S.bx+sx-6, S.by+sy-4, 4, "#2a0a10");
  }

  // 提示文字
  g.text(S.msg, w/2, 78, Math.min(24,w*0.03), S.msgCol);
  if(S.wrong) g.text("記得是「吸氣」蓄力喔～", w/2, 108, 15, C.gold);
  if(S.phase==="aim") g.text(`蓄力 ${Math.round(S.power*100)}%`, w/2, h-18, 15, C.cream);
  if(S.phase==="result") g.text("按「再射一次」繼續", w/2, h-18, 15, C.dim, "center", false);
  g.text(`個人最高單發 ${S.best} 分`, 18, h-14, 13, C.dim, "left", false);
}

export default { title:"吸氣彈弓鳥", reset, primaryLabel, primary, update, render };
