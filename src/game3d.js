/* ============================================================
   100 GÜN ORMANDA — 3B (Three.js) Amazon Survival Horror
   İlk-şahıs. PC (fare kilidi + WASD) ve mobil (joystick + sürükle).
   Electron ile native uygulama olarak paketlenir (Unity yok).
   ============================================================ */
import * as THREE from "three";

/* ----------------------- UTIL ----------------------- */
const rnd = (a, b) => a + Math.random() * (b - a);
const rndi = (a, b) => Math.floor(rnd(a, b + 1));
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const map = (v, a, b, c, d) => c + (clamp(v, a, b) - a) / (b - a) * (d - c);
const choice = (arr) => arr[(Math.random() * arr.length) | 0];

const CFG = { WORLD: 110, DAY_LENGTH: 165, WIN_DAY: 100, TREES: 280, BUSHES: 130, ROCKS: 46, EYE: 1.7 };

/* ----------------------- DOM ----------------------- */
const $ = (id) => document.getElementById(id);
const threeCanvas = $("three");
const fx = $("fx"), fxc = fx.getContext("2d");
const toastsEl = $("toasts"), whisperEl = $("whisper"), promptEl = $("prompt"), crosshair = $("crosshair");

function toast(text, cls) {
  const d = document.createElement("div");
  d.className = "toast" + (cls ? " " + cls : ""); d.textContent = text;
  toastsEl.appendChild(d); setTimeout(() => d.remove(), 2500);
}
let whisperT = 0;
function whisperText(t) { whisperEl.textContent = t; whisperT = 2.2; }

/* ----------------------- SOUND (prosedürel) ----------------------- */
const Sound = {
  ctx: null, master: null, on: true,
  init() {
    if (this.ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
    this.ctx = new AC(); this.master = this.ctx.createGain();
    this.master.gain.value = this.on ? 0.85 : 0; this.master.connect(this.ctx.destination);
    this._ambient();
  },
  resume() { if (this.ctx && this.ctx.state === "suspended") this.ctx.resume(); },
  setOn(v) { this.on = v; if (this.master) this.master.gain.value = v ? 0.85 : 0; },
  _noise(dur) { const n = (this.ctx.sampleRate * dur) | 0, b = this.ctx.createBuffer(1, n, this.ctx.sampleRate), d = b.getChannelData(0); for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1; return b; },
  _ambient() {
    const c = this.ctx;
    const o1 = c.createOscillator(), o2 = c.createOscillator(), g = c.createGain();
    o1.type = "sine"; o2.type = "sine"; o1.frequency.value = 46; o2.frequency.value = 55;
    g.gain.value = 0.06; o1.connect(g); o2.connect(g); g.connect(this.master); o1.start(); o2.start();
    const s = c.createBufferSource(); s.buffer = this._noise(4); s.loop = true;
    const lp = c.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 420;
    const wg = c.createGain(); wg.gain.value = 0.05; s.connect(lp); lp.connect(wg); wg.connect(this.master); s.start();
  },
  _burst(dur, type, freq, gain, ramp) {
    if (!this.ctx) return; const c = this.ctx, t = c.currentTime;
    const s = c.createBufferSource(); s.buffer = this._noise(dur);
    const f = c.createBiquadFilter(); f.type = type; f.frequency.value = freq;
    const g = c.createGain(); g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f); f.connect(g); g.connect(this.master); s.start(); s.stop(t + dur + 0.02);
  },
  thump() { if (!this.ctx) return; const c = this.ctx, o = c.createOscillator(), g = c.createGain(), t = c.currentTime; o.type = "sine"; o.frequency.setValueAtTime(70, t); o.frequency.exponentialRampToValueAtTime(38, t + 0.18); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.5, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.35); o.connect(g); g.connect(this.master); o.start(); o.stop(t + 0.4); },
  step() { this._burst(0.08, "lowpass", 900, 0.1); },
  chop() { this._burst(0.12, "bandpass", 1600, 0.25); },
  crackle() { this._burst(0.05, "highpass", 2200, 0.06); },
  whisper() { this._burst(1.1, "bandpass", 1700, 0.13); },
  whoosh() { if (!this.ctx) return; const c = this.ctx, t = c.currentTime, s = c.createBufferSource(); s.buffer = this._noise(0.6); const f = c.createBiquadFilter(); f.type = "lowpass"; f.frequency.setValueAtTime(1800, t); f.frequency.exponentialRampToValueAtTime(180, t + 0.55); const g = c.createGain(); g.gain.setValueAtTime(0.25, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.6); s.connect(f); f.connect(g); g.connect(this.master); s.start(); s.stop(t + 0.62); },
  growl() { if (!this.ctx) return; const c = this.ctx, t = c.currentTime, o = c.createOscillator(), g = c.createGain(), lfo = c.createOscillator(), lg = c.createGain(); o.type = "sawtooth"; o.frequency.value = 90; lfo.type = "sine"; lfo.frequency.value = 22; lg.gain.value = 30; lfo.connect(lg); lg.connect(o.frequency); const f = c.createBiquadFilter(); f.type = "lowpass"; f.frequency.value = 500; g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.3, t + 0.1); g.gain.linearRampToValueAtTime(0.0001, t + 0.7); o.connect(f); f.connect(g); g.connect(this.master); o.start(); lfo.start(); o.stop(t + 0.75); lfo.stop(t + 0.75); },
  screech() {
    if (!this.ctx) return; const c = this.ctx, t = c.currentTime;
    this._burst(0.7, "highpass", 800, 0.9);
    const o1 = c.createOscillator(), o2 = c.createOscillator(), og = c.createGain();
    o1.type = "sawtooth"; o2.type = "sawtooth";
    o1.frequency.setValueAtTime(1400, t); o1.frequency.exponentialRampToValueAtTime(180, t + 0.55);
    o2.frequency.setValueAtTime(1480, t); o2.frequency.exponentialRampToValueAtTime(150, t + 0.55);
    og.gain.setValueAtTime(0.0001, t); og.gain.exponentialRampToValueAtTime(0.5, t + 0.03); og.gain.exponentialRampToValueAtTime(0.0001, t + 0.6);
    o1.connect(og); o2.connect(og); og.connect(this.master); o1.start(); o2.start(); o1.stop(t + 0.62); o2.stop(t + 0.62);
  },
};

/* ----------------------- THREE setup ----------------------- */
let renderer, scene, camera, sun, hemi, amb, headlamp;
const clock = new THREE.Clock();
let built = false;

