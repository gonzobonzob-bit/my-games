// Callsigns — fx: the pure-CSS station scene system (SCENE_CSS + SCENE_TIERS),
// scene-tier scoring, and the Web Audio synth. No game logic.
// Part of the modular layout (vault rule 3): index.html + js/{content,sim,fx,ui}.js
// Classic scripts sharing one top-level scope; load order: content, sim, fx, ui.
// Carved verbatim from the single-file v1 at the 50% checkpoint — refactor
// only: same 'callsigns.save' key, same v2 state shape, identical behavior.
// The v3 empire work builds on this against CONTRACT.md at 75%.
'use strict';

/* Callsigns — pure-CSS station scene system.
   Two top-level consts: SCENE_CSS (all styles) and SCENE_TIERS (6 tiers).
   No canvas, no images, no external assets. All classes prefixed sc-. */

const SCENE_CSS = `
.sc-stage,.sc-stage *{box-sizing:border-box}
.sc-stage{position:relative;width:100%;aspect-ratio:16/5;overflow:hidden;border-radius:12px;
container-type:inline-size;line-height:1;isolation:isolate;
font-family:ui-sans-serif,system-ui,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;
font-size:11px;font-size:max(7px,1.45cqw);
background:linear-gradient(180deg,#070a1e 0%,#0f0c2e 58%,#1a1040 100%);
box-shadow:inset 0 0 0 1px rgba(148,163,255,.14)}
.sc-t1{background:linear-gradient(180deg,#070a1e 0%,#0f0c2e 58%,#1a1040 100%)}
.sc-t2{background:linear-gradient(180deg,#080b21 0%,#120e32 58%,#1a1040 100%)}
.sc-t3{background:linear-gradient(180deg,#0a0e27 0%,#161038 55%,#241452 100%)}
.sc-t4{background:linear-gradient(180deg,#0a0e27 0%,#1a1040 50%,#331a5e 100%)}
.sc-t5{background:linear-gradient(180deg,#0a0e27 0%,#1d1147 48%,#431a63 100%)}
.sc-t6{background:linear-gradient(180deg,#080b24 0%,#1a1040 42%,#5a1c66 100%)}

/* --- sky layers --- */
.sc-stars{position:absolute;inset:0 0 22% 0;z-index:0;opacity:.9;
background-image:radial-gradient(1px 1px at 22% 28%,#fff,transparent),radial-gradient(1px 1px at 68% 62%,rgba(255,255,255,.7),transparent),radial-gradient(1px 1px at 44% 84%,rgba(199,210,254,.55),transparent);
background-size:23% 41%,31% 57%,17% 33%}
.sc-t4 .sc-stars{opacity:.65}.sc-t5 .sc-stars{opacity:.5}.sc-t6 .sc-stars{opacity:.45}
.sc-glow{position:absolute;left:0;right:0;bottom:12%;height:52%;z-index:1;pointer-events:none;
background:radial-gradient(62% 100% at 50% 100%,rgba(236,72,153,.26),rgba(34,211,238,.11) 46%,transparent 74%)}
.sc-g-lo{opacity:.3}.sc-g-md{opacity:.6}.sc-g-hi{opacity:1}
.sc-g-max{opacity:1;background:radial-gradient(70% 100% at 50% 100%,rgba(251,191,36,.22),rgba(236,72,153,.3) 34%,rgba(34,211,238,.14) 60%,transparent 80%)}

/* --- ground / street --- */
.sc-ground{position:absolute;left:0;right:0;bottom:0;height:22%;z-index:5;
background:linear-gradient(180deg,#0d1030 0%,#070917 100%);
border-top:1px solid rgba(148,163,255,.3)}
.sc-ground::after{content:"";position:absolute;left:0;right:0;top:62%;height:1px;
background:repeating-linear-gradient(90deg,rgba(251,191,36,.45) 0 2.5%,transparent 2.5% 6%)}

/* --- skyline + buildings --- */
.sc-skyline{position:absolute;left:0;right:0;bottom:20%;height:40%;z-index:3}
.sc-sl-lo{height:22%}.sc-sl-md{height:38%}.sc-sl-hi{height:54%}.sc-sl-xl{height:70%}
.sc-bldg{position:absolute;bottom:0;background:linear-gradient(180deg,#161c42,#0f1330);
border-radius:2px 2px 0 0;box-shadow:inset 0 0 0 1px rgba(120,140,255,.15)}
.sc-bldg::before{content:"";position:absolute;inset:7% 12% 0 12%;opacity:.4;
background-image:radial-gradient(circle at 50% 50%,rgba(251,191,36,.9) 0 36%,transparent 40%);
background-size:32% 15%}
.sc-lit::before{opacity:.85}
.sc-cyan::before{background-image:radial-gradient(circle at 50% 50%,rgba(34,211,238,.85) 0 36%,transparent 40%);opacity:.7}
.sc-ant::after{content:"";position:absolute;left:50%;bottom:100%;width:1px;height:16%;
background:linear-gradient(180deg,rgba(236,72,153,.8),rgba(148,163,255,.4))}
.sc-b1{left:1%;width:7%;height:54%}.sc-b2{left:9.5%;width:5%;height:78%}
.sc-b3{left:15.5%;width:8%;height:41%}.sc-b4{left:24.5%;width:6%;height:66%}
.sc-b5{left:31.5%;width:9%;height:88%}.sc-b6{left:41.5%;width:5%;height:50%}
.sc-b7{left:47.5%;width:7%;height:72%}.sc-b8{left:55.5%;width:6%;height:96%}
.sc-b9{left:62.5%;width:8%;height:57%}.sc-b10{left:71.5%;width:5%;height:82%}
.sc-b11{left:77.5%;width:9%;height:45%}.sc-b12{left:87.5%;width:6%;height:68%}
.sc-b13{left:94.5%;width:7%;height:52%}.sc-b14{left:-1.5%;width:5%;height:34%}

/* --- towers + beacons --- */
.sc-tower{position:absolute;bottom:21%;z-index:4;width:7%;height:34%;left:50%;margin-left:-3.5%}
.sc-tw-xs{width:1.6%;height:13%;margin-left:-.8%}
.sc-tw-s{width:3%;height:18%;margin-left:-1.5%}
.sc-tw-m{width:7%;height:36%;margin-left:-3.5%}
.sc-tw-l{width:9%;height:52%;margin-left:-4.5%}
.sc-tp-a{left:19%}.sc-tp-b{left:50%}.sc-tp-c{left:79%}.sc-tp-d{left:44%}.sc-tp-e{left:66%}
.sc-tw-r1{bottom:39%;z-index:6}.sc-tw-r2{bottom:44%;z-index:6}
.sc-mast{position:absolute;inset:0;background:linear-gradient(180deg,#9fb0e4,#4a5590);
clip-path:polygon(45% 0,55% 0,100% 100%,85% 100%,50% 24%,15% 100%,0 100%)}
.sc-mast::before{content:"";position:absolute;inset:0;
background:repeating-linear-gradient(58deg,rgba(7,10,30,.6) 0 5%,transparent 5% 12%)}
.sc-whip{position:absolute;inset:0;background:linear-gradient(180deg,#a5b4fc,#4a5590);
clip-path:polygon(38% 0,62% 0,58% 100%,42% 100%)}
.sc-whip::after{content:"";position:absolute;left:-90%;top:2%;width:280%;height:8%;
background:linear-gradient(90deg,transparent,rgba(165,180,252,.85),transparent)}
.sc-beacon{position:absolute;left:50%;width:14%;aspect-ratio:1;min-width:3px;border-radius:50%;
margin-left:-7%;background:#ef4444;box-shadow:0 0 .9cqw .18cqw rgba(239,68,68,.85)}
.sc-tw-xs .sc-beacon{width:34%;margin-left:-17%;box-shadow:0 0 .6cqw .1cqw rgba(239,68,68,.8)}
.sc-tw-s .sc-beacon{width:22%;margin-left:-11%;box-shadow:0 0 .7cqw .12cqw rgba(239,68,68,.8)}
.sc-bc-top{top:-3%}.sc-bc-mid{top:34%}.sc-bc-low{top:62%}

/* --- signal waves --- */
.sc-waves{position:absolute;z-index:2;width:0;height:0;left:50%;bottom:52%}
.sc-wv-a{left:19%}.sc-wv-b{left:50%}.sc-wv-c{left:79%}.sc-wv-d{left:44%}.sc-wv-e{left:66%}
.sc-wp-r1{bottom:51%}.sc-wp-r2{bottom:60%}.sc-wp-hi{bottom:70%}
.sc-wave{position:absolute;left:0;top:0;width:26cqw;height:26cqw;margin:-13cqw 0 0 -13cqw;
border-radius:50%;border:max(1px,.13cqw) solid rgba(34,211,238,.5);opacity:0;transform:scale(.14)}
.sc-wv-l{width:42cqw;height:42cqw;margin:-21cqw 0 0 -21cqw}
.sc-wv-xl{width:64cqw;height:64cqw;margin:-32cqw 0 0 -32cqw}
.sc-wv-pink{border-color:rgba(236,72,153,.5)}
.sc-wv-gold{border-color:rgba(251,191,36,.42)}

/* --- ground building (garage / storefront) --- */
.sc-house{position:absolute;bottom:20%;z-index:6;background:linear-gradient(180deg,#1b1f47,#12163a);
border-radius:.3cqw;box-shadow:inset 0 0 0 1px rgba(148,163,255,.22)}
.sc-hs-garage{left:33%;width:22%;height:18%}
.sc-hs-shop{left:29%;width:30%;height:23%}
.sc-roof{position:absolute;left:-5%;right:-5%;top:-9%;height:10%;border-radius:.3cqw;
background:linear-gradient(180deg,#333c78,#242a5e)}
.sc-bay{position:absolute;left:7%;bottom:0;width:44%;height:66%;border-radius:.2cqw 0 0 0;
background:radial-gradient(120% 110% at 50% 30%,rgba(251,191,36,.34),rgba(10,14,39,.9) 78%);
box-shadow:inset 0 0 0 1px rgba(251,191,36,.35)}
.sc-desk{position:absolute;left:12%;bottom:10%;width:64%;height:16%;border-radius:.1cqw;
background:linear-gradient(180deg,#4a5590,#2b3168)}
.sc-mic{position:absolute;left:44%;bottom:26%;width:6%;height:34%;background:#8b95d6}
.sc-mic::before{content:"";position:absolute;left:-110%;top:-46%;width:320%;height:56%;
border-radius:40%;background:linear-gradient(180deg,#cbd5e1,#7c86c8)}
.sc-shopwin{position:absolute;right:6%;bottom:12%;width:42%;height:62%;border-radius:.15cqw;
background:radial-gradient(130% 130% at 50% 40%,rgba(251,191,36,.5),rgba(245,158,11,.12) 80%);
box-shadow:inset 0 0 0 1px rgba(251,191,36,.55)}
.sc-onair{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);white-space:nowrap;
font-size:.62em;font-weight:800;letter-spacing:.1em;color:#160c02;background:#fbbf24;
padding:.3em .5em;border-radius:.2cqw;box-shadow:0 0 1.1cqw .1cqw rgba(251,191,36,.95)}
.sc-onair-sm{font-size:.5em;padding:.22em .4em}

/* --- billboards --- */
.sc-billboard{position:absolute;z-index:6;bottom:5%;width:19%;height:26%}
.sc-bb-hi{bottom:34%;z-index:4}
.sc-bb-sm{width:13%;height:18%}
.sc-bp-a{left:5%}.sc-bp-b{left:62%}.sc-bp-c{left:33%}.sc-bp-d{left:85%}
.sc-billboard::before,.sc-billboard::after{content:"";position:absolute;top:56%;bottom:0;
width:max(1px,.28cqw);background:linear-gradient(180deg,#4a5590,#2b3168)}
.sc-billboard::before{left:26%}.sc-billboard::after{right:26%}
.sc-bb-panel{position:absolute;inset:0 0 44% 0;display:flex;flex-direction:column;
align-items:center;justify-content:center;gap:.18em;overflow:hidden;border-radius:.35cqw;
background:linear-gradient(135deg,#2b1550,#4c1d5f 55%,#151038);
box-shadow:inset 0 0 0 max(1px,.13cqw) rgba(251,191,36,.6),0 0 2cqw rgba(236,72,153,.4)}
.sc-bb-txt{font-size:.92em;font-weight:800;letter-spacing:.06em;color:#fbbf24;
text-shadow:0 0 .55cqw rgba(251,191,36,.95)}
.sc-bb-sub{font-size:.55em;letter-spacing:.16em;color:#22d3ee}
.sc-bb-sm .sc-bb-txt{font-size:.66em}.sc-bb-sm .sc-bb-sub{display:none}

/* --- vehicles (branded wraps) --- */
.sc-veh{position:absolute;z-index:7;bottom:3%;width:12%;height:9%}
.sc-bus{width:19%;height:11%}
.sc-vp-b{left:57%}.sc-vp-c{left:30%}.sc-vp-d{right:6%}
.sc-veh::before,.sc-veh::after{content:"";position:absolute;bottom:0;height:38%;width:auto;
aspect-ratio:1;border-radius:50%;background:#0b0e26;box-shadow:inset 0 0 0 max(1px,.14cqw) #6b76b5}
.sc-veh::before{left:13%}.sc-veh::after{right:13%}
.sc-body{position:absolute;inset:0 0 20% 0;border-radius:.5cqw;
background:linear-gradient(180deg,#232a5c,#141838);box-shadow:inset 0 0 0 1px rgba(148,163,255,.3)}
.sc-cab{position:absolute;left:5%;top:16%;width:17%;height:40%;border-radius:.15cqw;
background:linear-gradient(180deg,rgba(34,211,238,.65),rgba(34,211,238,.25))}
.sc-wrap{position:absolute;left:26%;right:5%;top:16%;bottom:12%;overflow:hidden;
display:flex;align-items:center;justify-content:center;border-radius:.15cqw;
font-size:.44em;font-weight:800;letter-spacing:.04em;color:#160c02;white-space:nowrap;
background:linear-gradient(100deg,#ec4899,#f59e0b)}
.sc-bus .sc-wrap{font-size:.52em}

/* --- streetlights --- */
.sc-lamp{position:absolute;z-index:6;bottom:3%;width:max(1px,.3cqw);height:15%;
background:linear-gradient(180deg,#5b6499,#2b3168)}
.sc-lp-a{left:14%}.sc-lp-b{left:44%}.sc-lp-c{left:72%}.sc-lp-d{left:88%}.sc-lp-e{left:28%}
.sc-lamp::before{content:"";position:absolute;left:-260%;top:-4%;width:620%;height:9%;
border-radius:50%;background:#fbbf24;box-shadow:0 0 1.6cqw .28cqw rgba(251,191,36,.6)}
.sc-lamp::after{content:"";position:absolute;left:-900%;top:0;width:1900%;height:640%;
pointer-events:none;background:radial-gradient(50% 52% at 50% 0,rgba(251,191,36,.16),transparent 72%)}

/* --- press flashes --- */
.sc-flash{position:absolute;z-index:7;bottom:9%;width:.85%;aspect-ratio:1;min-width:2px;
border-radius:50%;background:#fff;box-shadow:0 0 1.5cqw .3cqw rgba(255,255,255,.85);opacity:0}
.sc-fp-a{left:24%}.sc-fp-b{left:48%}.sc-fp-c{left:69%}.sc-fp-d{left:86%}

/* --- satellite / uplink / beams --- */
.sc-dish{position:absolute;z-index:6;bottom:21%;left:4%;width:8%;height:15%}
.sc-dish::before{content:"";position:absolute;inset:0 0 34% 0;border-radius:50%;
transform:rotate(-30deg) scaleX(.52);
background:linear-gradient(150deg,#e2e8f0,#7c86c8 60%,#3b4380)}
.sc-dish::after{content:"";position:absolute;left:46%;top:56%;bottom:0;width:max(1px,.26cqw);
background:linear-gradient(180deg,#5b6499,#2b3168)}
.sc-orbit{position:absolute;z-index:2;left:0;right:0;top:11%;height:0}
.sc-sat{position:absolute;top:0;left:6%;width:4%;height:4.5cqw}
.sc-satcore{position:absolute;left:35%;top:26%;width:30%;height:44%;border-radius:.15cqw;
background:linear-gradient(180deg,#f1f5f9,#94a3b8);box-shadow:0 0 1.2cqw rgba(226,232,240,.6)}
.sc-wing{position:absolute;top:36%;width:33%;height:24%;
background:repeating-linear-gradient(90deg,#22d3ee 0 28%,#0e7490 28% 56%)}
.sc-wl{left:0}.sc-wr{right:0}
.sc-beam{position:absolute;z-index:2;transform-origin:0 50%;height:max(1px,.2cqw);border-radius:2px;
background:linear-gradient(90deg,rgba(34,211,238,.9),rgba(236,72,153,.5) 60%,transparent)}
.sc-bm-a{left:8%;bottom:35%;width:17%;transform:rotate(-42deg)}
.sc-bm-b{left:50%;bottom:72%;width:16%;transform:rotate(22deg)}
.sc-bm-c{left:20%;bottom:57%;width:22%;transform:rotate(-12deg)}
.sc-arc{position:absolute;z-index:1;left:8%;right:8%;top:6%;height:34%;pointer-events:none;
border-top:max(1px,.12cqw) dashed rgba(34,211,238,.28);border-radius:50%/100% 100% 0 0}

/* --- misc glow accents --- */
.sc-halo{position:absolute;z-index:1;left:50%;bottom:20%;width:70cqw;height:34cqw;
margin-left:-35cqw;pointer-events:none;
background:radial-gradient(50% 50% at 50% 100%,rgba(251,191,36,.2),rgba(236,72,153,.12) 45%,transparent 72%)}

@media (prefers-reduced-motion: no-preference){
@keyframes sc-blink{0%,44%{opacity:1}50%,94%{opacity:.12}100%{opacity:1}}
@keyframes sc-ring{0%{opacity:0;transform:scale(.14)}12%{opacity:.85}100%{opacity:0;transform:scale(1)}}
@keyframes sc-flicker{0%,100%{opacity:1}7%{opacity:.42}9%{opacity:1}46%{opacity:1}48%{opacity:.28}51%{opacity:.95}53%{opacity:.5}56%{opacity:1}}
@keyframes sc-pulse{0%,100%{opacity:1}50%{opacity:.72}}
@keyframes sc-drift{0%{transform:translate(0,0)}25%{transform:translate(22cqw,-2.4cqw)}50%{transform:translate(44cqw,0)}75%{transform:translate(66cqw,2.4cqw)}100%{transform:translate(88cqw,0)}}
@keyframes sc-flash{0%,88%{opacity:0}90%{opacity:1}94%{opacity:0}96%{opacity:.8}100%{opacity:0}}
.sc-beacon{animation:sc-blink 2.2s ease-in-out infinite}
.sc-bc-mid{animation-delay:.5s}.sc-bc-low{animation-delay:1s}
.sc-tp-a .sc-beacon{animation-duration:2.6s}.sc-tp-c .sc-beacon{animation-duration:1.9s}
.sc-wave{animation:sc-ring 4.2s ease-out infinite}
.sc-d1{animation-delay:1.4s}.sc-d2{animation-delay:2.8s}.sc-d3{animation-delay:.7s}
.sc-wv-a .sc-wave{animation-duration:5s}.sc-wv-c .sc-wave{animation-duration:3.6s}
.sc-bay,.sc-flick{animation:sc-flicker 5.5s linear infinite}
.sc-onair{animation:sc-pulse 3.4s ease-in-out infinite}
.sc-bb-panel{animation:sc-pulse 4.6s ease-in-out infinite}
.sc-bp-b .sc-bb-panel{animation-delay:1.1s}.sc-bp-d .sc-bb-panel{animation-delay:2.2s}
.sc-lamp::before{animation:sc-pulse 6s ease-in-out infinite}
.sc-sat{animation:sc-drift 26s linear infinite}
.sc-beam{animation:sc-pulse 2.6s ease-in-out infinite}
.sc-bm-b{animation-delay:.8s}.sc-bm-c{animation-delay:1.6s}
.sc-flash{animation:sc-flash 3.2s linear infinite}
.sc-fp-b{animation-delay:.9s}.sc-fp-c{animation-delay:1.8s}.sc-fp-d{animation-delay:2.5s}
}
`;

