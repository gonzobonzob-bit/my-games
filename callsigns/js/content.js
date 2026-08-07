// Callsigns — content: player-facing strings, gear ladders, dayparts, shows, roles,
// name pools, events, and every tuning constant. Data plus the two string
// formatters (t/t2) — no simulation, no DOM.
// Part of the modular layout (vault rule 3): index.html + js/{content,sim,fx,ui}.js
// Classic scripts sharing one top-level scope; load order: content, sim, fx, ui.
// Carved verbatim from the single-file v1 at the 50% checkpoint — refactor
// only: same 'callsigns.save' key, same v2 state shape, identical behavior.
// The v3 empire work builds on this against CONTRACT.md at 75%.
'use strict';

/* ============================================================
   CALLSIGNS — v1
   All player-facing text lives in STR so an i18next EN/ES pass
   later is a data swap, not a code hunt. t('key',{vars}) only.
   ============================================================ */

const LANG = 'en';
const STR = {
  en: {
    tagline: 'Build a radio station into a media empire.',
    onair: 'ON AIR',
    foot: 'v1.0 · autosaves as you play',
    newGame: 'New Game', continueGame: 'Continue', options: 'Settings', quit: 'Quit',

    cash: 'Cash', listeners: 'Listeners', rep: 'Reputation',
    day: 'Day {n}', dayShort: 'DAY {n}',

    tabStudio: 'Studio', tabGear: 'Gear', tabStaff: 'Staff', tabEmpire: 'Empire', tabLog: 'Log',

    schedule: 'Broadcast Schedule', scheduleNote: 'Tap a slot to change the show',
    dailyBrief: 'Daily Brief',
    noDj: 'No DJ',
    unstaffed: 'Unstaffed — quality suffers',

    // Onboarding. nextGoal() picks the first unmet item; the intro modal runs
    // once, on the first day of a brand new station.
    goalHire: 'Hire your first DJ (Staff tab)',
    goalAssign: 'Put your DJ on Morning Drive — tap a slot',
    goalBuy: 'You can afford the {name} in Gear',
    goalRep: 'Reach {n} reputation — News raises it fastest',
    goalFound: 'Found your second station in Empire',
    introTitle: '📻 You are on the air',
    introSub: '{call} · {freq} FM — three things before the first day ends.',
    intro1: 'A broadcast day passes every few seconds. Cash, listeners and reputation all settle up at the end of each one, and the Daily Brief tells you how the last one went.',
    intro2: 'Your schedule is four dayparts. What you air in each — music, talk, news, paid programming — and which DJ you put on it decide show quality, and quality decides listeners and reputation.',
    intro3: 'Reputation unlocks better transmitters and antennas; cash buys them. Get both high enough and you can sign on a second callsign.',
    introGo: 'Start the day',

    // Clock times so a first-time player learns what a daypart actually is.
    // The 1.15-weight slot is Afternoon Drive — real radio's second-best hour
    // block — not a vague "Evening". The DAYPARTS ids are unchanged.
    partMorning: 'Morning Drive · 6-10 AM', partMidday: 'Midday · 10 AM-3 PM',
    partEvening: 'Afternoon Drive · 3-7 PM', partNight: 'Overnight · 7 PM-6 AM',
    // Prose form. The clock times belong in the schedule grid, where they teach
    // the player what a daypart is; spliced into a sentence they produce "A clip
    // from your Midday · 10 AM-3 PM show is everywhere online."
    partShortMorning: 'Morning Drive', partShortMidday: 'Midday',
    partShortEvening: 'Afternoon Drive', partShortNight: 'Overnight',
    showMusic: 'Music', showTalk: 'Talk', showNews: 'News', showAds: 'Paid Programming',
    showMusicDesc: 'Broad appeal, modest ad rates.',
    showTalkDesc: 'Loyal audience, strong ad rates.',
    showNewsDesc: 'Smaller reach, big reputation gains.',
    showAdsDesc: 'Guaranteed cash now — listeners and reputation both pay for it.',

    pickShow: 'Show', pickShowSub: '{part} · what goes out on this slot?',
    pickDj: 'DJ', pickDjSub: 'A DJ\'s skill multiplies this slot\'s quality.',
    cancel: 'Cancel', close: 'Close',
    short: '{amt} short',

    transmitter: 'Transmitter', antenna: 'Antenna',
    reach: 'Reach', fidelity: 'Audio Fidelity',
    tierOf: 'Tier {a} of {b}', maxTier: 'MAX',
    upgrade: 'Upgrade',
    needRep: 'Needs {n} rep',
    boostReach: '+{n}% reach', boostFid: '+{n}% fidelity',

    staffTitle: 'Payroll', hireTitle: 'Available for Hire',
    roleDj: 'DJ', roleEng: 'Sound Engineer', roleSales: 'Sales Agent',
    roleDjDesc: 'Raises show quality on their slot.',
    roleEngDesc: 'Boosts fidelity, prevents breakdowns.',
    roleSalesDesc: 'Sells more ad slots at better rates.',
    skill: 'Skill {n}', salary: '{amt}/day',
    hire: 'Hire', fire: 'Fire',
    hireTerms: 'One-time signing fee · then {amt}/day',
    trainCost: 'Train {amt}', maxSkill: 'Peak skill',
    tired: '−{n}% tired',
    fireConfirm: 'Let {name} go?', fireConfirmSub: 'They walk with their skill, and they will not be back.',
    hiredMsg: '{name} joined as {role}.',
    firedMsg: '{name} has left the station.',
    trainedMsg: '{name} trained up to skill {n}.',
    noStaff: 'Nobody on payroll. Hire a DJ to get real numbers.',
    noPayroll: 'No one on payroll yet',
    noPayrollNote: 'Everyone you can hire today is listed below.',
    noCandidates: 'No candidates today. New talent turns up as your reputation grows.',
    payroll: 'Payroll: {amt}/day',

    // Everything engBonus()/salesFill()/salesPrice() do, made visible — a
    // $36/day sales agent used to look like paying for nothing at all.
    effectsTitle: 'Station Effects',
    fxAdFill: 'Ad slots sold', fxAdRate: 'Ad rate',
    fxBreak: 'Breakdown risk', fxFid: 'Fidelity bonus',

    empireTitle: 'The Empire',
    foundConfirm: 'Found a second station?',
    foundConfirmSub: '{amt} out of the bank, today. The buildout is permanent.',
    lockedSub: 'Reach {cash} and {rep} reputation to expand beyond one signal.',
    unlockedTitle: 'Expansion unlocked',
    unlockedSub: 'You have the capital and the name. A second callsign is within reach.',
    progressTo: 'Progress to expansion',
    foundStation: 'Found Second Station',
    foundStationNote: 'One-time buildout cost of {amt}. The second station runs itself day to day, contributing a share of its take back to headquarters.',
    secondStationTitle: 'Second Station',
    secondStationSub: '{call} — signed on Day {day}.',
    networkContribution: 'Network contribution (yesterday)',
    networkTotal: 'Total earned by network',
    foundedMsg: 'You founded a second station, {call}, feeding the network.',
    empireTitle2: '🏙️ Media Empire',
    empireSub: '{a} and {b} are both on the air. You run a network.',
    empireNote: 'That is the last locked door in the game. Keep the clock running if you want to see how far the numbers go.',
    empireDays: 'Days on air', empireNet: 'Net earned',
    // totalCosts has been tracked and sanitized since the economy retune and
    // shown nowhere, while the Empire tab labelled the NET figure "earned".
    empireCosts: 'Costs paid',
    empirePeak: 'Peak listeners', empireRep: 'Reputation',
    keepPlaying: 'Keep Playing',

    logTitle: 'Station Log', noLog: 'Nothing logged yet.',

    paused: 'Paused', resume: 'Resume', save: 'Save', mainMenu: 'Main Menu',
    saved: 'Game saved.', loadFail: 'No save found.',
    optTitle: 'Settings', optSpeed: 'Game speed', optSpeedDesc: 'How fast a broadcast day passes.',
    optAutosave: 'Autosave', optAutosaveDesc: 'Save automatically every 30 seconds.',
    optEvents: 'Event popups', optEventsDesc: 'Pause the game for big story moments.',
    optMotion: 'Reduced motion', optMotionDesc: 'Calm down animated scene effects.',
    optSound: 'Sound effects', optSoundDesc: 'Clicks, on-air chimes, and dead-air stings.',
    optWipe: 'Delete save', optWipeDesc: 'Erase this station permanently.',
    wipe: 'Delete', wipeConfirm: 'Delete your save?', wipeConfirmSub: 'This cannot be undone.',

    newStationTitle: 'Sign On', newStationSub: 'Every station needs a callsign. Four letters, starts with K or W.',
    start: 'Start Broadcasting', randomize: 'Random',

    breakdownMsg: 'The {gear} cut out mid-show. Listeners drifted.',
    breakdownFixed: 'Your engineer caught the fault before anyone noticed.',

    // Fires while the situation is still reversible (cash under five days of
    // burn), not once the balance is already negative.
    cashWarning: 'Cash covers only a few more days at this burn rate. Cut costs or grow revenue.',

    briefQuality: 'Show Quality', briefBuzz: 'Buzz',
    repTrend: '{now} / 100 → trending to {target}',
    firstDay: 'Your first broadcast day is underway.',
    royaltiesLbl: 'Music licensing',
    // The Daily Brief prints revenue / costs / net side by side, and net folds
    // in the second station's contribution — so the "in" figure has to include
    // it, and this line is what says where the difference came from.
    networkLbl: 'Network {call}', onAirLbl: 'On-air',

    bankruptTitle: 'Station Bankrupt',
    bankruptSub: '{call} has gone dark for good.',
    bankruptNote: 'Payroll outran revenue for too many days running and the bills finally came due. This save has ended — start a new station to try again.',

    scenes: {
      garage: 'Garage Setup', storefront: 'Storefront Studio', tower: 'Broadcast Tower',
      citywide: 'Citywide Signal', network: 'Regional Network', empire: 'Media Empire'
    }
  }
};