function buildScene() {
  renderer = new THREE.WebGLRenderer({ canvas: threeCanvas, antialias: true, powerPreference: "high-performance" });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);

  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x9fb7a0);
  scene.fog = new THREE.FogExp2(0x9fb7a0, 0.014);

  camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 600);
  camera.rotation.order = "YXZ";

  hemi = new THREE.HemisphereLight(0xbfd8c0, 0x20301c, 0.9); scene.add(hemi);
  amb = new THREE.AmbientLight(0x405040, 0.5); scene.add(amb);
  sun = new THREE.DirectionalLight(0xfff0d0, 1.2); sun.position.set(40, 80, 20); scene.add(sun);
  headlamp = new THREE.PointLight(0xffe6c0, 0.0, 12, 1.6); scene.add(headlamp);

  // zemin (prosedürel doku)
  const gtex = groundTexture();
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(CFG.WORLD * 2 + 20, CFG.WORLD * 2 + 20),
    new THREE.MeshStandardMaterial({ map: gtex, roughness: 1, metalness: 0 })
  );
  ground.rotation.x = -Math.PI / 2; scene.add(ground);

  buildTrees();
  buildScatter();
}

function groundTexture() {
  const c = document.createElement("canvas"); c.width = c.height = 256; const g = c.getContext("2d");
  g.fillStyle = "#243a22"; g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 2600; i++) {
    g.fillStyle = choice(["#1d3018", "#2c4a26", "#34552c", "#3a3020", "#1a2614"]);
    const x = Math.random() * 256, y = Math.random() * 256, r = Math.random() * 3 + 1;
    g.beginPath(); g.arc(x, y, r, 0, 6.3); g.fill();
  }
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(40, 40); return t;
}

/* ----- ağaçlar (InstancedMesh) ----- */
let trunkIM, folLowIM, folTopIM;
const trees = [];
const _d = new THREE.Object3D();
const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);

function buildTrees() {
  const N = CFG.TREES;
  const trunkGeo = new THREE.CylinderGeometry(0.16, 0.3, 5, 6);
  const trunkMat = new THREE.MeshStandardMaterial({ color: 0x4a3420, roughness: 1 });
  const folGeo = new THREE.ConeGeometry(2.3, 4.6, 7);
  const folMatLow = new THREE.MeshStandardMaterial({ color: 0x1f5a2f, roughness: 1, flatShading: true });
  const folMatTop = new THREE.MeshStandardMaterial({ color: 0x2a6e3a, roughness: 1, flatShading: true });
  trunkIM = new THREE.InstancedMesh(trunkGeo, trunkMat, N);
  folLowIM = new THREE.InstancedMesh(folGeo, folMatLow, N);
  folTopIM = new THREE.InstancedMesh(folGeo, folMatTop, N);
  trunkIM.frustumCulled = folLowIM.frustumCulled = folTopIM.frustumCulled = false; // örnekler tüm dünyaya yayıldığı için culling kapalı
  scene.add(trunkIM, folLowIM, folTopIM);

  for (let i = 0; i < N; i++) {
    let x, z;
    do { x = rnd(-CFG.WORLD, CFG.WORLD); z = rnd(-CFG.WORLD, CFG.WORLD); } while (Math.hypot(x, z) < 9);
    trees.push({ x, z, s: rnd(0.8, 1.5), rot: rnd(0, 6.28), r: 0, hp: 4, alive: true, regrow: 0 });
    trees[i].r = 0.9 * trees[i].s;
    writeTree(i);
  }
  trunkIM.instanceMatrix.needsUpdate = folLowIM.instanceMatrix.needsUpdate = folTopIM.instanceMatrix.needsUpdate = true;
}
function writeTree(i) {
  const t = trees[i];
  if (!t.alive) { trunkIM.setMatrixAt(i, ZERO); folLowIM.setMatrixAt(i, ZERO); folTopIM.setMatrixAt(i, ZERO); return; }
  const s = t.s;
  _d.position.set(t.x, 2.5 * s, t.z); _d.rotation.set(0, t.rot, 0); _d.scale.set(s, s, s); _d.updateMatrix(); trunkIM.setMatrixAt(i, _d.matrix);
  _d.position.set(t.x, 5.0 * s, t.z); _d.scale.set(s, s, s); _d.updateMatrix(); folLowIM.setMatrixAt(i, _d.matrix);
  _d.position.set(t.x, 6.7 * s, t.z); _d.scale.set(s * 0.7, s * 0.95, s * 0.7); _d.updateMatrix(); folTopIM.setMatrixAt(i, _d.matrix);
}
function refreshTrees() { for (let i = 0; i < trees.length; i++) writeTree(i); trunkIM.instanceMatrix.needsUpdate = folLowIM.instanceMatrix.needsUpdate = folTopIM.instanceMatrix.needsUpdate = true; }

/* ----- çalı + kaya ----- */
function buildScatter() {
  const bushGeo = new THREE.IcosahedronGeometry(0.9, 0);
  const bushMat = new THREE.MeshStandardMaterial({ color: 0x1d4d2a, roughness: 1, flatShading: true });
  const bushIM = new THREE.InstancedMesh(bushGeo, bushMat, CFG.BUSHES);
  bushIM.frustumCulled = false;
  for (let i = 0; i < CFG.BUSHES; i++) { _d.position.set(rnd(-CFG.WORLD, CFG.WORLD), 0.5, rnd(-CFG.WORLD, CFG.WORLD)); _d.rotation.set(0, rnd(0, 6.3), 0); _d.scale.setScalar(rnd(0.7, 1.6)); _d.updateMatrix(); bushIM.setMatrixAt(i, _d.matrix); }
  scene.add(bushIM);
  const rockGeo = new THREE.DodecahedronGeometry(0.7, 0);
  const rockMat = new THREE.MeshStandardMaterial({ color: 0x55595c, roughness: 1, flatShading: true });
  const rockIM = new THREE.InstancedMesh(rockGeo, rockMat, CFG.ROCKS);
  rockIM.frustumCulled = false;
  for (let i = 0; i < CFG.ROCKS; i++) { _d.position.set(rnd(-CFG.WORLD, CFG.WORLD), 0.25, rnd(-CFG.WORLD, CFG.WORLD)); _d.rotation.set(rnd(0, 3), rnd(0, 6.3), rnd(0, 3)); _d.scale.setScalar(rnd(0.6, 1.8)); _d.updateMatrix(); rockIM.setMatrixAt(i, _d.matrix); }
  scene.add(rockIM);
}

/* ----------------------- GAME STATE ----------------------- */
let S;
function newState() {
  return {
    running: false, paused: false, over: false, won: false,
    time: 0.16, day: 1,
    health: 100, hunger: 100, warmth: 100, sanity: 100, stamina: 100,
    inv: { wood: 8, raw: 0, cooked: 2 },
    swingCd: 0, stepT: 0, sick: 0, hurt: 0, bob: 0,
    cookT: 0, fireCrackleT: 0, deathReason: "",
    heart: 0, heartLevel: 0, jumpCd: 12, firstNightDone: false, scripted: false,
    shake: 0,
  };
}

