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
  muteMenuBtn: document.getElementById('btn-mute-menu'),

  credits: document.getElementById('garage-credits'),
  slots: document.getElementById('garage-slots'),
  weightInfo: document.getElementById('garage-weight-info'),

  ladderList: document.getElementById('ladder-list'),
  rankPanel: document.getElementById('rank-panel'),

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
let currentMode = 'ladder'; // 'ladder' | 'rank' — see startFight()/startRankFight()
let currentRankOpponent = null;
let hudPollTimer = null;
let paused = false;

/* ---------------- boot ---------------- */
async function main() {
  show('loading');
  await Arena.boot('renderCanvas');
  Arena.applyQuality(store.get().quality);
  Arena.setMuted(store.get().muted);
  startAutosave();
  refreshMenu();
  show('menu');
  wireGlobalInput();
}

function refreshMenu() {
  dom.continueBtn.style.display = store.hasSave() ? 'inline-block' : 'none';
  dom.qualityMenuBtn.textContent = 'Graphics: ' + store.get().quality.toUpperCase();
  dom.muteMenuBtn.textContent = 'Sound: ' + (store.get().muted ? 'OFF' : 'ON');
}

function toggleMute() {
  const s = store.get();
  s.muted = !s.muted;
  store.save();
  Arena.setMuted(s.muted);
  refreshMenu();
  const mbtl = document.getElementById('btn-mute-battle');
  if (mbtl) mbtl.textContent = 'Sound: ' + (s.muted ? 'OFF' : 'ON');
  if (!s.muted) Arena.sfxUiClick(); // audible confirmation that sound is back on
}
dom.muteMenuBtn.addEventListener('click', toggleMute);
document.getElementById('btn-mute-battle').addEventListener('click', toggleMute);

document.getElementById('btn-new-game').addEventListener('click', () => {
  if (store.hasSave() && !confirm('Start a new game? Your current save will be wiped.')) return;
  Arena.sfxUiClick();
  store.reset();
  goToGarage();
});
dom.continueBtn.addEventListener('click', () => { Arena.sfxUiClick(); goToGarage(); });
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
  const stats = computeBotStats(s.loadout);
  const wf = weightFactor(stats.weight);
  if (dom.weightInfo) {
    dom.weightInfo.innerHTML = `Current loadout weight <strong>${stats.weight}</strong> (chassis + armor) → drivetrain speed factor <strong>×${wf.toFixed(2)}</strong>.
      Effective speed <strong>${stats.speed.toFixed(1)}</strong> · turn <strong>${stats.turn.toFixed(1)}</strong> — heavier plating trades mobility for HP.`;
  }
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
        btn.addEventListener('click', () => { equipPart(slot, part.id); Arena.sfxUiClick(); renderGarage(); });
      } else {
        btn.textContent = fmtCredits(part.cost) + ' cr';
        btn.disabled = s.credits < part.cost;
        btn.addEventListener('click', () => { buyPart(slot, part.id); Arena.sfxPurchase(); renderGarage(); });
      }
      row.appendChild(btn);
      col.appendChild(row);
    });
    dom.slots.appendChild(col);
  });
}

/* Weight from chassis + armor drags down the drivetrain's raw speed/turn
   numbers (see weightFactor() in economy.js) — these previews compute what
   THIS part would do to the currently equipped loadout, not just its own
   raw stat, so the tradeoff is visible before you buy/equip it. */