function t(key, vars) {
  const path = key.split('.');
  let s = STR[LANG];
  for (const p of path) s = s && s[p];
  if (s === undefined) return key;
  if (vars) for (const k in vars) s = s.replace(new RegExp('\\{' + k + '\\}', 'g'), vars[k]);
  return s;
}
// Event copy is inline (not in STR) so it stays adjacent to its effect;
// still routed through a formatter so a localization pass has one seam.
function t2(str, vars){
  for (const k in vars) str = str.replace(new RegExp('\\{' + k + '\\}', 'g'), vars[k]);
  return str;
}

/* ---------------- static data ---------------- */

// Transmitter tiers follow the real FCC FM service ladder (Part 15 hobby rig
// up through Class C). Names/specs are descriptive class labels, not brands.
const TX = [
  { name: 'Part 15 Rig',      spec: '50 W',                 reach: 1.00, cost: 0,      rep: 0  },
  { name: 'Class A',          spec: '6 kW @ 100 m · 28 km',  reach: 1.85, cost: 1400,   rep: 8  },
  { name: 'Class B1',         spec: '25 kW @ 100 m · 39 km', reach: 3.30, cost: 7200,   rep: 24 },
  { name: 'Class B',          spec: '50 kW @ 150 m · 52 km', reach: 5.70, cost: 29000,  rep: 45 },
  { name: 'Class C',          spec: '100 kW @ 600 m · 92 km',reach: 9.20, cost: 105000, rep: 66 }
];