/* ----- dinamik nesneler ----- */
const animals = [];   // {group,x,z,type,hp,state,dir,atkCd}
const fires = [];     // {group,light,flame,x,z,fuel,max}
let watcher = null;   // {group,head,x,z,seen,life,alpha}
let wCd = 8, wEnc = 0;

function clearDynamic() {
  for (const a of animals) scene.remove(a.group); animals.length = 0;
  for (const f of fires) scene.remove(f.group); fires.length = 0;
  if (watcher) { scene.remove(watcher.group); watcher = null; }
}

/* ----- hayvan modeli ----- */
function makeAnimal(type) {
  const g = new THREE.Group();
  const col = { capybara: 0x8a6a44, deer: 0x9a7a52, tapir: 0x5a4a44, boar: 0x4a3a30, jaguar: 0xc8902c }[type];
  const big = type === "jaguar" || type === "tapir";
  const body = new THREE.Mesh(new THREE.BoxGeometry(big ? 1.6 : 1.1, 0.7, 0.6), new THREE.MeshStandardMaterial({ color: col, roughness: 1, flatShading: true }));
  body.position.y = 0.55; g.add(body);
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 0.5), new THREE.MeshStandardMaterial({ color: col, roughness: 1 }));
  head.position.set((big ? 0.9 : 0.65), 0.7, 0); g.add(head);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.5, 0.16), new THREE.MeshStandardMaterial({ color: 0x2a2018 }));
    leg.position.set(sx * (big ? 0.6 : 0.4), 0.25, sz * 0.22); g.add(leg);
  }
  if (type === "jaguar") {
    const em = new THREE.MeshStandardMaterial({ color: 0xffd83a, emissive: 0xffcc22, emissiveIntensity: 1.4 });
    for (const sz of [-1, 1]) { const e = new THREE.Mesh(new THREE.SphereGeometry(0.07, 6, 6), em); e.position.set((big ? 1.15 : 0.9), 0.78, sz * 0.13); g.add(e); }
  }
  scene.add(g); return g;
}
function spawnPrey() {
  const type = choice(["capybara", "deer", "tapir", "boar"]);
  const a = { group: makeAnimal(type), x: rnd(-CFG.WORLD, CFG.WORLD), z: rnd(-CFG.WORLD, CFG.WORLD), type, hp: 5, state: "wander", dir: rnd(0, 6.28), atkCd: 0, t: rnd(0, 3), hostile: false };
  animals.push(a);
}
function spawnJaguar() {
  const ang = rnd(0, 6.28), d = rnd(30, 50);
  const a = { group: makeAnimal("jaguar"), x: camera.position.x + Math.cos(ang) * d, z: camera.position.z + Math.sin(ang) * d, type: "jaguar", hp: 14, state: "stalk", dir: 0, atkCd: 0, hostile: true };
  animals.push(a);
}

/* ----- ateş modeli ----- */
function makeFire(x, z) {
  const g = new THREE.Group(); g.position.set(x, 0, z);
  for (let i = 0; i < 5; i++) { const log = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 1, 5), new THREE.MeshStandardMaterial({ color: 0x2a1c10 })); log.rotation.z = Math.PI / 2; log.rotation.y = i / 5 * Math.PI; log.position.y = 0.1; g.add(log); }
  const flame = new THREE.Mesh(new THREE.ConeGeometry(0.35, 1.1, 7), new THREE.MeshBasicMaterial({ color: 0xff7a1a, transparent: true, opacity: 0.92 })); flame.position.y = 0.7; g.add(flame);
  const light = new THREE.PointLight(0xff8a3c, 2.2, 16, 1.5); light.position.y = 1; g.add(light);
  scene.add(g);
  const f = { group: g, light, flame, x, z, fuel: 70, max: 140 }; fires.push(f); return f;
}

/* ----- İzleyen modeli ----- */
function makeWatcher() {
  const g = new THREE.Group();
  const black = new THREE.MeshBasicMaterial({ color: 0x040404 });
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.5, 3.0, 0.32), black); body.position.y = 1.9; g.add(body);
  for (const sx of [-1, 1]) { const arm = new THREE.Mesh(new THREE.BoxGeometry(0.16, 2.0, 0.16), black); arm.position.set(sx * 0.34, 2.2, 0); arm.rotation.z = sx * 0.12; g.add(arm); const leg = new THREE.Mesh(new THREE.BoxGeometry(0.18, 1.6, 0.18), black); leg.position.set(sx * 0.15, 0.8, 0); g.add(leg); }
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.34, 12, 12), new THREE.MeshStandardMaterial({ color: 0xd8d2c8, emissive: 0x554c44, emissiveIntensity: 0.5, roughness: 1 })); head.position.y = 3.7; g.add(head);
  const eyeMat = new THREE.MeshStandardMaterial({ color: 0xff1111, emissive: 0xcc0000, emissiveIntensity: 2.2 });
  for (const sx of [-1, 1]) { const e = new THREE.Mesh(new THREE.SphereGeometry(0.06, 8, 8), eyeMat); e.position.set(sx * 0.12, 3.74, 0.3); g.add(e); }
  // kan akıntıları (ince kırmızı kutular)
  const blood = new THREE.MeshBasicMaterial({ color: 0x8a0000 });
  for (let i = 0; i < 3; i++) { const b = new THREE.Mesh(new THREE.BoxGeometry(0.04, rnd(0.3, 0.7), 0.04), blood); b.position.set(rnd(-0.18, 0.18), 3.4, 0.3); g.add(b); }
  scene.add(g); g.visible = false; return g;
}
let watcherGroup = null, watcherHead = null;

function spawnWatcher(near) {
  if (!watcherGroup) { watcherGroup = makeWatcher(); }
  const ang = rnd(0, 6.28), d = near ? rnd(9, 16) : rnd(18, 34);
  let x = camera.position.x + Math.cos(ang) * d, z = camera.position.z + Math.sin(ang) * d;
  // mümkünse bir ağacın hemen yanına (ağacın arkasından izler)
  let bt = null, bd = 1e9;
  for (const t of trees) { if (!t.alive) continue; const dd = (t.x - x) ** 2 + (t.z - z) ** 2; if (dd < bd) { bd = dd; bt = t; } }
  if (bt && bd < 100) { x = bt.x + rnd(-0.8, 0.8); z = bt.z + rnd(-0.3, 0.8); }
  x = clamp(x, -CFG.WORLD, CFG.WORLD); z = clamp(z, -CFG.WORLD, CFG.WORLD);
  watcherGroup.position.set(x, 0, z); watcherGroup.visible = true;
  watcher = { group: watcherGroup, x, z, seen: 0, life: rnd(7, 14), alpha: 0 };
  Sound.whisper();
  if (Math.random() < 0.5) whisperText(choice(["arkanda...", "seni görüyor", "kaçma", "100 gün... olmayacak"]));
}
function vanishWatcher(quiet) { if (watcherGroup) watcherGroup.visible = false; watcher = null; wCd = rnd(9, 22) - Math.min(S.day * 0.05, 6); if (!quiet) { Sound.whoosh(); whisperText("..."); } }

