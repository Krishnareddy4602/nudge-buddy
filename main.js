// Nudge Buddy — main process
// Tracks screen time with the OS idle timer (no keylogging), decides when to
// remind you, and drives a transparent always-on-top strip where the buddy lives.
// Everything personal (name, hours, reminder timings) comes from the setup window
// shown on first launch and saved to desk-buddy-settings.json.

const { app, BrowserWindow, ipcMain, powerMonitor, screen, Tray, Menu, nativeImage, dialog } = require('electron');
const path = require('path');
const fs = require('fs');

// ---------- fixed config ----------
const DEMO = process.argv.includes('--demo');
const MIN = DEMO ? 2 : 60;          // seconds per "minute" (demo mode = 30x faster)
const COOLDOWN = DEMO ? 5 : 90;      // gap between two reminders (seconds)
const STRIP_H = 420;                 // height of the transparent strip
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const APP_NAME = 'Nudge Buddy';

// The app used to be called "Desk Buddy": carry its saved settings and stats over to the new folder once.
app.setName(APP_NAME);
(function migrateOldData() {
  const oldDir = path.join(app.getPath('appData'), 'Desk Buddy'), newDir = app.getPath('userData');
  for (const f of ['desk-buddy-settings.json', 'desk-buddy-stats.json']) {
    try { if (!fs.existsSync(path.join(newDir, f)) && fs.existsSync(path.join(oldDir, f))) {
      fs.mkdirSync(newDir, { recursive: true }); fs.copyFileSync(path.join(oldDir, f), path.join(newDir, f)); } } catch {}
  }
})();

// Reminder catalogue: text + animation. `every` is only the default — the user picks the real timing.
// Order = priority when two are due together. {name} is replaced with the user's name.
const CATALOG = [
  { id: 'water',   label: '💧 Drink water',      every: 45,  resetOnBreak: false, stat: 'water',
    title: '{name}, drink water right now', sub: 'A tiny reminder from your future self 💧', yes: 'Yes, I drank', anim: 'drink' },
  { id: 'eyes',    label: '👀 Rest your eyes',   every: 20,  resetOnBreak: true,  stat: 'eyeRests',
    title: 'Rest your eyes, {name}', sub: 'Look at something 20 feet away for 20 seconds.', yes: 'Done', anim: 'eyes' },
  { id: 'walk',    label: '🚶 Short walk',       every: 90,  resetOnBreak: true,  stat: 'walks',
    title: 'Go for a short walk 🚶', sub: "You've been on screen for {cont}. Five minutes of walking helps a lot.", yes: "I'm going", anim: 'wave' },
  { id: 'snack',   label: '🍎 Snack break',      every: 150, resetOnBreak: false, stat: 'snacks',
    title: 'Snack break, {name} 🍎', sub: 'Grab some fruit, nuts, or a biscuit with your tea.', yes: 'Ate a snack', anim: 'snack' },
  { id: 'stretch', label: '🙆 Stretch',          every: 60,  resetOnBreak: true,  stat: 'stretches',
    title: 'Stretch time, {name}', sub: 'Arms up high, then roll your neck and shoulders.', yes: 'Stretched!', anim: 'stretch' },
  { id: 'posture', label: '🧍 Posture check',    every: 30,  resetOnBreak: false, stat: 'posture',
    title: 'Posture check!', sub: 'Sit back, relax your shoulders, keep the screen at eye level.', yes: 'Sitting straight', anim: 'posture' },
  { id: 'wrist',   label: '✋ Hands & wrists',   every: 40,  resetOnBreak: true,  stat: 'wrist',
    title: 'Give your hands a break ✋', sub: 'Roll your wrists and stretch your fingers for 30 seconds.', yes: 'Done', anim: 'wrist' },
  { id: 'breathe', label: '🌬️ Deep breaths',     every: 75,  resetOnBreak: true,  stat: 'breaths',
    title: 'Take 5 deep breaths', sub: 'In for 4… hold for 4… out for 6. Slow and easy.', yes: 'Feeling calm', anim: 'breathe' },
];
const MEAL_TEXT = {
  lunch:  { stat: 'meals', title: 'Lunch time, {name}! 🍛', sub: 'Step away from the screen and enjoy your meal properly.', yes: 'Eating now', anim: 'meal' },
  dinner: { stat: 'meals', title: 'Dinner time, {name} 🍽️', sub: 'Close the laptop for a bit and eat without a screen.', yes: 'Eating now', anim: 'meal' },
};

