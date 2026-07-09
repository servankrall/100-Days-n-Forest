/* ============================================================
   100 GÜN ORMANDA — 3B (Three.js) Amazon Survival Horror
   İlk-şahıs. PC (fare kilidi + WASD) ve mobil (joystick + sürükle).
   Electron ile native uygulama olarak paketlenir (Unity yok).
   ============================================================ */
import * as THREE from "three";
import { net } from "./net.js";

/* ----------------------- UTIL ----------------------- */
const rnd = (a, b) => a + Math.random() * (b - a);
const rndi = (a, b) => Math.floor(rnd(a, b + 1));
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const map = (v, a, b, c, d) => c + (clamp(v, a, b) - a) / (b - a) * (d - c);
const choice = (arr) => arr[(Math.random() * arr.length) | 0];
// PointLight yardımcı: three.js'te Object3D.position SALT-OKUNUR → Object.assign(light,{position})
// katı modda (ES modülü) hata verir. Önce oluştur, sonra .position.set() ile konumlandır.
function plight(color, intensity, dist, decay, x, y, z) { const l = new THREE.PointLight(color, intensity, dist, decay); l.position.set(x || 0, y || 0, z || 0); return l; }

const CFG = { WORLD: 260, DAY_LENGTH: 165, WIN_DAY: 100, TREES: 1520, BUSHES: 620, ROCKS: 138, GRASS: 2150, VINES: 230, EYE: 1.7, SCRAP: 0, CHESTS: 58, HOUSES: 20 };   // daha büyük dünya (~%45 alan; ağaç/çalı/çim InstancedMesh olduğu için ucuz)
// 🛡️ ADMİN GÜÇLERİ — oyun içi hile paneli (\ tuşu veya duraklat menüsü). Tümü YEREL/oyun içi.
const admin = { god: false, fly: false, noclip: false, infStam: false, freezeTime: false, noAI: false, oneHit: false, speed: 1 };

/* ----- BİYOMLAR: merkez Orman; dış halka açıya göre Kar / Peri / Volkan ----- */
const BIOMES = {
  forest:   { name: "🌲 Orman",        ground: 0x3c5a32, fog: 0x9fb7a0, fol: [0.30, 0.55, 0.28], trunk: 0.08 },
  snow:     { name: "❄️ Karlı Bölge",   ground: 0xdde8f2, fog: 0xc6d4e4, sky: 0x9cc2e8, fol: [0.58, 0.10, 0.82], trunk: 0.60, cold: true },
  fairy:    { name: "🧚 Peri Ormanı",   ground: 0x5e3a72, fog: 0xc89bdc, sky: 0x8f5ab8, fol: [0.85, 0.62, 0.66], trunk: 0.78, fairy: true },
  volcanic: { name: "🌋 Volkanik Bölge", ground: 0x241310, fog: 0x6e2a18, sky: 0x8f2e14, fol: [0.03, 0.70, 0.22], trunk: 0.02, heat: true },
  caves:    { name: "🕳️ Mağara", ground: 0x171310, fog: 0x050505 },   // yeraltı: karanlık (el feneri/meşale şart)
};
let inCave = false;   // oyuncu bir mağara hacminin içinde mi (karanlık + mağara yaratıkları)
const BIOME_R = 78;   // bu yarıçapın içi her zaman Orman (güvenli başlangıç)
function biomeAt(x, z) {
  if (Math.hypot(x, z) < BIOME_R) return "forest";
  const a = Math.atan2(z, x);                       // -π..π
  if (a >= -Math.PI / 3 && a < Math.PI / 3) return "fairy";      // +X sektörü
  if (a >= Math.PI / 3 && a < Math.PI) return "volcanic";        // arka-sol sektör (en uzak/tehlikeli)
  return "snow";                                                  // kalan sektör
}
let curBiome = "forest";

/* ----------------------- DOM ----------------------- */
const $ = (id) => document.getElementById(id);
const threeCanvas = $("three");
const fx = $("fx"), fxc = fx.getContext("2d");
const toastsEl = $("toasts"), whisperEl = $("whisper"), promptEl = $("prompt"), crosshair = $("crosshair");

/* ----------------------- AYARLAR (kalıcı) ----------------------- */
const Settings = {
  lookSens: 1, volume: 0.85, brightness: 1, fov: 72, camScare: true, perf: null,   // perf: null=otomatik (mobilde açık), true/false=elle
  load() { try { Object.assign(this, JSON.parse(localStorage.getItem("orm_settings") || "{}")); } catch (e) {} },
  save() { try { localStorage.setItem("orm_settings", JSON.stringify({ lookSens: this.lookSens, volume: this.volume, brightness: this.brightness, fov: this.fov, camScare: this.camScare, perf: this.perf })); } catch (e) {} },
};
Settings.load();
function isMobileish() { return ("ontouchstart" in window) || (window.matchMedia && window.matchMedia("(pointer: coarse)").matches) || window.innerWidth < 820; }
let lowQuality = false;
function applyPerf() {   // 🚀 PERFORMANS MODU: postFX'i (bloom/AO/vignette) atla + pixelRatio düşür → çok daha akıcı
  lowQuality = Settings.perf != null ? !!Settings.perf : isMobileish();   // otomatik: mobilde açık
  postOn = lowQuality ? false : !!composer;
  resize();   // pixelRatio'yu yeni moda göre uygula
}
function applySettings() {
  Sound.setVol(Settings.volume);
  if (renderer) renderer.toneMappingExposure = 1.12 * Settings.brightness;
  if (camera) { camera.fov = Settings.fov; camera.updateProjectionMatrix(); }
  applyPerf();
}

function toast(text, cls) {
  const d = document.createElement("div");
  d.className = "toast" + (cls ? " " + cls : ""); d.textContent = text;
  toastsEl.appendChild(d); setTimeout(() => d.remove(), 2500);
}
let whisperT = 0;
function whisperText(t) { whisperEl.textContent = t; whisperT = 2.2; }

/* ----------------------- SOUND (prosedürel) ----------------------- */
const Sound = {
  ctx: null, master: null, on: true, vol: 0.85,
  init() {
    if (this.ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
    this.ctx = new AC(); this.master = this.ctx.createGain();
    this.master.gain.value = this.on ? this.vol : 0; this.master.connect(this.ctx.destination);
    this._ambient();
  },
  resume() { if (this.ctx && this.ctx.state === "suspended") this.ctx.resume(); },
  setOn(v) { this.on = v; if (this.master) this.master.gain.value = v ? this.vol : 0; },
  setVol(v) { this.vol = v; if (this.master && this.on) this.master.gain.value = v; },
  thunder() { if (!this.ctx) return; const c = this.ctx, t = c.currentTime; this._burst(1.4, "lowpass", 260, 0.9); const o = c.createOscillator(), g = c.createGain(); o.type = "sine"; o.frequency.setValueAtTime(60, t); o.frequency.exponentialRampToValueAtTime(24, t + 1.0); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.8, t + 0.05); g.gain.exponentialRampToValueAtTime(0.0001, t + 1.3); o.connect(g); g.connect(this.master); o.start(); o.stop(t + 1.35); },
  rainTick() { this._burst(0.05, "highpass", 4000, 0.04); },
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
  gun() { if (!this.ctx) return; const c = this.ctx, t = c.currentTime; this._burst(0.18, "highpass", 1800, 0.9); const o = c.createOscillator(), g = c.createGain(); o.type = "square"; o.frequency.setValueAtTime(180, t); o.frequency.exponentialRampToValueAtTime(40, t + 0.12); g.gain.setValueAtTime(0.9, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.18); o.connect(g); g.connect(this.master); o.start(); o.stop(t + 0.2); },
  bow() { if (!this.ctx) return; const c = this.ctx, t = c.currentTime, o = c.createOscillator(), g = c.createGain(); o.type = "triangle"; o.frequency.setValueAtTime(420, t); o.frequency.exponentialRampToValueAtTime(120, t + 0.12); g.gain.setValueAtTime(0.4, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.14); o.connect(g); g.connect(this.master); o.start(); o.stop(t + 0.16); },
  reload() { this._burst(0.06, "bandpass", 800, 0.3); },
  punch() { if (!this.ctx) return; const c = this.ctx, t = c.currentTime; this._burst(0.2, "lowpass", 320, 0.95); const o = c.createOscillator(), g = c.createGain(); o.type = "sine"; o.frequency.setValueAtTime(95, t); o.frequency.exponentialRampToValueAtTime(38, t + 0.16); g.gain.setValueAtTime(0.95, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.2); o.connect(g); g.connect(this.master); o.start(); o.stop(t + 0.22); },
  glitchNoise() { if (!this.ctx) return; this._burst(0.5, "highpass", 1200, 0.8); this._burst(0.5, "lowpass", 200, 0.6); },
  crackle() { this._burst(0.05, "highpass", 2200, 0.06); },
  whisper() { this._burst(1.1, "bandpass", 1700, 0.13); },
  whoosh() { if (!this.ctx) return; const c = this.ctx, t = c.currentTime, s = c.createBufferSource(); s.buffer = this._noise(0.6); const f = c.createBiquadFilter(); f.type = "lowpass"; f.frequency.setValueAtTime(1800, t); f.frequency.exponentialRampToValueAtTime(180, t + 0.55); const g = c.createGain(); g.gain.setValueAtTime(0.25, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.6); s.connect(f); f.connect(g); g.connect(this.master); s.start(); s.stop(t + 0.62); },
  growl() { if (!this.ctx) return; const c = this.ctx, t = c.currentTime, o = c.createOscillator(), g = c.createGain(), lfo = c.createOscillator(), lg = c.createGain(); o.type = "sawtooth"; o.frequency.value = 90; lfo.type = "sine"; lfo.frequency.value = 22; lg.gain.value = 30; lfo.connect(lg); lg.connect(o.frequency); const f = c.createBiquadFilter(); f.type = "lowpass"; f.frequency.value = 500; g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.3, t + 0.1); g.gain.linearRampToValueAtTime(0.0001, t + 0.7); o.connect(f); f.connect(g); g.connect(this.master); o.start(); lfo.start(); o.stop(t + 0.75); lfo.stop(t + 0.75); },
  screech() {
    if (!this.ctx) return; const c = this.ctx, t = c.currentTime;
    this._burst(0.8, "highpass", 700, 1.0);                       // sert gürültü
    // inen çığlık (detune'lu testere)
    const o1 = c.createOscillator(), o2 = c.createOscillator(), og = c.createGain();
    o1.type = "sawtooth"; o2.type = "sawtooth";
    o1.frequency.setValueAtTime(1500, t); o1.frequency.exponentialRampToValueAtTime(160, t + 0.6);
    o2.frequency.setValueAtTime(1590, t); o2.frequency.exponentialRampToValueAtTime(130, t + 0.6);
    og.gain.setValueAtTime(0.0001, t); og.gain.exponentialRampToValueAtTime(0.6, t + 0.02); og.gain.exponentialRampToValueAtTime(0.0001, t + 0.7);
    o1.connect(og); o2.connect(og); og.connect(this.master); o1.start(); o2.start(); o1.stop(t + 0.72); o2.stop(t + 0.72);
    // bas patlama (göğüste hissedilen "boom")
    const b = c.createOscillator(), bg = c.createGain();
    b.type = "sine"; b.frequency.setValueAtTime(120, t); b.frequency.exponentialRampToValueAtTime(34, t + 0.4);
    bg.gain.setValueAtTime(0.0001, t); bg.gain.exponentialRampToValueAtTime(0.9, t + 0.015); bg.gain.exponentialRampToValueAtTime(0.0001, t + 0.5);
    b.connect(bg); bg.connect(this.master); b.start(); b.stop(t + 0.52);
  },
};

/* ----------------------- THREE setup ----------------------- */
let renderer, scene, camera, sun, hemi, amb, headlamp, moon, fireflies, rain;
let skyDome, stars, moonMesh, motes, sunGlow;   // gökyüzü kubbesi + yıldız + ay + toz zerreleri + güneş parıltısı
const windU = { value: 0 };                     // bitki rüzgâr salınımı için paylaşılan zaman uniform'u
let shadowsOn = false;
let composer = null, postOn = false, postTried = false, grainPass = null;
const clock = new THREE.Clock();
let built = false;

// Prosedürel gökyüzü env haritası (PMREM). Metalik materyaller (silah/metal/zırh/su)
// yansıtacak bir ortam olmayınca KAPKARA/mavi-siyah render olur; bu onu düzeltir.
function makeEnvMap() {
  try {
    const c = document.createElement("canvas"); c.width = 64; c.height = 32;
    const g = c.getContext("2d"); if (!g) return null;
    const grd = g.createLinearGradient(0, 0, 0, 32);
    grd.addColorStop(0.0, "#6f86ac");   // zenit — soluk gök mavisi (loş: geceyi yıkamaz)
    grd.addColorStop(0.55, "#8f988a");  // ufuk — nötr
    grd.addColorStop(1.0, "#2c352a");   // zemin — yeşilimsi (orman)
    g.fillStyle = grd; g.fillRect(0, 0, 64, 32);
    const tex = new THREE.CanvasTexture(c);
    if (THREE.EquirectangularReflectionMapping) tex.mapping = THREE.EquirectangularReflectionMapping;
    if (renderer && THREE.PMREMGenerator) {   // gerçek renderer varsa düzgün PMREM üret
      const pm = new THREE.PMREMGenerator(renderer);
      const env = pm.fromEquirectangular(tex).texture;
      pm.dispose(); tex.dispose();
      return env;
    }
    return tex;   // yedek: ham eşdörtgen doku (yine de siyah metali kırar)
  } catch (e) { return null; }   // headless/gerçek olmayan renderer: sessizce atla
}

function buildScene() {
  renderer = new THREE.WebGLRenderer({ canvas: threeCanvas, antialias: true, powerPreference: "high-performance" });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;   // sinematik renk
  renderer.toneMappingExposure = 1.12 * Settings.brightness;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  // gölgeler ağır olduğundan yalnızca dokunmatik olmayan (masaüstü) cihazlarda
  shadowsOn = !("ontouchstart" in window) && !(window.matchMedia && window.matchMedia("(pointer: coarse)").matches);
  if (shadowsOn) { renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap; }

  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x9fb7a0);
  scene.fog = new THREE.FogExp2(0x9fb7a0, 0.014);
  { const env = makeEnvMap(); if (env) scene.environment = env; }   // metallere gökyüzü yansıması ver → "siyah-mavi" metaller düzelir

  camera = new THREE.PerspectiveCamera(Settings.fov, window.innerWidth / window.innerHeight, 0.1, 600);
  camera.rotation.order = "YXZ";

  hemi = new THREE.HemisphereLight(0xbfd8c0, 0x1a2814, 0.9); scene.add(hemi);
  amb = new THREE.AmbientLight(0x405040, 0.45); scene.add(amb);
  sun = new THREE.DirectionalLight(0xffe8c4, 1.2); sun.position.set(40, 80, 20); scene.add(sun); scene.add(sun.target);
  moon = new THREE.DirectionalLight(0x8ea6d8, 0.0); moon.position.set(-30, 60, -20); scene.add(moon); // gece silüetleri için soluk ay ışığı
  headlamp = new THREE.PointLight(0xffe6c0, 0.0, 13, 1.6); scene.add(headlamp);
  if (shadowsOn) {
    sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048);
    const sc = sun.shadow.camera; sc.near = 1; sc.far = 160; sc.left = -45; sc.right = 45; sc.top = 45; sc.bottom = -45;
    sun.shadow.bias = -0.0006;
  }

  // paylaşılan yapı dokuları (ahşap/taş) + zemin kabartma haritası
  woodTex = woodTexture(); stoneTex = stoneTexture(); groundNormTex = groundNormalTexture();
  // zemin (prosedürel doku + kabartma normal haritası → güneş altında yüzey canlanır)
  const gtex = groundTexture();
  biomeGroundTex.forest = gtex;   // biyoma özel zemin dokuları önbelleği (kullanıldıkça üretilir)
  groundMat = new THREE.MeshStandardMaterial({ map: gtex, normalMap: groundNormTex, normalScale: new THREE.Vector2(0.55, 0.55), roughness: 0.96, metalness: 0 });
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(CFG.WORLD * 2 + 20, CFG.WORLD * 2 + 20), groundMat);
  ground.rotation.x = -Math.PI / 2; if (shadowsOn) ground.receiveShadow = true; scene.add(ground);

  buildBiomes();                  // biyom zemin renkleri + kar/lav/peri dekorları + atmosfer parçacıkları
  buildTrees();
  setupTreeModel();               // gerçek GLB ağaç paketi (low-poly) — prosedürel ağaçların yerini alır
  buildScatter();
  buildStructures();              // metal hurda + sandık + kulübeler
  buildWater();                   // parıldayan su birikintileri
  buildFlowers();                 // renkli çiçekler (zemin canlılığı)
  buildTreeline();                // uzaktaki ağaç silüeti (ufuk derinliği)
  buildSky();                     // gradyan gökyüzü + yıldız + ay + güneş parıltısı
  buildMotes();                   // gündüz toz/polen zerreleri
  buildFireflies();
  buildRain();                    // yağmur sistemi (hava durumu)
  setupBirds();                   // gerçek CC0 model kuşlar (animasyonlu)
  setupAnimalModels();            // gerçek CC0 geyik + jaguar modeli
  if (shadowsOn) setupPostFX();   // sinematik post-fx (masaüstü)
}

/* ----- gerçek 3B model kuşlar (CC0 GLTF, three.js örnekleri) ----- */
const birds = [];
async function setupBirds() {
  try {
    const { GLTFLoader } = await import("three/addons/loaders/GLTFLoader.js");
    const loader = new GLTFLoader();
    for (const f of ["./Parrot.glb", "./Flamingo.glb", "./Stork.glb"]) {
      loader.load(f, (gltf) => {
        const clip = gltf.animations && gltf.animations[0];
        const n = 2 + (Math.random() * 2 | 0);
        for (let i = 0; i < n; i++) {
          const root = gltf.scene.clone(true); root.scale.setScalar(0.06);
          root.traverse((o) => { if (o.isMesh) { o.castShadow = false; o.frustumCulled = false; } });
          scene.add(root);
          const mixer = new THREE.AnimationMixer(root);
          if (clip) mixer.clipAction(clip).play();
          birds.push({ root, mixer, R: rnd(28, 75), a: rnd(0, 6.28), sp: rnd(0.08, 0.2) * (Math.random() < 0.5 ? 1 : -1), cy: rnd(16, 36), bob: rnd(0, 6.28) });
        }
      }, undefined, () => {});
    }
  } catch (e) { /* GLTFLoader yoksa (ör. importmap-only) kuşlar atlanır */ }
}
function updateBirds(dt) {
  if (!birds.length) return;
  const cx = camera.position.x, cz = camera.position.z, tt = performance.now() / 1000;
  for (const b of birds) {
    b.a += b.sp * dt;
    b.root.position.set(cx + Math.cos(b.a) * b.R, b.cy + Math.sin(tt + b.bob) * 2.2, cz + Math.sin(b.a) * b.R);
    // uçuş yönüne dön (model +Z burunlu): hız teğeti = (-sin a, cos a)*sp → atan2 ile (ters uçma fix)
    b.root.rotation.y = Math.atan2(-Math.sin(b.a) * b.sp, Math.cos(b.a) * b.sp);
    b.mixer.update(dt);
  }
}

/* ----- gerçek CC0 geyik + jaguar modelleri ----- */
let deerProto = null, jaguarProto = null, jaguarClip = null, SkeletonUtilsMod = null;
let watcherProto = null, mimicProto = null;   // necromorph (İzleyen) + devitalizer (Taklitçi) korku modelleri
const animalProtos = {};   // boar/capybara/tapir GLB'leri — public/ içine konursa OTOMATİK kullanılır
function groundModel(p, targetH) {   // modeli ~targetH birime ölçekle + ayaklarını yere koy
  const box = new THREE.Box3().setFromObject(p), size = new THREE.Vector3(); box.getSize(size);
  p.scale.setScalar(targetH / (size.y || 1));
  const box2 = new THREE.Box3().setFromObject(p); p.position.y -= box2.min.y;
  p.traverse((o) => { if (o.isMesh && shadowsOn) o.castShadow = true; });
  return p;
}
async function setupAnimalModels() {
  try {
    const { GLTFLoader } = await import("three/addons/loaders/GLTFLoader.js");
    try { SkeletonUtilsMod = await import("three/addons/utils/SkeletonUtils.js"); } catch (e) { SkeletonUtilsMod = null; }
    const loader = new GLTFLoader();
    loader.load("./Deer.glb", (gltf) => { deerProto = groundModel(gltf.scene, 1.5); }, undefined, () => {});
    loader.load("./jaguar.glb", (gltf) => {
      jaguarProto = groundModel(gltf.scene, 1.15);                 // ~av boyu (kutu jaguar yaklaşık 1.1 yüksek)
      jaguarClip = (gltf.animations && gltf.animations[0]) || null; // tek birleşik "All Animations" klibi
    }, undefined, () => {});
    // Boar/Capybara/Tapir: dosya public/ içinde varsa otomatik kullanılır, yoksa kutu modele düşülür.
    for (const [type, file, h] of [["boar", "./Boar.glb", 0.95], ["capybara", "./Capybara.glb", 0.7], ["tapir", "./Tapir.glb", 1.1]]) {
      loader.load(file, (gltf) => { animalProtos[type] = { proto: groundModel(gltf.scene, h), clip: (gltf.animations && gltf.animations[0]) || null }; }, undefined, () => {});
    }
    // Korku modelleri: necromorph → İzleyen, devitalizer → Taklitçi
    loader.load("./necromorph.glb", (gltf) => { watcherProto = groundModel(gltf.scene, 4.2); }, undefined, () => {});
    loader.load("./devitalizer.glb", (gltf) => { mimicProto = groundModel(gltf.scene, 2.0); }, undefined, () => {});
  } catch (e) { /* model yoksa kutu hayvanlar kullanılır */ }
}

/* ----- sinematik post-processing: AO + bloom + film grain + vignette ----- */
async function setupPostFX() {
  if (postTried) return; postTried = true;
  try {
    const [EC, RP, BLOOM, OUT, SP] = await Promise.all([
      import("three/addons/postprocessing/EffectComposer.js"),
      import("three/addons/postprocessing/RenderPass.js"),
      import("three/addons/postprocessing/UnrealBloomPass.js"),
      import("three/addons/postprocessing/OutputPass.js"),
      import("three/addons/postprocessing/ShaderPass.js"),
    ]);
    const w = window.innerWidth, h = window.innerHeight;
    const comp = new EC.EffectComposer(renderer);
    comp.addPass(new RP.RenderPass(scene, camera));
    const bloom = new BLOOM.UnrealBloomPass(new THREE.Vector2(w, h), 0.8, 0.6, 0.82); comp.addPass(bloom); // yalnızca GERÇEK parlak şeyler (ateş/lav/gözler) — gökyüzü/su artık yıkanmıyor
    // sinematik: kromatik sapma + renk derecelendirme (teal-turuncu) + güçlü vignette + film grain
    grainPass = new SP.ShaderPass({
      uniforms: { tDiffuse: { value: null }, t: { value: 0 }, vig: { value: 1.15 }, grain: { value: 0.06 }, ca: { value: 1.0 } },
      vertexShader: "varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }",
      fragmentShader:
        "uniform sampler2D tDiffuse; uniform float t, vig, grain, ca; varying vec2 vUv;" +
        "float rand(vec2 c){return fract(sin(dot(c,vec2(12.9898,78.233)))*43758.5453);}" +
        "void main(){ vec2 q=vUv-0.5; float r2=dot(q,q);" +
        " vec2 off = q * r2 * 0.012 * ca;" +                                                          // kromatik sapma (kenarlarda)
        " vec3 col; col.r=texture2D(tDiffuse,vUv+off).r; col.g=texture2D(tDiffuse,vUv).g; col.b=texture2D(tDiffuse,vUv-off).b;" +
        " float l=dot(col,vec3(0.299,0.587,0.114)); col=mix(vec3(l),col,1.17);" +                     // doygunluk
        " col=mix(col, col*col*(3.0-2.0*col), 0.2);" +                                                 // yumuşak kontrast (S-eğrisi)
        " col.rgb*=vec3(1.03,1.0,0.97); col.rgb+=vec3(0.015,0.01,-0.01)*(1.0-l);" +                    // sıcak ışık / soğuk gölge (sinematik)
        " float v=smoothstep(0.95,0.28,length(q)*vig); col.rgb*=mix(0.42,1.0,v);" +                   // güçlü vignette
        " float g=(rand(vUv*vec2(t*60.0+1.0, t*37.0+1.0))-0.5)*grain; col.rgb+=g;" +                   // film grain
        " gl_FragColor=vec4(clamp(col,0.0,1.0),1.0); }",
    });
    comp.addPass(grainPass);
    comp.addPass(new OUT.OutputPass());
    comp.setSize(w, h); comp.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    composer = comp; postOn = true;
  } catch (e) { console.warn("[postfx] yüklenemedi, düz render:", e); postOn = false; }
}

/* ----- yağmur (Points) ----- */
function buildRain() {
  const N = 1000, pos = new Float32Array(N * 3), vel = new Float32Array(N);
  for (let i = 0; i < N; i++) { pos[i * 3] = rnd(-40, 40); pos[i * 3 + 1] = rnd(0, 34); pos[i * 3 + 2] = rnd(-40, 40); vel[i] = rnd(30, 46); }
  const geo = new THREE.BufferGeometry(); geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  const mat = new THREE.PointsMaterial({ color: 0x9fb0c8, size: 0.13, transparent: true, opacity: 0.5, depthWrite: false });
  rain = new THREE.Points(geo, mat); rain.frustumCulled = false; rain.visible = false; rain.userData.vel = vel; scene.add(rain);
}
function updateRain(dt) {
  if (!rain || !rain.visible) return;
  rain.position.set(camera.position.x, 0, camera.position.z);
  const ar = rain.geometry.attributes.position.array, vel = rain.userData.vel;
  for (let i = 0; i < vel.length; i++) { ar[i * 3 + 1] -= vel[i] * dt; if (ar[i * 3 + 1] < 0) { ar[i * 3] = rnd(-40, 40); ar[i * 3 + 1] = rnd(22, 36); ar[i * 3 + 2] = rnd(-40, 40); } }
  rain.geometry.attributes.position.needsUpdate = true;
}

/* ----- gökyüzü kubbesi + yıldız + ay (gradyan + güneş parıltısı) ----- */
function buildSky() {
  const skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { top: { value: new THREE.Color(0x2f6aa6) }, bottom: { value: new THREE.Color(0x9fb7a0) }, sunDir: { value: new THREE.Vector3(0, 1, 0) }, sunCol: { value: new THREE.Color(0xffe6b0) }, sunI: { value: 1 }, time: { value: 0 } },
    vertexShader: "varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }",
    fragmentShader:
      "uniform vec3 top,bottom,sunCol,sunDir; uniform float sunI, time; varying vec3 vDir;" +
      "float hash(vec2 p){ return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453); }" +
      "float noise(vec2 p){ vec2 i=floor(p),f=fract(p); f=f*f*(3.0-2.0*f); float a=hash(i),b=hash(i+vec2(1,0)),c=hash(i+vec2(0,1)),d=hash(i+vec2(1,1)); return mix(mix(a,b,f.x),mix(c,d,f.x),f.y); }" +
      "float fbm(vec2 p){ float v=0.0,a=0.5; for(int i=0;i<3;i++){ v+=a*noise(p); p*=2.02; a*=0.5; } return v; }" +
      "void main(){ vec3 dir = normalize(vDir); float h = clamp(dir.y*0.5+0.5,0.0,1.0); vec3 col = mix(bottom, top, pow(h,0.55));" +
      " float haze = smoothstep(0.42,0.0,abs(dir.y-0.02)); col = mix(col, sunCol*0.55+col*0.55, haze*0.35*sunI);" +          // ufuk pusu
      " if (dir.y > 0.015){ vec2 uv = dir.xz/(dir.y+0.35) + vec2(time*0.006, time*0.002); float cl = fbm(uv*1.6);" +          // sürüklenen bulutlar
      "   cl = smoothstep(0.52,0.92,cl) * smoothstep(0.015,0.22,dir.y); col = mix(col, mix(vec3(0.9,0.92,0.97), sunCol, 0.22), cl*0.55*sunI); }" +
      " float s = max(dot(dir, normalize(sunDir)),0.0);" +
      " col += sunCol * (pow(s,340.0)*2.2 + pow(s,18.0)*0.42 + pow(s,4.0)*0.12) * sunI;" +
      " gl_FragColor = vec4(col,1.0); }",
  });
  skyDome = new THREE.Mesh(new THREE.SphereGeometry(500, 24, 16), skyMat);
  skyDome.renderOrder = -2; skyDome.frustumCulled = false; scene.add(skyDome);
  // yıldızlar (üst yarımküre)
  const SN = 1300, sp = new Float32Array(SN * 3);
  for (let i = 0; i < SN; i++) { const a = rnd(0, 6.283), r = 470, y = rnd(0.05, 1); const s2 = Math.sqrt(1 - y * y); sp[i * 3] = r * s2 * Math.cos(a); sp[i * 3 + 1] = r * y + 30; sp[i * 3 + 2] = r * s2 * Math.sin(a); }
  const sgeo = new THREE.BufferGeometry(); sgeo.setAttribute("position", new THREE.BufferAttribute(sp, 3));
  stars = new THREE.Points(sgeo, new THREE.PointsMaterial({ color: 0xcfe0ff, size: 1.7, sizeAttenuation: false, transparent: true, opacity: 0, depthWrite: false, fog: false }));
  stars.frustumCulled = false; stars.renderOrder = -1; scene.add(stars);
  // ay
  moonMesh = new THREE.Mesh(new THREE.CircleGeometry(24, 28), new THREE.MeshBasicMaterial({ color: 0xe6ecf2, transparent: true, opacity: 0, fog: false, depthWrite: false }));
  moonMesh.frustumCulled = false; moonMesh.renderOrder = -1; scene.add(moonMesh);
  // güneş parıltısı (gökte yumuşak ışık topu — bloom ile huzme hissi verir)
  sunGlow = new THREE.Mesh(new THREE.PlaneGeometry(160, 160), new THREE.MeshBasicMaterial({ map: dotSprite(), color: 0xffe2a0, transparent: true, opacity: 0, depthWrite: false, fog: false, blending: THREE.AdditiveBlending }));
  sunGlow.frustumCulled = false; sunGlow.renderOrder = -1; scene.add(sunGlow);
}
const _skyTop = new THREE.Color(), _skyNight = new THREE.Color(0x0a1124), _skyDay = new THREE.Color(0x2f6aa6), _biomeSky = new THREE.Color();
function updateSky(dk, dayK, horiz, sunAng) {
  if (skyDome) {
    skyDome.position.copy(camera.position);
    const u = skyDome.material.uniforms;
    _skyTop.copy(_skyNight).lerp(_skyDay, dayK); if (S.bloodMoon && dk > 0.3) _skyTop.lerp(new THREE.Color(0x2a0608), 0.5);
    if (curBiome !== "forest" && BIOMES[curBiome] && BIOMES[curBiome].sky != null) _skyTop.lerp(_biomeSky.setHex(BIOMES[curBiome].sky), 0.55 * dayK);   // biyoma özel gökyüzü (gündüz)
    u.top.value.copy(_skyTop); u.bottom.value.copy(horiz);
    u.sunDir.value.set(Math.cos(sunAng), Math.max(Math.sin(sunAng), -0.15), 0.35).normalize();
    u.sunI.value = 0.25 + dayK;
    if (u.time) u.time.value = performance.now() / 1000;
  }
  if (stars) { stars.material.opacity = dk * 0.95; stars.position.copy(camera.position); }
  if (moonMesh) { moonMesh.material.opacity = dk * 0.95; const mA = sunAng + Math.PI; moonMesh.position.set(camera.position.x + Math.cos(mA) * 280, camera.position.y + 120 + Math.sin(mA) * 60, camera.position.z - 260); moonMesh.lookAt(camera.position); }
  if (sunGlow && skyDome) { const sd = skyDome.material.uniforms.sunDir.value; sunGlow.position.set(camera.position.x + sd.x * 300, camera.position.y + sd.y * 300, camera.position.z + sd.z * 300); sunGlow.lookAt(camera.position); sunGlow.material.opacity = clamp(dayK * 0.55, 0, 0.55); }
}

/* ----- toz/polen zerreleri (gündüz havada süzülür) ----- */
function buildMotes() {
  const N = 240, p = new Float32Array(N * 3);
  for (let i = 0; i < N; i++) { p[i * 3] = rnd(-42, 42); p[i * 3 + 1] = rnd(0.5, 10); p[i * 3 + 2] = rnd(-42, 42); }
  const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.BufferAttribute(p, 3));
  motes = new THREE.Points(g, new THREE.PointsMaterial({ color: 0xfff0c0, size: 0.16, map: dotSprite(), transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending }));
  motes.frustumCulled = false; motes.userData.ph = new Float32Array(N).map(() => rnd(0, 6.28)); scene.add(motes);
}

/* ----- bitki rüzgâr salınımı (shader enjeksiyonu) ----- */
function applyWind(mat, amount) {
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = windU;
    shader.vertexShader = "uniform float uTime;\n" + shader.vertexShader.replace(
      "#include <begin_vertex>",
      "#include <begin_vertex>\n vec4 _wp = instanceMatrix * vec4(transformed,1.0); float _ph=_wp.x*0.35+_wp.z*0.35; float _sw=clamp(position.y,0.0,4.0)*" + amount.toFixed(3) + "; transformed.x += sin(uTime*1.6+_ph)*_sw; transformed.z += cos(uTime*1.25+_ph)*_sw;"
    );
  };
  mat.needsUpdate = true;
}

/* ----- su birikintileri (parıldayan, gökyüzü tonlu) ----- */
const waters = [];   // {x,z,r} — göller: yanına git, G ile su iç (susuzluk giderir)
let waterTex = null, waterMat = null, waterNrm = null;
function nearWater() { const px = camera.position.x, pz = camera.position.z; return waters.some((w) => Math.hypot(w.x - px, w.z - pz) < w.r + 1.5); }
function waterTexture() {
  const N = 512, c = document.createElement("canvas"); c.width = c.height = N; const g = c.getContext("2d");
  const grad = g.createRadialGradient(N / 2, N / 2, 40, N / 2, N / 2, N * 0.7); grad.addColorStop(0, "#1c5a72"); grad.addColorStop(1, "#0e2e42"); g.fillStyle = grad; g.fillRect(0, 0, N, N);
  // katmanlı dalga çizgileri (kostik hissi)
  for (let i = 0; i < 70; i++) { g.strokeStyle = `rgba(190,228,240,${rnd(0.06, 0.22)})`; g.lineWidth = rnd(1, 3); g.beginPath(); const y = Math.random() * N, amp = rnd(4, 12), fr = rnd(0.04, 0.12); g.moveTo(0, y); for (let x = 0; x <= N; x += 12) g.lineTo(x, y + Math.sin(x * fr + i) * amp); g.stroke(); }
  // parıltı benekleri
  for (let i = 0; i < 260; i++) { g.fillStyle = `rgba(220,245,255,${rnd(0.15, 0.5)})`; g.beginPath(); g.arc(Math.random() * N, Math.random() * N, Math.random() * 1.8 + 0.4, 0, 6.3); g.fill(); }
  waterTex = new THREE.CanvasTexture(c); waterTex.wrapS = waterTex.wrapT = THREE.RepeatWrapping; waterTex.repeat.set(2, 2); waterTex.anisotropy = 8; return waterTex;
}
function buildWater() {
  const tex = waterTexture(), nrm = groundNormalTexture(); nrm.repeat.set(6, 6);
  waterMat = new THREE.MeshStandardMaterial({ map: tex, normalMap: nrm, normalScale: new THREE.Vector2(0.35, 0.35), color: 0x4488b0, transparent: true, opacity: 0.8, metalness: 0.1, roughness: 0.42, emissive: 0x123245, emissiveIntensity: 0.28 });
  waterNrm = nrm;
  for (let i = 0; i < 5; i++) {
    const [x, z] = farFromSpawn(30); const r = rnd(6, 13);
    const m = new THREE.Mesh(new THREE.CircleGeometry(r, 32), waterMat); m.rotation.x = -Math.PI / 2; m.position.set(x, 0.06, z); m.receiveShadow = false; scene.add(m);
    waters.push({ x, z, r });   // içilebilir göl
  }
}

/* ----- renkli çiçekler + uzaktaki ağaç silüeti (derinlik) ----- */
function buildFlowers() {
  const headGeo = new THREE.IcosahedronGeometry(0.13, 0);
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.8, emissive: 0x111111, emissiveIntensity: 0.15, flatShading: true });
  const N = 420, im = new THREE.InstancedMesh(headGeo, mat, N); im.frustumCulled = false; if (shadowsOn) im.castShadow = true;
  const col = new THREE.Color(), hues = [0.0, 0.08, 0.13, 0.83, 0.6, 0.95];
  for (let i = 0; i < N; i++) { _d.position.set(rnd(-CFG.WORLD, CFG.WORLD), rnd(0.25, 0.5), rnd(-CFG.WORLD, CFG.WORLD)); _d.rotation.set(0, rnd(0, 6.3), 0); _d.scale.setScalar(rnd(0.7, 1.6)); _d.updateMatrix(); im.setMatrixAt(i, _d.matrix); col.setHSL(choice(hues), rnd(0.6, 0.9), rnd(0.55, 0.7)); im.setColorAt(i, col); }
  im.instanceColor.needsUpdate = true; scene.add(im);
}
function buildTreeline() {
  // dünya kenarının hemen dışında koyu ağaç silüetleri — "orman devam ediyor" hissi + düz sınırı gizler
  const geo = new THREE.ConeGeometry(4, 16, 6);
  const mat = new THREE.MeshStandardMaterial({ color: 0x0e1c12, roughness: 1, flatShading: true });
  const N = 140, im = new THREE.InstancedMesh(geo, mat, N); im.frustumCulled = false;
  for (let i = 0; i < N; i++) { const a = (i / N) * 6.283 + rnd(-0.02, 0.02), rad = CFG.WORLD + rnd(8, 55); _d.position.set(Math.cos(a) * rad, rnd(5, 9), Math.sin(a) * rad); _d.rotation.set(0, rnd(0, 6.3), 0); _d.scale.set(rnd(0.8, 1.8), rnd(0.9, 2.0), rnd(0.8, 1.8)); _d.updateMatrix(); im.setMatrixAt(i, _d.matrix); }
  scene.add(im);
}

/* ----- ateş böcekleri / gece parıltıları (Points) ----- */
function buildFireflies() {
  const N = 260, pos = new Float32Array(N * 3);
  for (let i = 0; i < N; i++) { pos[i * 3] = rnd(-60, 60); pos[i * 3 + 1] = rnd(0.5, 6); pos[i * 3 + 2] = rnd(-60, 60); }
  const geo = new THREE.BufferGeometry(); geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  const mat = new THREE.PointsMaterial({ color: 0xcaff8a, size: 0.42, map: dotSprite(), transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending });
  fireflies = new THREE.Points(geo, mat); fireflies.frustumCulled = false; fireflies.userData.phase = new Float32Array(N).map(() => rnd(0, 6.28));
  scene.add(fireflies);
}

function groundTexture() {
  const N = 1024, c = document.createElement("canvas"); c.width = c.height = N; const g = c.getContext("2d");
  // derin katmanlı taban
  const base = g.createLinearGradient(0, 0, N, N); base.addColorStop(0, "#1e321b"); base.addColorStop(0.5, "#2b442a"); base.addColorStop(1, "#182b16");
  g.fillStyle = base; g.fillRect(0, 0, N, N);
  // büyük yumuşak renk bölgeleri (yosun / kuru toprak / nemli çukurlar) — radial gradient lekeleri
  const zones = ["#3a5a2e", "#4a5a30", "#5a4a2c", "#294a29", "#42361f", "#4e6634"];
  for (let i = 0; i < 30; i++) { const x = Math.random() * N, y = Math.random() * N, r = rnd(120, 320); const rg = g.createRadialGradient(x, y, 0, x, y, r); rg.addColorStop(0, choice(zones)); rg.addColorStop(1, "rgba(0,0,0,0)"); g.globalAlpha = rnd(0.14, 0.4); g.fillStyle = rg; g.beginPath(); g.arc(x, y, r, 0, 6.3); g.fill(); }
  g.globalAlpha = 1;
  // çok yoğun ince çakıl / toprak greni
  for (let i = 0; i < 17000; i++) { g.fillStyle = choice(["#15230e", "#2c4a26", "#34552c", "#3a3020", "#46582e", "#5a4a2c", "#233a1b", "#4e6634", "#6a5a34"]); const x = Math.random() * N, y = Math.random() * N, r = Math.random() * 2.3 + 0.35; g.globalAlpha = rnd(0.4, 1); g.beginPath(); g.arc(x, y, r, 0, 6.3); g.fill(); }
  g.globalAlpha = 1;
  // dağılmış yapraklar + dallar/çubuklar
  for (let i = 0; i < 760; i++) { g.save(); g.translate(Math.random() * N, Math.random() * N); g.rotate(rnd(0, 6.3)); g.fillStyle = choice(["#3c5a2a", "#4a6630", "#5a4326", "#6a5a30", "#2c481d", "#71603a"]); g.globalAlpha = rnd(0.5, 0.92); g.beginPath(); g.ellipse(0, 0, rnd(3, 7.5), rnd(1.2, 2.8), 0, 0, 6.3); g.fill(); g.restore(); }
  for (let i = 0; i < 130; i++) { g.save(); g.translate(Math.random() * N, Math.random() * N); g.rotate(rnd(0, 6.3)); g.strokeStyle = choice(["#3a2c18", "#4a3820", "#5a482a"]); g.globalAlpha = rnd(0.4, 0.8); g.lineWidth = rnd(1, 2.6); g.beginPath(); g.moveTo(0, 0); g.lineTo(rnd(7, 20), 0); g.stroke(); g.restore(); }
  // nem/ışık parıltısı highlight'ları
  for (let i = 0; i < 1100; i++) { g.fillStyle = "rgba(185,215,155,0.09)"; g.beginPath(); g.arc(Math.random() * N, Math.random() * N, Math.random() * 1.4 + 0.3, 0, 6.3); g.fill(); }
  g.globalAlpha = 1;
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(30, 30); t.anisotropy = 8; return t;
}
// biyom zemin dokusu: kar parıltısı / ışıyan lav çatlakları / peri sporları
function biomeTexture(kind) {
  const N = 512, c = document.createElement("canvas"); c.width = c.height = N; const g = c.getContext("2d");
  if (kind === "snow") {
    g.fillStyle = "#e7eff7"; g.fillRect(0, 0, N, N);
    for (let i = 0; i < 44; i++) { const x = Math.random() * N, y = Math.random() * N, r = rnd(28, 95); const rg = g.createRadialGradient(x, y, 0, x, y, r); rg.addColorStop(0, "#c7d6e8"); rg.addColorStop(1, "rgba(0,0,0,0)"); g.globalAlpha = 0.38; g.fillStyle = rg; g.beginPath(); g.arc(x, y, r, 0, 6.3); g.fill(); }
    g.globalAlpha = 1;
    for (let i = 0; i < 3200; i++) { g.fillStyle = Math.random() < 0.5 ? "#ffffff" : "#d3dfed"; g.beginPath(); g.arc(Math.random() * N, Math.random() * N, Math.random() * 1.6 + 0.3, 0, 6.3); g.fill(); }
    for (let i = 0; i < 420; i++) { g.fillStyle = "rgba(255,255,255,0.95)"; g.fillRect(Math.random() * N, Math.random() * N, rnd(1, 2.6), rnd(1, 2.6)); }
  } else if (kind === "volcanic") {
    g.fillStyle = "#130a07"; g.fillRect(0, 0, N, N);
    for (let i = 0; i < 28; i++) { g.fillStyle = choice(["#241410", "#190f0a", "#2a1a12"]); g.globalAlpha = rnd(0.5, 1); g.beginPath(); g.arc(Math.random() * N, Math.random() * N, rnd(20, 72), 0, 6.3); g.fill(); }
    g.globalAlpha = 1; g.strokeStyle = "#ff5a1e"; g.lineCap = "round";
    for (let i = 0; i < 28; i++) { g.lineWidth = rnd(1.5, 5); g.globalAlpha = rnd(0.6, 1); let x = Math.random() * N, y = Math.random() * N; g.beginPath(); g.moveTo(x, y); for (let k = 0; k < 5; k++) { x += rnd(-60, 60); y += rnd(-60, 60); g.lineTo(x, y); } g.stroke(); }
    g.globalAlpha = 1; for (let i = 0; i < 320; i++) { g.fillStyle = choice(["#ff8a2a", "#ffcc44", "#ff4400"]); g.beginPath(); g.arc(Math.random() * N, Math.random() * N, Math.random() * 2 + 0.5, 0, 6.3); g.fill(); }
  } else {
    const base = g.createLinearGradient(0, 0, N, N); base.addColorStop(0, "#48285c"); base.addColorStop(1, "#341e46"); g.fillStyle = base; g.fillRect(0, 0, N, N);
    for (let i = 0; i < 32; i++) { const x = Math.random() * N, y = Math.random() * N, r = rnd(40, 115); const rg = g.createRadialGradient(x, y, 0, x, y, r); rg.addColorStop(0, choice(["#7a4a9a", "#5a3a7a", "#6a4a8a"])); rg.addColorStop(1, "rgba(0,0,0,0)"); g.globalAlpha = 0.4; g.fillStyle = rg; g.beginPath(); g.arc(x, y, r, 0, 6.3); g.fill(); }
    g.globalAlpha = 1; for (let i = 0; i < 640; i++) { g.fillStyle = choice(["#ff8ae0", "#9b6cff", "#66e0ff", "#ffb0f2"]); g.beginPath(); g.arc(Math.random() * N, Math.random() * N, Math.random() * 2 + 0.4, 0, 6.3); g.fill(); }
  }
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(2, 2); t.anisotropy = 8; return t;
}
// zemin normal haritası (kabartma) — piksel okuma YOK (headless-güvenli); çizilmiş kabartılar
function groundNormalTexture() {
  const N = 512, c = document.createElement("canvas"); c.width = c.height = N; const g = c.getContext("2d");
  g.fillStyle = "#8080ff"; g.fillRect(0, 0, N, N);   // düz normal (yukarı bakan)
  for (let i = 0; i < 900; i++) {
    const x = Math.random() * N, y = Math.random() * N, r = rnd(3, 16), ang = rnd(0, 6.28);
    const rx = Math.round(128 + Math.cos(ang) * 70), gy = Math.round(128 + Math.sin(ang) * 70);
    const rg = g.createRadialGradient(x, y, 0, x, y, r); rg.addColorStop(0, `rgb(${rx},${gy},255)`); rg.addColorStop(1, "rgba(128,128,255,0)");
    g.fillStyle = rg; g.beginPath(); g.arc(x, y, r, 0, 6.3); g.fill();
  }
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(30, 30); t.anisotropy = 8; return t;
}
// ahşap dokusu (gövde/duvar/sandık) — dikey damar
function woodTexture() {
  const N = 256, c = document.createElement("canvas"); c.width = c.height = N; const g = c.getContext("2d");
  const base = g.createLinearGradient(0, 0, N, 0); base.addColorStop(0, "#5a3f22"); base.addColorStop(0.5, "#6b4a28"); base.addColorStop(1, "#4a3418"); g.fillStyle = base; g.fillRect(0, 0, N, N);
  for (let i = 0; i < 46; i++) { g.strokeStyle = `rgba(${rnd(40, 90) | 0},${rnd(28, 60) | 0},${rnd(14, 34) | 0},${rnd(0.15, 0.5)})`; g.lineWidth = rnd(0.6, 2.4); const x = Math.random() * N; g.beginPath(); g.moveTo(x, 0); for (let y = 0; y <= N; y += 10) g.lineTo(x + Math.sin(y * 0.06 + i) * 3, y); g.stroke(); }
  for (let i = 0; i < 6; i++) { const x = Math.random() * N, y = Math.random() * N; g.strokeStyle = "rgba(30,18,8,0.5)"; g.lineWidth = 1.5; for (let k = 3; k < 16; k += 3) { g.beginPath(); g.ellipse(x, y, k, k * 1.6, 0, 0, 6.3); g.stroke(); } }
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8; return t;
}
// taş dokusu (kilise/kule/mağara) — benekli bloklar + çatlaklar
function stoneTexture() {
  const N = 256, c = document.createElement("canvas"); c.width = c.height = N; const g = c.getContext("2d");
  g.fillStyle = "#4a4640"; g.fillRect(0, 0, N, N);
  for (let i = 0; i < 4000; i++) { g.fillStyle = choice(["#3a362f", "#565048", "#605a50", "#413c34", "#6a6458"]); g.globalAlpha = rnd(0.3, 0.8); g.beginPath(); g.arc(Math.random() * N, Math.random() * N, Math.random() * 2 + 0.4, 0, 6.3); g.fill(); }
  g.globalAlpha = 1; g.strokeStyle = "rgba(20,18,15,0.55)"; g.lineWidth = 1.4;
  for (let gy = 0; gy <= N; gy += 42) { g.beginPath(); g.moveTo(0, gy); g.lineTo(N, gy + rnd(-4, 4)); g.stroke(); }
  for (let i = 0; i < 6; i++) { const off = (i % 2) * 21; for (let gx = off; gx <= N; gx += 42) { g.beginPath(); g.moveTo(gx, i * 42); g.lineTo(gx + rnd(-3, 3), (i + 1) * 42); g.stroke(); } }
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8; return t;
}
let woodTex = null, stoneTex = null, groundNormTex = null;
let groundMat = null; const biomeGroundTex = {};   // biyoma göre değişen zemin materyali + doku önbelleği
// Biyoma özel BÜYÜK zemin dokuları (1024) — orman yeşili her yerde olmasın; kar/lav/peri zemini
function snowGroundTexture() {
  const N = 1024, c = document.createElement("canvas"); c.width = c.height = N; const g = c.getContext("2d");
  const base = g.createLinearGradient(0, 0, N, N); base.addColorStop(0, "#e9f0f8"); base.addColorStop(0.5, "#dbe6f2"); base.addColorStop(1, "#eef4fb"); g.fillStyle = base; g.fillRect(0, 0, N, N);
  for (let i = 0; i < 40; i++) { const x = Math.random() * N, y = Math.random() * N, r = rnd(90, 300); const rg = g.createRadialGradient(x, y, 0, x, y, r); rg.addColorStop(0, choice(["#c3d3e6", "#d6e2f0", "#b9cbe0"])); rg.addColorStop(1, "rgba(0,0,0,0)"); g.globalAlpha = rnd(0.2, 0.45); g.fillStyle = rg; g.beginPath(); g.arc(x, y, r, 0, 6.3); g.fill(); }   // rüzgâr kürtünleri
  g.globalAlpha = 1;
  for (let i = 0; i < 9000; i++) { g.fillStyle = Math.random() < 0.6 ? "#ffffff" : "#cfdcec"; g.beginPath(); g.arc(Math.random() * N, Math.random() * N, Math.random() * 1.7 + 0.3, 0, 6.3); g.fill(); }   // kar taneleri
  for (let i = 0; i < 900; i++) { g.fillStyle = "rgba(255,255,255,0.95)"; g.fillRect(Math.random() * N, Math.random() * N, rnd(1, 3), rnd(1, 3)); }   // parıltı
  for (let i = 0; i < 60; i++) { g.strokeStyle = "rgba(150,175,205,0.35)"; g.lineWidth = rnd(1, 2.5); const x = Math.random() * N, y = Math.random() * N; g.beginPath(); g.moveTo(x, y); g.lineTo(x + rnd(-40, 40), y + rnd(-40, 40)); g.stroke(); }   // buz çatlakları
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(26, 26); t.anisotropy = 8; return t;
}
function lavaGroundTexture() {
  const N = 1024, c = document.createElement("canvas"); c.width = c.height = N; const g = c.getContext("2d");
  g.fillStyle = "#14100d"; g.fillRect(0, 0, N, N);
  for (let i = 0; i < 34; i++) { g.fillStyle = choice(["#241713", "#1a110d", "#2c1c15", "#0f0a08"]); g.globalAlpha = rnd(0.5, 1); g.beginPath(); g.arc(Math.random() * N, Math.random() * N, rnd(50, 180), 0, 6.3); g.fill(); }   // yanmış kaya kütleleri
  g.globalAlpha = 1;
  for (let i = 0; i < 14000; i++) { g.fillStyle = choice(["#0e0906", "#2a1c14", "#382318", "#1c1310"]); g.beginPath(); g.arc(Math.random() * N, Math.random() * N, Math.random() * 2 + 0.3, 0, 6.3); g.fill(); }   // volkanik kum
  // ışıyan lav çatlakları (dallanan)
  for (let i = 0; i < 46; i++) { let x = Math.random() * N, y = Math.random() * N; for (let seg = 0; seg < 7; seg++) { const nx = x + rnd(-90, 90), ny = y + rnd(-90, 90); const grd = g.createLinearGradient(x, y, nx, ny); grd.addColorStop(0, "#ff3800"); grd.addColorStop(0.5, "#ff8a1e"); grd.addColorStop(1, "#ffcc44"); g.strokeStyle = grd; g.lineWidth = rnd(1.5, 5); g.lineCap = "round"; g.globalAlpha = rnd(0.6, 1); g.beginPath(); g.moveTo(x, y); g.lineTo(nx, ny); g.stroke(); x = nx; y = ny; } }
  g.globalAlpha = 1; for (let i = 0; i < 500; i++) { g.fillStyle = choice(["#ff9a2a", "#ffd24a", "#ff5500"]); g.beginPath(); g.arc(Math.random() * N, Math.random() * N, Math.random() * 2 + 0.4, 0, 6.3); g.fill(); }   // közler
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(24, 24); t.anisotropy = 8; return t;
}
function fairyGroundTexture() {
  const N = 1024, c = document.createElement("canvas"); c.width = c.height = N; const g = c.getContext("2d");
  const base = g.createLinearGradient(0, 0, N, N); base.addColorStop(0, "#3a2350"); base.addColorStop(0.5, "#4a2c64"); base.addColorStop(1, "#2e1c42"); g.fillStyle = base; g.fillRect(0, 0, N, N);
  for (let i = 0; i < 44; i++) { const x = Math.random() * N, y = Math.random() * N, r = rnd(80, 260); const rg = g.createRadialGradient(x, y, 0, x, y, r); rg.addColorStop(0, choice(["#6a3f9a", "#7a4aa8", "#553578", "#8a5ac0"])); rg.addColorStop(1, "rgba(0,0,0,0)"); g.globalAlpha = rnd(0.22, 0.5); g.fillStyle = rg; g.beginPath(); g.arc(x, y, r, 0, 6.3); g.fill(); }   // yumuşak mor yosun
  g.globalAlpha = 1;
  for (let i = 0; i < 12000; i++) { g.fillStyle = choice(["#4e2f6e", "#5e3a82", "#3e2758", "#6a4590"]); g.beginPath(); g.arc(Math.random() * N, Math.random() * N, Math.random() * 2 + 0.3, 0, 6.3); g.fill(); }   // gren
  for (let i = 0; i < 1500; i++) { g.fillStyle = choice(["#ff9ae8", "#b98cff", "#7ee6ff", "#ffc0f5", "#c0ff9a"]); g.globalAlpha = rnd(0.5, 1); g.beginPath(); g.arc(Math.random() * N, Math.random() * N, Math.random() * 2.4 + 0.5, 0, 6.3); g.fill(); }   // parlayan sporlar
  g.globalAlpha = 1;
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(24, 24); t.anisotropy = 8; return t;
}
// biyom değişince zemin dokusunu/rengini değiştir → her biyom kendine benzer (orman/kar/lav/peri)
function applyBiomeGround(biome) {
  if (!groundMat) return;
  if (biome === "caves") return;   // mağara kendi zeminine sahip; ana zemini değiştirme
  if (!biomeGroundTex[biome]) {
    biomeGroundTex[biome] = biome === "snow" ? snowGroundTexture() : biome === "volcanic" ? lavaGroundTexture() : biome === "fairy" ? fairyGroundTexture() : biomeGroundTex.forest;
  }
  groundMat.map = biomeGroundTex[biome];
  groundMat.roughness = biome === "snow" ? 0.7 : biome === "volcanic" ? 0.85 : 0.95;
  if (groundMat.emissive && groundMat.emissive.setHex) { groundMat.emissive.setHex(biome === "volcanic" ? 0x3a0a00 : biome === "fairy" ? 0x1a0a2a : 0x000000); groundMat.emissiveIntensity = biome === "volcanic" ? 0.5 : biome === "fairy" ? 0.35 : 0; }
  groundMat.needsUpdate = true;
}
// yumuşak parıltı spritesi (ateş böceği/toz/atmosfer noktaları için — sert kare yerine yumuşak glow)
function dotSprite() {
  const N = 64, c = document.createElement("canvas"); c.width = c.height = N; const g = c.getContext("2d");
  const rg = g.createRadialGradient(N / 2, N / 2, 0, N / 2, N / 2, N / 2); rg.addColorStop(0, "rgba(255,255,255,1)"); rg.addColorStop(0.35, "rgba(255,255,255,0.55)"); rg.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = rg; g.fillRect(0, 0, N, N);
  return new THREE.CanvasTexture(c);
}

/* ----- ağaçlar (InstancedMesh) ----- */
let trunkIM, folLowIM, folTopIM;            // prosedürel yedek ağaçlar
let modelTrunkIM = null, modelBranchIM = null, treeModelOn = false;  // gerçek GLB ağaç paketi
const trees = [];
const _d = new THREE.Object3D();
const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);
function treesNeedUpdate() {
  trunkIM.instanceMatrix.needsUpdate = folLowIM.instanceMatrix.needsUpdate = folTopIM.instanceMatrix.needsUpdate = true;
  if (modelTrunkIM) { modelTrunkIM.instanceMatrix.needsUpdate = true; modelBranchIM.instanceMatrix.needsUpdate = true; }
}

/* ----- gerçek GLB ağaç paketi (low-poly) — tüm ağaçlar 2 instanced draw call ----- */
async function setupTreeModel() {
  try {
    const { GLTFLoader } = await import("three/addons/loaders/GLTFLoader.js");
    const gltf = await new Promise((res, rej) => new GLTFLoader().load("./trees.glb", res, undefined, rej));
    gltf.scene.updateMatrixWorld(true);
    // gövde + dal/yaprak meshlerini topla (arka-plan atlas / kaya hariç)
    const trunks = [], branches = [];
    gltf.scene.traverse((o) => {
      if (!o.isMesh || !o.geometry) return;
      const n = (o.name || "").toLowerCase();
      if (n.includes("background") || n.includes("atlas") || n.includes("rock")) return;
      if (n.includes("trunk")) trunks.push(o);
      else if (n.includes("branch") || n.includes("leaf") || n.includes("leaves") || n.includes("foliage")) branches.push(o);
    });
    if (!trunks.length) { console.warn("[trees] GLB içinde gövde yok — prosedürel ağaçlar kalıyor"); return; }
    const trunk = trunks[0];
    // gövdeye dünyada en yakın dal meshini eşle (aynı ağaca ait olsun)
    const tp = new THREE.Vector3().setFromMatrixPosition(trunk.matrixWorld);
    let branch = null, best = Infinity;
    for (const b of branches) { const dd = new THREE.Vector3().setFromMatrixPosition(b.matrixWorld).distanceToSquared(tp); if (dd < best) { best = dd; branch = b; } }
    // dünya matrislerini geometriye işle (gövde+dal hizalı kalır)
    const trunkGeo = trunk.geometry.clone(); trunkGeo.applyMatrix4(trunk.matrixWorld);
    const branchGeo = branch ? branch.geometry.clone() : null; if (branchGeo) branchGeo.applyMatrix4(branch.matrixWorld);
    // birleşik kutu → tabanı orijine al + ~8 birime ölçekle
    trunkGeo.computeBoundingBox(); const bb = trunkGeo.boundingBox.clone();
    if (branchGeo) { branchGeo.computeBoundingBox(); bb.union(branchGeo.boundingBox); }
    const cx = (bb.min.x + bb.max.x) / 2, cz = (bb.min.z + bb.max.z) / 2, minY = bb.min.y, k = 8 / ((bb.max.y - bb.min.y) || 1);
    for (const g of [trunkGeo, branchGeo]) { if (!g) continue; g.translate(-cx, -minY, -cz); g.scale(k, k, k); }
    const N = trees.length;
    modelTrunkIM = new THREE.InstancedMesh(trunkGeo, trunk.material, N); modelTrunkIM.frustumCulled = false;
    if (shadowsOn) { modelTrunkIM.castShadow = true; modelTrunkIM.receiveShadow = true; }
    scene.add(modelTrunkIM);
    if (branchGeo) {
      modelBranchIM = new THREE.InstancedMesh(branchGeo, branch.material, N); modelBranchIM.frustumCulled = false;
      if (shadowsOn) { modelBranchIM.castShadow = true; modelBranchIM.receiveShadow = true; }
      scene.add(modelBranchIM);
    } else modelBranchIM = modelTrunkIM;   // dal yoksa aynı ref — writeTree zararsızca iki kez yazar
    treeModelOn = true;
    for (let i = 0; i < N; i++) writeTree(i);
    // biyom tonlaması: orman doğal kalır; kar/peri/volkan ağaçları biyom rengine boyanır (çarpımsal)
    const whiteCol = new THREE.Color(0xffffff), tCol = new THREE.Color();
    for (let i = 0; i < N; i++) {
      const t = trees[i], tinted = t.biome && t.biome !== "forest";
      modelBranchIM.setColorAt(i, tinted ? t.fol : whiteCol);
      if (modelTrunkIM !== modelBranchIM) { if (tinted) { tCol.setHSL(BIOMES[t.biome].trunk, 0.4, t.biome === "snow" ? 0.7 : 0.3); modelTrunkIM.setColorAt(i, tCol); } else modelTrunkIM.setColorAt(i, whiteCol); }
    }
    if (modelBranchIM.instanceColor) modelBranchIM.instanceColor.needsUpdate = true;
    if (modelTrunkIM.instanceColor) modelTrunkIM.instanceColor.needsUpdate = true;
    modelTrunkIM.instanceMatrix.needsUpdate = modelBranchIM.instanceMatrix.needsUpdate = true;
    trunkIM.visible = folLowIM.visible = folTopIM.visible = false;   // prosedürel ağaçları gizle
    console.log("[trees] GLB ağaç modeli uygulandı:", trunk.name, branch ? branch.name : "(dal yok)");
  } catch (e) { console.warn("[trees] GLB yüklenemedi — prosedürel ağaçlar kalıyor:", e); }
}

let biomeFX = null;   // oyuncu çevresinde biyoma göre atmosfer parçacıkları (kar/kül/ışıltı)
function buildBiomes() {
  const R = CFG.WORLD, step = 44;
  // --- zemin renk yamaları: biyom bölgelerini zemine boyar (ızgara, çakışan diskler) ---
  const patchGeo = new THREE.CircleGeometry(step * 0.82, 10);
  const volTex = biomeTexture("volcanic");
  const patchMat = {
    snow: new THREE.MeshStandardMaterial({ map: biomeTexture("snow"), roughness: 0.95 }),
    fairy: new THREE.MeshStandardMaterial({ map: biomeTexture("fairy"), roughness: 0.85, emissive: 0x3a1a52, emissiveIntensity: 0.35 }),
    volcanic: new THREE.MeshStandardMaterial({ map: volTex, emissive: 0xffffff, emissiveMap: volTex, emissiveIntensity: 0.85, roughness: 0.75 }),
  };
  for (let gx = -R; gx <= R; gx += step) for (let gz = -R; gz <= R; gz += step) {
    const bk = biomeAt(gx, gz); if (bk === "forest") continue;
    const m = new THREE.Mesh(patchGeo, patchMat[bk]); m.rotation.x = -Math.PI / 2; m.position.set(gx + rnd(-7, 7), 0.05, gz + rnd(-7, 7));
    if (shadowsOn) m.receiveShadow = true; scene.add(m);
  }
  // --- dekorlar: kar tepeleri / lav kayaları (ışıyan) / peri mantarları (ışıyan) ---
  const snowM = new THREE.MeshStandardMaterial({ color: 0xeef4fb, roughness: 1, flatShading: true });
  const rockM = new THREE.MeshStandardMaterial({ color: 0x1a120e, roughness: 1, flatShading: true });
  const lavaM = new THREE.MeshStandardMaterial({ color: 0xff6a22, emissive: 0xff3300, emissiveIntensity: 1.5, roughness: 0.6, flatShading: true });
  const stemM = new THREE.MeshStandardMaterial({ color: 0xece6f5, roughness: 1 });
  const capCols = [0xff7ad9, 0x9b6cff, 0x66e0ff];
  for (let i = 0; i < 300; i++) {
    const x = rnd(-R, R), z = rnd(-R, R), bk = biomeAt(x, z); if (bk === "forest") continue;
    const g = new THREE.Group(); g.position.set(x, 0, z);
    if (bk === "snow") { const s = rnd(0.6, 1.8); const m = new THREE.Mesh(new THREE.DodecahedronGeometry(s, 0), snowM); m.position.y = s * 0.32; m.scale.y = 0.5; g.add(m); }
    else if (bk === "volcanic") { const s = rnd(0.5, 1.4); const m = new THREE.Mesh(new THREE.DodecahedronGeometry(s, 0), Math.random() < 0.45 ? lavaM : rockM); m.position.y = s * 0.4; m.scale.y = 0.7; g.add(m); }
    else { const h = rnd(0.5, 1.3); const st = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.09, h, 5), stemM); st.position.y = h / 2; g.add(st); const c = choice(capCols); const cap = new THREE.Mesh(new THREE.IcosahedronGeometry(rnd(0.18, 0.34), 0), new THREE.MeshStandardMaterial({ color: c, emissive: c, emissiveIntensity: 1.0, roughness: 0.5, flatShading: true })); cap.position.y = h; g.add(cap); }
    if (shadowsOn) g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    scene.add(g);
  }
  // --- atmosfer parçacıkları (kar düşer / kül yükselir / ışıltı süzülür) — oyuncu çevresinde ---
  const N = 320, p = new Float32Array(N * 3);
  for (let i = 0; i < N; i++) { p[i * 3] = rnd(-40, 40); p[i * 3 + 1] = rnd(0, 30); p[i * 3 + 2] = rnd(-40, 40); }
  const geo = new THREE.BufferGeometry(); geo.setAttribute("position", new THREE.BufferAttribute(p, 3));
  biomeFX = new THREE.Points(geo, new THREE.PointsMaterial({ color: 0xffffff, size: 0.3, map: dotSprite(), transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending }));
  biomeFX.frustumCulled = false; biomeFX.visible = false; scene.add(biomeFX);
}
function buildTrees() {
  const N = CFG.TREES;
  const trunkGeo = new THREE.CylinderGeometry(0.14, 0.34, 5.2, 7);
  const trunkMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1 });  // beyaz -> örnek rengi belirler
  const folGeo = new THREE.IcosahedronGeometry(2.5, 1);   // yuvarlak geniş-yaprak kanopi (Amazon)
  const folMatLow = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, flatShading: true });
  const folMatTop = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, flatShading: true });
  trunkIM = new THREE.InstancedMesh(trunkGeo, trunkMat, N);
  folLowIM = new THREE.InstancedMesh(folGeo, folMatLow, N);
  folTopIM = new THREE.InstancedMesh(folGeo, folMatTop, N);
  trunkIM.frustumCulled = folLowIM.frustumCulled = folTopIM.frustumCulled = false; // örnekler tüm dünyaya yayıldığı için culling kapalı
  if (shadowsOn) { trunkIM.castShadow = folLowIM.castShadow = folTopIM.castShadow = true; folLowIM.receiveShadow = folTopIM.receiveShadow = true; }
  scene.add(trunkIM, folLowIM, folTopIM);

  const col = new THREE.Color();
  for (let i = 0; i < N; i++) {
    let x, z;
    do { x = rnd(-CFG.WORLD, CFG.WORLD); z = rnd(-CFG.WORLD, CFG.WORLD); } while (Math.hypot(x, z) < 9);
    const bk = biomeAt(x, z), bf = BIOMES[bk].fol;
    trees.push({ x, z, s: rnd(0.8, 1.6), rot: rnd(0, 6.28), r: 0, hp: 4, alive: true, regrow: 0, biome: bk });
    trees[i].r = 0.9 * trees[i].s;
    writeTree(i);
    // gövde rengi (biyoma göre)
    col.setHSL(BIOMES[bk].trunk, rnd(0.3, 0.5), rnd(0.12, 0.22)); trunkIM.setColorAt(i, col);
    // yaprak rengi (biyom paleti + çeşitlilik)
    const h = (bf[0] + rnd(-0.03, 0.03) + 1) % 1, sat = clamp(bf[1] * rnd(0.85, 1.05), 0, 1);
    col.setHSL(h, sat, clamp(bf[2] * rnd(0.62, 0.85), 0, 1)); folLowIM.setColorAt(i, col);
    col.setHSL(h, sat, clamp(bf[2] * rnd(0.85, 1.1), 0, 1)); folTopIM.setColorAt(i, col);
    trees[i].fol = col.clone();   // GLB ağaçları için (modelBranchIM tonlaması)
  }
  trunkIM.instanceMatrix.needsUpdate = folLowIM.instanceMatrix.needsUpdate = folTopIM.instanceMatrix.needsUpdate = true;
  trunkIM.instanceColor.needsUpdate = folLowIM.instanceColor.needsUpdate = folTopIM.instanceColor.needsUpdate = true;
}
function writeTree(i) {
  const t = trees[i];
  if (!t.alive) {
    trunkIM.setMatrixAt(i, ZERO); folLowIM.setMatrixAt(i, ZERO); folTopIM.setMatrixAt(i, ZERO);
    if (modelTrunkIM) { modelTrunkIM.setMatrixAt(i, ZERO); modelBranchIM.setMatrixAt(i, ZERO); }
    return;
  }
  const s = t.s;
  _d.position.set(t.x, 2.6 * s, t.z); _d.rotation.set(0, t.rot, 0); _d.scale.set(s, s, s); _d.updateMatrix(); trunkIM.setMatrixAt(i, _d.matrix);
  _d.position.set(t.x, 5.4 * s, t.z); _d.scale.set(s * 1.25, s * 0.9, s * 1.25); _d.updateMatrix(); folLowIM.setMatrixAt(i, _d.matrix);
  _d.position.set(t.x, 7.0 * s, t.z); _d.scale.set(s * 0.95, s * 0.95, s * 0.95); _d.updateMatrix(); folTopIM.setMatrixAt(i, _d.matrix);
  if (modelTrunkIM) {   // GLB ağaç: tabandan (y=0) yerleştir, t.rot/t.s ile çeşitlilik
    _d.position.set(t.x, 0, t.z); _d.rotation.set(0, t.rot, 0); _d.scale.set(s, s, s); _d.updateMatrix();
    modelTrunkIM.setMatrixAt(i, _d.matrix); modelBranchIM.setMatrixAt(i, _d.matrix);
  }
}
function refreshTrees() { for (let i = 0; i < trees.length; i++) writeTree(i); treesNeedUpdate(); }

/* ----- çalı + kaya ----- */
function buildScatter() {
  const col = new THREE.Color();
  // çalılar (renk çeşitliliğiyle)
  const bushGeo = new THREE.IcosahedronGeometry(0.95, 0);
  const bushMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, flatShading: true });
  applyWind(bushMat, 0.07);
  const bushIM = new THREE.InstancedMesh(bushGeo, bushMat, CFG.BUSHES);
  bushIM.frustumCulled = false; if (shadowsOn) { bushIM.castShadow = true; bushIM.receiveShadow = true; }
  for (let i = 0; i < CFG.BUSHES; i++) { const bx = rnd(-CFG.WORLD, CFG.WORLD), bz = rnd(-CFG.WORLD, CFG.WORLD); _d.position.set(bx, 0.5, bz); _d.rotation.set(0, rnd(0, 6.3), 0); _d.scale.setScalar(rnd(0.7, 1.7)); _d.updateMatrix(); bushIM.setMatrixAt(i, _d.matrix); const bf = BIOMES[biomeAt(bx, bz)].fol; col.setHSL((bf[0] + rnd(-0.03, 0.03) + 1) % 1, clamp(bf[1] * rnd(0.8, 1.05), 0, 1), clamp(bf[2] * rnd(0.55, 0.9), 0, 1)); bushIM.setColorAt(i, col); }
  bushIM.instanceColor.needsUpdate = true; scene.add(bushIM);
  // kayalar
  const rockGeo = new THREE.DodecahedronGeometry(0.7, 0);
  const rockMat = new THREE.MeshStandardMaterial({ color: 0x55595c, roughness: 1, flatShading: true });
  const rockIM = new THREE.InstancedMesh(rockGeo, rockMat, CFG.ROCKS);
  rockIM.frustumCulled = false; if (shadowsOn) { rockIM.castShadow = true; rockIM.receiveShadow = true; }
  for (let i = 0; i < CFG.ROCKS; i++) { _d.position.set(rnd(-CFG.WORLD, CFG.WORLD), 0.25, rnd(-CFG.WORLD, CFG.WORLD)); _d.rotation.set(rnd(0, 3), rnd(0, 6.3), rnd(0, 3)); _d.scale.setScalar(rnd(0.6, 1.8)); _d.updateMatrix(); rockIM.setMatrixAt(i, _d.matrix); }
  scene.add(rockIM);
  // çimen/eğrelti otu tutamları (zemine canlılık)
  const grassGeo = new THREE.ConeGeometry(0.16, 1.0, 4);
  const grassMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, flatShading: true });
  applyWind(grassMat, 0.16);
  const grassIM = new THREE.InstancedMesh(grassGeo, grassMat, CFG.GRASS);
  grassIM.frustumCulled = false;
  for (let i = 0; i < CFG.GRASS; i++) { const gx = rnd(-CFG.WORLD, CFG.WORLD), gz = rnd(-CFG.WORLD, CFG.WORLD); _d.position.set(gx, 0.45, gz); _d.rotation.set(rnd(-0.15, 0.15), rnd(0, 6.3), rnd(-0.15, 0.15)); _d.scale.set(rnd(0.7, 1.5), rnd(0.8, 1.8), rnd(0.7, 1.5)); _d.updateMatrix(); grassIM.setMatrixAt(i, _d.matrix); const gf = BIOMES[biomeAt(gx, gz)].fol; col.setHSL((gf[0] + rnd(-0.03, 0.03) + 1) % 1, clamp(gf[1] * rnd(0.85, 1.1), 0, 1), clamp(gf[2] * rnd(0.6, 0.95), 0, 1)); grassIM.setColorAt(i, col); }
  grassIM.instanceColor.needsUpdate = true; scene.add(grassIM);
}

/* ----- yapılar: metal hurda + sandık + terk edilmiş kulübeler (99 Nights tarzı) ----- */
const scraps = [];   // {x,z,group,taken}
const chests = [];   // {x,z,group,lid,opened}
const depots = [];   // {x,z,group} — 📦 kamp depo sandıkları (ağır kaynak sakla)
const crystals = []; // {x,z,group,hp,mined,shards[]} — kazma ile kazılır → 💎
const caves = [];    // {x,z,r} — karanlık yeraltı mağaraları (el feneri şart)
const houses = [];   // {x,z,group}
// ⛏️ DERİN MADEN: yüzeyde bir GİRİŞ var; etkileşince ekran kararır ve oyuncuyu uzaktaki gizli madene ışınlar (yüzeyden görünmez)
let mineEntrance = null;   // {x,z,group,yaw} — yüzeydeki tünel ağzı (etkileşim noktası)
let mineGroup = null;      // gizli maden sahnesi (yüzeydeyken görünmez)
let mineSpot = null;       // {x,z,r} — madenin gizli konumu (oyuncular göremesin diye uzak köşe)
let mineExit = null;       // {x,z} — maden içindeki yüzeye dönüş kapısı
let mineReturn = null;     // {x,z,yaw} — giriş öncesi yüzey konumu (çıkışta buraya döner)
let mineBusy = false;      // geçiş sırasında tekrar tetiklemeyi engelle
function farFromSpawn(min) { let x, z; do { x = rnd(-CFG.WORLD + 6, CFG.WORLD - 6); z = rnd(-CFG.WORLD + 6, CFG.WORLD - 6); } while (Math.hypot(x, z) < min); return [x, z]; }
function makeScrap(x, z) {
  const g = new THREE.Group(); g.position.set(x, 0, z);
  const mat = new THREE.MeshStandardMaterial({ color: 0x8a8f96, metalness: 0.7, roughness: 0.5 });
  const rust = new THREE.MeshStandardMaterial({ color: 0x6b4a2e, roughness: 0.9 });
  for (let i = 0; i < 3; i++) { const p = new THREE.Mesh(new THREE.BoxGeometry(rnd(0.3, 0.6), rnd(0.1, 0.25), rnd(0.3, 0.6)), i ? mat : rust); p.position.set(rnd(-0.25, 0.25), 0.12 + i * 0.12, rnd(-0.25, 0.25)); p.rotation.y = rnd(0, 6.3); g.add(p); }
  if (shadowsOn) g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  scene.add(g); const s = { x, z, group: g, taken: false }; scraps.push(s); return s;
}
function makeCrystal(x, z) {
  const g = new THREE.Group(); g.position.set(x, 0, z);
  const rock = new THREE.MeshStandardMaterial({ color: 0x3a3640, roughness: 1, flatShading: true });
  const base = new THREE.Mesh(new THREE.DodecahedronGeometry(0.7, 0), rock); base.position.y = 0.3; base.scale.y = 0.6; g.add(base);
  const gemMat = new THREE.MeshStandardMaterial({ color: 0x7fe9ff, emissive: 0x36b6d8, emissiveIntensity: 0.9, roughness: 0.2, metalness: 0.3, flatShading: true, transparent: true, opacity: 0.92 });
  const shards = [];
  for (let i = 0; i < 5; i++) { const h = rnd(0.6, 1.4); const s = new THREE.Mesh(new THREE.ConeGeometry(rnd(0.12, 0.22), h, 5), gemMat); s.position.set(rnd(-0.35, 0.35), 0.3 + h / 2, rnd(-0.35, 0.35)); s.rotation.set(rnd(-0.3, 0.3), rnd(0, 6.3), rnd(-0.3, 0.3)); g.add(s); shards.push(s); }
  g.add(plight(0x6fe6ff, 0.7, 6, 2, 0, 0.9, 0));
  if (shadowsOn) g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  scene.add(g); const c = { x, z, group: g, hp: 3, mined: false, mat: gemMat }; crystals.push(c); return c;
}
function makeChest(x, z) {
  const g = new THREE.Group(); g.position.set(x, 0, z);
  const wood = new THREE.MeshStandardMaterial({ map: woodTex, color: 0xa8895a, roughness: 0.9 });
  const iron = new THREE.MeshStandardMaterial({ color: 0x55585c, metalness: 0.6, roughness: 0.5 });
  const base = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.5, 0.6), wood); base.position.y = 0.25; g.add(base);
  const lid = new THREE.Mesh(new THREE.BoxGeometry(0.92, 0.22, 0.62), wood); lid.position.set(0, 0.5, -0.3); g.add(lid);
  const lock = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.18, 0.06), iron); lock.position.set(0, 0.34, 0.31); g.add(lock);
  if (shadowsOn) g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  scene.add(g); const c = { x, z, group: g, lid, opened: false }; chests.push(c); return c;
}
function makeStorageBox(x, z, rot) {   // 📦 kamp depo sandığı — ağır kaynakları sakla (çanta hafifler)
  const g = new THREE.Group(); g.position.set(x, 0, z); g.rotation.y = rot || 0;
  const wood = new THREE.MeshStandardMaterial({ map: woodTex, color: 0x8a6a3a, roughness: 0.9 });
  const iron = new THREE.MeshStandardMaterial({ color: 0x45484c, metalness: 0.6, roughness: 0.5 });
  const base = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.9, 1.0), wood); base.position.y = 0.45; g.add(base);
  const lid = new THREE.Mesh(new THREE.BoxGeometry(1.44, 0.3, 1.04), wood); lid.position.y = 1.0; g.add(lid);
  for (const sx of [-1, 1]) { const band = new THREE.Mesh(new THREE.BoxGeometry(0.1, 1.0, 1.06), iron); band.position.set(sx * 0.5, 0.5, 0); g.add(band); }
  const lock = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.24, 0.08), iron); lock.position.set(0, 0.62, 0.52); g.add(lock);
  if (shadowsOn) g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  scene.add(g); depots.push({ x, z, group: g }); return g;
}
function makeHouse(x, z) {
  const g = new THREE.Group(); g.position.set(x, 0, z); g.rotation.y = rnd(0, 6.3);
  const wall = new THREE.MeshStandardMaterial({ map: woodTex, color: 0xbaa688, roughness: 1 });
  const roofM = new THREE.MeshStandardMaterial({ color: 0x2e2418, roughness: 1, flatShading: true });
  const W = rnd(4, 6), D = rnd(4, 6), H = 2.6;
  // duvarlar (ön açık)
  const back = new THREE.Mesh(new THREE.BoxGeometry(W, H, 0.2), wall); back.position.set(0, H / 2, -D / 2); g.add(back);
  for (const sx of [-1, 1]) { const sw = new THREE.Mesh(new THREE.BoxGeometry(0.2, H, D), wall); sw.position.set(sx * W / 2, H / 2, 0); g.add(sw); }
  const roof = new THREE.Mesh(new THREE.ConeGeometry(W * 0.85, 1.6, 4), roofM); roof.position.set(0, H + 0.7, 0); roof.rotation.y = Math.PI / 4; g.add(roof);
  if (shadowsOn) g.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  scene.add(g); houses.push({ x, z, group: g });
  // her kulübede bir sandık
  makeChest(x + Math.cos(g.rotation.y) * 0.6, z + Math.sin(g.rotation.y) * 0.6);
}
// fiziksel üretim tezgahı (grinder) — kampta durur, yaklaşıp etkileşince crafting açılır
let benchObj = null; const BENCH = { x: 3.6, z: -2.6 };
function makeBench() {
  const g = new THREE.Group(); g.position.set(BENCH.x, 0, BENCH.z); g.rotation.y = -0.6;
  const wood = new THREE.MeshStandardMaterial({ color: 0x5a3f22, roughness: 1 });
  const iron = new THREE.MeshStandardMaterial({ color: 0x3a4048, metalness: 0.7, roughness: 0.4 });
  const top = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.18, 0.9), wood); top.position.y = 0.9; g.add(top);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) { const leg = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.9, 0.16), wood); leg.position.set(sx * 0.66, 0.45, sz * 0.34); g.add(leg); }
  const anvil = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.3, 0.34), iron); anvil.position.set(-0.3, 1.15, 0); g.add(anvil);
  const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.34, 0.14, 16), new THREE.MeshStandardMaterial({ color: 0x8a8f96, roughness: 0.6 })); wheel.rotation.x = Math.PI / 2; wheel.position.set(0.5, 1.05, 0); g.add(wheel);
  if (shadowsOn) g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  scene.add(g); benchObj = g;
}
function buildStructures() {
  for (let i = 0; i < CFG.HOUSES; i++) { const [x, z] = farFromSpawn(26); makeHouse(x, z); }
  for (let i = 0; i < CFG.CHESTS; i++) { const [x, z] = farFromSpawn(16); makeChest(x, z); }
  for (let i = 0; i < CFG.SCRAP; i++) { const [x, z] = farFromSpawn(10); makeScrap(x, z); }
  makeBench();
  buildPOIs();
}

/* ----- ÖNEMLİ NOKTALAR (POI): Stonehenge, Kilise, Gözcü Kulesi, Mağara, Köprü, Hurdacı ----- */
let scav = null;   // hurdacı NPC konumu (takas)
let peltT = null;  // kürk tüccarı NPC konumu (kademeli balta takası)
function makeStonehenge(x, z) {
  const g = new THREE.Group(); g.position.set(x, 0, z);
  const st = new THREE.MeshStandardMaterial({ color: 0x6b6660, roughness: 1, flatShading: true });
  const N = 8, R = 5;
  for (let i = 0; i < N; i++) { const a = (i / N) * 6.283; const p = new THREE.Mesh(new THREE.BoxGeometry(1.1, rnd(4, 5.5), 0.9), st); p.position.set(Math.cos(a) * R, 2.4, Math.sin(a) * R); p.rotation.y = -a; if (shadowsOn) p.castShadow = true; g.add(p); if (i % 2 === 0) { const lin = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.7, 0.9), st); lin.position.set(Math.cos(a) * R, 4.7, Math.sin(a) * R); lin.rotation.y = -a; g.add(lin); } }
  const altar = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.6, 1.1), st); altar.position.y = 0.3; g.add(altar);
  scene.add(g); makeChest(x + 1.4, z); houses.push({ x, z, group: g });
}
function makeChurch(x, z) {
  const g = new THREE.Group(); g.position.set(x, 0, z); g.rotation.y = rnd(0, 6.3);
  const stone = new THREE.MeshStandardMaterial({ map: stoneTex, color: 0xafaba2, roughness: 1 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x2a2620, roughness: 1, flatShading: true });
  const body = new THREE.Mesh(new THREE.BoxGeometry(6, 6, 10), stone); body.position.y = 3; g.add(body);
  const roof = new THREE.Mesh(new THREE.BoxGeometry(6.4, 2.4, 10.4), dark); roof.position.y = 7; roof.rotation.z = 0.0; g.add(roof);
  const tower = new THREE.Mesh(new THREE.BoxGeometry(2.4, 11, 2.4), stone); tower.position.set(0, 5.5, -5.6); g.add(tower);
  const spire = new THREE.Mesh(new THREE.ConeGeometry(1.8, 3.5, 4), dark); spire.position.set(0, 12.6, -5.6); g.add(spire);
  for (const ax of ["x", "y"]) { const bar = new THREE.Mesh(new THREE.BoxGeometry(ax === "x" ? 1.4 : 0.35, ax === "x" ? 0.35 : 1.6, 0.35), new THREE.MeshStandardMaterial({ color: 0x8a8378 })); bar.position.set(0, 14.8, -4.3); g.add(bar); }
  if (shadowsOn) g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  scene.add(g); makeChest(x + Math.cos(g.rotation.y) * 2, z + Math.sin(g.rotation.y) * 2); houses.push({ x, z, group: g });
}
function makeWatchtower(x, z) {
  const g = new THREE.Group(); g.position.set(x, 0, z);
  const wood = new THREE.MeshStandardMaterial({ color: 0x5a4326, roughness: 1 });
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) { const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.28, 9, 6), wood); leg.position.set(sx * 1.6, 4.5, sz * 1.6); leg.rotation.x = sz * 0.05; leg.rotation.z = -sx * 0.05; g.add(leg); }
  for (let y = 2.5; y < 9; y += 2.2) { for (const a of [0, 1]) { const br = new THREE.Mesh(new THREE.BoxGeometry(a ? 0.16 : 3.4, 0.16, a ? 3.4 : 0.16), wood); br.position.set(0, y, 0); g.add(br); } }
  const plat = new THREE.Mesh(new THREE.BoxGeometry(3.8, 0.3, 3.8), wood); plat.position.y = 9; g.add(plat);
  const roof = new THREE.Mesh(new THREE.ConeGeometry(3, 1.8, 4), new THREE.MeshStandardMaterial({ color: 0x3a2c18, flatShading: true })); roof.position.y = 11; roof.rotation.y = Math.PI / 4; g.add(roof);
  if (shadowsOn) g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  scene.add(g); makeChest(x, z + 2.4); makeChest(x + 0.6, z + 9.0); houses.push({ x, z, group: g });   // tepede kaliteli loot
}
function makeCave(x, z) {
  const g = new THREE.Group(); g.position.set(x, 0, z);
  const rock = new THREE.MeshStandardMaterial({ map: stoneTex, color: 0x6c645a, roughness: 1, flatShading: true });
  const darkM = new THREE.MeshStandardMaterial({ color: 0x0b0908, roughness: 1, flatShading: true, side: THREE.BackSide });
  const R = 15;
  const dome = new THREE.Mesh(new THREE.SphereGeometry(R, 18, 12, 0, 6.28, 0, Math.PI / 2), darkM); dome.scale.set(1, 0.9, 1); g.add(dome);   // iç karanlık kubbe (tavan)
  const floor = new THREE.Mesh(new THREE.CircleGeometry(R, 20), new THREE.MeshStandardMaterial({ color: 0x171310, roughness: 1 })); floor.rotation.x = -Math.PI / 2; floor.position.y = 0.05; g.add(floor);
  for (let i = 0; i < 14; i++) { const a = rnd(0, 6.28), r = rnd(R * 0.5, R - 0.5), h = rnd(1.4, 4), top = Math.random() < 0.5; const sp = new THREE.Mesh(new THREE.ConeGeometry(rnd(0.4, 0.95), h, 6), rock); sp.position.set(Math.cos(a) * r, top ? R * 0.78 - h / 2 : h / 2, Math.sin(a) * r); if (top) sp.rotation.z = Math.PI; g.add(sp); }   // sarkıt/dikit
  for (let i = 0; i < 8; i++) { const a = (i / 8) * 6.28; const pil = new THREE.Mesh(new THREE.CylinderGeometry(rnd(0.6, 1.0), rnd(0.9, 1.4), rnd(3, 6), 6), rock); pil.position.set(Math.cos(a) * (R - 0.4), 2.5, Math.sin(a) * (R - 0.4)); g.add(pil); }   // çevre kaya sütunları
  // MADEN: duvarlara gömülü IŞIYAN maden damarları (mavi kristal) — fener kapalıyken bile hafif görünür
  const oreMat = new THREE.MeshStandardMaterial({ color: 0x8fe6ff, emissive: 0x2ec8ff, emissiveIntensity: 1.6, roughness: 0.3, flatShading: true });
  for (let i = 0; i < 10; i++) { const a = rnd(0, 6.28), r = R - rnd(0.3, 1.4), yy = rnd(0.6, 4.5); const cl = new THREE.Group(); cl.position.set(Math.cos(a) * r, yy, Math.sin(a) * r);
    for (let k = 0; k < rndi(3, 6); k++) { const cr = new THREE.Mesh(new THREE.ConeGeometry(rnd(0.1, 0.26), rnd(0.4, 1.0), 5), oreMat); cr.position.set(rnd(-0.4, 0.4), rnd(-0.3, 0.3), rnd(-0.4, 0.4)); cr.rotation.set(rnd(0, 6.3), rnd(0, 6.3), rnd(0, 6.3)); cl.add(cr); }
    cl.add(plight(0x4ad4ff, 0.5, 6, 2, 0, 0, 0)); g.add(cl); }
  // horror: tavanda soluk KIZIL bir ışıltı (huzursuz eden)
  g.add(plight(0x7a1010, 0.5, R * 1.5, 2, 0, R * 0.5, 0));
  // yerde birkaç eski kemik/kalıntı (ürkütücü)
  const boneMat = new THREE.MeshStandardMaterial({ color: 0xd8cfbe, roughness: 1 });
  for (let i = 0; i < 5; i++) { const a = rnd(0, 6.28), r = rnd(2, R - 2); const bone = new THREE.Mesh(new THREE.CapsuleGeometry(0.06, rnd(0.4, 0.9), 3, 5), boneMat); bone.position.set(Math.cos(a) * r, 0.1, Math.sin(a) * r); bone.rotation.set(Math.PI / 2, 0, rnd(0, 6.3)); g.add(bone); }
  if (shadowsOn) g.traverse((o) => { if (o.isMesh && !(o.material.emissiveIntensity > 0.5)) o.castShadow = true; });   // ışıyan maden gölge dökmez
  scene.add(g); caves.push({ x, z, r: R });
  // mağara ganimeti: bol hurda + maden (kristal) + askeri mühimmat kasası
  for (let i = 0; i < 4; i++) { const a = rnd(0, 6.28), r = rnd(3, R - 3); makeScrap(x + Math.cos(a) * r, z + Math.sin(a) * r); }
  for (let i = 0; i < 3; i++) { const a = rnd(0, 6.28), r = rnd(3, R - 3); makeCrystal(x + Math.cos(a) * r, z + Math.sin(a) * r); }
  const ac = makeChest(x + rnd(-3, 3), z + rnd(-3, 3)); if (ac) ac.ammo = true;
  houses.push({ x, z, group: g });
}
function signMat(text) {   // ahşap tabela (canvas dokusu)
  const c = document.createElement("canvas"); c.width = 256; c.height = 72; const x = c.getContext("2d");
  x.fillStyle = "#2a1c0e"; x.fillRect(0, 0, 256, 72); x.strokeStyle = "#6b4a26"; x.lineWidth = 6; x.strokeRect(3, 3, 250, 66);
  x.fillStyle = "#e8c583"; x.font = "bold 34px system-ui,sans-serif"; x.textAlign = "center"; x.textBaseline = "middle"; x.fillText(text, 128, 40);
  const t = new THREE.CanvasTexture(c); t.anisotropy = 4;
  return new THREE.MeshStandardMaterial({ map: t, roughness: 0.9, side: THREE.DoubleSide });
}
function makeMineEntrance(x, z) {   // yüzeydeki tünel ağzı → etkileşince madene ışınlar
  const g = new THREE.Group(); g.position.set(x, 0, z); g.rotation.y = rnd(0, 6.28);
  const rock = new THREE.MeshStandardMaterial({ map: stoneTex, color: 0x5a5048, roughness: 1, flatShading: true });
  const wood = new THREE.MeshStandardMaterial({ color: 0x6b4a26, roughness: 1 });
  const railM = new THREE.MeshStandardMaterial({ color: 0x3a3a40, metalness: 0.6, roughness: 0.5 });
  const hill = new THREE.Mesh(new THREE.SphereGeometry(6, 14, 9, 0, 6.28, 0, Math.PI / 2), rock); hill.scale.set(1.5, 1.15, 1.2); g.add(hill);   // kaya yamaç
  const mouth = new THREE.Mesh(new THREE.CircleGeometry(1.7, 22), new THREE.MeshBasicMaterial({ color: 0x000000 })); mouth.position.set(0, 1.7, 4.85); g.add(mouth);   // kara tünel ağzı
  for (const sx of [-1, 1]) { const post = new THREE.Mesh(new THREE.BoxGeometry(0.36, 3.7, 0.36), wood); post.position.set(sx * 1.95, 1.85, 5.0); g.add(post); }   // ahşap çerçeve
  const lintel = new THREE.Mesh(new THREE.BoxGeometry(4.5, 0.42, 0.42), wood); lintel.position.set(0, 3.6, 5.0); g.add(lintel);
  const brace = new THREE.Mesh(new THREE.BoxGeometry(4.5, 0.3, 0.3), wood); brace.position.set(0, 3.15, 5.0); g.add(brace);
  for (const sx of [-1, 1]) { const rl = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 6.5), railM); rl.position.set(sx * 0.5, 0.1, 7.8); g.add(rl); }   // raylar
  for (let i = 0; i < 9; i++) { const tie = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.08, 0.22), wood); tie.position.set(0, 0.05, 5.1 + i * 0.72); g.add(tie); }
  const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.2, 8, 8), new THREE.MeshStandardMaterial({ color: 0xffd27f, emissive: 0xffb347, emissiveIntensity: 1.5 })); lamp.position.set(0, 3.35, 5.4); g.add(lamp);   // fener
  g.add(plight(0xffb347, 1.2, 11, 2, 0, 3.2, 5.7));
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(2.7, 0.78), signMat("MADEN GIRISI")); sign.position.set(0, 4.2, 5.05); g.add(sign);   // tabela
  if (shadowsOn) g.traverse((o) => { if (o.isMesh && !(o.material && o.material.emissiveIntensity > 0.5)) o.castShadow = true; });
  scene.add(g);
  const s = Math.sin(g.rotation.y), c = Math.cos(g.rotation.y);   // local +z ekseni → dünya yönü
  mineEntrance = { x: x + s * 5.3, z: z + c * 5.3, group: g, yaw: g.rotation.y + Math.PI };   // ağzın önündeki etkileşim noktası
  for (let i = 0; i < trees.length; i++) { const t = trees[i]; if (t.alive && Math.hypot(t.x - x, t.z - z) < 9) { t.alive = false; t.regrow = 1e9; writeTree(i); } }   // önü açık kalsın
}
function makeMine(cx, cz) {   // gizli DERİN MADEN — yalnızca girişten ışınlanınca görünür (yüzeyden görünmez)
  const R = 20;
  mineGroup = new THREE.Group();   // dünya-merkezli kapsayıcı; .visible=false iken tüm maden gizli
  const inner = new THREE.Group(); inner.position.set(cx, 0, cz); mineGroup.add(inner);
  const rock = new THREE.MeshStandardMaterial({ map: stoneTex, color: 0x6c645a, roughness: 1, flatShading: true });
  const darkM = new THREE.MeshStandardMaterial({ color: 0x0a0807, roughness: 1, flatShading: true, side: THREE.BackSide });
  const wood = new THREE.MeshStandardMaterial({ color: 0x5a3f22, roughness: 1 });
  const dome = new THREE.Mesh(new THREE.SphereGeometry(R, 22, 14, 0, 6.28, 0, Math.PI / 2), darkM); dome.scale.set(1, 0.85, 1); inner.add(dome);
  const floor = new THREE.Mesh(new THREE.CircleGeometry(R, 24), new THREE.MeshStandardMaterial({ color: 0x151109, roughness: 1 })); floor.rotation.x = -Math.PI / 2; floor.position.y = 0.04; inner.add(floor);
  for (let i = 0; i < 20; i++) { const a = rnd(0, 6.28), r = rnd(R * 0.4, R - 0.5), h = rnd(1.4, 4.5), top = Math.random() < 0.5; const sp = new THREE.Mesh(new THREE.ConeGeometry(rnd(0.4, 1.0), h, 6), rock); sp.position.set(Math.cos(a) * r, top ? R * 0.72 - h / 2 : h / 2, Math.sin(a) * r); if (top) sp.rotation.z = Math.PI; inner.add(sp); }
  for (let i = 0; i < 10; i++) { const a = (i / 10) * 6.28; const pil = new THREE.Mesh(new THREE.CylinderGeometry(rnd(0.6, 1.1), rnd(1.0, 1.5), rnd(3, 6), 6), rock); pil.position.set(Math.cos(a) * (R - 0.4), 2.6, Math.sin(a) * (R - 0.4)); inner.add(pil); }
  for (let i = 0; i < 6; i++) { const a = (i / 6) * 6.28, rr = R - 3; const fr = new THREE.Group(); fr.position.set(Math.cos(a) * rr, 0, Math.sin(a) * rr); fr.rotation.y = a;   // ahşap galeri destekleri
    for (const sx of [-1, 1]) { const post = new THREE.Mesh(new THREE.BoxGeometry(0.3, 3.2, 0.3), wood); post.position.set(sx * 1.3, 1.6, 0); fr.add(post); }
    fr.add(new THREE.Mesh(new THREE.BoxGeometry(3.1, 0.3, 0.3), wood)); fr.children[2].position.set(0, 3.2, 0); inner.add(fr); }
  const oreMat = new THREE.MeshStandardMaterial({ color: 0x8fe6ff, emissive: 0x2ec8ff, emissiveIntensity: 1.7, roughness: 0.3, flatShading: true });   // ışıyan maden damarları
  for (let i = 0; i < 14; i++) { const a = rnd(0, 6.28), r = R - rnd(0.3, 1.6), yy = rnd(0.6, 5.0); const cl = new THREE.Group(); cl.position.set(Math.cos(a) * r, yy, Math.sin(a) * r);
    for (let k = 0; k < rndi(3, 6); k++) { const cr = new THREE.Mesh(new THREE.ConeGeometry(rnd(0.1, 0.28), rnd(0.4, 1.1), 5), oreMat); cr.position.set(rnd(-0.4, 0.4), rnd(-0.3, 0.3), rnd(-0.4, 0.4)); cr.rotation.set(rnd(0, 6.3), rnd(0, 6.3), rnd(0, 6.3)); cl.add(cr); }
    cl.add(plight(0x4ad4ff, 0.45, 6, 2, 0, 0, 0)); inner.add(cl); }
  inner.add(plight(0x7a1010, 0.55, R * 1.6, 2, 0, R * 0.55, 0));   // horror: kızıl tavan ışıltısı
  const boneMat = new THREE.MeshStandardMaterial({ color: 0xd8cfbe, roughness: 1 });
  for (let i = 0; i < 8; i++) { const a = rnd(0, 6.28), r = rnd(2, R - 2); const bone = new THREE.Mesh(new THREE.CapsuleGeometry(0.06, rnd(0.4, 0.9), 3, 5), boneMat); bone.position.set(Math.cos(a) * r, 0.1, Math.sin(a) * r); bone.rotation.set(Math.PI / 2, 0, rnd(0, 6.3)); inner.add(bone); }
  const cart = new THREE.Group(); cart.position.set(rnd(-5, 5), 0, rnd(-5, 5));   // maden arabası (dekor)
  cart.add(new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.8, 0.9), new THREE.MeshStandardMaterial({ color: 0x4a3a2a, roughness: 1 }))); cart.children[0].position.y = 0.6;
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) { const w = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.28, 0.12, 12), new THREE.MeshStandardMaterial({ color: 0x2a2a30, metalness: 0.5, roughness: 0.6 })); w.rotation.x = Math.PI / 2; w.position.set(sx * 0.6, 0.28, sz * 0.4); cart.add(w); } inner.add(cart);
  const ex = R - 2.2;   // ÇIKIŞ kapısı (sıcak ışıklı, merkeze bakar)
  const door = new THREE.Group(); door.position.set(ex, 0, 0); inner.add(door);
  const glow = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 3.0), new THREE.MeshBasicMaterial({ color: 0xffe6b0, transparent: true, opacity: 0.92, side: THREE.DoubleSide })); glow.position.set(0, 1.6, 0); glow.rotation.y = -Math.PI / 2; door.add(glow);
  door.add(plight(0xffd9a0, 1.4, 9, 2, -0.6, 1.8, 0));
  for (const sy of [-1, 1]) { const post = new THREE.Mesh(new THREE.BoxGeometry(0.3, 3.3, 0.3), wood); post.position.set(0.12, 1.65, sy * 1.25); door.add(post); }
  door.add(new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.3, 2.7), wood)); door.children[door.children.length - 1].position.set(0.12, 3.3, 0);
  const esign = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 0.62), signMat("CIKIS")); esign.position.set(0, 3.8, 0); esign.rotation.y = -Math.PI / 2; door.add(esign);
  mineExit = { x: cx + ex - 1.4, z: cz };   // kapının iç önü (etkileşim noktası)
  if (shadowsOn) mineGroup.traverse((o) => { if (o.isMesh && !(o.material && o.material.emissiveIntensity > 0.5) && !(o.material && o.material.isMeshBasicMaterial)) o.castShadow = true; });
  scene.add(mineGroup); mineGroup.visible = false;
  mineSpot = { x: cx, z: cz, r: R };
  const reparent = (o) => { if (o && o.group) { scene.remove(o.group); mineGroup.add(o.group); } };   // ganimeti mineGroup'a taşı (yüzeyden gizli)
  for (let i = 0; i < 6; i++) { const a = rnd(0, 6.28), r = rnd(4, R - 4); reparent(makeScrap(cx + Math.cos(a) * r, cz + Math.sin(a) * r)); }
  for (let i = 0; i < 5; i++) { const a = rnd(0, 6.28), r = rnd(4, R - 4); reparent(makeCrystal(cx + Math.cos(a) * r, cz + Math.sin(a) * r)); }
  const amc = makeChest(cx + rnd(-4, 4), cz + rnd(-4, 4)); if (amc) { amc.ammo = true; reparent(amc); }
  reparent(makeChest(cx + rnd(-4, 4), cz + rnd(-4, 4))); reparent(makeChest(cx + rnd(-4, 4), cz + rnd(-4, 4)));
  for (let i = 0; i < trees.length; i++) { const t = trees[i]; if (t.alive && Math.hypot(t.x - cx, t.z - cz) < R + 3) { t.alive = false; t.regrow = 1e9; writeTree(i); } }   // zemine ağaç sızmasın
  treesNeedUpdate();
}
function fadeTo(cb) {   // ekranı karart → cb() (ışınla) → tekrar aç
  const f = $("fade");
  if (!f) { try { cb(); } catch (e) {} return; }
  f.classList.add("on");
  setTimeout(() => { try { cb(); } catch (e) {} setTimeout(() => f.classList.remove("on"), 430); }, 560);
}
function enterMine() {
  if (mineBusy || !mineSpot) return;
  mineBusy = true;
  mineReturn = { x: camera.position.x, z: camera.position.z, yaw };   // giriş öncesi yüzey konumu
  Sound.crackle();
  fadeTo(() => {
    if (mineGroup) mineGroup.visible = true;
    S.inMine = true; inCave = true;
    const a = rnd(0, 6.28), r = rnd(0, mineSpot.r * 0.3);   // co-op: küçük rastgele ofset ile üst üste binmeyi önle
    camera.position.set(mineSpot.x + Math.cos(a) * r, CFG.EYE, mineSpot.z + Math.sin(a) * r);
    S.py = 0; S.vy = 0;
    curBiome = "caves"; applyBiomeGround("caves");
    S.heartLevel = Math.max(S.heartLevel || 0, 0.55); S.shake = Math.max(S.shake || 0, 0.28);   // iniş ürpertisi
    whisperText(choice(["derinlerde bir şey var...", "kaz... ama sessizce", "geri dönmelisin"])); Sound.growl();
    toast("⛏️ Madene indin — el fenerini aç (🔦 L). Çıkış: ışıklı kapı 🪜", "good");
    mineBusy = false;
  });
}
function exitMine() {
  if (mineBusy || !S.inMine) return;
  mineBusy = true;
  Sound.crackle();
  fadeTo(() => {
    S.inMine = false; inCave = false;
    if (mineGroup) mineGroup.visible = false;
    // Maden Kraliçesi'ni madende bırak (yüzeye taşınmasın) — çıkınca temizlenir, tekrar girince yeniden uyanır
    let removedQueen = false;
    for (let i = animals.length - 1; i >= 0; i--) { if (animals[i].type === "queen" || (mineSpot && animals[i].type === "spider" && inMineArea(animals[i].x, animals[i].z))) { scene.remove(animals[i].group); if (animals[i].type === "queen") removedQueen = true; animals.splice(i, 1); } }
    if (removedQueen) bossAlive = false;
    const rt = mineReturn || (mineEntrance ? { x: mineEntrance.x, z: mineEntrance.z, yaw: 0 } : { x: 0, z: 0, yaw: 0 });
    camera.position.set(rt.x, CFG.EYE, rt.z); S.py = 0; S.vy = 0;
    if (typeof rt.yaw === "number") yaw = rt.yaw;
    curBiome = biomeAt(camera.position.x, camera.position.z); applyBiomeGround(curBiome);
    toast("🌲 Yüzeye çıktın.", "good");
    mineBusy = false;
  });
}
function makeBridge(x, z) {
  const g = new THREE.Group(); g.position.set(x, 0, z); g.rotation.y = rnd(0, 6.3);
  const wood = new THREE.MeshStandardMaterial({ color: 0x6b4a26, roughness: 1 });
  for (let i = 0; i < 16; i++) { const plank = new THREE.Mesh(new THREE.BoxGeometry(4, 0.18, 0.7), wood); plank.position.set(0, 0.3, (i - 8) * 0.8); g.add(plank); }
  for (const sx of [-1, 1]) { const rail = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.9, 13), wood); rail.position.set(sx * 1.9, 0.8, 0); g.add(rail); }
  if (shadowsOn) g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  scene.add(g);
}
function makeScavenger(x, z) {
  const g = new THREE.Group(); g.position.set(x, 0, z);
  // küçük kulübe
  const wall = new THREE.MeshStandardMaterial({ color: 0x4a3a28, roughness: 1 });
  const hut = new THREE.Mesh(new THREE.BoxGeometry(3, 2.4, 3), wall); hut.position.y = 1.2; g.add(hut);
  const roof = new THREE.Mesh(new THREE.ConeGeometry(2.6, 1.4, 4), new THREE.MeshStandardMaterial({ color: 0x2e2418, flatShading: true })); roof.position.y = 3.1; roof.rotation.y = Math.PI / 4; g.add(roof);
  // hurdacı figürü
  const np = new THREE.Group(); np.position.set(0, 0, 2);
  np.add(new THREE.Mesh(new THREE.CapsuleGeometry(0.3, 0.9, 4, 8), new THREE.MeshStandardMaterial({ color: 0x6a5a3a }))); np.children[0].position.y = 1.0;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.26, 10, 10), new THREE.MeshStandardMaterial({ color: 0xc9b79a })); head.position.y = 1.7; np.add(head);
  g.add(np);
  if (shadowsOn) g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  scene.add(g); scav = { x, z: z + 2 };
}
function makePeltTrader(x, z) {
  const g = new THREE.Group(); g.position.set(x, 0, z);
  const wall = new THREE.MeshStandardMaterial({ color: 0x5a4230, roughness: 1 });
  const hut = new THREE.Mesh(new THREE.BoxGeometry(3, 2.4, 3), wall); hut.position.y = 1.2; g.add(hut);
  const roof = new THREE.Mesh(new THREE.ConeGeometry(2.6, 1.4, 4), new THREE.MeshStandardMaterial({ color: 0x3a2a1a, flatShading: true })); roof.position.y = 3.1; roof.rotation.y = Math.PI / 4; g.add(roof);
  // asılı kürkler (dükkan hissi)
  for (let i = 0; i < 3; i++) { const pelt = new THREE.Mesh(new THREE.PlaneGeometry(0.7, 0.9), new THREE.MeshStandardMaterial({ color: choice([0x8a6a44, 0x9a7a52, 0x6a5030]), roughness: 1, side: THREE.DoubleSide })); pelt.position.set(-1 + i, 1.7, 1.55); g.add(pelt); }
  // tüccar figürü (kürklü)
  const np = new THREE.Group(); np.position.set(0, 0, 2);
  np.add(new THREE.Mesh(new THREE.CapsuleGeometry(0.32, 0.9, 4, 8), new THREE.MeshStandardMaterial({ color: 0x7a5a38 }))); np.children[0].position.y = 1.0;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.26, 10, 10), new THREE.MeshStandardMaterial({ color: 0xc9b79a })); head.position.y = 1.7; np.add(head);
  const hood = new THREE.Mesh(new THREE.ConeGeometry(0.32, 0.4, 8), new THREE.MeshStandardMaterial({ color: 0x5a4230 })); hood.position.y = 1.95; np.add(hood);
  g.add(np);
  if (shadowsOn) g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  scene.add(g); peltT = { x, z: z + 2 };
}
function makeCampsite(x, z) {   // terk edilmiş kamp: sönmüş ateş + barınak + sandık
  const g = new THREE.Group(); g.position.set(x, 0, z); g.rotation.y = rnd(0, 6.3);
  const ash = new THREE.Mesh(new THREE.CircleGeometry(0.9, 12), new THREE.MeshStandardMaterial({ color: 0x2a2622, roughness: 1 })); ash.rotation.x = -Math.PI / 2; ash.position.y = 0.02; g.add(ash);
  const charM = new THREE.MeshStandardMaterial({ color: 0x1c1814, roughness: 1, flatShading: true });
  for (let i = 0; i < 4; i++) { const a = (i / 4) * 6.28; const log = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.1, 0.9, 5), charM); log.position.set(Math.cos(a) * 0.3, 0.1, Math.sin(a) * 0.3); log.rotation.z = Math.PI / 2; log.rotation.y = a; g.add(log); }
  // eğik barınak (lean-to)
  const poleM = new THREE.MeshStandardMaterial({ color: 0x5a4326, roughness: 1 });
  const tarp = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 2.0), new THREE.MeshStandardMaterial({ color: 0x586247, roughness: 1, side: THREE.DoubleSide })); tarp.position.set(0, 1.0, -1.6); tarp.rotation.x = -1.0; g.add(tarp);
  for (const sx of [-1, 1]) { const p = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 1.9, 5), poleM); p.position.set(sx * 1.1, 0.9, -1.0); p.rotation.x = 0.3; g.add(p); }
  if (shadowsOn) g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  scene.add(g); makeChest(x + Math.cos(g.rotation.y) * 1.6, z + Math.sin(g.rotation.y) * 1.6); houses.push({ x, z, group: g });
}
function makeShacks(x, z) {     // terk edilmiş kulübe kümesi (3 harap kulübe + sandıklar)
  for (let i = 0; i < 3; i++) { const a = (i / 3) * 6.28 + rnd(-0.3, 0.3), r = rnd(4, 7); makeHouse(x + Math.cos(a) * r, z + Math.sin(a) * r); }
  makeChest(x, z);
}
function makeWreck(x, z) {   // 🚁 DÜŞMÜŞ KARGO HELİKOPTERİ ENKAZI — askeri ganimet (2 mühimmat kasası + hurda)
  const g = new THREE.Group(); g.position.set(x, 0, z); g.rotation.y = rnd(0, 6.28);
  const metal = new THREE.MeshStandardMaterial({ color: 0x3a4038, metalness: 0.5, roughness: 0.7, flatShading: true });
  const burnt = new THREE.MeshStandardMaterial({ color: 0x14120f, roughness: 1, flatShading: true });
  const scorch = new THREE.Mesh(new THREE.CircleGeometry(6, 20), new THREE.MeshStandardMaterial({ color: 0x1a1712, roughness: 1 })); scorch.rotation.x = -Math.PI / 2; scorch.position.y = 0.03; g.add(scorch);   // yanık zemin
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(1.3, 3.2, 6, 12), metal); body.rotation.z = Math.PI / 2; body.rotation.x = 0.25; body.position.set(0, 1.2, 0); g.add(body);   // yan yatmış gövde
  const cockpit = new THREE.Mesh(new THREE.SphereGeometry(1.0, 12, 10, 0, 6.28, 0, Math.PI), new THREE.MeshStandardMaterial({ color: 0x3a5a68, metalness: 0.3, roughness: 0.4, transparent: true, opacity: 0.5, side: THREE.DoubleSide })); cockpit.position.set(2.3, 1.3, 0); cockpit.rotation.z = -0.4; g.add(cockpit);   // kırık kokpit
  const tail = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.5, 3.5, 8), burnt); tail.rotation.z = 1.1; tail.position.set(-4.2, 0.6, 1.2); g.add(tail);   // kopmuş kuyruk
  const rotor = new THREE.Mesh(new THREE.BoxGeometry(8, 0.1, 0.5), burnt); rotor.position.set(1, 0.15, 2); rotor.rotation.set(0, rnd(0, 3), 0.06); g.add(rotor);   // kırık pervane
  for (let i = 0; i < 7; i++) { const p = new THREE.Mesh(new THREE.BoxGeometry(rnd(0.4, 0.9), rnd(0.3, 0.6), rnd(0.4, 0.9)), i % 2 ? metal : burnt); const a = rnd(0, 6.28), r = rnd(2.5, 5.5); p.position.set(Math.cos(a) * r, 0.2, Math.sin(a) * r); p.rotation.set(rnd(0, 1), rnd(0, 6.3), rnd(0, 1)); g.add(p); }   // dağılmış enkaz
  if (shadowsOn) g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  scene.add(g);
  const c1 = makeChest(x + Math.cos(g.rotation.y) * 2.5, z + Math.sin(g.rotation.y) * 2.5); if (c1) c1.ammo = true;   // mühimmat kasaları
  const c2 = makeChest(x - Math.cos(g.rotation.y) * 3, z - Math.sin(g.rotation.y) * 3); if (c2) c2.ammo = true;
  for (let i = 0; i < 3; i++) { const a = rnd(0, 6.28), r = rnd(3, 6); makeScrap(x + Math.cos(a) * r, z + Math.sin(a) * r); }
  houses.push({ x, z, group: g });
  for (let i = 0; i < trees.length; i++) { const t = trees[i]; if (t.alive && Math.hypot(t.x - x, t.z - z) < 7) { t.alive = false; t.regrow = 1e9; writeTree(i); } }   // enkaz üstü açık
  treesNeedUpdate();
}
let graveyard = null;   // {x,z} — mezarlık: geceleri yakınında akıl daha hızlı erir + fısıltılar
function makeGraveyard(x, z) {   // 🪦 terk edilmiş mezarlık (horror POI): mezar taşları + kripta (gizli sandık) + ölü ağaç
  const g = new THREE.Group(); g.position.set(x, 0, z); const rot = rnd(0, 6.28); g.rotation.y = rot;
  const stone = new THREE.MeshStandardMaterial({ map: stoneTex, color: 0x8a857c, roughness: 1, flatShading: true });
  const moss = new THREE.MeshStandardMaterial({ color: 0x4a5238, roughness: 1, flatShading: true });
  const dark = new THREE.MeshStandardMaterial({ color: 0x2a2620, roughness: 1, flatShading: true });
  for (let r = -2; r <= 2; r++) for (let c = -2; c <= 2; c++) {   // mezar taşları + höyükler
    if (Math.random() < 0.22) continue; const hx = c * 2.2 + rnd(-0.3, 0.3), hz = r * 2.4 + rnd(-0.3, 0.3), round = Math.random() < 0.5;
    const hs = new THREE.Mesh(round ? new THREE.CylinderGeometry(0.45, 0.45, 1.1, 10, 1, false, 0, Math.PI) : new THREE.BoxGeometry(0.9, rnd(0.9, 1.4), 0.18), Math.random() < 0.4 ? moss : stone);
    hs.position.set(hx, round ? 0.55 : 0.6, hz); hs.rotation.set(rnd(-0.12, 0.12), rnd(0, 6.28), rnd(-0.12, 0.12)); g.add(hs);
    const mound = new THREE.Mesh(new THREE.SphereGeometry(0.7, 8, 6, 0, 6.28, 0, Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x3a2e22, roughness: 1 })); mound.scale.set(1, 0.22, 1.4); mound.position.set(hx, 0.02, hz + 0.9); g.add(mound);
  }
  const crypt = new THREE.Group(); crypt.position.set(0, 0, -7);   // kripta / mozole
  crypt.add(new THREE.Mesh(new THREE.BoxGeometry(3.2, 2.6, 3.2), stone)); crypt.children[0].position.y = 1.3;
  const croof = new THREE.Mesh(new THREE.ConeGeometry(2.6, 1.4, 4), dark); croof.position.y = 3.0; croof.rotation.y = Math.PI / 4; crypt.add(croof);
  crypt.add(new THREE.Mesh(new THREE.BoxGeometry(1.1, 1.8, 0.3), new THREE.MeshBasicMaterial({ color: 0x000000 }))); crypt.children[2].position.set(0, 0.9, 1.6); g.add(crypt);
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.32, 4.5, 6), new THREE.MeshStandardMaterial({ color: 0x241c14, roughness: 1, flatShading: true })); trunk.position.set(rnd(-4, 4), 2.2, rnd(-1, 4)); trunk.rotation.z = rnd(-0.1, 0.1); g.add(trunk);   // ölü ağaç
  for (let i = 0; i < 4; i++) { const br = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.12, rnd(1, 2), 5), new THREE.MeshStandardMaterial({ color: 0x241c14, flatShading: true })); br.position.copy(trunk.position); br.position.y += rnd(0.8, 1.8); br.rotation.set(rnd(-1, 1), rnd(0, 6.3), rnd(-1.2, 1.2)); g.add(br); }
  g.add(plight(0x6a1414, 0.4, 16, 2, 0, 2, -7));   // soluk kızıl ışıltı
  if (shadowsOn) g.traverse((o) => { if (o.isMesh && !(o.material && o.material.isMeshBasicMaterial)) o.castShadow = true; });
  scene.add(g);
  const s = Math.sin(rot), c = Math.cos(rot);
  const cc = makeChest(x + s * -5.2, z + c * -5.2); if (cc) cc.ammo = true;   // kripta önünde gizli askeri kasa
  makeChest(x + s * 2 + 2, z + c * 2); makeChest(x - 2, z + c * -2);
  graveyard = { x, z };
  houses.push({ x, z, group: g });
  for (let i = 0; i < trees.length; i++) { const t = trees[i]; if (t.alive && Math.hypot(t.x - x, t.z - z) < 9) { t.alive = false; t.regrow = 1e9; writeTree(i); } }
  treesNeedUpdate();
}
function buildPOIs() {
  let p;
  p = farFromSpawn(70); makeStonehenge(p[0], p[1]);
  p = farFromSpawn(60); makeChurch(p[0], p[1]);
  p = farFromSpawn(45); makeWatchtower(p[0], p[1]);
  p = farFromSpawn(45); makeWatchtower(p[0], p[1]);
  p = farFromSpawn(40); makeBridge(p[0], p[1]);
  p = farFromSpawn(30); makeScavenger(p[0], p[1]);
  p = farFromSpawn(38); makePeltTrader(p[0], p[1]);
  p = farFromSpawn(50); makeCampsite(p[0], p[1]);
  p = farFromSpawn(65); makeCampsite(p[0], p[1]);
  p = farFromSpawn(75); makeShacks(p[0], p[1]);
  p = farFromSpawn(55); makeWreck(p[0], p[1]);   // 🚁 düşmüş helikopter enkazı (askeri ganimet)
  p = farFromSpawn(65); makeGraveyard(p[0], p[1]);   // 🪦 terk edilmiş mezarlık (horror POI + gizli kasa)
  // mağaralar — çevrelerine kristal damarları kümelenir (💎 kaynağı)
  for (const cd of [55, 80, 100]) {
    p = farFromSpawn(cd); makeCave(p[0], p[1]);
    const n = rndi(2, 4); for (let i = 0; i < n; i++) { const a = rnd(0, 6.28), r = rnd(3, 9); makeCrystal(p[0] + Math.cos(a) * r, p[1] + Math.sin(a) * r); }
  }
  // ⛏️ DERİN MADEN: yüzeyde bir giriş + uzak köşede gizli maden (oyuncular yüzeyden göremez; girişten ışınlanılır)
  p = farFromSpawn(60); makeMineEntrance(p[0], p[1]);
  makeMine(-(CFG.WORLD - 34), CFG.WORLD - 34);   // sınıra yakın köşe (dünya içinde ama sisle + görünmezlikle gizli)
  // haritaya serpiştirilmiş yalnız kristaller
  for (let i = 0; i < 7; i++) { p = farFromSpawn(45); makeCrystal(p[0], p[1]); }
}

/* ----------------------- GAME STATE ----------------------- */
let S;
function newState() {
  return {
    running: false, paused: false, over: false, won: false, inMine: false, diff: 1,
    time: 0.16, day: 1,
    health: 100, hunger: 100, warmth: 100, sanity: 100, stamina: 100, thirst: 100,
    inv: { wood: 10, raw: 0, cooked: 2, metal: 0, pelt: 0, bandage: 1, gem: 0, cloth: 0, rope: 0, medkit: 0, pills: 0, canned: 0, choco: 0, pistolAmmo: 0, shells: 0, rifleAmmo: 0, arrows: 0, water: 1, soda: 0, batteries: 0, dynamite: 0 },
    tools: { pickaxe: false, tent: false, spear: false, axe: 0, chainsaw: false, hammer: false },   // axe: 0 eski / 1 iyi / 2 güçlü
    weapons: { pistol: false, shotgun: false, rifle: false, bow: false, crossbow: false },   // sahip olunan menzilli silahlar
    equip: null, shootCd: 0,   // kuşanılı menzilli silah (null=yakın dövüş)
    melee: null, meleeOwned: {},   // özel yakın dövüş silahı (katana, topuz, cehennem kılıcı, zehirli mızrak)
    flashlight: false, flashOn: false, battery: 0,   // el feneri + şarj
    armor: 0, armorDef: 0,   // zırh dayanıklılığı (0-100) + hasar azaltma oranı (0-1)
    rescuing: false, rescueT: 0,   // 100. gün kurtarma sineması
    cls: null,   // seçilen sınıf (lumberjack/medic/scavenger/assassin)
    peltTrades: 0,   // kürk tüccarı takas sayısı (kademeli ödül)
    backpack: 0,   // çanta yükseltmesi seviyesi (taşıma limitini artırır)
    benchTier: 1, hasMap: false, hasCompass: false, hasLightningRod: false, hasCrockpot: false, farms: 0, oilDrills: 0,
    placeables: {},  // tezgahta üretilen ama henüz kurulmamış yapılar {kind:adet}
    depot: {},   // 📦 depo sandığındaki kaynaklar {key:adet}
    fireFed: 0,   // ateşe atılan toplam odun (seviye için)
    swingCd: 0, stepT: 0, sick: 0, hurt: 0, bob: 0, py: 0, vy: 0,
    cookT: 0, fireCrackleT: 0, fishing: 0, deathReason: "",
    heart: 0, heartLevel: 0, jumpCd: 12, firstNightDone: false, scripted: false, bloodMoon: false, dreadT: null, glitchCd: 35,
    shake: 0,
    downed: false, bleed: 0, reviveT: 0, spectating: false,   // co-op: yere düşme / kan kaybı / diriltme / izleyici modu
    sleeping: 0,                            // çadırda uyuma animasyonu
    weather: "clear", weatherT: rnd(25, 55), lightT: null, flash: 0, rainSndT: 0,  // hava durumu / şimşek
    notes: [],                              // bulunan günlük notları
  };
}

/* ----- dinamik nesneler ----- */
const animals = [];   // {group,x,z,type,hp,state,dir,atkCd}
const fires = [];     // {group,light,flame,x,z,fuel,max,safeR}
const walls = [];     // {x,z,group,r} — oyuncunun diktiği barikatlar/kapılar
const traps = [];     // {x,z,group,cd} — çivili/ayı tuzakları
const photos = [];    // {mesh,mat,t} — kamera korkusunda ağaca asılan fotoğraflar
const torches = [];   // {x,z,group,safeR} — meşaleler (güvenli alan + ışık)
const totems = [];    // {x,z,group,r} — koruyucu totem (sanity aurası + güvenli alan)
const props = [];     // {x,z,group,kind} — yatak/tarla/diğer yapılar
const farms = [];     // {x,z,group,t,sprouts} — otomatik yiyecek üreten tarlalar
const flags = [];     // {x,z,group} — mini harita işaretleri
let baseFire = null;  // merkezi kalıcı kamp ateşi
let watcher = null;   // {group,head,x,z,seen,life,alpha}
let wCd = 8, wEnc = 0;

function clearDynamic() {
  for (const a of animals) scene.remove(a.group); animals.length = 0; bossAlive = false;
  if (heli) heli.visible = false;
  for (const f of fires) scene.remove(f.group); fires.length = 0;
  for (const w of walls) scene.remove(w.group); walls.length = 0;
  for (const t of traps) scene.remove(t.group); traps.length = 0;
  for (const p of photos) scene.remove(p.mesh); photos.length = 0;
  for (const t of torches) scene.remove(t.group); torches.length = 0;
  for (const t of totems) scene.remove(t.group); totems.length = 0;
  for (const p of props) scene.remove(p.group); props.length = 0; farms.length = 0;
  for (const fl of flags) scene.remove(fl.group); flags.length = 0;
  baseFire = null;
  if (watcher) { scene.remove(watcher.group); watcher = null; }
  for (const p of pickups) if (p.group) scene.remove(p.group); pickups.length = 0;   // yerdeki eşyalar
  for (const d of depots) if (d.group) scene.remove(d.group); depots.length = 0;   // 📦 depo sandıkları
  if (carried && carried.sprite) scene.remove(carried.sprite); carried = null;         // taşınan eşya
  // sandıkları kapat (yeniden oyun)
  for (const c of chests) { c.opened = false; if (c.lid) c.lid.rotation.x = 0; }
  for (const c of crystals) { c.hp = 3; c.mined = false; if (c.group) c.group.visible = true; }
}

/* ----- hayvan modeli ----- */
// Hayvan grubu rotation.y = -dir ile yönlenir; modelin "ön"ü +X'e bakmalı.
// GLB modelleri farklı eksene bakabilir → faceOff ile düzeltiyoruz (geyik yamuk koşma hatası fix).
function makeAnimal(type) {
  const g = new THREE.Group();
  if (type === "deer" && deerProto) {
    const m = deerProto.clone(true); m.rotation.y = Math.PI / 2;   // önünü +X'e çevir (yamuk koşma düzeltmesi)
    g.add(m); g.userData.model = m; scene.add(g); return g;
  }
  if (type === "jaguar" && jaguarProto) {                                                        // gerçek jaguar modeli + animasyon
    const m = SkeletonUtilsMod ? SkeletonUtilsMod.clone(jaguarProto) : jaguarProto.clone(true);  // iskeletli klon (animasyon için)
    m.rotation.y = -Math.PI / 2;                                                                 // modelin önünü +X'e çevir (rotation.y = -dir ile uyum)
    g.add(m); scene.add(g);
    if (jaguarClip) { const mixer = new THREE.AnimationMixer(m); mixer.clipAction(jaguarClip).play(); g.userData.mixer = mixer; g.userData.model = m; }
    return g;
  }
  if (type === "crawler") {                                   // SÜRÜNEN — solgun, uzun bacaklı gece yaratığı
    const pale = new THREE.MeshStandardMaterial({ color: 0xc4baa2, roughness: 1 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x2e2620, roughness: 1 });
    const blood = new THREE.MeshStandardMaterial({ color: 0x5e0000, emissive: 0x250000, emissiveIntensity: 0.4 });
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.3, 0.9, 4, 8), pale); body.rotation.z = Math.PI / 2; body.position.set(0.1, 0.55, 0); g.add(body);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.27, 10, 10), pale); head.position.set(0.75, 0.55, 0); head.scale.set(1, 0.82, 0.92); g.add(head);
    const mouth = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.16, 0.18), new THREE.MeshBasicMaterial({ color: 0x070000 })); mouth.position.set(0.96, 0.5, 0); g.add(mouth);
    const eye = new THREE.MeshStandardMaterial({ color: 0xff2a2a, emissive: 0xff0000, emissiveIntensity: 3.2 });
    for (const sz of [-1, 1]) { const e = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 8), eye); e.position.set(0.9, 0.62, sz * 0.1); g.add(e); }
    for (let i = 0; i < 6; i++) { const sx = i < 3 ? -1 : 1, lz = ((i % 3) - 1) * 0.34; const leg = new THREE.Mesh(new THREE.CapsuleGeometry(0.045, 1.0, 3, 5), dark); leg.position.set(lz, 0.5, sx * 0.42); leg.rotation.x = sx * 0.8; leg.rotation.z = 0.35; g.add(leg); }
    for (let i = 0; i < 5; i++) { const b = new THREE.Mesh(new THREE.BoxGeometry(0.03, rnd(0.2, 0.5), 0.02), blood); b.position.set(rnd(-0.1, 0.6), rnd(0.45, 0.75), rnd(-0.2, 0.2)); g.add(b); }
    if (shadowsOn) g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    scene.add(g); return g;
  }
  if (type === "mimic") {                                     // TAKLİTÇİ — uzaktan arkadaşa benzer, yaklaşınca saldırır
    if (mimicProto) {                                         // gerçek devitalizer modeli
      const m = mimicProto.clone(true); m.rotation.y = Math.PI / 2;   // önünü +X'e (rotation.y=-dir ile uyum)
      if (shadowsOn) m.traverse((o) => { if (o.isMesh) o.castShadow = true; });
      g.add(m); g.userData.model = m;
      g.add(new THREE.PointLight(0xbfe0ff, 0.5, 9, 1.6));     // arkadaş gibi ışık (tuzak)
      scene.add(g); return g;
    }
    const cloth = new THREE.MeshStandardMaterial({ color: 0x4f9be6, emissive: 0x0a1626, emissiveIntensity: 0.4, roughness: 1 });
    const skin = new THREE.MeshStandardMaterial({ color: 0xccc2ad, roughness: 1 });
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.36, 1.05, 4, 8), cloth); body.position.y = 1.05; g.add(body);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.3, 12, 12), skin); head.position.y = 1.95; g.add(head);
    g.add(new THREE.PointLight(0xbfe0ff, 0.5, 9, 1.6));        // arkadaş gibi ışık (tuzak)
    const eye = new THREE.MeshStandardMaterial({ color: 0xff2a2a, emissive: 0xff0000, emissiveIntensity: 0 });   // saldırınca kızarır
    for (const sz of [-1, 1]) { const e = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 8), eye); e.position.set(sz * 0.1, 1.98, 0.26); g.add(e); }
    g.userData.eyeMat = eye;
    if (shadowsOn) g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    scene.add(g); return g;
  }
  if (type === "lurker") {                                    // PUSUCU — ağacın yanında bekler, geçince fırlar
    const dark = new THREE.MeshStandardMaterial({ color: 0x20242a, roughness: 1 });
    const pale = new THREE.MeshStandardMaterial({ color: 0xb7ad96, roughness: 1 });
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.34, 1.0, 4, 8), dark); body.position.y = 1.0; body.rotation.x = 0.5; g.add(body);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.26, 10, 10), pale); head.position.set(0, 1.5, 0.3); g.add(head);
    const eye = new THREE.MeshStandardMaterial({ color: 0xffd23a, emissive: 0xffaa00, emissiveIntensity: 2.6 });
    for (const sz of [-1, 1]) { const e = new THREE.Mesh(new THREE.SphereGeometry(0.06, 8, 8), eye); e.position.set(sz * 0.1, 1.54, 0.52); g.add(e); }
    for (const sx of [-1, 1]) { const arm = new THREE.Mesh(new THREE.CapsuleGeometry(0.08, 1.1, 3, 6), dark); arm.position.set(sx * 0.4, 1.1, 0.2); arm.rotation.z = sx * 0.5; g.add(arm); for (let f = 0; f < 3; f++) { const cl = new THREE.Mesh(new THREE.ConeGeometry(0.04, 0.25, 4), pale); cl.position.set(sx * 0.7, 0.6, 0.3 + f * 0.05); cl.rotation.x = Math.PI; g.add(cl); } }
    if (shadowsOn) g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    scene.add(g); return g;
  }
  if (type === "pup") {                                       // SÜRÜ yavrusu — küçük, hızlı, zayıf
    const fur = new THREE.MeshStandardMaterial({ color: 0x33291f, roughness: 1, flatShading: true });
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.18, 0.5, 4, 6), fur); body.rotation.z = Math.PI / 2; body.position.y = 0.32; g.add(body);
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.24, 0.24), fur); head.position.set(0.42, 0.36, 0); g.add(head);
    const eye = new THREE.MeshStandardMaterial({ color: 0xff5a2a, emissive: 0xff3000, emissiveIntensity: 2.4 });
    for (const sz of [-1, 1]) { const e = new THREE.Mesh(new THREE.SphereGeometry(0.035, 6, 6), eye); e.position.set(0.55, 0.4, sz * 0.08); g.add(e); }
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) { const leg = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.28, 0.07), fur); leg.position.set(sx * 0.22, 0.14, sz * 0.12); g.add(leg); }
    if (shadowsOn) g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    scene.add(g); return g;
  }
  if (type === "lavabeast") {                                 // VOLKAN — kömürleşmiş gövde, ışıyan lav çatlakları
    const rock = new THREE.MeshStandardMaterial({ color: 0x1a120e, roughness: 1, flatShading: true });
    const lava = new THREE.MeshStandardMaterial({ color: 0xff5a1e, emissive: 0xff3300, emissiveIntensity: 2.0, roughness: 0.5, flatShading: true });
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.5, 1.0, 5, 9), rock); body.rotation.z = Math.PI / 2; body.position.set(0.1, 0.8, 0); g.add(body);
    const head = new THREE.Mesh(new THREE.DodecahedronGeometry(0.4, 0), rock); head.position.set(0.85, 0.9, 0); g.add(head);
    for (let i = 0; i < 7; i++) { const c = new THREE.Mesh(new THREE.IcosahedronGeometry(rnd(0.1, 0.2), 0), lava); c.position.set(rnd(-0.4, 0.8), rnd(0.6, 1.1), rnd(-0.35, 0.35)); g.add(c); }
    const eyeM = new THREE.MeshStandardMaterial({ color: 0xffe23a, emissive: 0xffd000, emissiveIntensity: 3 });
    for (const sz of [-1, 1]) { const e = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 8), eyeM); e.position.set(1.05, 0.96, sz * 0.14); g.add(e); }
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) { const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.1, 0.7, 6), rock); leg.position.set(sx * 0.45, 0.35, sz * 0.32); g.add(leg); }
    g.add(plight(0xff5a1e, 1.0, 8, 1.8, 0.3, 0.9, 0));
    if (shadowsOn) g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    scene.add(g); return g;
  }
  if (type === "fairy") {                                     // PERİ — küçük, ışıltılı, geceleri saldırgan
    const c = choice([0xff7ad9, 0x9b6cff, 0x66e0ff]);
    const core = new THREE.Mesh(new THREE.IcosahedronGeometry(0.26, 0), new THREE.MeshStandardMaterial({ color: c, emissive: c, emissiveIntensity: 2.2, roughness: 0.4, flatShading: true })); core.position.y = 1.4; g.add(core);
    const wingM = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xbfe0ff, emissiveIntensity: 0.8, transparent: true, opacity: 0.55, side: THREE.DoubleSide });
    for (const sz of [-1, 1]) { const w = new THREE.Mesh(new THREE.CircleGeometry(0.3, 8), wingM); w.position.set(0, 1.45, sz * 0.18); w.rotation.y = sz * 0.6; g.add(w); }
    g.add(plight(c, 0.8, 7, 1.8, 0, 1.4, 0));
    if (shadowsOn) core.castShadow = true; scene.add(g); return g;
  }
  if (type === "cultist") {                                   // CULTIST KING — volkan bossu, kukuletalı, asalı
    const robe = new THREE.MeshStandardMaterial({ color: 0x2a0810, emissive: 0x3a0000, emissiveIntensity: 0.5, roughness: 1, flatShading: true });
    const gold = new THREE.MeshStandardMaterial({ color: 0xd9a441, metalness: 0.6, roughness: 0.4 });
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 1.0, 2.6, 8), robe); body.position.y = 1.3; g.add(body);
    const hood = new THREE.Mesh(new THREE.ConeGeometry(0.55, 1.0, 8), robe); hood.position.y = 2.7; g.add(hood);
    const face = new THREE.Mesh(new THREE.SphereGeometry(0.3, 10, 10), new THREE.MeshBasicMaterial({ color: 0x050000 })); face.position.set(0.18, 2.45, 0); g.add(face);
    const eyeM = new THREE.MeshStandardMaterial({ color: 0xff2a2a, emissive: 0xff0000, emissiveIntensity: 4 });
    for (const sz of [-1, 1]) { const e = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 8), eyeM); e.position.set(0.34, 2.5, sz * 0.12); g.add(e); }
    const staff = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 3.0, 6), gold); staff.position.set(0.6, 1.5, 0); g.add(staff);
    const orb = new THREE.Mesh(new THREE.IcosahedronGeometry(0.28, 0), new THREE.MeshStandardMaterial({ color: 0xff5a1e, emissive: 0xff3300, emissiveIntensity: 2.4, flatShading: true })); orb.position.set(0.6, 3.1, 0); g.add(orb);
    g.add(plight(0xff3a1e, 1.6, 12, 1.6, 0.6, 3.1, 0));
    g.scale.setScalar(1.35);
    if (shadowsOn) g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    scene.add(g); return g;
  }
  if (type === "spider") {                                    // MAĞARA ÖRÜMCEĞİ — koyu, çok bacaklı, ışıyan gözler
    const dark = new THREE.MeshStandardMaterial({ color: 0x161213, roughness: 1, flatShading: true });
    const abd = new THREE.Mesh(new THREE.SphereGeometry(0.4, 10, 10), dark); abd.position.set(-0.25, 0.45, 0); abd.scale.set(1.1, 0.9, 1.1); g.add(abd);
    const ceph = new THREE.Mesh(new THREE.SphereGeometry(0.26, 10, 10), dark); ceph.position.set(0.28, 0.42, 0); g.add(ceph);
    const eyeM = new THREE.MeshStandardMaterial({ color: 0xff3030, emissive: 0xff0000, emissiveIntensity: 3 });
    for (const sz of [-1, 1]) for (const yy of [0, 1]) { const e = new THREE.Mesh(new THREE.SphereGeometry(0.04, 6, 6), eyeM); e.position.set(0.46, 0.46 + yy * 0.08, sz * 0.1); g.add(e); }
    for (let i = 0; i < 8; i++) { const sx = i < 4 ? -1 : 1, lz = ((i % 4) - 1.5) * 0.22; const leg = new THREE.Mesh(new THREE.CapsuleGeometry(0.035, 0.8, 3, 5), dark); leg.position.set(lz + 0.05, 0.42, sx * 0.32); leg.rotation.x = sx * 0.9; leg.rotation.z = 0.5 - Math.abs((i % 4) - 1.5) * 0.2; g.add(leg); }
    if (shadowsOn) g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    scene.add(g); return g;
  }
  if (type === "queen") {                                     // MADEN KRALİÇESİ — dev örümcek boss, ışıyan yumurta kesesi + kızıl aura
    const dark = new THREE.MeshStandardMaterial({ color: 0x1a0e14, roughness: 1, flatShading: true });
    const sac = new THREE.MeshStandardMaterial({ color: 0x5a1020, emissive: 0x7a1226, emissiveIntensity: 0.9, roughness: 0.8, flatShading: true });
    const abd = new THREE.Mesh(new THREE.SphereGeometry(0.95, 12, 12), sac); abd.position.set(-0.6, 1.0, 0); abd.scale.set(1.2, 1.0, 1.2); g.add(abd);
    const ceph = new THREE.Mesh(new THREE.SphereGeometry(0.55, 12, 12), dark); ceph.position.set(0.62, 0.95, 0); g.add(ceph);
    const eyeM = new THREE.MeshStandardMaterial({ color: 0xff5020, emissive: 0xff2000, emissiveIntensity: 3 });
    for (const sz of [-1, 1]) for (const yy of [0, 1]) { const e = new THREE.Mesh(new THREE.SphereGeometry(0.09, 8, 8), eyeM); e.position.set(1.0, 0.98 + yy * 0.16, sz * 0.22); g.add(e); }
    for (let i = 0; i < 8; i++) { const sx = i < 4 ? -1 : 1, lz = ((i % 4) - 1.5) * 0.5; const leg = new THREE.Mesh(new THREE.CapsuleGeometry(0.08, 1.8, 3, 6), dark); leg.position.set(lz + 0.1, 0.95, sx * 0.7); leg.rotation.x = sx * 0.9; leg.rotation.z = 0.5 - Math.abs((i % 4) - 1.5) * 0.16; g.add(leg); }
    g.add(plight(0xff3020, 0.7, 9, 2, 0, 1.2, 0));
    if (shadowsOn) g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    scene.add(g); return g;
  }
  if (animalProtos[type]) {                                   // yüklenmiş gerçek GLB (boar/capybara/tapir)
    const src = animalProtos[type]; const m = SkeletonUtilsMod ? SkeletonUtilsMod.clone(src.proto) : src.proto.clone(true);
    m.rotation.y = Math.PI / 2; g.add(m); g.userData.model = m;
    if (src.clip) { const mixer = new THREE.AnimationMixer(m); mixer.clipAction(src.clip).play(); g.userData.mixer = mixer; }
    scene.add(g); return g;
  }
  // ----- organik prosedürel hayvan (kapsül gövde + küre kafa) — kutu görünümü kalktı -----
  const P = ({
    capybara: { col: 0x8a6a44, len: 1.0, rad: 0.4, legH: 0.34, headR: 0.32, headFwd: 0.66, headY: 0.62, snout: "blunt", ears: "round" },
    boar: { col: 0x4a3a30, len: 1.05, rad: 0.42, legH: 0.42, headR: 0.3, headFwd: 0.66, headY: 0.6, snout: "snout", ears: "point", tusks: true, bristle: true },
    tapir: { col: 0x4a4248, len: 1.45, rad: 0.44, legH: 0.5, headR: 0.32, headFwd: 0.92, headY: 0.74, snout: "trunk", ears: "round" },
    deer: { col: 0x9a7a52, len: 1.0, rad: 0.3, legH: 0.62, headR: 0.24, headFwd: 0.66, headY: 1.1, snout: "blunt", ears: "point", neck: true, antlers: true },
    jaguar: { col: 0xc8902c, len: 1.4, rad: 0.36, legH: 0.5, headR: 0.3, headFwd: 0.95, headY: 0.72, snout: "blunt", ears: "point", eyes: true },
    polarbear: { col: 0xeef3f8, len: 1.6, rad: 0.6, legH: 0.62, headR: 0.42, headFwd: 1.0, headY: 0.95, snout: "snout", ears: "round", eyes: true },
  })[type] || { col: 0x8a6a44, len: 1.0, rad: 0.38, legH: 0.4, headR: 0.3, headFwd: 0.66, headY: 0.62, snout: "blunt", ears: "round" };
  const mat = new THREE.MeshStandardMaterial({ color: P.col, roughness: 0.95 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x2a2018, roughness: 1 });
  const bodyY = P.legH + P.rad * 0.7;
  // gövde (yatay kapsül)
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(P.rad, P.len, 6, 12), mat); body.rotation.z = Math.PI / 2; body.position.set(0.1, bodyY, 0); g.add(body);
  const rump = new THREE.Mesh(new THREE.SphereGeometry(P.rad * 1.05, 10, 10), mat); rump.position.set(-P.len * 0.5, bodyY, 0); g.add(rump);
  // boyun (geyik/jaguar) + kafa
  if (P.neck) { const neck = new THREE.Mesh(new THREE.CapsuleGeometry(P.rad * 0.45, 0.5, 4, 8), mat); neck.position.set(P.headFwd - 0.18, bodyY + 0.32, 0); neck.rotation.z = -0.8; g.add(neck); }
  const head = new THREE.Mesh(new THREE.SphereGeometry(P.headR, 12, 12), mat); head.scale.set(1.15, 0.95, 0.92); head.position.set(P.headFwd, P.headY, 0); g.add(head);
  // burun/namlu
  if (P.snout === "trunk") { const tr = new THREE.Mesh(new THREE.CapsuleGeometry(0.09, 0.34, 4, 8), mat); tr.position.set(P.headFwd + P.headR + 0.12, P.headY - 0.12, 0); tr.rotation.z = 0.9; g.add(tr); }
  else if (P.snout === "snout") { const sn = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.2, 0.26, 8), mat); sn.rotation.z = Math.PI / 2; sn.position.set(P.headFwd + P.headR + 0.05, P.headY - 0.04, 0); g.add(sn); const nose = new THREE.Mesh(new THREE.SphereGeometry(0.1, 8, 8), dark); nose.position.set(P.headFwd + P.headR + 0.2, P.headY - 0.04, 0); g.add(nose); }
  else { const sn = new THREE.Mesh(new THREE.SphereGeometry(0.16, 8, 8), mat); sn.scale.set(1.2, 0.85, 0.85); sn.position.set(P.headFwd + P.headR * 0.7, P.headY - 0.08, 0); g.add(sn); }
  // kulaklar
  for (const sz of [-1, 1]) {
    let ear;
    if (P.ears === "point") { ear = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.18, 5), mat); ear.position.set(P.headFwd - 0.05, P.headY + P.headR * 0.9, sz * 0.16); }
    else { ear = new THREE.Mesh(new THREE.SphereGeometry(0.08, 8, 8), mat); ear.position.set(P.headFwd - 0.06, P.headY + P.headR * 0.8, sz * 0.18); }
    g.add(ear);
  }
  // bacaklar (silindir)
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.07, P.legH, 7), dark);
    leg.position.set(P.len * 0.34 * sx, P.legH / 2, sz * (P.rad * 0.7)); g.add(leg);
  }
  // tür özellikleri
  if (P.antlers) for (const sz of [-1, 1]) { const horn = new THREE.Mesh(new THREE.ConeGeometry(0.045, 0.55, 5), new THREE.MeshStandardMaterial({ color: 0x6a5436 })); horn.position.set(P.headFwd - 0.05, P.headY + 0.42, sz * 0.13); horn.rotation.z = sz * 0.35; g.add(horn); }
  if (P.tusks) for (const sz of [-1, 1]) { const tusk = new THREE.Mesh(new THREE.ConeGeometry(0.035, 0.2, 5), new THREE.MeshStandardMaterial({ color: 0xe8e0c8 })); tusk.position.set(P.headFwd + P.headR + 0.16, P.headY - 0.14, sz * 0.1); tusk.rotation.z = 1.9; g.add(tusk); }
  if (P.bristle) for (let i = 0; i < 5; i++) { const b = new THREE.Mesh(new THREE.ConeGeometry(0.03, 0.22, 4), dark); b.position.set(0.4 - i * 0.18, bodyY + P.rad * 0.9, 0); g.add(b); }
  if (P.eyes) { const em = new THREE.MeshStandardMaterial({ color: 0xffd83a, emissive: 0xffcc22, emissiveIntensity: 1.4 }); for (const sz of [-1, 1]) { const e = new THREE.Mesh(new THREE.SphereGeometry(0.06, 6, 6), em); e.position.set(P.headFwd + P.headR * 0.7, P.headY + 0.06, sz * 0.13); g.add(e); } }
  if (shadowsOn) g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  scene.add(g); return g;
}
function spawnPrey() {
  const type = choice(["capybara", "deer", "tapir", "boar"]);
  const a = { group: makeAnimal(type), x: rnd(-CFG.WORLD, CFG.WORLD), z: rnd(-CFG.WORLD, CFG.WORLD), type, hp: 5, state: "wander", dir: rnd(0, 6.28), atkCd: 0, t: rnd(0, 3), hostile: false };
  animals.push(a);
}
function spawnJaguar() {
  const ang = rnd(0, 6.28), d = rnd(30, 50);
  const a = { group: makeAnimal("jaguar"), x: camera.position.x + Math.cos(ang) * d, z: camera.position.z + Math.sin(ang) * d, type: "jaguar", hp: 14, state: "stalk", dir: 0, atkCd: 0, pounce: 0, bite: 0, hostile: true };
  animals.push(a);
}
function spawnCrawler() {
  const ang = rnd(0, 6.28), d = rnd(20, 38);
  animals.push({ group: makeAnimal("crawler"), x: camera.position.x + Math.cos(ang) * d, z: camera.position.z + Math.sin(ang) * d, type: "crawler", hp: 9, state: "chase", dir: 0, atkCd: 0, pounce: 0, bite: 0, hostile: true });
}
function spawnMimic() {                                        // arkadaş gibi durur, yaklaşınca saldırır
  const ang = rnd(0, 6.28), d = rnd(12, 22);
  const a = { group: makeAnimal("mimic"), x: camera.position.x + Math.cos(ang) * d, z: camera.position.z + Math.sin(ang) * d, type: "mimic", hp: 16, state: "lure", dir: ang + Math.PI, atkCd: 0, bite: 0, hostile: false };
  animals.push(a); whisperText(choice(["buraya gel", "yardım et...", "bekliyorum", "neredesin?"])); Sound.whisper();
}
function spawnLurker() {                                       // bir ağacın yanına gizlenir
  const alive = trees.filter((t) => t.alive && Math.hypot(t.x - camera.position.x, t.z - camera.position.z) < 30 && Math.hypot(t.x - camera.position.x, t.z - camera.position.z) > 8);
  const t = alive.length ? choice(alive) : null; if (!t) return;
  animals.push({ group: makeAnimal("lurker"), x: t.x, z: t.z, type: "lurker", hp: 11, state: "hide", dir: 0, atkCd: 0, bite: 0, hostile: false, homeX: t.x, homeZ: t.z });
}
function spawnPack() {                                         // sürü: 4-6 hızlı yavru
  const baseAng = rnd(0, 6.28), bd = rnd(24, 38), n = rndi(4, 6);
  const bx = camera.position.x + Math.cos(baseAng) * bd, bz = camera.position.z + Math.sin(baseAng) * bd;
  for (let i = 0; i < n; i++) animals.push({ group: makeAnimal("pup"), x: bx + rnd(-3, 3), z: bz + rnd(-3, 3), type: "pup", hp: 3, state: "chase", dir: 0, atkCd: 0, bite: 0, hostile: true });
  Sound.growl(); whisperText("sürü geliyor!");
}
/* ----- BİYOM YARATIKLARI + CULTIST KING boss ----- */
const BEAST = {
  polarbear: { sp: 4.8, dmg: 14, reach: 2.2, hp: 26, fearFire: false, nightOnly: false, desp: 72 },
  lavabeast: { sp: 6.2, dmg: 12, reach: 2.0, hp: 18, fearFire: false, nightOnly: false, desp: 60, burn: true },
  fairy:     { sp: 7.2, dmg: 7,  reach: 1.9, hp: 8,  fearFire: true,  nightOnly: true,  desp: 46, sanity: 9 },
  cultist:   { sp: 3.2, dmg: 24, reach: 2.8, hp: 95, fearFire: false, nightOnly: false, desp: 999, boss: true },
  spider:    { sp: 5.6, dmg: 9,  reach: 1.7, hp: 7,  fearFire: false, nightOnly: false, desp: 32 },
  queen:     { sp: 3.4, dmg: 20, reach: 2.7, hp: 88, fearFire: false, nightOnly: false, desp: 999, boss: true, sanity: 6 },   // 🕷️👑 MADEN KRALİÇESİ (maden boss'u)
};
const beastName = (t) => ({ polarbear: "kutup ayısı", lavabeast: "lav yaratığı", fairy: "peri saldırısı", cultist: "Cultist King", spider: "mağara örümceği", queen: "Maden Kraliçesi" }[t] || t);
let bossAlive = false;
function spawnBeast(type) {
  const B = BEAST[type], ang = rnd(0, 6.28), d = rnd(22, 40);
  let x = clamp(camera.position.x + Math.cos(ang) * d, -CFG.WORLD, CFG.WORLD), z = clamp(camera.position.z + Math.sin(ang) * d, -CFG.WORLD, CFG.WORLD);
  animals.push({ group: makeAnimal(type), x, z, type, hp: B.hp, maxhp: B.hp, state: "chase", dir: 0, atkCd: 0, bite: 0, slow: 0, hostile: true, boss: !!B.boss });
}
function spawnCultistKing() { if (bossAlive) return; bossAlive = true; spawnBeast("cultist"); Sound.growl(); whisperText("CULTIST KING uyandı..."); toast("🌋👑 CULTIST KING beliriyor!", "bad"); S.shake = Math.max(S.shake, 0.6); }
function spawnMineQueen() {   // 🕷️👑 MADEN KRALİÇESİ — madenin derinliğinde uyanır
  if (bossAlive || !mineSpot) return; bossAlive = true;
  const ang = rnd(0, 6.28), d = rnd(8, 14);
  animals.push({ group: makeAnimal("queen"), x: mineSpot.x + Math.cos(ang) * d, z: mineSpot.z + Math.sin(ang) * d, type: "queen", hp: BEAST.queen.hp, maxhp: BEAST.queen.hp, state: "chase", dir: 0, atkCd: 0, bite: 0, slow: 0, hostile: true, boss: true });
  Sound.growl(); whisperText("MADEN KRALİÇESİ uyandı..."); toast("🕷️👑 MADEN KRALİÇESİ! Savaş ya da çıkışa koş!", "bad"); S.shake = Math.max(S.shake, 0.6); S.heartLevel = Math.max(S.heartLevel, 0.9);
}

/* ----- ateş modeli ----- */
function makeFire(x, z) {
  const g = new THREE.Group(); g.position.set(x, 0, z);
  const stoneRim = new THREE.Group(); g.add(stoneRim);   // taş ocak tabanı (seviye ile büyür)
  const logPile = new THREE.Group(); g.add(logPile);     // çapraz tomruk yığını
  const halo = new THREE.Mesh(new THREE.ConeGeometry(0.6, 1.6, 10), new THREE.MeshBasicMaterial({ color: 0xff5a12, transparent: true, opacity: 0.28, depthWrite: false, blending: THREE.AdditiveBlending })); halo.position.y = 0.85; g.add(halo);  // sıcak parıltı (bloom yakalar)
  const flame = new THREE.Mesh(new THREE.ConeGeometry(0.35, 1.1, 7), new THREE.MeshBasicMaterial({ color: 0xff7a1a, transparent: true, opacity: 0.92 })); flame.position.y = 0.7; g.add(flame);
  const flame2 = new THREE.Mesh(new THREE.ConeGeometry(0.2, 0.7, 6), new THREE.MeshBasicMaterial({ color: 0xffe06a, transparent: true, opacity: 0.96 })); flame2.position.y = 0.55; g.add(flame2);
  const core = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.4, 6), new THREE.MeshBasicMaterial({ color: 0xfff2c0, transparent: true, opacity: 1 })); core.position.y = 0.42; g.add(core);  // beyaz-sıcak çekirdek
  const light = new THREE.PointLight(0xff8a3c, 2.6, 18, 1.5); light.position.y = 1; g.add(light);
  // kıvılcımlar
  const EN = 26, ep = new Float32Array(EN * 3), ev = [];
  for (let i = 0; i < EN; i++) { ep[i * 3] = rnd(-0.2, 0.2); ep[i * 3 + 1] = rnd(0.2, 1.5); ep[i * 3 + 2] = rnd(-0.2, 0.2); ev.push(rnd(0.6, 1.8)); }
  const egeo = new THREE.BufferGeometry(); egeo.setAttribute("position", new THREE.BufferAttribute(ep, 3));
  const emat = new THREE.PointsMaterial({ color: 0xffb24a, size: 0.12, transparent: true, opacity: 0.9, depthWrite: false, blending: THREE.AdditiveBlending });
  const embers = new THREE.Points(egeo, emat); embers.frustumCulled = false; g.add(embers);
  // yakıt barı (ateşin üstünde, kameraya döner)
  const bar = new THREE.Group(); bar.position.y = 2.4; g.add(bar);
  const barBg = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 0.2), new THREE.MeshBasicMaterial({ color: 0x100804, transparent: true, opacity: 0.7, depthTest: false })); bar.add(barBg);
  const barFill = new THREE.Mesh(new THREE.PlaneGeometry(1.42, 0.13), new THREE.MeshBasicMaterial({ color: 0xff8a2a, depthTest: false })); barFill.position.z = 0.01; bar.add(barFill);
  scene.add(g);
  const f = { group: g, light, flame, flame2, halo, core, embers, ev, stoneRim, logPile, bar, barFill, x, z, fuel: 70, max: 140, safeR: 11, level: 0, base: false }; fires.push(f); return f;
}
// ateş seviyesi (1-4): taş ocak rimi + çapraz tomruk yığını + güvenli alan + alev (fotodaki gibi)
function setFireLevel(f, lvl) {
  lvl = clamp(lvl, 1, 4); if (lvl === f.level && f.logPile.children.length) return; f.level = lvl;
  for (const grp of [f.stoneRim, f.logPile]) while (grp.children.length) grp.remove(grp.children[0]);
  // taş ocak rimi (pembe-gri kayalar — referans görselindeki gibi)
  const sMat = new THREE.MeshStandardMaterial({ color: 0xc7a8a4, roughness: 1, flatShading: true });
  const ringR = 0.85 + lvl * 0.13, stoneN = 9 + lvl * 3;
  for (let i = 0; i < stoneN; i++) { const a = (i / stoneN) * 6.283; const s = new THREE.Mesh(new THREE.DodecahedronGeometry(rnd(0.2, 0.34), 0), sMat); s.position.set(Math.cos(a) * ringR, 0.12, Math.sin(a) * ringR); s.scale.y = 0.7; s.rotation.set(rnd(0, 3), rnd(0, 3), rnd(0, 3)); if (shadowsOn) s.castShadow = true; f.stoneRim.add(s); }
  // çapraz tomruk yığını (katman katman)
  const logMat = new THREE.MeshStandardMaterial({ color: 0x8a5a2c, roughness: 0.95 });
  const layers = 1 + lvl, cnt = 2 + (lvl > 2 ? 1 : 0);
  for (let L = 0; L < layers; L++) { const along = L % 2 === 0; for (let k = 0; k < cnt; k++) { const off = (k - (cnt - 1) / 2) * 0.28; const log = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.11, 1.0, 7), logMat); log.rotation.z = Math.PI / 2; if (!along) log.rotation.y = Math.PI / 2; log.position.set(along ? 0 : off, 0.24 + L * 0.17, along ? off : 0); if (shadowsOn) log.castShadow = true; f.logPile.add(log); } }
  f.safeR = 9 + lvl * 3.5;                 // L1:12.5 → L4:23
  f.max = [0, 140, 260, 420, 650][lvl];
  const sc = 0.7 + lvl * 0.28; f.flame.scale.setScalar(sc); f.flame2.scale.setScalar(sc); f.halo.scale.setScalar(sc * 1.1);
  const fy = 0.5 + layers * 0.17; f.halo.position.y = fy + 0.4; f.flame.position.y = fy + 0.25; f.flame2.position.y = fy + 0.1; f.core.position.y = fy;   // alev yığının üstünde
}

/* ----- üs: barikat duvarı + çivili tuzak (oyuncu diker) ----- */
function makeWall(x, z, rotY) {
  const g = new THREE.Group(); g.position.set(x, 0, z); g.rotation.y = rotY || 0;
  const wood = new THREE.MeshStandardMaterial({ map: woodTex, color: 0x9c7a48, roughness: 1, flatShading: true });
  for (let i = -2; i <= 2; i++) { const p = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.18, 2.0, 6), wood); p.position.set(i * 0.42, 1.0, 0); p.rotation.x = rnd(-0.05, 0.05); g.add(p); const tip = new THREE.Mesh(new THREE.ConeGeometry(0.18, 0.35, 6), wood); tip.position.set(i * 0.42, 2.1, 0); g.add(tip); }
  const rail = new THREE.Mesh(new THREE.BoxGeometry(2.1, 0.16, 0.16), wood); rail.position.set(0, 1.4, 0); g.add(rail);
  if (shadowsOn) g.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  scene.add(g); const w = { x, z, group: g, r: 1.25, hp: 100, maxhp: 100 }; walls.push(w); return w;
}
function makeSpikeTrap(x, z) {
  const g = new THREE.Group(); g.position.set(x, 0, z);
  const base = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.08, 1.3), new THREE.MeshStandardMaterial({ color: 0x33270f, roughness: 1 })); base.position.y = 0.04; g.add(base);
  const spike = new THREE.MeshStandardMaterial({ color: 0x9aa0a6, metalness: 0.6, roughness: 0.4 });
  for (let i = 0; i < 9; i++) { const s = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.5, 5), spike); s.position.set(((i % 3) - 1) * 0.4, 0.28, ((i / 3 | 0) - 1) * 0.4); g.add(s); }
  if (shadowsOn) g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  scene.add(g); const t = { x, z, group: g, cd: 0 }; traps.push(t); return t;
}
function placeInFront(dist) { camera.getWorldDirection(_fwd); _fwd.y = 0; _fwd.normalize(); return [camera.position.x + _fwd.x * (dist || 2.4), camera.position.z + _fwd.z * (dist || 2.4)]; }

/* ----- İzleyen modeli ----- */
function makeWatcher() {
  const g = new THREE.Group();
  if (watcherProto) {                                          // gerçek necromorph modeli
    const m = watcherProto.clone(true); m.rotation.y = -Math.PI / 2;   // modelin önü +X'te; İzleyen +Z yönüne bakar → -90° ile oyuncuya döner (yan koşma fix)
    if (shadowsOn) m.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    g.add(m);
    const rl = new THREE.PointLight(0xff1010, 0.7, 7, 2); rl.position.set(0, 3.3, 0.3); g.add(rl);   // kızıl parıltı
    scene.add(g); g.visible = false; return g;
  }
  const skin = new THREE.MeshStandardMaterial({ color: 0xb9a892, roughness: 0.9 });             // solgun/hasta ten (kanlı insansı)
  const pale = new THREE.MeshStandardMaterial({ color: 0xcfc7b8, emissive: 0x2c241c, emissiveIntensity: 0.35, roughness: 1 });
  const blood = new THREE.MeshStandardMaterial({ color: 0x5e0000, emissive: 0x300000, emissiveIntensity: 0.4, roughness: 0.6 });
  const eyeMat = new THREE.MeshStandardMaterial({ color: 0xff2a2a, emissive: 0xff0000, emissiveIntensity: 3.2 });
  // gövde — ince, uzun, hafif öne eğik
  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.32, 1.7, 4, 10), skin); torso.position.y = 2.55; torso.rotation.x = 0.12; g.add(torso);
  const pelvis = new THREE.Mesh(new THREE.CapsuleGeometry(0.26, 0.5, 4, 8), skin); pelvis.position.y = 1.62; g.add(pelvis);
  for (const sx of [-1, 1]) {
    const upper = new THREE.Mesh(new THREE.CapsuleGeometry(0.1, 1.2, 3, 6), skin); upper.position.set(sx * 0.42, 2.55, 0.05); upper.rotation.z = sx * 0.2; g.add(upper);
    const fore = new THREE.Mesh(new THREE.CapsuleGeometry(0.085, 1.3, 3, 6), skin); fore.position.set(sx * 0.6, 1.45, 0.08); g.add(fore);
    for (let f = 0; f < 3; f++) { const cl = new THREE.Mesh(new THREE.ConeGeometry(0.035, 0.26, 4), skin); cl.position.set(sx * 0.6 + (f - 1) * 0.06, 0.74, 0.12); cl.rotation.x = Math.PI; g.add(cl); }
    const leg = new THREE.Mesh(new THREE.CapsuleGeometry(0.13, 1.55, 4, 8), skin); leg.position.set(sx * 0.16, 0.8, 0); g.add(leg);
  }
  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.12, 0.5, 6), skin); neck.position.y = 3.55; neck.rotation.x = 0.28; g.add(neck);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.3, 16, 16), pale); head.position.set(0, 3.85, 0.07); head.scale.set(0.85, 1.18, 0.92); g.add(head);
  for (const sx of [-1, 1]) {
    const socket = new THREE.Mesh(new THREE.SphereGeometry(0.095, 8, 8), new THREE.MeshBasicMaterial({ color: 0x000000 })); socket.position.set(sx * 0.12, 3.9, 0.27); g.add(socket);
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 8), eyeMat); eye.position.set(sx * 0.12, 3.9, 0.31); g.add(eye);
  }
  const mouth = new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.13, 0.05), new THREE.MeshBasicMaterial({ color: 0x070000 })); mouth.position.set(0, 3.72, 0.29); g.add(mouth);
  // kan akıntıları (tüm gövdeye)
  for (let i = 0; i < 16; i++) { const b = new THREE.Mesh(new THREE.BoxGeometry(rnd(0.02, 0.05), rnd(0.25, 1.0), 0.02), blood); b.position.set(rnd(-0.34, 0.34), rnd(0.9, 3.9), rnd(0.0, 0.34)); b.rotation.z = rnd(-0.25, 0.25); g.add(b); }
  // kan lekeleri
  for (let i = 0; i < 9; i++) { const s = new THREE.Mesh(new THREE.SphereGeometry(rnd(0.06, 0.15), 6, 6), blood); s.position.set(rnd(-0.32, 0.32), rnd(1.6, 3.6), 0.28); s.scale.z = 0.3; g.add(s); }
  if (shadowsOn) g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
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
  watcherGroup.position.set(x, 0, z); watcherGroup.scale.setScalar(1); watcherGroup.visible = true;
  watcher = { group: watcherGroup, x, z, seen: 0, life: rnd(7, 14), alpha: 0 };
  Sound.whisper();
  if (Math.random() < 0.5) whisperText(choice(["arkanda...", "seni görüyor", "kaçma", "100 gün... olmayacak"]));
}
function vanishWatcher(quiet) { if (watcherGroup) watcherGroup.visible = false; watcher = null; wCd = rnd(9, 22) - Math.min(S.day * 0.05, 6); if (!quiet) { Sound.whoosh(); whisperText("..."); } }

/* ----------------------- INPUT ----------------------- */
const keys = {};
let yaw = 0, pitch = 0, locked = false, isTouch = false;
const inp = { jx: 0, jy: 0, joy: false, sprint: false, action: false, fire: false, eat: false, bandage: false, sleep: false, shoot: false, jump: false };
let actionDown = false;   // aksiyon basılı mı (motorlu testere ile sürekli kesim için)
let shootDown = false;    // ateş basılı mı (menzilli silahla sürekli ateş)

const typingInField = (e) => { const t = e.target; return t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable); };
addEventListener("keydown", (e) => {
  if (typingInField(e)) return;            // input/şifre/e-posta alanına yazarken oyun tuşlarını yok say
  const k = e.key.toLowerCase(); const first = !keys[k]; keys[k] = true;
  if (["w", "a", "s", "d", " ", "shift"].includes(k)) e.preventDefault();
  if (k === "e") inp.action = true;
  if (k === " ") inp.jump = true;   // zıpla
  if (k === "f") inp.fire = true;
  if (k === "g") inp.eat = true;
  if (k === "r") { inp.shoot = true; shootDown = true; }   // ateş et (menzilli silah)
  if (first && k === "q") cycleWeapon();                    // menzilli silah değiştir (eski usül)
  if (first && k === "z") cycleMelee();                     // yakın dövüş silahı değiştir (eski usül)
  if (first && k >= "1" && k <= "9") selectSlot(+k - 1);    // HIZLI SLOT: 1..9 ile silah seç
  if (first && k === "0") selectSlot(9);                    // HIZLI SLOT: 0 = 10. slot
  if (first && (k === "\\" || k === "p")) toggleAdmin();    // 🛡️ ADMİN paneli (\\ veya P)
  if (first && k === "l") toggleFlash();                    // el feneri aç/kapa
  if (first && k === "h") inp.shoot = true;                 // alternatif ateş tuşu
  if (k === "v") startTalk();           // bas-konuş (sesli sohbet)
  if (first && k === "c") toggleCraft();   // tezgah (kısayol; ana yol: tezgaha yaklaş)
  if (first && k === "b") inp.bandage = true;  // bandaj (can / dirilt)
  if (first && k === "t") inp.sleep = true;    // çadır/yatakta uyu
  if (first && k === "m") { if (S && S.hasMap) { S.bigMap = !S.bigMap; toast(S.bigMap ? "🗺️ Geniş harita AÇIK" : "🗺️ Harita kapandı", "good"); } else if (S && S.running) toast("Önce 🗺️ Harita üret (tezgah)", "bad"); }
  if (first && (k === "y" || k === "enter")) openChat();   // 💬 co-op global sohbet
  if (first && k === "x") useDynamite();                    // 🧨 dinamit patlat
  if (k === "backspace") { e.preventDefault(); if (first) openDrop(); }   // ⬇️ eşya bırak menüsü (co-op paylaşım)
});
addEventListener("keyup", (e) => { if (typingInField(e)) return; const k = e.key.toLowerCase(); keys[k] = false; if (k === "v") stopTalk(); if (k === "r") shootDown = false; });

threeCanvas.addEventListener("mousedown", (e) => {
  if (!S || !S.running) return;
  if (!isTouch && !locked) { threeCanvas.requestPointerLock && threeCanvas.requestPointerLock(); return; }
  if (e.button === 0) { inp.action = true; actionDown = true; }
  if (e.button === 2) { inp.shoot = true; shootDown = true; }   // sağ tık → ateş
});
document.addEventListener("mouseup", (e) => { if (e.button === 0) actionDown = false; if (e.button === 2) shootDown = false; });
threeCanvas.addEventListener("contextmenu", (e) => e.preventDefault());
document.addEventListener("pointerlockchange", () => { locked = (document.pointerLockElement === threeCanvas); });
document.addEventListener("mousemove", (e) => { if (locked) { const s = 0.0022 * Settings.lookSens; yaw -= e.movementX * s; pitch = clamp(pitch - e.movementY * s, -1.45, 1.45); } });

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
lookZone.addEventListener("touchmove", (e) => { const s = 0.005 * Settings.lookSens; for (const t of e.changedTouches) if (t.identifier === lookId) { yaw -= (t.clientX - lookX) * s; pitch = clamp(pitch - (t.clientY - lookY) * s, -1.45, 1.45); lookX = t.clientX; lookY = t.clientY; } e.preventDefault(); }, { passive: false });
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
{ const ba = $("btn-action"); if (ba) { const d = () => { actionDown = true; }, u = () => { actionDown = false; }; ba.addEventListener("touchstart", d, { passive: false }); ba.addEventListener("touchend", u); ba.addEventListener("touchcancel", u); ba.addEventListener("mousedown", d); ba.addEventListener("mouseup", u); } }
bindBtn("btn-fire", () => (inp.fire = true));
bindBtn("btn-eat", () => (inp.eat = true));
bindBtn("btn-bandage", () => (inp.bandage = true));
bindBtn("btn-jump", () => (inp.jump = true));
bindBtn("btn-shoot", () => (inp.shoot = true));
{ const bs = $("btn-shoot"); if (bs) { const d = () => { shootDown = true; }, u = () => { shootDown = false; }; bs.addEventListener("touchstart", d, { passive: false }); bs.addEventListener("touchend", u); bs.addEventListener("touchcancel", u); bs.addEventListener("mousedown", d); bs.addEventListener("mouseup", u); } }
{ const bw = $("btn-weapon"); if (bw) { bw.addEventListener("touchstart", (e) => { isTouch = true; cycleWeapon(); e.preventDefault(); }, { passive: false }); bw.addEventListener("click", () => cycleWeapon()); } }
// HIZLI SLOT çubuğu: slota dokun/tıkla → o silahı kuşan (masaüstü + mobil)
{ const hb = $("hotbar"); if (hb) {
  const pick = (e) => { const el = e.target.closest && e.target.closest(".hb-slot"); if (!el) return; const n = +el.getAttribute("data-slot"); if (!isNaN(n)) selectSlot(n); e.preventDefault(); };
  hb.addEventListener("touchstart", (e) => { isTouch = true; pick(e); }, { passive: false });
  hb.addEventListener("click", pick);
} }
{ const bf = $("btn-flash"); if (bf) { bf.addEventListener("touchstart", (e) => { isTouch = true; toggleFlash(); e.preventDefault(); }, { passive: false }); bf.addEventListener("click", () => toggleFlash()); } }
const sprintBtn = bindBtn("btn-sprint", null, true);
{ const cb = $("btn-craft"); if (cb) { cb.addEventListener("touchstart", (e) => { isTouch = true; toggleCraft(); e.preventDefault(); }, { passive: false }); cb.addEventListener("click", () => toggleCraft()); } }
{ const ok = $("placeOk"), cc = $("placeCancel");
  if (ok) { ok.addEventListener("click", () => confirmPlace()); ok.addEventListener("touchstart", (e) => { isTouch = true; confirmPlace(); e.preventDefault(); }, { passive: false }); }
  if (cc) { cc.addEventListener("click", () => exitPlace()); cc.addEventListener("touchstart", (e) => { isTouch = true; exitPlace(); e.preventDefault(); }, { passive: false }); } }

/* ----------------------- INTERACTION ----------------------- */
const _fwd = new THREE.Vector3();
function inMineArea(x, z) { return !!(mineSpot && Math.hypot(x - mineSpot.x, z - mineSpot.z) < mineSpot.r + 2); }   // gizli maden bölgesi mi?
function findTarget() {
  camera.getWorldDirection(_fwd); _fwd.y = 0; _fwd.normalize();
  const px = camera.position.x, pz = camera.position.z;
  let best = null, bestScore = -1;
  const consider = (x, z, range, kind, obj) => {
    // maden ganimeti yüzeyden görünmez → yüzeydeyken maden bölgesindeki gizli eşyalarla (ve madendeyken yüzey eşyalarıyla) etkileşme
    if (kind !== "mineenter" && kind !== "mineexit" && inMineArea(x, z) !== !!S.inMine) return;
    const dx = x - px, dz = z - pz, d = Math.hypot(dx, dz);
    if (d > range || d < 0.001) return;
    const dot = (dx / d) * _fwd.x + (dz / d) * _fwd.z;        // bakış hizası
    if (dot < 0.8) return;
    const score = dot - d * 0.04;
    if (score > bestScore) { bestScore = score; best = { kind, obj, d }; }
  };
  consider(BENCH.x, BENCH.z, 3.8, "bench", null);            // fiziksel tezgah
  if (scav) consider(scav.x, scav.z, 3.8, "scav", null);     // hurdacı NPC (takas)
  if (peltT) consider(peltT.x, peltT.z, 3.8, "pelt", null);  // kürk tüccarı NPC (kademeli takas)
  for (const t of trees) if (t.alive) consider(t.x, t.z, 4.2, "tree", t);
  for (const a of animals) consider(a.x, a.z, 4.4, "animal", a);
  for (const s of scraps) if (!s.taken) consider(s.x, s.z, 3.4, "scrap", s);
  for (const c of crystals) if (!c.mined) consider(c.x, c.z, 3.6, "crystal", c);
  for (const c of chests) if (!c.opened) consider(c.x, c.z, 3.6, "chest", c);
  for (const d of depots) consider(d.x, d.z, 3.4, "depot", d);   // 📦 depo sandığı
  for (const p of pickups) consider(p.x, p.z, 3.0, "pickup", p);   // yerdeki taşınabilir eşya (AL)
  for (const w of walls) if (w.hp != null && w.hp < w.maxhp - 1) consider(w.x, w.z, 3.0, "wall", w);   // hasarlı duvar → çekiçle tamir
  if (!S.inMine && mineEntrance) consider(mineEntrance.x, mineEntrance.z, 4.4, "mineenter", null);   // ⛏️ madene in
  if (S.inMine && mineExit) consider(mineExit.x, mineExit.z, 4.4, "mineexit", null);                 // 🪜 yüzeye çık
  return best;
}
/* ===== SANDIK GANİMETİ: TEK eşya fiziksel düşer → SÜRÜKLE/TAŞI kampa getir (ışınlanmaz) ===== */
const pickups = [];   // {x,z,group,sprite,item,bob} — yerdeki taşınabilir eşyalar
let carried = null;   // şu an taşınan eşya {item,sprite}
const CHEST_LOOT = [
  { kind: "wood", label: "🪵 Odun", w: 9 }, { kind: "metal", label: "⚙️ Metal", w: 9 },
  { kind: "bandage", label: "🩹 Bandaj", w: 7 }, { kind: "cooked", label: "🍗 Pişmiş Et", w: 7 },
  { kind: "canned", label: "🥫 Konserve", w: 5 }, { kind: "water", label: "💧 Su", w: 6 },
  { kind: "pelt", label: "🧵 Post", w: 5 }, { kind: "cloth", label: "🧶 Kumaş", w: 5 },
  { kind: "rope", label: "🪢 İp", w: 4 }, { kind: "pistolAmmo", label: "🔫 Mermi", w: 4 },
  { kind: "arrows", label: "🏹 Ok", w: 4 }, { kind: "batteries", label: "🔋 Pil", w: 3 },
  { kind: "pills", label: "💊 Hap", w: 3 }, { kind: "choco", label: "🍫 Çikolata", w: 3 },
  { kind: "soda", label: "🥤 Kola", w: 2 }, { kind: "gem", label: "💎 Değerli Taş", w: 1.6 },
  { kind: "medkit", label: "🧰 Sağlık Çantası", w: 1.6 },
  { special: "axe1", label: "🪓 İyi Balta", w: 1 }, { special: "pickaxe", label: "⛏️ Kazma", w: 1 },
  { special: "hammer", label: "🔨 Çekiç", w: 1 }, { special: "flashlight", label: "🔦 El Feneri", w: 0.9 },
  { special: "pistol", label: "🔫 Tabanca", w: 0.9 }, { special: "shotgun", label: "💥 Pompalı", w: 0.5 },
  { special: "katana", label: "⚔️ Katana", w: 0.5 },
];
function rollChestItem() { let tot = 0; for (const it of CHEST_LOOT) tot += it.w; let r = Math.random() * tot; for (const it of CHEST_LOOT) { r -= it.w; if (r <= 0) return it; } return CHEST_LOOT[0]; }
function itemEmoji(item) { return (item.label.split(" ")[0]) || "📦"; }
function makePickupSprite(emoji) {
  const cv = document.createElement("canvas"); cv.width = 96; cv.height = 96; const g = cv.getContext("2d");
  if (g) { g.font = "70px serif"; g.textAlign = "center"; g.textBaseline = "middle"; g.fillText(emoji, 48, 54); }
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(cv), transparent: true }));
  sp.scale.set(0.9, 0.9, 0.9); return sp;
}
let pickupSeq = 0;
function makePickup(x, z, item, opts) {
  opts = opts || {};
  const y0 = opts.y != null ? opts.y : 0;
  const g = new THREE.Group(); g.position.set(x, y0, z);
  const box = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.4, 0.5), new THREE.MeshStandardMaterial({ color: 0x7a5a2e, roughness: 0.8, emissive: 0x3a2a10, emissiveIntensity: 0.5 }));
  box.position.y = 0.22; g.add(box);
  const sp = makePickupSprite(itemEmoji(item)); sp.position.y = 0.85; g.add(sp);
  g.add(plight(0xffd98a, 0.7, 5, 1.6, 0, 0.6, 0));
  if (scene) scene.add(g);
  const moving = !!(opts.vy || opts.vx || opts.vz || y0 > 0.01);
  const p = { id: opts.id || ((net.id || "L") + ":" + (++pickupSeq)), x, z, y: y0, vx: opts.vx || 0, vy: opts.vy || 0, vz: opts.vz || 0, settled: !moving, group: g, sprite: sp, item, bob: Math.random() * 6.28 };
  pickups.push(p); return p;
}
// yerdeki eşyayı AL → doğrudan envantere (co-op'ta herkeste kaybolur)
function grabPickup(p, remote) {
  const i = pickups.indexOf(p); if (i < 0) return; pickups.splice(i, 1);
  if (p.group && scene) scene.remove(p.group);
  if (!remote) { const nm = applyItem(p.item); Sound.step(); toast("✅ Alındı: " + nm, "good"); if (net.online) { try { net.broadcast({ t: "grab", id: p.id }); } catch (e) {} } }
}
// eşyayı önüne fizikle fırlat (yay + zıplama) → yerde kalır, arkadaşın alabilir
function spawnDrop(item) {
  camera.getWorldDirection(_fwd); _fwd.y = 0; _fwd.normalize();
  const px = clamp(camera.position.x + _fwd.x * 1.1, -CFG.WORLD, CFG.WORLD), pz = clamp(camera.position.z + _fwd.z * 1.1, -CFG.WORLD, CFG.WORLD);
  const vx = _fwd.x * 3.4, vz = _fwd.z * 3.4, vy = 4.6;
  const p = makePickup(px, pz, item, { y: 1.25, vx, vy, vz });
  Sound.chop();
  if (net.online) { try { net.broadcast({ t: "drop", id: p.id, item, x: px, z: pz, vx, vy, vz }); } catch (e) {} }
  return p;
}
function dropStack(kind, label, all) {
  if (!S || !S.running) return;
  const have = S.inv[kind] || 0; if (have <= 0) return;
  const n = all ? have : Math.min(have, 5); S.inv[kind] -= n;
  spawnDrop({ kind, label, qty: n });
  toast("⬇️ " + (n > 1 ? "×" + n + " " : "") + label + " yere attın (arkadaşın alabilir)", "good");
  renderDrop();
}
function applyItem(item) {   // envantere/duruma uygula
  if (item.kind) { const q = item.qty || 1; S.inv[item.kind] = (S.inv[item.kind] || 0) + q; return (q > 1 ? "×" + q + " " : "") + item.label; }
  if (item.special === "axe1") { S.tools.axe = Math.max(S.tools.axe || 0, 1); return "🪓 İyi Balta"; }
  if (item.special === "pickaxe") { S.tools.pickaxe = true; return "⛏️ Kazma"; }
  if (item.special === "hammer") { S.tools.hammer = true; return "🔨 Çekiç"; }
  if (item.special === "flashlight") { S.flashlight = true; S.battery = 100; return "🔦 El Feneri"; }
  if (item.special === "pistol") { S.weapons.pistol = true; S.inv.pistolAmmo += 6; return "🔫 Tabanca"; }
  if (item.special === "shotgun") { S.weapons.shotgun = true; S.inv.shells += 4; return "💥 Pompalı"; }
  if (item.special === "katana") { giveMelee("katana"); return "⚔️ Katana"; }
  if (item.special === "iceaxe") { giveMelee("iceaxe"); return "🧊 Buz Baltası"; }
  return item.label;
}
function dropCarried() {
  if (!carried) return;
  const nearCamp = (baseFire && Math.hypot(camera.position.x - baseFire.x, camera.position.z - baseFire.z) < CAMP_R()) || nearBench();
  if (nearCamp) { const nm = applyItem(carried.item); if (carried.sprite && scene) scene.remove(carried.sprite); carried = null; Sound.chop(); toast("📦 Kampa getirdin: " + nm + " — envantere eklendi ✓", "good"); }
  else { const [x, z] = placeInFront(1.3); if (carried.sprite && scene) scene.remove(carried.sprite); makePickup(x, z, carried.item); carried = null; toast("⬇️ Eşyayı yere bıraktın (geri alabilirsin)", "good"); }
}
function updateCarry(dt) {
  for (const p of pickups) {
    if (!p.settled) {   // 🪂 düşme fiziği: yay + zıplama
      p.vy -= 15 * dt; p.x += p.vx * dt; p.z += p.vz * dt; p.y += p.vy * dt;
      p.x = clamp(p.x, -CFG.WORLD, CFG.WORLD); p.z = clamp(p.z, -CFG.WORLD, CFG.WORLD);
      if (p.y <= 0) { p.y = 0; if (p.vy < -1.4) { p.vy = -p.vy * 0.4; p.vx *= 0.55; p.vz *= 0.55; } else { p.vy = 0; p.vx = 0; p.vz = 0; p.settled = true; } }
      if (p.group) p.group.position.set(p.x, p.y, p.z);
    }
    p.bob += dt; if (p.sprite) p.sprite.position.y = 0.85 + (p.settled ? Math.sin(p.bob * 2) * 0.08 : 0);
  }
  if (carried && carried.sprite) { camera.getWorldDirection(_fwd); carried.sprite.position.set(camera.position.x + _fwd.x * 1.1, camera.position.y - 0.35 + Math.sin(performance.now() / 250) * 0.03, camera.position.z + _fwd.z * 1.1); }
}
function startFishing() { if (S.fishing > 0) return; S.fishing = rnd(2.4, 5.0); S.swingCd = 0.6; Sound.chop(); toast("🎣 Oltayı attın... bekle (gölden ayrılma)", "good"); }   // 🎣 balık tutmaya başla
/* ----------------------- 📦 DEPO SANDIĞI ----------------------- */
let depotOpen = false;
const DEPOT_ITEMS = [["wood", "🪵 Odun"], ["metal", "⚙️ Metal"], ["gem", "💎 Mücevher"], ["pelt", "🧵 Post"], ["cloth", "🧶 Kumaş"], ["rope", "🪢 İp"], ["raw", "🥩 Çiğ Et"], ["cooked", "🍗 Pişmiş"], ["bandage", "🩹 Bandaj"]];
function openDepot() { if (!S || !S.running) return; depotOpen = true; renderDepot(); $("depot").classList.remove("hidden"); if (document.exitPointerLock) document.exitPointerLock(); }
function closeDepot() { depotOpen = false; $("depot").classList.add("hidden"); if (!isTouch && S && S.running && threeCanvas.requestPointerLock) { try { threeCanvas.requestPointerLock(); } catch (e) {} } }
function depotMove(key, toDepot, all) {
  S.depot = S.depot || {};
  if (toDepot) { const have = S.inv[key] || 0; if (have <= 0) return; const n = all ? have : Math.min(have, 10); S.inv[key] -= n; S.depot[key] = (S.depot[key] || 0) + n; }
  else { const have = S.depot[key] || 0; if (have <= 0) return; const n = all ? have : Math.min(have, 10); S.depot[key] -= n; S.inv[key] = (S.inv[key] || 0) + n; }
  Sound.chop(); renderDepot();
}
function renderDepot() {
  const box = $("depotList"); if (!box) return; box.innerHTML = ""; S.depot = S.depot || {};
  for (const [key, label] of DEPOT_ITEMS) {
    const row = document.createElement("div"); row.className = "depot-row";
    const lbl = document.createElement("span"); lbl.className = "dp-lbl"; lbl.textContent = label;
    const n = document.createElement("span"); n.className = "dp-n"; n.textContent = "çanta " + (S.inv[key] || 0) + " · depo " + (S.depot[key] || 0);
    row.append(lbl, n);
    const mk = (t, fn) => { const b = document.createElement("button"); b.className = "dp-btn"; b.textContent = t; b.addEventListener("click", fn); return b; };
    row.append(mk("▶10", () => depotMove(key, true, false)), mk("▶▶ tümü", () => depotMove(key, true, true)), mk("10◀", () => depotMove(key, false, false)), mk("tümü ◀◀", () => depotMove(key, false, true)));
    box.appendChild(row);
  }
}
{ const dc = $("depot-close"); if (dc) dc.addEventListener("click", closeDepot); }
/* ----------------------- ⬇️ EŞYA BIRAK (co-op paylaşım) ----------------------- */
let dropOpen = false;
const DROP_ITEMS = [["wood", "🪵 Odun"], ["metal", "⚙️ Metal"], ["gem", "💎 Mücevher"], ["bandage", "🩹 Bandaj"], ["medkit", "🧰 Sağlık"], ["cooked", "🍗 Pişmiş Et"], ["raw", "🥩 Çiğ Et"], ["canned", "🥫 Konserve"], ["water", "💧 Su"], ["pistolAmmo", "🔫 Mermi"], ["shells", "💥 Fişek"], ["rifleAmmo", "🎯 Tüfek Mrm"], ["arrows", "🏹 Ok"], ["pelt", "🧵 Post"], ["cloth", "🧶 Kumaş"], ["rope", "🪢 İp"]];
function openDrop() { if (!S || !S.running || S.downed) return; dropOpen = true; renderDrop(); $("drop").classList.remove("hidden"); if (document.exitPointerLock) document.exitPointerLock(); }
function closeDrop() { dropOpen = false; $("drop").classList.add("hidden"); if (!isTouch && S && S.running && threeCanvas.requestPointerLock) { try { threeCanvas.requestPointerLock(); } catch (e) {} } }
function renderDrop() {
  const box = $("dropList"); if (!box) return; box.innerHTML = "";
  let any = false;
  for (const [key, label] of DROP_ITEMS) {
    const have = S.inv[key] || 0; if (have <= 0) continue; any = true;
    const row = document.createElement("div"); row.className = "depot-row";
    const lbl = document.createElement("span"); lbl.className = "dp-lbl"; lbl.textContent = label;
    const n = document.createElement("span"); n.className = "dp-n"; n.textContent = "çanta " + have;
    row.append(lbl, n);
    const mk = (t, fn) => { const b = document.createElement("button"); b.className = "dp-btn"; b.textContent = t; b.addEventListener("click", fn); return b; };
    row.append(mk("⬇️ ×5", () => dropStack(key, label, false)), mk("⬇️ tümü", () => dropStack(key, label, true)));
    box.appendChild(row);
  }
  if (!any) { const e = document.createElement("div"); e.className = "dp-n"; e.style.padding = "10px"; e.textContent = "Bırakacak paylaşılabilir eşyan yok."; box.appendChild(e); }
}
{ const dc = $("drop-close"); if (dc) dc.addEventListener("click", closeDrop); }
{ const bd = $("btn-drop"); if (bd) { bd.addEventListener("click", openDrop); bd.addEventListener("touchstart", (e) => { isTouch = true; openDrop(); e.preventDefault(); }, { passive: false }); } }

function doAction() {
  if (carried) { dropCarried(); return; }                     // elin doluysa VUR = bırak (kampta→envanter, değilse→yere)
  if (S.swingCd > 0) return;
  const t = findTarget();
  if (!t) { if (S.tools.rod && S.fishing <= 0 && nearWater()) startFishing(); return; }   // hedef yoksa: göl kenarında olta at
  if (t.kind === "pickup") { grabPickup(t.obj); return; }      // yerdeki eşyayı AL → doğrudan envantere
  if (t.kind === "mineenter") { enterMine(); return; }        // ⛏️ madene in (ekran kararır → ışınlanır)
  if (t.kind === "mineexit") { exitMine(); return; }          // 🪜 yüzeye çık
  if (t.kind === "depot") { openDepot(); return; }            // 📦 depo sandığı aç
  if (t.kind === "bench") { openCraft(); return; }            // tezgaha bakıp vur → üretim açılır
  if (t.kind === "wall") {                                     // hasarlı duvarı çekiçle tamir et (odun harcar)
    S.swingCd = 0.4; const w = t.obj;
    if (!S.tools.hammer) { toast("🔨 Çekiç gerek (tezgahta üret)", "bad"); return; }
    if (S.inv.wood <= 0) { toast("Tamir için odun yok 🪵", "bad"); return; }
    S.inv.wood--; w.hp = Math.min(w.maxhp, w.hp + 45); if (w.group) w.group.rotation.z = (1 - clamp(w.hp / w.maxhp, 0, 1)) * 0.16;
    Sound.chop(); toast("🔨 Duvar tamir edildi (%" + Math.round(w.hp) + ")", "good"); return;
  }
  if (t.kind === "scav") {                                    // hurdacı: 5 ⚙️ → 🩹 + 🪵
    if (S.swingCd > 0) return; S.swingCd = 0.5;
    if (S.inv.metal >= 5) { S.inv.metal -= 5; S.inv.bandage += 1; S.inv.wood += 8; Sound.crackle(); toast("🤝 Hurdacı: 5⚙️ → 🩹1 + 🪵8", "good"); }
    else toast("🤝 Hurdacı: 5 metal getir (sende " + S.inv.metal + ")", "bad");
    return;
  }
  if (t.kind === "pelt") {                                    // kürk tüccarı: 5 🧵 → kademeli ödül (1.balta İyi, 4.balta Güçlü)
    if (S.swingCd > 0) return; S.swingCd = 0.5;
    if (S.inv.pelt < 5) { toast("🧵 Kürk Tüccarı: 5 post getir (sende " + S.inv.pelt + ")", "bad"); return; }
    S.inv.pelt -= 5; const n = (S.peltTrades || 0) + 1; S.peltTrades = n; Sound.crackle();
    if (n === 1 && S.tools.axe < 1) { S.tools.axe = 1; toast("🧵→🪓 Takas 1: İyi Balta!", "good"); }
    else if (n === 4 && S.tools.axe < 2) { S.tools.axe = 2; toast("🧵→🪓 Takas 4: GÜÇLÜ BALTA!", "good"); }
    else if (n % 3 === 0) { S.inv.medkit += 1; S.inv.bandage += 2; toast("🧵→ Takas: 🧰1 + 🩹2", "good"); }
    else { const m = rndi(4, 7); S.inv.metal += m; S.inv.wood += 6; toast("🧵→ Takas: ⚙️" + m + " + 🪵6", "good"); }
    return;
  }
  S.swingCd = 0.4; S.stamina = clamp(S.stamina - 4, 0, 100);
  if (t.kind === "tree") {
    Sound.chop(); const tr = t.obj;
    let dmg = S.tools.chainsaw ? 4 : [1, 2, 4, 999][S.tools.axe || 0];   // eski/iyi/güçlü/ADMIN balta (tier 3 = tek vuruş)
    if (!S.tools.chainsaw && S.melee === "iceaxe") dmg = Math.max(dmg, 2);   // buz baltası iyi balta gibi keser
    if (S.cls === "lumberjack") dmg += 1;   // Oduncu perk: daha hızlı kesim
    if (S.tools.chainsaw) S.swingCd = 0.12;                            // motorlu testere: basılı tut → sürekli kesim
    tr.hp -= dmg; S.inv.wood++;
    if (tr.hp <= 0) { tr.alive = false; tr.regrow = 95; const bonus = S.tools.chainsaw ? 3 : 2; S.inv.wood += bonus; writeTree(trees.indexOf(tr)); treesNeedUpdate(); toast("🪵 Ağaç devrildi (+" + (bonus + 1) + ")", "good"); }
    return;
  }
  if (t.kind === "scrap") {                                   // metal hurda topla (kazma daha hızlı)
    Sound.chop(); const s = t.obj; s.hp = (s.hp || (S.tools.pickaxe ? 1 : 2)) - 1;
    if (s.hp <= 0) { s.taken = true; s.group.visible = false; const m = S.tools.pickaxe ? rndi(2, 4) : rndi(1, 2); S.inv.metal += m; toast("⚙️ +" + m + " metal" + (S.tools.pickaxe ? " (kazma)" : ""), "good"); }
    else toast("⚙️ Hurda... (kazma işi hızlandırır)");
    return;
  }
  if (t.kind === "crystal") {                                 // kristal kaz → 💎 (kazma şart)
    const c = t.obj;
    if (!S.tools.pickaxe) { toast("💎 Kristal için ⛏️ Kazma gerekli", "bad"); return; }
    Sound.chop(); c.hp--;
    if (c.hp <= 0) { c.mined = true; c.group.visible = false; const gn = rndi(1, 2); S.inv.gem += gn; toast("💎 +" + gn + " mücevher!", "good"); }
    else toast("💎 Kristal kırılıyor...", "good");
    return;
  }
  if (t.kind === "chest") {                                   // sandık aç → TEK eşya fiziksel düşer (ışınlanmaz, taşınır)
    const c = t.obj; c.opened = true; c.openedDay = S.day; if (c.lid) c.lid.rotation.x = -1.2; Sound.crackle();
    let item = rollChestItem();
    const cb = biomeAt(c.x, c.z);   // biyoma özel: askeri kasa → silah, volkanik → gem, kar → post
    if (c.ammo) item = choice([{ special: "pistol", label: "🔫 Tabanca" }, { kind: "rifleAmmo", label: "🎯 Tüfek Mermisi" }, { kind: "shells", label: "💥 Fişek" }]);
    else if (cb === "volcanic" && Math.random() < 0.5) item = { kind: "gem", label: "💎 Değerli Taş" };
    else if (cb === "snow" && Math.random() < 0.5) item = choice([{ kind: "pelt", label: "🧵 Post" }, { special: "iceaxe", label: "🧊 Buz Baltası" }]);
    if (S.inMine && !S.tools.pickaxe && Math.random() < 0.6) item = { special: "pickaxe", label: "⛏️ Kazma" };   // madende: kazma bulma şansı yüksek (kristalleri kazabilmek için)
    const [px, pz] = placeInFront(1.3);                        // sandığın önüne bırak (yerde durur, taşınmayı bekler)
    makePickup(px, pz, item);
    toast("📦 Sandıktan çıktı: " + item.label + " — yanına git, VUR ile AL, ateşe taşı", "good");
    if (Math.random() < 0.4) { const note = choice(NOTE_POOL); if (!S.notes.includes(note)) { S.notes.push(note); toast("📓 Bir günlük buldun (Duraklat → Günlükler)", "good"); } }
    return;
  }
  if (t.kind === "animal") {
    Sound.chop(); const a = t.obj;
    const mw = S.melee && MELEE[S.melee];
    a.hp -= admin.oneHit ? 99999 : (mw ? mw.dmg : 3);   // 💥 admin tek vuruş
    if (mw) { S.swingCd = mw.cd * (S.cls === "assassin" ? 0.65 : 1);   // Suikastçı perk: hızlı vuruş
      if (mw.poison) a.poison = Math.max(a.poison || 0, 4.0);
      if (mw.fire) a.burn = Math.max(a.burn || 0, 3.2);
      if (mw.slow) a.slow = Math.max(a.slow || 0, 3.5);
      if (mw.knock) { const dx = a.x - camera.position.x, dz = a.z - camera.position.z, d = Math.hypot(dx, dz) || 1; a.x += dx / d * 1.4; a.z += dz / d * 1.4; }
    }
    if (a.type === "boar" || a.type === "jaguar") { a.hostile = true; a.state = "chase"; }
    else { a.state = "flee"; a.dir = Math.atan2(a.z - camera.position.z, a.x - camera.position.x); }
    if (a.hp <= 0) killAnimal(a, mw && mw.fire);
  }
}
function killAnimal(a, cooked) {
  if (a.boss) {   // BOSS yenildi → büyük ödül
    bossAlive = false;
    if (a.type === "queen") {   // 🕷️👑 MADEN KRALİÇESİ ödülü
      const gotPick = !S.tools.pickaxe; S.tools.pickaxe = true;
      S.inv.gem += rndi(4, 8); S.inv.metal += rndi(6, 12); S.inv.cooked += 2;
      toast("🕷️👑 MADEN KRALİÇESİ öldü! " + (gotPick ? "⛏️ Kazma + " : "") + "💎 bol mücevher + ⚙️ ganimet!", "good"); Sound.crackle();
    } else {   // 🌋👑 CULTIST KING
      const newSword = giveMelee("infernal"); S.inv.gem += rndi(3, 6); S.inv.metal += rndi(8, 14); S.inv.cooked += 4;
      toast("👑 CULTIST KING düştü! " + (newSword ? "🔥 Cehennem Kılıcı + " : "") + "💎 mücevher + ⚙️ ganimet!", "good"); Sound.crackle();
    }
    scene.remove(a.group); const bi = animals.indexOf(a); if (bi >= 0) animals.splice(bi, 1); return;
  }
  if (BEAST[a.type]) {   // biyom yaratıkları: post/et yok, sadece kaybolur (+ az ganimet)
    if (a.type === "polarbear") { S.inv.pelt += rndi(2, 4); if (cooked) S.inv.cooked += rndi(2, 3); else S.inv.raw += rndi(2, 3); toast("🐻‍❄️ Kutup ayısını avladın · 🧵 post", "good"); }
    else toast("☠️ " + beastName(a.type) + " yok edildi", "good");
    scene.remove(a.group); const bi = animals.indexOf(a); if (bi >= 0) animals.splice(bi, 1); return;
  }
  const y = a.type === "jaguar" ? rndi(5, 7) : a.type === "tapir" ? rndi(3, 5) : rndi(2, 4);
  if (cooked) { S.inv.cooked += y; } else { S.inv.raw += y; }   // cehennem kılıcı → et direkt pişmiş düşer
  const pelt = a.type === "jaguar" ? rndi(2, 3) : rndi(1, 2); S.inv.pelt += pelt;
  toast((cooked ? "🍗 +" + y + " pişmiş et" : "🥩 +" + y + " et") + " · 🧵 +" + pelt + " post (" + nameTR(a.type) + ")", "good");
  scene.remove(a.group); const idx = animals.indexOf(a); if (idx >= 0) animals.splice(idx, 1);
  if (a.type !== "jaguar") setTimeout(() => { if (S.running && animals.length < 18) spawnPrey(); }, 9000);
}
const nameTR = (t) => ({ capybara: "kapibara", deer: "geyik", tapir: "tapir", boar: "yaban domuzu", jaguar: "jaguar" }[t] || t);

/* ----------------------- MENZİLLİ SİLAHLAR (Faz 2) ----------------------- */
const RANGED = {
  pistol:   { label: "🔫 Tabanca", ammo: "pistolAmmo", dmg: 6,  range: 45,  cd: 0.34, pellets: 1, cone: 0.985, silent: false },
  shotgun:  { label: "💥 Pompalı", ammo: "shells",     dmg: 5,  range: 18,  cd: 0.85, pellets: 6, cone: 0.93,  silent: false },
  rifle:    { label: "🎯 Tüfek",   ammo: "rifleAmmo",  dmg: 22, range: 130, cd: 1.1,  pellets: 1, cone: 0.997, silent: false },
  bow:      { label: "🏹 Yay",     ammo: "arrows",     dmg: 10, range: 42,  cd: 0.9,  pellets: 1, cone: 0.985, silent: true  },
  crossbow: { label: "🏹 Arbalet", ammo: "arrows",     dmg: 17, range: 60,  cd: 1.3,  pellets: 1, cone: 0.99,  silent: true  },
  admingun: { label: "🔫 Admin Silahı", ammo: "adminAmmo", dmg: 99999, range: 400, cd: 0.1, pellets: 5, cone: 0.82, silent: false, admin: true },   // ⭐ admin: sınırsız, her şeyi tek atar
};
const RANGED_ORDER = ["pistol", "shotgun", "rifle", "bow", "crossbow", "admingun"];
const ownedRanged = () => RANGED_ORDER.filter((k) => S.weapons[k]);
function cycleWeapon() {
  const owned = ownedRanged();
  if (!owned.length) { toast("Menzilli silah yok (sandıklardan bul / yay üret) 🔫", "bad"); return; }
  const list = [null, ...owned]; let i = list.indexOf(S.equip); S.equip = list[(i + 1) % list.length];
  toast(S.equip ? "Kuşanıldı: " + RANGED[S.equip].label + " · " + (S.inv[RANGED[S.equip].ammo] || 0) + " mermi" : "🪓 Yakın dövüş", "good");
}
let muzzle = null, muzzleT = 0;
function muzzleFlash() {
  if (!muzzle) { muzzle = new THREE.Mesh(new THREE.SphereGeometry(0.12, 8, 8), new THREE.MeshBasicMaterial({ color: 0xffd66a, transparent: true, opacity: 0.9 })); muzzle.frustumCulled = false; scene.add(muzzle); }
  muzzle.visible = true; muzzleT = 0.06;
}
function doShoot() {
  if (S.downed || S.sleeping > 0) return;
  if (!S.equip) { if (ownedRanged().length) cycleWeapon(); else toast("Menzilli silah yok (sandıklardan bul / yay üret) 🔫", "bad"); return; }
  const spec = RANGED[S.equip];
  if (S.shootCd > 0) return;
  if (!spec.admin && (S.inv[spec.ammo] || 0) <= 0) { toast("Mermi bitti: " + spec.label + " (1-0 ile silah değiştir)", "bad"); return; }
  S.shootCd = spec.cd; if (!spec.admin) S.inv[spec.ammo]--;   // admin silahı sınırsız (mermi tüketmez)
  if (spec.silent) Sound.bow(); else Sound.gun();
  muzzleFlash();
  pitch = clamp(pitch + (spec.pellets > 1 ? 0.05 : 0.03), -1.45, 1.45);   // geri tepme
  S.shake = Math.max(S.shake, spec.silent ? 0.05 : 0.18);
  camera.getWorldDirection(_fwd); _fwd.y = 0; _fwd.normalize();
  const px = camera.position.x, pz = camera.position.z;
  let hits = 0, kills = 0;
  for (let p = 0; p < spec.pellets; p++) {
    let best = null, bestScore = -2;
    for (const a of animals) { const dx = a.x - px, dz = a.z - pz, d = Math.hypot(dx, dz); if (d > spec.range || d < 0.001) continue; const dot = (dx / d) * _fwd.x + (dz / d) * _fwd.z; if (dot < spec.cone) continue; const score = dot - d * 0.003 - (spec.pellets > 1 ? Math.random() * 0.02 : 0); if (score > bestScore) { bestScore = score; best = a; } }
    let wHit = false;
    if (watcher) { const dx = watcher.x - px, dz = watcher.z - pz, d = Math.hypot(dx, dz); if (d <= spec.range) { const dot = (dx / d) * _fwd.x + (dz / d) * _fwd.z; if (dot >= spec.cone && (dot - d * 0.003) > bestScore) { wHit = true; best = null; } } }
    if (wHit) { hits++; vanishWatcher(false); S.sanity = clamp(S.sanity + 6, 0, 100); toast("👁️ İzleyen'i kovaladın!", "good"); continue; }
    if (best) {
      hits++; best.hp -= admin.oneHit ? 99999 : spec.dmg;   // 💥 admin tek vuruş
      if (spec.silent) { if (!best.hostile) { best.state = "flee"; best.dir = Math.atan2(best.z - pz, best.x - px); } }
      else if (best.type === "boar" || best.type === "jaguar" || best.hostile) { best.hostile = true; best.state = "chase"; }
      if (best.hp <= 0) { killAnimal(best); kills++; }
    }
  }
  if (kills) toast(spec.label + " 🎯 avı düşürdün!", "good");
  else if (hits) toast(spec.label + " 🩸 isabet", "good");
  if (!spec.silent) for (const a of animals) { if ((a.type === "boar" || a.type === "jaguar") && Math.hypot(a.x - px, a.z - pz) < 30) { a.hostile = true; a.state = "chase"; } }   // silah sesi avcıları çeker
}

/* ----------------------- ÖZEL YAKIN DÖVÜŞ SİLAHLARI (Faz 3) ----------------------- */
const MELEE = {
  spear:       { label: "🗡️ Mızrak",         dmg: 6,  cd: 0.42 },
  iceaxe:      { label: "🧊 Buz Baltası",     dmg: 7,  cd: 0.4,  slow: true },
  poisonSpear: { label: "🧪 Zehirli Mızrak",  dmg: 7,  cd: 0.42, poison: true },
  katana:      { label: "⚔️ Katana",          dmg: 9,  cd: 0.26 },
  morningstar: { label: "🔨 Topuz",           dmg: 17, cd: 0.62, knock: true },
  infernal:    { label: "🔥 Cehennem Kılıcı", dmg: 14, cd: 0.4,  fire: true },
};
const MELEE_ORDER = ["spear", "iceaxe", "poisonSpear", "katana", "morningstar", "infernal"];
const meleeRank = (k) => MELEE_ORDER.indexOf(k);
function giveMelee(k) {   // silahı envantere ekle; daha güçlüyse otomatik kuşan
  if (!MELEE[k]) return false; const had = !!S.meleeOwned[k]; S.meleeOwned[k] = true; if (k === "spear") S.tools.spear = true;
  if (!S.melee || meleeRank(k) > meleeRank(S.melee)) S.melee = k;
  return !had;
}
function cycleMelee() {
  const owned = MELEE_ORDER.filter((k) => S.meleeOwned[k] || (k === "spear" && S.tools.spear));
  if (!owned.length) { toast("Özel yakın dövüş silahı yok (sandık/tezgah) 🗡️", "bad"); return; }
  const list = [null, ...owned]; let i = list.indexOf(S.melee); S.melee = list[(i + 1) % list.length];
  toast(S.melee ? "Kuşanıldı: " + MELEE[S.melee].label : "👊 Yumruk/balta", "good");
}

/* ===== HIZLI SİLAH SLOTLARI (1-0 tuşları / mobilde dokun) — envanteri Q/Z yerine kolayca değiştir ===== */
function buildHotbar() {
  if (!S) return [];
  const slots = [{ type: "unarmed", icon: "🪓", label: "Balta/El" }];   // slot 1: silahsız (balta/el/yumruk)
  for (const k of MELEE_ORDER) if (S.meleeOwned[k] || (k === "spear" && S.tools.spear)) slots.push({ type: "melee", key: k, icon: MELEE[k].label.split(" ")[0], label: MELEE[k].label });
  for (const k of RANGED_ORDER) if (S.weapons[k]) slots.push({ type: "ranged", key: k, icon: RANGED[k].label.split(" ")[0], label: RANGED[k].label });
  return slots;
}
function slotActive(s) {   // bu slot şu an kuşanılı mı?
  if (s.type === "ranged") return S.equip === s.key;
  if (S.equip) return false;                      // menzilli kuşanılıyken yakın slotlar pasif
  if (s.type === "unarmed") return !S.melee;
  return S.melee === s.key;
}
function selectSlot(n) {   // n = 0 tabanlı
  const slots = buildHotbar(); if (n < 0 || n >= slots.length) return;
  const s = slots[n];
  if (s.type === "ranged") { S.equip = s.key; toast("Kuşanıldı: " + RANGED[s.key].label + " · " + (S.inv[RANGED[s.key].ammo] || 0) + " mermi", "good"); }
  else if (s.type === "melee") { S.equip = null; S.melee = s.key; toast("Kuşanıldı: " + MELEE[s.key].label, "good"); }
  else { S.equip = null; S.melee = null; toast("🪓 Balta/El", "good"); }
  Sound.step && Sound.step(); updateHotbarHUD();
}
let _hbSig = "";
function updateHotbarHUD() {
  const hb = $("hotbar"); if (!hb) return;
  if (!S || !S.running) { if (_hbSig !== "off") { hb.classList.add("hidden"); hb.innerHTML = ""; _hbSig = "off"; } return; }
  const slots = buildHotbar();
  if (slots.length <= 1) { if (_hbSig !== "none") { hb.classList.add("hidden"); hb.innerHTML = ""; _hbSig = "none"; } return; }   // sadece balta varsa gösterme
  let sig = "", html = "";
  slots.forEach((s, i) => {
    const num = i < 9 ? (i + 1) : (i === 9 ? 0 : "");   // 1..9,0 (maks 10 slot)
    const on = slotActive(s), ammo = s.type === "ranged" ? (S.inv[RANGED[s.key].ammo] || 0) : -1;
    sig += `${s.type}${s.key || "-"}${on ? 1 : 0}${ammo}|`;
    html += `<div class="hb-slot${on ? " on" : ""}" data-slot="${i}"><b>${num}</b><span>${s.icon}</span>${ammo >= 0 ? `<i>${ammo}</i>` : ""}</div>`;
  });
  if (sig === _hbSig) return;   // değişmediyse DOM'a dokunma (her kare çağrılabilir)
  _hbSig = sig; hb.innerHTML = html; hb.classList.remove("hidden");
}
let flashLight = null;
function toggleFlash() {
  if (!S.flashlight) { toast("🔦 El feneri yok (sandıklardan bul)", "bad"); return; }
  if (!S.flashOn && S.battery <= 0) {
    if (S.inv.batteries > 0) { S.inv.batteries--; S.battery = 100; S.flashOn = true; Sound.reload(); toast("🔋 Pil takıldı — fener AÇIK", "good"); return; }
    toast("🔋 Pil bitik (sandıklardan pil bul)", "bad"); return;
  }
  S.flashOn = !S.flashOn; toast(S.flashOn ? "🔦 Fener AÇIK" : "🔦 Fener kapalı", "good");
}

function doFire() {
  // Tek bir KAMP ATEŞİ var (üs). En yakınına odun atılır; yeni ateş kurulamaz.
  const px = camera.position.x, pz = camera.position.z;
  let near = null, nd = 1e9;
  for (const f of fires) { const d = (f.x - px) ** 2 + (f.z - pz) ** 2; if (d < nd) { nd = d; near = f; } }
  if (!near || nd > 100) { toast("🔥 Kamp ateşine yaklaş (odun atmak için)", "bad"); return; }
  if (S.inv.wood <= 0) { toast("Odun yok — ağaç kes", "bad"); return; }
  const add = Math.min(S.inv.wood, 30); S.inv.wood -= add; near.fuel = Math.min(near.fuel + add * 13, near.max);
  S.fireFed += add;
  const lvl = S.fireFed > 170 ? 4 : S.fireFed > 80 ? 3 : S.fireFed > 28 ? 2 : 1;   // toplam beslemeyle seviye atlar
  if (lvl > near.level) { setFireLevel(near, lvl); near.fuel = Math.min(near.fuel + 40, near.max); toast("🔥 ATEŞ SEVİYE " + lvl + "! Güvenli alan büyüdü 🪨", "good"); Sound.crackle(); }
  else toast("🔥 +" + add + " odun (yakıt %" + Math.round(near.fuel / near.max * 100) + ")", "good");
  if (net.online && near.base) { try { net.broadcast({ t: "fire", fed: S.fireFed }); } catch (e) {} }   // ateş seviyesi co-op'ta paylaşılır
}
function doEat() {
  const inv = S.inv;
  // susuzluk açlıktan daha acilse ve düşükse: ÖNCE iç — öncelik: BEDAVA göl suyu > kola > şişe suyu
  if (S.thirst < 80 && S.thirst <= S.hunger) {
    if (nearWater()) {   // gölün kenarında: bedava su iç (hafif kirli su/hastalık riski) — şişe suyunu harcamaz
      S.thirst = clamp(S.thirst + 32, 0, 100);
      if (Math.random() < 0.14) { S.sick = Math.max(S.sick, 3); S.health = clamp(S.health - 6, 0, 100); toast("🤢 Kirli göl suyu — biraz hastalandın (+32 susuzluk)", "bad"); }
      else toast("💧 Gölden su içtin (+32 susuzluk)", "good");
      return;
    }
    if (inv.soda > 0 && (inv.water <= 0 || S.stamina < 40)) { inv.soda--; S.thirst = clamp(S.thirst + 45, 0, 100); S.stamina = clamp(S.stamina + 30, 0, 100); toast("🥤 Kola içtin (+45 susuzluk, +30 enerji)", "good"); return; }
    if (inv.water > 0) { inv.water--; S.thirst = clamp(S.thirst + 55, 0, 100); toast("💧 Su içtin (+55 susuzluk)", "good"); return; }
  }
  if (inv.canned > 0) { inv.canned--; S.hunger = clamp(S.hunger + 60, 0, 100); toast("🥫 Konserve yedin (+60 açlık)", "good"); }
  else if (inv.choco > 0) { inv.choco--; S.hunger = clamp(S.hunger + 30, 0, 100); S.stamina = clamp(S.stamina + 25, 0, 100); toast("🍫 Çikolata (+30 açlık, +25 enerji)", "good"); }
  else if (inv.cooked > 0) { inv.cooked--; const amt = S.hasCrockpot ? 65 : 45; S.hunger = clamp(S.hunger + amt, 0, 100); if (S.hasCrockpot) S.health = clamp(S.health + 5, 0, 100); toast("🍗 " + (S.hasCrockpot ? "Güveç" : "Pişmiş et") + " yedin (+" + amt + ")", "good"); }
  else if (inv.raw > 0) { inv.raw--; S.hunger = clamp(S.hunger + 18, 0, 100); if (Math.random() < 0.45) { S.health = clamp(S.health - 12, 0, 100); S.sanity = clamp(S.sanity - 4, 0, 100); S.sick = 3; toast("🤢 Çiğ et seni hasta etti!", "bad"); } else toast("🥩 Çiğ et yedin (+18)", "good"); }
  else toast("Yiyecek yok!", "bad");
}

/* ----------------------- CRAFTING (TEZGAH) — kademeli (Tier 1-5) ----------------------- */
function placeFront(buildFn, dist) { const [x, z] = placeInFront(dist || 2.6); camera.getWorldDirection(_fwd); _fwd.y = 0; _fwd.normalize(); return buildFn(x, z, Math.atan2(-_fwd.x, -_fwd.z)); }
function makeBed(x, z) { const g = new THREE.Group(); g.position.set(x, 0, z); const wood = new THREE.MeshStandardMaterial({ color: 0x6b4a26, roughness: 1 }); const m = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.3, 2.0), new THREE.MeshStandardMaterial({ color: 0x9a8d76, roughness: 1 })); m.position.y = 0.35; g.add(m); for (const sx of [-1, 1]) for (const sz of [-1, 1]) { const leg = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.35, 0.14), wood); leg.position.set(sx * 0.42, 0.17, sz * 0.9); g.add(leg); } const pil = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.18, 0.4), new THREE.MeshStandardMaterial({ color: 0xd8cdb6 })); pil.position.set(0, 0.55, -0.75); g.add(pil); if (shadowsOn) g.traverse((o) => { if (o.isMesh) o.castShadow = true; }); scene.add(g); props.push({ x, z, group: g, kind: "bed" }); }
function makeFarm(x, z) { const g = new THREE.Group(); g.position.set(x, 0, z); const soil = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.18, 2.0), new THREE.MeshStandardMaterial({ color: 0x4a3526, roughness: 1 })); soil.position.y = 0.09; g.add(soil); const f = { x, z, group: g, kind: "farm", t: 0, sprouts: [] }; for (let i = 0; i < 9; i++) { const sp = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.3, 5), new THREE.MeshStandardMaterial({ color: 0x4f8a3a, flatShading: true })); sp.position.set(((i % 3) - 1) * 0.6, 0.3, ((i / 3 | 0) - 1) * 0.6); g.add(sp); f.sprouts.push(sp); } if (shadowsOn) g.traverse((o) => { if (o.isMesh) o.castShadow = true; }); scene.add(g); props.push(f); farms.push(f); }
function makeTorch(x, z) { const g = new THREE.Group(); g.position.set(x, 0, z); const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.09, 1.8, 6), new THREE.MeshStandardMaterial({ color: 0x4a3420, roughness: 1 })); pole.position.y = 0.9; g.add(pole); const fl = new THREE.Mesh(new THREE.ConeGeometry(0.18, 0.5, 7), new THREE.MeshBasicMaterial({ color: 0xff9a3c, transparent: true, opacity: 0.95 })); fl.position.y = 1.95; g.add(fl); g.add(plight(0xffa850, 1.4, 11, 1.6, 0, 2, 0)); if (shadowsOn) pole.castShadow = true; scene.add(g); torches.push({ x, z, group: g, safeR: 7, flame: fl }); }
function makeGate(x, z, rot) { const w = makeWall(x, z, rot); w.gate = true; return w; }
function makeLantern(x, z) {   // kristal fener: güçlü kalıcı ışık + geniş güvenli alan (meşale+)
  const g = new THREE.Group(); g.position.set(x, 0, z);
  const post = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.1, 2.2, 6), new THREE.MeshStandardMaterial({ color: 0x40464e, metalness: 0.5, roughness: 0.6 })); post.position.y = 1.1; g.add(post);
  const orb = new THREE.Mesh(new THREE.IcosahedronGeometry(0.32, 0), new THREE.MeshStandardMaterial({ color: 0x9ff0ff, emissive: 0x55d6f0, emissiveIntensity: 1.4, roughness: 0.2, transparent: true, opacity: 0.95, flatShading: true })); orb.position.y = 2.3; g.add(orb);
  g.add(plight(0x8fe8ff, 2.0, 16, 1.5, 0, 2.3, 0));
  if (shadowsOn) post.castShadow = true; scene.add(g);
  torches.push({ x, z, group: g, safeR: 11, flame: orb });   // meşale gibi ama daha geniş güvenli alan
}
function makeTotem(x, z) {     // koruyucu totem: çevresinde sanity yenilenir + İzleyen yaklaşmaz
  const g = new THREE.Group(); g.position.set(x, 0, z);
  const woodM = new THREE.MeshStandardMaterial({ color: 0x6b4a26, roughness: 1, flatShading: true });
  for (let i = 0; i < 3; i++) { const seg = new THREE.Mesh(new THREE.CylinderGeometry(0.34 - i * 0.04, 0.38 - i * 0.04, 0.8, 6), woodM); seg.position.y = 0.4 + i * 0.8; seg.rotation.y = i * 0.5; g.add(seg); }
  const gemMat = new THREE.MeshStandardMaterial({ color: 0x9ff0ff, emissive: 0x52c8e6, emissiveIntensity: 1.0, roughness: 0.2, flatShading: true, transparent: true, opacity: 0.95 });
  const top = new THREE.Mesh(new THREE.IcosahedronGeometry(0.36, 0), gemMat); top.position.y = 2.9; g.add(top);
  g.add(plight(0x7fe6ff, 1.0, 9, 2, 0, 2.9, 0));
  if (shadowsOn) g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  scene.add(g); totems.push({ x, z, group: g, r: 13 });
}
function makeFlag(x, z) { const g = new THREE.Group(); g.position.set(x, 0, z); const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 2.4, 6), new THREE.MeshStandardMaterial({ color: 0x888888, metalness: 0.5 })); pole.position.y = 1.2; g.add(pole); const cloth = new THREE.Mesh(new THREE.PlaneGeometry(0.8, 0.5), new THREE.MeshStandardMaterial({ color: 0xd83030, side: THREE.DoubleSide })); cloth.position.set(0.42, 2.0, 0); g.add(cloth); scene.add(g); flags.push({ x, z, group: g }); }

/* --- KURULACAK YAPILAR: üret → envantere düşer → ateş yanına yerleştir (hayalet önizleme) --- */
const PLACE = {
  bed:   { label: "🛏️ Yatak",         build: makeBed,       dist: 2.6, size: [1.1, 0.6, 2.1], onPlace: () => { S.tools.tent = true; } },
  storage: { label: "📦 Depo Sandığı", build: makeStorageBox, dist: 2.4, size: [1.5, 1.0, 1.1], rot: true },
  farm:  { label: "🌱 Tarla",          build: makeFarm,      dist: 2.9, size: [2.1, 0.4, 2.1], onPlace: () => { S.farms++; } },
  trap:  { label: "🪤 Ayı Tuzağı",     build: makeSpikeTrap, dist: 2.6, size: [1.3, 0.3, 1.3] },
  wall:  { label: "🧱 Tomruk Duvar",   build: makeWall,      dist: 2.5, size: [2.4, 1.8, 0.5], rot: true },
  gate:  { label: "🚪 Tomruk Kapı",    build: makeGate,      dist: 2.5, size: [2.4, 1.8, 0.5], rot: true },
  torch: { label: "🔦 Meşale",         build: makeTorch,     dist: 2.6, size: [0.5, 2.0, 0.5] },
  drill: { label: "🛢️ Petrol Sondajı", build: makeFlag,      dist: 3.0, size: [0.9, 2.4, 0.9], onPlace: () => { S.oilDrills++; } },
  flag:  { label: "🚩 Bayrak",          build: makeFlag,      dist: 2.6, size: [0.7, 2.4, 0.7] },
  lantern:{ label: "💠 Kristal Fener",  build: makeLantern,   dist: 2.6, size: [0.6, 2.6, 0.6] },
  totem: { label: "🔮 Koruyucu Totem",  build: makeTotem,     dist: 2.8, size: [0.8, 3.2, 0.8] },
};
const placeBar = $("placeBar"), placeName = $("placeName");
function addPlaceable(kind) { S.placeables[kind] = (S.placeables[kind] || 0) + 1; }
function placeablesCount() { let n = 0; for (const k in (S.placeables || {})) n += S.placeables[k]; return n; }

let placeMode = null;   // { kind, ghost }
const CAMP_R = () => Math.max(22, (baseFire ? baseFire.safeR : 12) + 14);   // ateş çevresinde kurulum yarıçapı
function enterPlace(kind) {
  if (!S || !S.running || !(S.placeables[kind] > 0)) return;
  exitPlace(); closeCraft();
  const sz = PLACE[kind].size;
  const ghost = new THREE.Mesh(new THREE.BoxGeometry(sz[0], sz[1], sz[2]), new THREE.MeshBasicMaterial({ color: 0x55ff88, transparent: true, opacity: 0.45, depthWrite: false }));
  scene.add(ghost); placeMode = { kind, ghost };
  if (placeBar) placeBar.classList.remove("hidden");
  if (placeName) placeName.textContent = PLACE[kind].label + " ×" + S.placeables[kind];
  toast("📐 Yeri seç — ateşe yakın YERLEŞTİR", "good");
}
function exitPlace() { if (placeMode) { scene.remove(placeMode.ghost); placeMode = null; } if (placeBar) placeBar.classList.add("hidden"); }
function confirmPlace() {
  if (!placeMode) return;
  const k = placeMode.kind, spec = PLACE[k];
  if (!(S.placeables[k] > 0)) { exitPlace(); return; }
  const [x, z] = placeInFront(spec.dist);
  if (baseFire && Math.hypot(x - baseFire.x, z - baseFire.z) > CAMP_R()) { toast("🔥 Daha yakın kur — kamp ateşi alanı", "bad"); return; }
  camera.getWorldDirection(_fwd); _fwd.y = 0; _fwd.normalize();
  applyPlace(k, x, z, Math.atan2(-_fwd.x, -_fwd.z), false);   // kurar + onPlace + co-op yayını
  S.placeables[k]--; if (S.placeables[k] <= 0) delete S.placeables[k];
  Sound.chop(); toast("✅ Kuruldu: " + spec.label, "good");
  if (S.placeables[k] > 0) { if (placeName) placeName.textContent = spec.label + " ×" + S.placeables[k]; }
  else exitPlace();
}

/* ===== CO-OP paylaşımlı dünya durumu: kurulan yapılar + tezgah tier'ı + ateş seviyesi
   herkeste görünür. Host yetkilidir; katılınca host tam anlık görüntü gönderir. ===== */
const worldLog = [];   // {kind,x,z,rot} — bu dünyada kurulmuş tüm yapılar (anlık görüntü için)
let pendingWorld = null;   // oyun henüz hazır değilken gelen anlık görüntü
function worldSeen(e) { return worldLog.some((w) => w.kind === e.kind && Math.abs(w.x - e.x) < 0.15 && Math.abs(w.z - e.z) < 0.15); }
function applyPlace(kind, x, z, rot, remote) {
  const spec = PLACE[kind]; if (!spec || !scene) return;
  spec.build(x, z, rot || 0);
  if (!remote && spec.onPlace) spec.onPlace();          // sayaçlar (S.farms++ vb.) yalnızca kuran oyuncuda
  worldLog.push({ kind, x, z, rot: rot || 0 });
  if (!remote && net.online) { try { net.broadcast({ t: "place", kind, x, z, rot: rot || 0 }); } catch (e) {} }
}
function applyBench(tier) {
  if (!S || !(tier > S.benchTier)) return;
  S.benchTier = tier; toast("🛠️ Üs tezgahı Tier " + tier + " oldu (arkadaşın yükseltti)", "good"); renderCraft();
}
function applyFireLevel(fed) {
  if (!S) return;
  S.fireFed = Math.max(S.fireFed || 0, fed);
  const lvl = S.fireFed > 170 ? 4 : S.fireFed > 80 ? 3 : S.fireFed > 28 ? 2 : 1;
  if (baseFire && lvl > baseFire.level) setFireLevel(baseFire, lvl);
}
function applyWorldSnapshot(d) {
  if (!scene || !S || !S.running) { pendingWorld = d; return; }   // menüdeysem başlayınca uygula
  if (Array.isArray(d.log)) for (const e of d.log) { if (!worldSeen(e)) applyPlace(e.kind, e.x, e.z, e.rot, true); }
  if (d.benchTier) applyBench(d.benchTier);
  if (d.fireFed) applyFireLevel(d.fireFed);
  toast("🌐 Üs durumu arkadaşından alındı (yapılar + tezgah + ateş)", "good");
}
// hayalet önizlemeyi her karede oyuncunun baktığı yere taşı (yeşil=geçerli, kırmızı=ateşe uzak)
function updateGhost() {
  if (!placeMode) return;
  const spec = PLACE[placeMode.kind], [x, z] = placeInFront(spec.dist), g = placeMode.ghost;
  g.position.set(x, spec.size[1] / 2, z);
  camera.getWorldDirection(_fwd); _fwd.y = 0; _fwd.normalize();
  if (spec.rot) g.rotation.y = Math.atan2(-_fwd.x, -_fwd.z);
  const ok = !baseFire || Math.hypot(x - baseFire.x, z - baseFire.z) <= CAMP_R();
  const gc = g.material && g.material.color;
  if (gc && gc.setHex) gc.setHex(ok ? 0x55ff88 : 0xff4d4d);
}

const RECIPES = [
  // ---- Tier 1 ----
  { tier: 1, name: "🩹 Bandaj", desc: "Can doldurur / düşen arkadaşı diriltir", cost: { pelt: 2, wood: 1 }, make: (s) => s.inv.bandage++ },
  { tier: 1, name: "🗺️ Harita", desc: "M ile tüm haritayı aç", cost: { wood: 3 }, once: () => S.hasMap, make: (s) => s.hasMap = true },
  { tier: 1, name: "🛏️ Eski Yatak", desc: "Üretilir, ateş yanına KUR; güvendeyken T ile uyu", cost: { wood: 18 }, make: () => addPlaceable("bed") },
  { tier: 1, name: "🌱 Tarla", desc: "Üretilir, ateş yanına KUR; zamanla 🍗 üretir (maks 6)", cost: { wood: 10 }, once: () => (S.farms + (S.placeables.farm || 0)) >= 6, make: () => addPlaceable("farm") },
  { tier: 1, name: "⛏️ Kazma", desc: "Metali hızlı toplar, daha sert vurur", cost: { metal: 3, wood: 3 }, once: () => S.tools.pickaxe, make: (s) => s.tools.pickaxe = true },
  { tier: 1, name: "🎣 Olta", desc: "Göl kenarında dur, VUR/E ile balık tut (çiğ balık → ateşte pişir)", cost: { wood: 5, rope: 1 }, once: () => S.tools.rod, make: (s) => s.tools.rod = true },
  { tier: 1, name: "📦 Depo Sandığı", desc: "Üretilir, KUR; ağır kaynakları içine bırak → çantan hafifler, hızlı kalırsın", cost: { wood: 16, metal: 2 }, make: () => addPlaceable("storage") },
  { tier: 1, name: "🗡️ Mızrak", desc: "Avı/canavarı daha çok yaralar (Z ile kuşan)", cost: { metal: 2, wood: 4 }, once: () => S.tools.spear, make: () => giveMelee("spear") },
  { tier: 1, up: 2, name: "⬆️ Tezgah Tier 2", desc: "2. seviye tarifleri açar", cost: { metal: 1, wood: 5 }, once: () => S.benchTier >= 2, make: (s) => s.benchTier = 2 },
  // ---- Tier 2 ----
  { tier: 2, name: "🪓 İyi Balta", desc: "Ağaçları 2 vuruşta keser (eski baltadan hızlı)", cost: { metal: 6, wood: 4 }, once: () => S.tools.axe >= 1, make: (s) => s.tools.axe = Math.max(s.tools.axe, 1) },
  { tier: 2, name: "🧰 Sağlık Çantası", desc: "+75 can (🩹 butonu önce bunu kullanır)", cost: { cloth: 3, metal: 2 }, make: (s) => s.inv.medkit++ },
  { tier: 2, name: "🔨 Çekiç", desc: "Hasarlı/çürüyen duvarları tamir eder (odunla)", cost: { metal: 4, wood: 4 }, once: () => S.tools.hammer, make: (s) => s.tools.hammer = true },
  { tier: 2, name: "🏹 Yay", desc: "Sessiz menzilli silah; Q ile kuşan, R / sağ tık ile ateş", cost: { wood: 8, rope: 2 }, once: () => S.weapons.bow, make: (s) => { s.weapons.bow = true; if (!s.equip) s.equip = "bow"; } },
  { tier: 2, name: "🔦 El Feneri", desc: "Geceleri/mağarada önünü aydınlatır (L); pil ile çalışır", cost: { metal: 5, gem: 1 }, once: () => S.flashlight, make: (s) => { s.flashlight = true; s.battery = 100; } },
  { tier: 2, name: "🎯 Ok ×10", desc: "Yay/arbalet için ok", cost: { rope: 1, wood: 2, metal: 1 }, make: (s) => s.inv.arrows += 10 },
  { tier: 2, name: "🔫 Tabanca Mermisi ×8", desc: "Tabanca için mermi dök (metalden)", cost: { metal: 3 }, make: (s) => s.inv.pistolAmmo += 8 },
  // ---- Tier 2 ----
  { tier: 2, name: "🧭 Pusula", desc: "Baktığın yönü HUD'da gösterir", cost: { metal: 3 }, once: () => S.hasCompass, make: (s) => s.hasCompass = true },
  { tier: 2, name: "🪤 Ayı Tuzağı", desc: "Üretilir, KUR; üstünden geçen düşmanı yaralar", cost: { metal: 3, wood: 1 }, make: () => addPlaceable("trap") },
  { tier: 2, name: "🧱 Tomruk Duvar", desc: "Üretilir, KUR; sağlam ahşap duvar", cost: { wood: 12 }, make: () => addPlaceable("wall") },
  { tier: 2, name: "🚪 Tomruk Kapı", desc: "Üretilir, KUR; üs girişine ahşap kapı", cost: { wood: 12 }, make: () => addPlaceable("gate") },
  { tier: 2, up: 3, name: "⬆️ Tezgah Tier 3", desc: "3. seviye tarifleri açar", cost: { metal: 8, wood: 10 }, once: () => S.benchTier >= 3, make: (s) => s.benchTier = 3 },
  // ---- Tier 3 ----
  { tier: 3, name: "🔦 Meşale", desc: "Üretilir, KUR; etrafı aydınlatır, güvenli alanı genişletir", cost: { metal: 4, wood: 4 }, make: () => addPlaceable("torch") },
  { tier: 3, name: "⚡ Paratoner", desc: "Şimşeğin akıl/sağlık etkisini engeller (üs)", cost: { metal: 8 }, once: () => S.hasLightningRod, make: (s) => s.hasLightningRod = true },
  { tier: 3, name: "🍲 Güveç Tenceresi", desc: "Pişmiş et açlığı çok daha iyi giderir", cost: { metal: 8, wood: 8 }, once: () => S.hasCrockpot, make: (s) => s.hasCrockpot = true },
  { tier: 3, name: "🪓 Güçlü Balta", desc: "Normal ağacı tek vuruşta devirir", cost: { metal: 14, gem: 1 }, once: () => S.tools.axe >= 2, make: (s) => s.tools.axe = 2 },
  { tier: 3, name: "🛡️ Metal Zırh", desc: "Yaratık hasarını −%35 azaltır (yıprandıkça kırılır)", cost: { metal: 12, cloth: 2 }, make: () => giveArmor(0.35, "Metal Zırh") },
  { tier: 3, name: "🧨 Dinamit", desc: "X ile patlat: çevredeki kristalleri kazar (💎) + yakındaki düşmanları vurur", cost: { metal: 5, gem: 1 }, make: (s) => s.inv.dynamite++ },
  { tier: 3, name: "💥 Fişek ×4", desc: "Pompalı tüfek için fişek dök", cost: { metal: 4 }, make: (s) => s.inv.shells += 4 },
  { tier: 3, name: "🎯 Tüfek Mermisi ×5", desc: "Tüfek için mermi dök (metal + mücevher)", cost: { metal: 3, gem: 1 }, make: (s) => s.inv.rifleAmmo += 5 },
  { tier: 3, name: "🧪 Zehirli Mızrak", desc: "Vurduğun düşmanı zehirler (zamanla erir)", cost: { metal: 4, gem: 1, cloth: 1 }, once: () => S.meleeOwned.poisonSpear, make: () => giveMelee("poisonSpear") },
  { tier: 3, up: 4, name: "⬆️ Tezgah Tier 4", desc: "4. seviye tarifleri açar", cost: { metal: 15, wood: 20 }, once: () => S.benchTier >= 4, make: (s) => s.benchTier = 4 },
  // ---- Tier 4 ----
  { tier: 4, name: "🛢️ Petrol Sondajı", desc: "Üretilir, KUR; kamp ateşini otomatik besler (maks 3)", cost: { metal: 18, wood: 25 }, once: () => (S.oilDrills + (S.placeables.drill || 0)) >= 3, make: () => addPlaceable("drill") },
  { tier: 4, name: "🪚 Motorlu Testere", desc: "Aksiyonu BASILI tut → ağaçları sürekli ve hızlı kes", cost: { metal: 20, gem: 2 }, once: () => S.tools.chainsaw, make: (s) => s.tools.chainsaw = true },
  { tier: 4, name: "⚔️ Katana", desc: "Çok hızlı sallanan keskin yakın dövüş silahı", cost: { metal: 14, cloth: 2 }, once: () => S.meleeOwned.katana, make: () => giveMelee("katana") },
  { tier: 4, name: "🔨 Topuz", desc: "Ağır; tek vuruşta yüksek hasar + düşmanı geri iter", cost: { metal: 20, wood: 6 }, once: () => S.meleeOwned.morningstar, make: () => giveMelee("morningstar") },
  { tier: 4, up: 5, name: "⬆️ Tezgah Tier 5", desc: "5. seviye tarifleri açar", cost: { metal: 40, wood: 50 }, once: () => S.benchTier >= 5, make: (s) => s.benchTier = 5 },
  // ---- Tier 5 ----
  { tier: 5, name: "🚩 Bayrak", desc: "Üretilir, KUR; mini haritada kalıcı işaret bırakır", cost: { metal: 6, wood: 6 }, make: () => addPlaceable("flag") },
  { tier: 5, name: "💠 Kristal Fener", desc: "Üretilir, KUR; güçlü kalıcı ışık + geniş güvenli alan", cost: { gem: 1, metal: 6 }, make: () => addPlaceable("lantern") },
  { tier: 5, name: "🔮 Koruyucu Totem", desc: "Üretilir, KUR; çevrende akıl yenilenir + İzleyen yaklaşmaz", cost: { gem: 2, metal: 8, wood: 10 }, make: () => addPlaceable("totem") },
  { tier: 5, name: "🔥 Cehennem Kılıcı", desc: "Düşmanı ateşe verir; öldürdüğün av direkt PİŞMİŞ et düşer", cost: { gem: 3, metal: 20 }, once: () => S.meleeOwned.infernal, make: () => giveMelee("infernal") },
  { tier: 5, name: "🛡️ Mücevher Zırhı", desc: "En güçlü zırh: yaratık hasarını −%50 azaltır", cost: { gem: 2, metal: 16 }, make: () => giveArmor(0.5, "Mücevher Zırhı") },
];
function canAfford(r) { for (const k in r.cost) if ((S.inv[k] || 0) < r.cost[k]) return false; return !(r.once && r.once()); }
function craft(r) {
  if (r.tier > S.benchTier) { toast("Önce tezgahı yükselt (Tier " + r.tier + ")", "bad"); return; }
  if (r.once && r.once()) { toast("Zaten var / limit dolu.", "bad"); return; }
  if (!canAfford(r)) { toast("Yetersiz malzeme.", "bad"); return; }
  for (const k in r.cost) S.inv[k] -= r.cost[k];
  const ok = r.make(S);
  if (ok === false) { for (const k in r.cost) S.inv[k] += r.cost[k]; renderCraft(); return; }
  Sound.chop(); toast("🛠️ Üretildi: " + r.name, "good"); renderCraft();
  if (r.up && net.online) { try { net.broadcast({ t: "bench", tier: S.benchTier }); } catch (e) {} }   // tezgah yükseltmesi tüm co-op'ta görünür
}
const costStr = (c) => Object.entries(c).map(([k, v]) => ({ wood: "🪵", metal: "⚙️", pelt: "🧵", bandage: "🩹", gem: "💎", cloth: "🧶", rope: "🪢" }[k] + v)).join(" ");
function renderCraft() {
  const list = $("craftList"); if (!list) return;
  $("craftInv").textContent = `🪵${S.inv.wood} ⚙️${S.inv.metal} 🧶${S.inv.cloth} 🪢${S.inv.rope} 🧵${S.inv.pelt} 💎${S.inv.gem} · 🩹${S.inv.bandage} 🧰${S.inv.medkit} 💊${S.inv.pills} 🥫${S.inv.canned} · Tezgah T${S.benchTier}`;
  list.innerHTML = "";
  // --- envanterdeki kurulacak yapılar (üret → KUR) ---
  if (placeablesCount() > 0) {
    const hdr = document.createElement("div"); hdr.className = "craft-sec"; hdr.textContent = "🎒 Kurulacaklar — ateş yanına yerleştir";
    list.appendChild(hdr);
    for (const k in S.placeables) {
      if (!(S.placeables[k] > 0)) continue;
      const row = document.createElement("div"); row.className = "craft-row";
      row.innerHTML = `<div class="ci">${PLACE[k].label} <small>×${S.placeables[k]} · envanterde, kurulmayı bekliyor</small></div>`;
      const b = document.createElement("button"); b.className = "minibtn"; b.textContent = "KUR";
      b.addEventListener("click", () => enterPlace(k)); row.appendChild(b); list.appendChild(row);
    }
    const sep = document.createElement("div"); sep.className = "craft-sec"; sep.textContent = "🛠️ Tarifler"; list.appendChild(sep);
  }
  for (const r of RECIPES) {
    if (r.tier > S.benchTier + 1) continue;                  // sadece mevcut + bir sonraki seviye görünür
    const locked = r.tier > S.benchTier, owned = r.once && r.once();
    const row = document.createElement("div"); row.className = "craft-row"; if (locked) row.style.opacity = "0.5";
    row.innerHTML = `<div class="ci">${r.name} ${r.tier > 1 ? '<small style="color:#b6a98c">T' + r.tier + '</small>' : ''}<small>${r.desc} · ${costStr(r.cost)}</small></div>`;
    const b = document.createElement("button"); b.className = "minibtn"; b.textContent = owned ? "✓" : locked ? "🔒T" + r.tier : "ÜRET";
    b.disabled = owned || locked || !canAfford(r); b.addEventListener("click", () => craft(r));
    row.appendChild(b); list.appendChild(row);
  }
}
let craftOpen = false;
function nearBench() { return !!(S && S.running && camera && Math.hypot(camera.position.x - BENCH.x, camera.position.z - BENCH.z) <= 6); }
function openCraft() {
  if (!S || !S.running || S.downed) return;
  if (!nearBench()) { toast("🛠️ Tezgahtan uzaksın — yanına git de öyle aç", "bad"); return; }   // uzaktan açılmaz
  craftOpen = true; renderCraft(); $("craft").classList.remove("hidden"); if (document.exitPointerLock) document.exitPointerLock();
}
function closeCraft() { craftOpen = false; $("craft").classList.add("hidden"); if (!isTouch && S && S.running && threeCanvas.requestPointerLock) threeCanvas.requestPointerLock(); }
function toggleCraft() { if (craftOpen) closeCraft(); else openCraft(); }

/* ----------------------- BANDAJ: kendini iyileştir / düşen arkadaşı dirilt ----------------------- */
function nearestDownedRemote() {
  let best = null, bd = 3.2 * 3.2;
  for (const id in remotes) { const r = remotes[id]; if (!r.g || !r.downed) continue; const d = (r.g.position.x - camera.position.x) ** 2 + (r.g.position.z - camera.position.z) ** 2; if (d < bd) { bd = d; best = id; } }
  return best;
}
function useBandage() {
  if (S.downed) return;                                  // düşmüşken kendini kurtaramazsın (arkadaş gerekir)
  const downedId = nearestDownedRemote();
  if (downedId) {                                        // yakındaki düşen arkadaşı dirilt
    if (S.inv.bandage <= 0) { toast("Diriltmek için bandaj yok 🩹", "bad"); return; }
    S.inv.bandage--; const r = remotes[downedId]; if (r) r.downed = false;
    try { net.broadcast({ t: "revived", id: downedId }); } catch (e) {}
    toast("🩹 Arkadaşını dirilttin!", "good"); return;
  }
  if (S.health >= 100) { toast("Canın zaten dolu.", "bad"); return; }
  const hm = S.cls === "medic" ? 1.5 : 1;   // Sağlıkçı perk: iyileşme %50 güçlü
  if (S.inv.medkit > 0) { S.inv.medkit--; S.health = clamp(S.health + 75 * hm, 0, 100); S.sick = 0; S.bleed = 0; toast("🧰 Sağlık çantası: +" + Math.round(75 * hm) + " can", "good"); return; }
  if (S.inv.pills > 0) { S.inv.pills--; S.health = clamp(S.health + 30 * hm, 0, 100); S.stamina = clamp(S.stamina + 40, 0, 100); S.sick = 0; toast("💊 Ağrı kesici: +" + Math.round(30 * hm) + " can, +40 enerji", "good"); return; }
  if (S.inv.bandage <= 0) { toast("Tıbbi malzeme yok 🩹🧰💊 (sandık/tezgah)", "bad"); return; }
  S.inv.bandage--; S.health = clamp(S.health + 35 * hm, 0, 100); S.sick = 0; toast("🩹 Bandaj: +" + Math.round(35 * hm) + " can", "good");
}
/* ----------------------- 🧨 DİNAMİT (maden patlayıcısı) ----------------------- */
function blastFX(x, z) {   // kısa patlama görseli: genişleyen küre + ışık
  if (!scene) return;
  const g = new THREE.Group(); g.position.set(x, 1.0, z); scene.add(g);
  const m = new THREE.Mesh(new THREE.SphereGeometry(1, 14, 14), new THREE.MeshBasicMaterial({ color: 0xffb347, transparent: true, opacity: 0.92 })); g.add(m);
  const l = plight(0xffa030, 3.2, 22, 2, 0, 0, 0); g.add(l);
  let t = 0; const iv = setInterval(() => { t += 0.05; m.scale.setScalar(1 + t * 14); m.material.opacity = Math.max(0, 0.92 - t * 1.9); l.intensity = Math.max(0, 3.2 - t * 7); if (t >= 0.5) { clearInterval(iv); scene.remove(g); } }, 50);
}
function useDynamite() {
  if (!S || !S.running || S.downed || S.paused || pauseOpen || craftOpen || placeMode || adminOpen) return;   // menü/duraklatmada patlamasın
  if ((S.inv.dynamite || 0) <= 0) { toast("🧨 Dinamit yok — tezgahta üret (5⚙️ + 1💎)", "bad"); return; }
  S.inv.dynamite--;
  const px = camera.position.x, pz = camera.position.z, R = 8;
  camera.getWorldDirection(_fwd); _fwd.y = 0; _fwd.normalize();
  const bx = px + _fwd.x * 3, bz = pz + _fwd.z * 3;   // birkaç metre öne fırlat
  Sound.thunder(); S.shake = Math.max(S.shake, 0.55); blastFX(bx, bz); toast("🧨 BOOM!", "bad");
  setTimeout(() => {
    let gems = 0, hit = 0;
    for (const c of crystals) { if (!c.mined && Math.hypot(c.x - bx, c.z - bz) < R) { c.mined = true; if (c.group) c.group.visible = false; const g = rndi(1, 3); S.inv.gem += g; gems += g; } }
    for (const s of scraps) { if (!s.taken && Math.hypot(s.x - bx, s.z - bz) < R) { s.taken = true; if (s.group) s.group.visible = false; S.inv.metal += rndi(1, 2); } }
    for (let i = animals.length - 1; i >= 0; i--) { const a = animals[i]; if (Math.hypot(a.x - bx, a.z - bz) < R + 1) { a.hp -= a.boss ? 30 : 60; hit++; if (a.hp <= 0) killAnimal(a); else if (a.type === "boar" || a.type === "jaguar") { a.hostile = true; a.state = "chase"; } } }
    if (gems || hit) toast("🧨 " + (gems ? "💎 +" + gems + " " : "") + (hit ? "· " + hit + " düşman vuruldu" : ""), "good");
  }, 150);
}

/* ----------------------- ÇADIR: güvendeyken uyu, sabaha atla ----------------------- */
function doSleep() {
  if (!S.tools.tent) { toast("Önce 🛏️ Yatak üret ve ateş yanına KUR (tezgah)", "bad"); return; }
  if (S.sleeping > 0) return;
  if (!inCampSafe()) { toast("Sadece yanan ateşin/meşalenin yanında uyuyabilirsin 🔥", "bad"); return; }
  if (watcher || animals.some((a) => a.hostile && Math.hypot(a.x - camera.position.x, a.z - camera.position.z) < 22)) { toast("Tehlike yakın — uyuyamazsın!", "bad"); return; }
  S.sleeping = 2.0; toast("⛺ Uyuyorsun... sabaha atlanıyor", "good");
}

/* ----------------------- JUMPSCARE ----------------------- */
let jumpT = 0, jumpFace = 0, jumpModel = null;
function jumpscare(face, san, hp) {   // eski çizili yüz korkusu (yalnızca yaratık modeli yoksa yedek)
  jumpT = 1.0; jumpFace = face != null ? face : rndi(0, 2);
  S.shake = Math.max(S.shake, 0.9);
  S.sanity = clamp(S.sanity - (san || 12), 0, 100);
  if (hp) { S.health = clamp(S.health - hp, 0, 100); S.hurt = 0.6; if (S.health <= 0) playerDied("kalp krizi"); }
  Sound.screech();
}
// YARATIK SENİ YAKALADI: gerçek 3B modeli YÜZÜ göz hizasında ekranı kaplayacak şekilde sokar
// (jumpscare = yaratığın YÜZÜ, bacakları değil) + aydınlatır + TEK VURUŞTA öldürür
let jumpLight = null;
function catchKill(group, reason) {
  if (admin.god) return;   // 🛡️ God Mode: yaratık yakalayamaz
  if (S.over || S.downed) return;
  if (group) {
    camera.getWorldDirection(_fwd);
    const hlen = Math.hypot(_fwd.x, _fwd.z) || 1, dx = _fwd.x / hlen, dz = _fwd.z / hlen;   // yatay bakış yönü
    group.scale.setScalar(1);
    let s = 1.7, faceOff = 1.6;   // faceOff = grup orijininden yüze olan yerel yükseklik (güvenli varsayılan)
    try {
      if (group.updateWorldMatrix) group.updateWorldMatrix(true, true);
      const box = new THREE.Box3().setFromObject(group);
      const h = box.max.y - box.min.y;
      if (isFinite(h) && h > 0.2) { s = 3.4 / h; faceOff = (box.min.y - group.position.y) + h * 0.88; }   // yüksekliği ~3.4 birime getir (ekranı kaplar); yüz ≈ tepeye yakın
    } catch (e) {}
    const dist = 2.1;
    group.scale.setScalar(s);
    group.position.set(camera.position.x + dx * dist, camera.position.y - faceOff * s + 0.1, camera.position.z + dz * dist);   // YÜZ göz hizasında
    group.rotation.y = Math.atan2(camera.position.x - group.position.x, camera.position.z - group.position.z);   // yüzünü sana döner
    group.visible = true;
    if (!jumpLight) { jumpLight = new THREE.PointLight(0xffc2c2, 0, 16, 1.3); scene.add(jumpLight); }   // yaratığın yüzünü aydınlat (gece de görünsün)
    jumpLight.position.set(camera.position.x + dx * 1.1, camera.position.y + 0.35, camera.position.z + dz * 1.1);
    jumpLight.intensity = 5.5; jumpLight.visible = true;
  }
  jumpModel = group || null; jumpFace = -1; jumpT = 1.3; S.shake = 1.0; S.hurt = 1.0;
  Sound.screech();
  S.sanity = 0; playerDied(reason || "yaratık seni yakaladı");
}
function drawScaryFace(w, h) {
  fxc.save();
  fxc.translate(w / 2 + rnd(-10, 10), h / 2 + rnd(-10, 10));
  fxc.scale(Math.min(w, h) / 320 * (1.05 + Math.random() * 0.07), Math.min(w, h) / 320 * (1.05 + Math.random() * 0.07));
  fxc.fillStyle = "#d9d2c4"; fxc.beginPath(); fxc.ellipse(0, 0, 132, 176, 0, 0, 6.3); fxc.fill();             // kafa
  fxc.fillStyle = "rgba(20,6,6,0.55)";                                                                        // çökük gölgeler
  fxc.beginPath(); fxc.ellipse(-64, -6, 38, 60, 0.35, 0, 6.3); fxc.fill();
  fxc.beginPath(); fxc.ellipse(64, -6, 38, 60, -0.35, 0, 6.3); fxc.fill();
  fxc.beginPath(); fxc.ellipse(0, -126, 64, 30, 0, 0, 6.3); fxc.fill();
  fxc.strokeStyle = "rgba(90,0,0,0.35)"; fxc.lineWidth = 2;                                                   // damarlar
  for (let i = 0; i < 11; i++) { const ax = rnd(-112, 112), ay = rnd(-150, 70); fxc.beginPath(); fxc.moveTo(ax, ay); fxc.lineTo(ax + rnd(-26, 26), ay + rnd(22, 52)); fxc.stroke(); }
  fxc.fillStyle = "#000"; fxc.beginPath(); fxc.ellipse(-50, -34, 33, 44, 0, 0, 6.3); fxc.fill(); fxc.beginPath(); fxc.ellipse(50, -34, 33, 44, 0, 0, 6.3); fxc.fill(); // göz çukuru
  const gl = 0.65 + Math.random() * 0.35; fxc.fillStyle = "rgba(255,28,28," + gl + ")";                       // parlayan kırmızı göz
  fxc.beginPath(); fxc.arc(-50, -32, 10, 0, 6.3); fxc.arc(50, -32, 10, 0, 6.3); fxc.fill();
  fxc.fillStyle = "#fff"; fxc.beginPath(); fxc.arc(-50, -32, 3, 0, 6.3); fxc.arc(50, -32, 3, 0, 6.3); fxc.fill();
  fxc.strokeStyle = "#7a0000"; fxc.lineWidth = 7;                                                             // gözden kan
  fxc.beginPath(); fxc.moveTo(-50, 6); fxc.lineTo(-45, 155); fxc.stroke();
  fxc.beginPath(); fxc.moveTo(50, 6); fxc.lineTo(56, 168); fxc.stroke();
  fxc.fillStyle = "#0a0000"; fxc.beginPath(); fxc.ellipse(0, 96, 46, 70, 0, 0, 6.3); fxc.fill();              // çığlık ağzı
  fxc.fillStyle = "#cfc6b4";                                                                                  // sivri dişler
  for (let i = -4; i <= 4; i++) { fxc.beginPath(); fxc.moveTo(i * 10, 38); fxc.lineTo(i * 10 - 5, 64); fxc.lineTo(i * 10 + 5, 64); fxc.closePath(); fxc.fill(); fxc.beginPath(); fxc.moveTo(i * 10, 158); fxc.lineTo(i * 10 - 5, 132); fxc.lineTo(i * 10 + 5, 132); fxc.closePath(); fxc.fill(); }
  fxc.strokeStyle = "#8a0000"; fxc.lineWidth = 9; fxc.beginPath(); fxc.moveTo(0, 158); fxc.lineTo(rnd(-12, 12), 205); fxc.stroke(); // ağızdan kan
  fxc.restore();
}

/* ---- ÖZEL DEHŞET: ekrana yumruk atan kanlı kadın + sahte "sistem bozuluyor" illüzyonu ---- */
/*    GERÇEK bilgisayara HİÇBİR ŞEY yapmaz — tamamen oyun içi görsel efekttir. */
let glitch = null;
function triggerGlitchScare() {
  if (glitch) return;
  glitch = { t: 0, punchT: 0.25, cracks: [] };
  S.shake = 1.0; S.sanity = clamp(S.sanity - 14, 0, 100); S.hurt = 0.5;
  Sound.glitchNoise(); Sound.screech();
}
function drawCrack(x, y, r) {
  const n = 7;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * 6.28 + Math.sin(x + i);
    let px = x, py = y; fxc.beginPath(); fxc.moveTo(px, py);
    const segs = 4;
    for (let s = 1; s <= segs; s++) { const rr = r * (s / segs); px = x + Math.cos(a) * rr + rnd(-8, 8); py = y + Math.sin(a) * rr + rnd(-8, 8); fxc.lineTo(px, py); }
    fxc.strokeStyle = "rgba(0,0,0,0.7)"; fxc.lineWidth = 3; fxc.stroke();
    fxc.strokeStyle = "rgba(230,235,240,0.9)"; fxc.lineWidth = 1.2; fxc.stroke();
  }
  fxc.fillStyle = "rgba(220,225,230,0.85)"; fxc.beginPath(); fxc.arc(x, y, 4, 0, 6.3); fxc.fill();
}
function drawBloodyWoman(w, h, t) {
  const grow = Math.min(1, (t - 0.25) / 1.6);
  const jx = rnd(-12, 12), jy = rnd(-12, 12);
  fxc.save(); fxc.translate(w / 2 + jx, h / 2 + jy);
  const sc = (Math.min(w, h) / 360) * (0.7 + grow * 0.9); fxc.scale(sc, sc);
  // uzun siyah saç
  fxc.fillStyle = "#040404"; fxc.beginPath(); fxc.ellipse(0, -10, 150, 220, 0, 0, 6.3); fxc.fill();
  // solgun yüz
  fxc.fillStyle = "#c9c0b2"; fxc.beginPath(); fxc.ellipse(0, 0, 95, 135, 0, 0, 6.3); fxc.fill();
  // simsiyah kan akıntıları
  fxc.strokeStyle = "#050505"; fxc.lineWidth = 7;
  for (let i = -3; i <= 3; i++) { fxc.beginPath(); fxc.moveTo(i * 22, -30); fxc.lineTo(i * 22 + rnd(-8, 8), 140); fxc.stroke(); }
  // kara göz çukurları + kırmızı bakış
  fxc.fillStyle = "#000"; fxc.beginPath(); fxc.ellipse(-38, -22, 26, 34, 0, 0, 6.3); fxc.ellipse(38, -22, 26, 34, 0, 0, 6.3); fxc.fill();
  fxc.fillStyle = "rgba(255,30,30," + (0.6 + Math.random() * 0.4) + ")"; fxc.beginPath(); fxc.arc(-38, -20, 7, 0, 6.3); fxc.arc(38, -20, 7, 0, 6.3); fxc.fill();
  // çığlık ağzı (siyah kanlı)
  fxc.fillStyle = "#060000"; fxc.beginPath(); fxc.ellipse(0, 70, 34, 52, 0, 0, 6.3); fxc.fill();
  fxc.strokeStyle = "#050505"; fxc.lineWidth = 10; fxc.beginPath(); fxc.moveTo(0, 120); fxc.lineTo(rnd(-12, 12), 200); fxc.stroke();
  // yumruklar (alt köşelerden ekrana vuruyor)
  fxc.fillStyle = "#bdb4a4"; const fp = Math.sin(t * 18) * 18;
  fxc.beginPath(); fxc.arc(-120 + fp, 150, 40, 0, 6.3); fxc.fill();
  fxc.beginPath(); fxc.arc(120 - fp, 150, 40, 0, 6.3); fxc.fill();
  fxc.strokeStyle = "#050505"; fxc.lineWidth = 5;
  for (const sx of [-120 + fp, 120 - fp]) { fxc.beginPath(); fxc.moveTo(sx - 20, 150); fxc.lineTo(sx + 20, 150); fxc.stroke(); }
  fxc.restore();
}
function fakeDesktop(w, h) {
  // SAHTE masaüstü — "arka planını değiştirdi" yanılsaması (gerçek sistem değişmez)
  const g = fxc.createLinearGradient(0, 0, 0, h); g.addColorStop(0, "#2a3a52"); g.addColorStop(1, "#0e1622");
  fxc.fillStyle = g; fxc.fillRect(0, 0, w, h);
  fxc.fillStyle = "rgba(120,0,0,0.35)"; fxc.fillRect(0, 0, w, h);                    // kırmızı sis
  fxc.fillStyle = "rgba(255,255,255,0.85)"; for (let i = 0; i < 4; i++) { fxc.fillRect(24, 24 + i * 70, 46, 46); }  // sahte ikonlar
  fxc.fillStyle = "rgba(10,12,16,0.9)"; fxc.fillRect(0, h - 40, w, 40);              // sahte görev çubuğu
  fxc.fillStyle = "#7a0000"; fxc.font = "bold 40px monospace"; fxc.textAlign = "center";
  fxc.fillText("SENI GÖRÜYORUM", w / 2, h / 2);
  fxc.textAlign = "start";
}
function drawGlitchScare(w, h, gl, dt) {
  gl.t += dt; gl.punchT -= dt;
  if (gl.punchT <= 0 && gl.t < 2.3) { gl.punchT = rnd(0.22, 0.42); gl.cracks.push({ x: rnd(w * 0.2, w * 0.8), y: rnd(h * 0.2, h * 0.8), r: 4 }); S.shake = 0.9; Sound.punch(); }
  const fake = gl.t > 2.45 && gl.t < 2.95;
  if (fake) fakeDesktop(w, h);
  else { fxc.fillStyle = Math.random() > 0.4 ? "#180000" : "#400000"; fxc.fillRect(0, 0, w, h); }
  for (const cr of gl.cracks) { cr.r = Math.min(cr.r + 760 * dt, Math.max(w, h)); drawCrack(cr.x, cr.y, cr.r); }
  if (gl.t > 0.25 && gl.t < 2.5 && !fake) drawBloodyWoman(w, h, gl.t);
  fxc.fillStyle = "rgba(0,0,0,0.16)"; for (let y = 0; y < h; y += 4) fxc.fillRect(0, y + (Math.random() < 0.5 ? 0 : 1), w, 1);
  if (gl.t >= 3.15) glitch = null;
}

/* ---- OPSİYONEL KAMERA KORKUSU (yalnızca İZİNLE) ----
   Kullanıcı açıkça açarsa tarayıcı kamera izni ister; verilirse oyun ARA SIRA
   senin görüntünü yakalayıp ekrana çarpık/kanlı gösterir ("seni gördüm"). Gizli/arka-plan
   erişim YOK; izin verilmezse hiçbir şey olmaz. Hiçbir görüntü kaydedilmez/gönderilmez. */
let camEnabled = false, camVideo = null, camStream = null, camScare = null, camScareCd = 40;
async function enableCamScare() {
  if (camEnabled) return true;
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) throw new Error("kamera yok");
  camStream = await navigator.mediaDevices.getUserMedia({ video: { width: 320, height: 240 }, audio: false });
  camVideo = document.createElement("video"); camVideo.autoplay = true; camVideo.playsInline = true; camVideo.muted = true;
  camVideo.srcObject = camStream; await camVideo.play().catch(() => {});
  camEnabled = true; return true;
}
function captureFrame() {
  if (!camEnabled || !camVideo || camVideo.videoWidth === 0) return null;
  const c = document.createElement("canvas"); c.width = 320; c.height = 240;
  const g = c.getContext("2d"); g.drawImage(camVideo, 0, 0, 320, 240); return c;
}
function triggerCamScare() {
  const img = captureFrame(); if (!img) return;
  camScare = { t: 0, img, cracks: [] }; S.shake = 1.0; S.sanity = clamp(S.sanity - 12, 0, 100); Sound.screech();
  hangPhotoOnTree(img);   // görüntünü oyundaki bir ağaca da as
}
function hangPhotoOnTree(srcCanvas) {
  // en yakın ağacı bul (oyuncunun baktığı yöne yakın olanı tercih et)
  camera.getWorldDirection(_fwd); _fwd.y = 0; _fwd.normalize();
  const px = camera.position.x, pz = camera.position.z;
  let best = null, bestScore = -1e9;
  for (const t of trees) { if (!t.alive) continue; const dx = t.x - px, dz = t.z - pz, d = Math.hypot(dx, dz); if (d < 4 || d > 26) continue; const dot = (dx / d) * _fwd.x + (dz / d) * _fwd.z; const score = dot * 2 - d * 0.05; if (score > bestScore) { bestScore = score; best = t; } }
  if (!best) return;
  // kanlı çerçeveli fotoğraf dokusu
  const c = document.createElement("canvas"); c.width = 256; c.height = 200; const g = c.getContext("2d");
  g.fillStyle = "#1a0606"; g.fillRect(0, 0, 256, 200);
  try { g.drawImage(srcCanvas, 12, 12, 232, 150); } catch (e) {}
  g.fillStyle = "rgba(120,0,0,0.4)"; g.fillRect(12, 12, 232, 150);
  g.strokeStyle = "#3a0000"; g.lineWidth = 6; g.strokeRect(8, 8, 240, 184);
  g.fillStyle = "#b00000"; g.font = "bold 22px monospace"; g.textAlign = "center"; g.fillText("SENİ GÖRDÜM", 128, 188);
  const tex = new THREE.CanvasTexture(c);
  const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: 1, side: THREE.DoubleSide, depthWrite: false });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1.7, 1.33), mat);
  const ux = (best.x - px), uz = (best.z - pz), ul = Math.hypot(ux, uz) || 1;       // ağacın oyuncuya bakan yüzü
  mesh.position.set(best.x - ux / ul * 0.9, 2.4, best.z - uz / ul * 0.9);
  mesh.lookAt(px, 2.4, pz); mesh.frustumCulled = false; scene.add(mesh);
  photos.push({ mesh, mat, t: 22 });
}
function drawCamScare(w, h, dt) {
  const cs = camScare; cs.t += dt;
  const jx = rnd(-14, 14), jy = rnd(-14, 14);
  fxc.fillStyle = "#180000"; fxc.fillRect(0, 0, w, h);
  // senin görüntün — büyük, kanlı, titreyen
  const iw = Math.min(w, h) * 0.9, ih = iw * 0.75;
  fxc.save(); fxc.translate(w / 2 + jx, h / 2 + jy); fxc.scale(1 + cs.t * 0.06, 1 + cs.t * 0.06);
  try { fxc.drawImage(cs.img, -iw / 2, -ih / 2, iw, ih); } catch (e) {}
  fxc.fillStyle = "rgba(120,0,0,0.45)"; fxc.fillRect(-iw / 2, -ih / 2, iw, ih);   // kan tonu
  fxc.restore();
  if (Math.random() < 0.3) { camScare.cracks.push({ x: rnd(w * 0.2, w * 0.8), y: rnd(h * 0.2, h * 0.8), r: 4 }); Sound.punch(); }
  for (const cr of cs.cracks) { cr.r = Math.min(cr.r + 700 * dt, Math.max(w, h)); drawCrack(cr.x, cr.y, cr.r); }
  fxc.fillStyle = "#9a0000"; fxc.font = "bold " + Math.round(Math.min(w, h) / 9) + "px monospace"; fxc.textAlign = "center";
  fxc.fillText("SENİ GÖRDÜM", w / 2 + jx, h * 0.5 + jy); fxc.textAlign = "start";
  fxc.fillStyle = "rgba(0,0,0,0.16)"; for (let y = 0; y < h; y += 4) fxc.fillRect(0, y, w, 1);
  if (cs.t >= 2.6) camScare = null;
}

/* ----------------------- DEATH / DOWNED / WIN ----------------------- */
// Co-op'ta tek başına DEĞİLSEN ölmezsin: yere düşersin, arkadaşın bandajla diriltir.
// Tek başınaysan (peer yok) doğrudan ölürsün.
// yaratık hasarı: zırh varsa bir kısmını emer ve yıpranır (açlık/soğuk/sıcak gibi çevre hasarı zırhı by-pass eder)
function hurt(dmg) {
  if (admin.god) return S.health;   // 🛡️ God Mode: hasar yok
  dmg *= (S.diff || 1);             // 🎚️ zorluk: gelen hasar çarpanı (Kolay 0.6 / Zor 1.5)
  if (S.armor > 0 && S.armorDef > 0) {
    const absorbed = dmg * S.armorDef;
    S.armor = Math.max(0, S.armor - (absorbed * 1.4 + 1));
    dmg -= absorbed;
    if (S.armor <= 0) { S.armorDef = 0; toast("🛡️ Zırhın kırıldı!", "bad"); }
  }
  S.health = clamp(S.health - dmg, 0, 100);
  return S.health;
}
function giveArmor(def, label) {   // zırh kuşan: daha iyisini giy, dayanıklılığı doldur
  if (def >= S.armorDef) { S.armorDef = def; S.armor = 100; toast("🛡️ " + label + " kuşandın (−%" + Math.round(def * 100) + " hasar)", "good"); return true; }
  return false;
}
// envanter ağırlığı: ağır kaynaklar (odun/metal/mücevher) limiti aşarsa yavaşlarsın; çanta limiti artırır
function carryWeight() { return S.inv.wood * 0.4 + S.inv.metal * 0.6 + (S.inv.gem || 0) * 0.3; }
function carryLimit() { return 80 + (S.backpack || 0) * 45; }
function playerDied(reason) {
  if (admin.god) { S.health = 100; S.hurt = 0; return; }   // 🛡️ God Mode: ölüm yok
  if (S.over || S.downed) return;
  S.deathReason = reason || S.deathReason || "bilinmeyen";
  if (net.online && net.peerCount() > 0) goDown(S.deathReason);
  else die(S.deathReason);
}
function goDown(reason) {
  S.downed = true; S.bleed = 45; S.health = 0; S.deathReason = reason;
  document.exitPointerLock && document.exitPointerLock();
  $("downed").classList.remove("hidden");
  Sound.thump(); toast("🩸 Yere düştün — bir arkadaşın seni diriltmeli!", "bad");
  try { net.broadcast({ t: "down", reason }); } catch (e) {}
}
function reviveSelf() {
  S.downed = false; S.bleed = 0; S.health = 35; S.sanity = clamp(S.sanity + 10, 0, 100);
  $("downed").classList.add("hidden"); toast("🩹 Arkadaşın seni dirilttin — ayaktasın!", "good");
}
// co-op: bağlı ve hâlâ ayakta (düşmemiş/ölmemiş) bir arkadaş var mı? (diriltebilecek biri)
function anyoneAlive() { for (const id in remotes) { const r = remotes[id]; if (r && !r.downed && !r.dead) return true; } return false; }
// bandaj süresi bitti ama arkadaş(lar) hayatta → izleyici modu (lobiye dön / izle). Diriltemezsin.
function enterSpectate() {
  S.downed = false; S.spectating = true; S.bleed = 0;
  $("downed").classList.add("hidden");
  const sp = $("spectate"); if (sp) sp.classList.remove("hidden");
  document.exitPointerLock && document.exitPointerLock();
  toast("💀 Öldün — arkadaşların hâlâ hayatta. İzleyebilir ya da lobiye dönebilirsin.", "bad");
  try { net.broadcast({ t: "dead" }); } catch (e) {}   // arkadaşlar artık seni diriltmeye çalışmasın
}
function returnToLobby() { try { net.disconnect(); } catch (e) {} location.reload(); }   // co-op'tan çık + ana menü
function die(reason) {
  if (S.over) return; S.over = true; S.running = false; S.spectating = false; S.deathReason = reason; S.downed = false;
  $("downed").classList.add("hidden"); { const sp = $("spectate"); if (sp) sp.classList.add("hidden"); }
  Sound.screech();
  clearSave();   // ölünce kayıt silinir
  if (net.online) { try { net.broadcast({ t: "dead" }); } catch (e) {} try { net.disconnect(); } catch (e) {} }   // co-op'ta ölünce oturumdan ayrıl (ölü oyuncu arkadaş DİRİLTEMEZ — "tekrar dene" hilesini engeller)
  document.exitPointerLock && document.exitPointerLock();
  setTimeout(() => { $("deathReason").textContent = "Sebep: " + reason; $("daysSurvived").textContent = S.day; $("gameover").classList.remove("hidden"); }, 700);
}
function winGame() { S.won = true; S.running = false; clearSave(); document.exitPointerLock && document.exitPointerLock(); $("win").classList.remove("hidden"); }
/* ----- 100. gün: KURTARMA HELİKOPTERİ finali ----- */
let heli = null, heliRotor = null;
function makeHeli() {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(1.1, 2.2, 6, 10), new THREE.MeshStandardMaterial({ color: 0x2e3a34, metalness: 0.5, roughness: 0.5 })); body.rotation.z = Math.PI / 2; g.add(body);
  const cockpit = new THREE.Mesh(new THREE.SphereGeometry(0.9, 12, 10), new THREE.MeshStandardMaterial({ color: 0x5aa0c8, metalness: 0.3, roughness: 0.2, transparent: true, opacity: 0.7 })); cockpit.position.set(1.6, 0, 0); g.add(cockpit);
  const tail = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.32, 3.2, 8), new THREE.MeshStandardMaterial({ color: 0x28322c })); tail.rotation.z = Math.PI / 2; tail.position.set(-2.4, 0.2, 0); g.add(tail);
  heliRotor = new THREE.Mesh(new THREE.BoxGeometry(7.5, 0.08, 0.4), new THREE.MeshStandardMaterial({ color: 0x11150f })); heliRotor.position.y = 1.2; g.add(heliRotor);
  const tr = new THREE.Mesh(new THREE.BoxGeometry(0.1, 1.6, 0.3), new THREE.MeshStandardMaterial({ color: 0x11150f })); tr.position.set(-3.9, 0.4, 0); g.add(tr);
  for (const sx of [-1, 1]) { const sk = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 3.4, 6), new THREE.MeshStandardMaterial({ color: 0x1a1f18 })); sk.rotation.z = Math.PI / 2; sk.position.set(0, -1.1, sx * 0.8); g.add(sk); }
  g.add(plight(0xfff2c0, 2, 30, 1.4, 1.8, -0.4, 0));
  scene.add(g); return g;
}
function startRescue() {
  if (S.rescuing) return;
  S.rescuing = true; S.rescueT = 7; S.running = true;   // kısa sinematik; sonra zafer ekranı
  if (!heli) heli = makeHeli();
  heli.visible = true;
  document.exitPointerLock && document.exitPointerLock();
  toast("🚁 KURTARMA HELİKOPTERİ GELİYOR — DAYANDIN!", "good"); Sound.thunder(); whisperText("kurtuldun...");
}
function updateRescue(dt) {
  S.rescueT -= dt;
  if (heliRotor) heliRotor.rotation.y += dt * 40;
  if (heli) {
    const px = camera.position.x, pz = camera.position.z, land = 6;
    const k = clamp(1 - S.rescueT / 7, 0, 1);                 // 0→1 iniş ilerlemesi
    heli.position.set(px + 10 - k * 6, 60 - k * 54 + land, pz + 8 - k * 4);
    heli.rotation.y = Math.atan2(px - heli.position.x, pz - heli.position.z);
    // kamerayı yavaşça helikoptere çevir (sinematik)
    const hy = Math.atan2(heli.position.x - px, heli.position.z - pz); yaw = lerp(yaw, hy + Math.PI, Math.min(1, dt * 2)); pitch = lerp(pitch, 0.15, Math.min(1, dt * 2));
  }
  camera.rotation.set(pitch, yaw, 0, "YXZ");   // erken-return sırasında kamerayı çevir
  if (S.rescueT <= 0) { if (heli) heli.visible = false; winGame(); }
}

/* ----------------------- KAYDET / DEVAM ET ----------------------- */
function saveProgress() {
  if (!S || !S.running || S.over || S.downed || S.spectating) return;   // düşük/ölü/izleyici iken KAYDETME (yoksa DEVAM ET seni ~0 canla başlatır)
  // madende oto-kayıt olursa gizli maden koordinatı KAYDEDİLMEZ (DEVAM ET'te boş köşeye ışınlanma bug'ı) → yüzey giriş noktasını kaydet
  const sx = (S.inMine && mineReturn) ? mineReturn.x : camera.position.x;
  const sz = (S.inMine && mineReturn) ? mineReturn.z : camera.position.z;
  try {
    localStorage.setItem("orm_save", JSON.stringify({
      day: S.day, time: S.time, inv: S.inv, tools: S.tools, notes: S.notes,
      health: S.health, hunger: S.hunger, warmth: S.warmth, sanity: S.sanity, thirst: S.thirst,
      weapons: S.weapons, meleeOwned: S.meleeOwned, melee: S.melee, equip: S.equip, flashlight: S.flashlight, battery: S.battery, armor: S.armor, armorDef: S.armorDef, cls: S.cls, peltTrades: S.peltTrades, backpack: S.backpack,
      diff: S.diff, depot: S.depot, x: sx, z: sz, ts: Date.now(),
    }));
  } catch (e) {}
}
function hasSave() { try { return !!localStorage.getItem("orm_save"); } catch (e) { return false; } }
function clearSave() { try { localStorage.removeItem("orm_save"); } catch (e) {} }
function applySave() {
  let sv = null; try { sv = JSON.parse(localStorage.getItem("orm_save") || "null"); } catch (e) {}
  if (!sv) return false;
  S.day = sv.day || 1; S.time = sv.time != null ? sv.time : 0.18;
  if (sv.inv) Object.assign(S.inv, sv.inv);
  if (sv.tools) Object.assign(S.tools, sv.tools);
  if (sv.weapons) Object.assign(S.weapons, sv.weapons);
  if (sv.meleeOwned) Object.assign(S.meleeOwned, sv.meleeOwned);
  if (sv.melee) S.melee = sv.melee; if (sv.equip) S.equip = sv.equip;
  if (sv.flashlight) S.flashlight = sv.flashlight; if (sv.battery != null) S.battery = sv.battery;
  if (sv.armor != null) S.armor = sv.armor; if (sv.armorDef != null) S.armorDef = sv.armorDef;
  if (sv.cls) S.cls = sv.cls; if (sv.peltTrades != null) S.peltTrades = sv.peltTrades; if (sv.backpack != null) S.backpack = sv.backpack;
  if (sv.diff != null) S.diff = sv.diff;   // 🎚️ zorluk geri yüklenir
  if (sv.depot) S.depot = sv.depot;   // 📦 depo içeriği geri yüklenir
  if (sv.notes) S.notes = sv.notes;
  S.health = sv.health != null ? sv.health : 100; S.hunger = sv.hunger != null ? sv.hunger : 100;
  S.warmth = sv.warmth != null ? sv.warmth : 100; S.sanity = sv.sanity != null ? sv.sanity : 100;
  S.thirst = sv.thirst != null ? sv.thirst : 100;
  if (sv.x != null) camera.position.set(sv.x, CFG.EYE, sv.z);
  toast("💾 Devam ediliyor — GÜN " + S.day, "good"); return true;
}

/* ----------------------- UPDATE ----------------------- */
function update(dt) {
  if (S.rescuing) { updateRescue(dt); return; }   // 100. gün kurtarma sineması — normal oyun durur
  S.saveT = (S.saveT || 0) - dt; if (S.saveT <= 0) { S.saveT = 25; saveProgress(); }   // 💾 otomatik kayıt (~25s) → güncelleme/çıkışta ilerleme kaybolmaz
  if (S.fishing > 0) { S.fishing -= dt; if (S.fishing <= 0) { S.fishing = 0; if (nearWater() && Math.random() < 0.72) { const n = rndi(1, 2); S.inv.raw += n; toast("🐟 +" + n + " balık yakaladın (çiğ) — ateşte pişir", "good"); Sound.chop(); } else toast("🎣 Balık kaçtı...", "bad"); } }   // 🎣 balık tutma sonucu
  if (admin.infStam) S.stamina = 100;              // ♾️ Sonsuz Enerji
  // zaman / gün
  if (!admin.freezeTime) S.time += dt / CFG.DAY_LENGTH;   // ⏸️ Zamanı Dondur
  if (S.time >= 1) {
    S.time -= 1; S.day++; S.firstNightDone = false; S.scripted = false;
    if (S.day > CFG.WIN_DAY) { startRescue(); return; }
    S.bloodMoon = S.day >= 6 && Math.random() < (0.12 + S.day / 100 * 0.4);   // ilerledikçe daha sık KANLI AY
    toast("☀️ GÜN " + S.day + " başladı" + (S.bloodMoon ? " — bu gece KANLI AY 🔴" : ""), S.bloodMoon ? "bad" : "good");
    if ([5, 10, 25, 50, 75, 90].includes(S.day)) { toast("🏆 " + S.day + " GÜN HAYATTA KALDIN!", "good"); whisperText(choice(["hâlâ buradasın...", "neden bırakmıyorsun", "o izliyor"])); }
    // SANDIK RESPAWN: yağmalanan sandıklar birkaç gün sonra yeniden dolar (uç biyomlar daha yavaş)
    { const px = camera.position.x, pz = camera.position.z; let refilled = 0;
      for (const c of chests) { if (!c.opened || c.openedDay == null) continue;
        const cb = c.ammo ? "caves" : biomeAt(c.x, c.z), wait = (cb === "volcanic" || cb === "snow" || cb === "caves") ? 8 : 4;
        if (S.day - c.openedDay >= wait && Math.hypot(c.x - px, c.z - pz) > 40) { c.opened = false; c.openedDay = null; if (c.lid) c.lid.rotation.x = 0; refilled++; } }
      if (refilled > 0) toast("📦 " + refilled + " sandık yeniden dolduruldu (yağmalanabilir)", "good"); }
    saveProgress();   // her yeni gün otomatik kaydet
  }
  const night = isNight();
  const dread = dreadLevel();

  // bakış (kamera) uygula — her durumda etrafa bakılabilir
  camera.rotation.set(pitch, yaw, 0, "YXZ");

  // ÇADIRDA UYUMA → sabaha atla
  if (S.sleeping > 0) {
    S.sleeping -= dt;
    if (S.sleeping <= 0) {
      if (S.time >= 0.5) { S.day++; if (S.day > CFG.WIN_DAY) { startRescue(); return; } S.bloodMoon = false; }
      S.time = 0.18; S.warmth = clamp(S.warmth + 25, 0, 100); S.stamina = 100; S.sanity = clamp(S.sanity + 15, 0, 100); S.hunger = clamp(S.hunger - 10, 0, 100);
      toast("🌅 Uyandın — GÜN " + S.day, "good");
    }
    updateHUD(night); return;
  }

  // İZLEYİCİ MODU (öldün ama arkadaşın hayatta) → hareket/etkileşim yok, sadece bak + izle
  if (S.spectating) {
    if (net.online) { S.netT = (S.netT || 0) - dt; if (S.netT <= 0) { S.netT = 0.3; try { net.broadcast({ t: "state", x: camera.position.x, z: camera.position.z, yaw, day: S.day, time: S.time, hp: 0, downed: false, dead: true }); } catch (e) {} } }
    lerpRemotes(dt);
    if (!net.online || !anyoneAlive()) { die(S.deathReason || "kan kaybı"); return; }   // izlerken herkes de gittiyse → oyun biter
    updateHUD(night); return;
  }
  // YERE DÜŞTÜ (co-op) → kan kaybı, hareket yok, diriltilmeyi bekle
  if (S.downed) {
    if (net.online && net.peerCount() > 0 && !anyoneAlive()) { die("herkes yere düştü — oyun bitti"); return; }   // TÜM oyuncular düştü → oyun biter
    S.bleed -= dt; S.heartLevel = 1; if ((S.heart -= dt) <= 0) { Sound.thump(); S.heart = 0.5; }
    $("bleedTxt").textContent = Math.max(0, Math.ceil(S.bleed)) + " sn";
    if (net.online) { S.netT = (S.netT || 0) - dt; if (S.netT <= 0) { S.netT = 0.2; try { net.broadcast({ t: "state", x: camera.position.x, z: camera.position.z, yaw, day: S.day, time: S.time, hp: 0, downed: true }); } catch (e) {} } }
    lerpRemotes(dt);
    if (S.bleed <= 0) {   // bandaj süresi bitti
      if (net.online && anyoneAlive()) enterSpectate();   // arkadaş hayatta → izle / lobiye dön (diriltemezsin)
      else die(S.deathReason || "kan kaybı");             // kimse yok → oyun biter
      return;
    }
    updateHUD(night); return;
  }

  // hareket
  let mz = 0, mx = 0;
  if (keys["w"]) mz += 1; if (keys["s"]) mz -= 1; if (keys["d"]) mx += 1; if (keys["a"]) mx -= 1;
  if (inp.joy) { mx += inp.jx; mz += -inp.jy; }
  const m = Math.hypot(mx, mz); if (m > 1) { mx /= m; mz /= m; }
  const sprinting = (inp.sprint || keys["shift"] || sprintBtn._held) && S.stamina > 1 && m > 0.1;
  let spd = (sprinting ? 8.5 : 5) * dt * (admin.speed || 1);   // ⚡ admin hız çarpanı
  if (S.hunger <= 0 || S.warmth <= 0) spd *= 0.62;
  if (carryWeight() > carryLimit()) spd *= 0.6;   // aşırı yük → yavaşlama (çanta yükseltmesi limiti artırır)
  camera.getWorldDirection(_fwd); const fy = _fwd.y; _fwd.y = 0; _fwd.normalize();
  const flying = admin.fly, mul = flying ? 2.2 : 1;
  const rightX = -_fwd.z, rightZ = _fwd.x; // sağ = cross(forward, up)
  let nx = camera.position.x + (_fwd.x * mz + rightX * mx) * spd * mul;
  let nz = camera.position.z + (_fwd.z * mz + rightZ * mx) * spd * mul;
  if (!admin.noclip) {   // noclip: ağaç/duvar çarpışması ATLANIR
    for (const t of trees) { if (!t.alive) continue; const dx = nx - t.x, dz = nz - t.z, rr = t.r + 0.5; if (dx * dx + dz * dz < rr * rr) { const d = Math.hypot(dx, dz) || 0.001; nx = t.x + dx / d * rr; nz = t.z + dz / d * rr; } }
    for (const w of walls) { const dx = nx - w.x, dz = nz - w.z, rr = w.r + 0.4; if (dx * dx + dz * dz < rr * rr) { const d = Math.hypot(dx, dz) || 0.001; nx = w.x + dx / d * rr; nz = w.z + dz / d * rr; } }
  }
  const lim = admin.noclip ? CFG.WORLD + 60 : CFG.WORLD;
  nx = clamp(nx, -lim, lim); nz = clamp(nz, -lim, lim);
  camera.position.x = nx; camera.position.z = nz;
  if (!admin.noclip && (Math.abs(nx) >= CFG.WORLD - 0.6 || Math.abs(nz) >= CFG.WORLD - 0.6)) { S.edgeT = (S.edgeT || 0) - dt; if (S.edgeT <= 0) { S.edgeT = 6; toast("🌲 Ormanın sınırındasın — buradan öteye geçilmez, geri dön.", "bad"); } }   // dünya kenarı belirgin
  { let ic = !!S.inMine; if (!ic) for (const c of caves) { if (Math.hypot(c.x - nx, c.z - nz) < c.r) { ic = true; break; } } inCave = ic;   // madendeyken hep karanlık (caves)
    const nb = ic ? "caves" : biomeAt(nx, nz); if (nb !== curBiome) { curBiome = nb; applyBiomeGround(nb); toast(S.inMine ? "⛏️ Derin Maden" : ic ? "🕳️ Mağaraya girdin — fenerini aç (L)!" : "Bölge: " + BIOMES[nb].name, "good"); } }
  // baş sallanması + sarsıntı
  if (m > 0.1) { S.bob += dt * (sprinting ? 14 : 9); if (!flying) { S.stepT -= dt; if (S.stepT <= 0) { Sound.step(); S.stepT = sprinting ? 0.3 : 0.45; } } } else S.bob *= 0.9;
  if (flying) {   // 🕊️ UÇUŞ: bakış yönünün dikey bileşeniyle uç + Space yüksel / Shift alçal, yerçekimi yok
    let ny = camera.position.y + fy * mz * spd * mul;
    if (keys[" "] || inp.jump) { ny += spd * mul; inp.jump = false; }
    if (keys["shift"] || keys["control"]) ny -= spd * mul;
    camera.position.y = clamp(ny, 0.6, 220); S.py = 0; S.vy = 0;
  } else {   // yerçekimi + zıplama
    if (inp.jump) { inp.jump = false; if (S.py <= 0.02 && S.vy <= 0) { S.vy = 5.4; Sound.step(); } }
    S.vy -= 20 * dt; S.py = Math.max(0, S.py + S.vy * dt); if (S.py <= 0) S.vy = 0;
    let camY = CFG.EYE + Math.sin(S.bob) * 0.06 + S.py;
    if (S.shake > 0) { S.shake = Math.max(0, S.shake - dt * 1.6); camY += rnd(-S.shake, S.shake) * 0.15; yaw += rnd(-S.shake, S.shake) * 0.01; }
    camera.position.y = camY;
  }

  // stamina
  S.stamina = clamp(S.stamina + (sprinting ? -18 : 12) * dt, 0, 100);
  if (S.swingCd > 0) S.swingCd -= dt;
  if (S.sick > 0) S.sick -= dt;
  if (S.hurt > 0) S.hurt -= dt;

  // aksiyon kenar tetikleri
  if (placeMode) updateGhost();
  updateCarry(dt);   // yerdeki eşyalar sallanır + taşınan eşya elinde durur
  if (S.tools.chainsaw && actionDown && !placeMode && S.swingCd <= 0) inp.action = true;   // motorlu testere: basılı tutunca sürekli kes
  if (inp.action) { inp.action = false; if (placeMode) confirmPlace(); else doAction(); }
  if (inp.fire) { inp.fire = false; doFire(); }
  if (inp.eat) { inp.eat = false; doEat(); }
  if (inp.bandage) { inp.bandage = false; useBandage(); }
  if (inp.sleep) { inp.sleep = false; doSleep(); }
  // menzilli silah: cooldown + basılı tut seri ateş + namlu parlaması
  if (S.shootCd > 0) S.shootCd -= dt;
  if (S.equip && shootDown && !placeMode && S.shootCd <= 0) inp.shoot = true;
  if (inp.shoot) { inp.shoot = false; if (!placeMode) doShoot(); }
  if (muzzle && muzzle.visible) { muzzleT -= dt; if (muzzleT <= 0) muzzle.visible = false; else { camera.getWorldDirection(_fwd); muzzle.position.set(camera.position.x + _fwd.x * 0.7, camera.position.y + _fwd.y * 0.7 - 0.12, camera.position.z + _fwd.z * 0.7); } }

  // HAVA DURUMU + ŞİMŞEK
  S.weatherT -= dt;
  if (S.weatherT <= 0) {
    const was = S.weather; S.weather = Math.random() < ((night ? 0.42 : 0.18) + (S.bloodMoon ? 0.2 : 0)) ? "rain" : "clear"; S.weatherT = rnd(40, 95);
    if (rain) rain.visible = (S.weather === "rain");
    if (S.weather === "rain" && was !== "rain") toast("🌧️ Yağmur başladı — ateş çabuk söner, üşürsün", "bad");
    else if (S.weather === "clear" && was === "rain") toast("🌤️ Yağmur dindi", "good");
  }
  if (S.weather === "rain") {
    updateRain(dt);
    S.rainSndT -= dt; if (S.rainSndT <= 0) { Sound.rainTick(); S.rainSndT = rnd(0.04, 0.12); }
    S.lightT = (S.lightT == null ? rnd(6, 16) : S.lightT) - dt;
    if (S.lightT <= 0) { S.flash = 1; Sound.thunder(); S.lightT = rnd(9, 24); if (!(S.hasLightningRod && inCampSafe())) { S.sanity = clamp(S.sanity - 2, 0, 100); if (night && !watcher && Math.random() < 0.45) spawnWatcher(true); } }   // paratoner üste şimşek etkisini engeller
  } else if (rain && rain.visible) rain.visible = false;
  if (S.flash > 0) S.flash = Math.max(0, S.flash - dt * 2.6);

  // tarlalar (otomatik yiyecek) + petrol sondajı (ateşi besler) + meşale alev kıpırtısı
  for (const fm of farms) { fm.t += dt; if (fm.t >= 95) { fm.t = 0; S.inv.cooked++; toast("🌱 Tarladan +1 🍗 yiyecek", "good"); for (const sp of fm.sprouts) sp.scale.setScalar(0.4); } else { const gr = 0.4 + (fm.t / 95) * 0.9; for (const sp of fm.sprouts) sp.scale.setScalar(gr); } }
  if (S.oilDrills > 0 && baseFire) baseFire.fuel = Math.min(baseFire.fuel + S.oilDrills * 2.2 * dt, baseFire.max);
  for (const tr of torches) if (tr.flame) tr.flame.scale.setScalar(0.85 + Math.random() * 0.25);
  // kristal parıltısı (nabız) + koruyucu totem aurası (sanity yenileme)
  { const pulse = 0.6 + Math.sin(performance.now() / 380) * 0.35; for (const c of crystals) if (!c.mined && c.mat) c.mat.emissiveIntensity = pulse; }
  for (const tm of totems) { if (Math.hypot(tm.x - camera.position.x, tm.z - camera.position.z) < tm.r) { S.sanity = clamp(S.sanity + 2.2 * dt, 0, 100); break; } }
  // YAPI AŞINMASI: duvarlar/kapılar zamanla (fırtınada hızlı) çürür; çekiçle tamir edilmezse yıkılır
  { const decay = (S.weather === "rain" ? 0.7 : 0.12) * (isNight() ? 1.25 : 1);
    for (let i = walls.length - 1; i >= 0; i--) { const w = walls[i]; if (w.hp == null) continue; w.hp -= decay * dt;
      if (w.group) w.group.rotation.z = (1 - clamp(w.hp / (w.maxhp || 100), 0, 1)) * 0.16;
      if (w.hp <= 0) { scene.remove(w.group); walls.splice(i, 1); toast("🧱 Bir duvar çürüyüp yıkıldı — 🔨 çekiçle tamir et!", "bad"); } } }
  // zehir / yanma hasarı (zehirli mızrak, cehennem kılıcı)
  for (let i = animals.length - 1; i >= 0; i--) { const a = animals[i]; let dd = 0; if (a.poison > 0) { a.poison -= dt; dd += 2.5 * dt; } if (a.burn > 0) { a.burn -= dt; dd += 3.8 * dt; } if (dd > 0) { a.hp -= dd; if (a.hp <= 0) killAnimal(a, (a.burn || 0) > 0); } }
  // el feneri: önümüzü aydınlatır, pili tüketir
  if (S.flashOn && S.battery > 0) {
    S.battery = Math.max(0, S.battery - 3.2 * dt);
    if (!flashLight) { flashLight = new THREE.PointLight(0xfff2d8, 0, 24, 1.3); scene.add(flashLight); }
    flashLight.intensity = 2.6;
    camera.getWorldDirection(_fwd); flashLight.position.set(camera.position.x + _fwd.x * 3.6, camera.position.y + _fwd.y * 3.6 + 0.2, camera.position.z + _fwd.z * 3.6);
    if (S.battery <= 0) { S.flashOn = false; toast("🔋 Pil bitti! (yeni pil tak)", "bad"); }
  } else if (flashLight) flashLight.intensity = 0;
  // biyom atmosfer parçacıkları (kar düşer / kül yükselir / ışıltı süzülür)
  if (biomeFX) {
    const bz = BIOMES[curBiome], on = !!(bz.cold || bz.heat || bz.fairy), mat = biomeFX.material;
    mat.opacity = lerp(mat.opacity, on ? 0.6 : 0, on ? 0.06 : 0.1);
    if (mat.opacity < 0.02) biomeFX.visible = false;
    else {
      biomeFX.visible = true; biomeFX.position.set(camera.position.x, 0, camera.position.z);
      const rise = curBiome === "volcanic", drift = curBiome === "fairy";
      const vy = (rise ? 7 : drift ? 1.2 : -9) * dt;
      const pa = biomeFX.geometry.attributes.position, ar = pa.array;
      for (let i = 1; i < ar.length; i += 3) { ar[i] += vy + (drift ? Math.sin(performance.now() / 500 + i) * 0.5 * dt : 0); if (rise || drift) { if (ar[i] > 30) ar[i] = 0; } else if (ar[i] < 0) ar[i] = 30; }
      pa.needsUpdate = true;
      if (mat.color && mat.color.setHex) mat.color.setHex(rise ? 0xff7a3c : drift ? 0xffb0f2 : 0xffffff);
      mat.size = curBiome === "snow" ? 0.3 : drift ? 0.26 : 0.2;
    }
  }

  // ateşler (üs ateşi KALICI — sönse bile odun/taşlar kalır, yeniden beslenir)
  let nearFire = false, fireDist = 1e9;
  for (let i = fires.length - 1; i >= 0; i--) {
    const f = fires[i]; f.fuel = Math.max(0, f.fuel - dt * (night ? 2.4 : 3.2) * (1 - (f.level - 1) * 0.13) * (S.weather === "rain" ? 1.6 : 1));   // yüksek seviye yavaş yanar
    const lit = f.fuel > 0;
    if (!lit && !f.warned) { f.warned = true; toast("🪵 Ateş söndü! Odun ekle (F)", "bad"); }
    if (lit) f.warned = false;
    const flick = lit ? 0.85 + Math.sin(performance.now() / 70 + i) * 0.15 + Math.random() * 0.1 : 0, ls = 0.8 + f.level * 0.25;
    f.light.intensity = lit ? map(f.fuel, 0, f.max, 0.7, 2.6) * flick * (0.8 + f.level * 0.3) : 0;
    f.light.distance = map(f.fuel, 0, f.max, 8, 17) * (0.8 + f.level * 0.25);
    for (const fl of [f.flame, f.flame2, f.halo, f.core]) if (fl) fl.visible = lit;
    if (lit) { f.flame.scale.set(flick * ls, (0.7 + flick * 0.5) * ls, flick * ls); f.flame.rotation.y += dt * 3; f.flame2.scale.set(flick * 0.9 * ls, (0.6 + flick * 0.6) * ls, flick * 0.9 * ls); f.flame2.rotation.y -= dt * 4; }
    // yakıt barı: doluluk + kameraya dön
    if (f.bar) { f.bar.visible = true; f.barFill.scale.x = clamp(f.fuel / f.max, 0.001, 1); f.barFill.position.x = -(1 - f.barFill.scale.x) * 0.71; const bc = f.barFill.material.color; if (bc && bc.setHex) bc.setHex(f.fuel / f.max > 0.3 ? 0xff8a2a : 0xd83020); f.bar.rotation.y = Math.atan2(camera.position.x - f.x, camera.position.z - f.z); }
    if (f.embers) { f.embers.visible = lit; if (lit) { const pa = f.embers.geometry.attributes.position, ar = pa.array; for (let k = 0; k < f.ev.length; k++) { ar[k * 3 + 1] += f.ev[k] * dt; if (ar[k * 3 + 1] > 2.6) { ar[k * 3] = rnd(-0.2, 0.2); ar[k * 3 + 1] = 0.3; ar[k * 3 + 2] = rnd(-0.2, 0.2); } } pa.needsUpdate = true; } }
    const d = Math.hypot(f.x - camera.position.x, f.z - camera.position.z); if (lit && d < f.safeR * 0.55) { nearFire = true; fireDist = Math.min(fireDist, d); }
  }
  if (nearFire) { S.fireCrackleT -= dt; if (S.fireCrackleT <= 0) { Sound.crackle(); S.fireCrackleT = rnd(0.08, 0.3); } }
  // pişirme
  if (nearFire && fireDist < 5 && S.inv.raw > 0) { S.cookT += dt; if (S.cookT >= 3.5) { S.cookT = 0; S.inv.raw--; S.inv.cooked++; toast("🍗 Et pişti", "good"); } } else S.cookT = 0;

  // hayatta kalma
  { const df = S.diff || 1;   // 🎚️ zorluk: açlık/susuzluk tüketimi
    S.hunger = clamp(S.hunger - 0.42 * df * dt, 0, 100);
    S.thirst = clamp(S.thirst - (sprinting ? 0.75 : 0.5) * df * dt, 0, 100); }   // koşunca daha çok susarsın
  if (nearFire) S.warmth = clamp(S.warmth + 9 * dt, 0, 100);
  else if (night) S.warmth = clamp(S.warmth - 1.25 * dt, 0, 100);
  else S.warmth = clamp(S.warmth - 0.18 * dt, 0, 100);
  if (S.weather === "rain" && !nearFire) S.warmth = clamp(S.warmth - 0.9 * dt, 0, 100);   // yağmurda üşürsün
  if (nearFire) S.sanity = clamp(S.sanity + (night ? 1.0 : 2.2) * dt, 0, 100);
  if (graveyard && night && !S.inMine && Math.hypot(camera.position.x - graveyard.x, camera.position.z - graveyard.z) < 24) {   // 🪦 mezarlıkta gece: akıl erir + fısıltılar
    S.sanity = clamp(S.sanity - 1.5 * dt, 0, 100);
    if (Math.random() < 0.004) { whisperText(choice(["mezarlar boş değil...", "burada yatanlar uyumaz", "gitme", "seni bekliyorduk", "toprağın altı soğuk"])); Sound.whisper(); }
  }
  else if (night) S.sanity = clamp(S.sanity - 0.85 * dt, 0, 100);
  else S.sanity = clamp(S.sanity + 0.3 * dt, 0, 100);
  // BİYOM İKLİMİ: kar üşütür, volkan kavurur (sıcak hasarı + susuzluk), peri huzur verir
  { const bz = BIOMES[curBiome];
    if (bz.cold && !nearFire) S.warmth = clamp(S.warmth - 2.2 * dt, 0, 100);
    if (bz.heat) { S.warmth = clamp(S.warmth + 8 * dt, 0, 100); S.thirst = clamp(S.thirst - 1.4 * dt, 0, 100); S.health = clamp(S.health - 1.1 * dt, 0, 100); if (S.health < 30) S.deathReason = "aşırı sıcak / lav"; }
    if (bz.fairy) S.sanity = clamp(S.sanity + 0.8 * dt, 0, 100);
  }

  let dmg = 0;
  if (S.hunger <= 0) { dmg += 2.0; S.deathReason = "açlık"; }
  if (S.thirst <= 0) { dmg += 1.8; S.deathReason = "susuzluk"; }
  if (S.warmth <= 0) { dmg += 1.5; S.deathReason = "soğuk"; }
  if (S.sanity <= 0) { dmg += 2.5; S.deathReason = "delirme"; }
  if (dmg > 0) S.health = clamp(S.health - dmg * dt, 0, 100);
  else if (S.hunger > 40 && S.warmth > 40 && S.sanity > 25 && S.thirst > 40 && S.sick <= 0) S.health = clamp(S.health + 0.8 * dt, 0, 100);
  if (S.health <= 0) { playerDied(S.deathReason || "bilinmeyen"); if (S.over || S.downed) return; }

  // korku — İzleyen (jumpscare YALNIZCA yaratık seni yakalayınca gelir — rastgele jumpscare kaldırıldı)
  updateWatcher(dt, night);
  // ÖZEL DEHŞET: ekrana yumruk atan kanlı kadın + sahte sistem bozulması (nadir; gece + ilerleyen günlerde)
  S.glitchCd -= dt;
  if (night && glitch == null && S.glitchCd <= 0 && S.day >= 3 && Math.random() < (0.0008 + dread * 0.004)) { triggerGlitchScare(); S.glitchCd = rnd(120, 260); }
  // OPSİYONEL KAMERA KORKUSU (yalnızca izin verildiyse): görüntünü çarpık/kanlı gösterir
  camScareCd -= dt;
  if (camEnabled && night && glitch == null && camScare == null && S.day >= 2 && camScareCd <= 0 && Math.random() < (0.0006 + dread * 0.003)) { triggerCamScare(); camScareCd = rnd(90, 200); }
  // gün geçtikçe artan ORTAM DEHŞETİ (fısıltı / hırıltı / kalp / titreme) — sadece jumpscare değil
  if (night) {
    S.dreadT = (S.dreadT == null ? rnd(6, 12) : S.dreadT) - dt;
    if (S.dreadT <= 0) {
      S.dreadT = rnd(7, 16) * (1 - dread * 0.5);
      if (Math.random() < 0.35 + dread * 0.5) {
        const ev = rndi(0, 3);
        if (ev === 0) { const nm = (account && account.user) ? account.user : ""; whisperText(choice(["arkanda", "seni görüyorum", "kaç", "100 gün... hayır", nm ? nm + "..." : "yaklaşıyor", nm ? nm + ", ışığı söndürme" : "ışığı söndür"])); Sound.whisper(); }
        else if (ev === 1) Sound.growl();
        else if (ev === 2) { S.heartLevel = Math.max(S.heartLevel, 0.9); Sound.thump(); }
        else { S.shake = Math.max(S.shake, 0.25); Sound.whoosh(); }
        if (dread > 0.5 && Math.random() < dread - 0.4) S.sanity = clamp(S.sanity - 4, 0, 100);
      }
    }
  }
  // İlk gece: yalnızca atmosfer (fısıltı + kalp sesi) — jumpscare YOK. Jumpscare sadece yaratık yakalayınca.
  if (night && S.day === 1 && !S.scripted && S.time > 0.80) { S.scripted = true; setTimeout(() => { if (S.running) { whisperText("burada yalnız değilsin..."); Sound.whisper(); S.heartLevel = Math.max(S.heartLevel, 0.7); S.shake = Math.max(S.shake, 0.2); } }, rndi(3000, 8000)); }
  if (jumpT > 0) { jumpT -= dt; if (jumpT <= 0 && jumpModel) {   // jumpscare bitince yaratık modelini temizle (co-op'ta oyun sürdüğü için şart)
    jumpModel.visible = false; if (jumpModel.scale) jumpModel.scale.setScalar(1);
    if (jumpModel !== watcherGroup && jumpModel.parent) jumpModel.parent.remove(jumpModel);   // taklitçi vb. sahneden kaldır (İzleyen kalıcı grup, sadece gizle)
    jumpModel = null; if (jumpLight) { jumpLight.visible = false; jumpLight.intensity = 0; }
  } }

  // gece jaguarı
  if (night && S.day > 1 && Math.random() < 0.0009 && animals.filter((a) => a.type === "jaguar").length < 2) { spawnJaguar(); Sound.growl(); whisperText("bir hırıltı..."); }
  // SÜRÜNEN — gece avcısı (gün geçtikçe + kanlı ayda daha çok)
  if (night && S.day >= 2 && Math.random() < (0.0007 + dread * 0.0014) && animals.filter((a) => a.type === "crawler").length < (S.bloodMoon ? 3 : 2)) { spawnCrawler(); Sound.growl(); whisperText(choice(["sürünüyor...", "duydun mu?", "çok ayak sesi"])); }
  // TAKLİTÇİ — artık SADECE mağarada gelir (yeraltı yaratığı); arkadaş gibi durup yaklaşınca saldırır
  if (inCave && S.day >= 2 && Math.random() < 0.0013 && !animals.some((a) => a.type === "mimic")) spawnMimic();
  // PUSUCU (gün ≥3): ağaca gizlenir
  if (night && S.day >= 3 && Math.random() < (0.0005 + dread * 0.001) && animals.filter((a) => a.type === "lurker").length < 2) spawnLurker();
  // SÜRÜ (gün ≥4 / kanlı ay): hızlı yavrular dalga halinde
  if (night && (S.day >= 4 || S.bloodMoon) && Math.random() < (0.00035 + dread * 0.0009) && !animals.some((a) => a.type === "pup")) spawnPack();
  // BİYOM YARATIKLARI (bulunduğun bölgeye göre)
  if (curBiome === "snow" && Math.random() < 0.0011 && animals.filter((a) => a.type === "polarbear").length < 2) { spawnBeast("polarbear"); Sound.growl(); }
  if (curBiome === "volcanic" && Math.random() < 0.0013 && animals.filter((a) => a.type === "lavabeast").length < 3) spawnBeast("lavabeast");
  if (curBiome === "fairy" && night && Math.random() < 0.0015 && animals.filter((a) => a.type === "fairy").length < 4) { spawnBeast("fairy"); whisperText(choice(["ışıklar...", "bizimle kal", "kaçamazsın"])); }
  if (curBiome === "volcanic" && S.day >= 8 && !bossAlive && Math.random() < 0.0006) spawnCultistKing();
  // MAĞARA: örümcekler (her zaman, karanlıkta sıkıştırır)
  if (inCave && Math.random() < 0.0020 && animals.filter((a) => a.type === "spider").length < 5) spawnBeast("spider");
  // DERİN MADEN: biraz daha örümcek baskısı + ürkütücü fısıltılar + Maden Kraliçesi (linger yaparsan uyanır)
  if (S.inMine) {
    if (Math.random() < 0.0010 && animals.filter((a) => a.type === "spider").length < 6) spawnBeast("spider");
    if (Math.random() < 0.0035) { whisperText(choice(["ışığı söndürme", "duydun mu?", "yaklaşıyor", "kaz... kaz...", "yalnız değilsin"])); Sound.whisper(); }
    if (!bossAlive && Math.random() < 0.0005) spawnMineQueen();   // ~ yarım dakika sonra uyanabilir
  }

  updateAnimals(dt);

  // ağaca asılan kamera fotoğrafları yaşlanıp solar
  for (let i = photos.length - 1; i >= 0; i--) { const p = photos[i]; p.t -= dt; if (p.t < 4) p.mat.opacity = Math.max(0, p.t / 4); if (p.t <= 0) { scene.remove(p.mesh); photos.splice(i, 1); } }

  // ağaç regrow
  for (let i = 0; i < trees.length; i++) { const t = trees[i]; if (t.regrow > 0) { t.regrow -= dt; if (t.regrow <= 0) { t.alive = true; t.hp = 4; writeTree(i); treesNeedUpdate(); } } }

  // ışık / atmosfer (gündüz-gece)
  const dk = darknessFor(S.time);
  const dayK = 1 - dk;
  const sunAng = S.time * Math.PI * 2 - Math.PI / 2;
  const sdx = Math.cos(sunAng), sdy = Math.max(0.25, Math.sin(sunAng));
  sun.intensity = dayK * 1.25;
  sun.position.set(camera.position.x + sdx * 70, sdy * 90 + 18, camera.position.z + 40); // gölge kamerası oyuncuyu takip etsin
  sun.target.position.copy(camera.position);
  moon.intensity = dk * 0.16;                                 // gece neredeyse zifiri — sadece soluk silüet
  hemi.intensity = lerp(0.012, 0.95, dayK) * (S.weather === "rain" ? 0.6 : 1) + S.flash * 1.6; // yağmur karartır, şimşek aydınlatır
  amb.intensity = lerp(0.012, 0.5, dayK) * (S.weather === "rain" ? 0.7 : 1) + S.flash * 1.3;
  headlamp.intensity = lerp(0.0, 1.0, dk); headlamp.position.copy(camera.position); // meşale/fenerin dar ışığı
  const dayCol = new THREE.Color(0x9fb7a0), nightCol = new THREE.Color(0x05080f);
  const skyCol = nightCol.clone().lerp(dayCol, dayK);
  const golden = Math.max(0, 1 - Math.abs(S.time - 0.16) / 0.10) + Math.max(0, 1 - Math.abs(S.time - 0.63) / 0.08);
  if (golden > 0) skyCol.lerp(new THREE.Color(0xd98a4a), Math.min(golden, 1) * 0.5);  // şafak/akşam altın tonu
  if (S.bloodMoon && dk > 0.4) skyCol.lerp(new THREE.Color(0x3a0608), 0.6);   // KANLI AY -> kırmızı sis/gökyüzü
  if (S.weather === "rain") skyCol.lerp(new THREE.Color(0x2a3038), 0.5);      // yağmurda gri-mavi
  if (S.flash > 0) skyCol.lerp(new THREE.Color(0xcdd6e6), S.flash * 0.7);     // şimşek beyazı
  if (curBiome !== "forest") skyCol.lerp(new THREE.Color(BIOMES[curBiome].fog), 0.4 * dayK + 0.2);   // biyom atmosfer tonu (gündüz daha belirgin)
  if (inCave) { skyCol.lerp(new THREE.Color(0x040404), 0.94); hemi.intensity = 0.03; amb.intensity = 0.04; sun.intensity = 0; moon.intensity = 0; headlamp.intensity = 0.12; }   // MAĞARA: zifiri karanlık — el feneri/meşale şart
  scene.background = skyCol; scene.fog.color = skyCol;
  scene.fog.density = inCave ? 0.09 : lerp(0.013, 0.12, dk) * (S.weather === "rain" ? 1.5 : 1);   // mağarada/gece yoğun sis; yağmur daha da kapatır
  updateSky(dk, dayK, skyCol, sunAng);          // gradyan gökyüzü + yıldız + ay + güneş parıltısı
  windU.value = performance.now() / 1000;        // bitki rüzgârı
  if (waterTex) { waterTex.offset.x = windU.value * 0.02; waterTex.offset.y = Math.sin(windU.value * 0.3) * 0.04; }   // su parıltısı
  if (waterNrm && waterNrm.offset) { waterNrm.offset.x = -windU.value * 0.03; waterNrm.offset.y = windU.value * 0.018; }   // kayan dalga kabartması
  if (waterMat) { waterMat.emissiveIntensity = 0.3 + Math.sin(windU.value * 1.6) * 0.18; }   // yüzey parıltı nabzı
  // toz/polen zerreleri (gündüz)
  if (motes) {
    motes.material.opacity = dayK * (S.weather === "rain" ? 0.05 : 0.5); motes.position.set(camera.position.x, 0, camera.position.z);
    const ph = motes.userData.ph, ar = motes.geometry.attributes.position.array, tt = windU.value;
    for (let k = 0; k < ph.length; k++) { ar[k * 3] += Math.sin(tt * 0.3 + ph[k]) * 0.004; ar[k * 3 + 1] += Math.cos(tt * 0.2 + ph[k]) * 0.003; }
    motes.geometry.attributes.position.needsUpdate = true;
  }
  // ateş böcekleri (gece görünür, hafif salınır)
  if (fireflies) {
    fireflies.material.opacity = dk * 0.9; fireflies.position.set(camera.position.x, 0, camera.position.z);
    if (dk > 0.2) { const pa = fireflies.geometry.attributes.position, ar = pa.array, ph = fireflies.userData.phase, tt = performance.now() / 1000; for (let k = 0; k < ph.length; k++) ar[k * 3 + 1] = 2.6 + Math.sin(tt * 0.8 + ph[k]) * 1.8; pa.needsUpdate = true; }
  }

  // kalp atışı
  let hl = (1 - S.sanity / 100) * 0.8;
  if (watcher) hl = Math.max(hl, map(Math.hypot(watcher.x - camera.position.x, watcher.z - camera.position.z), 4, 30, 1, 0.2));
  for (const a of animals) if (a.hostile && Math.hypot(a.x - camera.position.x, a.z - camera.position.z) < 16) hl = Math.max(hl, 0.7);
  if (S.inMine) hl = Math.max(hl, 0.34);   // derin madende sabit düşük gerilim (kalp atışı)
  S.heartLevel = lerp(S.heartLevel, hl, 0.1);
  if (S.heartLevel > 0.16) { S.heart -= dt; if (S.heart <= 0) { Sound.thump(); S.heart = lerp(1.1, 0.32, S.heartLevel); } }

  if (whisperT > 0) whisperT -= dt;

  // co-op: kendi durumunu yayınla (host saat/günü de gönderir → senkron) + uzak oyuncuları yumuşat
  if (net.online) {
    S.netT = (S.netT || 0) - dt;
    if (S.netT <= 0) { S.netT = 0.1; net.broadcast({ t: "state", x: camera.position.x, z: camera.position.z, yaw: yaw, day: S.day, time: S.time, hp: Math.round(S.health), downed: !!S.downed, host: net.host }); }
  }
  lerpRemotes(dt);
  updateBirds(dt);

  updateHUD(night);
}

function inCampSafe() {   // yanan ateş VEYA meşale güvenli alanı içinde miyiz?
  const px = camera.position.x, pz = camera.position.z;
  for (const f of fires) { if (f.fuel > 0 && Math.hypot(f.x - px, f.z - pz) < (f.safeR || 11)) return true; }
  for (const t of torches) { if (Math.hypot(t.x - px, t.z - pz) < t.safeR) return true; }
  for (const t of totems) { if (Math.hypot(t.x - px, t.z - pz) < t.r) return true; }
  return false;
}
function updateWatcher(dt, night) {
  if (admin.noAI) return;   // 🧠❌ Disable AI: İzleyen donar
  const dread = dreadLevel();
  const safe = inCampSafe();
  if (watcher && (S.downed || S.over)) { vanishWatcher(true); wCd = rnd(8, 16); return; }   // düşünce/ölünce İzleyen geri çekilir (sahnede dev gibi takılı kalmasın)
  if (!watcher) {
    wCd -= dt;
    if (wCd <= 0) {
      if (!night) { wCd = rnd(3, 6); return; }            // SADECE GECE gelir (sabah/gündüz gelmez)
      if (safe) { wCd = rnd(4, 8); return; }               // ATEŞİN yanındaysan gelmez (korunursun)
      let chance = 0.9 * (1 + (1 - S.sanity / 100));
      if (!S.firstNightDone) chance = 1;
      if (Math.random() < chance) { spawnWatcher(false); S.firstNightDone = true; } else wCd = rnd(4, 9);
    }
    return;
  }
  const w = watcher; w.alpha = Math.min(w.alpha + dt * 1.5, 1);
  if (safe) { vanishWatcher(true); wCd = rnd(6, 12); return; }   // ateşe ulaştın -> korundun, kaybolur
  // ÜSTÜNE KOŞMA: kameraya hızla yaklaşıp büyür, sonra jumpscare patlar
  if (w.lunge != null) {
    w.lunge -= dt;
    w.x += (camera.position.x - w.x) * Math.min(1, dt * 6);
    w.z += (camera.position.z - w.z) * Math.min(1, dt * 6);
    w.group.position.set(w.x, Math.sin(performance.now() / 35) * 0.06, w.z);
    w.group.rotation.y = Math.atan2(camera.position.x - w.x, camera.position.z - w.z);
    w.group.scale.setScalar(1 + (0.5 - Math.max(0, w.lunge)) * 3.0);   // ekranı kaplayacak kadar büyür
    S.shake = 0.7;
    if (w.lunge <= 0) { catchKill(w.group, "İzleyen seni yakaladı"); watcher = null; wCd = rnd(20, 34); return; }   // yakaladı → tek vuruş + jumpscare; İzleyen AI'sını durdur (grup jumpscare için kalır)
    return;
  }
  const d = Math.hypot(w.x - camera.position.x, w.z - camera.position.z);
  // bakıyor mu? -> kafayı ekran düzlemine projekte et
  const v = new THREE.Vector3(w.x, 3.7, w.z).project(camera);
  const onScreen = v.z < 1 && Math.hypot(v.x, v.y) < 0.33;
  const looking = onScreen && d < 50;
  if (looking) {
    w.seen += dt;
    if (w.seen > 0.32) { vanishWatcher(false); S.sanity = clamp(S.sanity - 6, 0, 100); wEnc++; return; }
  } else {
    w.seen = Math.max(0, w.seen - dt * 0.6);
    S.sanity = clamp(S.sanity - map(d, 4, 30, 16, 1.5) * (1 + dread) * dt, 0, 100);
    // BAKMIYORSAN ÜSTÜNE GELİR — gün geçtikçe daha hızlı
    if (d > 3.5) { const ang = Math.atan2(camera.position.z - w.z, camera.position.x - w.x); const sp = map(d, 5, 45, 1.4, 4.2) * (1 + dread * 1.4); w.x += Math.cos(ang) * sp * dt; w.z += Math.sin(ang) * sp * dt; }
    // YETERİNCE YAKLAŞTIYSA SALDIRIR (artık sadece izlemiyor — üstüne atılır)
    else if (w.lunge == null) { w.lunge = 0.45; Sound.growl(); whisperText("KOŞ!"); }
  }
  // konum + bakış + hafif süzülme
  w.x = clamp(w.x, -CFG.WORLD, CFG.WORLD); w.z = clamp(w.z, -CFG.WORLD, CFG.WORLD);
  w.group.position.set(w.x, Math.sin(performance.now() / 700) * 0.05, w.z);
  w.group.rotation.y = Math.atan2(camera.position.x - w.x, camera.position.z - w.z);
  w.life -= dt;
  if (d > 70) { vanishWatcher(true); wCd = rnd(5, 10); return; }
  if (w.life <= 0) {
    if (d < 11) { w.lunge = 0.5; Sound.growl(); whisperText("KOŞ!"); }   // yakınsa üstüne koşar (saldırı)
    else if (Math.random() < 0.6) { spawnWatcher(true); whisperText(choice(["daha yakın", "kıpırdama", "arkanda"])); }
    else vanishWatcher(true);
  }
}

function updateAnimals(dt) {
  if (admin.noAI) return;   // 🧠❌ Disable AI: yaratıklar/hayvanlar donar
  const px = camera.position.x, pz = camera.position.z;
  for (let i = animals.length - 1; i >= 0; i--) {
    const a = animals[i], d = Math.hypot(a.x - px, a.z - pz);
    if (a.atkCd > 0) a.atkCd -= dt;
    if (a.slow > 0) a.slow -= dt;   // buz baltası yavaşlatması
    if (a.group.userData.mixer) a.group.userData.mixer.update(dt);   // GLB animasyon klibi (jaguar/boar/…)
    if (a.type === "jaguar") {
      let fearFire = false; for (const f of fires) if (Math.hypot(a.x - f.x, a.z - f.z) < (f.safeR ? f.safeR - 4 : 7)) fearFire = true;
      if (fearFire && fires.length) { const f = fires[0]; a.dir = Math.atan2(a.z - f.z, a.x - f.x); }
      else if (d < 38) a.dir = Math.atan2(pz - a.z, px - a.x);
      let sp = d < 38 && !fearFire ? 7 : 3;
      // sıçrayarak saldırı (atılım): yakınken hamle başlat
      if (d < 6 && d > 2 && a.atkCd <= 0 && a.pounce <= 0 && !fearFire) { a.pounce = 0.42; a.atkCd = 1.6; Sound.growl(); }
      if (a.pounce > 0) { a.pounce -= dt; sp = 16; }    // atılım sırasında ileri fırlar
      a.x += Math.cos(a.dir) * sp * dt; a.z += Math.sin(a.dir) * sp * dt;
      if (d < 2.4 && a.bite <= 0) { hurt(11); S.hurt = 0.45; S.shake = 0.45; a.bite = 1.2; Sound.growl(); S.deathReason = "jaguar saldırısı"; if (S.health <= 0) { playerDied("jaguar saldırısı"); return; } }
      if (a.bite > 0) a.bite -= dt;
      if (!isNight() && d > 45) { scene.remove(a.group); animals.splice(i, 1); continue; }
    } else if (a.type === "crawler") {                         // SÜRÜNEN — hızlı gece avcısı, ateşten korkar
      let fearFire = false; for (const f of fires) if (Math.hypot(a.x - f.x, a.z - f.z) < (f.safeR ? f.safeR - 3 : 8)) fearFire = true;
      if (fearFire && fires.length) { const f = fires[0]; a.dir = Math.atan2(a.z - f.z, a.x - f.x); }
      else a.dir = Math.atan2(pz - a.z, px - a.x);
      const sp = fearFire ? 5 : 8 + dreadLevel() * 3;
      a.x += Math.cos(a.dir) * sp * dt; a.z += Math.sin(a.dir) * sp * dt;
      if (d < 2.2 && a.bite <= 0) { hurt(9); S.sanity = clamp(S.sanity - 6, 0, 100); S.hurt = 0.5; S.shake = 0.5; a.bite = 1.1; Sound.screech(); S.deathReason = "ormandaki şey"; if (S.health <= 0) { playerDied("ormandaki şey"); return; } }
      if (a.bite > 0) a.bite -= dt;
      if (!isNight() && d > 14) { scene.remove(a.group); animals.splice(i, 1); continue; }  // gündüz dağılır
    } else if (a.type === "mimic") {                            // TAKLİTÇİ — arkadaş taklidi, yaklaşınca atılır
      a.dir = Math.atan2(pz - a.z, px - a.x);
      if (a.bite > 0) a.bite -= dt;
      if (d < 4.8 && a.bite <= 0) {                             // maske düşer → YAKALAR: tek vuruş + jumpscare (taklitçinin kendisi)
        if (a.group.userData.eyeMat) a.group.userData.eyeMat.emissiveIntensity = 4;
        catchKill(a.group, "Taklitçi seni yakaladı"); animals.splice(i, 1); return;
      }
      a.x += Math.cos(a.dir) * 0.7 * dt; a.z += Math.sin(a.dir) * 0.7 * dt;   // yavaşça yaklaşır (tuhaf)
      if (!isNight() || d > 40) { scene.remove(a.group); animals.splice(i, 1); continue; }
    } else if (a.type === "lurker") {                          // PUSUCU — ağaçta bekler, yaklaşınca fırlar
      if (a.state === "hide") {
        a.x = a.homeX; a.z = a.homeZ; a.dir = Math.atan2(pz - a.z, px - a.x);
        if (d < 6) { a.state = "ambush"; Sound.screech(); whisperText("ağaçtan!"); }
      } else {
        let fearFire = false; for (const f of fires) if (Math.hypot(a.x - f.x, a.z - f.z) < (f.safeR ? f.safeR - 3 : 8)) fearFire = true;
        a.dir = fearFire ? Math.atan2(a.z - camera.position.z, a.x - camera.position.x) : Math.atan2(pz - a.z, px - a.x);
        a.x += Math.cos(a.dir) * (fearFire ? 4 : 9) * dt; a.z += Math.sin(a.dir) * (fearFire ? 4 : 9) * dt;
        if (a.bite > 0) a.bite -= dt;
        if (d < 2.1 && a.bite <= 0) { hurt(10); S.sanity = clamp(S.sanity - 5, 0, 100); S.hurt = 0.5; S.shake = 0.5; a.bite = 1.3; a.hits = (a.hits || 0) + 1; Sound.growl(); S.deathReason = "pusucu"; if (S.health <= 0) { playerDied("pusucu"); return; } }
        if ((a.hits || 0) >= 2 || d > 30) { scene.remove(a.group); animals.splice(i, 1); continue; }   // vurup kaçar
      }
      if (!isNight()) { scene.remove(a.group); animals.splice(i, 1); continue; }
    } else if (a.type === "pup") {                             // SÜRÜ yavrusu — hızlı, zayıf, kalabalık
      let fearFire = false; for (const f of fires) if (Math.hypot(a.x - f.x, a.z - f.z) < (f.safeR ? f.safeR - 4 : 6)) fearFire = true;
      a.dir = fearFire ? Math.atan2(a.z - camera.position.z, a.x - camera.position.x) : Math.atan2(pz - a.z, px - a.x);
      a.x += Math.cos(a.dir) * (fearFire ? 4 : 7.5) * dt; a.z += Math.sin(a.dir) * (fearFire ? 4 : 7.5) * dt;
      if (a.bite > 0) a.bite -= dt;
      if (d < 1.8 && a.bite <= 0) { hurt(4); S.hurt = 0.35; S.shake = 0.25; a.bite = 1.0; Sound.chop(); S.deathReason = "sürü"; if (S.health <= 0) { playerDied("sürü saldırısı"); return; } }
      if (!isNight() && d > 12) { scene.remove(a.group); animals.splice(i, 1); continue; }
    } else if (BEAST[a.type]) {                                // BİYOM YARATIKLARI + boss (kutup ayısı / lav / peri / cultist)
      const B = BEAST[a.type];
      let fearFire = false; if (B.fearFire) for (const f of fires) if (f.fuel > 0 && Math.hypot(a.x - f.x, a.z - f.z) < (f.safeR || 8)) fearFire = true;
      a.dir = fearFire ? Math.atan2(a.z - pz, a.x - px) : Math.atan2(pz - a.z, px - a.x);
      const spd = (fearFire ? 4 : B.sp) * (a.slow > 0 ? 0.5 : 1);
      a.x += Math.cos(a.dir) * spd * dt; a.z += Math.sin(a.dir) * spd * dt;
      if (a.bite > 0) a.bite -= dt;
      if (d < B.reach && a.bite <= 0) {
        hurt(B.dmg); if (B.sanity) S.sanity = clamp(S.sanity - B.sanity, 0, 100);
        S.hurt = 0.55; S.shake = Math.max(S.shake, B.boss ? 0.85 : 0.45); a.bite = B.boss ? 1.5 : 1.1; Sound.growl();
        S.deathReason = beastName(a.type); if (S.health <= 0) { playerDied(beastName(a.type)); return; }
      }
      if (!B.boss && (d > B.desp || (B.nightOnly && !isNight()))) { scene.remove(a.group); animals.splice(i, 1); continue; }
    } else if (a.type === "boar" && a.hostile) {
      a.dir = Math.atan2(pz - a.z, px - a.x); a.x += Math.cos(a.dir) * 5.5 * dt; a.z += Math.sin(a.dir) * 5.5 * dt;
      if (d < 2 && a.atkCd <= 0) { hurt(7); S.hurt = 0.4; S.shake = 0.3; a.atkCd = 1.4; S.deathReason = "yaban domuzu"; if (S.health <= 0) { playerDied("yaban domuzu saldırısı"); return; } }
      if (d > 30) a.hostile = false;
    } else {
      if (d < 9 && a.state !== "flee") { a.state = "flee"; a.dir = Math.atan2(a.z - pz, a.x - px) + rnd(-0.4, 0.4); }
      if (a.state === "flee") { a.x += Math.cos(a.dir) * 5 * dt; a.z += Math.sin(a.dir) * 5 * dt; if (d > 22) a.state = "wander"; }
      else { a.t -= dt; if (a.t <= 0) { a.t = rnd(1.5, 4); a.dir = rnd(0, 6.28); a.moving = Math.random() < 0.6; } if (a.moving) { a.x += Math.cos(a.dir) * 1.6 * dt; a.z += Math.sin(a.dir) * 1.6 * dt; } }
    }
    // OYUNCUYA GİRMESİN: atılım dışında bir dur-mesafesi koru (jaguar/domuz içimize giriyordu)
    const STOP = a.type === "jaguar" ? 1.7 : a.type === "crawler" ? 1.5 : a.type === "lurker" && a.state === "ambush" ? 1.4 : a.type === "pup" ? 0.9 : a.type === "boar" && a.hostile ? 1.6 : a.type === "cultist" ? 2.4 : a.type === "queen" ? 2.4 : a.type === "polarbear" ? 1.9 : a.type === "lavabeast" ? 1.7 : a.type === "fairy" ? 1.3 : 0;
    if (STOP && (a.pounce == null || a.pounce <= 0)) {
      const nd = Math.hypot(a.x - px, a.z - pz);
      if (nd < STOP) { const u = nd || 0.001; a.x = px + (a.x - px) / u * STOP; a.z = pz + (a.z - pz) / u * STOP; }
    }
    // barikat duvarları canavarı da durdurur
    for (const w of walls) { const dx = a.x - w.x, dz = a.z - w.z, rr = w.r + 0.4; if (dx * dx + dz * dz < rr * rr) { const dd = Math.hypot(dx, dz) || 0.001; a.x = w.x + dx / dd * rr; a.z = w.z + dz / dd * rr; } }
    // çivili tuzak: üstünden geçen düşman yaralanır
    if (a.hostile) for (const tr of traps) { if (tr.cd > 0) continue; if ((a.x - tr.x) ** 2 + (a.z - tr.z) ** 2 < 0.81) { a.hp -= 7; tr.cd = 1.5; S.shake = Math.max(S.shake, 0.2); Sound.chop(); if (a.hp <= 0) { scene.remove(a.group); animals.splice(i, 1); } break; } }
    if (i >= animals.length || animals[i] !== a) continue;   // tuzakta öldüyse atla
    a.x = clamp(a.x, -CFG.WORLD, CFG.WORLD); a.z = clamp(a.z, -CFG.WORLD, CFG.WORLD);
    const leap = a.pounce > 0 ? Math.sin((1 - a.pounce / 0.42) * Math.PI) * 0.7 : 0;   // sıçrama yayı
    a.group.position.set(a.x, leap, a.z); a.group.rotation.y = -a.dir;
  }
  for (const tr of traps) if (tr.cd > 0) tr.cd -= dt;   // tuzak bekleme süresi
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
function dreadLevel() { return clamp((S.day - 1) / 99, 0, 1) + (S.bloodMoon && isNight() ? 0.35 : 0); }  // gün geçtikçe + kanlı ayda artan korku
function phaseInfo(t) { if (t < 0.07) return ["🌑", "Gece"]; if (t < 0.20) return ["🌅", "Şafak"]; if (t < 0.45) return ["☀️", "Gündüz"]; if (t < 0.54) return ["🌤️", "Öğle"]; if (t < 0.68) return ["🌆", "Akşam"]; return ["🌑", "Gece"]; }

/* ----------------------- HUD ----------------------- */
const bars = { health: $("bar-health"), hunger: $("bar-hunger"), warmth: $("bar-warmth"), sanity: $("bar-sanity"), stamina: $("bar-stamina"), thirst: $("bar-thirst") };
const invEl = { wood: $("inv-wood"), raw: $("inv-raw"), cooked: $("inv-cooked"), metal: $("inv-metal"), pelt: $("inv-pelt"), bandage: $("inv-bandage"), gem: $("inv-gem") };
const mmCanvas = $("minimap"), mmctx = mmCanvas.getContext("2d");
function drawMinimap() {
  const W = mmCanvas.width, H = mmCanvas.height, cx = W / 2, cy = H / 2, R = (S && S.bigMap) ? CFG.WORLD + 10 : 55, sc = (W / 2 - 6) / R;
  mmctx.clearRect(0, 0, W, H);
  const px = camera.position.x, pz = camera.position.z;
  if (!S.inMine) { mmctx.fillStyle = "rgba(70,140,190,.5)"; for (const w of waters) { const dx = w.x - px, dz = w.z - pz; if (dx * dx + dz * dz > R * R) continue; mmctx.beginPath(); mmctx.arc(cx + dx * sc, cy + dz * sc, Math.max(2, w.r * sc), 0, 6.3); mmctx.fill(); } }   // 💧 göller (içilebilir)
  for (const fl of flags) { const dx = fl.x - px, dz = fl.z - pz; if (dx * dx + dz * dz > R * R) continue; mmctx.fillStyle = "#ff3030"; mmctx.beginPath(); mmctx.moveTo(cx + dx * sc, cy + dz * sc - 4); mmctx.lineTo(cx + dx * sc + 4, cy + dz * sc); mmctx.lineTo(cx + dx * sc, cy + dz * sc + 1); mmctx.fill(); }
  { const dx = BENCH.x - px, dz = BENCH.z - pz; if (dx * dx + dz * dz <= R * R) { mmctx.fillStyle = "#caa46a"; mmctx.fillRect(cx + dx * sc - 2, cy + dz * sc - 2, 4, 4); } }
  mmctx.fillStyle = "#2f6b3a";
  for (const t of trees) { if (!t.alive) continue; const dx = t.x - px, dz = t.z - pz; if (dx * dx + dz * dz > R * R) continue; mmctx.fillRect(cx + dx * sc - 1, cy + dz * sc - 1, 2, 2); }
  for (const a of animals) { if (inMineArea(a.x, a.z) !== !!S.inMine) continue; const dx = a.x - px, dz = a.z - pz; if (dx * dx + dz * dz > R * R) continue; mmctx.fillStyle = a.hostile ? "#ff5a4d" : "#d8c060"; mmctx.fillRect(cx + dx * sc - 1.5, cy + dz * sc - 1.5, 3, 3); }
  mmctx.fillStyle = "#9aa0a6"; for (const s of scraps) { if (s.taken || inMineArea(s.x, s.z) !== !!S.inMine) continue; const dx = s.x - px, dz = s.z - pz; if (dx * dx + dz * dz > R * R) continue; mmctx.fillRect(cx + dx * sc - 1, cy + dz * sc - 1, 2, 2); }
  mmctx.fillStyle = "#e0b14a"; for (const c of chests) { if (c.opened || inMineArea(c.x, c.z) !== !!S.inMine) continue; const dx = c.x - px, dz = c.z - pz; if (dx * dx + dz * dz > R * R) continue; mmctx.fillRect(cx + dx * sc - 1.5, cy + dz * sc - 1.5, 3, 3); }
  mmctx.fillStyle = "#ffe08a"; for (const p of pickups) { if (inMineArea(p.x, p.z) !== !!S.inMine) continue; const dx = p.x - px, dz = p.z - pz; if (dx * dx + dz * dz > R * R) continue; mmctx.beginPath(); mmctx.arc(cx + dx * sc, cy + dz * sc, 2, 0, 6.3); mmctx.fill(); }   // yerdeki eşyalar
  mmctx.fillStyle = "#7fe9ff"; for (const c of crystals) { if (c.mined || inMineArea(c.x, c.z) !== !!S.inMine) continue; const dx = c.x - px, dz = c.z - pz; if (dx * dx + dz * dz > R * R) continue; mmctx.fillRect(cx + dx * sc - 1.5, cy + dz * sc - 1.5, 3, 3); }
  if (mineEntrance && !S.inMine) { const dx = mineEntrance.x - px, dz = mineEntrance.z - pz; if (dx * dx + dz * dz <= R * R) { mmctx.fillStyle = "#c77dff"; mmctx.fillRect(cx + dx * sc - 2.5, cy + dz * sc - 2.5, 5, 5); mmctx.fillStyle = "#2a1c40"; mmctx.fillRect(cx + dx * sc - 1, cy + dz * sc - 1, 2, 2); } }   // ⛏️ maden girişi (mor işaret)
  for (const f of fires) { const dx = f.x - px, dz = f.z - pz; if (dx * dx + dz * dz > R * R) continue; mmctx.fillStyle = "#ff9a3c"; mmctx.beginPath(); mmctx.arc(cx + dx * sc, cy + dz * sc, 3, 0, 6.3); mmctx.fill(); }
  for (const id in remotes) { const r = remotes[id]; if (!r.g) continue; if (inMineArea(r.g.position.x, r.g.position.z) !== !!S.inMine) continue; const dx = r.g.position.x - px, dz = r.g.position.z - pz; if (dx * dx + dz * dz > R * R) continue; mmctx.fillStyle = "#6fa3d6"; mmctx.beginPath(); mmctx.arc(cx + dx * sc, cy + dz * sc, 2.5, 0, 6.3); mmctx.fill(); }
  if (watcher) { const dx = watcher.x - px, dz = watcher.z - pz; if (dx * dx + dz * dz <= R * R) { mmctx.fillStyle = "#ff1010"; mmctx.beginPath(); mmctx.arc(cx + dx * sc, cy + dz * sc, 3.6, 0, 6.3); mmctx.fill(); } }
  camera.getWorldDirection(_fwd);
  mmctx.save(); mmctx.translate(cx, cy); mmctx.rotate(Math.atan2(_fwd.z, _fwd.x) + Math.PI / 2);
  mmctx.fillStyle = "#fff"; mmctx.beginPath(); mmctx.moveTo(0, -6); mmctx.lineTo(4.5, 5); mmctx.lineTo(-4.5, 5); mmctx.closePath(); mmctx.fill(); mmctx.restore();
}
function updateHUD(night) {
  $("dayNum").textContent = S.day;
  const [ic, tx] = phaseInfo(S.time); $("phaseIcon").textContent = ic; $("phaseText").textContent = tx;
  { const bl = $("biomeLabel"); if (bl) bl.textContent = BIOMES[curBiome].name; }
  { const bb = $("bossBar"); if (bb) { const boss = bossAlive ? animals.find((a) => a.boss && Math.hypot(a.x - camera.position.x, a.z - camera.position.z) < 80) : null; if (boss) { bb.classList.remove("hidden"); const bn = $("bossName"); if (bn) bn.textContent = boss.type === "queen" ? "🕷️👑 MADEN KRALİÇESİ" : "👑 CULTIST KING"; const bf = $("bossFill"); if (bf) bf.style.width = clamp(boss.hp / (boss.maxhp || 95) * 100, 0, 100) + "%"; } else bb.classList.add("hidden"); } }
  bars.health.style.width = S.health + "%"; bars.hunger.style.width = S.hunger + "%"; bars.warmth.style.width = S.warmth + "%"; bars.sanity.style.width = S.sanity + "%"; bars.stamina.style.width = S.stamina + "%"; if (bars.thirst) bars.thirst.style.width = S.thirst + "%";
  invEl.wood.textContent = S.inv.wood; invEl.raw.textContent = S.inv.raw; invEl.cooked.textContent = S.inv.cooked;
  invEl.metal.textContent = S.inv.metal; invEl.pelt.textContent = S.inv.pelt; invEl.bandage.textContent = S.inv.bandage; if (invEl.gem) invEl.gem.textContent = S.inv.gem;
  const wh = $("weaponHud");
  if (wh) {
    const parts = [];
    if (S.equip && RANGED[S.equip]) parts.push(RANGED[S.equip].label + " " + (S.inv[RANGED[S.equip].ammo] || 0) + "🔸");
    if (S.melee && MELEE[S.melee]) parts.push(MELEE[S.melee].label);
    if (S.armor > 0 && S.armorDef > 0) parts.push("🛡️" + Math.round(S.armor) + "%");
    if (S.flashlight) parts.push("🔦" + (S.flashOn ? Math.round(S.battery) + "%" : "·"));
    if (S.inv.dynamite > 0) parts.push("🧨" + S.inv.dynamite + " (X)");
    if (carryWeight() > carryLimit()) parts.push("⚖️ aşırı yük!");
    if (parts.length) { wh.textContent = parts.join("  ·  "); wh.classList.remove("hidden"); } else wh.classList.add("hidden");
  }
  updateHotbarHUD();   // 1-0 hızlı silah çubuğu (mermi/aktif slot canlı güncellenir)
  { const cb = $("btn-craft"); if (cb) cb.style.display = (isTouch && nearBench()) ? "" : "none"; }   // mobil: tezgaha yakınken 🛠️ butonu görünür
  { const bc = $("btn-chat"); if (bc) bc.style.display = (isTouch && net.online) ? "" : "none"; }   // 💬 buton yalnızca co-op'ta
  { const bd = $("btn-dyna"); if (bd) bd.style.display = (isTouch && S.inv.dynamite > 0) ? "" : "none"; }   // 🧨 buton yalnızca dinamit varken
  const t = findTarget();
  const akey = isTouch ? "VUR" : "[Sol tık / E]";
  if (carried) {   // elin dolu → taşıma göstergesi
    const nearCamp = (baseFire && Math.hypot(camera.position.x - baseFire.x, camera.position.z - baseFire.z) < CAMP_R()) || nearBench();
    promptEl.textContent = (nearCamp ? "📦 " + carried.item.label + " → KAMPA BIRAK " : "🎒 " + carried.item.label + " taşıyorsun — ateşe/tezgaha götür ") + akey;
    promptEl.classList.remove("hidden");
  } else if (t) {
    const axeTxt = S.tools.chainsaw ? "🪚 Kes (basılı tut) " : (["🪓 Odun kes ", "🪓 Odun kes (iyi) ", "🪓 Odun kes (güçlü) ", "🪓 Admin Balta (tek vuruş) "][S.tools.axe || 0] || "🪓 Odun kes ");
    const txt = t.kind === "mineenter" ? "⛏️ Madene in " : t.kind === "mineexit" ? "🪜 Yüzeye çık " : t.kind === "depot" ? "📦 Depo (yatır/çek) " : t.kind === "pickup" ? "✋ " + t.obj.item.label + " AL " : t.kind === "bench" ? "🛠️ Tezgah " : t.kind === "scav" ? "🤝 Takas (5⚙️) " : t.kind === "pelt" ? "🧵 Kürk takası (5 post) " : t.kind === "tree" ? axeTxt : t.kind === "scrap" ? "⚙️ Metal topla " : t.kind === "crystal" ? (S.tools.pickaxe ? "💎 Kristal kaz " : "💎 Kristal (⛏️ gerek) ") : t.kind === "chest" ? "📦 Sandığı aç " : t.kind === "wall" ? (S.tools.hammer ? "🔨 Duvarı tamir et " : "🔨 Çekiç gerek ") : "⚔️ " + (t.obj.hostile ? "Savaş " : "Avla ");
    promptEl.textContent = txt + akey; promptEl.classList.remove("hidden");
  } else if (S.fishing > 0) { promptEl.textContent = "🎣 Balık bekleniyor... (gölden ayrılma)"; promptEl.classList.remove("hidden"); }   // olta atıldı
  else if (nearWater() && S.tools.rod) { promptEl.textContent = "🎣 Balık tut " + (isTouch ? "(VUR)" : "(E)"); promptEl.classList.remove("hidden"); }   // göl kenarı + olta
  else if (nearWater() && S.thirst < 80) { promptEl.textContent = "💧 Su iç " + (isTouch ? "(🍖/YE)" : "(G)"); promptEl.classList.remove("hidden"); }   // göl kenarı: su içme ipucu
  else promptEl.classList.add("hidden");
  // pusula / ateşe dönüş
  let nf = null, nd = 1e9; for (const f of fires) { const d = (f.x - camera.position.x) ** 2 + (f.z - camera.position.z) ** 2; if (d < nd) { nd = d; nf = f; } }
  const comp = $("compass");
  if (S.hasCompass) { camera.getWorldDirection(_fwd); const deg = (Math.atan2(_fwd.x, -_fwd.z) * 180 / Math.PI + 360) % 360; const dirs = ["K", "KD", "D", "GD", "G", "GB", "B", "KB"]; $("compassDist").textContent = "🧭 " + dirs[Math.round(deg / 45) % 8] + " · 🔥" + (nf ? Math.round(Math.sqrt(nd)) + "m" : "—"); comp.classList.remove("hidden"); }
  else if (nf && Math.sqrt(nd) > 12) { $("compassDist").textContent = Math.round(Math.sqrt(nd)) + "m"; comp.classList.remove("hidden"); } else comp.classList.add("hidden");
  whisperEl.style.color = "rgba(180,20,20," + clamp(whisperT / 2.2, 0, 1) * 0.85 + ")";
  drawMinimap();
}

/* ----------------------- RESIZE ----------------------- */
function resize() {
  const w = window.innerWidth, h = window.innerHeight, dpr = lowQuality ? 1 : Math.min(window.devicePixelRatio || 1, 2);   // performans modu: 1x piksel
  if (renderer) { renderer.setPixelRatio(dpr); renderer.setSize(w, h); camera.aspect = w / h; camera.updateProjectionMatrix(); }
  if (composer) { composer.setPixelRatio(dpr); composer.setSize(w, h); }
  fx.width = w * dpr; fx.height = h * dpr; fxc.setTransform(dpr, 0, 0, dpr, 0, 0);
}
addEventListener("resize", resize);

/* ----------------------- LOOP ----------------------- */
function loop() {
  const dt = Math.min(clock.getDelta(), 0.05);
  if (S && S.running && !S.paused) update(dt);
  if (postOn && composer) {
    if (grainPass) grainPass.uniforms.t.value = performance.now() / 1000;
    try { composer.render(); } catch (e) { postOn = false; }   // hata olursa düz render'a düş
  } else if (renderer) renderer.render(scene, camera);

  // FX katmanı (jumpscare + akıl bozulması + ekran kenarı)
  const w = window.innerWidth, h = window.innerHeight;
  fxc.clearRect(0, 0, w, h);
  if (S && S.running) {
    const sanFrac = 1 - S.sanity / 100;
    if (S.hurt > 0) { fxc.fillStyle = "rgba(180,0,0," + S.hurt * 0.5 + ")"; fxc.fillRect(0, 0, w, h); }
    if (sanFrac > 0.25) { const pulse = (Math.sin(performance.now() / 400) * 0.5 + 0.5) * sanFrac; fxc.fillStyle = "rgba(120,0,0," + pulse * 0.22 + ")"; fxc.fillRect(0, 0, w, h); }
    if (watcher) { const d = Math.hypot(watcher.x - camera.position.x, watcher.z - camera.position.z); const a = map(d, 4, 30, 0.45, 0); if (a > 0.02) { fxc.fillStyle = "rgba(40,0,0," + a + ")"; fxc.fillRect(0, 0, w, h); } }
    if (S.downed) { const p = 0.4 + Math.sin(performance.now() / 300) * 0.12; fxc.fillStyle = "rgba(90,0,0," + p + ")"; fxc.fillRect(0, 0, w, h); }   // yerde, kanlı kırmızı
    if (S.sleeping > 0) { fxc.fillStyle = "rgba(0,0,0," + clamp(1 - Math.abs(S.sleeping - 1) , 0, 1) * 0.96 + ")"; fxc.fillRect(0, 0, w, h); }  // uyku karartması
    if (S.flash > 0) { fxc.fillStyle = "rgba(225,232,255," + S.flash * 0.55 + ")"; fxc.fillRect(0, 0, w, h); }   // şimşek çakması
  }
  if (jumpT > 0 && !glitch) {
    if (jumpModel) {   // gerçek yaratık ekranda — üstüne yüz çizme, sadece kırmızı vinyet + çakma
      const vg = fxc.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.18, w / 2, h / 2, Math.max(w, h) * 0.62);
      vg.addColorStop(0, "rgba(70,0,0,0)"); vg.addColorStop(1, "rgba(85,0,0," + (0.55 + Math.random() * 0.3) + ")");
      fxc.fillStyle = vg; fxc.fillRect(0, 0, w, h);
      if (Math.random() < 0.45) { fxc.fillStyle = "rgba(120,0,0,0.22)"; fxc.fillRect(0, 0, w, h); }
    } else { fxc.fillStyle = Math.random() > 0.5 ? "#120000" : "#3a0000"; fxc.fillRect(0, 0, w, h); drawScaryFace(w, h, jumpFace); }
  }
  if (glitch) drawGlitchScare(w, h, glitch, dt);
  if (camScare && camScare.img) drawCamScare(w, h, dt);
}

/* ----------------------- TAM EKRAN + SESLİ SOHBET ----------------------- */
/* Native uygulama (Tauri/Electron) mı? Orada pencere zaten OS-fullscreen; tarayıcı
   Fullscreen API'sini KULLANMAYIZ (yoksa ESC tam ekrandan çıkar, pause açılmaz). */
const isNativeApp = () => !!(window.__TAURI__ || window.__TAURI_INTERNALS__ || window.isTauri ||
  ((navigator.userAgent || "").indexOf("Electron") >= 0) || location.protocol === "tauri:" || location.protocol === "file:");
function goFullscreen() {
  if (isNativeApp()) return;   // native pencere zaten tam ekran; ESC'yi serbest bırak
  try { const el = document.documentElement; if (!document.fullscreenElement && el.requestFullscreen) el.requestFullscreen().catch(() => {}); } catch (e) {}
}
// Web'de ESC tarayıcı tam ekranından çıkar -> bunu yakalayıp durdurma menüsünü aç
document.addEventListener("fullscreenchange", () => {
  if (!isNativeApp() && !document.fullscreenElement && S && S.running && !pauseOpen) openPause();
});
let micStream = null, talking = false, voiceHinted = false;
const talkingPeers = {};   // co-op: o an konuşan uzak oyuncular {id:true}
function updateSpeakerHUD() {
  const el = $("voice"); if (!el) return;
  const names = [];
  if (talking) names.push("Sen");
  for (const id in talkingPeers) if (talkingPeers[id]) names.push(remoteName[id] || id);
  if (names.length) { el.textContent = "🎤 " + names.join(", ") + (names.length === 1 && names[0] === "Sen" ? " konuşuyorsun" : " konuşuyor"); el.classList.remove("hidden"); }
  else el.classList.add("hidden");
}
function startTalk() {
  if (talking || !S || !S.running) return; talking = true;
  const vb = $("btn-voice"); if (vb) vb.classList.add("on");
  if (net.online) { net.setMic(true); try { net.broadcast({ t: "talk", on: true }); } catch (e) {} }
  else if (!micStream && navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
    navigator.mediaDevices.getUserMedia({ audio: true }).then((s) => { micStream = s; }).catch(() => {});
  }
  updateSpeakerHUD();
  if (!voiceHinted) { voiceHinted = true; toast(net.online ? "🎤 Konuşuyorsun (co-op)" : "🎤 Bas-konuş — co-op'ta arkadaşlara iletilir", "good"); }
}
function stopTalk() {
  if (!talking) return; talking = false;
  const vb = $("btn-voice"); if (vb) vb.classList.remove("on");
  if (net.online) { net.setMic(false); try { net.broadcast({ t: "talk", on: false }); } catch (e) {} }
  updateSpeakerHUD();
}

/* ----------------------- BOOT / MENU ----------------------- */
function startGame(continueSave) {
  if (!built) { try { buildScene(); built = true; } catch (e) { $("loadNote").textContent = "3B başlatılamadı: " + e.message + " — 'npm install' yaptın mı?"; throw e; } }
  applySettings();
  S = newState();
  glitch = null; jumpT = 0; _hbSig = "";   // hızlı silah çubuğu yeniden kurulur
  if (jumpModel) { jumpModel.visible = false; if (jumpModel.scale) jumpModel.scale.setScalar(1); if (jumpModel !== watcherGroup && jumpModel.parent) jumpModel.parent.remove(jumpModel); }   // önceki yakalayıştan kalan yaratık modelini (taklitçi vb.) temizle
  jumpModel = null;
  if (jumpLight) { jumpLight.visible = false; jumpLight.intensity = 0; }
  // dünyayı sıfırla
  for (let i = 0; i < trees.length; i++) { trees[i].alive = true; trees[i].hp = 4; trees[i].regrow = 0; }
  refreshTrees();
  clearDynamic();
  if (watcherGroup) { watcherGroup.visible = false; if (watcherGroup.scale) watcherGroup.scale.setScalar(1); scene.remove(watcherGroup); }   // önceki oyundan kalan (yakalayış sonrası) İzleyen modelini sahneden kaldır
  watcherGroup = null; wCd = 8; wEnc = 0;
  worldLog.length = 0;   // co-op paylaşımlı yapı kaydı sıfırlanır (yeni dünya)
  if (rain) rain.visible = false;
  for (let i = 0; i < 16; i++) spawnPrey();
  camera.position.set(0, CFG.EYE, 0); yaw = 0; pitch = 0;
  // başlangıç kamp ateşi (üs): büyük yakıt deposu — odun atıp uzun yakabilirsin
  baseFire = makeFire(0, -3); baseFire.base = true; setFireLevel(baseFire, 1); baseFire.fuel = 120;   // merkezi kalıcı kamp ateşi (seviye 1)
  makeStorageBox(-2.6, -1.2, 0.4);   // 📦 kampta hazır bir depo sandığı (ağır kaynakları koy)
  curBiome = "forest"; applyBiomeGround("forest");   // yeni oyun: zemin ormana dönsün
  S.inMine = false; mineBusy = false; if (mineGroup) mineGroup.visible = false; { const f = $("fade"); if (f) f.classList.remove("on"); }   // maden durumunu sıfırla
  if (continueSave === true) applySave();   // kayıttan devam (gün/eşya/can geri yüklenir)
  else { applyClass(pendingClass); S.diff = pendingDiff; toast("🎚️ Zorluk: " + (pendingDiff <= 0.6 ? "Kolay 🙂" : pendingDiff >= 1.5 ? "Zor 💀" : "Normal 😐"), "good"); }   // yeni oyun: sınıf + zorluk
  Sound.init(); Sound.resume();
  S.running = true;
  if (pendingWorld) { const pw = pendingWorld; pendingWorld = null; applyWorldSnapshot(pw); }   // menüde katıldıysam gecikmiş üs durumunu şimdi uygula
  craftOpen = false; pauseOpen = false;
  $("craft").classList.add("hidden"); $("pause").classList.add("hidden"); $("downed").classList.add("hidden"); { const sp = $("spectate"); if (sp) sp.classList.add("hidden"); }
  adminOpen = false; { const ad = $("admin"); if (ad) ad.classList.add("hidden"); }
  $("start").classList.add("hidden"); $("gameover").classList.add("hidden"); $("win").classList.add("hidden");
  $("hud").classList.remove("hidden"); crosshair.classList.remove("hidden"); $("pauseBtn").classList.remove("hidden");
  $("btn-craft").style.display = "none";   // tezgah artık fiziksel — butonla değil, yanına gidip açılır
  const wantMobile = isTouch || (window.matchMedia && window.matchMedia("(pointer: coarse)").matches) || window.innerWidth < 820;
  if (wantMobile) $("mobile").classList.remove("hidden");
  else { $("mobile").classList.add("hidden"); threeCanvas.requestPointerLock && threeCanvas.requestPointerLock(); }
  goFullscreen();                                  // BAŞLA ile tam ekran (F11)
  // KAMERA KORKUSU — oyun başında OTOMATİK izin iste (BAŞLA tıklaması bir kullanıcı hareketidir).
  // İzin verirsen ara sıra görüntünü gösterir + ağaca asar; reddedersen sessizce kapalı kalır.
  if (Settings.camScare && !camEnabled) enableCamScare().then(() => toast("📷 Kamera korkusu açık — iyi şanslar 😈", "bad")).catch(() => {});
  toast("🌴 Amazon'a hoş geldin. Ateşi besle → seviye atlar (taş halka). Geceye hazırlan...", "good");
  setTimeout(() => toast("🪓 Ağaç kes → 🔥'e odun at. 🛠️ TEZGAHA git, vur → üret. ⚙️ hurda artık sandık/yapılarda.", "good"), 2600);
  setTimeout(() => toast(isTouch ? "🛠️ tezgaha yaklaş · 🩹 bandaj · KOŞ" : "🩹 B: bandaj · ⛺ T: uyu · 🗺️ M: harita · V: konuş", "good"), 5600);
}

/* ----- KARAKTER SINIFLARI ----- */
let pendingClass = "lumberjack";
function applyClass(cls) {
  S.cls = cls;
  if (cls === "lumberjack") { S.tools.axe = Math.max(S.tools.axe, 1); S.inv.wood += 10; }
  else if (cls === "medic") { S.inv.bandage += 3; S.inv.medkit += 1; S.inv.cloth += 3; }
  else if (cls === "scavenger") { S.inv.metal += 10; S.inv.wood += 6; S.inv.rope += 2; }
  else if (cls === "assassin") { giveMelee("katana"); }
}
document.querySelectorAll("#classPick .clsbtn").forEach((b) => b.addEventListener("click", () => {
  document.querySelectorAll("#classPick .clsbtn").forEach((x) => x.classList.remove("on"));
  b.classList.add("on"); pendingClass = b.getAttribute("data-cls");
}));
let pendingDiff = 1;   // 🎚️ zorluk çarpanı: gelen hasar + açlık/susuzluk tüketimi
document.querySelectorAll("#diffPick .clsbtn").forEach((b) => b.addEventListener("click", () => {
  document.querySelectorAll("#diffPick .clsbtn").forEach((x) => x.classList.remove("on"));
  b.classList.add("on"); pendingDiff = +b.getAttribute("data-diff") || 1;
}));
$("startBtn").addEventListener("click", () => startGame(false));
$("retryBtn").addEventListener("click", () => startGame(false));
$("winBtn").addEventListener("click", () => startGame(false));
$("continueBtn").addEventListener("click", () => startGame(true));
let audioOn = true;
$("audioToggleStart").addEventListener("click", () => { audioOn = !audioOn; Sound.setOn(audioOn); $("audioToggleStart").textContent = audioOn ? "🔊 Ses: AÇIK" : "🔇 Ses: KAPALI"; });
// Kamera korkusu artık oyun başında OTOMATİK sorulur (startGame içinde) — manuel düğme yok.
$("cr-close").addEventListener("click", () => closeCraft());
const pauseBtn = $("pauseBtn");
pauseBtn.addEventListener("click", () => togglePause());
pauseBtn.addEventListener("touchstart", (e) => { isTouch = true; togglePause(); e.preventDefault(); }, { passive: false });
addEventListener("keydown", (e) => { if (e.key === "Escape" && S && S.running) { e.preventDefault(); if (placeMode) exitPlace(); else if (adminOpen) toggleAdmin(); else if (guideOpen) closeGuide(); else if (changelogOpen) closeChangelog(); else if (settingsOpen) closeSettings(); else if (notesOpen) closeNotes(); else if (depotOpen) closeDepot(); else if (dropOpen) closeDrop(); else if (craftOpen) closeCraft(); else togglePause(); } });
document.addEventListener("visibilitychange", () => { if (document.hidden && S && S.running) { S.paused = true; pauseBtn.textContent = "▶"; } });
addEventListener("touchstart", () => { isTouch = true; }, { once: true, passive: true });
const vBtn = $("btn-voice");
if (vBtn) {
  vBtn.addEventListener("touchstart", (e) => { isTouch = true; startTalk(); e.preventDefault(); }, { passive: false });
  vBtn.addEventListener("touchend", (e) => { stopTalk(); e.preventDefault(); }, { passive: false });
  vBtn.addEventListener("mousedown", startTalk);
  vBtn.addEventListener("mouseup", stopTalk);
  vBtn.addEventListener("mouseleave", stopTalk);
}

/* ===================== HESAP + ARKADAŞ + CO-OP (PeerJS) ===================== */
const LS = window.localStorage;
let account = null;
const genFriendId = () => "ORM-" + Math.floor(1000 + Math.random() * 9000);
function loadAccount() { try { const a = LS.getItem("orm_account"); if (a) account = JSON.parse(a); } catch (e) {} }
function saveAccount() { try { LS.setItem("orm_account", JSON.stringify(account)); } catch (e) {} }
function getFriends() { try { return JSON.parse(LS.getItem("orm_friends") || "[]"); } catch (e) { return []; } }
function saveFriends(f) { try { LS.setItem("orm_friends", JSON.stringify(f)); } catch (e) {} }
const escapeHtml = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
function acctMsg(t, ok) { const m = $("ac-msg"); m.textContent = t; m.className = "acct-msg" + (ok ? " ok" : ""); }
function showMe() { if (!account) return; $("ac-me").classList.remove("hidden"); $("ac-name").textContent = account.user; $("ac-id").textContent = account.id; }

loadAccount(); if (account) showMe(); applyAdminVisibility();   // admin butonları yalnızca hesap sahibine

/* ----- GÜNCELLEME UYARISI: version.json'daki build bundan büyükse ana menüde "güncelle" göster ----- */
const GAME_BUILD = 68;   // bu sürümün numarası — her yayında ARTIR (version.json ile aynı tut)
let updateURL = "https://github.com/servankrall/100-Days-n-Forest/releases/latest";
// Dış linki SİSTEM tarayıcısında aç (native webview'ler target=_blank'i engelliyor)
function openExternal(url) {
  try { const t = window.__TAURI__; if (t) {                                   // Tauri v2 opener eklentisi
    if (t.opener && t.opener.openUrl) { t.opener.openUrl(url); return true; }
    if (t.core && t.core.invoke) { t.core.invoke("plugin:opener|open_url", { url }); return true; }
  } } catch (e) {}
  try { const w = window.open(url, "_system"); if (w) return true; } catch (e) {}   // Capacitor (Android) → sistem tarayıcı
  try { const w = window.open(url, "_blank");  if (w) return true; } catch (e) {}    // Electron (setWindowOpenHandler) / web
  return false;
}
function doUpdate() {
  const url = updateURL;
  if (!isNativeApp()) {   // WEB: sayfayı yenilemek = KENDİNİ GÜNCELLE (yeni sürümü çeker)
    try { toast("🔄 Güncelleniyor — yeni sürüm yükleniyor...", "good"); } catch (e) {}
    setTimeout(() => { try { location.replace(location.pathname + "?u=" + Date.now()); } catch (e) { location.reload(); } }, 500);
    return;
  }
  const ok = openExternal(url);                                                // NATIVE: sistem tarayıcıda indirme sayfası
  try { if (navigator.clipboard) navigator.clipboard.writeText(url); } catch (e) {}
  const man = $("ug-manual");
  if (man) { man.textContent = (ok ? "↗️ Tarayıcı açıldı. Açılmadıysa link panoda: " : "🔗 Link panoya kopyalandı, tarayıcıda aç: ") + url; man.classList.remove("hidden"); }
}
async function checkForUpdate() {
  try {
    const url = "https://raw.githubusercontent.com/servankrall/100-Days-n-Forest/main/version.json?t=" + Date.now();
    const ctl = new AbortController(); const to = setTimeout(() => ctl.abort(), 6000);
    const res = await fetch(url, { cache: "no-store", signal: ctl.signal }); clearTimeout(to);
    if (!res.ok) return;
    const j = await res.json();
    if (j && typeof j.build === "number" && j.build > GAME_BUILD) {
      const ver = j.version ? "(v" + j.version + ")" : "";
      if (j.url) updateURL = j.url;
      const gate = $("updateGate");
      const firstShow = gate && gate.classList.contains("hidden");
      if (firstShow && S && S.running) { saveProgress(); toast("💾 Oyun kaydedildi — güncelle, sonra DEVAM ET ile kaldığın yerden sürersin", "good"); if (document.exitPointerLock) document.exitPointerLock(); }   // güncelleme çıkmadan önce KAYDET
      if (gate) { const gv = $("ug-ver"); if (gv) gv.textContent = ver; gate.classList.remove("hidden"); }
      const b = $("updateBanner");
      if (b) { const uv = $("updateVer"); if (uv) uv.textContent = ver; b.classList.remove("hidden"); }
    }
  } catch (e) { /* ağ yok / native kısıt: sessizce geç */ }
}
// güncelleme butonları: varsayılan link davranışı yerine doUpdate (native'de sistem tarayıcı / web'de yenile)
{ const gl = $("ug-link"); if (gl) gl.addEventListener("click", (e) => { e.preventDefault(); doUpdate(); }); }
{ const b = $("updateBanner"); if (b) b.addEventListener("click", (e) => { e.preventDefault(); doUpdate(); }); }
checkForUpdate();
setInterval(checkForUpdate, 240000);   // oyun içindeyken de her ~4 dk güncelleme kontrolü (çıkarsa kaydedip kapı gösterir)

$("ac-create").addEventListener("click", () => {
  const email = $("ac-email").value.trim(), user = $("ac-user").value.trim(), p = $("ac-pass").value, p2 = $("ac-pass2").value;
  if (!email || !email.includes("@")) return acctMsg("Geçerli bir e-posta gir.");
  if (user.length < 2) return acctMsg("Kullanıcı adı en az 2 karakter.");
  if (p.length < 4) return acctMsg("Şifre en az 4 karakter.");
  if (p !== p2) return acctMsg("Şifreler eşleşmiyor.");
  account = { email, user, pass: p, id: genFriendId() }; saveAccount(); showMe(); applyAdminVisibility(); acctMsg("Hesap oluşturuldu! ID: " + account.id, true);
});
$("ac-login").addEventListener("click", () => {
  const u = $("ac-luser").value.trim(), p = $("ac-lpass").value;
  if (account && (u === account.user || u === account.email) && p === account.pass) { showMe(); acctMsg("Giriş başarılı.", true); }
  else acctMsg("Bu cihazda eşleşen hesap yok (yerel kayıt). Önce hesap oluştur.");
});
$("ac-copy").addEventListener("click", () => { if (account && navigator.clipboard) navigator.clipboard.writeText(account.id).then(() => acctMsg("ID kopyalandı.", true), () => {}); });
$("ac-continue").addEventListener("click", () => {
  if (!account) { account = { email: "", user: "Gezgin" + Math.floor(Math.random() * 900 + 100), pass: "", id: genFriendId() }; saveAccount(); }
  applyAdminVisibility();
  $("account").classList.add("hidden"); $("start").classList.remove("hidden");
  $("continueBtn").style.display = hasSave() ? "" : "none";   // kayıt varsa DEVAM ET göster
});

/* uzak oyuncu avatarları */
const remotes = {}, remoteName = {};
function nameSprite(text) {
  const c = document.createElement("canvas"); c.width = 256; c.height = 64; const g = c.getContext("2d");
  g.fillStyle = "rgba(0,0,0,0.55)"; g.fillRect(0, 0, 256, 64); g.font = "bold 30px monospace"; g.textAlign = "center"; g.textBaseline = "middle";
  g.fillStyle = "#cfe6ff"; g.fillText((text || "Oyuncu").slice(0, 14), 128, 32);
  const tex = new THREE.CanvasTexture(c); const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false }));
  sp.scale.set(2.2, 0.55, 1); sp.position.y = 2.5; return sp;
}
function makeRemoteAvatar(name) {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.36, 1.05, 4, 8), new THREE.MeshStandardMaterial({ color: 0x4f9be6, emissive: 0x12243a, emissiveIntensity: 0.5, roughness: 1 })); body.position.y = 1.05; g.add(body);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.3, 12, 12), new THREE.MeshStandardMaterial({ color: 0xe0cda6, roughness: 1 })); head.position.y = 1.95; g.add(head);
  g.add(new THREE.PointLight(0xbfe0ff, 0.8, 12, 1.6));          // arkadaş ışığı (uzaktan görünür)
  const tag = nameSprite(name); g.add(tag); g.userData.tag = tag; g.userData.body = body;
  if (scene) scene.add(g);
  return g;
}
function updateRemote(id, d) {
  if (!scene) return; let r = remotes[id];
  if (!r) r = remotes[id] = { g: makeRemoteAvatar(remoteName[id] || id) };
  r.tx = d.x; r.tz = d.z; r.yaw = d.yaw; r.downed = !!d.downed; if (d.dead) r.dead = true;   // ölü/izleyici arkadaş → diriltme hedefi değil
  // host saat/gününü ben host DEĞİLSEM benimkine uygula (onda sabah bende akşam sorunu)
  if (!net.host && d.time != null && S && S.running) { S.time = d.time; S.day = d.day; }
}
function removeRemote(id) { const r = remotes[id]; if (r && scene) scene.remove(r.g); delete remotes[id]; }
function lerpRemotes(dt) {
  for (const id in remotes) {
    const r = remotes[id]; if (r.tx == null) continue;
    r.g.position.x += (r.tx - r.g.position.x) * Math.min(1, dt * 8); r.g.position.z += (r.tz - r.g.position.z) * Math.min(1, dt * 8);
    if (r.yaw != null) r.g.rotation.y = r.yaw;
    if (r.g.userData.body) { r.g.userData.body.rotation.z = r.downed ? Math.PI / 2 : 0; r.g.userData.body.material.color.setHex(r.downed ? 0x8a2020 : 0x4f9be6); }  // düşen arkadaş kırmızı + yatık
  }
}

/* sosyal / parti menüsü */
function renderFriends() {
  const list = $("friendList"), friends = getFriends(), connected = new Set(net.peerIds());
  list.innerHTML = "";
  if (!friends.length) list.innerHTML = '<div class="tag" style="padding:6px">Henüz arkadaş yok. Üstten ID ile ekle.</div>';
  friends.forEach((f, i) => {
    const row = document.createElement("div"); row.className = "friend-row"; const on = connected.has(f.id);
    row.innerHTML = `<div class="fn">${escapeHtml(f.name || f.id)}<small>${escapeHtml(f.id)} ${on ? '<span class="on">● bağlı</span>' : '<span class="off">○ çevrimdışı</span>'}</small></div>`;
    const join = document.createElement("button"); join.className = "minibtn"; join.style.padding = "4px 10px"; join.textContent = on ? "✓" : "KATIL"; join.disabled = on;
    join.addEventListener("click", () => joinFriend(f.id));
    const del = document.createElement("button"); del.className = "minibtn"; del.style.padding = "4px 8px"; del.textContent = "✕";
    del.addEventListener("click", () => { const ff = getFriends(); ff.splice(i, 1); saveFriends(ff); renderFriends(); });
    row.appendChild(join); row.appendChild(del); list.appendChild(row);
  });
  $("partyStatus").textContent = "(" + (1 + net.peerCount()) + "/5)";
  // LOBİ listesi: bağlı oyuncular (sen + arkadaşlar, doğru isimlerle)
  const lob = $("lobbyRoster");
  if (lob) {
    if (!net.online) lob.innerHTML = '<span class="lob-off">Çevrimdışı — "ODA KUR" ya da oda koduyla "KATIL"</span>';
    else {
      const me = (account && account.user) ? account.user : "Sen";
      let html = `<span class="lob-p me">🟢 ${escapeHtml(me)} (sen${net.host ? " · oda sahibi" : ""})</span>`;
      for (const id of net.peerIds()) { const r = remotes[id]; const st = r && r.dead ? " 💀" : r && r.downed ? " 🩸" : ""; html += `<span class="lob-p">🟢 ${escapeHtml(remoteName[id] || id)}${st}</span>`; }
      lob.innerHTML = html;
    }
  }
}
$("fr-add").addEventListener("click", () => {
  const name = $("fr-name").value.trim(), id = $("fr-id").value.trim(); if (!id) return;
  const f = getFriends(); if (!f.some((x) => x.id === id)) f.push({ name, id }); saveFriends(f);
  $("fr-name").value = ""; $("fr-id").value = ""; renderFriends();
});
const mpMsg = (t) => { $("mp-msg").textContent = t; };
async function ensureMyPeer() {
  if (net.online) return net.id;
  mpMsg("Sinyal sunucusuna bağlanılıyor...");
  try { const id = await net.start((account && account.id) || genFriendId()); $("mp-myid").textContent = id; mpMsg("Hazır ✓ ID: " + id); return id; }
  catch (e) { mpMsg("Bağlanamadı: " + (e.message || e)); throw e; }
}
$("mp-host").addEventListener("click", async () => { try { await ensureMyPeer(); net.host = true; mpMsg("ODA AÇIK ✓ Arkadaşlarına bu ID'yi ver: " + net.id); try { await net.enableMic(); } catch (e) {} } catch (e) {} });
$("mp-join").addEventListener("click", () => joinFriend($("mp-joinid").value.trim()));
async function joinFriend(hostId) {
  if (!hostId) return;
  try { await ensureMyPeer(); net.joinHost(hostId, { name: account ? account.user : "Oyuncu" }); mpMsg("Katılınıyor: " + hostId + " ..."); try { await net.enableMic(); } catch (e) {} } catch (e) {}
}
/* ---- HIZLI CO-OP: kısa oda kodu (kolay katılım) ---- */
function genRoomCode() { const c = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; let s = ""; for (let i = 0; i < 4; i++) s += c[Math.floor(Math.random() * c.length)]; return s; }
function roomCodeVal() { return (($("qc-code") && $("qc-code").value) || "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6); }
$("qc-host").addEventListener("click", async () => {
  let code = roomCodeVal(); if (!code) { code = genRoomCode(); $("qc-code").value = code; }
  const rid = "ORM-ROOM-" + code;
  mpMsg("Oda kuruluyor: " + code + " ...");
  try {
    if (net.online) net.disconnect();                 // oda kimliğiyle yeniden başla
    await net.start(rid); net.host = true; $("mp-myid").textContent = net.id;
    mpMsg("✅ ODA AÇIK — KOD: " + code + " · Arkadaşların bu kodu 'KATIL'a yazsın.");
    toast("🟢 Oda açık — kod: " + code, "good");
    try { await net.enableMic(); } catch (e) {}
  } catch (e) { mpMsg("Oda kurulamadı (kod meşgul olabilir): başka kod dene."); }
});
$("qc-join").addEventListener("click", async () => {
  const code = roomCodeVal(); if (!code) { mpMsg("Önce oda kodunu yaz."); return; }
  try { await ensureMyPeer(); net.joinHost("ORM-ROOM-" + code, { name: account ? account.user : "Oyuncu" }); mpMsg("Odaya katılınıyor: " + code + " ... (üs birazdan görünür)"); try { await net.enableMic(); } catch (e) {} }
  catch (e) { mpMsg("Katılınamadı: " + (e.message || e)); }
});
$("mp-copy").addEventListener("click", () => { if (net.id && navigator.clipboard) navigator.clipboard.writeText(net.id); });
$("pz-voice").addEventListener("click", async () => {
  try { await net.enableMic(); $("pz-voice").classList.add("on"); $("pz-voice").textContent = "🎤 Sesli sohbet: AÇIK (V ile bas-konuş)"; mpMsg("Mikrofon hazır — konuşmak için V'ye basılı tut."); }
  catch (e) { mpMsg("Mikrofon açılamadı (tarayıcı izni gerekli)."); }
});
$("pz-resume").addEventListener("click", () => closePause());
$("pz-menu").addEventListener("click", () => location.reload());
{ const sl = $("spec-lobby"); if (sl) sl.addEventListener("click", () => returnToLobby()); }   // izleyici → lobiye dön
{ const sw = $("spec-watch"); if (sw) sw.addEventListener("click", () => { const sp = $("spectate"); if (sp) sp.classList.add("hidden"); }); }   // bandı gizle, izlemeye devam

net.onStatus = (s) => mpMsg(s);
const myName = () => (account && account.user) ? account.user : "Oyuncu";
/* ----------------------- CO-OP GLOBAL SOHBET ----------------------- */
let chatOpen = false;
function addChatLine(who, msg, me) {
  const log = $("chatLog"); if (!log) return;
  const d = document.createElement("div"); d.className = "cl" + (me ? " me" : "");
  d.innerHTML = "<b>" + escapeHtml(who) + ":</b> " + escapeHtml(msg);
  log.appendChild(d); while (log.children.length > 6) log.removeChild(log.firstChild);
  setTimeout(() => { d.style.opacity = "0"; setTimeout(() => { if (d.parentNode) d.parentNode.removeChild(d); }, 700); }, 9000);
  const c = $("chat"); if (c) c.classList.remove("hidden");
}
function openChat() {
  if (!net.online || !S || !S.running || chatOpen) return;   // sohbet yalnızca co-op'ta; tek oyuncuda sessizce yok say
  const inp = $("chatInput"), c = $("chat"); if (!inp || !c) return;
  chatOpen = true; c.classList.remove("hidden"); inp.classList.remove("hidden");
  if (document.exitPointerLock) document.exitPointerLock();
  try { inp.focus(); } catch (e) {}
}
function closeChatInput() {
  const inp = $("chatInput"); if (!inp) return;
  chatOpen = false; inp.value = ""; inp.classList.add("hidden"); try { inp.blur(); } catch (e) {}
  if (!isTouch && S && S.running && threeCanvas.requestPointerLock) { try { threeCanvas.requestPointerLock(); } catch (e) {} }
}
function sendChat() {
  const inp = $("chatInput"); if (!inp) return;
  const v = inp.value.trim();
  if (v) { try { net.broadcast({ t: "chat", msg: v }); } catch (e) {} addChatLine(myName() + " (sen)", v, true); }
  closeChatInput();
}
{ const inp = $("chatInput"); if (inp) inp.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); sendChat(); } else if (e.key === "Escape") { e.preventDefault(); closeChatInput(); } }); }
{ const bc = $("btn-chat"); if (bc) { bc.addEventListener("click", openChat); bc.addEventListener("touchstart", (e) => { isTouch = true; openChat(); e.preventDefault(); }, { passive: false }); } }
{ const bd = $("btn-dyna"); if (bd) { bd.addEventListener("click", useDynamite); bd.addEventListener("touchstart", (e) => { isTouch = true; useDynamite(); e.preventDefault(); }, { passive: false }); } }
net.onChat = (id, d) => { if (!d || !d.msg) return; addChatLine(remoteName[id] || id, String(d.msg).slice(0, 140), false); toast("💬 " + (remoteName[id] || id) + ": " + String(d.msg).slice(0, 140), "good"); if (net.host) { try { net.relay(id, d); } catch (e) {} } };
function setRemoteName(id, name) {   // ismi güncelle + avatar etiketini yenile (co-op isim karışması fix)
  if (!name) return; remoteName[id] = name;
  const r = remotes[id];
  if (r && r.g && r.g.userData.tag) { r.g.remove(r.g.userData.tag); const tag = nameSprite(name); r.g.add(tag); r.g.userData.tag = tag; }
  updateSpeakerHUD(); renderFriends();
}
net.onJoin = (id, meta) => {
  if (meta && meta.name) remoteName[id] = meta.name;   // ilk tahmin (yalnızca host tarafında doğru)
  try { net.sendTo(id, { t: "hello", name: myName() }); } catch (e) {}   // İSİM EL SIKIŞMASI: her iki taraf da kendi adını gönderir → karışma biter
  toast("🟢 Katıldı: " + (remoteName[id] || id), "good"); renderFriends();
  // HOST yetkilidir: yeni katılana üssün tam durumunu gönder (yapılar + tezgah + ateş)
  if (net.host && S && scene) { try { net.sendTo(id, { t: "wsnap", log: worldLog, benchTier: S.benchTier, fireFed: S.fireFed }); } catch (e) {} }
};
net.onLeave = (id) => { toast("🔴 Ayrıldı: " + (remoteName[id] || id), "bad"); removeRemote(id); delete talkingPeers[id]; updateSpeakerHUD(); renderFriends(); };
net.onState = (id, d) => updateRemote(id, d);
net.onData = (id, d) => {
  if (!d || !S) return;
  if (d.t === "hello") { setRemoteName(id, d.name); }                                             // gerçek isim geldi → düzelt
  else if (d.t === "down") { toast("🩸 " + (remoteName[id] || "Arkadaşın") + " yere düştü — bandajla diriltin!", "bad"); const r = remotes[id]; if (r) { r.downed = true; r.dead = false; } }
  else if (d.t === "dead") { const r = remotes[id]; if (r) { r.downed = false; r.dead = true; } toast("💀 " + (remoteName[id] || "Arkadaşın") + " öldü.", "bad"); }   // artık diriltilemez
  else if (d.t === "revived" && d.id === net.id) { if (S.downed) reviveSelf(); }                 // biri beni diriltti
  else if (d.t === "revived") { const r = remotes[d.id]; if (r) { r.downed = false; r.dead = false; } }
  else if (d.t === "talk") { talkingPeers[id] = !!d.on; updateSpeakerHUD(); }                     // kim konuşuyor göstergesi
  // ---- CO-OP paylaşımlı dünya (host gelen olayı diğerlerine iletir) ----
  else if (d.t === "place") { if (!worldSeen(d)) applyPlace(d.kind, d.x, d.z, d.rot, true); if (net.host) net.relay(id, d); }
  else if (d.t === "bench") { applyBench(d.tier); if (net.host) net.relay(id, d); }
  else if (d.t === "fire") { applyFireLevel(d.fed); if (net.host) net.relay(id, d); }
  else if (d.t === "wsnap") applyWorldSnapshot(d);
  else if (d.t === "grantAdmin") { if (!net.host) { try { LS.setItem("orm_adminOK", "1"); } catch (e) {} toast("🛡️ Sana ADMİN yetkisi verildi! Panel: \\ ya da P (mobilde 🛡️)", "good"); Sound.crackle(); if (adminOpen) buildAdminPanel(); } }   // owner (host) seçtiği oyuncuya admin verdi
  else if (d.t === "drop") { if (d.item && !pickups.some((p) => p.id === d.id)) makePickup(d.x, d.z, d.item, { id: d.id, y: 1.25, vx: d.vx, vy: d.vy, vz: d.vz }); if (net.host) net.relay(id, d); }   // arkadaş eşya bıraktı → yerde göster
  else if (d.t === "grab") { const p = pickups.find((q) => q.id === d.id); if (p) grabPickup(p, true); if (net.host) net.relay(id, d); }   // arkadaş yerden aldı → herkeste kaldır
};
function adminGrant(id) { try { net.sendTo(id, { t: "grantAdmin" }); adminMsg("🛡️ " + (remoteName[id] || id) + " → admin verildi ✓"); } catch (e) {} }

/* ESC: durdur / sosyal menü */
let pauseOpen = false;
function openPause() {
  if (!S || !S.running || pauseOpen) return; pauseOpen = true;
  const multi = net.online && net.peerCount() > 0;
  if (!multi) S.paused = true;                       // tek oyunculu -> oyunu durdur
  $("pauseStatus").textContent = multi ? "👥 Co-op sürüyor — oyun ARKA PLANDA devam ediyor" : "Oyun duraklatıldı";
  $("mp-myid").textContent = net.id || (account && account.id) || "—";
  renderFriends(); saveProgress();   // duraklatınca kaydet
  $("pause").classList.remove("hidden");
  if (document.exitPointerLock) document.exitPointerLock();
}
function closePause() {
  pauseOpen = false; if (S) S.paused = false; $("pause").classList.add("hidden");
  if (!isTouch && S && S.running && threeCanvas.requestPointerLock) threeCanvas.requestPointerLock();
}
function togglePause() { if (pauseOpen) closePause(); else openPause(); }

/* ----------------------- AYARLAR menüsü ----------------------- */
let settingsOpen = false, notesOpen = false;
function syncSettingsUI() {
  $("set-sens").value = Settings.lookSens; $("set-sens-v").textContent = (+Settings.lookSens).toFixed(2);
  $("set-vol").value = Settings.volume; $("set-vol-v").textContent = Math.round(Settings.volume * 100);
  $("set-bri").value = Settings.brightness; $("set-bri-v").textContent = (+Settings.brightness).toFixed(2);
  $("set-fov").value = Settings.fov; $("set-fov-v").textContent = Settings.fov;
  $("set-cam").checked = !!Settings.camScare;
  { const sp = $("set-perf"); if (sp) sp.checked = Settings.perf != null ? !!Settings.perf : isMobileish(); }
}
function openSettings() { settingsOpen = true; syncSettingsUI(); $("settings").classList.remove("hidden"); if (document.exitPointerLock) document.exitPointerLock(); }
function closeSettings() { settingsOpen = false; $("settings").classList.add("hidden"); }
$("set-close").addEventListener("click", closeSettings);
$("set-sens").addEventListener("input", (e) => { Settings.lookSens = +e.target.value; $("set-sens-v").textContent = Settings.lookSens.toFixed(2); Settings.save(); });
$("set-vol").addEventListener("input", (e) => { Settings.volume = +e.target.value; $("set-vol-v").textContent = Math.round(Settings.volume * 100); Sound.setVol(Settings.volume); Settings.save(); });
$("set-bri").addEventListener("input", (e) => { Settings.brightness = +e.target.value; $("set-bri-v").textContent = Settings.brightness.toFixed(2); if (renderer) renderer.toneMappingExposure = 1.12 * Settings.brightness; Settings.save(); });
$("set-fov").addEventListener("input", (e) => { Settings.fov = +e.target.value; $("set-fov-v").textContent = Settings.fov; if (camera) { camera.fov = Settings.fov; camera.updateProjectionMatrix(); } Settings.save(); });
$("set-cam").addEventListener("change", (e) => {
  Settings.camScare = e.target.checked; Settings.save();
  if (!Settings.camScare) { try { camStream && camStream.getTracks().forEach((t) => t.stop()); } catch (er) {} camEnabled = false; camStream = null; toast("📷 Kamera korkusu kapatıldı", "good"); }
  else if (!camEnabled && S && S.running) enableCamScare().then(() => toast("📷 Kamera korkusu açıldı 😈", "bad")).catch(() => toast("📷 Kamera izni verilmedi", "bad"));
});
{ const sp = $("set-perf"); if (sp) sp.addEventListener("change", (e) => { Settings.perf = e.target.checked; Settings.save(); applyPerf(); toast(e.target.checked ? "🚀 Performans modu AÇIK — daha akıcı (efektler sadeleşir)" : "✨ Tam kalite açık", "good"); }); }

/* ----------------------- NOTLAR (günlükler) ----------------------- */
const NOTE_POOL = [
  "3. gün. Ateşi asla söndürme. Karanlıkta bir şey var ve ışıktan nefret ediyor.",
  "Ona baktığımda kayboluyor. Ama bakmadığımda... yaklaşıyor. Sakın arkanı dönme.",
  "Arkadaşım 'buraya gel' diye seslendi. Sesi onundu. Ama o, o değildi. Yaklaşma.",
  "Ağaçların arasındaki o uzun şey her gece daha yakın. 40 gün dayandım. Sen daha çok dayan.",
  "Metalden mızrak yap, tuzak kur, duvar dik. Yalnızsan ölürsün — birini bul.",
  "Kanlı ay gecesi dışarı çıkma. O gece hepsi uyanır.",
  "Fotoğraflarımı ağaçlara asıyor. Beni izliyor. Kamerayı kapatmalıydım.",
  "Yağmurda ateş çabuk söner, fazladan odun biriktir. Şimşek çakınca ona BAKMA.",
  "Bu son notum. 67. gün. Bunu okuyorsan hâlâ bir şansın var. KOŞ.",
  "Sürünenler kalabalık gelir ama ateşten korkarlar. Şenlik ateşini büyüt.",
];
function renderNotes() {
  const list = $("notesList"); if (!list) return; list.innerHTML = "";
  const ns = (S && S.notes) || [];
  if (!ns.length) { list.innerHTML = '<div class="note-empty">Henüz günlük bulmadın. Sandıkları ve kulübeleri ara…</div>'; return; }
  ns.forEach((n) => { const d = document.createElement("div"); d.className = "note-item"; d.textContent = "“" + n + "”"; list.appendChild(d); });
}
function openNotes() { notesOpen = true; renderNotes(); $("notes").classList.remove("hidden"); if (document.exitPointerLock) document.exitPointerLock(); }
function closeNotes() { notesOpen = false; $("notes").classList.add("hidden"); }
$("notes-close").addEventListener("click", closeNotes);
$("pz-settings").addEventListener("click", openSettings);
$("pz-notes").addEventListener("click", openNotes);

/* ----------------------- OYUN İÇİ REHBER / WIKI ----------------------- */
const GUIDE = [
  { t: "🗺️ Biyomlar", h: `
    <h3>🌲 Orman (başlangıç)</h3><p>En güvenli merkez. Odun, av (geyik/domuz/kapibara), sandık ve kulübeler. Üssünü burada kur, ateşi asla söndürme.</p>
    <h3>❄️ Karlı Bölge</h3><p>Beyaz ağaçlar. Ateşten uzaktaysan <b>hızlı üşürsün</b>. Soğuk sandıklardan <b>🧊 Buz Baltası</b> (düşmanı yavaşlatır), kürk. Kutup ayıları saldırgan.</p>
    <h3>🧚 Peri Ormanı</h3><p>Pembe/mor ağaçlar, ışıltı. Peri sandıkları tıbbi verir; çevre hafif <b>akıl huzuru</b> sağlar. Geceleri periler saldırganlaşır.</p>
    <h3>🌋 Volkanik Bölge</h3><p>En tehlikeli. <b>Sürekli sıcak hasarı + susuzluk</b>. 🔴 Ruby sandıkları + 🔥 Cehennem Kılıcı. <b>Cultist King boss</b> (gün 8+) burada. Gir-al-çık.</p>
    <h3>🕳️ Mağara</h3><p>Zifiri karanlık — <b>🔦 El feneri şart</b>. Bol hurda + maden + 🪖 askeri mühimmat kasası. Örümcekler ve Taklitçi sadece burada.</p>` },
  { t: "🪓 Alet & Silah", h: `
    <h3>Baltalar (ağaç kes)</h3><p>Eski (yavaş) → İyi (2 vuruş) → Güçlü (tek vuruş) → <b>🪚 Motorlu Testere</b> (BASILI tut, en hızlı). Tezgahta üret veya sandıktan bul.</p>
    <h3>Menzilli (Q kuşan · R/sağ tık ateş)</h3><p>🔫 Tabanca, 💥 Pompalı (yakın), 🎯 Tüfek (uzak), 🏹 Yay/Arbalet (sessiz). Mermi sandıklardan/mühimmat kasasından.</p>
    <h3>Yakın dövüş (Z değiştir)</h3><p>🗡️ Mızrak, 🧊 Buz Baltası (yavaşlat), 🧪 Zehirli Mızrak, ⚔️ Katana (hızlı), 🔨 Topuz (geri iter), 🔥 Cehennem Kılıcı (yakar + et pişmiş düşer).</p>
    <p><b>İpucu:</b> Motorlu testere/silah SES çıkarır, tehlikeyi çeker; sessiz av için yay kullan.</p>` },
  { t: "📦 Eşya & Loot", h: `
    <h3>Sandık türleri</h3><p>Normal · Ruby (volkan) · Soğuk (kar) · Peri · 🪖 Askeri Mühimmat Kasası (mağara). Renk/tema seni yönlendirir.</p>
    <h3>Kaynaklar</h3><p>🪵 Odun · ⚙️ Hurda (craft/ticaret) · 🧶 Kumaş · 🪢 Halat · 💎 Mücevher (kristal kaz).</p>
    <h3>Tıbbi (B tuşu)</h3><p>🩹 Bandaj (+can/dirilt) · 🧰 Sağlık Çantası (+75) · 💊 Ağrı kesici (+can +enerji). Öncelik: çanta→hap→bandaj.</p>
    <h3>Yeme/İçme (G tuşu)</h3><p>🥫 Konserve · 🍫 Çikolata · 💧 Su · 🥤 Kola · 🍗 Pişmiş et. Susuzluk acilse önce içer.</p>` },
  { t: "🔥 Hayatta Kalma", h: `
    <h3>Barlar</h3><p>❤️ Can · 🍖 Açlık · 💧 Susuzluk · 🔥 Isı · 🧠 Akıl · ⚡ Enerji. Biri sıfırlanırsa can yakar.</p>
    <h3>Kamp ateşi</h3><p>Merkezi ateşe <b>F</b> ile odun at. Ne kadar odun = o kadar uzun yanar + seviye atlar (güvenli alan büyür). Ateş yanı = ısı + akıl + güvenlik.</p>
    <h3>Gece & hava</h3><p>Gece yaratıklar gelir; ateş/meşale/totem yanında güvendesin. Yağmur ateşi çabuk söndürür; fırtınada yıldırıma karşı ⚡ Paratoner kur.</p>
    <h3>Uyku (T)</h3><p>Yatak kurup güvendeyken uyu → sabaha atla. Tehlike yakınken uyuyamazsın.</p>` },
  { t: "🎮 Kontroller", h: `
    <h3>Masaüstü</h3><p><b>WASD</b> hareket · <b>fare</b> bak · <b>Shift</b> koş · <b>E/sol tık</b> vur/topla · <b>F</b> ateşe odun · <b>G</b> ye/iç · <b>B</b> iyileş/dirilt · <b>T</b> uyu · <b>C</b> tezgah · <b>M</b> harita.</p>
    <p><b>Q</b> menzilli silah değiştir · <b>Z</b> yakın dövüş değiştir · <b>R / sağ tık</b> ateş et · <b>L</b> el feneri · <b>V</b> bas-konuş (sesli sohbet).</p>
    <h3>Mobil</h3><p>Sol joystick hareket · sağ ekran bak · butonlar: VUR, 🔫 ateş, 🔁 silah, 🔥 odun, 🍗 ye, 🩹 iyileş, KOŞ, 🔦 fener, 🛠️ tezgah.</p>` },
  { t: "🎭 Sınıf & Üs", h: `
    <h3>Sınıflar (yeni oyunda seç)</h3><p>🪓 Oduncu (İyi Balta+hızlı kesim) · ➕ Sağlıkçı (bol tıbbi+%50 iyileşme) · 🔧 Toplayıcı (ekstra hurda+bol ganimet) · 🗡️ Suikastçı (Katana+hızlı vuruş).</p>
    <h3>🛡️ Zırh</h3><p>Sandık/tezgahtan zırh kuşan; yaratık hasarını %20-50 azaltır, yıprandıkça KIRILIR (açlık/soğuğu engellemez). HUD'da 🛡️% görünür.</p>
    <h3>🧵 Kürk Tüccarı</h3><p>Avdan çıkan postu (5) götür → kademeli ödül: 1. takas İyi Balta, 4. takas Güçlü Balta, arada tıbbi/metal. Hurdacı ise 5⚙️→🩹+🪵.</p>
    <h3>🧱 Üs bakımı</h3><p>Tomruk duvarlar zamanla (fırtınada hızlı) çürür → 🔨 Çekiç ile odun harcayıp tamir et. ⚖️ Aşırı yük yavaşlatır — 🎒 Çanta yükseltmesi limiti artırır.</p>
    <h3>🚁 Final</h3><p>100. günü çıkınca kurtarma helikopteri gelir — kazandın!</p>` },
  { t: "💡 İpuçları", h: `
    <ul>
    <li>İlk günler: odun stokla, ateşi büyüt, tezgahı (kampta) kullanıp <b>İyi Balta + Yatak</b> yap.</li>
    <li>Yapıları <b>ateşin yakınına KUR</b> (üret → 🎒 Kurulacaklar → KUR, hayalet önizleme).</li>
    <li>Kürk/hurda biriktir; hurdacıyla takas et (5⚙️→🩹+🪵).</li>
    <li>Uç biyoma <b>hazırlıkla</b> gir: kara ısı/ateş, mağaraya fener+pil, volkana tıbbi + çıkış planı.</li>
    <li>Petrol Sondajı + tarla + güveç ile üssü <b>otomatikleştir</b>; 100. güne hazır var.</li>
    </ul>` },
];
let guideOpen = false, guideTab = 0;
function renderGuide() {
  const tabs = $("guideTabs"), body = $("guideBody"); if (!tabs || !body) return;
  tabs.innerHTML = "";
  GUIDE.forEach((s, i) => { const b = document.createElement("button"); b.className = "guide-tab" + (i === guideTab ? " on" : ""); b.textContent = s.t; b.addEventListener("click", () => { guideTab = i; renderGuide(); }); tabs.appendChild(b); });
  body.innerHTML = GUIDE[guideTab].h;
}
function openGuide() { guideOpen = true; renderGuide(); $("guide").classList.remove("hidden"); if (document.exitPointerLock) document.exitPointerLock(); }
function closeGuide() { guideOpen = false; $("guide").classList.add("hidden"); }
{ const gc = $("guide-close"); if (gc) gc.addEventListener("click", closeGuide); }
{ const pg = $("pz-guide"); if (pg) pg.addEventListener("click", () => { closePause(); openGuide(); }); }

/* ----------------------- GÜNCELLEME NOTLARI (ana ekran update log) ----------------------- */
const GAME_VERSION = "3.7";   // görünen sürüm (version.json ile aynı tut)
const CHANGELOG = [
  { v: "3.7", d: "8 Tem", items: [
    "✋ Yerdeki eşyaya bak + E (mobilde VUR) → DOĞRUDAN envantere gelir (artık sürüklemiyorsun).",
    "⬇️ BACKSPACE (mobilde ⬇️ buton) → eşya bırak menüsü: kaynakları yere at (×5 veya tümü) → arkadaşın E ile alabilir. Co-op'ta herkeste görünür (senkron).",
    "🪂 Bırakılan eşyalar artık DÜZGÜN FİZİKLE düşüyor: öne fırlar, yere zıplar, oturur.",
  ] },
  { v: "3.6", d: "8 Tem", items: [
    "🔫 MERMİ ÜRETİMİ eklendi (tezgah): metalden 🔫 tabanca mermisi (Tier 2, 3⚙️→8), 💥 fişek (Tier 3, 4⚙️→4) ve 🎯 tüfek mermisi (Tier 3, 3⚙️+1💎→5). Silahların kurusun diye endişelenme — metalini mermiye çevir!",
  ] },
  { v: "3.5", d: "8 Tem", items: [
    "📦 DEPO SANDIĞI eklendi: kampta hazır bir tane var (ayrıca tezgahta üretip başka yere de kurabilirsin: 16🪵 + 2⚙️). Ağır kaynakları (odun/metal/mücevher/post...) içine bırak → çantan hafifler, aşırı yükten yavaşlamazsın. Yatır/çek paneli. İçindekiler DEVAM ET ile korunur.",
  ] },
  { v: "3.4", d: "8 Tem", items: [
    "🎣 BALIK TUTMA eklendi: tezgahta 🎣 Olta üret (5🪵 + 1 ip), göl kenarına git → VUR/E ile oltayı at, birkaç saniye bekle → çiğ balık yakala (ateşte pişir). Yenilenebilir bir yemek kaynağı — göllerin artık bir işi daha var!",
  ] },
  { v: "3.3", d: "8 Tem", items: [
    "🪦 TERK EDİLMİŞ MEZARLIK eklendi (yeni horror POI): mezar taşları, kripta/mozole, ölü ağaç, soluk kızıl ışıltı. Kriptanın önünde gizli ASKERİ KASA + sandıklar. GECELERİ yakınında akıl daha hızlı erir ve fısıltılar duyulur — riskli ama ganimetli.",
  ] },
  { v: "3.2", d: "7 Tem", items: [
    "💧 GÖLLERDEN SU İÇME: göl kenarına git → G (mobilde YE butonu) ile BEDAVA su iç (susuzluk +32). Şişe suyunu harcamaz ama kirli su ~%14 hafif hastalık riski taşır. Göller artık mini haritada mavi görünüyor + kenarında 'su iç' ipucu çıkıyor.",
  ] },
  { v: "3.1", d: "7 Tem", items: [
    "🚁 DÜŞMÜŞ HELİKOPTER ENKAZI eklendi (yeni POI): yanmış gövde, kopmuş kuyruk, dağılmış enkaz + 2 MÜHİMMAT KASASI ve hurda. Silah/mermi arıyorsan buraya bak!",
    "🐛 Düzeltme: co-op'ta bayılıp/ölüp izleyici olunca oto-kayıt seni ~0 canla kaydediyordu → 'DEVAM ET' yarı ölü başlatıyordu. Artık düşük/ölü/izleyici iken kayıt yapılmaz (son sağlıklı kayıt korunur).",
  ] },
  { v: "3.0", d: "7 Tem", items: [
    "🎚️ ZORLUK SEÇİMİ eklendi (Yeni Oyun ekranı): 🙂 Kolay / 😐 Normal / 💀 Zor. Zorluk, gelen HASARI ve AÇLIK/SUSUZLUK tüketimini ayarlar. DEVAM ET ile zorluğun korunur.",
    "🐛 Düzeltme: 🧨 dinamit (X) artık menü/duraklatma/inşa modundayken yanlışlıkla patlamıyor.",
  ] },
  { v: "2.9", d: "7 Tem", items: [
    "🧨 DİNAMİT eklendi (tezgah Tier 3: 5⚙️ + 1💎): X tuşu (mobilde 🧨 buton) ile öne fırlat → patlar; çevredeki KRİSTALLERİ kazar (💎) + hurdaları toplar + yakındaki düşmanları vurur. Madende çok işine yarar!",
    "🐛 Düzeltme: madende oto-kayıt olunca 'DEVAM ET' seni boş/görünmez bir köşeye ışınlıyordu — artık yüzeydeki maden girişine dönüyorsun, ilerleme korunuyor.",
  ] },
  { v: "2.8", d: "7 Tem", items: [
    "🚀 PERFORMANS MODU (Ayarlar → 'Performans modu'): oyun kasıyorsa aç — ağır efektler (bloom/AO/vignette) kapanır + çözünürlük optimize edilir → çok daha akıcı. Mobilde otomatik açık.",
    "💬 CO-OP GLOBAL SOHBET: oyun içinde Y (veya Enter) ile mesaj yaz → tüm oyunculara gider (mobilde 💬 buton). Gelen mesajlar ekranda + bildirimde görünür.",
    "🛡️ Admin yetkisini SEÇTİĞİN kişilere ver: host (oda kuran) isen admin panelinde oyuncunun yanındaki '🛡️' ile o kişiye admin açarsın.",
    "💾 Güncelleme artık oyun İÇİNDEYKEN de çıkıyor — çıkmadan önce oyun otomatik KAYDEDİLİR (+ ~25s'de bir oto-kayıt). Güncelleyip açınca 'DEVAM ET' ile kaldığın yerden (gün/eşya/can) sürersin.",
  ] },
  { v: "2.7", d: "7 Tem", items: [
    "🕷️👑 MADEN KRALİÇESİ eklendi! Derin madende oyalanırsan dev bir örümcek BOSS uyanır (can barı çıkar). Yen → ⛏️ Kazma + bol 💎 mücevher + ⚙️ ganimet düşer. Çıkışa koşarsan geride kalır (tekrar girince yeniden uyanır).",
    "🐛 Düzeltme: boss can barı artık yalnızca boss yakındayken görünüyor (uzaktaki/başka bölgedeki boss barı ekranda takılı kalmıyor) ve boss ismi doğru gösteriliyor.",
  ] },
  { v: "2.6", d: "7 Tem", items: [
    "🗺️ Maden girişi artık mini haritada MOR işaretle gösteriliyor — kolayca bulunur.",
    "⛏️ Derin madende sandıklardan yüksek şansla KAZMA çıkıyor (bulduğun kristalleri kazabilmen için).",
    "🐛 Düzeltme: gizli madenin ganimeti/örümcekleri/oyuncuları büyük haritada (M) yanlışlıkla görünüyordu — artık bulunduğun katmana göre gizli.",
  ] },
  { v: "2.5", d: "7 Tem", items: [
    "🕷️ Derin maden artık daha ürkütücü: inince kalp atışı hızlanır, fısıltılar duyulur, mağara örümceği baskısı biraz arttı. El fenerini açık tut!",
    "🐛 Düzeltme: madendeki gizli eşyalarla (sandık/kristal) yanlışlıkla yüzeyden etkileşim kurulabiliyordu — artık maden ganimeti yalnızca madendeyken toplanır.",
    "🔧 Ufak sağlamlık iyileştirmeleri (maden durumu yeni oyunda temiz sıfırlanır).",
  ] },
  { v: "2.4", d: "7 Tem", items: [
    "⛏️ DERİN MADEN eklendi! Yüzeyde bir MADEN GİRİŞİ (raylı tünel ağzı, fenerli) var — 'Madene in' deyince EKRAN KARARIR ve seni gizli madene ışınlar. Maden çok uzakta, yüzeyden görünmez.",
    "🕯️ Maden içi: ışıyan mavi maden damarları, ahşap galeri destekleri, maden arabası, kızıl horror ışıltısı ve kemikler. El fenerini aç (🔦 L). Bol ganimet: hurda, kristal, mühimmat sandığı.",
    "🪜 Çıkış: madenin içindeki ışıklı ÇIKIŞ kapısına git → ekran kararır → girdiğin yere geri dönersin. Co-op'ta herkes ayrı ayrı inip çıkabilir.",
  ] },
  { v: "2.3", d: "6 Tem", items: [
    "🎨 Zemin artık biyoma göre DEĞİŞİYOR (eskiden her yer orman yeşiliydi, karışık görünüyordu): ❄️ kar bölgesi karla kaplı · 🌋 volkanik yanmış kaya + ışıyan lav çatlakları · 🧚 peri ormanı mor yosun + parlayan sporlar.",
    "🕳️ Mağara/maden yenilendi: duvarlarda ışıyan mavi maden damarları (kristal), kızıl horror ışıltısı, yerde eski kemikler.",
  ] },
  { v: "2.2", d: "6 Tem", items: [
    "🔧 'Güncelle' butonu düzeltildi: artık indirme sayfasını SİSTEM tarayıcısında açıyor (Windows/Tauri · macOS-Linux/Electron · Android). Açılmazsa link panoya kopyalanır.",
    "🔄 Web sürümünde 'güncelle' butonu kendini günceller (sayfa yenilenip yeni sürümü çeker).",
  ] },
  { v: "2.1", d: "6 Tem", items: [
    "⭐ Admin özel eşyaları (99 Nights wiki): 🔫 Admin Silahı (sınırsız mermi, her şeyi tek atar), 🪓 Admin Baltası (ağaçları tek vuruşta devirir), ⭐ Admin Eşyaları (hepsini tek tuşla ver).",
  ] },
  { v: "2.0", d: "6 Tem", items: [
    "🔒 Admin artık GİZLİ KOD ile açılıyor (SHA-256; kod repoda yok, sadece hash) — e-posta git'te göründüğü için çok daha güçlü. Kodu bir kez gir, cihaza kaydedilir.",
    "💥 Admin: 'Tek Vuruş Öldür' — vurduğun her yaratık anında ölür.",
    "🔔 Zorunlu güncelleme kapısı artık ana dalda canlı (yeni sürüm çıkınca eski istemcilerde 'güncelle' ekranı çıkar).",
  ] },
  { v: "1.9", d: "6 Tem", items: [
    "🛡️ ADMİN PANELİ eklendi — YALNIZCA hesap sahibine açık (kendi e-postanla giriş yap). \\ veya P tuşu · Duraklat → Admin · mobilde 🛡️ buton: God Mode, Uçuş, Noclip, Sonsuz Enerji, hız, ışınlanma.",
    "🌍 Admin: gün/saat/hava/Kanlı Ay kontrolü, zamanı dondur, ihtiyaç doldurma, olumsuz efekt temizleme.",
    "🎒 Admin: eşya çağırma (kaynak/silah/alet/tıbbi/yiyecek) + tek tuşla HEPSİNİ VER.",
    "👹 Admin: yaratık/boss çağırma, tümünü temizleme, AI kapatma; co-op'ta oyuncu atma (host).",
  ] },
  { v: "1.8", d: "6 Tem", items: [
    "🌍 Dünya ~%45 büyüdü (215→260m) + kenarda belirgin sınır uyarısı (artık 200m sonrası boşluk yok).",
    "📦 Sandıklar artık TEK eşya düşürüyor (ışınlanmıyor): yerden AL, taşı, ateşe/tezgaha götürüp bırak (sürükle-taşı). Mobilde VUR ile al/bırak.",
    "🎮 Co-op lobi listesi: bağlı oyuncular doğru isimleriyle görünür.",
  ] },
  { v: "1.7", d: "6 Tem", items: [
    "💀 Co-op ölüm akışı: TÜM oyuncular yere düşünce oyun biter. Bandaj süresi biterken arkadaşın hayattaysa 'İzle / Lobiye Dön' seçeneği gelir (ölü oyuncu artık kimseyi kurtaramaz).",
    "🏷️ Co-op isim karışması düzeltildi — herkes doğru isimle görünür.",
    "🔔 Zorunlu güncelleme kapısı: yeni sürüm çıkınca güncellemeden devam edilemez.",
    "📜 Tezgah listesi artık kaydırılabiliyor — en üstteki tarif görünüyor.",
  ] },
  { v: "1.6", d: "6 Tem", items: [
    "👹 Jumpscare düzeltmesi: yaratık artık YÜZÜYLE göz hizasında ekranı kaplıyor (eskiden bacaklarını görüyordun) ve aydınlatılıyor — gerçekten canavara benziyor.",
    "🐛 Yakalayıştan sonra önceki oyundan kalan dev yaratık modeli (İzleyen/Taklitçi) sahnede takılı kalmıyor.",
  ] },
  { v: "1.5", d: "6 Tem", items: [
    "🐛 Co-op'ta seni yakalayan yaratığın ekranda dev gibi takılı kalması giderildi.",
    "🛠️ Tezgah açma mesafesi biraz genişletildi (daha rahat).",
    "📱 Mobilde hızlı silah çubuğu artık joystick'i engellemiyor.",
  ] },
  { v: "1.4", d: "6 Tem", items: [
    "📋 Ana menüye 'Güncelleme Notları' (bu ekran) eklendi — her sürümde ne değiştiğini gör.",
  ] },
  { v: "1.3", d: "6 Tem", items: [
    "🖤→✨ Metaller ve su artık siyah-mavi görünmüyor — gökyüzü yansıması (env) eklendi.",
    "🛠️ Tezgah yalnızca yanına gidince açılır (uzaktan C ile açılmaz).",
    "🔢 1-0 tuşları / dokunmatik slot çubuğuyla kolay silah değiştirme (mobil dahil).",
  ] },
  { v: "1.2", d: "5 Tem", items: [
    "🌐 Co-op üs senkronu: kurulan yapılar, tezgah tier'ı ve ateş seviyesi herkeste görünür.",
    "⚡ 4 haneli oda koduyla kolay co-op — uzun ID kopyalamaya son.",
    "🔔 Açılışta 'yeni sürüm var' uyarısı.",
  ] },
  { v: "1.1", d: "5 Tem", items: [
    "☀️🌙 Güneş ve ay renk düzeltmesi (artık mavi-siyah değil).",
    "👹 Jumpscare yalnızca yaratık seni yakalayınca gelir ve o yaratığın kendisidir — tek vuruşta öldürür.",
  ] },
  { v: "1.0", d: "4 Tem", items: [
    "🦘 Zıplama (SPACE / ⤴️ butonu).",
    "🎤 'Kim konuşuyor' ses göstergesi (mobil dahil).",
    "💧 Su render + başlangıç çökmesi düzeltmeleri.",
  ] },
  { v: "0.9", d: "3 Tem", items: [
    "🗺️ 5 biyom: Orman · Karlı · Peri · Mağaralar · Volkanik.",
    "🌋👑 Cultist King boss + karanlık, içine girilen mağaralar.",
  ] },
  { v: "0.8", d: "2 Tem", items: [
    "🪓🔫 Tam eşya sistemi: baltalar+testere, ateşli silahlar+mermi, özel yakın dövüş, tıbbi, yiyecek/içecek+susuzluk, el feneri.",
    "💎 Değerli taş ekonomisi + Tier 1-5 tezgah üretimi.",
  ] },
];
function renderChangelog() {
  const list = $("changelogList"); if (!list) return;
  list.innerHTML = CHANGELOG.map((e) =>
    `<div class="chlog-entry"><div class="chlog-head"><b>v${e.v}</b><span>${e.d}</span></div>` +
    `<ul class="chlog-items">${e.items.map((i) => `<li>${escapeHtml(i)}</li>`).join("")}</ul></div>`
  ).join("");
  const cv = $("chlogVer"); if (cv) cv.textContent = "Şu anki sürüm: v" + GAME_VERSION;
}
let changelogOpen = false;
function openChangelog() { changelogOpen = true; renderChangelog(); $("changelog").classList.remove("hidden"); if (document.exitPointerLock) document.exitPointerLock(); }
function closeChangelog() { changelogOpen = false; $("changelog").classList.add("hidden"); }
{ const cc = $("changelog-close"); if (cc) cc.addEventListener("click", closeChangelog); }
{ const cb = $("changelogBtn"); if (cb) { cb.textContent = "📋 YENİLİKLER · v" + GAME_VERSION; cb.addEventListener("click", openChangelog); } }
{ const pc = $("pz-changelog"); if (pc) pc.addEventListener("click", () => { closePause(); openChangelog(); }); }

/* ===================== 🛡️ ADMİN PANELİ (oyun içi hile menüsü) ===================== */
// SAHİPLİK KİLİDİ: admin GİZLİ KOD ile açılır (SHA-256). Kod repoda/bundle'da YOK — yalnızca
// tersine çevrilemez hash var. Kodu bir kez girince cihaza kaydedilir. (E-posta git commit'lerinde
// göründüğü için artık kullanılmıyor; kod çok daha güçlü.)
async function sha256hex(s) { const b = new TextEncoder().encode(s); const h = await crypto.subtle.digest("SHA-256", b); return [...new Uint8Array(h)].map((x) => x.toString(16).padStart(2, "0")).join(""); }
const ADMIN_HASH = "06973d7c5b268b5185517b7df738e1ac8e805e95561fd8870fea0862e1da80a9";
function adminUnlocked() { try { return LS.getItem("orm_adminOK") === "1"; } catch (e) { return false; } }
function applyAdminVisibility() { const pa = $("pz-admin"), ba = $("btn-admin"); if (pa) pa.style.display = ""; if (ba) ba.style.display = ""; }   // buton herkese görünür; asıl kilit KODDADIR
let adminOpen = false;
const adminMsg = (t) => toast("🛡️ " + t, "good");
function giveResources() { for (const k of ["wood", "metal", "cloth", "rope", "pelt"]) S.inv[k] += 50; S.inv.gem += 10; adminMsg("Kaynaklar +50 · 💎+10"); if (craftOpen) renderCraft(); }
function giveFoodWater() { S.inv.cooked += 20; S.inv.canned += 10; S.inv.water += 20; S.inv.soda += 5; S.inv.choco += 5; adminMsg("Yiyecek/içecek dolduruldu"); }
function giveWeapons() { for (const k in S.weapons) S.weapons[k] = true; for (const k of ["pistolAmmo", "shells", "rifleAmmo", "arrows"]) S.inv[k] += 99; for (const k of MELEE_ORDER) giveMelee(k); S.tools.axe = 2; S.tools.chainsaw = true; adminMsg("Tüm silahlar + mermi"); updateHotbarHUD(); }
function giveTools() { S.tools.axe = Math.max(S.tools.axe || 0, 2); S.tools.pickaxe = true; S.tools.hammer = true; S.tools.chainsaw = true; S.flashlight = true; S.battery = 100; S.inv.batteries += 10; S.hasMap = true; S.hasCompass = true; adminMsg("Tüm aletler"); }
function giveMedical() { S.inv.bandage += 20; S.inv.medkit += 10; S.inv.pills += 10; adminMsg("Tıbbi malzeme"); }
function giveAll() { giveResources(); giveFoodWater(); giveWeapons(); giveTools(); giveMedical(); giveArmor(0.5, "Mücevher Zırhı"); adminMsg("🎁 HERŞEY verildi!"); }
// ⭐ ADMIN ÖZEL EŞYALARI (99 Nights wiki: Admin Gun / Admin Axe / Admin Items)
function giveAdminGun() { S.weapons.admingun = true; S.inv.adminAmmo = 999; S.equip = "admingun"; adminMsg("🔫 Admin Silahı — sınırsız mermi, her şeyi tek atar"); updateHotbarHUD(); }
function giveAdminAxe() { S.tools.axe = 3; adminMsg("🪓 Admin Baltası — ağaçlar tek vuruşta devrilir"); }
function giveAdminItems() { giveAdminGun(); giveAdminAxe(); for (const k of MELEE_ORDER) giveMelee(k); giveArmor(0.5, "Mücevher Zırhı"); S.inv.gem += 99; giveTools(); giveMedical(); S.tools.chainsaw = true; adminMsg("⭐ Tüm admin eşyaları verildi"); updateHotbarHUD(); }
function adminHeal() { S.health = 100; S.hurt = 0; S.sick = 0; S.bleed = 0; adminMsg("İyileştin %100"); }
function adminMaxNeeds() { S.hunger = 100; S.thirst = 100; S.warmth = 100; S.stamina = 100; adminMsg("İhtiyaçlar dolu"); }
function adminClearEffects() { S.sick = 0; S.bleed = 0; S.sanity = 100; S.warmth = Math.max(S.warmth, 70); adminMsg("Efektler temizlendi"); }
function adminTeleportCamp() { if (baseFire) { camera.position.set(baseFire.x, CFG.EYE, baseFire.z + 3); adminMsg("Kampa ışınlandın"); } }
function adminTeleportSpawn() { camera.position.set(0, CFG.EYE, 0); adminMsg("Başlangıca ışınlandın"); }
function adminSetDay(d) { S.day = clamp(d | 0, 1, 100); adminMsg("Gün → " + S.day); }
function adminSetTime(f) { S.time = clamp(f, 0, 0.999); }
function adminSkipNight() { S.time = 0.72; adminMsg("Geceye atlandı"); }
function adminSkipDay() { S.time = 0.18; S.day = Math.min(100, S.day + 1); adminMsg("Ertesi gün"); }
function adminWeather(w) { S.weather = w; S.weatherT = rnd(30, 60); adminMsg("Hava: " + w); }
function adminBloodMoon() { S.bloodMoon = !S.bloodMoon; adminMsg("Kanlı Ay: " + (S.bloodMoon ? "AÇIK" : "kapalı")); }
function adminKillAll() { for (const a of animals) scene.remove(a.group); animals.length = 0; bossAlive = false; if (watcher) vanishWatcher(true); adminMsg("Tüm yaratıklar temizlendi"); }
function adminSpawn(kind) {
  if (kind === "watcher") spawnWatcher(true); else if (kind === "jaguar") spawnJaguar(); else if (kind === "crawler") spawnCrawler();
  else if (kind === "mimic") spawnMimic(); else if (kind === "boss") spawnCultistKing(); else spawnBeast(kind);
  adminMsg(kind + " çağrıldı");
}
function adminKick(id) { const c = net.conns[id]; if (c) { try { c.close(); } catch (e) {} } adminMsg("Atıldı: " + (remoteName[id] || id)); }
function admBtn(label, fn) { const b = document.createElement("button"); b.className = "adm-btn"; b.textContent = label; b.addEventListener("click", () => { if (S && S.running) fn(); }); return b; }
function admTog(label, key) {
  const b = document.createElement("button"); const paint = () => { b.className = "adm-btn adm-tog" + (admin[key] ? " on" : ""); b.textContent = (admin[key] ? "✅ " : "⬜ ") + label; }; paint();
  b.addEventListener("click", () => { admin[key] = !admin[key]; paint(); adminMsg(label + ": " + (admin[key] ? "AÇIK" : "kapalı")); }); return b;
}
function admSec(t) { const h = document.createElement("div"); h.className = "adm-sec"; h.textContent = t; return h; }
function admRow(...els) { const r = document.createElement("div"); r.className = "adm-row"; els.forEach((e) => r.appendChild(e)); return r; }
function buildAdminUnlock(body) {   // kilitliyken: gizli kod iste
  const s = admSec("🔒 Admin kilitli — gizli kodu gir"); body.appendChild(s);
  const inp = document.createElement("input"); inp.type = "password"; inp.className = "adm-num"; inp.style.width = "100%"; inp.style.marginBottom = "8px"; inp.placeholder = "Admin kodu";
  const msg = document.createElement("div"); msg.style.cssText = "color:#ff9a9a;font-size:12.5px;min-height:16px;margin-top:6px";
  const go = async () => { try { const h = await sha256hex((inp.value || "").trim()); if (h === ADMIN_HASH) { try { LS.setItem("orm_adminOK", "1"); } catch (e) {} adminMsg("Admin kilidi açıldı ✓"); buildAdminPanel(); } else msg.textContent = "❌ Yanlış kod."; } catch (e) { msg.textContent = "Hata: " + e.message; } };
  const btn = admBtn("🔓 Kilidi Aç", go); btn.style.marginTop = "4px";
  inp.addEventListener("keydown", (e) => { if (e.key === "Enter") go(); });
  body.append(inp, btn, msg);
}
function buildAdminPanel() {
  const body = $("adminBody"); if (!body || !S) return; body.innerHTML = "";
  if (!adminUnlocked()) { buildAdminUnlock(body); return; }   // kod girilmemişse yalnızca kilit ekranı
  const add = (...e) => e.forEach((x) => body.appendChild(x));
  add(admSec("1) 🧍 Oyuncu"),
    admRow(admTog("God Mode", "god"), admTog("Uçuş", "fly"), admTog("Noclip", "noclip"), admTog("Sonsuz Enerji", "infStam")),
    admRow(admBtn("❤️ İyileş", adminHeal), admBtn("💀 Kendini öldür", () => die("admin")), admBtn("🏕️ Kampa ışınlan", adminTeleportCamp), admBtn("📍 Başlangıca", adminTeleportSpawn)));
  { const r = document.createElement("div"); r.className = "adm-slider"; r.innerHTML = "<span>⚡ Hız</span>"; const s = document.createElement("input"); s.type = "range"; s.min = "0.5"; s.max = "6"; s.step = "0.5"; s.value = admin.speed; const v = document.createElement("b"); v.textContent = admin.speed + "x"; s.addEventListener("input", () => { admin.speed = +s.value; v.textContent = admin.speed + "x"; }); r.append(s, v); add(r); }
  add(admSec("2) 🌍 Zaman & Dünya"),
    admRow(admTog("Zamanı Dondur", "freezeTime"), admBtn("🌙 Geceye atla", adminSkipNight), admBtn("☀️ Ertesi gün", adminSkipDay), admBtn("🔴 Kanlı Ay", adminBloodMoon)));
  { const r = document.createElement("div"); r.className = "adm-slider"; r.innerHTML = "<span>📅 Gün</span>"; const n = document.createElement("input"); n.type = "number"; n.min = "1"; n.max = "100"; n.value = S.day; n.className = "adm-num"; r.append(n, admBtn("Ayarla", () => adminSetDay(+n.value))); add(r); }
  { const r = document.createElement("div"); r.className = "adm-slider"; r.innerHTML = "<span>🕐 Saat</span>"; const t = document.createElement("input"); t.type = "range"; t.min = "0"; t.max = "0.99"; t.step = "0.01"; t.value = S.time; t.addEventListener("input", () => adminSetTime(+t.value)); r.append(t); add(r); }
  add(admRow(admBtn("☀️ Açık hava", () => adminWeather("clear")), admBtn("🌧️ Yağmur", () => adminWeather("rain"))));
  add(admSec("3) 🍖 Hayatta Kalma"),
    admRow(admBtn("🍖 Açlık dolu", () => { S.hunger = 100; adminMsg("Açlık %100"); }), admBtn("💧 Susuzluk dolu", () => { S.thirst = 100; adminMsg("Susuzluk %100"); }), admBtn("🧊 İhtiyaçlar dolu", adminMaxNeeds), admBtn("✨ Efektleri temizle", adminClearEffects)));
  add(admSec("4) 🎒 Eşya Çağırma"),
    admRow(admBtn("🪵 Kaynaklar", giveResources), admBtn("🍗 Yiyecek/Su", giveFoodWater), admBtn("🔫 Silahlar", giveWeapons), admBtn("🛠️ Aletler", giveTools), admBtn("🩹 Tıbbi", giveMedical)),
    admRow(admBtn("🎁 HEPSİNİ VER", giveAll)));
  add(admSec("5) 👹 Yaratık & Sunucu"),
    admRow(admBtn("👁️ İzleyen", () => adminSpawn("watcher")), admBtn("🐆 Jaguar", () => adminSpawn("jaguar")), admBtn("🕷️ Sürünen", () => adminSpawn("crawler")), admBtn("🎭 Taklitçi", () => adminSpawn("mimic")), admBtn("👑 BOSS", () => adminSpawn("boss"))),
    admRow(admTog("AI Kapat (dondur)", "noAI"), admTog("💥 Tek Vuruş Öldür", "oneHit"), admBtn("🧹 Tümünü temizle", adminKillAll)));
  add(admSec("6) ⭐ Admin Eşyaları"),
    admRow(admBtn("🔫 Admin Silahı", giveAdminGun), admBtn("🪓 Admin Baltası", giveAdminAxe), admBtn("⭐ Admin Eşyaları (hepsi)", giveAdminItems)));
  if (net.online && net.host && net.peerCount() > 0) { const r = admRow(); for (const id of net.peerIds()) r.appendChild(admBtn("🛡️ " + (remoteName[id] || id), () => adminGrant(id))); add(admSec("🛡️ Admin Yetkisi Ver (seçtiğin kişiye — sen host isen)"), r); }
  if (net.online && net.peerCount() > 0) { const r = admRow(); for (const id of net.peerIds()) r.appendChild(admBtn("🚪 " + (remoteName[id] || id) + " at", () => adminKick(id))); add(admSec("👥 Oyuncuları At"), r); }
}
function toggleAdmin() {
  const el = $("admin"); if (!el || !S || !S.running) return;
  adminOpen = !adminOpen;
  if (adminOpen) { buildAdminPanel(); el.classList.remove("hidden"); if (document.exitPointerLock) document.exitPointerLock(); }
  else { el.classList.add("hidden"); if (!isTouch && threeCanvas.requestPointerLock) threeCanvas.requestPointerLock(); }
}
{ const ac = $("admin-close"); if (ac) ac.addEventListener("click", () => { adminOpen = false; $("admin").classList.add("hidden"); }); }
{ const pa = $("pz-admin"); if (pa) pa.addEventListener("click", () => { closePause(); toggleAdmin(); }); }
{ const ab = $("btn-admin"); if (ab) { ab.addEventListener("click", () => toggleAdmin()); ab.addEventListener("touchstart", (e) => { isTouch = true; toggleAdmin(); e.preventDefault(); }, { passive: false }); } }

resize();
// Render döngüsü: sahne kurulmadan da (menüde) FX katmanını temiz tutar; START ile sahne kurulur.
function rafLoop() { loop(); requestAnimationFrame(rafLoop); }
requestAnimationFrame(rafLoop);