/* ----------------------- INPUT ----------------------- */
const keys = {};
let yaw = 0, pitch = 0, locked = false, isTouch = false;
const inp = { jx: 0, jy: 0, joy: false, sprint: false, action: false, fire: false, eat: false };

addEventListener("keydown", (e) => {
  const k = e.key.toLowerCase(); keys[k] = true;
  if (["w", "a", "s", "d", " ", "shift"].includes(k)) e.preventDefault();
  if (k === "e" || k === " ") inp.action = true;
  if (k === "f") inp.fire = true;
  if (k === "g") inp.eat = true;
});
addEventListener("keyup", (e) => { keys[e.key.toLowerCase()] = false; });

threeCanvas.addEventListener("mousedown", (e) => {
  if (!S || !S.running) return;
  if (!isTouch && !locked) { threeCanvas.requestPointerLock && threeCanvas.requestPointerLock(); return; }
  if (e.button === 0) inp.action = true;
});
document.addEventListener("pointerlockchange", () => { locked = (document.pointerLockElement === threeCanvas); });
document.addEventListener("mousemove", (e) => { if (locked) { yaw -= e.movementX * 0.0022; pitch = clamp(pitch - e.movementY * 0.0022, -1.45, 1.45); } });

/* mobil joystick (sol) */
const joyZone = $("joy-zone"), joyBase = $("joy-base"), joyStick = $("joy-stick");
let joyId = null, joyOX = 0, joyOY = 0;
joyZone.addEventListener("touchstart", (e) => { isTouch = true; const t = e.changedTouches[0]; joyId = t.identifier; joyOX = t.clientX; joyOY = t.clientY; joyBase.style.display = "block"; joyBase.style.left = (joyOX - 60) + "px"; joyBase.style.top = (joyOY - 60) + "px"; joyBase.style.bottom = "auto"; inp.joy = true; e.preventDefault(); }, { passive: false });
joyZone.addEventListener("touchmove", (e) => { for (const t of e.changedTouches) if (t.identifier === joyId) { let dx = t.clientX - joyOX, dy = t.clientY - joyOY; const m = Math.hypot(dx, dy), mx = 55; if (m > mx) { dx = dx / m * mx; dy = dy / m * mx; } joyStick.style.transform = `translate(${dx}px,${dy}px)`; inp.jx = dx / mx; inp.jy = dy / mx; } e.preventDefault(); }, { passive: false });
function joyEnd(e) { for (const t of e.changedTouches) if (t.identifier === joyId) { joyId = null; inp.joy = false; inp.jx = inp.jy = 0; joyBase.style.display = "none"; joyStick.style.transform = ""; } }
joyZone.addEventListener("touchend", joyEnd); joyZone.addEventListener("touchcancel", joyEnd);

/* mobil bakış (sağ ekran sürükle) */
const lookZone = $("look-zone"); let lookId = null, lookX = 0, lookY = 0;
lookZone.addEventListener("touchstart", (e) => { isTouch = true; const t = e.changedTouches[0]; lookId = t.identifier; lookX = t.clientX; lookY = t.clientY; e.preventDefault(); }, { passive: false });
lookZone.addEventListener("touchmove", (e) => { for (const t of e.changedTouches) if (t.identifier === lookId) { yaw -= (t.clientX - lookX) * 0.005; pitch = clamp(pitch - (t.clientY - lookY) * 0.005, -1.45, 1.45); lookX = t.clientX; lookY = t.clientY; } e.preventDefault(); }, { passive: false });
function lookEnd(e) { for (const t of e.changedTouches) if (t.identifier === lookId) lookId = null; }
lookZone.addEventListener("touchend", lookEnd); lookZone.addEventListener("touchcancel", lookEnd);

function bindBtn(id, onDown, hold) {
  const el = $(id);
  const down = (e) => { isTouch = true; if (hold) el._held = true; else onDown(); e.preventDefault(); };
  const up = (e) => { if (hold) el._held = false; e.preventDefault(); };
  el.addEventListener("touchstart", down, { passive: false }); el.addEventListener("touchend", up, { passive: false });
  el.addEventListener("mousedown", (e) => { if (hold) el._held = true; else onDown(); }); el.addEventListener("mouseup", () => { if (hold) el._held = false; });
  return el;
}
bindBtn("btn-action", () => (inp.action = true));
bindBtn("btn-fire", () => (inp.fire = true));
bindBtn("btn-eat", () => (inp.eat = true));
const sprintBtn = bindBtn("btn-sprint", null, true);

/* ----------------------- INTERACTION ----------------------- */
const _fwd = new THREE.Vector3();
function findTarget() {
  camera.getWorldDirection(_fwd); _fwd.y = 0; _fwd.normalize();
  const px = camera.position.x, pz = camera.position.z;
  let best = null, bestScore = -1;
  const consider = (x, z, range, kind, obj) => {
    const dx = x - px, dz = z - pz, d = Math.hypot(dx, dz);
    if (d > range || d < 0.001) return;
    const dot = (dx / d) * _fwd.x + (dz / d) * _fwd.z;        // bakış hizası
    if (dot < 0.8) return;
    const score = dot - d * 0.04;
    if (score > bestScore) { bestScore = score; best = { kind, obj, d }; }
  };
  for (const t of trees) if (t.alive) consider(t.x, t.z, 4.2, "tree", t);
  for (const a of animals) consider(a.x, a.z, 4.4, "animal", a);
  return best;
}
function doAction() {
  if (S.swingCd > 0) return;
  const t = findTarget(); if (!t) return;
  S.swingCd = 0.4; S.stamina = clamp(S.stamina - 4, 0, 100); Sound.chop();
  if (t.kind === "tree") {
    const tr = t.obj; tr.hp--; S.inv.wood++;
    if (tr.hp <= 0) { tr.alive = false; tr.regrow = 95; S.inv.wood += 2; writeTree(trees.indexOf(tr)); trunkIM.instanceMatrix.needsUpdate = folLowIM.instanceMatrix.needsUpdate = folTopIM.instanceMatrix.needsUpdate = true; toast("🪵 Ağaç devrildi (+3)", "good"); }
    return;
  }
  if (t.kind === "animal") {
    const a = t.obj; a.hp -= 3;
    if (a.type === "boar" || a.type === "jaguar") { a.hostile = true; a.state = "chase"; }
    else { a.state = "flee"; a.dir = Math.atan2(a.z - camera.position.z, a.x - camera.position.x); }
    if (a.hp <= 0) killAnimal(a);
  }
}
function killAnimal(a) {
  const y = a.type === "jaguar" ? rndi(5, 7) : a.type === "tapir" ? rndi(3, 5) : rndi(2, 4);
  S.inv.raw += y; toast("🥩 +" + y + " çiğ et (" + nameTR(a.type) + ")", "good");
  scene.remove(a.group); animals.splice(animals.indexOf(a), 1);
  if (a.type !== "jaguar") setTimeout(() => { if (S.running && animals.length < 16) spawnPrey(); }, 9000);
}
const nameTR = (t) => ({ capybara: "kapibara", deer: "geyik", tapir: "tapir", boar: "yaban domuzu", jaguar: "jaguar" }[t] || t);