// ---------- user settings ----------
const DEFAULTS = {
  name: '',
  hours: { on: true, start: '09:00', end: '18:00', days: [1, 2, 3, 4, 5] },
  reminders: Object.fromEntries(CATALOG.map(r => [r.id, { on: true, every: r.every }])),
  lunch:  { on: true, from: '13:00', to: '15:00' },
  dinner: { on: true, from: '20:00', to: '22:00' },
  bedtime: { on: true, at: '23:00' },
  tasks: { on: true, every: 120 },   // morning plan + task check-ins
  idleMin: 2, awayMin: 5, snoozeMin: 15, cardSec: 45, waterGoal: 8, startAtLogin: true,
};
const settingsFile = () => path.join(app.getPath('userData'), 'desk-buddy-settings.json');
const isTime = t => typeof t === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(t);
const num = (v, lo, hi, def) => { v = Math.round(Number(v)); return Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : def; };
const time = (v, def) => (isTime(v) ? v : def);

// Fills in anything missing / invalid so the rest of the app can trust the shape.
function normalize(s) {
  s = s || {};
  const D = DEFAULTS, h = s.hours || {}, r = s.reminders || {};
  const win = (w = {}, d) => ({ on: w.on !== false, from: time(w.from, d.from), to: time(w.to, d.to) });
  return {
    name: String(s.name || '').trim().slice(0, 30),
    hours: { on: h.on !== false, start: time(h.start, D.hours.start), end: time(h.end, D.hours.end),
      days: Array.isArray(h.days) ? [...new Set(h.days.map(Number).filter(x => x >= 0 && x <= 6))] : D.hours.days },
    reminders: Object.fromEntries(CATALOG.map(c => [c.id,
      { on: r[c.id]?.on !== false, every: num(r[c.id]?.every, 1, 600, c.every) }])),
    lunch: win(s.lunch, D.lunch),
    dinner: win(s.dinner, D.dinner),
    bedtime: { on: s.bedtime?.on !== false, at: time(s.bedtime?.at, D.bedtime.at) },
    tasks: { on: s.tasks?.on !== false, every: num(s.tasks?.every, 15, 480, D.tasks.every) },
    idleMin: num(s.idleMin, 1, 60, D.idleMin),
    awayMin: num(s.awayMin, 2, 120, D.awayMin),
    snoozeMin: num(s.snoozeMin, 1, 120, D.snoozeMin),
    cardSec: num(s.cardSec, 10, 59, D.cardSec),   // how long a reminder stays on screen (< 1 min)
    waterGoal: num(s.waterGoal, 1, 20, D.waterGoal),
    startAtLogin: s.startAtLogin !== false,
  };
}
function loadSettings() {
  try { const s = normalize(JSON.parse(fs.readFileSync(settingsFile(), 'utf8'))); return s.name ? s : null; }
  catch { return null; }
}

let cfg = normalize(DEFAULTS);
let N = '', IDLE_AFTER = 120, AWAY_AFTER = 300, RULES = [], MEALS = [];
const left = {};             // active seconds left until each interval reminder

function applySettings(s) {
  cfg = s;
  N = cfg.name;
  IDLE_AFTER = DEMO ? 20 : cfg.idleMin * 60;
  AWAY_AFTER = DEMO ? 40 : Math.max(cfg.awayMin, cfg.idleMin + 1) * 60;
  RULES = CATALOG.filter(c => cfg.reminders[c.id].on).map(c => ({ ...c, every: cfg.reminders[c.id].every }));
  MEALS = ['lunch', 'dinner'].filter(id => cfg[id].on).map(id => ({ id, ...MEAL_TEXT[id], from: cfg[id].from, to: cfg[id].to }));
  for (const id of Object.keys(left)) if (!RULES.find(r => r.id === id)) delete left[id];
  for (const r of RULES) left[r.id] = Math.min(left[r.id] ?? Infinity, r.every * MIN);
  if (app.isPackaged) {
    app.setLoginItemSettings({ openAtLogin: cfg.startAtLogin, path: process.env.PORTABLE_EXECUTABLE_FILE || process.execPath });
  }
}

