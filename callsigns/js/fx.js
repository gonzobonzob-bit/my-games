// Callsigns — fx: the pure-CSS station scene system (SCENE_CSS + SCENE_TIERS),
// scene-tier scoring, screen punctuation, and the Web Audio synth. No game logic.
// Part of the modular layout (vault rule 3): index.html + js/{content,sim,fx,ui}.js
// Classic scripts sharing one top-level scope; load order: content, sim, fx, ui.
// Carved verbatim from the single-file v1 at the 50% checkpoint; reworked for
// the v3 empire at 75% against CONTRACT.md — the scene now reads S.stations
// generically and nothing in here branches on save version or station count.
//
// EVERY helper this file adds is prefixed `fx`. One top-level scope is shared
// with content/sim/ui, and a bare `function activeStation()` here would be
// silently shadowed by ui.js's own (it loads last) — or, if ui.js declared it
// with const, would throw a redeclaration SyntaxError that takes the whole UI
// module out. The prefix is the cheapest possible immunity.
'use strict';

/* Callsigns — pure-CSS station scene system.
   Two top-level consts: SCENE_CSS (all styles) and SCENE_TIERS (6 tiers).
   No canvas, no images, no external assets. All classes prefixed sc-
   (scene) or fx- (screen punctuation, which lives outside the stage). */

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
/* Two more mast positions, added at 75% purely so fxSiblingMasts() can always
   find a free one: the empire tier already occupies a, b and e, which left
   room for only two of a four-station empire's three siblings. */
.sc-tp-f{left:8%}.sc-tp-g{left:91%}
.sc-tw-r1{bottom:39%;z-index:6}.sc-tw-r2{bottom:44%;z-index:6}
/* A third rooftop line, added at 75%. The r2 mast (44%-62% of the stage) runs
   straight through the .sc-bb-hi billboard band (34%-52%) — on the empire tier
   a sibling mast was drawn across the callsign painted on the high billboard,
   which reads as a rendering fault rather than as two stations. The tall
   skylines are 54%-70% high, so 56% is still a rooftop up there. */
.sc-tw-r3{bottom:56%;z-index:6}
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

/* --- sibling stations -----------------------------------------------------
   One mast per callsign you own beyond the one the Studio tab is showing.
   Founding a station is the largest purchase in the game and until 75% it
   changed nothing you could see — the old sceneTier() jumped the whole skyline
   to the top tier instead, which is both too much and too late. A cyan mast
   next to your own pink-red one is the empire, at a glance, in every tier. */