const ANT = [
  { name: 'Whip Antenna',     spec: 'omni',               fid: 1.00, cost: 0,     rep: 0  },
  { name: 'Dipole Array',     spec: '2-bay',              fid: 1.22, cost: 1100,  rep: 6  },
  { name: 'Ring Array',       spec: '4-bay',              fid: 1.46, cost: 5800,  rep: 21 },
  { name: 'Panel Array',      spec: '8-bay',              fid: 1.72, cost: 23500, rep: 42 },
  // Descriptive class label like the four below it. This slot has now been
  // through two brand names (a real HD Radio mark, then "Meridian CP-12" — and
  // Meridian Audio is a real hi-fi company); CLAUDE.md line 11 wants invented,
  // non-competing names, and the safest invented name is no brand at all.
  // "CP" is circular polarization, industry vocabulary rather than a trademark.
  { name: 'Circular Array',   spec: '12-bay CP',          fid: 2.00, cost: 88000, rep: 63 }
];

const DAYPARTS = [
  { id: 'morning', icon: '🌅', weight: 1.35 },
  { id: 'midday',  icon: '☀️', weight: 0.85 },
  { id: 'evening', icon: '🌆', weight: 1.15 },
  { id: 'night',   icon: '🌙', weight: 0.55 }
];
/** Two names per daypart, and the difference matters: partLabel() carries the
    clock times for the schedule grid and the slot editor's own title, while
    partShort() is the one that goes into sentences. Every {part} substitution
    picks one of these deliberately — see rollEvent() and pickShowSub. */