// ---------- time windows ----------
const toMin = t => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
const nowMin = () => { const d = new Date(); return d.getHours() * 60 + d.getMinutes(); };
// true if the clock is inside [from, to) — works across midnight (e.g. 22:00 → 06:00)
function inWindow(from, to, t = nowMin()) {
  const a = toMin(from), b = toMin(to);
  return a === b ? true : a < b ? t >= a && t < b : t >= a || t < b;
}
// Is the companion "on duty" right now? (chosen days + hours; a night shift belongs to the day it started)
function onDuty() {
  const h = cfg.hours;
  if (!h.on) return true;
  const day = new Date().getDay(), t = nowMin(), a = toMin(h.start), b = toMin(h.end);
  if (a === b) return h.days.includes(day);
  if (a < b) return h.days.includes(day) && t >= a && t < b;
  if (t >= a) return h.days.includes(day);
  if (t < b) return h.days.includes((day + 6) % 7);
  return false;
}
const pretty = t => new Date(2000, 0, 1, ...t.split(':').map(Number)).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
function nextStartText() {
  const h = cfg.hours;
  if (!h.on || !h.days.length) return '';
  const today = new Date().getDay();
  for (let i = 0; i < 8; i++) {
    const d = (today + i) % 7;
    if (!h.days.includes(d) || (i === 0 && nowMin() >= toMin(h.start))) continue;
    return `${i === 0 ? 'later today' : i === 1 ? 'tomorrow' : DAYS[d]} at ${pretty(h.start)}`;
  }
  return '';
}

// ---------- persistent stats ----------
const statsFile = () => path.join(app.getPath('userData'), 'desk-buddy-stats.json');
const today = () => new Date().toLocaleDateString('en-CA'); // YYYY-MM-DD
let db = {};
function loadDb() { try { db = JSON.parse(fs.readFileSync(statsFile(), 'utf8')); } catch { db = {}; } }
function saveDb() {
  const keys = Object.keys(db).sort();
  while (keys.length > 30) delete db[keys.shift()];
  try { fs.writeFileSync(statsFile(), JSON.stringify(db, null, 2)); } catch {}
}
const ZERO = { activeSec: 0, longestSession: 0, breaks: 0, snoozes: 0, water: 0, eyeRests: 0, walks: 0, snacks: 0,
  stretches: 0, posture: 0, wrist: 0, breaths: 0, meals: 0, firedMeals: [] };
function day() {
  const d = today();
  db[d] = Object.assign({}, ZERO, { firedMeals: [] }, db[d] || {});
  return db[d];
}

// ---------- daily task list ----------
// { date: day the list was planned, items: [{ id, text, done, carried }] }
const tasksFile = () => path.join(app.getPath('userData'), 'nudge-buddy-tasks.json');
let tasks = { date: '', items: [] };
function loadTasks() { try { const t = JSON.parse(fs.readFileSync(tasksFile(), 'utf8')); if (Array.isArray(t.items)) tasks = t; } catch {} }
function saveTasks() { try { fs.writeFileSync(tasksFile(), JSON.stringify(tasks, null, 2)); } catch {} }
const pendingTasks = () => tasks.items.filter(t => !t.done);
const taskCount = () => `${tasks.items.filter(t => t.done).length}/${tasks.items.length}`;
// New day: start a fresh list, carrying over whatever wasn't finished last time.
function startTodayList() {
  if (tasks.date === today()) return;
  tasks = { date: today(), items: pendingTasks().map(t => ({ ...t, carried: true })) };
  saveTasks();
}
function cleanTasks(items) {
  if (!Array.isArray(items)) return [];
  return items.slice(0, 30).map((t, i) => ({ id: String(t.id || Date.now() + i).slice(0, 40),
    text: String(t.text || '').trim().slice(0, 80), done: !!t.done, carried: !!t.carried })).filter(t => t.text);
}
function planCard(edit) {
  const n = tasks.items.filter(t => t.carried).length;
  return { id: 'plan', kind: 'tasks', anim: 'remind', yes: edit ? 'Save' : 'Start my day', later: 'Later', sec: 120,
    title: edit ? 'Your tasks for today 📝' : 'Good morning, {name}! ☀️ What do you need to do today?',
    sub: edit ? 'Tick what you finished, or add new tasks.'
      : `Add your tasks. I'll check in every ${fmt(cfg.tasks.every * 60)} to see how it's going.${n ? ` ${n} unfinished task${n > 1 ? 's' : ''} from last time ${n > 1 ? 'are' : 'is'} already on the list.` : ''}` };
}
function checkInCard() {
  const left = pendingTasks().length, total = tasks.items.length;
  return { id: 'tasks', kind: 'tasks', anim: 'remind', yes: 'Update', sec: 60,
    title: 'Task check-in, {name} ✅',
    sub: `${total - left} of ${total} done. Tick what you've finished since last time.` };
}

