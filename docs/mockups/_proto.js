// shared prototype runtime: screen switching, stagger-in, pass renderer, flip, toast
window.P = (() => {
  const $ = (s, r=document) => r.querySelector(s), $$ = (s, r=document) => [...r.querySelectorAll(s)];
  function pass(o={}) {
    const d = Object.assign({brand:"Cebu Pacific",cls:"",from:"MNL",fromCity:"Manila",to:"NRT",toCity:"Tokyo",name:"SOLIVERES/A",flight:"5J 5056",boards:"06:10",seq:"042",gate:"12",seat:"14A",size:""}, o);
    const front = `<div class="pass ${d.size} ${d.cls}"><div class="hd"><div class="brand">${d.brand}</div><div class="kv"><span class="pair">GATE<b data-f="gate">${d.gate}</b></span><span class="pair">SEAT<b data-f="seat">${d.seat}</b></span></div></div><div class="route"><div><div class="city">${d.fromCity}</div><div class="code">${d.from}</div></div><div class="plane">✈</div><div style="text-align:right"><div class="city">${d.toCity}</div><div class="code">${d.to}</div></div></div><div class="grid"><div>Passenger<b data-f="name">${d.name}</b></div><div>Flight<b>${d.flight}</b></div><div>Boards<b data-f="boards">${d.boards}</b></div><div>Seq<b data-f="seq">${d.seq}</b></div></div><div class="bar"><i></i><small>${d.flight.replace(" ","")} ${d.seat}</small></div></div>`;
    if (!d.flip) return front;
    const back = `<div class="pass ${d.size} ${d.cls} back"><div class="hd"><div class="brand">${d.brand}</div></div><div class="bk"><div><span>Confirmation</span>K7X2QF</div><div><span>Fare class</span>Y · Economy</div><div><span>Priority</span>Zone 3</div><div><span>Wi‑Fi</span>CebuAir · 5J5056</div><div><span>Expires</span>15 Oct 2026</div><div><span>Serial</span>5J5056-20261014-001</div></div></div>`;
    return `<div class="flip"><div class="flip-in"><div class="face f">${front}</div><div class="face b">${back}</div></div></div>`;
  }
  function stagger(root) { $$(".stagger", root).forEach(s => $$(":scope > *", s).forEach((c,i) => { c.style.animationDelay = (i*45)+"ms"; c.classList.add("risen"); })); }
  function go(id, push=true) {
    $$("[data-screen]").forEach(s => { const on = s.dataset.screen===id; s.classList.toggle("on", on); if(on){ $$(".risen",s).forEach(e=>e.classList.remove("risen")); requestAnimationFrame(()=>stagger(s)); } });
    $$("[data-go]").forEach(b => b.classList.toggle("active", b.dataset.go===id));
    movePill();
    if (push) history.replaceState(null,"","#"+id);
  }
  function movePill(){ $$(".segwrap").forEach(w=>{ const a=$(".active",w)||$("[data-go]",w); const p=$(".segpill",w); if(!a||!p) return; p.style.width=a.offsetWidth+"px"; p.style.transform=`translateX(${a.offsetLeft}px)`; }); }
  function toast(msg){ let t=$("#toast"); if(!t){t=document.createElement("div");t.id="toast";document.body.appendChild(t);} t.textContent=msg; t.classList.remove("show"); void t.offsetWidth; t.classList.add("show"); }
  function init(){
    document.addEventListener("click", e => {
      const g=e.target.closest("[data-go]"); if(g){ e.preventDefault(); go(g.dataset.go); return; }
      const fl=e.target.closest("[data-flip]"); if(fl){ const host=$(fl.dataset.flip); const f=host && (host.classList.contains("flip")?host:host.querySelector(".flip")); if(f) f.classList.toggle("flipped", /back/i.test(fl.textContent)); fl.parentElement.querySelectorAll("span").forEach(x=>x.classList.toggle("active", x===fl)); return; }
      const dr=e.target.closest("[data-drawer]"); if(dr){ const d=$(dr.dataset.drawer); d.classList.toggle("open"); $$("[data-drawer]").forEach(x=>x.classList.toggle("sel", x===dr && d.classList.contains("open"))); return; }
      const cl=e.target.closest("[data-close]"); if(cl){ $(cl.dataset.close).classList.remove("open"); $$("[data-drawer]").forEach(x=>x.classList.remove("sel")); return; }
      const pu=e.target.closest("[data-push]"); if(pu && !pu.classList.contains("busy")){ const orig=pu.innerHTML; pu.classList.add("busy"); pu.innerHTML="Pushing…"; setTimeout(()=>{pu.innerHTML="✓ Pushed"; pu.classList.add("pushed"); toast(pu.dataset.push); setTimeout(()=>{pu.innerHTML=orig;pu.classList.remove("busy","pushed")},1800)},900); return; }
      const sel=e.target.closest("[data-pax]"); if(sel){ const list=sel.parentElement; $$("[data-pax]",list).forEach(x=>x.classList.toggle("on",x===sel)); const [name,seat,seq]=sel.dataset.pax.split("|"); $$("[data-f=name]").forEach(x=>x.textContent=name); $$("[data-f=seat]").forEach(x=>x.textContent=seat); $$("[data-f=seq]").forEach(x=>x.textContent=seq); $$("[data-bind=name]").forEach(x=>x.textContent=name); $$("[data-bind=seat]").forEach(x=>x.textContent=seat); $$("[data-bind=seq]").forEach(x=>x.textContent=seq); const pg=$("[data-pager]"); if(pg) pg.textContent=`${name} · ${[...list.children].indexOf(sel)+1} of ${$$("[data-pax]",list).length}`; const pz=$(".pass:not(.back)", $("[data-screen].on")); if(pz){pz.classList.remove("pop");void pz.offsetWidth;pz.classList.add("pop");} return; }
      const tb=e.target.closest("[data-tab]"); if(tb){ const grp=tb.closest("[data-tabs]"); const g=grp.dataset.tabs; $$("[data-tab]",grp).forEach(x=>x.classList.toggle("on",x===tb)); $$(`[data-pane-group="${g}"]`).forEach(pn=>{ pn.hidden = pn.dataset.pane!==tb.dataset.tab; if(!pn.hidden){ pn.classList.remove("risen"); void pn.offsetWidth; pn.classList.add("risen"); } }); return; }
      const st=e.target.closest("[data-status]"); if(st){ const grp=st.parentElement; $$("[data-status]",grp).forEach(x=>x.classList.toggle("on",x===st)); const tgt=$$("[data-status-target]"); tgt.forEach(t=>{ t.className=t.className.replace(/\b(ontime|boarding|delayed|cancelled)\b/g,"").trim()+" "+st.dataset.status; t.classList.remove("flap"); void t.offsetWidth; t.classList.add("flap"); t.textContent=st.textContent.trim(); }); return; }
    });
    // clock
    const tick=()=>{ $$("[data-clock]").forEach(c=>{ const d=new Date(); c.textContent=d.toTimeString().slice(0,8); }); }; tick(); setInterval(tick,1000);
    const first = location.hash.slice(1) || $("[data-screen]").dataset.screen; go(first,false);
    window.addEventListener("resize", movePill); setTimeout(movePill,50); document.fonts && document.fonts.ready.then(movePill);
  }
  // split-flap: render text as cells; flapTo animates each cell cycling to its target char
  const FLAP=" ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789:-/.→";
  function flapRender(el, text, width){ const w=width||el.dataset.w||text.length; const t=String(text).toUpperCase().padEnd(w).slice(0,w); el.classList.add("sf"); el.innerHTML=[...t].map(ch=>`<span class="cell"><i>${ch===" "?"&nbsp;":ch}</i></span>`).join(""); el.dataset.text=t; }
  function flapTo(el, text){ const w=el.dataset.w||el.querySelectorAll(".cell").length; const t=String(text).toUpperCase().padEnd(w).slice(0,w); const cells=$$(".cell",el); [...t].forEach((ch,i)=>{ const c=cells[i]; if(!c) return; const cur=c.querySelector("i").textContent.replace("\u00a0"," "); if(cur===ch) return; let k=FLAP.indexOf(cur); if(k<0)k=0; const target=FLAP.indexOf(ch)<0?0:FLAP.indexOf(ch); let steps=(target-k+FLAP.length)%FLAP.length; if(steps>14) steps=14; let n=0; const tick=()=>{ n++; k=(k+1)%FLAP.length; const show = n>=steps? ch : FLAP[k]; c.querySelector("i").innerHTML = show===" "?"&nbsp;":show; c.classList.remove("tick"); void c.offsetWidth; c.classList.add("tick"); if(n<steps) setTimeout(tick, 38+i*2); }; setTimeout(tick, i*22); }); el.dataset.text=t; }
  document.addEventListener("click", e=>{ const b=e.target.closest("[data-flapto]"); if(!b) return; const [sel,txt]=b.dataset.flapto.split("|"); const el=$(sel); if(el) flapTo(el, txt); });
  function initFlaps(){ $$("[data-flap]").forEach(el=>flapRender(el, el.dataset.flap, el.dataset.w)); }
  return {pass, go, init, toast, $, $$, flapRender, flapTo, initFlaps};
})();