function doFire() {
  const px = camera.position.x, pz = camera.position.z;
  let near = null, nd = 36;
  for (const f of fires) { const d = (f.x - px) ** 2 + (f.z - pz) ** 2; if (d < nd) { nd = d; near = f; } }
  if (near) { if (S.inv.wood <= 0) { toast("Odun yok"); return; } const add = Math.min(S.inv.wood, 5); S.inv.wood -= add; near.fuel = Math.min(near.fuel + add * 14, near.max); toast("🔥 Ateşe odun eklendi", "good"); return; }
  if (S.inv.wood < 5) { toast("Ateş için 5 odun lazım (" + S.inv.wood + ")", "bad"); return; }
  S.inv.wood -= 5; camera.getWorldDirection(_fwd); _fwd.y = 0; _fwd.normalize();
  makeFire(px + _fwd.x * 2.2, pz + _fwd.z * 2.2); toast("🔥 Kamp ateşi yakıldı!", "good");
}
function doEat() {
  const inv = S.inv;
  if (inv.cooked > 0) { inv.cooked--; S.hunger = clamp(S.hunger + 45, 0, 100); toast("🍗 Pişmiş et yedin (+45)", "good"); }
  else if (inv.raw > 0) { inv.raw--; S.hunger = clamp(S.hunger + 18, 0, 100); if (Math.random() < 0.45) { S.health = clamp(S.health - 12, 0, 100); S.sanity = clamp(S.sanity - 4, 0, 100); S.sick = 3; toast("🤢 Çiğ et seni hasta etti!", "bad"); } else toast("🥩 Çiğ et yedin (+18)", "good"); }
  else toast("Yiyecek yok!", "bad");
}

/* ----------------------- JUMPSCARE ----------------------- */
let jumpT = 0, jumpFace = 0;
function jumpscare(face, san, hp) {
  jumpT = 0.85; jumpFace = face != null ? face : rndi(0, 2);
  S.shake = Math.max(S.shake, 0.5);
  S.sanity = clamp(S.sanity - (san || 12), 0, 100);
  if (hp) { S.health = clamp(S.health - hp, 0, 100); S.hurt = 0.4; if (S.health <= 0) die("kalp krizi"); }
  Sound.screech();
}
function drawScaryFace(w, h, kind) {
  fxc.save(); fxc.translate(w / 2 + rnd(-8, 8), h / 2 + rnd(-8, 8));
  const sc = Math.min(w, h) / 360 * 1.1; fxc.scale(sc, sc);
  fxc.fillStyle = "#e8e2d6"; fxc.beginPath(); fxc.ellipse(0, 0, 120, 160, 0, 0, 6.3); fxc.fill();
  fxc.fillStyle = "rgba(40,20,20,0.5)"; fxc.beginPath(); fxc.ellipse(-55, -10, 35, 50, 0.4, 0, 6.3); fxc.fill(); fxc.beginPath(); fxc.ellipse(55, -10, 35, 50, -0.4, 0, 6.3); fxc.fill();
  fxc.fillStyle = "#000"; fxc.beginPath(); fxc.ellipse(-45, -30, 28, 36, 0, 0, 6.3); fxc.fill(); fxc.beginPath(); fxc.ellipse(45, -30, 28, 36, 0, 0, 6.3); fxc.fill();
  if (kind !== 2) { fxc.fillStyle = "#fff"; const j = () => rnd(-3, 3); fxc.beginPath(); fxc.arc(-45 + j(), -28 + j(), 5, 0, 6.3); fxc.arc(45 + j(), -28 + j(), 5, 0, 6.3); fxc.fill(); }
  else { fxc.fillStyle = "#ff1a1a"; fxc.beginPath(); fxc.arc(-45, -28, 7, 0, 6.3); fxc.arc(45, -28, 7, 0, 6.3); fxc.fill(); }
  fxc.strokeStyle = "#8a0000"; fxc.lineWidth = 5; fxc.beginPath(); fxc.moveTo(-45, 6); fxc.lineTo(-42, 120); fxc.stroke(); fxc.beginPath(); fxc.moveTo(45, 6); fxc.lineTo(50, 130); fxc.stroke();
  fxc.fillStyle = "#100000"; fxc.beginPath(); fxc.ellipse(0, 80, 38, 58, 0, 0, 6.3); fxc.fill();
  fxc.fillStyle = "#d8cfc0"; for (let i = -3; i <= 3; i++) { fxc.fillRect(i * 10 - 4, 32, 8, 14); fxc.fillRect(i * 10 - 4, 116, 8, 14); }
  fxc.restore();
}

/* ----------------------- DEATH / WIN ----------------------- */
function die(reason) {
  if (S.over) return; S.over = true; S.running = false; S.deathReason = reason; Sound.screech();
  document.exitPointerLock && document.exitPointerLock();
  setTimeout(() => { $("deathReason").textContent = "Sebep: " + reason; $("daysSurvived").textContent = S.day; $("gameover").classList.remove("hidden"); }, 700);
}
function winGame() { S.won = true; S.running = false; document.exitPointerLock && document.exitPointerLock(); $("win").classList.remove("hidden"); }