// ---------- runtime state ----------
let win, tray, setupWin, started = false, rendererReady = false;
let configured = false;      // settings saved (false again after "Reset everything")
let userState = 'ACTIVE';
let locked = false, lockedAt = 0;
let continuous = 0;          // seconds on screen since the last real break
let awaySince = null;
let pausedUntil = 0;
let cardOpen = null;         // id of the reminder currently shown
let cardShownAt = 0;
let cooldown = 0;
let lastBedtime = 0;
let duty = null;             // companion on duty (inside the user's hours)?
let visibleUntil = 0;        // keep the window up briefly (greeting, cheer, goodbye, "show my day")
let leaving = 0;            // when the buddy started walking off screen (0 = not leaving)
let planPending = false;     // ask "what do you need to do today?" at the next chance
let taskLeft = 0;           // seconds until the next task check-in
let cardSecNow = 45;        // time limit of the open card

const send = (ch, data) => win && !win.isDestroyed() && win.webContents.send(ch, data);
const fmt = s => { s = Math.round(s); const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
  return h ? `${h}h ${m}m` : m ? `${m} min` : `${s % 60}s`; };
const fill = t => t.replace(/\{name\}/g, N).replace('{cont}', fmt(continuous));
const popUp = (ms, text) => { visibleUntil = Math.max(visibleUntil, Date.now() + ms); if (text) send('say', text); updateVisibility(); };

function show(r) {
  cardOpen = r.id;
  cardShownAt = Date.now() + 8000;   // grace while he walks in; reset by 'card-shown'
  cardSecNow = r.sec || cfg.cardSec;
  send('reminder', { id: r.id, title: fill(r.title), sub: fill(r.sub), yes: r.yes, anim: r.anim, snooze: cfg.snoozeMin,
    sec: cardSecNow, later: r.later, tasks: r.kind === 'tasks' ? tasks.items : null });
  updateVisibility();
}
function bedtimeCard(sub) {
  return { id: 'bedtime', title: "It's late, {name} — time to sleep 🌙", sub, yes: 'Good night', anim: 'sleepy' };
}

// Every interval timer starts again from now (used on save, at the start of the day, and from the tray).
function resetTimers() {
  for (const r of RULES) left[r.id] = r.every * MIN;
  taskLeft = cfg.tasks.every * MIN;
  continuous = 0;
  cooldown = 0;
}
function nextReminderText() {
  const next = RULES.slice().sort((a, b) => left[a.id] - left[b.id])[0];
  if (!next) return "I'll pop up for meals and bedtime";
  return `I'll hide now and pop up in ${fmt(left[next.id] / MIN * 60)} to remind you: ${next.label.replace(/^\S+\s/, '').toLowerCase()}`;
}

function pickDue(d) {
  const now = new Date();
  // 1. bedtime (from the chosen time until 5 AM, repeats every 30 min)
  if (cfg.bedtime.on && inWindow(cfg.bedtime.at, '05:00') && Date.now() - lastBedtime > 30 * MIN * 1000) {
    lastBedtime = Date.now();
    return bedtimeCard(`It's ${now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}. Tomorrow-you wants some rest.`);
  }
  // 2. meals (once per day, inside their window — these come even outside companion hours)
  const meal = MEALS.find(m => inWindow(m.from, m.to) && !d.firedMeals.includes(m.id));
  if (meal) { d.firedMeals.push(meal.id); return meal; }
  if (!duty) return null;
  // 3. morning plan: what do you need to do today?
  if (planPending && cfg.tasks.on) { planPending = false; startTodayList(); return planCard(false); }
  // 4. interval reminders
  const rule = RULES.find(r => left[r.id] === 0);
  if (rule) return rule;
  // 5. task check-in (skipped when nothing is left to do)
  if (cfg.tasks.on && taskLeft === 0) {
    if (tasks.date === today() && pendingTasks().length) return checkInCard();
    taskLeft = cfg.tasks.every * MIN;
  }
  return null;
}