.sc-sib{opacity:.74}
.sc-sib .sc-whip,.sc-sib .sc-mast{filter:saturate(.5)}
.sc-sib .sc-beacon{background:#22d3ee;box-shadow:0 0 .7cqw .12cqw rgba(34,211,238,.8)}
/* A station with nobody on any daypart is running on automation. Grey beacon
   AND a struck bar across the mast: CLAUDE.md's accessibility rule is that
   state never rides on colour alone, and "dim cyan vs grey" is exactly the
   distinction a colour-blind player would lose. */
.sc-dark{opacity:.5}
.sc-dark .sc-beacon{background:#7c8699;box-shadow:none}
.sc-dark::after{content:"";position:absolute;left:-60%;right:-60%;top:40%;
height:max(1px,.2cqw);background:#aab4c8;opacity:.9;z-index:2;
transform:rotate(-24deg)}

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
/* Studio level meter. The first two tiers are the ones a new player stares at
   longest and they had the least motion in them — one blinking beacon and a
   flickering lamp. Three bars on the desk is the cheapest idle life in the
   file: transform-only, so it never touches layout, and it sits to the right
   of .sc-mic (44-50%) with the desk top (26%) as its floor. */
.sc-vu{position:absolute;right:5%;bottom:27%;width:34%;height:19%;z-index:1;
display:flex;align-items:flex-end;gap:9%}
.sc-vu i{flex:1;height:100%;border-radius:.08cqw;transform-origin:50% 100%;
transform:scaleY(.3);background:linear-gradient(180deg,#22d3ee,#0e7490)}
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
@keyframes sc-vu1{0%,100%{transform:scaleY(.28)}20%{transform:scaleY(.86)}42%{transform:scaleY(.42)}62%{transform:scaleY(1)}81%{transform:scaleY(.55)}}
@keyframes sc-vu2{0%,100%{transform:scaleY(.5)}18%{transform:scaleY(1)}44%{transform:scaleY(.34)}71%{transform:scaleY(.78)}}
@keyframes sc-vu3{0%,100%{transform:scaleY(.64)}30%{transform:scaleY(.3)}55%{transform:scaleY(.92)}78%{transform:scaleY(.4)}}
.sc-beacon{animation:sc-blink 2.2s ease-in-out infinite}
.sc-bc-mid{animation-delay:.5s}.sc-bc-low{animation-delay:1s}
.sc-tp-a .sc-beacon{animation-duration:2.6s}.sc-tp-c .sc-beacon{animation-duration:1.9s}
/* Sibling masts blink out of step with the flagship and with each other, or a
   four-station empire reads as one mast reflected three times. */
.sc-tp-e .sc-beacon{animation-duration:3.1s;animation-delay:.4s}
.sc-tp-f .sc-beacon{animation-duration:2.4s;animation-delay:1.3s}
.sc-tp-g .sc-beacon{animation-duration:2.9s;animation-delay:.8s}
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
.sc-vu i:nth-child(1){animation:sc-vu1 1.6s ease-in-out infinite}
.sc-vu i:nth-child(2){animation:sc-vu2 1.35s ease-in-out infinite}
.sc-vu i:nth-child(3){animation:sc-vu3 1.85s ease-in-out infinite}
}

/* ================= screen punctuation =====================================
   These live OUTSIDE .sc-stage: they are full-viewport overlays, created and
   destroyed by JS, stacked above the toast layer (z 60) and the modal scrim
   (z 50) so a fault still lands while a modal is up. pointer-events:none on
   every one of them — an overlay that eats one click is worse than no overlay.

   The reduced-motion gate for these is in JS (fxReducedMotion), NOT in a
   media query, and that is deliberate: index.html's body.no-motion rule sets
   animation:none !important on everything, which would strip the animation and
   leave the element sitting on screen at its start state forever. (No back-
   ticks in this comment — it is inside the SCENE_CSS template literal, and one
   stray backtick here ends the string and takes the file's syntax with it.)
   The check has to
   happen before the node exists. Both fxFlash and fxFly also carry a timeout
   backstop, because an animationend that never fires (tab hidden the instant
   the flash starts) is exactly how you accumulate one dead overlay per event
   for the life of the session. */
.fx-flash{position:fixed;inset:0;z-index:70;pointer-events:none;opacity:0}
@keyframes fx-fault{0%{opacity:0}6%{opacity:1}34%{opacity:.5}100%{opacity:0}}
.fx-fl-fault{animation:fx-fault .52s ease-out forwards;
box-shadow:inset 0 0 14vmin 2vmin rgba(239,68,68,.55);
background:repeating-linear-gradient(0deg,rgba(255,255,255,.055) 0 2px,transparent 2px 5px)}
@keyframes fx-signon{0%{opacity:0;transform:scale(.94)}18%{opacity:1}100%{opacity:0;transform:scale(1.05)}}
.fx-fl-signon{animation:fx-signon .95s cubic-bezier(.2,.85,.3,1) forwards;
background:radial-gradient(72% 62% at 50% 100%,rgba(251,191,36,.4),rgba(236,72,153,.17) 46%,transparent 74%)}
@keyframes fx-lease{0%{opacity:0;transform:translateY(16%)}24%{opacity:1;transform:translateY(0)}100%{opacity:0;transform:translateY(0)}}
.fx-fl-lease{animation:fx-lease .8s ease-out forwards;
background:linear-gradient(0deg,rgba(245,158,11,.32),transparent 26%)}
@keyframes fx-bust{0%{opacity:0}8%{opacity:1}100%{opacity:0}}
.fx-fl-bust{animation:fx-bust 1.15s ease-out forwards;
box-shadow:inset 0 0 22vmin 4vmin rgba(127,29,29,.78)}

/* The SCENE takes the shake, not the screen. Animating a transform on <body>
   or on .screen makes it a containing block for every fixed-position child,
   so the modal and the toasts would ride along and re-anchor mid-animation.
   The station picture is the thing that just went off the air anyway. */
@keyframes fx-shake{0%,100%{transform:translate3d(0,0,0)}
15%{transform:translate3d(-.8%,0,0)}31%{transform:translate3d(.7%,0,0)}
48%{transform:translate3d(-.45%,0,0)}68%{transform:translate3d(.3%,0,0)}
85%{transform:translate3d(-.15%,0,0)}}
.fx-shaking{animation:fx-shake .42s ease-out}

/* Earned-here, lands-there. Positioned from two live getBoundingClientRects
   and animated with the Web Animations API, because the path is only known at
   call time and a CSS keyframe cannot be parameterised. */
.fx-fly{position:fixed;z-index:71;pointer-events:none;white-space:nowrap;
font:800 13px/1 ui-sans-serif,system-ui,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;
letter-spacing:.02em;padding:3px 8px;border-radius:8px;
background:rgba(10,14,39,.92);border:1px solid rgba(148,163,255,.35);color:#e6e9ff}
.fx-fly-good{color:#34d399;border-color:rgba(52,211,153,.5)}
.fx-fly-bad{color:#f87171;border-color:rgba(248,113,113,.5)}
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
<div class="sc-bay"><div class="sc-desk"></div><div class="sc-mic"></div><div class="sc-vu"><i></i><i></i><i></i></div></div>
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
<div class="sc-bay"><div class="sc-desk"></div><div class="sc-mic"></div><div class="sc-vu"><i></i><i></i><i></i></div></div>
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

/* ---------------- reading the empire ----------------
   Everything below reads state through these four helpers and never touches
   S.call / S.tx / S.stations directly. That is not tidiness: fx.js and sim.js
   land on separate branches of the 75% build, so this file has to render a v2
   save (scalar call/freq/tx/ant plus a decorative `secondStation`) and a v3
   save (S.stations[]) with the same code, and be wrong about neither while the
   other branch is still in flight. Every read is typeof-guarded for the same
   reason — a field that does not exist yet must degrade, never throw, because
   a throw in renderScene() takes the whole Studio tab down. */

/** The empire as an array of { call, freq, tx, ant, schedule }, whatever shape
    the save is in. */
function fxStations(g){
  if (!g || typeof g !== 'object') return [];
  if (Array.isArray(g.stations) && g.stations.length) return g.stations;
  const one = { call: g.call, freq: g.freq, tx: g.tx, ant: g.ant, schedule: g.schedule };
  // A v2 save that founded the second station comes back as TWO stations here,
  // on Part 15 gear, matching CONTRACT.md's migration policy — rather than
  // being shoved to the top skyline outright, which is what the old
  // `g.secondStation ? 5` did. That check pinned a collapsing network at the
  // Media Empire tier forever and is collision #6 on the contract's list.
  if (g.secondStation) {
    return [one, { call: g.secondStation.call, freq: g.freq, tx: 0, ant: 0, schedule: null }];
  }
  return [one];
}

/** Which station the Studio tab is looking at. ui.js owns the switcher; this
    reads whatever it parked on the state and never trusts the value. */
function fxActiveStation(g, idx){
  const list = fxStations(g);
  if (!list.length) return 0;
  let i = idx;
  if (!Number.isFinite(+i)) i = (g && Number.isFinite(+g.activeStation)) ? +g.activeStation : 0;
  i = Math.floor(+i);
  return (i < 0 || i >= list.length) ? 0 : i;
}

/** Gear indices, clamped to the ladders that actually exist. A save carrying
    tx:7 (hand-edited, or written by a build with a longer ladder) used to walk
    straight off the end of TX[] inside the invested-capital reduce. */
function fxGear(st){
  const txMax = (typeof TX  !== 'undefined' && TX)  ? TX.length  - 1 : 0;
  const anMax = (typeof ANT !== 'undefined' && ANT) ? ANT.length - 1 : 0;
  const tx  = (st && Number.isFinite(+st.tx))  ? Math.max(0, Math.floor(+st.tx))  : 0;
  const ant = (st && Number.isFinite(+st.ant)) ? Math.max(0, Math.floor(+st.ant)) : 0;
  return { tx: Math.min(tx, txMax), ant: Math.min(ant, anMax) };
}
function fxGearSteps(st){ const g = fxGear(st); return g.tx + g.ant; }

/** Capital sunk into one station's gear ladder, cumulative. */
function fxInvested(st){
  if (typeof TX === 'undefined' || typeof ANT === 'undefined' || !TX || !ANT) return 0;
  const g = fxGear(st);
  return TX.slice(0, g.tx + 1).reduce((a, x) => a + (+x.cost || 0), 0) +
         ANT.slice(0, g.ant + 1).reduce((a, x) => a + (+x.cost || 0), 0);
}

/** A station with nobody on any daypart: it is on the air, but it is running
    on automation. Reads v3's `slot.djs` array and v2's `slot.dj` string, and
    treats an unreadable schedule as staffed — a field that has not shipped yet
    must never invent bad news about the player's empire. */
function fxStationDark(st){
  const sch = st && st.schedule;
  if (!sch || typeof sch !== 'object') return false;
  if (typeof DAYPARTS === 'undefined' || !Array.isArray(DAYPARTS)) return false;
  let seen = 0, staffed = false;
  for (const p of DAYPARTS) {
    const slot = sch[p.id];
    if (!slot || typeof slot !== 'object') continue;
    seen++;
    if (Array.isArray(slot.djs) ? slot.djs.length > 0 : !!slot.dj) staffed = true;
  }
  return seen > 0 && !staffed;
}

/* ---------------- scene ---------------- */

// Score cuts for the six scene tiers, index-aligned with SCENE_TIERS. Cut 0 is
// a placeholder so the index and the tier number are the same number — an
// off-by-one here is an art bug nobody would file.
const FX_TIER_CUTS = [0, 52, 84, 124, 176, 262];
// Last tier actually shown, per station, for the hysteresis in sceneTier().
const fxTierMemo = new Map();

/** `st` defaults to the running station; the main-menu backdrop passes a save
    it loaded without ever installing it as S. `idx` selects which station of
    the empire is on screen and defaults to the active one. */
function sceneTier(st, idx){
  const g = st || (typeof S !== 'undefined' ? S : null);
  if (!g) return 0;
  const list = fxStations(g);
  const n = Math.max(1, list.length);
  const own = list[fxActiveStation(g, idx)] || list[0] || {};

  const ownGear  = fxGearSteps(own);
  const meanGear = list.reduce((a, s) => a + fxGearSteps(s), 0) / n;
  const ownInv   = fxInvested(own);
  const empInv   = list.reduce((a, s) => a + fxInvested(s), 0);
  const rep       = Number.isFinite(+g.rep)       ? clamp(+g.rep, 0, 100) : 0;
  const listeners = Number.isFinite(+g.listeners) ? Math.max(0, +g.listeners) : 0;

  // Progression reads off the whole picture, not one stat — and at v3 "the
  // whole picture" is an empire of 1-4 stations, so every term below is either
  // per-station or explicitly empire-wide, and NONE of them is a station count
  // compared against a literal (collision #6).
  //
  //   ownGear   0..8   this station's own transmitter+antenna steps
  //   meanGear  0..8   the empire's average — a network of Part 15 shacks
  //                    should not wear the flagship's skyline
  //   n-1       0..3   breadth. Founding has to move the picture the day it
  //                    happens; without this term a new station DILUTES
  //                    meanGear by exactly as much as it adds and the scene
  //                    does not change at all, which is worse than the old
  //                    hardcoded jump it replaces.
  //   rep       0..100 empire-wide (CONTRACT.md: rep is the shared brand)
  //   listeners        empire-wide, log-scaled
  //   capital          own ladder at full weight, the empire's at a third
  const score = ownGear * 7 + meanGear * 2.5
    + (n - 1) * 17
    + rep * 0.55
    + Math.log10(Math.max(10, listeners)) * 13
    + Math.log10(Math.max(10, ownInv + 1)) * 7
    + Math.log10(Math.max(10, empInv + 1)) * 4;

  // THE CALIBRATION ENVELOPE THAT USED TO LIVE HERE IS GONE, AND ON PURPOSE.
  // It was measured against 600-day runs of the pre-lease economy; DESIGN.md
  // declares it invalid the moment per-station leases land, and quoting dead
  // measurements as if they were live ones is how the old 32/52/74/96/118
  // ladder survived an economy retune and reached the final skyline on day 45
  // with one transmitter and 420 listeners.
  //
  // What follows is DERIVED, not measured, and the 75% balance harness owns
  // re-measuring it (producer condition #4). The derivation, so the next
  // person can check it rather than re-guess it:
  //   floor  day 1, 1 station, no gear, rep 5, 40 listeners ...... ~34
  //   ceiling 4 stations all maxed, rep 100, ~15k listeners ...... ~298
  //   1 station maxed (tx4/ant4, rep 100, 15k, $261k sunk) ....... ~245
  //   2 stations, flagship maxed, second on Part 15 .............. ~255
  //   3 stations, flagship maxed .................................~270
  // The cuts below therefore put Media Empire out of reach of a single maxed
  // flagship — that station tops out at Regional Network — and inside reach of
  // a real 3-station network. That is the one place the ladder is allowed to
  // encode the design: the top skyline is called Media Empire and should mean
  // it. CALIBRATE ONLY AGAINST tick(). A harness that calls simulateDay()
  // directly never refreshes the candidate pool, so it plateaus at 2 staff and
  // reports that expansion is unreachable; it isn't.
  let tier = 0;
  for (let c = FX_TIER_CUTS.length - 1; c > 0; c--) {
    if (score >= FX_TIER_CUTS[c]) { tier = c; break; }
  }

  // Hysteresis, and it is not a nicety. `listeners` is recomputed from scratch
  // every simulateDay() and swings with buzz, weather events and breakdowns, so
  // a station parked near a cut crosses it back and forth day after day. Every
  // crossing is a scene REBUILD in ui.js — a full innerHTML swap that restarts
  // every animation in the picture — and the measured cost of the first cut of
  // this ladder was 7 rebuilds in 40 broadcast days where the old one had 1.
  // Visually it reads as the skyline flickering between two cities.
  //
  // So a tier is easy to enter and slightly sticky to leave: once shown, it
  // holds until the score drops a clear 6% below the cut that earned it. Only
  // the LIVE state gets this — the main-menu backdrop hands us a save it loaded
  // separately and must stay a pure function of it. Keyed by callsign as well
  // as index so a new station (new random call) never inherits the last run's
  // memory, with a hard size cap because nothing here can hook quitToMenu().
  if (!st || (typeof S !== 'undefined' && st === S)) {
    const key = String(own.call || '?') + '|' + fxActiveStation(g, idx);
    const prev = fxTierMemo.get(key);
    if (prev !== undefined && tier < prev && score >= FX_TIER_CUTS[prev] * 0.94) tier = prev;
    if (fxTierMemo.size > 24) fxTierMemo.clear();
    fxTierMemo.set(key, tier);
  }

  // Unlocking expansion sets a floor, not the top tier — jumping straight to
  // the empire skyline the moment the gate opened left the $120k buildout with
  // no visual payoff, and pinned a collapsing station at tier 5 forever. Owning
  // more than one signal sets a much softer one: a network is never a garage,
  // and that is the whole of the claim.
  const floor = Math.max(g.unlockedExpansion ? 3 : 0, n > 1 ? 2 : 0);

  // ...and a station's OWN gear caps how far above its weight its art can
  // climb. Without this, selecting the Part 15 shack you signed on yesterday
  // inside a mature empire renders it as a Regional Network, because five of
  // the six score terms are empire-wide. The cap is what keeps the Studio tab
  // a picture of the station you are looking at rather than of your balance
  // sheet. It deliberately out-ranks the floor: 0 steps of gear is a garage no
  // matter what the rest of the network is doing.
  const cap = clamp(1 + Math.round(ownGear * 0.62), 1, SCENE_TIERS.length - 1);
  return clamp(Math.max(tier, floor), 0, cap);
}

// Mast positions offered to sibling stations, in the order they get handed
// out. fxSiblingMasts() skips any the tier's own art already occupies, which
// is why there are seven of them for at most three siblings.
const FX_SIB_POSITIONS = ['a', 'c', 'e', 'f', 'g', 'd', 'b'];

/** Swap the placeholder branding baked into the tier art for real callsigns.
    ONE shared cursor across the callsign and frequency tokens, advanced by each
    callsign, so the two halves of one billboard always name the same station —
    and so a three-station empire has three different callsigns painted on the
    city instead of the same one three times. That round-robin is half of "the
    empire is visible growth"; the sibling masts are the other half.

    Token order in the alternation matters and is not alphabetical: `98.6 FM`
    has to match before the bare `98.6` nested inside it, and `CALLSIGNS 98.6`
    (the empire tier's bus wrap) before either half of itself. */
function fxBrandArt(html, g, idx){
  const list = fxStations(g);
  if (!list.length) return html;
  const start = fxActiveStation(g, idx);
  const at = k => list[(start + Math.max(0, k)) % list.length] || list[0] || {};
  const callOf = s => String((s && s.call) || 'CALLSIGNS');
  const freqOf = s => String((s && s.freq) || '98.6');
  let k = -1;
  return String(html).replace(/CALLSIGNS 98\.6|CALLSIGNS|98\.6 FM|98\.6/g, m => {
    if (m.charCodeAt(0) === 67) k++;   // 'C' — a new sign names the next station
    const s = at(k < 0 ? 0 : k);
    if (m === 'CALLSIGNS 98.6') return esc(callOf(s) + ' ' + freqOf(s));
    if (m === 'CALLSIGNS')      return esc(callOf(s));
    if (m === '98.6 FM')        return esc(freqOf(s) + ' FM');
    return esc(freqOf(s));
  });
}

/** One extra mast per station you own beyond the one on screen, dropped into
    whichever .sc-tp-* positions the tier's own art did not already use. The
    free positions are found by SCANNING the markup rather than from a per-tier
    table, so a tier edited later can never silently stack two towers on one
    spot — which is the failure that made the old scene look like a rendering
    bug rather than a network. */
function fxSiblingMasts(g, idx, tier){
  if (typeof SCENE_TIERS === 'undefined' || !SCENE_TIERS[tier]) return '';
  const list = fxStations(g);
  if (list.length < 2) return '';
  const active = fxActiveStation(g, idx);
  const html = SCENE_TIERS[tier].html || '';
  const free = FX_SIB_POSITIONS.filter(p => html.indexOf('sc-tp-' + p) < 0);
  // Rooftop line by tier, and all three are load-bearing. The two low tiers
  // have a 22%-tall skyline, where an r2 mast floats clear of every building
  // and reads as unattached. The top two tiers carry a .sc-bb-hi billboard, and
  // an r2 mast is drawn straight through the callsign painted on it.
  const roof = tier <= 1 ? 'sc-tw-r1' : tier <= 3 ? 'sc-tw-r2' : 'sc-tw-r3';
  let out = '';
  for (let j = 1; j < list.length && j - 1 < free.length; j++) {
    const s = list[(active + j) % list.length];
    const dark = fxStationDark(s) ? ' sc-dark' : '';
    out += '<div class="sc-tower sc-tw-s sc-sib ' + roof + ' sc-tp-' + free[j - 1] + dark +
      '" title="' + esc(String((s && s.call) || '')) + '"><div class="sc-whip"></div>' +
      '<div class="sc-beacon sc-bc-top"></div></div>';
  }
  return out;
}

function renderScene(idx){
  const g = (typeof S !== 'undefined') ? S : null;
  const tier = sceneTier(g, idx);
  const have = typeof SCENE_TIERS !== 'undefined' && SCENE_TIERS && SCENE_TIERS[tier];
  if (!have) return '<div class="scene-wrap"><div class="scene-fallback">📡</div></div>';
  // The art ships with placeholder branding baked into the billboards and
  // vehicle wraps — swap in this station's identity so the city advertises YOU.
  let art = fxBrandArt(SCENE_TIERS[tier].html, g, idx);
  const masts = fxSiblingMasts(g, idx, tier);
  // Appended just inside the stage's closing tag. Everything in the scene is
  // absolutely positioned with an explicit z-index, so document order carries
  // no meaning and this cannot disturb the existing stack.
  if (masts) art = art.replace(/<\/div>\s*$/, masts + '</div>');
  const list = fxStations(g);
  const active = list[fxActiveStation(g, idx)];
  const name = t('scenes.' + SCENE_TIERS[tier].id);
  // Which station's studio this is stops being obvious the moment there is
  // more than one of them, and the caption is the only label attached to the
  // picture. One station: unchanged, just the tier name.
  const label = (list.length > 1 && active && active.call)
    ? esc(String(active.call)) + ' · ' + esc(name)
    : esc(name);
  return '<div class="scene-wrap">' + art +
    '<div class="scene-caption">' + label + '</div></div>';
}

/** The cache key ui.js keys its scene rebuild on. The scene is ~40 nodes
    running a dozen infinite CSS animations and rebuilding it every tick meant
    the 26s satellite never got past 19% of its orbit and the 4.2s wave rings
    never emitted a complete ring — so it may only be rebuilt when the picture
    genuinely changes. At v3 that is no longer "tier|call|freq": it is the tier,
    which station is selected, how many there are, and every callsign,
    frequency and automation state painted onto the city. ui.js should call
    this instead of assembling its own key, or a founded station will not
    appear until something else happens to move the tier. */
function fxSceneKey(idx){
  const g = (typeof S !== 'undefined') ? S : null;
  if (!g) return 'none';
  const list = fxStations(g);
  let k = sceneTier(g, idx) + '|' + fxActiveStation(g, idx) + '|' + list.length;
  for (const s of list) {
    k += '|' + ((s && s.call) || '?') + '@' + ((s && s.freq) || '?') + (fxStationDark(s) ? '#' : '');
  }
  return k;
}

/* ---------------- screen punctuation ----------------
   Reserved for the four moments that deserve it: a station signing on, an
   engineer fault, the leases outrunning the signal, and the run ending. If
   everything is punctuated then nothing is, so nothing else in the game gets
   to call fxFlash(). */

/** Three ways a player can ask for less motion and all three count: the
    in-game Settings switch, the class it drives on <body>, and the OS
    preference. Checked in JS rather than CSS because index.html's
    `body.no-motion *{animation:none!important}` would strip a flash's
    animation and leave the overlay parked on screen with nothing to remove it.
    matchMedia is in a try/catch for the same reason everything else here is —
    this file must degrade, never throw. */
function fxReducedMotion(){
  const o = fxOpts();
  if (o && o.reducedMotion) return true;
  if (typeof document !== 'undefined' && document.body &&
      document.body.classList.contains('no-motion')) return true;
  try { return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches); }
  catch (e) { return false; }
}

const FX_FLASH_CLASS = {
  fault:  'fx-fl-fault',
  signon: 'fx-fl-signon',
  lease:  'fx-fl-lease',
  bust:   'fx-fl-bust'
};

/** A brief full-screen edge flash. `shake` additionally jolts the station
    scene — never the screen, see the fx-shake comment in SCENE_CSS. */
function fxFlash(kind, shake){
  if (fxReducedMotion()) return;
  const cls = FX_FLASH_CLASS[kind];
  if (!cls || typeof document === 'undefined' || !document.body) return;
  const el = document.createElement('div');
  el.className = 'fx-flash ' + cls;
  el.setAttribute('aria-hidden', 'true');
  document.body.appendChild(el);
  let gone = false;
  const kill = () => { if (gone) return; gone = true; if (el.parentNode) el.parentNode.removeChild(el); };
  el.addEventListener('animationend', kill);
  // Backstop: an animationend that never fires (the tab went hidden the instant
  // the flash started) is exactly how you end up with one dead fixed-position
  // overlay per event for the rest of the session.
  setTimeout(kill, 1600);

  if (shake) {
    const host = document.getElementById('scene-host');
    if (host) {
      host.classList.remove('fx-shaking');
      // Reading offsetWidth is the only reliable way to restart a CSS animation
      // on an element that is already running one — two faults inside half a
      // second otherwise produced one shake and then stillness.
      void host.offsetWidth;
      host.classList.add('fx-shaking');
      setTimeout(() => host.classList.remove('fx-shaking'), 520);
    }
  }
}

/** A number that flies from where it was earned to where it accumulates. This
    is the cheapest causal link in the toolkit: nobody has to be told that the
    morning slot is what moved the cash counter if they watched it go there.
    Both arguments are live elements — ui.js owns them, so ui.js calls this.
    Two getBoundingClientRect reads per call, on discrete events only; do not
    put this on a per-tick path. */
function fxFly(fromEl, toEl, text, kind){
  if (fxReducedMotion()) return;
  if (!fromEl || !toEl || typeof document === 'undefined' || !document.body) return;
  let a, b;
  try { a = fromEl.getBoundingClientRect(); b = toEl.getBoundingClientRect(); }
  catch (e) { return; }
  if (!a.width && !a.height) return;   // the source is display:none — nothing to fly from

  const el = document.createElement('div');
  el.className = 'fx-fly' + (kind ? ' fx-fly-' + kind : '');
  el.setAttribute('aria-hidden', 'true');
  el.textContent = String(text);
  el.style.left = (a.left + a.width / 2) + 'px';
  el.style.top  = (a.top + a.height / 2) + 'px';
  document.body.appendChild(el);

  let gone = false;
  const kill = () => { if (gone) return; gone = true; if (el.parentNode) el.parentNode.removeChild(el); };
  if (typeof el.animate !== 'function') { kill(); return; }

  const dx = (b.left + b.width / 2) - (a.left + a.width / 2);
  const dy = (b.top + b.height / 2) - (a.top + a.height / 2);
  // Anticipation, arc, settle. The 12% pop before the throw and the 26px lift
  // at the midpoint are the whole difference between "a number moved" and
  // "that number came from THERE" — an instant translate reads as a glitch.
  el.animate([
    { transform: 'translate(-50%,-50%) scale(.7)',   opacity: 0 },
    { transform: 'translate(-50%,-50%) scale(1.12)', opacity: 1, offset: 0.14 },
    { transform: 'translate(calc(-50% + ' + (dx * 0.52) + 'px),calc(-50% + ' + (dy * 0.52 - 26) + 'px)) scale(1)',
      opacity: 1, offset: 0.6 },
    { transform: 'translate(calc(-50% + ' + dx + 'px),calc(-50% + ' + dy + 'px)) scale(.82)', opacity: 0 }
  ], { duration: 780, easing: 'cubic-bezier(.32,.72,.24,1)', fill: 'forwards' }).onfinish = kill;
  setTimeout(kill, 1600);
}

/* Haptics need a user gesture for exactly the same reason the AudioContext
   does, but they fail differently and worse: an AudioContext built too early is
   merely silent, while navigator.vibrate() called before the frame has ever
   been tapped is BLOCKED AND LOGGED — Chromium writes an error-level
   "intervention" entry to the console every single time. The sim calls these
   from tick(), which is not a gesture, so a bankrupt run was printing one
   console error per vibration pattern and any "zero console errors" check
   downstream of this file would have been failing on fx.js's behalf.

   So: latch the first real gesture and stay quiet until then. {once:true}, so
   there is nothing here for stopAllTimers() to have to clean up. */
let fxGestured = false;
if (typeof document !== 'undefined' && document.addEventListener) {
  const mark = () => { fxGestured = true; };
  document.addEventListener('pointerdown', mark, { once: true, capture: true });
  document.addEventListener('keydown', mark, { once: true, capture: true });
  document.addEventListener('touchstart', mark, { once: true, capture: true });
}

/** Confirmations and failures only. Anything more and a phone buzzes through
    a whole broadcast day. Ridden on the Sound setting because that is the only
    switch a player can currently reach and it lives in a file fx.js does not
    own — if a haptics toggle ever lands in Settings, read that instead. */
function fxHaptic(pattern){
  if (!audioOn() || !fxGestured) return;
  try {
    if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
      navigator.vibrate(pattern);
    }
  } catch (e) {}
}

/* ---------------- audio ----------------
   Tiny Web Audio synth — no asset files, nothing to vendor. Everything routes
   through one master gain so a volume change is a single write instead of a
   rescale threaded through thirty call sites, and everything is muted when the
   Sound setting is off.

   The context is created lazily inside a sound call, which means the first one
   always happens inside a click handler — an AudioContext constructed outside a
   user gesture is born suspended and stays that way, and you ship silence you
   cannot hear in testing. */

let actx = null;
let masterGain = null;

/** The live settings object: the running station's copy while a game is up,
    the menu-side mirror otherwise. This used to fall back to `true` whenever S
    was null, which meant every click on the main menu of a MUTED save played
    anyway — the one screen where a player who just turned sound off is most
    likely to be clicking. */
function fxOpts(){
  if (typeof S !== 'undefined' && S && S.opts && typeof S.opts === 'object') return S.opts;
  if (typeof gOpts !== 'undefined' && gOpts && typeof gOpts === 'object') return gOpts;
  return null;
}
function audioOn(){ const o = fxOpts(); return o ? o.sound !== false : true; }

/** Master volume, 0..1. Settings has a boolean Sound switch today and
    CONTRACT.md is silent on a slider; read one if it ever appears under
    `opts.volume` and treat its absence as full, because every per-sound gain
    below is already deliberately low — nothing in this file exceeds 0.10. */
function audioVolume(){
  const o = fxOpts();
  const v = (o && Number.isFinite(+o.volume)) ? +o.volume : 1;
  return Math.max(0, Math.min(1, v));
}

function ensureAudioCtx(){
  if (!actx) {
    try { actx = new (window.AudioContext || window.webkitAudioContext)(); }
    catch (e) { actx = null; }
    masterGain = null;
  }
  if (!actx) return null;
  if (!masterGain) {
    try { masterGain = actx.createGain(); masterGain.connect(actx.destination); }
    catch (e) { masterGain = null; }
  }
  // Re-read every time rather than on a settings event: fx.js does not own the
  // Settings screen and cannot be told when the slider moves.
  if (masterGain) masterGain.gain.value = audioVolume();
  if (actx.state === 'suspended') actx.resume().catch(() => {});
  return actx;
}
function audioOut(ctx){ return masterGain || ctx.destination; }

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
  osc.connect(gain).connect(audioOut(ctx));
  osc.start(t0);
  osc.stop(t0 + dur + 0.03);
}

/** A pitch glide. Radio has exactly two sounds that are not notes — a carrier
    coming up and a carrier falling over — and both of them are glides. An
    exponential ramp needs a non-zero target, hence the max(1). */
function sweep(f0, f1, dur, type, vol, delay){
  if (!audioOn()) return;
  const ctx = ensureAudioCtx();
  if (!ctx) return;
  const t0 = ctx.currentTime + (delay || 0);
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type || 'sine';
  osc.frequency.setValueAtTime(Math.max(1, f0), t0);
  osc.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t0 + dur);
  gain.gain.setValueAtTime(0, t0);
  gain.gain.linearRampToValueAtTime(vol || 0.08, t0 + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(gain).connect(audioOut(ctx));
  osc.start(t0);
  osc.stop(t0 + dur + 0.03);
}

/** Filtered white noise, generated into a buffer at call time. The fault sting
    needs a real NOISE source, not an oscillator: dead air on a transmitter is
    carrier drop plus hiss, and every attempt to fake hiss with a detuned saw
    comes out as a musical note — which reads as "a chord played wrong" rather
    than "the signal died". A quarter-second buffer at 48 kHz is ~12k floats,
    built and discarded per call; that is cheaper than shipping a sample and
    these fire a handful of times a minute at most. */
function noiseBurst(dur, vol, filterType, freq, delay){
  if (!audioOn()) return;
  const ctx = ensureAudioCtx();
  if (!ctx) return;
  const t0 = ctx.currentTime + (delay || 0);
  const len = Math.max(1, Math.ceil(ctx.sampleRate * dur));
  let src, buf;
  try {
    buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    src = ctx.createBufferSource();
    src.buffer = buf;
  } catch (e) { return; }
  const filt = ctx.createBiquadFilter();
  filt.type = filterType || 'bandpass';
  filt.frequency.setValueAtTime(freq || 1400, t0);
  filt.Q.setValueAtTime(1.1, t0);
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0, t0);
  gain.gain.linearRampToValueAtTime(vol || 0.06, t0 + 0.006);
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  src.connect(filt).connect(gain).connect(audioOut(ctx));
  src.start(t0);
  src.stop(t0 + dur + 0.02);
}

function sfxClick(){ tone(760, 0.045, 'square', 0.045); }
function sfxBuy(){ tone(520, 0.09, 'triangle', 0.08); tone(780, 0.12, 'triangle', 0.07, 0.06); }
/** On-air chime — ascending major triad, for good events / good news. */
function sfxOnAir(){
  tone(660, 0.14, 'sine', 0.09);
  tone(880, 0.18, 'sine', 0.09, 0.09);
  tone(1320, 0.22, 'sine', 0.08, 0.2);
}

/** Engineer fault — the carrier drops. Pitch collapses out of the bottom of
    the band, hiss takes its place, then a low thud lands under it. This is the
    one sting in the game that has to be unpleasant: DESIGN.md mechanic #3
    prices a fault in reputation proportional to LOAD, which is a cost the
    player set themselves one turn earlier, so the sound is the receipt.

    Paired with a red edge flash and a jolt of the station scene, because the
    fault otherwise arrives as a toast among toasts. Haptics on failure is one
    of the two cases navigator.vibrate is for. */
function sfxFault(){
  sweep(520, 70, 0.26, 'sawtooth', 0.085);
  noiseBurst(0.34, 0.075, 'bandpass', 1900, 0.05);
  tone(88, 0.42, 'sine', 0.10, 0.20);
  fxFlash('fault', true);
  fxHaptic([26, 40, 26]);
}
/** Dead-air sting — kept as the name sim.js already calls on a v2 breakdown,
    now routed at the v3 fault. One sound, two call sites, no drift between the
    branch that lands first and the branch that lands second. */
function sfxDeadAir(){ sfxFault(); }

/** Station sign-on: carrier catch, carrier up, then the three-note station ID
    with an octave laid over the top. This is the largest good moment in the
    game — CONTRACT.md's founding flow, DESIGN.md's whole second mechanic — and
    it has to clearly out-rank sfxOnAir(), which fires for every ratings book.
    Haptics on confirmation is the other case vibrate is for. */
function sfxSignOn(){
  noiseBurst(0.16, 0.05, 'highpass', 2400);
  sweep(160, 640, 0.30, 'sine', 0.075, 0.02);
  tone(523.25, 0.20, 'triangle', 0.085, 0.28);   // C5
  tone(659.25, 0.20, 'triangle', 0.085, 0.40);   // E5
  tone(783.99, 0.34, 'triangle', 0.090, 0.52);   // G5
  tone(1046.5, 0.42, 'sine',     0.070, 0.54);   // C6 over the top
  fxFlash('signon');
  fxHaptic([18, 30, 18, 30, 46]);
}

/** The daily lease debit. Under DESIGN.md's failure state this fires once per
    station per day, forever, which makes it the one sound in the game that
    must never be interesting: two quiet low knocks, below the UI click, with
    nothing above 200 Hz to catch the ear. If it is ever noticeable it is
    wrong. No flash — a daily event is not punctuation. */
function sfxLease(){
  tone(196.00, 0.05, 'triangle', 0.030);
  tone(146.83, 0.07, 'triangle', 0.026, 0.055);
}
/** Lease pressure: the bill is outrunning what the signal earns. The same two
    knocks, lower and slower, plus a third that does not resolve — a tritone
    under the second note, so it sits unfinished. Amber floor wash to match.
    Should fire on a THRESHOLD crossing, not every day it is true, or it stops
    meaning anything by the end of the first week. */
function sfxLeaseDue(){
  tone(174.61, 0.10, 'square',   0.055);
  tone(138.59, 0.13, 'square',   0.050, 0.10);
  tone(116.54, 0.34, 'sawtooth', 0.045, 0.22);
  fxFlash('lease');
}

/** Co-host chemistry, and the one sound in the game that is its own tooltip:
    a pair that works plays a perfect fifth (3:2 — consonant, settled), a pair
    that does not plays a minor second (a beating semitone). Nobody has to be
    told which is which, which is the entire point of shipping a sound for it
    rather than a number in a slot editor.

    `v` is the chem multiplier from DESIGN.md mechanic #2, where 1.0 is neutral
    — but CONTRACT.md never pins its range, so a boolean is accepted too and
    mapped explicitly. Left implicit, `+true` is 1, which is exactly neutral,
    and a good pairing would have played the nothing-note. */
function sfxChem(v){
  let c;
  if (v === true) c = 1.2;
  else if (v === false) c = 0.8;
  else c = Number.isFinite(+v) ? +v : 1;
  if (c > 1.02) {
    tone(440.00, 0.26, 'sine', 0.075);
    tone(660.00, 0.30, 'sine', 0.065, 0.02);
  } else if (c < 0.98) {
    tone(440.00, 0.30, 'sine', 0.070);
    tone(466.16, 0.32, 'sine', 0.062, 0.01);
  } else {
    tone(440.00, 0.18, 'sine', 0.055);
  }
}

function sfxTrouble(){
  tone(320, 0.12, 'square', 0.06);
  tone(230, 0.16, 'square', 0.055, 0.09);
}
function sfxBankrupt(){
  tone(220, 0.5, 'sawtooth', 0.1);
  tone(150, 0.6, 'sawtooth', 0.09, 0.16);
  tone(90, 0.9, 'sawtooth', 0.08, 0.34);
  fxFlash('bust');
  fxHaptic([60, 80, 60, 80, 160]);
}