function partLabel(id){ return t('part' + id.charAt(0).toUpperCase() + id.slice(1)); }
function partShort(id){ return t('partShort' + id.charAt(0).toUpperCase() + id.slice(1)); }

// `parts` is a per-daypart multiplier on slot quality, so the best show is a
// different answer in each of the four slots — without it the grid is one
// decision copied four times. News is the reputation engine its tooltip
// promises (at a real revenue cost); ads are the cash lever.
const SHOWS = {
  music: { icon: '🎵', appeal: 1.00, adRate: 0.90, rep:  0.35,
           parts: { morning: 0.95, midday: 1.15, evening: 1.00, night: 1.20 } },
  talk:  { icon: '🎙️', appeal: 0.86, adRate: 1.20, rep:  0.55,
           parts: { morning: 1.20, midday: 0.95, evening: 1.15, night: 0.85 } },
  news:  { icon: '📰', appeal: 0.78, adRate: 1.00, rep:  2.20,
           parts: { morning: 1.30, midday: 1.00, evening: 1.10, night: 0.70 } },
  ads:   { icon: '💰', appeal: 0.42, adRate: 3.60, rep: -1.30,
           parts: { morning: 0.70, midday: 1.05, evening: 0.80, night: 1.35 } }
};

const ROLES = {
  dj:    { icon: '🎧', baseSalary: 32 },
  eng:   { icon: '🔧', baseSalary: 40 },
  sales: { icon: '📈', baseSalary: 36 }
};

const FIRST = ['Ray','Dot','Cleo','Miles','Junie','Hollis','Sable','Ike','Marnie','Cass','Ozzie','Wren',
  'Deke','Lula','Frankie','Nova','Bud','Reva','Sonny','Tess','Arlo','Vega','Moe','Birdie','Rex','Opal'];
const LAST = ['Vance','Okoye','Ramirez','Kwan','Delacroix','Boone','Ferraro','Njoku','Sharpe','Ellis',
  'Bright','Castellano','Mbeki','Duvall','Tran','Sorrentino','Fairbanks','Achebe','Lyle','Moreau'];