function updateDuty() {
  const nowDuty = onDuty();
  if (nowDuty === duty) return;
  const first = duty === null;
  duty = nowDuty;
  if (duty) {
    resetTimers();   // fresh start: count every reminder from now
    if (cfg.tasks.on && tasks.date !== today()) planPending = true;
    send('greet', `${first ? 'Hey' : 'Good morning,'} ${N}! ${planPending ? "Let's plan your day 📝" : nextReminderText() + ' 👋'}`);
    popUp(7000);
  } else {
    if (cardOpen && RULES.find(r => r.id === cardOpen)) { send('hide-card'); cardOpen = null; }
    const next = nextStartText();
    if (first) { if (next) { send('greet', `All set, ${N}! See you ${next} 👋`); popUp(6000); } }
    else {
      const done = tasks.items.filter(t => t.done).length, total = tasks.items.length;
      const sum = tasks.date === today() && total ? ` You finished ${done} of ${total} tasks${done === total ? ' 🎉' : ''}.` : '';
      send('bye', `That's it for today, ${N}!${sum} See you ${next || 'soon'} 👋`); popUp(7000);
    }
  }
  buildTray();
}

// The buddy is only on screen while a reminder is open, or for a few seconds around it.
// He walks in from the screen edge when he comes out, and walks off the edge before the window hides.
function updateVisibility() {
  if (!win || win.isDestroyed()) return;
  const want = configured && (cardOpen || Date.now() < visibleUntil);
  if (want) {
    if (!win.isVisible()) { win.showInactive(); send('enter'); }
    else if (leaving) send('enter');   // called back while walking away: turn around
    leaving = 0;
  } else if (win.isVisible()) {
    if (!configured) { win.hide(); leaving = 0; }
    else if (!leaving) { leaving = Date.now(); send('leave'); }
    else if (Date.now() - leaving > 15000) { win.hide(); leaving = 0; }   // safety net
  }
}

function tick() {
  if (!rendererReady || !configured) return;
  const idle = locked ? 1e9 : powerMonitor.getSystemIdleTime();
  const prev = userState;
  userState = idle >= AWAY_AFTER ? 'AWAY' : idle >= IDLE_AFTER ? 'IDLE' : 'ACTIVE';
  const d = day();
  updateDuty();

  if (userState === 'AWAY' && prev !== 'AWAY') awaySince = locked ? lockedAt : Date.now() - idle * 1000;
  if (prev === 'AWAY' && userState !== 'AWAY') {
    const awaySec = (Date.now() - (awaySince || Date.now())) / 1000;
    awaySince = null;
    if (awaySec >= AWAY_AFTER) {
      d.breaks++;
      continuous = 0;
      RULES.filter(r => r.resetOnBreak).forEach(r => (left[r.id] = r.every * MIN));
      if (cardOpen && RULES.find(r => r.id === cardOpen)?.resetOnBreak) { send('hide-card'); cardOpen = null; }
      saveDb();
    }
  }

  if (userState === 'ACTIVE') {
    d.activeSec++;
    continuous++;
    d.longestSession = Math.max(d.longestSession, continuous);
  }
  // Timers run by the clock while you're at the computer (not while away / locked).
  const running = Date.now() > pausedUntil;
  if (userState !== 'AWAY') {
    if (running && duty && !cardOpen) {
      for (const r of RULES) left[r.id] = Math.max(0, left[r.id] - 1);
      taskLeft = Math.max(0, taskLeft - 1);
    }
    // reminders on all day: a new date means a new morning plan
    if (duty && !cfg.hours.on && cfg.tasks.on && tasks.date !== today() && cardOpen !== 'plan') planPending = true;
    if (cooldown > 0) cooldown--;
    if (running && !cardOpen && cooldown === 0) { const r = pickDue(d); if (r) show(r); }
  }
  // No answer within the time limit: the buddy leaves and asks again after the snooze time.
  if (cardOpen && Date.now() - cardShownAt >= cardSecNow * 1000) {
    const id = cardOpen;
    send('hide-card');
    respond(id, 'missed');
    popUp(3000, id === 'plan' ? 'No problem! Add tasks any time from the tray 📝' : `I'll ask again in ${cfg.snoozeMin} min 👋`);
  }

  updateVisibility();
  if (d.activeSec % 30 === 0) saveDb();
  send('tick', { name: N, state: userState, paused: Date.now() < pausedUntil, demo: DEMO, duty,
    activeToday: d.activeSec, continuous, stats: d, cardSec: cfg.cardSec,
    tasksDone: tasks.date === today() ? tasks.items.filter(t => t.done).length : 0,
    tasksTotal: tasks.date === today() ? tasks.items.length : 0,
    goal: cfg.waterGoal, waterEvery: cfg.reminders.water.on ? cfg.reminders.water.every : 0, snooze: cfg.snoozeMin });
}