const SCENE_TIERS = [
  {
    id: 'garage',
    name: 'Garage Setup',
    html: `<div class="sc-stage sc-t1">
<div class="sc-stars"></div>
<div class="sc-glow sc-g-lo"></div>
<div class="sc-skyline sc-sl-lo">
<div class="sc-bldg sc-b3"></div><div class="sc-bldg sc-b11"></div><div class="sc-bldg sc-b14"></div>
</div>
<div class="sc-tower sc-tw-xs sc-tw-r1 sc-tp-d"><div class="sc-whip"></div><div class="sc-beacon sc-bc-top"></div></div>
<div class="sc-waves sc-wv-d sc-wp-r1"><div class="sc-wave"></div></div>
<div class="sc-ground"></div>
<div class="sc-house sc-hs-garage">
<div class="sc-roof"></div>
<div class="sc-bay"><div class="sc-desk"></div><div class="sc-mic"></div></div>
<div class="sc-shopwin"><div class="sc-onair sc-onair-sm">ON AIR</div></div>
</div>
<div class="sc-lamp sc-lp-c sc-flick"></div>
</div>`
  },
  {
    id: 'storefront',
    name: 'Storefront Studio',
    html: `<div class="sc-stage sc-t2">
<div class="sc-stars"></div>
<div class="sc-glow sc-g-lo"></div>
<div class="sc-skyline sc-sl-lo">
<div class="sc-bldg sc-b1"></div><div class="sc-bldg sc-b3 sc-lit"></div><div class="sc-bldg sc-b6"></div>
<div class="sc-bldg sc-b9"></div><div class="sc-bldg sc-b11"></div><div class="sc-bldg sc-b14"></div>
</div>
<div class="sc-tower sc-tw-s sc-tw-r2 sc-tp-d"><div class="sc-whip"></div><div class="sc-beacon sc-bc-top"></div></div>
<div class="sc-waves sc-wv-d sc-wp-r2"><div class="sc-wave"></div><div class="sc-wave sc-d1"></div></div>
<div class="sc-ground"></div>
<div class="sc-house sc-hs-shop">
<div class="sc-roof"></div>
<div class="sc-bay"><div class="sc-desk"></div><div class="sc-mic"></div></div>
<div class="sc-shopwin"><div class="sc-onair">ON AIR</div></div>
</div>
<div class="sc-lamp sc-lp-a"></div>
<div class="sc-lamp sc-lp-c"></div>
</div>`
  },
  {
    id: 'tower',
    name: 'Broadcast Tower',
    html: `<div class="sc-stage sc-t3">
<div class="sc-stars"></div>
<div class="sc-glow sc-g-md"></div>
<div class="sc-waves sc-wv-b sc-wp-hi">
<div class="sc-wave"></div><div class="sc-wave sc-d1"></div>
<div class="sc-wave sc-wv-l sc-d2"></div><div class="sc-wave sc-wv-l sc-wv-pink sc-d3"></div>
</div>
<div class="sc-skyline sc-sl-md">
<div class="sc-bldg sc-b1"></div><div class="sc-bldg sc-b2 sc-lit"></div><div class="sc-bldg sc-b3"></div>
<div class="sc-bldg sc-b6"></div><div class="sc-bldg sc-b7 sc-lit"></div><div class="sc-bldg sc-b9"></div>
<div class="sc-bldg sc-b11"></div><div class="sc-bldg sc-b12 sc-cyan"></div><div class="sc-bldg sc-b14"></div>
</div>
<div class="sc-tower sc-tw-m sc-tp-b">
<div class="sc-mast"></div>
<div class="sc-beacon sc-bc-top"></div><div class="sc-beacon sc-bc-mid"></div>
</div>
<div class="sc-ground"></div>
<div class="sc-lamp sc-lp-a"></div>
<div class="sc-lamp sc-lp-c"></div>
<div class="sc-lamp sc-lp-d"></div>
</div>`
  },
  {
    id: 'citywide',
    name: 'Citywide Signal',
    html: `<div class="sc-stage sc-t4">
<div class="sc-stars"></div>
<div class="sc-glow sc-g-hi"></div>
<div class="sc-waves sc-wv-b sc-wp-hi">
<div class="sc-wave"></div><div class="sc-wave sc-wv-l sc-d1"></div>
<div class="sc-wave sc-wv-xl sc-d2"></div><div class="sc-wave sc-wv-xl sc-wv-pink sc-d3"></div>
</div>
<div class="sc-skyline sc-sl-hi">
<div class="sc-bldg sc-b1 sc-lit"></div><div class="sc-bldg sc-b2 sc-lit sc-ant"></div>
<div class="sc-bldg sc-b3"></div><div class="sc-bldg sc-b4 sc-cyan"></div>
<div class="sc-bldg sc-b5 sc-lit"></div><div class="sc-bldg sc-b6"></div>
<div class="sc-bldg sc-b7 sc-lit"></div><div class="sc-bldg sc-b9 sc-cyan"></div>
<div class="sc-bldg sc-b10 sc-lit sc-ant"></div><div class="sc-bldg sc-b11"></div>
<div class="sc-bldg sc-b12 sc-lit"></div><div class="sc-bldg sc-b14"></div>
</div>
<div class="sc-tower sc-tw-l sc-tp-b">
<div class="sc-mast"></div>
<div class="sc-beacon sc-bc-top"></div><div class="sc-beacon sc-bc-mid"></div><div class="sc-beacon sc-bc-low"></div>
</div>
<div class="sc-ground"></div>
<div class="sc-billboard sc-bp-a">
<div class="sc-bb-panel"><div class="sc-bb-txt">CALLSIGNS</div><div class="sc-bb-sub">98.6 FM</div></div>
</div>
<div class="sc-veh sc-vp-b">
<div class="sc-body"><div class="sc-cab"></div><div class="sc-wrap">CALLSIGNS</div></div>
</div>
<div class="sc-lamp sc-lp-b"></div>
<div class="sc-lamp sc-lp-d"></div>
</div>`
  },
  {
    id: 'network',
    name: 'Regional Network',
    html: `<div class="sc-stage sc-t5">
<div class="sc-stars"></div>
<div class="sc-glow sc-g-hi"></div>
<div class="sc-waves sc-wv-a sc-wp-hi"><div class="sc-wave sc-wv-l"></div><div class="sc-wave sc-wv-xl sc-d2"></div></div>
<div class="sc-waves sc-wv-b sc-wp-hi"><div class="sc-wave sc-wv-l sc-d1"></div><div class="sc-wave sc-wv-xl sc-wv-pink sc-d3"></div></div>
<div class="sc-waves sc-wv-c sc-wp-hi"><div class="sc-wave sc-wv-l sc-d3"></div><div class="sc-wave sc-wv-xl sc-wv-gold"></div></div>
<div class="sc-skyline sc-sl-hi">
<div class="sc-bldg sc-b1 sc-lit"></div><div class="sc-bldg sc-b2 sc-lit sc-ant"></div>
<div class="sc-bldg sc-b3 sc-lit"></div><div class="sc-bldg sc-b4 sc-cyan"></div>
<div class="sc-bldg sc-b5 sc-lit sc-ant"></div><div class="sc-bldg sc-b6 sc-lit"></div>
<div class="sc-bldg sc-b7 sc-lit"></div><div class="sc-bldg sc-b8 sc-lit sc-ant"></div>
<div class="sc-bldg sc-b9 sc-cyan"></div><div class="sc-bldg sc-b10 sc-lit"></div>
<div class="sc-bldg sc-b11 sc-lit"></div><div class="sc-bldg sc-b12 sc-lit"></div>
<div class="sc-bldg sc-b13 sc-cyan"></div><div class="sc-bldg sc-b14 sc-lit"></div>
</div>
<div class="sc-tower sc-tw-m sc-tp-a"><div class="sc-mast"></div><div class="sc-beacon sc-bc-top"></div><div class="sc-beacon sc-bc-mid"></div></div>
<div class="sc-tower sc-tw-l sc-tp-b"><div class="sc-mast"></div><div class="sc-beacon sc-bc-top"></div><div class="sc-beacon sc-bc-mid"></div><div class="sc-beacon sc-bc-low"></div></div>
<div class="sc-tower sc-tw-m sc-tp-c"><div class="sc-mast"></div><div class="sc-beacon sc-bc-top"></div><div class="sc-beacon sc-bc-mid"></div></div>
<div class="sc-billboard sc-bb-hi sc-bb-sm sc-bp-b">
<div class="sc-bb-panel"><div class="sc-bb-txt">CALLSIGNS</div></div>
</div>
<div class="sc-ground"></div>
<div class="sc-billboard sc-bp-a">
<div class="sc-bb-panel"><div class="sc-bb-txt">CALLSIGNS</div><div class="sc-bb-sub">THE NETWORK</div></div>
</div>
<div class="sc-billboard sc-bb-sm sc-bp-d">
<div class="sc-bb-panel"><div class="sc-bb-txt">ON AIR</div></div>
</div>
<div class="sc-veh sc-bus sc-vp-c">
<div class="sc-body"><div class="sc-cab"></div><div class="sc-wrap">CALLSIGNS NET</div></div>
</div>
<div class="sc-flash sc-fp-a"></div><div class="sc-flash sc-fp-b"></div>
<div class="sc-flash sc-fp-c"></div><div class="sc-flash sc-fp-d"></div>
<div class="sc-lamp sc-lp-b"></div>
<div class="sc-lamp sc-lp-e"></div>
</div>`
  },
  {
    id: 'empire',
    name: 'Media Empire',
    html: `<div class="sc-stage sc-t6">
<div class="sc-stars"></div>
<div class="sc-glow sc-g-max"></div>
<div class="sc-halo"></div>
<div class="sc-arc"></div>
<div class="sc-orbit"><div class="sc-sat">
<div class="sc-wing sc-wl"></div><div class="sc-satcore"></div><div class="sc-wing sc-wr"></div>
</div></div>
<div class="sc-waves sc-wv-a sc-wp-hi"><div class="sc-wave sc-wv-l"></div><div class="sc-wave sc-wv-xl sc-d2"></div></div>
<div class="sc-waves sc-wv-b sc-wp-hi"><div class="sc-wave sc-wv-xl sc-d1"></div><div class="sc-wave sc-wv-xl sc-wv-pink sc-d3"></div></div>
<div class="sc-waves sc-wv-c sc-wp-hi"><div class="sc-wave sc-wv-l sc-d3"></div><div class="sc-wave sc-wv-xl sc-wv-gold"></div></div>
<div class="sc-waves sc-wv-e sc-wp-hi"><div class="sc-wave sc-wv-xl sc-wv-pink sc-d2"></div></div>
<div class="sc-beam sc-bm-a"></div><div class="sc-beam sc-bm-b"></div><div class="sc-beam sc-bm-c"></div>
<div class="sc-skyline sc-sl-xl">
<div class="sc-bldg sc-b1 sc-lit"></div><div class="sc-bldg sc-b2 sc-lit sc-ant"></div>
<div class="sc-bldg sc-b3 sc-lit"></div><div class="sc-bldg sc-b4 sc-cyan sc-ant"></div>
<div class="sc-bldg sc-b5 sc-lit sc-ant"></div><div class="sc-bldg sc-b6 sc-lit"></div>
<div class="sc-bldg sc-b7 sc-lit"></div><div class="sc-bldg sc-b8 sc-lit sc-ant"></div>
<div class="sc-bldg sc-b9 sc-lit"></div><div class="sc-bldg sc-b10 sc-lit sc-ant"></div>
<div class="sc-bldg sc-b11 sc-cyan"></div><div class="sc-bldg sc-b12 sc-lit"></div>
<div class="sc-bldg sc-b13 sc-lit"></div><div class="sc-bldg sc-b14 sc-lit"></div>
</div>
<div class="sc-tower sc-tw-m sc-tp-a"><div class="sc-mast"></div><div class="sc-beacon sc-bc-top"></div><div class="sc-beacon sc-bc-mid"></div></div>
<div class="sc-tower sc-tw-l sc-tp-b"><div class="sc-mast"></div><div class="sc-beacon sc-bc-top"></div><div class="sc-beacon sc-bc-mid"></div><div class="sc-beacon sc-bc-low"></div></div>
<div class="sc-tower sc-tw-m sc-tp-e"><div class="sc-mast"></div><div class="sc-beacon sc-bc-top"></div><div class="sc-beacon sc-bc-mid"></div></div>
<div class="sc-billboard sc-bb-hi sc-bb-sm sc-bp-d">
<div class="sc-bb-panel"><div class="sc-bb-txt">CALLSIGNS</div></div>
</div>
<div class="sc-ground"></div>
<div class="sc-dish"></div>
<div class="sc-billboard sc-bp-c">
<div class="sc-bb-panel"><div class="sc-bb-txt">CALLSIGNS</div><div class="sc-bb-sub">WORLDWIDE</div></div>
</div>
<div class="sc-billboard sc-bb-sm sc-bp-b">
<div class="sc-bb-panel"><div class="sc-bb-txt">98.6 FM</div></div>
</div>
<div class="sc-veh sc-bus sc-vp-d">
<div class="sc-body"><div class="sc-cab"></div><div class="sc-wrap">CALLSIGNS 98.6</div></div>
</div>
<div class="sc-flash sc-fp-b"></div><div class="sc-flash sc-fp-c"></div>
<div class="sc-lamp sc-lp-b"></div>
<div class="sc-lamp sc-lp-e"></div>
</div>`
  }
];

