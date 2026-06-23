/* ============================================================
   100 GÜN ORMANDA — Amazon Survival Horror
   Tek dosya oyun motoru (Canvas 2D, saf JS).
   Hem PC (klavye+fare) hem mobil (dokunmatik) destekler.
   ============================================================ */
(function () {
"use strict";

/* ----------------------- CONFIG ----------------------- */
const CFG = {
  WORLD: 6000,
  DAY_LENGTH: 165,        // saniye / tam gün-gece döngüsü
  WIN_DAY: 100,
  TREES: 460,
  DECOR: 260,
  PREY: 26,
  PLAYER_SPEED: 165,
  SPRINT_MULT: 1.7,
  CHOP_RANGE: 78,
  CHOP_CONE: 1.1,         // radyan (yarı açı)
};

/* ----------------------- UTIL ----------------------- */
const rnd  = (a, b) => a + Math.random() * (b - a);
const rndi = (a, b) => Math.floor(rnd(a, b + 1));
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const lerp = (a, b, t) => a + (b - a) * t;
const dist2 = (ax, ay, bx, by) => { const dx = ax - bx, dy = ay - by; return dx * dx + dy * dy; };
const dist  = (ax, ay, bx, by) => Math.sqrt(dist2(ax, ay, bx, by));
const angTo = (ax, ay, bx, by) => Math.atan2(by - ay, bx - ax);
const angDiff = (a, b) => { let d = (a - b) % (Math.PI * 2); if (d > Math.PI) d -= Math.PI * 2; if (d < -Math.PI) d += Math.PI * 2; return d; };
const choice = arr => arr[Math.floor(Math.random() * arr.length)];
const map = (v, a, b, c, d) => c + (clamp(v, a, b) - a) / (b - a) * (d - c);

/* ----------------------- CANVAS ----------------------- */
const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");
let VW = 0, VH = 0, DPR = 1;
const lightCanvas = document.createElement("canvas");
const lctx = lightCanvas.getContext("2d");

function resize() {
  DPR = Math.min(window.devicePixelRatio || 1, 2);
  VW = window.innerWidth; VH = window.innerHeight;
  canvas.width = VW * DPR; canvas.height = VH * DPR;
  lightCanvas.width = VW * DPR; lightCanvas.height = VH * DPR;
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
}
window.addEventListener("resize", resize);
resize();

/* ----------------------- AUDIO ENGINE (prosedürel) ----------------------- */
const Sound = {
  ctx: null, master: null, on: true, ambGain: null,
  init() {
    if (this.ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.on ? 0.85 : 0;
    this.master.connect(this.ctx.destination);
    this._ambient();
  },
  resume() { if (this.ctx && this.ctx.state === "suspended") this.ctx.resume(); },
  setOn(v) { this.on = v; if (this.master) this.master.gain.value = v ? 0.85 : 0; },
  _noise(dur) {
    const n = Math.floor(this.ctx.sampleRate * dur);
    const buf = this.ctx.createBuffer(1, n, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  },
  _ambient() {
    const c = this.ctx;
    // alçak uğultu (drone)
    const o1 = c.createOscillator(), o2 = c.createOscillator(), g = c.createGain();
    o1.type = "sine"; o2.type = "sine"; o1.frequency.value = 48; o2.frequency.value = 56.3;
    g.gain.value = 0.06; o1.connect(g); o2.connect(g); g.connect(this.master);
    o1.start(); o2.start();
    // rüzgar (filtrelenmiş gürültü)
    const src = c.createBufferSource(); src.buffer = this._noise(4); src.loop = true;
    const lp = c.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 420;
    const wg = c.createGain(); wg.gain.value = 0.05;
    src.connect(lp); lp.connect(wg); wg.connect(this.master); src.start();
    this.ambGain = g;
  },
  thump() {
    if (!this.ctx) return;
    const c = this.ctx, o = c.createOscillator(), g = c.createGain();
    o.type = "sine"; o.frequency.setValueAtTime(70, c.currentTime);
    o.frequency.exponentialRampToValueAtTime(38, c.currentTime + 0.18);
    g.gain.setValueAtTime(0.0001, c.currentTime);
    g.gain.exponentialRampToValueAtTime(0.5, c.currentTime + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + 0.35);
    o.connect(g); g.connect(this.master); o.start(); o.stop(c.currentTime + 0.4);
  },
  step() {
    if (!this.ctx) return;
    const c = this.ctx, s = c.createBufferSource(); s.buffer = this._noise(0.08);
    const f = c.createBiquadFilter(); f.type = "lowpass"; f.frequency.value = 900;
    const g = c.createGain(); g.gain.setValueAtTime(0.12, c.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + 0.09);
    s.connect(f); f.connect(g); g.connect(this.master); s.start(); s.stop(c.currentTime + 0.1);
  },
  chop() {
    if (!this.ctx) return;
    const c = this.ctx, s = c.createBufferSource(); s.buffer = this._noise(0.12);
    const f = c.createBiquadFilter(); f.type = "bandpass"; f.frequency.value = 1600;
    const g = c.createGain(); g.gain.setValueAtTime(0.25, c.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + 0.13);
    s.connect(f); f.connect(g); g.connect(this.master); s.start(); s.stop(c.currentTime + 0.14);
  },
  crackle() {
    if (!this.ctx) return;
    const c = this.ctx, s = c.createBufferSource(); s.buffer = this._noise(0.05);
    const f = c.createBiquadFilter(); f.type = "highpass"; f.frequency.value = 2200;
    const g = c.createGain(); g.gain.setValueAtTime(0.06, c.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + 0.05);
    s.connect(f); f.connect(g); g.connect(this.master); s.start(); s.stop(c.currentTime + 0.06);
  },
  whoosh() {
    if (!this.ctx) return;
    const c = this.ctx, s = c.createBufferSource(); s.buffer = this._noise(0.6);
    const f = c.createBiquadFilter(); f.type = "lowpass";
    f.frequency.setValueAtTime(1800, c.currentTime);
    f.frequency.exponentialRampToValueAtTime(180, c.currentTime + 0.55);
    const g = c.createGain(); g.gain.setValueAtTime(0.25, c.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + 0.6);
    s.connect(f); f.connect(g); g.connect(this.master); s.start(); s.stop(c.currentTime + 0.62);
  },
  whisper() {
    if (!this.ctx) return;
    const c = this.ctx, s = c.createBufferSource(); s.buffer = this._noise(1.2);
    const f = c.createBiquadFilter(); f.type = "bandpass"; f.frequency.value = 1700; f.Q.value = 6;
    const g = c.createGain(); g.gain.setValueAtTime(0.0001, c.currentTime);
    g.gain.linearRampToValueAtTime(0.14, c.currentTime + 0.2);
    g.gain.linearRampToValueAtTime(0.0001, c.currentTime + 1.1);
    s.connect(f); f.connect(g); g.connect(this.master); s.start(); s.stop(c.currentTime + 1.2);
  },
  screech() {
    if (!this.ctx) return;
    const c = this.ctx, t = c.currentTime;
    // gürültü patlaması
    const s = c.createBufferSource(); s.buffer = this._noise(0.7);
    const hp = c.createBiquadFilter(); hp.type = "highpass"; hp.frequency.value = 800;
    const sg = c.createGain(); sg.gain.setValueAtTime(0.9, t); sg.gain.exponentialRampToValueAtTime(0.0001, t + 0.6);
    s.connect(hp); hp.connect(sg); sg.connect(this.master); s.start(); s.stop(t + 0.7);
    // çığlık benzeri inen testere dişi
    const o1 = c.createOscillator(), o2 = c.createOscillator(), og = c.createGain();
    o1.type = "sawtooth"; o2.type = "sawtooth";
    o1.frequency.setValueAtTime(1400, t); o1.frequency.exponentialRampToValueAtTime(180, t + 0.55);
    o2.frequency.setValueAtTime(1480, t); o2.frequency.exponentialRampToValueAtTime(150, t + 0.55);
    og.gain.setValueAtTime(0.0001, t); og.gain.exponentialRampToValueAtTime(0.5, t + 0.03);
    og.gain.exponentialRampToValueAtTime(0.0001, t + 0.6);
    o1.connect(og); o2.connect(og); og.connect(this.master);
    o1.start(); o2.start(); o1.stop(t + 0.62); o2.stop(t + 0.62);
  },
  growl() {
    if (!this.ctx) return;
    const c = this.ctx, o = c.createOscillator(), g = c.createGain(), lfo = c.createOscillator(), lg = c.createGain();
    o.type = "sawtooth"; o.frequency.value = 90;
    lfo.type = "sine"; lfo.frequency.value = 22; lg.gain.value = 30; lfo.connect(lg); lg.connect(o.frequency);
    const f = c.createBiquadFilter(); f.type = "lowpass"; f.frequency.value = 500;
    g.gain.setValueAtTime(0.0001, c.currentTime);
    g.gain.linearRampToValueAtTime(0.3, c.currentTime + 0.1);
    g.gain.linearRampToValueAtTime(0.0001, c.currentTime + 0.7);
    o.connect(f); f.connect(g); g.connect(this.master); o.start(); lfo.start();
    o.stop(c.currentTime + 0.75); lfo.stop(c.currentTime + 0.75);
  },
};

/* ----------------------- INPUT ----------------------- */
const keys = {};
const input = {
  mx: VW / 2, my: VH / 2, mouseActive: false,
  joyActive: false, joyX: 0, joyY: 0, joyAng: 0,
  sprintHeld: false, isTouch: false,
  // edge-trigger flags
  action: false, fire: false, eat: false,
};
addEventListener("keydown", e => {
  keys[e.key.toLowerCase()] = true;
  if ([" ", "arrowup", "arrowdown", "arrowleft", "arrowright"].includes(e.key.toLowerCase())) e.preventDefault();
  const k = e.key.toLowerCase();
  if (k === "e" || k === " ") input.action = true;
  if (k === "f") input.fire = true;
  if (k === "g") input.eat = true;
  if (k === "shift") input.sprintHeld = true;
});
addEventListener("keyup", e => {
  keys[e.key.toLowerCase()] = false;
  if (e.key.toLowerCase() === "shift") input.sprintHeld = false;
});
canvas.addEventListener("mousemove", e => { input.mx = e.clientX; input.my = e.clientY; input.mouseActive = true; });
canvas.addEventListener("mousedown", e => { if (e.button === 0) input.action = true; });

/* mobil joystick */
const joyZone = document.getElementById("joy-zone");
const joyBase = document.getElementById("joy-base");
const joyStick = document.getElementById("joy-stick");
let joyId = null, joyOX = 0, joyOY = 0;
joyZone.addEventListener("touchstart", e => {
  input.isTouch = true; const t = e.changedTouches[0]; joyId = t.identifier;
  joyOX = t.clientX; joyOY = t.clientY;
  joyBase.style.display = "block";
  joyBase.style.left = (joyOX - 60) + "px"; joyBase.style.top = (joyOY - 60) + "px";
  joyBase.style.bottom = "auto";
  input.joyActive = true; e.preventDefault();
}, { passive: false });
joyZone.addEventListener("touchmove", e => {
  for (const t of e.changedTouches) if (t.identifier === joyId) {
    let dx = t.clientX - joyOX, dy = t.clientY - joyOY;
    const mag = Math.hypot(dx, dy), max = 55;
    if (mag > max) { dx = dx / mag * max; dy = dy / mag * max; }
    joyStick.style.transform = `translate(${dx}px,${dy}px)`;
    if (mag > 6) { input.joyX = dx / max; input.joyY = dy / max; input.joyAng = Math.atan2(dy, dx); }
    else { input.joyX = 0; input.joyY = 0; }
  }
  e.preventDefault();
}, { passive: false });
function joyEnd(e) {
  for (const t of e.changedTouches) if (t.identifier === joyId) {
    joyId = null; input.joyActive = false; input.joyX = 0; input.joyY = 0;
    joyBase.style.display = "none"; joyStick.style.transform = "";
  }
}
joyZone.addEventListener("touchend", joyEnd);
joyZone.addEventListener("touchcancel", joyEnd);

function bindBtn(id, onDown, hold) {
  const el = document.getElementById(id);
  el.addEventListener("touchstart", e => { input.isTouch = true; if (hold) el._held = true; else onDown(); e.preventDefault(); }, { passive: false });
  el.addEventListener("touchend", e => { if (hold) el._held = false; e.preventDefault(); }, { passive: false });
  el.addEventListener("mousedown", e => { if (hold) el._held = true; else onDown(); e.preventDefault(); });
  el.addEventListener("mouseup", () => { if (hold) el._held = false; });
  return el;
}
bindBtn("btn-action", () => input.action = true);
bindBtn("btn-fire", () => input.fire = true);
bindBtn("btn-eat", () => input.eat = true);
const sprintBtn = bindBtn("btn-sprint", null, true);

/* ----------------------- GAME STATE ----------------------- */
let state;
function newState() {
  return {
    running: false, paused: false, over: false, won: false,
    time: 0.16,             // gün başlangıcı (sabah)
    day: 1,
    elapsed: 0,
    player: {
      x: CFG.WORLD / 2, y: CFG.WORLD / 2, vx: 0, vy: 0, facing: -Math.PI / 2,
      health: 100, hunger: 100, warmth: 100, sanity: 100, stamina: 100,
      swingCd: 0, swingT: 0, hurtFlash: 0, stepT: 0, sick: 0,
    },
    inv: { wood: 8, raw: 0, cooked: 2, berry: 0 },
    trees: [], decor: [], animals: [], fires: [], particles: [],
    cookT: 0,
    watcher: { active: false, x: 0, y: 0, seen: 0, life: 0, cd: 8, encounters: 0, alpha: 0, scale: 1 },
    jump: { t: 0, face: 0 },     // aktif jumpscare
    jumpCd: 12, firstNightDone: false, scriptedScareDay: 0,
    heart: 0, heartLevel: 0,
    shake: 0, distort: 0,
    deathReason: "",
    fireCrackleT: 0,
  };
}

/* ----------------------- WORLD GEN ----------------------- */
function genWorld() {
  const W = CFG.WORLD, p = state.player;
  state.trees.length = 0; state.decor.length = 0; state.animals.length = 0;
  state.fires.length = 0; state.particles.length = 0;

  for (let i = 0; i < CFG.TREES; i++) {
    const x = rnd(60, W - 60), y = rnd(60, W - 60);
    if (dist(x, y, p.x, p.y) < 160) { i--; continue; }   // başlangıç açıklığı
    state.trees.push({
      x, y, r: rnd(16, 30), hp: 4, maxhp: 4, stump: 0,
      tall: rnd(70, 130), kind: choice(["jungle", "jungle", "palm", "kapok"]),
      sway: Math.random() * Math.PI * 2,
    });
  }
  for (let i = 0; i < CFG.DECOR; i++) {
    state.decor.push({
      x: rnd(20, W - 20), y: rnd(20, W - 20),
      type: choice(["bush", "bush", "fern", "rock", "berry", "vine", "flower"]),
      r: rnd(8, 20), s: Math.random() * Math.PI * 2,
      berries: 3,
    });
  }
  for (let i = 0; i < CFG.PREY; i++) spawnPrey();
}
function spawnPrey() {
  const W = CFG.WORLD;
  state.animals.push({
    x: rnd(40, W - 40), y: rnd(40, W - 40),
    type: choice(["capybara", "deer", "tapir", "boar"]),
    hp: 5, state: "wander", vx: 0, vy: 0, t: rnd(0, 3),
    dir: rnd(0, Math.PI * 2), hostile: false, atkCd: 0,
  });
}
function spawnJaguar() {
  const p = state.player, a = rnd(0, Math.PI * 2), d = rnd(500, 760);
  state.animals.push({
    x: clamp(p.x + Math.cos(a) * d, 40, CFG.WORLD - 40),
    y: clamp(p.y + Math.sin(a) * d, 40, CFG.WORLD - 40),
    type: "jaguar", hp: 14, state: "stalk", vx: 0, vy: 0, t: 0,
    dir: 0, hostile: true, atkCd: 0,
  });
}

/* ----------------------- HELPERS: time/dark ----------------------- */
function darknessFor(t) {
  // t: 0..1
  if (t < 0.05) return lerp(0.86, 0.82, t / 0.05);
  if (t < 0.20) return lerp(0.82, 0.0, (t - 0.05) / 0.15);
  if (t < 0.54) return 0.0;
  if (t < 0.70) return lerp(0.0, 0.86, (t - 0.54) / 0.16);
  return 0.88;
}
function isNight() { return state.time >= 0.68 || state.time < 0.07; }
function phaseInfo(t) {
  if (t < 0.07) return ["🌑", "Gece"];
  if (t < 0.20) return ["🌅", "Şafak"];
  if (t < 0.45) return ["☀️", "Gündüz"];
  if (t < 0.54) return ["🌤️", "Öğle"];
  if (t < 0.68) return ["🌆", "Akşam"];
  return ["🌑", "Gece"];
}

/* ----------------------- TOASTS / UI ----------------------- */
const toastsEl = document.getElementById("toasts");
function toast(text, cls) {
  const d = document.createElement("div");
  d.className = "toast" + (cls ? " " + cls : "");
  d.textContent = text;
  toastsEl.appendChild(d);
  setTimeout(() => d.remove(), 2500);
}
const whisperEl = document.getElementById("whisper");
let whisperT = 0;
function whisperText(t) { whisperEl.textContent = t; whisperT = 2.2; }

/* ----------------------- ACTIONS ----------------------- */
function findTarget() {
  const p = state.player; let best = null, bestD = CFG.CHOP_RANGE * CFG.CHOP_RANGE;
  // ağaçlar
  for (const tr of state.trees) {
    if (tr.stump > 0) continue;
    const d = dist2(p.x, p.y, tr.x, tr.y);
    if (d < bestD && Math.abs(angDiff(angTo(p.x, p.y, tr.x, tr.y), p.facing)) < CFG.CHOP_CONE) {
      best = { kind: "tree", obj: tr }; bestD = d;
    }
  }
  // hayvanlar
  for (const an of state.animals) {
    const d = dist2(p.x, p.y, an.x, an.y);
    if (d < bestD && Math.abs(angDiff(angTo(p.x, p.y, an.x, an.y), p.facing)) < CFG.CHOP_CONE) {
      best = { kind: "animal", obj: an }; bestD = d;
    }
  }
  // çalı meyvesi
  for (const dc of state.decor) {
    if (dc.type !== "berry" || dc.berries <= 0) continue;
    const d = dist2(p.x, p.y, dc.x, dc.y);
    if (d < bestD && d < 60 * 60) { best = { kind: "berry", obj: dc }; bestD = d; }
  }
  return best;
}
function doAction() {
  const p = state.player;
  if (p.swingCd > 0) return;
  const t = findTarget();
  if (!t) { return; }
  p.swingCd = 0.38; p.swingT = 0.2; p.stamina = clamp(p.stamina - 4, 0, 100);
  if (t.kind === "berry") {
    state.inv.berry += t.obj.berries; toast("🫐 +" + t.obj.berries + " yaban mersini", "good");
    t.obj.berries = 0; t.obj.regrow = 40; Sound.step(); return;
  }
  if (t.kind === "tree") {
    Sound.chop();
    const tr = t.obj; tr.hp--; state.inv.wood++;
    spawnChips(tr.x, tr.y, "#c9a25b");
    if (tr.hp <= 0) { tr.stump = 95; tr.hp = tr.maxhp; state.inv.wood += 2; toast("🪵 Ağaç devrildi (+3)", "good"); }
    return;
  }
  if (t.kind === "animal") {
    Sound.chop();
    const an = t.obj; an.hp -= 3; spawnChips(an.x, an.y, "#7a1d1d");
    if (an.type === "boar" || an.type === "jaguar") { an.hostile = true; an.state = "chase"; }
    else { an.state = "flee"; an.dir = angTo(p.x, p.y, an.x, an.y); }
    if (an.hp <= 0) killAnimal(an);
    return;
  }
}
function killAnimal(an) {
  const yield_ = an.type === "jaguar" ? rndi(5, 7) : an.type === "tapir" ? rndi(3, 5) : rndi(2, 4);
  state.inv.raw += yield_;
  toast("🥩 +" + yield_ + " çiğ et (" + nameTR(an.type) + ")", "good");
  spawnChips(an.x, an.y, "#7a1d1d", 14);
  const i = state.animals.indexOf(an); if (i >= 0) state.animals.splice(i, 1);
  // av dengesi: birini geri ekle (gündüz)
  if (an.type !== "jaguar") setTimeout(() => { if (state.running && state.animals.length < CFG.PREY) spawnPrey(); }, 8000);
}
function nameTR(t) {
  return { capybara: "kapibara", deer: "geyik", tapir: "tapir", boar: "yaban domuzu", jaguar: "jaguar" }[t] || t;
}
function doFire() {
  const p = state.player;
  // yakındaki ateşe odun ekle
  let near = null, nd = 130 * 130;
  for (const f of state.fires) { const d = dist2(p.x, p.y, f.x, f.y); if (d < nd) { nd = d; near = f; } }
  if (near) {
    if (state.inv.wood <= 0) { toast("Odun yok"); return; }
    const add = Math.min(state.inv.wood, 5); state.inv.wood -= add;
    near.fuel = Math.min(near.fuel + add * 14, near.max); toast("🔥 Ateşe odun eklendi", "good");
    return;
  }
  if (state.inv.wood < 5) { toast("Ateş için 5 odun lazım (" + state.inv.wood + ")", "bad"); return; }
  state.inv.wood -= 5;
  const fx = p.x + Math.cos(p.facing) * 46, fy = p.y + Math.sin(p.facing) * 46;
  state.fires.push({ x: fx, y: fy, fuel: 70, max: 140 });
  toast("🔥 Kamp ateşi yakıldı!", "good");
}
function doEat() {
  const p = state.player, inv = state.inv;
  if (inv.cooked > 0) { inv.cooked--; p.hunger = clamp(p.hunger + 45, 0, 100); toast("🍗 Pişmiş et yedin (+45)", "good"); }
  else if (inv.berry > 0) { inv.berry--; p.hunger = clamp(p.hunger + 12, 0, 100); p.sanity = clamp(p.sanity + 3, 0, 100); toast("🫐 Yaban mersini yedin (+12)", "good"); }
  else if (inv.raw > 0) {
    inv.raw--; p.hunger = clamp(p.hunger + 18, 0, 100);
    if (Math.random() < 0.45) { p.health = clamp(p.health - 12, 0, 100); p.sanity = clamp(p.sanity - 4, 0, 100); p.sick = 3; toast("🤢 Çiğ et seni hasta etti!", "bad"); }
    else toast("🥩 Çiğ et yedin (+18)", "good");
  } else toast("Yiyecek yok!", "bad");
}

/* particles */
function spawnChips(x, y, col, n = 7) {
  for (let i = 0; i < n; i++) state.particles.push({
    x, y, vx: rnd(-60, 60), vy: rnd(-90, 10), life: rnd(0.4, 0.9), col, r: rnd(1.5, 3.5),
  });
}

/* ----------------------- JUMPSCARE ----------------------- */
function jumpscare(face, sanityHit, healthHit) {
  state.jump.t = 0.85; state.jump.face = face != null ? face : rndi(0, 2);
  state.shake = Math.max(state.shake, 18);
  state.player.sanity = clamp(state.player.sanity - (sanityHit || 12), 0, 100);
  if (healthHit) { state.player.health = clamp(state.player.health - healthHit, 0, 100); state.player.hurtFlash = 0.4; if (state.player.health <= 0) die("kalp krizi"); }
  Sound.screech();
}

/* ----------------------- WATCHER (İzleyen) ----------------------- */
function spawnWatcher(near) {
  const p = state.player;
  const a = rnd(0, Math.PI * 2);
  const d = near ? rnd(140, 230) : rnd(300, 430);
  let wx = clamp(p.x + Math.cos(a) * d, 30, CFG.WORLD - 30);
  let wy = clamp(p.y + Math.sin(a) * d, 30, CFG.WORLD - 30);
  // mümkünse bir ağacın yanına koy ("ağacın arkasından izleyen")
  let bt = null, bd = 1e9;
  for (const tr of state.trees) { if (tr.stump > 0) continue; const dd = dist2(wx, wy, tr.x, tr.y); if (dd < bd) { bd = dd; bt = tr; } }
  if (bt && bd < 220 * 220) { wx = bt.x + rnd(-14, 14); wy = bt.y + 4; }
  const w = state.watcher;
  w.active = true; w.x = wx; w.y = wy; w.seen = 0; w.life = rnd(7, 14); w.alpha = 0;
  Sound.whisper();
  if (Math.random() < 0.5) whisperText(choice(["arkanda...", "seni görüyor", "kaçma", "100 gün... olmayacak"]));
}
function vanishWatcher(quiet) {
  const w = state.watcher;
  w.active = false; w.cd = rnd(9, 22) - Math.min(state.day * 0.05, 6);
  if (!quiet) { Sound.whoosh(); whisperText("..."); }
}
function updateWatcher(dt) {
  const w = state.watcher, p = state.player;
  if (!w.active) {
    w.cd -= dt;
    if (w.cd <= 0) {
      const night = isNight();
      // gece yüksek, gündüz düşük şans ("bazı günler ağacın arkasından izler")
      let chance = night ? 0.9 : 0.10;
      chance *= (1 + (1 - p.sanity / 100));        // düşük akıl → daha sık
      if (!state.firstNightDone && night && state.day >= 1) chance = 1; // ilk gece garanti
      if (Math.random() < chance) { spawnWatcher(false); if (night) state.firstNightDone = true; }
      else w.cd = rnd(4, 9);
    }
    return;
  }
  // aktif
  w.alpha = Math.min(w.alpha + dt * 1.5, 1);
  const d = dist(p.x, p.y, w.x, w.y);
  const aim = Math.abs(angDiff(angTo(p.x, p.y, w.x, w.y), p.facing));
  const looking = aim < 0.52 && d < 760;   // ~30°
  if (looking) {
    w.seen += dt;
    if (w.seen > 0.32) {
      // BAKINCA KAYBOLUR
      vanishWatcher(false);
      p.sanity = clamp(p.sanity - 6, 0, 100);
      w.encounters++;
      return;
    }
  } else {
    w.seen = Math.max(0, w.seen - dt * 0.6);
    // bakmıyorsan akıl sağlığını emer
    const drain = map(d, 70, 430, 16, 1.5);
    p.sanity = clamp(p.sanity - drain * dt, 0, 100);
  }
  w.life -= dt;
  if (d > 950) { vanishWatcher(true); w.cd = rnd(5, 10); return; }
  if (w.life <= 0) {
    if (d < 165 && p.sanity < 45) {
      // SALDIRI / yakın jumpscare
      jumpscare(0, 18, 9); vanishWatcher(true); w.cd = rnd(18, 30);
    } else if (Math.random() < 0.55) {
      // yeniden konumlan (daha yakına) — tüyler ürpertici
      spawnWatcher(true); whisperText(choice(["daha yakın", "kıpırdama", "arkanda"]));
    } else vanishWatcher(true);
  }
}

/* ----------------------- DEATH / WIN ----------------------- */
function die(reason) {
  if (state.over) return;
  state.over = true; state.running = false; state.deathReason = reason;
  Sound.screech();
  setTimeout(() => {
    document.getElementById("deathReason").textContent = "Sebep: " + reason;
    document.getElementById("daysSurvived").textContent = state.day;
    document.getElementById("gameover").classList.remove("hidden");
  }, 700);
}
function winGame() {
  state.won = true; state.running = false;
  document.getElementById("win").classList.remove("hidden");
}

/* ----------------------- UPDATE ----------------------- */
function update(dt) {
  const p = state.player;

  /* --- zaman / gün --- */
  state.time += dt / CFG.DAY_LENGTH;
  if (state.time >= 1) {
    state.time -= 1; state.day++;
    state.firstNightDone = false;
    if (state.day > CFG.WIN_DAY) { winGame(); return; }
    toast("☀️ GÜN " + state.day + " başladı", "good");
    // bazı günler gündüz de izleyen belirir
    if (Math.random() < 0.5) state.watcher.cd = rnd(20, 80);
  }
  const night = isNight();

  /* --- hareket --- */
  let ix = 0, iy = 0;
  if (keys["w"] || keys["arrowup"]) iy -= 1;
  if (keys["s"] || keys["arrowdown"]) iy += 1;
  if (keys["a"] || keys["arrowleft"]) ix -= 1;
  if (keys["d"] || keys["arrowright"]) ix += 1;
  if (input.joyActive) { ix = input.joyX; iy = input.joyY; }
  const mag = Math.hypot(ix, iy);
  if (mag > 1) { ix /= mag; iy /= mag; }

  const sprinting = (input.sprintHeld || sprintBtn._held) && p.stamina > 1 && mag > 0.1;
  let spd = CFG.PLAYER_SPEED * (sprinting ? CFG.SPRINT_MULT : 1);
  if (p.hunger <= 0 || p.warmth <= 0) spd *= 0.62;
  p.x = clamp(p.x + ix * spd * dt, 20, CFG.WORLD - 20);
  p.y = clamp(p.y + iy * spd * dt, 20, CFG.WORLD - 20);

  // ağaç çarpışması (it dışarı)
  for (const tr of state.trees) {
    if (tr.stump > 0) continue;
    const rr = tr.r + 16, d = dist(p.x, p.y, tr.x, tr.y);
    if (d < rr && d > 0.001) { const a = angTo(tr.x, tr.y, p.x, p.y); p.x = tr.x + Math.cos(a) * rr; p.y = tr.y + Math.sin(a) * rr; }
  }

  // bakış yönü
  if (input.joyActive && mag > 0.1) p.facing = input.joyAng;
  else if (input.isTouch && (input.joyX || input.joyY)) p.facing = input.joyAng;
  else if (!input.isTouch && input.mouseActive) {
    p.facing = angTo(VW / 2, VH / 2, input.mx, input.my);
  } else if (mag > 0.1) p.facing = Math.atan2(iy, ix);

  // adım sesi
  if (mag > 0.1) { p.stepT -= dt; if (p.stepT <= 0) { Sound.step(); p.stepT = sprinting ? 0.28 : 0.42; } }

  // stamina
  if (sprinting) p.stamina = clamp(p.stamina - 18 * dt, 0, 100);
  else p.stamina = clamp(p.stamina + 12 * dt, 0, 100);

  if (p.swingCd > 0) p.swingCd -= dt;
  if (p.swingT > 0) p.swingT -= dt;
  if (p.hurtFlash > 0) p.hurtFlash -= dt;
  if (p.sick > 0) p.sick -= dt;

  /* --- girdi kenar tetikleri --- */
  if (input.action) { input.action = false; doAction(); }
  if (input.fire) { input.fire = false; doFire(); }
  if (input.eat) { input.eat = false; doEat(); }

  /* --- ateşler --- */
  let nearFire = false, fireDist = 1e9;
  for (let i = state.fires.length - 1; i >= 0; i--) {
    const f = state.fires[i];
    f.fuel -= dt * (night ? 2.4 : 3.2);
    if (f.fuel <= 0) { state.fires.splice(i, 1); toast("🪵 Ateş söndü", "bad"); continue; }
    const d = dist(p.x, p.y, f.x, f.y);
    if (d < 150) { nearFire = true; fireDist = Math.min(fireDist, d); }
  }
  // ateş kıvılcım sesi
  if (nearFire) { state.fireCrackleT -= dt; if (state.fireCrackleT <= 0) { Sound.crackle(); state.fireCrackleT = rnd(0.08, 0.3); } }

  // pişirme
  if (nearFire && fireDist < 120 && state.inv.raw > 0) {
    state.cookT += dt;
    if (state.cookT >= 3.5) { state.cookT = 0; state.inv.raw--; state.inv.cooked++; toast("🍗 Et pişti", "good"); }
  } else state.cookT = 0;

  /* --- hayatta kalma istatistikleri --- */
  p.hunger = clamp(p.hunger - 0.42 * dt, 0, 100);

  if (nearFire) p.warmth = clamp(p.warmth + 9 * dt, 0, 100);
  else if (night) p.warmth = clamp(p.warmth - 1.25 * dt, 0, 100);
  else p.warmth = clamp(p.warmth - 0.18 * dt, 0, 100);

  // akıl sağlığı (izleyen aktifken updateWatcher ayrıca düşürür)
  if (nearFire) p.sanity = clamp(p.sanity + (night ? 1.0 : 2.2) * dt, 0, 100);
  else if (night) p.sanity = clamp(p.sanity - 0.85 * dt, 0, 100);
  else p.sanity = clamp(p.sanity + 0.3 * dt, 0, 100);

  // sağlık
  let dmg = 0, cause = "";
  if (p.hunger <= 0) { dmg += 2.0; cause = "açlık"; }
  if (p.warmth <= 0) { dmg += 1.5; cause = "soğuk"; }
  if (p.sanity <= 0) { dmg += 2.5; cause = "delirme"; }
  if (dmg > 0) { p.health = clamp(p.health - dmg * dt, 0, 100); state.deathReason = cause; }
  else if (p.hunger > 40 && p.warmth > 40 && p.sanity > 25 && p.sick <= 0) p.health = clamp(p.health + 0.8 * dt, 0, 100);
  if (p.health <= 0) { die(state.deathReason || "bilinmeyen"); return; }

  /* --- korku yönetimi --- */
  updateWatcher(dt);

  // jumpscare zamanlayıcısı
  state.jumpCd -= dt;
  if (state.jump.t <= 0 && state.jumpCd <= 0 && night) {
    const pSec = 0.02 + (1 - p.sanity / 100) * 0.07;
    if (Math.random() < pSec) { jumpscare(null, 11, 0); state.jumpCd = rnd(16, 38); }
  }
  // ilk gece garantili korkutma (kullanıcıya hemen korku tattır)
  if (night && state.day === 1 && !state.scriptedScareDay && state.time > 0.80) {
    state.scriptedScareDay = 1; setTimeout(() => { if (state.running) jumpscare(1, 10, 0); }, rndi(3000, 8000));
  }

  if (state.jump.t > 0) state.jump.t -= dt;

  /* --- gece jaguarı (gerçek tehlike) --- */
  if (night && Math.random() < 0.0008 * dt * 60 && state.animals.filter(a => a.type === "jaguar").length < 2 && state.day > 1) {
    spawnJaguar(); Sound.growl(); whisperText("bir hırıltı...");
  }

  /* --- hayvanlar --- */
  updateAnimals(dt, nearFire);

  /* --- decor regrow (meyve) --- */
  for (const dc of state.decor) if (dc.regrow > 0) { dc.regrow -= dt; if (dc.regrow <= 0) dc.berries = 3; }
  // ağaç regrow
  for (const tr of state.trees) if (tr.stump > 0) tr.stump -= dt;

  /* --- partiküller --- */
  for (let i = state.particles.length - 1; i >= 0; i--) {
    const pa = state.particles[i]; pa.life -= dt; if (pa.life <= 0) { state.particles.splice(i, 1); continue; }
    pa.vy += 240 * dt; pa.x += pa.vx * dt; pa.y += pa.vy * dt;
  }

  /* --- kalp atışı yoğunluğu --- */
  let hl = 0;
  if (state.watcher.active) hl = Math.max(hl, map(dist(p.x, p.y, state.watcher.x, state.watcher.y), 80, 500, 1, 0.2));
  hl = Math.max(hl, (1 - p.sanity / 100) * 0.8);
  for (const an of state.animals) if (an.hostile && dist(p.x, p.y, an.x, an.y) < 260) hl = Math.max(hl, 0.7);
  state.heartLevel = lerp(state.heartLevel, hl, 0.1);
  if (state.heartLevel > 0.16) {
    state.heart -= dt;
    const interval = lerp(1.1, 0.32, state.heartLevel);
    if (state.heart <= 0) { Sound.thump(); state.heart = interval; }
  }

  /* --- ekran sarsıntısı / bozulma --- */
  if (state.shake > 0) state.shake = Math.max(0, state.shake - dt * 30);
  state.distort = lerp(state.distort, (1 - p.sanity / 100), 0.05);
  if (whisperT > 0) whisperT -= dt;

  updateHUD(night);
}

function updateAnimals(dt, nearFire) {
  const p = state.player, W = CFG.WORLD;
  for (let i = state.animals.length - 1; i >= 0; i--) {
    const an = state.animals[i];
    const d = dist(p.x, p.y, an.x, an.y);
    if (an.atkCd > 0) an.atkCd -= dt;

    if (an.type === "jaguar") {
      // ateşten korkar
      let fleeFire = false;
      for (const f of state.fires) if (dist(an.x, an.y, f.x, f.y) < 150) fleeFire = true;
      if (fleeFire) { an.dir = angTo(state.fires[0].x, state.fires[0].y, an.x, an.y); an.state = "flee"; }
      else if (d < 360) { an.state = "chase"; an.dir = angTo(an.x, an.y, p.x, p.y); }
      const sp = an.state === "chase" ? 195 : 90;
      an.x = clamp(an.x + Math.cos(an.dir) * sp * dt, 10, W - 10);
      an.y = clamp(an.y + Math.sin(an.dir) * sp * dt, 10, W - 10);
      if (d < 48 && an.atkCd <= 0) { p.health = clamp(p.health - 11, 0, 100); p.hurtFlash = 0.45; an.atkCd = 1.2; state.shake = 10; Sound.growl(); state.deathReason = "jaguar saldırısı"; if (p.health <= 0) { die("jaguar saldırısı"); return; } }
      // gündüz gelince kaçar
      if (!isNight() && d > 500) { state.animals.splice(i, 1); continue; }
      continue;
    }

    if (an.type === "boar" && an.hostile) {
      an.dir = angTo(an.x, an.y, p.x, p.y);
      an.x = clamp(an.x + Math.cos(an.dir) * 150 * dt, 10, W - 10);
      an.y = clamp(an.y + Math.sin(an.dir) * 150 * dt, 10, W - 10);
      if (d < 42 && an.atkCd <= 0) { p.health = clamp(p.health - 7, 0, 100); p.hurtFlash = 0.4; an.atkCd = 1.4; state.shake = 8; state.deathReason = "yaban domuzu"; if (p.health <= 0) { die("yaban domuzu saldırısı"); return; } }
      if (d > 600) { an.hostile = false; an.state = "wander"; }
      continue;
    }

    // av: yaklaşınca kaç
    if (d < 175 && an.state !== "flee") { an.state = "flee"; an.dir = angTo(p.x, p.y, an.x, an.y) + rnd(-0.4, 0.4); }
    if (an.state === "flee") {
      an.x = clamp(an.x + Math.cos(an.dir) * 135 * dt, 10, W - 10);
      an.y = clamp(an.y + Math.sin(an.dir) * 135 * dt, 10, W - 10);
      if (d > 360) an.state = "wander";
    } else {
      an.t -= dt;
      if (an.t <= 0) { an.t = rnd(1.5, 4); an.dir = rnd(0, Math.PI * 2); an.moving = Math.random() < 0.6; }
      if (an.moving) { an.x = clamp(an.x + Math.cos(an.dir) * 38 * dt, 10, W - 10); an.y = clamp(an.y + Math.sin(an.dir) * 38 * dt, 10, W - 10); }
    }
  }
}

/* ----------------------- HUD UPDATE ----------------------- */
const $ = id => document.getElementById(id);
const elBars = { health: $("bar-health"), hunger: $("bar-hunger"), warmth: $("bar-warmth"), sanity: $("bar-sanity"), stamina: $("bar-stamina") };
const elInv = { wood: $("inv-wood"), raw: $("inv-raw"), cooked: $("inv-cooked"), berry: $("inv-berry") };
const promptEl = $("prompt");
function updateHUD(night) {
  const p = state.player;
  $("dayNum").textContent = state.day;
  const [ic, tx] = phaseInfo(state.time);
  $("phaseIcon").textContent = ic; $("phaseText").textContent = tx;
  elBars.health.style.width = p.health + "%";
  elBars.hunger.style.width = p.hunger + "%";
  elBars.warmth.style.width = p.warmth + "%";
  elBars.sanity.style.width = p.sanity + "%";
  elBars.stamina.style.width = p.stamina + "%";
  elInv.wood.textContent = state.inv.wood;
  elInv.raw.textContent = state.inv.raw;
  elInv.cooked.textContent = state.inv.cooked;
  elInv.berry.textContent = state.inv.berry;

  // prompt
  const t = findTarget();
  const key = input.isTouch ? "VUR" : "[E]";
  if (t) {
    let txt = "";
    if (t.kind === "tree") txt = "🪓 Odun kes " + key;
    else if (t.kind === "berry") txt = "🫐 Topla " + key;
    else txt = "⚔️ " + (t.obj.hostile ? "Savaş " : "Avla ") + key;
    promptEl.textContent = txt; promptEl.classList.remove("hidden");
  } else promptEl.classList.add("hidden");

  // pusula -> en yakın ateş
  let nf = null, nd = 1e9;
  for (const f of state.fires) { const d = dist2(p.x, p.y, f.x, f.y); if (d < nd) { nd = d; nf = f; } }
  const comp = $("compass");
  if (nf && Math.sqrt(nd) > 380) {
    const a = angTo(p.x, p.y, nf.x, nf.y);
    const arrows = ["→", "↘", "↓", "↙", "←", "↖", "↑", "↗"];
    $("compassArrow").textContent = arrows[(Math.round(a / (Math.PI / 4)) + 8) % 8];
    $("compassDist").textContent = Math.round(Math.sqrt(nd)) + "m";
    comp.classList.remove("hidden");
  } else comp.classList.add("hidden");

  // whisper text opacity
  whisperEl.style.color = "rgba(180,20,20," + clamp(whisperT / 2.2, 0, 1) * 0.85 + ")";
}

/* ----------------------- RENDER ----------------------- */
let camX = 0, camY = 0;
function render() {
  const p = state.player;
  camX = p.x - VW / 2; camY = p.y - VH / 2;
  let sx = 0, sy = 0;
  if (state.shake > 0) { sx = rnd(-state.shake, state.shake); sy = rnd(-state.shake, state.shake); }

  ctx.save();
  ctx.translate(sx, sy);

  // zemin (orman tabanı)
  const dk = darknessFor(state.time);
  const baseL = lerp(0.0, 1, 1 - dk);
  ctx.fillStyle = "#0c1410";
  ctx.fillRect(-sx, -sy, VW, VH);
  drawGroundTexture();

  // toplanabilir görünür nesneleri y'ye göre sırala
  const drawList = [];
  for (const dc of state.decor) drawList.push({ y: dc.y, t: "decor", o: dc });
  for (const f of state.fires) drawList.push({ y: f.y, t: "fire", o: f });
  for (const an of state.animals) drawList.push({ y: an.y, t: "animal", o: an });
  for (const tr of state.trees) drawList.push({ y: tr.y, t: "tree", o: tr });
  // izleyen
  if (state.watcher.active) drawList.push({ y: state.watcher.y, t: "watcher", o: state.watcher });
  // oyuncu
  drawList.push({ y: p.y, t: "player", o: p });
  drawList.sort((a, b) => a.y - b.y);

  for (const it of drawList) {
    const ox = it.o.x - camX, oy = it.o.y - camY;
    if (ox < -160 || ox > VW + 160 || oy < -200 || oy > VH + 200) continue;
    switch (it.t) {
      case "decor": drawDecor(it.o, ox, oy); break;
      case "fire": drawFire(it.o, ox, oy); break;
      case "animal": drawAnimal(it.o, ox, oy); break;
      case "tree": drawTree(it.o, ox, oy); break;
      case "watcher": drawWatcher(it.o, ox, oy); break;
      case "player": drawPlayer(p, ox, oy); break;
    }
  }

  // partiküller
  for (const pa of state.particles) {
    ctx.globalAlpha = clamp(pa.life * 1.5, 0, 1); ctx.fillStyle = pa.col;
    ctx.fillRect(pa.x - camX - pa.r, pa.y - camY - pa.r, pa.r * 2, pa.r * 2);
  }
  ctx.globalAlpha = 1;

  ctx.restore();

  // ====== AYDINLATMA / KARANLIK ======
  if (dk > 0.02) {
    lctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    lctx.clearRect(0, 0, VW, VH);
    lctx.fillStyle = "rgba(2,4,6," + dk + ")";
    lctx.fillRect(0, 0, VW, VH);
    lctx.globalCompositeOperation = "destination-out";
    // oyuncu görüş ışığı (gece dar)
    const pr = lerp(190, 95, dk);
    radialHole(VW / 2 + sx, VH / 2 + sy, pr);
    // ateş ışıkları
    for (const f of state.fires) {
      const fx = f.x - camX + sx, fy = f.y - camY + sy;
      const fr = map(f.fuel, 0, f.max, 90, 340) * (0.92 + Math.sin(performance.now() / 90) * 0.08);
      radialHole(fx, fy, fr);
    }
    lctx.globalCompositeOperation = "source-over";
    ctx.drawImage(lightCanvas, 0, 0, VW, VH);
    // gece mavi sis
    ctx.fillStyle = "rgba(10,16,40," + dk * 0.25 + ")";
    ctx.fillRect(0, 0, VW, VH);
  }

  // ateş sıcak parıltısı (gece)
  if (dk > 0.3) for (const f of state.fires) {
    const fx = f.x - camX + sx, fy = f.y - camY + sy;
    const fr = map(f.fuel, 0, f.max, 60, 260);
    const g = ctx.createRadialGradient(fx, fy, 0, fx, fy, fr);
    g.addColorStop(0, "rgba(255,150,40,0.28)"); g.addColorStop(1, "rgba(255,120,20,0)");
    ctx.fillStyle = g; ctx.fillRect(fx - fr, fy - fr, fr * 2, fr * 2);
  }

  // vignette + akıl bozulması
  drawVignette();
  if (state.distort > 0.25) drawDistortion();
  if (p.hurtFlash > 0) { ctx.fillStyle = "rgba(180,0,0," + p.hurtFlash * 0.5 + ")"; ctx.fillRect(0, 0, VW, VH); }

  // izleyen yakınsa ekran kenarı kararması
  if (state.watcher.active) {
    const d = dist(p.x, p.y, state.watcher.x, state.watcher.y);
    const a = map(d, 80, 500, 0.5, 0);
    if (a > 0.02) { ctx.fillStyle = "rgba(40,0,0," + a + ")"; ctx.fillRect(0, 0, VW, VH); }
  }

  // JUMPSCARE
  if (state.jump.t > 0) drawJumpscare();
}

function radialHole(x, y, r) {
  const g = lctx.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, "rgba(0,0,0,1)"); g.addColorStop(0.6, "rgba(0,0,0,0.85)"); g.addColorStop(1, "rgba(0,0,0,0)");
  lctx.fillStyle = g; lctx.beginPath(); lctx.arc(x, y, r, 0, Math.PI * 2); lctx.fill();
}

function drawGroundTexture() {
  // basit, hafif desen (ızgara nokta)
  const step = 64;
  const ox = -((camX % step) + step) % step, oy = -((camY % step) + step) % step;
  ctx.fillStyle = "rgba(255,255,255,0.015)";
  for (let x = ox; x < VW; x += step) for (let y = oy; y < VH; y += step) ctx.fillRect(x, y, 2, 2);
  ctx.strokeStyle = "rgba(20,40,28,0.25)";
}

function drawTree(tr, x, y) {
  if (tr.stump > 0) {
    ctx.fillStyle = "#3a2a16"; ctx.beginPath(); ctx.arc(x, y, tr.r * 0.6, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#23170c"; ctx.beginPath(); ctx.arc(x, y, tr.r * 0.4, 0, Math.PI * 2); ctx.fill();
    return;
  }
  // gölge
  ctx.fillStyle = "rgba(0,0,0,0.28)"; ctx.beginPath(); ctx.ellipse(x, y + 4, tr.r * 1.1, tr.r * 0.5, 0, 0, Math.PI * 2); ctx.fill();
  // gövde
  ctx.fillStyle = "#4a3420"; ctx.fillRect(x - tr.r * 0.28, y - tr.tall * 0.5, tr.r * 0.56, tr.tall * 0.5);
  // yaprak kümesi
  const sway = Math.sin(performance.now() / 1400 + tr.sway) * 4;
  const cy = y - tr.tall * 0.5;
  if (tr.kind === "palm") {
    ctx.strokeStyle = "#1f5a2a"; ctx.lineWidth = 6;
    for (let i = 0; i < 7; i++) { const a = (i / 7) * Math.PI * 2; ctx.beginPath(); ctx.moveTo(x + sway, cy); ctx.lineTo(x + sway + Math.cos(a) * tr.r * 2.1, cy + Math.sin(a) * tr.r * 1.4); ctx.stroke(); }
  } else {
    const col = tr.kind === "kapok" ? ["#1c4e2a", "#246b34", "#2f7d3f"] : ["#173f22", "#1f5a2f", "#2a6e3a"];
    for (let i = 0; i < 3; i++) {
      ctx.fillStyle = col[i];
      ctx.beginPath(); ctx.arc(x + sway + (i - 1) * tr.r * 0.7, cy - i * tr.r * 0.5, tr.r * (1.5 - i * 0.18), 0, Math.PI * 2); ctx.fill();
    }
    ctx.fillStyle = col[2];
    ctx.beginPath(); ctx.arc(x + sway, cy - tr.r * 0.4, tr.r * 1.3, 0, Math.PI * 2); ctx.fill();
  }
}

function drawDecor(dc, x, y) {
  switch (dc.type) {
    case "bush": ctx.fillStyle = "#1d4d2a"; ctx.beginPath(); ctx.arc(x, y, dc.r, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "#256634"; ctx.beginPath(); ctx.arc(x - dc.r * 0.3, y - dc.r * 0.2, dc.r * 0.6, 0, Math.PI * 2); ctx.fill(); break;
    case "fern": ctx.strokeStyle = "#2e7d44"; ctx.lineWidth = 2;
      for (let i = 0; i < 5; i++) { const a = -Math.PI / 2 + (i - 2) * 0.4; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + Math.cos(a) * dc.r * 1.6, y + Math.sin(a) * dc.r * 1.6); ctx.stroke(); } break;
    case "rock": ctx.fillStyle = "#555b5e"; ctx.beginPath(); ctx.arc(x, y, dc.r, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "#3e4346"; ctx.beginPath(); ctx.arc(x + dc.r * 0.2, y + dc.r * 0.2, dc.r * 0.7, 0, Math.PI * 2); ctx.fill(); break;
    case "berry": ctx.fillStyle = "#1d4d2a"; ctx.beginPath(); ctx.arc(x, y, dc.r, 0, Math.PI * 2); ctx.fill();
      if (dc.berries > 0) { ctx.fillStyle = "#5a3fb0"; for (let i = 0; i < 4; i++) ctx.fillRect(x - dc.r * 0.5 + i * dc.r * 0.35, y - 2, 3, 3); } break;
    case "vine": ctx.strokeStyle = "#2a5a36"; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(x, y - dc.r);
      for (let i = 0; i < 4; i++) ctx.lineTo(x + Math.sin(i * 1.5) * dc.r, y - dc.r + i * dc.r * 0.6); ctx.stroke(); break;
    case "flower": ctx.fillStyle = "#1d4d2a"; ctx.beginPath(); ctx.arc(x, y, dc.r * 0.6, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = choice(["#d94f7a", "#e0c14f", "#c34fd9"]); ctx.beginPath(); ctx.arc(x, y - dc.r * 0.5, 3, 0, Math.PI * 2); ctx.fill(); break;
  }
}

function drawFire(f, x, y) {
  ctx.fillStyle = "#2a1c10";
  for (let i = 0; i < 4; i++) { const a = i / 4 * Math.PI * 2; ctx.save(); ctx.translate(x, y); ctx.rotate(a); ctx.fillRect(-3, -12, 6, 24); ctx.restore(); }
  // alev
  const t = performance.now() / 100;
  const fl = map(f.fuel, 0, f.max, 8, 26);
  for (let i = 0; i < 5; i++) {
    const fx = x + Math.sin(t + i) * 4, fy = y - 6 - i * fl * 0.18;
    ctx.fillStyle = ["#ff3b0a", "#ff7a1a", "#ffb13c", "#ffe07a", "#fff2b0"][i];
    ctx.beginPath(); ctx.ellipse(fx, fy, fl * (1 - i * 0.13), fl * (1.4 - i * 0.12), 0, 0, Math.PI * 2); ctx.fill();
  }
}

function drawAnimal(an, x, y) {
  ctx.fillStyle = "rgba(0,0,0,0.3)"; ctx.beginPath(); ctx.ellipse(x, y + 3, 16, 7, 0, 0, Math.PI * 2); ctx.fill();
  const col = { capybara: "#8a6a44", deer: "#9a7a52", tapir: "#5a4a44", boar: "#4a3a30", jaguar: "#c8902c" }[an.type];
  ctx.fillStyle = col;
  ctx.beginPath(); ctx.ellipse(x, y - 6, an.type === "jaguar" ? 22 : 16, an.type === "jaguar" ? 11 : 10, 0, 0, Math.PI * 2); ctx.fill();
  // baş
  const hd = an.dir || 0, hx = x + Math.cos(hd) * 16, hy = y - 6 + Math.sin(hd) * 6;
  ctx.beginPath(); ctx.arc(hx, hy, 7, 0, Math.PI * 2); ctx.fill();
  if (an.type === "jaguar") {
    // benekler + parlayan gözler
    ctx.fillStyle = "#1c1208"; for (let i = 0; i < 6; i++) ctx.fillRect(x - 14 + i * 5, y - 10 + (i % 2) * 6, 3, 3);
    ctx.fillStyle = "#ffd83a"; ctx.beginPath(); ctx.arc(hx + Math.cos(hd) * 3 - 2, hy - 2, 1.6, 0, 6.3); ctx.arc(hx + Math.cos(hd) * 3 + 2, hy - 2, 1.6, 0, 6.3); ctx.fill();
  }
}

function drawPlayer(p, x, y) {
  ctx.fillStyle = "rgba(0,0,0,0.35)"; ctx.beginPath(); ctx.ellipse(x, y + 6, 13, 6, 0, 0, Math.PI * 2); ctx.fill();
  // vücut
  ctx.fillStyle = "#6b8f4e"; ctx.beginPath(); ctx.arc(x, y, 11, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = "#c8a878"; ctx.beginPath(); ctx.arc(x, y - 6, 7, 0, Math.PI * 2); ctx.fill();
  // yön / balta
  const fx = x + Math.cos(p.facing) * 16, fy = y + Math.sin(p.facing) * 16;
  ctx.strokeStyle = "#3a2a18"; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(fx, fy); ctx.stroke();
  let hx = fx, hy = fy;
  if (p.swingT > 0) { const sw = p.swingT * 8; hx += Math.cos(p.facing + sw) * 6; hy += Math.sin(p.facing + sw) * 6; }
  ctx.fillStyle = "#b8c0c4"; ctx.fillRect(hx - 3, hy - 3, 6, 6);
}

function drawWatcher(w, x, y) {
  ctx.save();
  ctx.globalAlpha = w.alpha * 0.92;
  const h = 130 * w.scale, ww = 20;
  // gövde — uzun, ince, kapkara
  ctx.fillStyle = "#050505";
  ctx.beginPath();
  ctx.moveTo(x - ww * 0.5, y);
  ctx.lineTo(x - ww * 0.3, y - h * 0.7);
  ctx.lineTo(x, y - h);
  ctx.lineTo(x + ww * 0.3, y - h * 0.7);
  ctx.lineTo(x + ww * 0.5, y);
  ctx.closePath(); ctx.fill();
  // uzun kollar
  ctx.strokeStyle = "#070707"; ctx.lineWidth = 5;
  const sway = Math.sin(performance.now() / 600) * 6;
  ctx.beginPath(); ctx.moveTo(x - 6, y - h * 0.62); ctx.lineTo(x - 16 + sway, y - h * 0.05); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(x + 6, y - h * 0.62); ctx.lineTo(x + 16 - sway, y - h * 0.05); ctx.stroke();
  // kafa (beyazımsı, kansız yüz)
  const hy = y - h;
  ctx.fillStyle = "#d8d2c8"; ctx.beginPath(); ctx.ellipse(x, hy, 9, 12, 0, 0, Math.PI * 2); ctx.fill();
  // kanlı gözler (oyuncuya bakar -> kırmızı parıltı)
  ctx.fillStyle = "#000"; ctx.beginPath(); ctx.arc(x - 3.5, hy - 1, 2.6, 0, 6.3); ctx.arc(x + 3.5, hy - 1, 2.6, 0, 6.3); ctx.fill();
  const pulse = 0.5 + Math.sin(performance.now() / 200) * 0.5;
  ctx.fillStyle = "rgba(220,20,20," + (0.5 + pulse * 0.5) + ")";
  ctx.beginPath(); ctx.arc(x - 3.5, hy - 1, 1.3, 0, 6.3); ctx.arc(x + 3.5, hy - 1, 1.3, 0, 6.3); ctx.fill();
  // kan akıntıları
  ctx.strokeStyle = "rgba(140,0,0,0.85)"; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.moveTo(x - 3.5, hy + 1); ctx.lineTo(x - 3, hy + 9); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(x + 3.5, hy + 1); ctx.lineTo(x + 4, hy + 11); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(x, hy + 6); ctx.lineTo(x, hy + 16); ctx.stroke();
  ctx.restore();
}

function drawVignette() {
  const g = ctx.createRadialGradient(VW / 2, VH / 2, Math.min(VW, VH) * 0.3, VW / 2, VH / 2, Math.max(VW, VH) * 0.75);
  g.addColorStop(0, "rgba(0,0,0,0)"); g.addColorStop(1, "rgba(0,0,0,0.7)");
  ctx.fillStyle = g; ctx.fillRect(0, 0, VW, VH);
}
function drawDistortion() {
  const d = state.distort;
  // kırmızı nabız
  const pulse = (Math.sin(performance.now() / 400) * 0.5 + 0.5) * d;
  ctx.fillStyle = "rgba(120,0,0," + pulse * 0.22 + ")"; ctx.fillRect(0, 0, VW, VH);
  // hafif kromatik kayma çizgileri
  if (d > 0.55 && Math.random() < 0.3) {
    ctx.fillStyle = "rgba(200,0,0,0.05)"; ctx.fillRect(rnd(0, VW), 0, 2, VH);
    ctx.fillStyle = "rgba(0,200,200,0.05)"; ctx.fillRect(rnd(0, VW), 0, 2, VH);
  }
}

function drawJumpscare() {
  const t = state.jump.t;
  const flick = Math.random();
  // arka plan
  ctx.fillStyle = flick > 0.5 ? "#120000" : "#3a0000"; ctx.fillRect(0, 0, VW, VH);
  ctx.save();
  const cx = VW / 2 + rnd(-8, 8), cy = VH / 2 + rnd(-8, 8);
  const sc = (Math.min(VW, VH) / 360) * (1 + (0.85 - t) * 0.3);
  ctx.translate(cx, cy); ctx.scale(sc, sc);
  drawScaryFace(state.jump.face);
  ctx.restore();
  // tarama çizgileri
  ctx.fillStyle = "rgba(0,0,0,0.25)";
  for (let y = 0; y < VH; y += 4) ctx.fillRect(0, y + (Math.random() < 0.5 ? 0 : 1), VW, 1);
}
function drawScaryFace(kind) {
  // kafa
  ctx.fillStyle = "#e8e2d6";
  ctx.beginPath(); ctx.ellipse(0, 0, 120, 160, 0, 0, Math.PI * 2); ctx.fill();
  // çökük gölgeler
  ctx.fillStyle = "rgba(40,20,20,0.5)";
  ctx.beginPath(); ctx.ellipse(-55, -10, 35, 50, 0.4, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.ellipse(55, -10, 35, 50, -0.4, 0, Math.PI * 2); ctx.fill();
  // kara göz çukurları
  ctx.fillStyle = "#000";
  ctx.beginPath(); ctx.ellipse(-45, -30, 28, 36, 0, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.ellipse(45, -30, 28, 36, 0, 0, Math.PI * 2); ctx.fill();
  // küçük beyaz bebekler
  if (kind !== 2) {
    ctx.fillStyle = "#fff"; const j = () => rnd(-3, 3);
    ctx.beginPath(); ctx.arc(-45 + j(), -28 + j(), 5, 0, 6.3); ctx.arc(45 + j(), -28 + j(), 5, 0, 6.3); ctx.fill();
  } else {
    ctx.fillStyle = "#ff1a1a"; ctx.beginPath(); ctx.arc(-45, -28, 7, 0, 6.3); ctx.arc(45, -28, 7, 0, 6.3); ctx.fill();
  }
  // gözlerden kan
  ctx.strokeStyle = "#8a0000"; ctx.lineWidth = 5;
  ctx.beginPath(); ctx.moveTo(-45, 6); ctx.lineTo(-42, 120); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(45, 6); ctx.lineTo(50, 130); ctx.stroke();
  // açık çığlık ağzı
  ctx.fillStyle = "#100000";
  ctx.beginPath(); ctx.ellipse(0, 80, 38, 58, 0, 0, Math.PI * 2); ctx.fill();
  // dişler
  ctx.fillStyle = "#d8cfc0";
  for (let i = -3; i <= 3; i++) { ctx.fillRect(i * 10 - 4, 32, 8, 14); ctx.fillRect(i * 10 - 4, 116, 8, 14); }
  // ağızdan kan
  ctx.strokeStyle = "#a00000"; ctx.lineWidth = 6;
  ctx.beginPath(); ctx.moveTo(0, 130); ctx.lineTo(rnd(-6, 6), 175); ctx.stroke();
}

/* ----------------------- LOOP ----------------------- */
let last = 0;
function loop(ts) {
  const dt = last ? Math.min((ts - last) / 1000, 0.05) : 0.016;
  last = ts;
  if (state.running && !state.paused) update(dt);
  render();
  requestAnimationFrame(loop);
}

/* ----------------------- BOOT / MENUS ----------------------- */
function startGame() {
  state = newState();
  genWorld();
  Sound.init(); Sound.resume();
  state.running = true; state.over = false; state.won = false;
  document.getElementById("start").classList.add("hidden");
  document.getElementById("gameover").classList.add("hidden");
  document.getElementById("win").classList.add("hidden");
  document.getElementById("hud").classList.remove("hidden");
  if (input.isTouch || window.innerWidth < 820 || "ontouchstart" in window) document.getElementById("mobile").classList.remove("hidden");
  document.getElementById("pauseBtn").classList.remove("hidden");
  toast("🌴 Amazon'a hoş geldin. Ateşini söndürme...", "good");
  setTimeout(() => toast("🪓 Ağaçtan odun kes, 🔥 ile ateş yak", "good"), 2600);
}

state = newState();   // ilk render için
document.getElementById("startBtn").addEventListener("click", startGame);
document.getElementById("retryBtn").addEventListener("click", startGame);
document.getElementById("winBtn").addEventListener("click", startGame);

let audioOn = true;
const atb = document.getElementById("audioToggleStart");
atb.addEventListener("click", () => { audioOn = !audioOn; Sound.setOn(audioOn); atb.textContent = audioOn ? "🔊 Ses: AÇIK" : "🔇 Ses: KAPALI"; });

const pauseBtn = document.getElementById("pauseBtn");
pauseBtn.addEventListener("click", () => { state.paused = !state.paused; pauseBtn.textContent = state.paused ? "▶" : "⏸"; });
addEventListener("keydown", e => { if (e.key === "Escape" && state.running) { state.paused = !state.paused; pauseBtn.textContent = state.paused ? "▶" : "⏸"; } });
document.addEventListener("visibilitychange", () => { if (document.hidden && state.running) { state.paused = true; pauseBtn.textContent = "▶"; } });

// dokunmatik tespiti
addEventListener("touchstart", () => { input.isTouch = true; }, { once: true, passive: true });

requestAnimationFrame(loop);
})();