function complete(id) {
  const d = day();
  const r = CATALOG.find(x => x.id === id) || MEAL_TEXT[id];
  if (r) d[r.stat]++;
  const rule = RULES.find(x => x.id === id);
  if (rule) left[id] = rule.every * MIN;
}

// action: 'done' | 'snooze' | 'missed' (no answer in time — handled like a snooze)
function respond(id, action) {
  if (id === 'plan' || id === 'tasks') {
    // after planning or a check-in, the next check-in is a full interval away (or the snooze time)
    taskLeft = (action === 'done' || id === 'plan' ? cfg.tasks.every : cfg.snoozeMin) * MIN;
  } else if (action === 'done') complete(id);
  else {
    const snooze = cfg.snoozeMin;
    if (action === 'snooze') day().snoozes++;
    if (left[id] !== undefined) left[id] = snooze * MIN;
    if (id === 'bedtime') lastBedtime = Date.now() - Math.max(0, 30 - snooze) * MIN * 1000;
    if (MEAL_TEXT[id]) setTimeout(() => { const d = day(); d.firedMeals = d.firedMeals.filter(x => x !== id); }, snooze * MIN * 1000);
  }
  cardOpen = null;
  cooldown = COOLDOWN;
  saveDb();
}
ipcMain.on('reminder-response', (_e, { id, action }) => {
  if (cardOpen !== id) return;   // already timed out
  respond(id, action);
  popUp(3500);                   // let him cheer / wave, then leave
});
ipcMain.on('log', (_e, id) => { complete(id); saveDb(); });
ipcMain.on('pause', (_e, minutes) => { pausedUntil = minutes ? Date.now() + minutes * 60000 : 0; buildTray(); });
ipcMain.on('set-ignore', (_e, ignore) => win && win.setIgnoreMouseEvents(ignore, { forward: true }));
ipcMain.on('stats-closed', () => { visibleUntil = Date.now() + 1500; });
ipcMain.on('card-shown', () => { if (cardOpen) cardShownAt = Date.now(); });
ipcMain.on('card-touch', () => { if (cardOpen) cardShownAt = Date.now(); });   // typing / ticking keeps the card open
ipcMain.on('focus-me', () => { if (win && !win.isDestroyed()) win.focus(); });   // so you can type a task
ipcMain.on('tasks:set', (_e, items) => { startTodayList(); tasks.items = cleanTasks(items); saveTasks(); buildTray(); });
ipcMain.on('walked-off', () => { if (leaving && win && !win.isDestroyed()) { win.hide(); leaving = 0; } });

// ---------- reset ----------
function resetToday() {
  delete db[today()];
  saveDb();
  popUp(3000, "Fresh start — today's numbers are reset ✨");
}
async function resetEverything() {
  const { response } = await dialog.showMessageBox({
    type: 'warning', buttons: ['Reset everything', 'Cancel'], defaultId: 1, cancelId: 1,
    title: APP_NAME, message: `Reset ${APP_NAME}?`,
    detail: 'This deletes your name, hours, reminder timings, task list and all saved stats, then opens the setup again.',
  });
  if (response !== 0) return;
  try { fs.rmSync(settingsFile(), { force: true }); fs.rmSync(statsFile(), { force: true }); fs.rmSync(tasksFile(), { force: true }); } catch {}
  tasks = { date: '', items: [] }; planPending = false;
  db = {};
  configured = false;
  cardOpen = null; duty = null; pausedUntil = 0; visibleUntil = 0;
  send('hide-card');
  updateVisibility();
  applySettings(normalize(DEFAULTS));
  buildTray();
  openSettings();
}