/* ----------------------- UPDATE ----------------------- */
function update(dt) {
  // zaman / gün
  S.time += dt / CFG.DAY_LENGTH;
  if (S.time >= 1) { S.time -= 1; S.day++; S.firstNightDone = false; S.scripted = false; if (S.day > CFG.WIN_DAY) { winGame(); return; } toast("☀️ GÜN " + S.day + " başladı", "good"); if (Math.random() < 0.5) wCd = rnd(20, 80); }
  const night = isNight();

  // bakış (kamera) uygula
  camera.rotation.set(pitch, yaw, 0, "YXZ");

  // hareket
  let mz = 0, mx = 0;
  if (keys["w"]) mz += 1; if (keys["s"]) mz -= 1; if (keys["d"]) mx += 1; if (keys["a"]) mx -= 1;
  if (inp.joy) { mx += inp.jx; mz += -inp.jy; }
  const m = Math.hypot(mx, mz); if (m > 1) { mx /= m; mz /= m; }
  const sprinting = (inp.sprint || keys["shift"] || sprintBtn._held) && S.stamina > 1 && m > 0.1;
  let spd = (sprinting ? 8.5 : 5) * dt;
  if (S.hunger <= 0 || S.warmth <= 0) spd *= 0.62;
  camera.getWorldDirection(_fwd); _fwd.y = 0; _fwd.normalize();
  const rightX = -_fwd.z, rightZ = _fwd.x; // sağ = cross(forward, up)
  let nx = camera.position.x + (_fwd.x * mz + rightX * mx) * spd;
  let nz = camera.position.z + (_fwd.z * mz + rightZ * mx) * spd;
  // ağaç çarpışması
  for (const t of trees) { if (!t.alive) continue; const dx = nx - t.x, dz = nz - t.z, rr = t.r + 0.5; if (dx * dx + dz * dz < rr * rr) { const d = Math.hypot(dx, dz) || 0.001; nx = t.x + dx / d * rr; nz = t.z + dz / d * rr; } }
  nx = clamp(nx, -CFG.WORLD, CFG.WORLD); nz = clamp(nz, -CFG.WORLD, CFG.WORLD);
  camera.position.x = nx; camera.position.z = nz;
  // baş sallanması + sarsıntı
  if (m > 0.1) { S.bob += dt * (sprinting ? 14 : 9); S.stepT -= dt; if (S.stepT <= 0) { Sound.step(); S.stepT = sprinting ? 0.3 : 0.45; } } else S.bob *= 0.9;
  let camY = CFG.EYE + Math.sin(S.bob) * 0.06;
  if (S.shake > 0) { S.shake = Math.max(0, S.shake - dt * 1.6); camY += rnd(-S.shake, S.shake) * 0.15; yaw += rnd(-S.shake, S.shake) * 0.01; }
  camera.position.y = camY;

  // stamina
  S.stamina = clamp(S.stamina + (sprinting ? -18 : 12) * dt, 0, 100);
  if (S.swingCd > 0) S.swingCd -= dt;
  if (S.sick > 0) S.sick -= dt;
  if (S.hurt > 0) S.hurt -= dt;

  // aksiyon kenar tetikleri
  if (inp.action) { inp.action = false; doAction(); }
  if (inp.fire) { inp.fire = false; doFire(); }
  if (inp.eat) { inp.eat = false; doEat(); }

  // ateşler
  let nearFire = false, fireDist = 1e9;
  for (let i = fires.length - 1; i >= 0; i--) {
    const f = fires[i]; f.fuel -= dt * (night ? 2.4 : 3.2);
    if (f.fuel <= 0) { scene.remove(f.group); fires.splice(i, 1); toast("🪵 Ateş söndü", "bad"); continue; }
    const flick = 0.85 + Math.sin(performance.now() / 70 + i) * 0.15 + Math.random() * 0.1;
    f.light.intensity = map(f.fuel, 0, f.max, 0.8, 2.6) * flick;
    f.light.distance = map(f.fuel, 0, f.max, 8, 17);
    f.flame.scale.set(flick, 0.8 + flick * 0.5, flick); f.flame.rotation.y += dt * 3;
    const d = Math.hypot(f.x - camera.position.x, f.z - camera.position.z); if (d < 6) { nearFire = true; fireDist = Math.min(fireDist, d); }
  }
  if (nearFire) { S.fireCrackleT -= dt; if (S.fireCrackleT <= 0) { Sound.crackle(); S.fireCrackleT = rnd(0.08, 0.3); } }
  // pişirme
  if (nearFire && fireDist < 5 && S.inv.raw > 0) { S.cookT += dt; if (S.cookT >= 3.5) { S.cookT = 0; S.inv.raw--; S.inv.cooked++; toast("🍗 Et pişti", "good"); } } else S.cookT = 0;

  // hayatta kalma
  S.hunger = clamp(S.hunger - 0.42 * dt, 0, 100);
  if (nearFire) S.warmth = clamp(S.warmth + 9 * dt, 0, 100);
  else if (night) S.warmth = clamp(S.warmth - 1.25 * dt, 0, 100);
  else S.warmth = clamp(S.warmth - 0.18 * dt, 0, 100);
  if (nearFire) S.sanity = clamp(S.sanity + (night ? 1.0 : 2.2) * dt, 0, 100);
  else if (night) S.sanity = clamp(S.sanity - 0.85 * dt, 0, 100);
  else S.sanity = clamp(S.sanity + 0.3 * dt, 0, 100);

  let dmg = 0;
  if (S.hunger <= 0) { dmg += 2.0; S.deathReason = "açlık"; }
  if (S.warmth <= 0) { dmg += 1.5; S.deathReason = "soğuk"; }
  if (S.sanity <= 0) { dmg += 2.5; S.deathReason = "delirme"; }
  if (dmg > 0) S.health = clamp(S.health - dmg * dt, 0, 100);
  else if (S.hunger > 40 && S.warmth > 40 && S.sanity > 25 && S.sick <= 0) S.health = clamp(S.health + 0.8 * dt, 0, 100);
  if (S.health <= 0) { die(S.deathReason || "bilinmeyen"); return; }

  // korku — İzleyen
  updateWatcher(dt, night);
  // jumpscare zamanlayıcı
  S.jumpCd -= dt;
  if (jumpT <= 0 && S.jumpCd <= 0 && night) { const p = 0.02 + (1 - S.sanity / 100) * 0.07; if (Math.random() < p) { jumpscare(null, 11, 0); S.jumpCd = rnd(16, 38); } }
  if (night && S.day === 1 && !S.scripted && S.time > 0.80) { S.scripted = true; setTimeout(() => { if (S.running) jumpscare(1, 10, 0); }, rndi(3000, 8000)); }
  if (jumpT > 0) jumpT -= dt;

  // gece jaguarı
  if (night && S.day > 1 && Math.random() < 0.0009 && animals.filter((a) => a.type === "jaguar").length < 2) { spawnJaguar(); Sound.growl(); whisperText("bir hırıltı..."); }

  updateAnimals(dt);

  // ağaç regrow
  for (let i = 0; i < trees.length; i++) { const t = trees[i]; if (t.regrow > 0) { t.regrow -= dt; if (t.regrow <= 0) { t.alive = true; t.hp = 4; writeTree(i); trunkIM.instanceMatrix.needsUpdate = folLowIM.instanceMatrix.needsUpdate = folTopIM.instanceMatrix.needsUpdate = true; } } }

  // ışık / atmosfer (gündüz-gece)
  const dk = darknessFor(S.time);
  const dayK = 1 - dk;
  sun.intensity = dayK * 1.2;
  const sunAng = S.time * Math.PI * 2 - Math.PI / 2;
  sun.position.set(Math.cos(sunAng) * 80, Math.max(5, Math.sin(sunAng) * 90), 30);
  hemi.intensity = lerp(0.06, 0.9, dayK); amb.intensity = lerp(0.05, 0.5, dayK);
  headlamp.intensity = lerp(0.0, 0.9, dk); headlamp.position.copy(camera.position);
  const dayCol = new THREE.Color(0x9fb7a0), nightCol = new THREE.Color(0x05080f);
  const skyCol = nightCol.clone().lerp(dayCol, dayK);
  scene.background = skyCol; scene.fog.color = skyCol;
  scene.fog.density = lerp(0.014, 0.075, dk);

  // kalp atışı
  let hl = (1 - S.sanity / 100) * 0.8;
  if (watcher) hl = Math.max(hl, map(Math.hypot(watcher.x - camera.position.x, watcher.z - camera.position.z), 4, 30, 1, 0.2));
  for (const a of animals) if (a.hostile && Math.hypot(a.x - camera.position.x, a.z - camera.position.z) < 16) hl = Math.max(hl, 0.7);
  S.heartLevel = lerp(S.heartLevel, hl, 0.1);
  if (S.heartLevel > 0.16) { S.heart -= dt; if (S.heart <= 0) { Sound.thump(); S.heart = lerp(1.1, 0.32, S.heartLevel); } }

  if (whisperT > 0) whisperT -= dt;
  updateHUD(night);
}