// Events that move the audience write to s.buzz, never to s.listeners:
// simulateDay() recomputes listeners from scratch every day, so a direct
// listener poke used to survive exactly one render and then vanish. Buzz
// multiplies potential and bleeds back to 1.0 over about six days.
// Cash events scale off the previous day's revenue so a sponsor cheque is
// still worth noticing at plateau instead of becoming decoration.
const EVENTS = [
  { id:'viral',    minDay:4,  w:10, type:'good',
    msg:'A clip from your {part} show is everywhere online. New listeners pour in.',
    apply:s=>{ setBuzz(s, s.buzz*1.28); s.rep=clamp(s.rep+3,0,100); } },
  { id:'sponsor',  minDay:6,  w:9,  type:'good',
    msg:'A local sponsor loved what they heard and paid up front.',
    apply:s=>{ s.cash+=Math.round(120+s.rep*22+(s.lastDay.revenue||0)*0.80); } },
  { id:'guest',    minDay:10, w:7,  type:'good',
    msg:'A touring act dropped by the studio unannounced. The phones lit up.',
    apply:s=>{ s.rep=clamp(s.rep+4,0,100); setBuzz(s, s.buzz*1.12); } },
  { id:'offnight', minDay:5,  w:9,  type:'bad',
    msg:'{name} had a rough night on air. Dead air, twice.',
    apply:s=>{ s.rep=clamp(s.rep-2.5,0,100); setBuzz(s, s.buzz*0.93); } },
  { id:'storm',    minDay:8,  w:7,  type:'bad',
    msg:'Weather knocked the signal down for part of the day.',
    apply:s=>{ setBuzz(s, s.buzz*0.85); } },
  { id:'poached',  minDay:14, w:5,  type:'bad',
    msg:'A rival station has been calling your people. Morale dipped.',
    apply:s=>{ s.rep=clamp(s.rep-2,0,100); } },
  { id:'ratings',  minDay:12, w:8,  type:'good',
    msg:'The new ratings book came in better than anyone expected.',
    apply:s=>{ s.rep=clamp(s.rep+3.5,0,100); } },
  { id:'fine',     minDay:16, w:4,  type:'bad',
    msg:'A regulator took issue with an ad read. Small fine.',
    apply:s=>{ s.cash-=Math.round(80+s.rep*14+(s.lastDay.revenue||0)*0.35); } }
];

// Economy scale. LISTENER_BASE sets how many people one "reach unit" of a
// perfect slot pulls; AD_VALUE is revenue per listener per ad-rate point.
// These two dominate balance — retune here, not in the formula.
const LISTENER_BASE = 260;
const AD_VALUE      = 0.42;

// Deliberately below SECOND_STATION_COST: the expansion has to unlock while
// you still have to save for it, or the climax contains no decision at all.
const UNLOCK_CASH = 60000;
const UNLOCK_REP  = 70;
const SAVE_KEY    = 'callsigns.save';
// Settings live outside the save so the main-menu Settings screen works with
// no station loaded (and so wiping a save doesn't reset your preferences).
const OPTS_KEY    = 'callsigns.opts';
const SAVE_VER    = 2;
const SPEEDS      = { 1: 5000, 2: 2600, 3: 1400 };

// Offline catch-up. Deliberately pinned to the 1x day length: reading
// S.opts.speed here would let a player set 3x, close the tab, and come back to
// 3.5x the payout for the same wall-clock absence.
//
// The cap that binds is in broadcast days, not wall-clock hours. A day is five
// seconds, so the "8 hours" this used to advertise would credit 5,760 days and
// hand back millions — the modal copy was describing a cap the code never had
// (OFFLINE_CAP_MS was unreachable behind OFFLINE_MAX_DAYS). 96 days of
// half-rate net IS the reward; it tops out after about eight minutes away, and
// no longer absence pays more. Derive the millisecond clamp from the day cap so
// the two can never disagree again, and quote the day figure to the player.
const OFFLINE_MS_PER_DAY = SPEEDS[1];
const OFFLINE_MAX_DAYS   = 96;
const OFFLINE_CAP_MS     = OFFLINE_MAX_DAYS * OFFLINE_MS_PER_DAY;
const OFFLINE_RATE       = 0.50;

// More than TX[4] ($105,000), so the endgame is a real fork: raw reach on the
// flagship, or network income from a second callsign.
const SECOND_STATION_COST = 120000;
const BANKRUPTCY_FLOOR = -4000;
