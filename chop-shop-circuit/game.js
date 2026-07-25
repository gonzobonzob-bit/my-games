/* ============================================================
   CHOP SHOP CIRCUIT — screen/state wiring, DOM glue, entry point
   ============================================================ */
'use strict';

const dom = {
  loading: document.getElementById('screen-loading'),
  menu: document.getElementById('screen-menu'),
  garage: document.getElementById('screen-garage'),
  ladder: document.getElementById('screen-ladder'),
  battle: document.getElementById('screen-battle'),
  results: document.getElementById('screen-results'),
  pause: document.getElementById('screen-pause'),

  continueBtn: document.getElementById('btn-continue'),
  qualityMenuBtn: document.getElementById('quality-menu-btn'),

  credits: document.getElementById('garage-credits'),
  slots: document.getElementById('garage-slots'),

  ladderList: document.getElementById('ladder-list'),

  hpPlayerFill: document.getElementById('hp-player-fill'),
  hpEnemyFill: document.getElementById('hp-enemy-fill'),
  battleTimer: document.getElementById('battle-timer'),
  playerName: document.getElementById('battle-player-name'),
  enemyName: document.getElementById('battle-enemy-name'),

  resultTitle: document.getElementById('result-title'),
  resultText: document.getElementById('result-text'),
  resultReward: document.getElementById('result-reward'),
};

const SCREENS = ['loading', 'menu', 'garage', 'ladder', 'battle', 'results', 'pause'];
function show(name) {
  SCREENS.forEach(s => { dom[s].style.display = (s === name) ? 'flex' : 'none'; });
}

let currentOpponentIndex = 0;
let hudPollTimer = null;
let paused = false;

/* ---------------- boot ---------------- */
async function main() {
  show('loading');
  await Arena.boot('renderCanvas');
  Arena.applyQuality(store.get().quality);
  startAutosave();
  refreshMenu();
  show('menu');
  wireGlobalInput();
}

function refreshMenu() {
  dom.continueBtn.style.display = store.hasSave() ? 'inline-block' : 'none';
  dom.qualityMenuBtn.textContent = 'Graphics: ' + store.get().quality.toUpperCase();
}

document.getElementById('btn-new-game').addEventListener('click', () => {
  if (store.hasSave() && !confirm('Start a new game? Your current save will be wiped.')) return;
  store.reset();
  goToGarage();
});
dom.continueBtn.addEventListener('click', goToGarage);
dom.qualityMenuBtn.addEventListener('click', cycleQuality);

function cycleQuality() {
  const order = ['low', 'medium', 'high'];
  const s = store.get();
  s.quality = order[(order.indexOf(s.quality) + 1) % order.length];
  store.save();
  Arena.applyQuality(s.quality);
  refreshMenu();
  const btl = document.getElementById('quality-battle-btn');
  if (btl) btl.textContent = 'Graphics: ' + s.quality.toUpperCase();
}

/* ---------------- garage ---------------- */
function goToGarage() {
  renderGarage();
  show('garage');
}

const SLOT_LABELS = { chassis: 'Chassis', weapon: 'Weapon', armor: 'Armor', drivetrain: 'Drivetrain', special: 'Special' };

function renderGarage() {
  const s = store.get();
  dom.credits.textContent = fmtCredits(s.credits) + ' cr';
  dom.slots.innerHTML = '';
  SLOT_ORDER.forEach(slot => {
    const col = document.createElement('div');
    col.className = 'slot-col';
    const h = document.createElement('h3');
    h.textContent = SLOT_LABELS[slot];
    col.appendChild(h);
    PARTS[slot].forEach(part => {
      const owned = ownsPart(slot, part.id);
      const equipped = s.loadout[slot] === part.id;
      const row = document.createElement('div');
      row.className = 'part-row' + (equipped ? ' equipped' : '');
      const info = document.createElement('div');
      info.className = 'part-info';
      info.innerHTML = `<div class="part-name">${part.name}${equipped ? ' <span class="tag-equipped">EQUIPPED</span>' : ''}</div>
        <div class="part-desc">${part.desc}</div>
        <div class="part-stats">${partStatLine(slot, part)}</div>`;
      row.appendChild(info);
      const btn = document.createElement('button');
      btn.className = 'btn-small';
      if (equipped) {
        btn.textContent = 'Equipped'; btn.disabled = true;
      } else if (owned) {
        btn.textContent = 'Equip';
        btn.addEventListener('click', () => { equipPart(slot, part.id); renderGarage(); });
      } else {
        btn.textContent = fmtCredits(part.cost) + ' cr';
        btn.disabled = s.credits < part.cost;
        btn.addEventListener('click', () => { buyPart(slot, part.id); renderGarage(); });
      }
      row.appendChild(btn);
      col.appendChild(row);
    });
    dom.slots.appendChild(col);
  });
}

function partStatLine(slot, part) {
  switch (slot) {
    case 'chassis': return `HP +${part.hp} · Weight ${part.weight}`;
    case 'armor': return `HP +${part.hp} · Weight +${part.weight}`;
    case 'drivetrain': return `Speed ${part.speed} · Accel ${part.accel} · Turn ${part.turn}`;
    case 'weapon': return `Dmg ${part.dmg} · Cooldown ${part.cooldown}s · Range ${part.range}`;
    case 'special': return '';
    default: return '';
  }
}

document.getElementById('btn-garage-to-ladder').addEventListener('click', goToLadder);
document.getElementById('btn-garage-to-menu').addEventListener('click', () => { show('menu'); refreshMenu(); });

/* ---------------- ladder ---------------- */
function goToLadder() {
  renderLadder();
  show('ladder');
}