// ---------- setup / settings window ----------
ipcMain.handle('settings:load', () => ({
  settings: configured ? cfg : (loadSettings() || normalize(DEFAULTS)),
  defaults: normalize(DEFAULTS),
  catalog: CATALOG.map(({ id, label, every }) => ({ id, label, every })),
  firstRun: !configured,
  platform: process.platform,
}));
ipcMain.handle('settings:save', (_e, raw) => {
  const s = normalize(raw);
  if (!s.name) return { ok: false, error: 'Please enter your name.' };
  if (s.hours.on && !s.hours.days.length) return { ok: false, error: 'Pick at least one day for the companion.' };
  try { fs.writeFileSync(settingsFile(), JSON.stringify(s, null, 2)); }
  catch (err) { return { ok: false, error: 'Could not save settings: ' + err.message }; }
  applySettings(s);
  configured = true;
  resetTimers();   // every timer counts from the moment you save
  if (cardOpen) { send('hide-card'); cardOpen = null; }
  if (started) {
    duty = onDuty();
    const next = nextStartText();
    send('greet', duty ? `All set, ${N}! ${nextReminderText()} 👋` : `All set, ${N}! See you ${next || 'soon'} 👋`);
    popUp(7000);
    buildTray();
  } else startBuddy();
  setTimeout(() => setupWin && !setupWin.isDestroyed() && setupWin.close(), 50);
  return { ok: true };
});
ipcMain.on('settings:cancel', () => setupWin && !setupWin.isDestroyed() && setupWin.close());
ipcMain.on('app:quit', () => { saveDb(); app.quit(); });

function openSettings() {
  if (process.platform === 'darwin') app.focus({ steal: true });   // menu-bar app: bring the window to the front
  if (setupWin && !setupWin.isDestroyed()) { setupWin.show(); setupWin.focus(); return; }
  setupWin = new BrowserWindow({
    width: 620, height: 760, minWidth: 520, minHeight: 500, title: `${APP_NAME} — Setup`,
    icon: path.join(__dirname, 'icon.png'), autoHideMenuBar: true, show: false, backgroundColor: '#f5f5f7',
    webPreferences: { preload: path.join(__dirname, 'setup-preload.js'), contextIsolation: true },
  });
  setupWin.setMenuBarVisibility(false);
  setupWin.loadFile(path.join(__dirname, 'setup.html'));
  setupWin.once('ready-to-show', () => setupWin.show());
  setupWin.on('closed', () => {
    setupWin = null;
    if (!configured) app.quit();   // closed the setup without saving
  });
}

// ---------- window + tray ----------
function placeWindow() {
  const wa = screen.getPrimaryDisplay().workArea;
  win.setBounds({ x: wa.x, y: wa.y + wa.height - STRIP_H, width: wa.width, height: STRIP_H });
}

function createWindow() {
  win = new BrowserWindow({
    width: 800, height: STRIP_H, transparent: true, frame: false, resizable: false,
    alwaysOnTop: true, skipTaskbar: true, hasShadow: false, show: false, backgroundColor: '#00000000',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, backgroundThrottling: false },
  });
  placeWindow();
  win.setAlwaysOnTop(true, 'floating');
  if (process.platform === 'darwin') win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: false });
  win.setIgnoreMouseEvents(true, { forward: true });
  win.loadFile(path.join(__dirname, 'index.html'));
  win.webContents.on('did-finish-load', () => { rendererReady = true; });
  screen.on('display-metrics-changed', placeWindow);
}

const ALL = () => [...RULES, ...MEALS];
function fireTest(id) { const r = ALL().find(x => x.id === id); if (r && !cardOpen) show(r); }

function buildTray() {
  if (!tray) return;
  const paused = Date.now() < pausedUntil;
  const h = cfg.hours;
  const hoursText = !configured ? 'Not set up yet' : !h.on ? 'Reminders: all day'
    : `Reminders: ${pretty(h.start)}–${pretty(h.end)}${duty === false ? ' (off duty)' : ''}`;
  const menu = Menu.buildFromTemplate([
    { label: `${APP_NAME} · ${N}${DEMO ? ' (demo mode)' : ''}`, enabled: false },
    { label: `Screen time today: ${fmt(day().activeSec)}`, enabled: false },
    { label: hoursText, enabled: false },
    { type: 'separator' },
    { label: 'Show my day', click: () => { popUp(60000); send('show-stats'); } },
    { label: tasks.date === today() && tasks.items.length ? `My tasks (${taskCount()} done)…` : 'Plan my tasks…',
      enabled: configured, click: () => { if (cardOpen) return; startTodayList(); planPending = false; show(planCard(tasks.items.length > 0)); } },
    { label: 'I drank a glass of water 💧', click: () => { complete('water'); saveDb(); send('cheer', 'Hydrated! 💧'); } },
    { label: 'I ate a snack 🍎', click: () => { complete('snack'); saveDb(); send('cheer', 'Yum! 🍎'); } },
    { type: 'separator' },
    paused
      ? { label: 'Resume reminders', click: () => { pausedUntil = 0; buildTray(); } }
      : { label: 'Pause reminders', submenu: [30, 60, 180].map(m => ({
          label: m < 60 ? `${m} minutes` : `${m / 60} hour${m > 60 ? 's' : ''}`,
          click: () => { pausedUntil = Date.now() + m * 60000; buildTray(); } })) },
    { label: 'Try a reminder now', submenu: [...ALL().map(r => ({ label: r.id, click: () => fireTest(r.id) })),
      { label: 'bedtime', click: () => { if (!cardOpen) show(bedtimeCard(`Pretend it's past ${pretty(cfg.bedtime.at)}. Tomorrow-you wants some rest.`)); } }] },
    { label: 'Settings (name, hours, timings)…', click: openSettings },
    { label: 'Reset', submenu: [
      { label: 'Restart reminder timers from now', click: () => { resetTimers(); popUp(4000, `Timers reset! ${nextReminderText()} ⏱️`); } },
      { label: "Reset today's stats", click: resetToday },
      { type: 'separator' },
      { label: 'Reset everything & set up again…', click: resetEverything },
    ] },
    { type: 'separator' },
    { label: 'Quit', click: () => { saveDb(); app.quit(); } },
  ]);
  tray.setContextMenu(menu);
  tray.setToolTip(`${APP_NAME} — ${fmt(day().activeSec)} on screen today`);
}