function partStatLine(slot, part) {
  const s = store.get();
  switch (slot) {
    case 'chassis': {
      const armor = findPart('armor', s.loadout.armor);
      const wf = weightFactor(part.weight + armor.weight);
      return `HP +${part.hp} · Weight ${part.weight} · drivetrain speed ×${wf.toFixed(2)}`;
    }
    case 'armor': {
      const chassis = findPart('chassis', s.loadout.chassis);
      const wf = weightFactor(chassis.weight + part.weight);
      return `HP +${part.hp} · Weight +${part.weight} · drivetrain speed ×${wf.toFixed(2)}`;
    }
    case 'drivetrain': {
      const chassis = findPart('chassis', s.loadout.chassis);
      const armor = findPart('armor', s.loadout.armor);
      const wf = weightFactor(chassis.weight + armor.weight);
      const effSpeed = (part.speed * wf).toFixed(1);
      const effTurn = (part.turn * (0.6 + 0.4 * wf)).toFixed(1);
      return `Speed ${part.speed} → eff ${effSpeed} · Accel ${part.accel} · Turn ${part.turn} → eff ${effTurn}`;
    }
    case 'weapon': return `Dmg ${part.dmg} · Cooldown ${part.cooldown}s · Range ${part.range}`;
    case 'special': return '';
    default: return '';
  }
}

document.getElementById('btn-garage-to-ladder').addEventListener('click', () => { Arena.sfxUiClick(); goToLadder(); });
document.getElementById('btn-garage-to-menu').addEventListener('click', () => { Arena.sfxUiClick(); show('menu'); refreshMenu(); });

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
    btn.addEventListener('click', () => { Arena.sfxUiClick(); startFight(i); });
    row.appendChild(btn);
    dom.ladderList.appendChild(row);
  });
  renderRankPanel();
}

/* Chrome Circuit Gauntlet — the post-ladder endgame loop. Unlocked once every
   league opponent has been beaten; repeatable remix fights at escalating
   difficulty/reward so there's something to do after Chrome Reaper falls. */
function renderRankPanel() {
  if (!dom.rankPanel) return;
  const s = store.get();
  if (!isGauntletUnlocked()) { dom.rankPanel.classList.remove('active'); dom.rankPanel.innerHTML = ''; return; }
  const rank = s.rank || 0;
  const best = s.rankBest || 0;
  const next = rankOpponent(rank);
  dom.rankPanel.classList.add('active');
  dom.rankPanel.innerHTML = `<div class="rank-info">
      <div class="rank-title">Chrome Circuit Gauntlet</div>
      <div class="rank-sub">Rank <strong>${rank + 1}</strong> · Best <strong>${best + 1}</strong> — next up: <strong>${next.name}</strong> for <strong>${fmtCredits(next.reward)} cr</strong></div>
    </div>`;
  const btn = document.createElement('button');
  btn.className = 'btn-large';
  btn.textContent = 'Fight ▶';
  btn.addEventListener('click', () => { Arena.sfxUiClick(); startRankFight(); });
  dom.rankPanel.appendChild(btn);
}

document.getElementById('btn-ladder-to-garage').addEventListener('click', () => { Arena.sfxUiClick(); goToGarage(); });

/* ---------------- battle ---------------- */
function startFight(index) {
  currentMode = 'ladder';
  currentOpponentIndex = index;
  const playerStats = computeBotStats(getLoadout());
  const enemyStats = opponentStats(LEAGUE[index]);
  dom.playerName.textContent = 'YOUR BOT';
  dom.enemyName.textContent = LEAGUE[index].name;
  enterBattleScreen();
  Arena.startBattle(playerStats, enemyStats, onBattleComplete);
}

function startRankFight() {
  currentMode = 'rank';
  currentRankOpponent = rankOpponent(store.get().rank || 0);
  const playerStats = computeBotStats(getLoadout());
  const enemyStats = opponentStats(currentRankOpponent);
  dom.playerName.textContent = 'YOUR BOT';
  dom.enemyName.textContent = currentRankOpponent.name;
  enterBattleScreen();
  Arena.startBattle(playerStats, enemyStats, onBattleComplete);
}