function renderLadder() {
  const s = store.get();
  dom.ladderList.innerHTML = '';
  LEAGUE.forEach((entry, i) => {
    const locked = i > s.ladderIndex;
    const beaten = i < s.ladderIndex;
    const row = document.createElement('div');
    row.className = 'ladder-row' + (locked ? ' locked' : '') + (beaten ? ' beaten' : '');
    row.innerHTML = `<div class="ladder-info">
        <div class="ladder-name">${locked ? '🔒 ???' : entry.name}${beaten ? ' <span class="tag-beaten">DEFEATED</span>' : ''}</div>
        <div class="ladder-flavor">${locked ? 'Defeat the previous opponent to unlock.' : entry.flavor}</div>
      </div>
      <div class="ladder-reward">${locked ? '' : fmtCredits(entry.reward) + ' cr'}</div>`;
    const btn = document.createElement('button');
    btn.className = 'btn-small';
    btn.textContent = 'Fight';
    btn.disabled = locked;
    btn.addEventListener('click', () => startFight(i));
    row.appendChild(btn);
    dom.ladderList.appendChild(row);
  });
}

document.getElementById('btn-ladder-to-garage').addEventListener('click', goToGarage);

/* ---------------- battle ---------------- */
function startFight(index) {
  currentOpponentIndex = index;
  const playerStats = computeBotStats(getLoadout());
  const enemyStats = opponentStats(LEAGUE[index]);
  dom.playerName.textContent = 'YOUR BOT';
  dom.enemyName.textContent = LEAGUE[index].name;
  const qbtn = document.getElementById('quality-battle-btn');
  if (qbtn) qbtn.textContent = 'Graphics: ' + store.get().quality.toUpperCase();
  show('battle');
  Arena.startBattle(playerStats, enemyStats, onBattleComplete);
  if (hudPollTimer) clearInterval(hudPollTimer);
  hudPollTimer = setInterval(pollHud, 100);
}

function pollHud() {
  const st = Arena.getHudState();
  if (!st) return;
  dom.hpPlayerFill.style.width = Math.max(0, st.playerHp * 100) + '%';
  dom.hpEnemyFill.style.width = Math.max(0, st.enemyHp * 100) + '%';
  dom.battleTimer.textContent = Math.ceil(st.timeLeft) + 's';
  if (!st.active) { clearInterval(hudPollTimer); hudPollTimer = null; }
}

function onBattleComplete(result) {
  awardBattle(result.win, currentOpponentIndex);
  const foe = LEAGUE[currentOpponentIndex].name;
  if (result.byKo) {
    dom.resultTitle.textContent = result.win ? 'KNOCKOUT' : 'DEFEATED';
    dom.resultText.textContent = result.win
      ? `${foe} is scrap. Your bot walked away at ${Math.round(result.playerHpFrac * 100)}% HP.`
      : `Your bot didn't make it. ${foe} still stands.`;
  } else {
    dom.resultTitle.textContent = result.win ? 'JUDGES’ DECISION' : 'JUDGES’ DECISION';
    dom.resultText.textContent = result.win
      ? `The clock beat you both. The judges gave it to your bot over ${foe}.`
      : `The clock beat you both. The judges gave it to ${foe}.`;
  }
  dom.resultTitle.className = result.win ? 'win' : 'lose';
  renderScorecard(result.scorecard);
  dom.resultReward.textContent = result.win ? `+${fmtCredits(LEAGUE[currentOpponentIndex].reward)} credits` : '';
  show('results');
}

/* Judges' scorecard — only shown when a match went the distance. */
function renderScorecard(sc) {
  const el = document.getElementById('result-scorecard');
  if (!sc) { el.style.display = 'none'; el.innerHTML = ''; return; }
  const row = (label, a, b, max) =>
    `<div class="sc-row"><span class="sc-you">${a.toFixed(1)}</span>
      <span class="sc-label">${label} <em>/${max}</em></span>
      <span class="sc-them">${b.toFixed(1)}</span></div>`;
  el.innerHTML = `<div class="sc-head"><span>YOUR BOT</span><span>SCORECARD</span><span>${LEAGUE[currentOpponentIndex].name}</span></div>`
    + row('Damage', sc.player.damage, sc.enemy.damage, 5)
    + row('Aggression', sc.player.aggression, sc.enemy.aggression, 3)
    + row('Control', sc.player.control, sc.enemy.control, 3)
    + `<div class="sc-row sc-total"><span class="sc-you">${sc.player.total.toFixed(1)}</span>
        <span class="sc-label">TOTAL</span>
        <span class="sc-them">${sc.enemy.total.toFixed(1)}</span></div>`;
  el.style.display = 'block';
}

document.getElementById('btn-results-continue').addEventListener('click', () => {
  Arena.resetToIdle();
  goToLadder();
});

document.getElementById('quality-battle-btn').addEventListener('click', cycleQuality);

/* ---------------- pause ---------------- */
function togglePause() {
  paused = !paused;
  Arena.setPaused(paused);
  dom.pause.style.display = paused ? 'flex' : 'none';
}

document.getElementById('btn-pause-resume').addEventListener('click', togglePause);
document.getElementById('btn-pause-quit').addEventListener('click', () => {
  paused = false;
  Arena.setPaused(false);
  dom.pause.style.display = 'none';
  Arena.resetToIdle();
  if (hudPollTimer) { clearInterval(hudPollTimer); hudPollTimer = null; }
  refreshMenu();
  show('menu');
});
document.querySelectorAll('.btn-pause-open').forEach(b => b.addEventListener('click', togglePause));

function wireGlobalInput() {
  window.addEventListener('keydown', e => {
    if (e.code === 'Escape') {
      if (dom.menu.style.display === 'flex' || dom.loading.style.display === 'flex') return;
      togglePause();
    }
  });
  window.addEventListener('beforeunload', () => { try { store.save(); } catch (e) {} });
}

main();