function updateWatcher(dt, night) {
  if (!watcher) {
    wCd -= dt;
    if (wCd <= 0) {
      let chance = night ? 0.9 : 0.1; chance *= 1 + (1 - S.sanity / 100);
      if (!S.firstNightDone && night) chance = 1;
      if (Math.random() < chance) { spawnWatcher(false); if (night) S.firstNightDone = true; } else wCd = rnd(4, 9);
    }
    return;
  }
  const w = watcher; w.alpha = Math.min(w.alpha + dt * 1.5, 1);
  // İzleyen kameraya bakar (dik dur)
  w.group.rotation.y = Math.atan2(camera.position.x - w.x, camera.position.z - w.z);
  const d = Math.hypot(w.x - camera.position.x, w.z - camera.position.z);
  // bakıyor mu? -> kafayı ekran düzlemine projekte et
  const v = new THREE.Vector3(w.x, 3.7, w.z).project(camera);
  const onScreen = v.z < 1 && Math.hypot(v.x, v.y) < 0.33;
  const looking = onScreen && d < 50;
  if (looking) { w.seen += dt; if (w.seen > 0.32) { vanishWatcher(false); S.sanity = clamp(S.sanity - 6, 0, 100); wEnc++; return; } }
  else { w.seen = Math.max(0, w.seen - dt * 0.6); S.sanity = clamp(S.sanity - map(d, 4, 30, 16, 1.5) * dt, 0, 100); }
  w.life -= dt;
  if (d > 70) { vanishWatcher(true); wCd = rnd(5, 10); return; }
  if (w.life <= 0) {
    if (d < 6 && S.sanity < 45) { jumpscare(0, 18, 9); vanishWatcher(true); wCd = rnd(18, 30); }
    else if (Math.random() < 0.55) { spawnWatcher(true); whisperText(choice(["daha yakın", "kıpırdama", "arkanda"])); }
    else vanishWatcher(true);
  }
}

function updateAnimals(dt) {
  const px = camera.position.x, pz = camera.position.z;
  for (let i = animals.length - 1; i >= 0; i--) {
    const a = animals[i], d = Math.hypot(a.x - px, a.z - pz);
    if (a.atkCd > 0) a.atkCd -= dt;
    if (a.type === "jaguar") {
      let fearFire = false; for (const f of fires) if (Math.hypot(a.x - f.x, a.z - f.z) < 7) fearFire = true;
      if (fearFire && fires.length) { const f = fires[0]; a.dir = Math.atan2(a.z - f.z, a.x - f.x); }
      else if (d < 38) a.dir = Math.atan2(pz - a.z, px - a.x);
      const sp = d < 38 && !fearFire ? 7 : 3;
      a.x += Math.cos(a.dir) * sp * dt; a.z += Math.sin(a.dir) * sp * dt;
      if (d < 2.2 && a.atkCd <= 0) { S.health = clamp(S.health - 11, 0, 100); S.hurt = 0.45; S.shake = 0.4; a.atkCd = 1.2; Sound.growl(); S.deathReason = "jaguar saldırısı"; if (S.health <= 0) { die("jaguar saldırısı"); return; } }
      if (!isNight() && d > 45) { scene.remove(a.group); animals.splice(i, 1); continue; }
    } else if (a.type === "boar" && a.hostile) {
      a.dir = Math.atan2(pz - a.z, px - a.x); a.x += Math.cos(a.dir) * 5.5 * dt; a.z += Math.sin(a.dir) * 5.5 * dt;
      if (d < 2 && a.atkCd <= 0) { S.health = clamp(S.health - 7, 0, 100); S.hurt = 0.4; S.shake = 0.3; a.atkCd = 1.4; S.deathReason = "yaban domuzu"; if (S.health <= 0) { die("yaban domuzu saldırısı"); return; } }
      if (d > 30) a.hostile = false;
    } else {
      if (d < 9 && a.state !== "flee") { a.state = "flee"; a.dir = Math.atan2(a.z - pz, a.x - px) + rnd(-0.4, 0.4); }
      if (a.state === "flee") { a.x += Math.cos(a.dir) * 5 * dt; a.z += Math.sin(a.dir) * 5 * dt; if (d > 22) a.state = "wander"; }
      else { a.t -= dt; if (a.t <= 0) { a.t = rnd(1.5, 4); a.dir = rnd(0, 6.28); a.moving = Math.random() < 0.6; } if (a.moving) { a.x += Math.cos(a.dir) * 1.6 * dt; a.z += Math.sin(a.dir) * 1.6 * dt; } }
    }
    a.x = clamp(a.x, -CFG.WORLD, CFG.WORLD); a.z = clamp(a.z, -CFG.WORLD, CFG.WORLD);
    a.group.position.set(a.x, 0, a.z); a.group.rotation.y = -a.dir;
  }
}

/* ----------------------- TIME HELPERS ----------------------- */
function darknessFor(t) {
  if (t < 0.05) return lerp(0.86, 0.82, t / 0.05);
  if (t < 0.20) return lerp(0.82, 0.0, (t - 0.05) / 0.15);
  if (t < 0.54) return 0.0;
  if (t < 0.70) return lerp(0.0, 0.86, (t - 0.54) / 0.16);
  return 0.88;
}
function isNight() { return S.time >= 0.68 || S.time < 0.07; }
function phaseInfo(t) { if (t < 0.07) return ["🌑", "Gece"]; if (t < 0.20) return ["🌅", "Şafak"]; if (t < 0.45) return ["☀️", "Gündüz"]; if (t < 0.54) return ["🌤️", "Öğle"]; if (t < 0.68) return ["🌆", "Akşam"]; return ["🌑", "Gece"]; }