/* ---------------- scene ---------------- */

/** `st` defaults to the running station; the main-menu backdrop passes a save
    it loaded without ever installing it as S. */
function sceneTier(st){
  const g = st || S;
  // Progression reads off the whole picture, not one stat.
  const invested = TX.slice(0, g.tx + 1).reduce((a,x)=>a+x.cost,0) + ANT.slice(0, g.ant + 1).reduce((a,x)=>a+x.cost,0);
  const score = (g.tx + g.ant) * 12 + g.rep * 0.9 + Math.log10(Math.max(10, g.listeners)) * 14 + Math.log10(Math.max(10, invested + 1)) * 5;
  // Unlocking expansion sets a floor, not the top tier — jumping straight to
  // the empire skyline the moment the gate opened left the $120k buildout with
  // no visual payoff, and pinned a collapsing station at tier 5 forever.
  const floor = g.unlockedExpansion ? 3 : 0;
  // Thresholds are calibrated against 600-day runs that drive the REAL tick(),
  // because the old 32/52/74/96/118 ladder predated the economy retune and
  // reached the final skyline around day 45-60 on one transmitter, one antenna
  // and 420 listeners — a third of the way in, with two thirds of the gear
  // ladder and the whole Empire pillar still ahead of it.
  // CALIBRATE ONLY AGAINST tick(). A sim that calls simulateDay() directly
  // never refreshes the candidate pool, so it plateaus at 2 staff / rep ~57 /
  // score ~200 and reports that expansion is unreachable. It isn't: measured
  // across four playstyles (all-music, talk-morning, news+talk mixed, ads-heavy)
  // the gate opens day 50-107 and the second station is founded day 65-125.
  // Every figure below is an ENVELOPE over 4 playstyles x 10 seeds (40 runs of
  // 600 days each), not one run — the spread is playstyle plus RNG, and the
  // slow edge of every band is the all-music style, which earns least early.
  //   day   2   ~35-42     nothing bought yet
  //   day  20   ~46-128    DJs on the slots, first antenna step
  //   day  40   ~77-182    transmitter + antenna underway, ~1-2k listeners
  //   day  60  ~142-235    mid gear ladder
  //   day 100  ~204-273    gear ladder finished, rep near 100
  //   day 140+ ~257-274    plateau — 8/8 gear, rep 100 and ~15k listeners is
  //                        the practical ceiling, so score cannot exceed ~275
  // These cuts put first arrivals at day 2 / 3-15 / 10-32 / 15-54 / 29-73 /
  // 51-102, so the top score tier lands with the endgame gear rather than the
  // tutorial, and founding the second station still forces it outright.
  const tier = (g.secondStation || score >= 215) ? 5
    : score >= 155 ? 4
    : score >= 100 ? 3
    : score >= 66 ? 2
    : score >= 44 ? 1 : 0;
  return Math.max(tier, floor);
}