function startBuddy() {
  if (started) return;
  started = true;
  createWindow();
  tray = new Tray(nativeImage.createFromPath(path.join(__dirname, 'icon.png')).resize({ width: 18, height: 18 }));
  buildTray();
  tray.on('click', () => buildTray());
  setInterval(buildTray, 60000);

  const lock = () => { if (!locked) { locked = true; lockedAt = Date.now() - Math.min(powerMonitor.getSystemIdleTime(), AWAY_AFTER) * 1000; } };
  powerMonitor.on('lock-screen', lock);
  powerMonitor.on('suspend', lock);
  powerMonitor.on('unlock-screen', () => (locked = false));
  powerMonitor.on('resume', () => (locked = false));

  setInterval(tick, 1000);
}

if (!app.requestSingleInstanceLock()) app.quit();
// Jump-list tasks (right-click the pinned taskbar icon) start the .exe with one of these flags.
function handleArgs(argv) {
  if (argv.includes('--quit')) { saveDb(); app.quit(); return true; }
  if (!started || !configured) return false;
  if (argv.includes('--pause')) { pausedUntil = Date.now() + 60 * 60000; buildTray(); popUp(3000, 'Okay, quiet for an hour 🤫'); return true; }
  if (argv.includes('--resume')) { pausedUntil = 0; buildTray(); popUp(3000, "I'm back on duty! 💪"); return true; }
  if (argv.includes('--show-day')) { popUp(60000); send('show-stats'); return true; }
  return false;
}
// opening the .exe again (Start menu, desktop or taskbar icon) shows the settings
app.on('second-instance', (_e, argv) => { if (!handleArgs(argv)) openSettings(); });
// macOS: opening the app again (Launchpad / Applications) while it runs
app.on('activate', () => { if (started) openSettings(); });

function setJumpList() {
  if (process.platform !== 'win32' || !app.isPackaged) return;
  const program = process.env.PORTABLE_EXECUTABLE_FILE || process.execPath;
  const task = (title, args, description) => ({ program, arguments: args, title, description, iconPath: program, iconIndex: 0 });
  app.setUserTasks([
    task('Settings', '', 'Change your name, hours and reminder timings'),
    task('Show my day', '--show-day', "See today's screen time and habits"),
    task('Pause reminders for 1 hour', '--pause', 'No pop-ups for the next hour'),
    task('Resume reminders', '--resume', 'Turn reminders back on'),
    task(`Quit ${APP_NAME}`, '--quit', `Stop ${APP_NAME}`),
  ]);
}

app.whenReady().then(() => {
  if (process.argv.includes('--quit')) { app.quit(); return; }   // "Quit" clicked while it wasn't running
  if (process.platform === 'darwin' && app.dock) app.dock.hide();
  setJumpList();
  loadDb();
  loadTasks();
  const saved = process.argv.includes('--setup') ? null : loadSettings();
  if (saved) { applySettings(saved); configured = true; startBuddy(); }
  else openSettings();   // first launch: ask for name, hours and timings
});

app.on('before-quit', saveDb);
app.on('window-all-closed', e => e.preventDefault());