/* ----------------------- HUD ----------------------- */
const bars = { health: $("bar-health"), hunger: $("bar-hunger"), warmth: $("bar-warmth"), sanity: $("bar-sanity"), stamina: $("bar-stamina") };
const invEl = { wood: $("inv-wood"), raw: $("inv-raw"), cooked: $("inv-cooked") };
function updateHUD(night) {
  $("dayNum").textContent = S.day;
  const [ic, tx] = phaseInfo(S.time); $("phaseIcon").textContent = ic; $("phaseText").textContent = tx;
  bars.health.style.width = S.health + "%"; bars.hunger.style.width = S.hunger + "%"; bars.warmth.style.width = S.warmth + "%"; bars.sanity.style.width = S.sanity + "%"; bars.stamina.style.width = S.stamina + "%";
  invEl.wood.textContent = S.inv.wood; invEl.raw.textContent = S.inv.raw; invEl.cooked.textContent = S.inv.cooked;
  const t = findTarget();
  if (t) { const key = isTouch ? "VUR" : "[Sol tık]"; promptEl.textContent = t.kind === "tree" ? "🪓 Odun kes " + key : "⚔️ " + (t.obj.hostile ? "Savaş " : "Avla ") + key; promptEl.classList.remove("hidden"); }
  else promptEl.classList.add("hidden");
  // pusula
  let nf = null, nd = 1e9; for (const f of fires) { const d = (f.x - camera.position.x) ** 2 + (f.z - camera.position.z) ** 2; if (d < nd) { nd = d; nf = f; } }
  const comp = $("compass");
  if (nf && Math.sqrt(nd) > 12) { $("compassDist").textContent = Math.round(Math.sqrt(nd)) + "m"; comp.classList.remove("hidden"); } else comp.classList.add("hidden");
  whisperEl.style.color = "rgba(180,20,20," + clamp(whisperT / 2.2, 0, 1) * 0.85 + ")";
}

/* ----------------------- RESIZE ----------------------- */
function resize() {
  const w = window.innerWidth, h = window.innerHeight, dpr = Math.min(window.devicePixelRatio || 1, 2);
  if (renderer) { renderer.setPixelRatio(dpr); renderer.setSize(w, h); camera.aspect = w / h; camera.updateProjectionMatrix(); }
  fx.width = w * dpr; fx.height = h * dpr; fxc.setTransform(dpr, 0, 0, dpr, 0, 0);
}
addEventListener("resize", resize);

/* ----------------------- LOOP ----------------------- */
function loop() {
  const dt = Math.min(clock.getDelta(), 0.05);
  if (S && S.running && !S.paused) update(dt);
  if (renderer) renderer.render(scene, camera);

  // FX katmanı (jumpscare + akıl bozulması + ekran kenarı)
  const w = window.innerWidth, h = window.innerHeight;
  fxc.clearRect(0, 0, w, h);
  if (S && S.running) {
    const sanFrac = 1 - S.sanity / 100;
    if (S.hurt > 0) { fxc.fillStyle = "rgba(180,0,0," + S.hurt * 0.5 + ")"; fxc.fillRect(0, 0, w, h); }
    if (sanFrac > 0.25) { const pulse = (Math.sin(performance.now() / 400) * 0.5 + 0.5) * sanFrac; fxc.fillStyle = "rgba(120,0,0," + pulse * 0.22 + ")"; fxc.fillRect(0, 0, w, h); }
    if (watcher) { const d = Math.hypot(watcher.x - camera.position.x, watcher.z - camera.position.z); const a = map(d, 4, 30, 0.45, 0); if (a > 0.02) { fxc.fillStyle = "rgba(40,0,0," + a + ")"; fxc.fillRect(0, 0, w, h); } }
  }
  if (jumpT > 0) { fxc.fillStyle = Math.random() > 0.5 ? "#120000" : "#3a0000"; fxc.fillRect(0, 0, w, h); drawScaryFace(w, h, jumpFace); }
}

/* ----------------------- BOOT / MENU ----------------------- */
function startGame() {
  if (!built) { try { buildScene(); built = true; } catch (e) { $("loadNote").textContent = "3B başlatılamadı: " + e.message + " — 'npm install' yaptın mı?"; throw e; } }
  S = newState();
  // dünyayı sıfırla
  for (let i = 0; i < trees.length; i++) { trees[i].alive = true; trees[i].hp = 4; trees[i].regrow = 0; }
  refreshTrees();
  clearDynamic(); watcherGroup = null; wCd = 8; wEnc = 0;
  for (let i = 0; i < 14; i++) spawnPrey();
  camera.position.set(0, CFG.EYE, 0); yaw = 0; pitch = 0;
  Sound.init(); Sound.resume();
  S.running = true;
  $("start").classList.add("hidden"); $("gameover").classList.add("hidden"); $("win").classList.add("hidden");
  $("hud").classList.remove("hidden"); crosshair.classList.remove("hidden"); $("pauseBtn").classList.remove("hidden");
  const wantMobile = isTouch || (window.matchMedia && window.matchMedia("(pointer: coarse)").matches) || window.innerWidth < 820;
  if (wantMobile) $("mobile").classList.remove("hidden");
  else { $("mobile").classList.add("hidden"); threeCanvas.requestPointerLock && threeCanvas.requestPointerLock(); }
  toast("🌴 Amazon'a hoş geldin. Geceye hazırlan...", "good");
  setTimeout(() => toast("🪓 Ağaca bakıp VUR → odun · 🔥 ile ateş yak", "good"), 2600);
}

$("startBtn").addEventListener("click", startGame);
$("retryBtn").addEventListener("click", startGame);
$("winBtn").addEventListener("click", startGame);
let audioOn = true;
$("audioToggleStart").addEventListener("click", () => { audioOn = !audioOn; Sound.setOn(audioOn); $("audioToggleStart").textContent = audioOn ? "🔊 Ses: AÇIK" : "🔇 Ses: KAPALI"; });
const pauseBtn = $("pauseBtn");
pauseBtn.addEventListener("click", () => { if (!S) return; S.paused = !S.paused; pauseBtn.textContent = S.paused ? "▶" : "⏸"; });
addEventListener("keydown", (e) => { if (e.key === "Escape" && S && S.running) { /* fare kilidi tarayıcıca bırakılır */ } });
document.addEventListener("visibilitychange", () => { if (document.hidden && S && S.running) { S.paused = true; pauseBtn.textContent = "▶"; } });
addEventListener("touchstart", () => { isTouch = true; }, { once: true, passive: true });

resize();
// Render döngüsü: sahne kurulmadan da (menüde) FX katmanını temiz tutar; START ile sahne kurulur.
function rafLoop() { loop(); requestAnimationFrame(rafLoop); }
requestAnimationFrame(rafLoop);
