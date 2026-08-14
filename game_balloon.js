// 吹氣球 — 持久穩定吐氣(耐力)。穩穩地把氣持續吐出去,讓氣球越吹越大,撐住就放飛。
const P = { ONSET:12, LO:20, HI:130, FILL_RATE:0.26, LEAK:0.34, HOLD_TARGET:1.0,
  WIN_SIZE:1.0, GENTLE:0.6 };

let S;
function reset(api){
  S = { size:0, flew:false, flyY:0, success:api.store.get("balloon_best",0),
    inBand:0, fb:"深吸一口氣，穩穩地把氣吐出去～", fbCol:api.colors.cream,
    steadyBonus:0, wrong:false, sparkle:[], hue:0, running:true };
}
function primaryLabel(){ return "換一顆氣球"; }
function primary(api){ const b=S.success; reset(api); S.success=b; }

function update(dt, input, api){
  // 只吃吐氣
  let flow=0; S.wrong=false;
  if(input.direction==="exhalation") flow=input.flow;
  else if(input.direction==="inhalation" && input.flow>P.ONSET) S.wrong=true;

  if(S.flew){ S.flyY += dt*0.6; for(const s of S.sparkle){ s.life-=dt; s.y-=dt*40; }
    S.sparkle=S.sparkle.filter(s=>s.life>0);
    if(S.flyY>1.4){ /* 等使用者按換一顆 */ } return; }

  const inBand = flow>=P.LO && flow<=P.HI;
  const tooWeak = flow>0 && flow<P.LO;
  const tooStrong = flow>P.HI;
  if(inBand){ S.size=Math.min(1, S.size + P.FILL_RATE*dt); S.inBand+=dt;
    S.fb = flow<P.LO+25? "很好，穩穩地吹～" : "保持這個力道！"; S.fbCol=api.colors.green; }
  else if(tooStrong){ S.size=Math.min(1,S.size+P.FILL_RATE*0.5*dt); S.inBand=0;
    S.fb="太用力了，放輕鬆一點～"; S.fbCol=api.colors.gold; }
  else { S.size=Math.max(0, S.size - P.LEAK*dt); if(tooWeak){ S.inBand=0; S.fb="再吹強一點，氣球才會脹～"; S.fbCol=api.colors.cream; } }

  S.hue=(S.hue+dt*40)%360;
  // 吹滿且穩住 -> 放飛
  if(S.size>=0.999){
    S.flew=true; S.flyY=0; S.success+=1; api.store.set("balloon_best",Math.max(S.success, api.store.get("balloon_best",0)));
    S.fb="放飛成功！太棒了 🎉"; S.fbCol=api.colors.gold;
    for(let i=0;i<28;i++){ S.sparkle.push({x:(Math.random()*2-1),y:0,life:0.8+Math.random()*0.6,
      col:[api.colors.gold,api.colors.redBr,api.colors.green,api.colors.blue][i%4],sz:3+Math.random()*4}); }
  }
  S.liveFlow=flow;
}

function render(g,w,h,api){
  const C=g.colors;
  g.ctx.fillStyle=C.header; g.ctx.fillRect(0,0,w,50);
  g.text("吹氣球",18,25,20,C.cream,"left");
  g.text(`放飛 ${S.success} 顆`,w-18,25,15,C.gold,"right");

  const cx=w*0.5, groundY=h-70;
  // 目標力道帶(左側直條)
  const mx=48, top=110, bot=h-90, span=bot-top;
  g.rrect(mx-16,top,mx+16,bot,10); g.fill(C.track); g.stroke(C.goldDk,2);
  const yOf=(v)=> bot - Math.max(0,Math.min(1,v/160))*span;
  // 綠色理想帶
  g.ctx.globalAlpha=0.35; g.rrect(mx-14,yOf(P.HI),mx+14,yOf(P.LO),6); g.fill(C.green); g.ctx.globalAlpha=1;
  const fv=S.liveFlow||0; g.rrect(mx-12,yOf(fv),mx+12,bot-2,8); g.fill(fv>=P.LO&&fv<=P.HI?C.green:C.redBr);
  g.text("力道",mx,bot+16,12,C.dim);
  g.text("穩定帶",mx+26,(yOf(P.LO)+yOf(P.HI))/2,12,C.green,"left");

  // 氣球
  const flyOff = S.flew? S.flyY*(groundY+120) : 0;
  const by = groundY - 40 - S.size*220 - flyOff;
  const R = 26 + S.size*120;
  // 綁繩
  if(!S.flew || S.flyY<0.2) g.line(cx, by+R, cx, groundY, C.dim,2);
  // 球體
  const grd=g.ctx.createRadialGradient(cx-R*0.3,by-R*0.3,R*0.2,cx,by,R);
  const hue=S.hue;
  grd.addColorStop(0,`hsl(${hue},90%,75%)`); grd.addColorStop(1,`hsl(${hue},80%,55%)`);
  g.ctx.fillStyle=grd; g.ctx.beginPath(); g.ctx.ellipse(cx,by,R*0.92,R,0,0,6.283); g.ctx.fill();
  g.ctx.fillStyle=`hsl(${hue},80%,55%)`; g.ctx.beginPath(); g.ctx.moveTo(cx-6,by+R-2); g.ctx.lineTo(cx+6,by+R-2); g.ctx.lineTo(cx,by+R+10); g.ctx.fill();
  // 高光
  g.ctx.globalAlpha=0.5; g.circle(cx-R*0.32,by-R*0.34,R*0.16,"#ffffff"); g.ctx.globalAlpha=1;

  // 地面
  g.line(0,groundY,w,groundY,"#6a2530",2);

  // 進度
  g.text(`${Math.round(S.size*100)}%`,cx,by,Math.max(16,R*0.5),"#2a0a10");

  // sparkle
  for(const s of S.sparkle){ g.ctx.globalAlpha=Math.max(0,s.life); g.circle(cx+s.x*140,by+s.y*160,s.sz,s.col); g.ctx.globalAlpha=1; }

  // feedback
  g.text(S.fb,w/2,84,Math.min(26,w*0.033),S.fbCol);
  if(S.wrong) g.text("這款是「吐氣」喔～",w/2,116,16,C.gold);
  g.text(`力道 ${Math.round(S.liveFlow||0)}`,cx,groundY+20,15,C.cream);
}

export default { title:"吹氣球", reset, primaryLabel, primary, update, render };