function renderScene(){
  const tier = sceneTier();
  const have = typeof SCENE_TIERS !== 'undefined' && SCENE_TIERS && SCENE_TIERS[tier];
  if (!have) return '<div class="scene-wrap"><div class="scene-fallback">📡</div></div>';
  // The art ships with placeholder branding baked into the billboards and
  // vehicle wraps — swap in this station's identity so the city advertises YOU.
  const art = SCENE_TIERS[tier].html
    .replace(/CALLSIGNS/g, esc(S.call))
    .replace(/98\.6 FM/g, esc(S.freq + ' FM'))
    .replace(/98\.6/g, esc(S.freq));
  const name = t('scenes.' + SCENE_TIERS[tier].id);
  return '<div class="scene-wrap">' + art +
    '<div class="scene-caption">' + esc(name) + '</div></div>';
}

/* ---------------- audio ----------------
   Tiny Web Audio synth — no asset files, nothing to vendor. Muted entirely
   when S.opts.sound is off (default on) or before any game state exists. */

let actx = null;
function audioOn(){ return S ? S.opts.sound !== false : true; }
function ensureAudioCtx(){
  if (!actx) {
    try { actx = new (window.AudioContext || window.webkitAudioContext)(); }
    catch (e) { actx = null; }
  }
  if (actx && actx.state === 'suspended') actx.resume().catch(() => {});
  return actx;
}
function tone(freq, dur, type, vol, delay){
  if (!audioOn()) return;
  const ctx = ensureAudioCtx();
  if (!ctx) return;
  const t0 = ctx.currentTime + (delay || 0);
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type || 'sine';
  osc.frequency.setValueAtTime(freq, t0);
  gain.gain.setValueAtTime(0, t0);
  gain.gain.linearRampToValueAtTime(vol || 0.1, t0 + 0.008);
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(gain).connect(ctx.destination);
  osc.start(t0);
  osc.stop(t0 + dur + 0.03);
}
function sfxClick(){ tone(760, 0.045, 'square', 0.045); }
function sfxBuy(){ tone(520, 0.09, 'triangle', 0.08); tone(780, 0.12, 'triangle', 0.07, 0.06); }
/** On-air chime — ascending major triad, for good events / good news. */
function sfxOnAir(){
  tone(660, 0.14, 'sine', 0.09);
  tone(880, 0.18, 'sine', 0.09, 0.09);
  tone(1320, 0.22, 'sine', 0.08, 0.2);
}
/** Dead-air sting — a low, sour drop for equipment breakdowns. */
function sfxDeadAir(){
  tone(180, 0.3, 'sawtooth', 0.09);
  tone(120, 0.35, 'sawtooth', 0.08, 0.12);
}
function sfxTrouble(){
  tone(320, 0.12, 'square', 0.06);
  tone(230, 0.16, 'square', 0.055, 0.09);
}
function sfxBankrupt(){
  tone(220, 0.5, 'sawtooth', 0.1);
  tone(150, 0.6, 'sawtooth', 0.09, 0.16);
  tone(90, 0.9, 'sawtooth', 0.08, 0.34);
}