function enterBattleScreen() {
  const qbtn = document.getElementById('quality-battle-btn');
  if (qbtn) qbtn.textContent = 'Graphics: ' + store.get().quality.toUpperCase();
  const mbtn = document.getElementById('btn-mute-battle');
  if (mbtn) mbtn.textContent = 'Sound: ' + (store.get().muted ? 'OFF' : 'ON');
  show('battle');
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
  if (currentMode === 'rank') { onRankBattleComplete(result); return; }
  awardBattle(result.win, currentOpponentIndex);
  const foe = LEAGUE[currentOpponentIndex].name;
  applyResultText(result, foe);
  renderScorecard(result.scorecard, foe);
  dom.resultReward.textContent = result.win ? `+${fmtCredits(LEAGUE[currentOpponentIndex].reward)} credits` : '';
  show('results');
}

function onRankBattleComplete(result) {
  const foe = currentRankOpponent.name;
  const reward = currentRankOpponent.reward;
  awardRankBattle(result.win, reward);
  applyResultText(result, foe);
  renderScorecard(result.scorecard, foe);
  dom.resultReward.textContent = result.win ? `+${fmtCredits(reward)} credits · Rank ${store.get().rank}` : `Rank streak dropped to ${store.get().rank + 1}`;
  show('results');
}

/* Shared win/loss/KO/judges'-decision/double-KO copy for both the ladder
   and gauntlet flows. A double KO gets its own distinct message so it reads
   as a fair simultaneous outcome rather than an arbitrary loss. */
function applyResultText(result, foe) {
  if (result.doubleKo) {
    dom.resultTitle.textContent = 'DOUBLE KO';
    dom.resultText.textContent = `Both bots hit zero HP in the same instant. Neither walked away — the house rules this one a loss for the challenger, but it's a wash, not a beating.`;
    dom.resultTitle.className = 'draw';
    return;
  }
  if (result.byKo) {
    dom.resultTitle.textContent = result.win ? 'KNOCKOUT' : 'DEFEATED';
    dom.resultText.textContent = result.win
      ? `${foe} is scrap. Your bot walked away at ${Math.round(result.playerHpFrac * 100)}% HP.`
      : `Your bot didn't make it. ${foe} still stands.`;
  } else {
    dom.resultTitle.textContent = 'JUDGES’ DECISION';
    dom.resultText.textContent = result.win
      ? `The clock beat you both. The judges gave it to your bot over ${foe}.`
      : `The clock beat you both. The judges gave it to ${foe}.`;
  }
  dom.resultTitle.className = result.win ? 'win' : 'lose';
}

/* Judges' scorecard — only shown when a match went the distance. */
function renderScorecard(sc, foe) {
  const el = document.getElementById('result-scorecard');
  if (!sc) { el.style.display = 'none'; el.innerHTML = ''; return; }
  const row = (label, a, b, max) =>
    `<div class="sc-row"><span class="sc-you">${a.toFixed(1)}</span>
      <span class="sc-label">${label} <em>/${max}</em></span>
      <span class="sc-them">${b.toFixed(1)}</span></div>`;
  el.innerHTML = `<div class="sc-head"><span>YOUR BOT</span><span>SCORECARD</span><span>${foe}</span></div>`
    + row('Damage', sc.player.damage, sc.enemy.damage, 5)
    + row('Aggression', sc.player.aggression, sc.enemy.aggression, 3)
    + row('Control', sc.player.control, sc.enemy.control, 3)
    + `<div class="sc-row sc-total"><span class="sc-you">${sc.player.total.toFixed(1)}</span>
        <span class="sc-label">TOTAL</span>
        <span class="sc-them">${sc.enemy.total.toFixed(1)}</span></div>`;
  el.style.display = 'block';
}

document.getElementById('btn-results-continue').addEventListener('click', () => {
  Arena.sfxUiClick();
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

document.getElementById('btn-pause-resume').addEventListener('click', () => { Arena.sfxUiClick(); togglePause(); });
document.getElementById('btn-pause-quit').addEventListener('click', () => {
  Arena.sfxUiClick();
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
