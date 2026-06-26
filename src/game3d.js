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

const CFG = { WORLD: 165, DAY_LENGTH: 165, WIN_DAY: 100, TREES: 760, BUSHES: 320, ROCKS: 70, GRASS: 1000, VINES: 160, EYE: 1.7, SCRAP: 70, CHESTS: 26, HOUSES: 9 };

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
let renderer, scene, camera, sun, hemi, amb, headlamp, moon, fireflies;
let shadowsOn = false;
let composer = null, postOn = false, postTried = false, grainPass = null;
const clock = new THREE.Clock();
let built = false;

function buildScene() {
  renderer = new THREE.WebGLRenderer({ canvas: threeCanvas, antialias: true, powerPreference: "high-performance" });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;   // sinematik renk
  renderer.toneMappingExposure = 1.12;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  // gölgeler ağır olduğundan yalnızca dokunmatik olmayan (masaüstü) cihazlarda
  shadowsOn = !("ontouchstart" in window) && !(window.matchMedia && window.matchMedia("(pointer: coarse)").matches);
  if (shadowsOn) { renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap; }

  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x9fb7a0);
  scene.fog = new THREE.FogExp2(0x9fb7a0, 0.014);

  camera = new THREE.PerspectiveCamera(72, window.innerWidth / window.innerHeight, 0.1, 600);
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

  // zemin (prosedürel doku)
  const gtex = groundTexture();
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(CFG.WORLD * 2 + 20, CFG.WORLD * 2 + 20),
    new THREE.MeshStandardMaterial({ map: gtex, roughness: 1, metalness: 0 })
  );
  ground.rotation.x = -Math.PI / 2; if (shadowsOn) ground.receiveShadow = true; scene.add(ground);

  buildTrees();
  setupTreeModel();               // gerçek GLB ağaç paketi (low-poly) — prosedürel ağaçların yerini alır
  buildScatter();
  buildStructures();              // metal hurda + sandık + kulübeler
  buildFireflies();
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
    b.root.rotation.y = -b.a + (b.sp > 0 ? Math.PI : 0);
    b.mixer.update(dt);
  }
}

/* ----- gerçek CC0 geyik + jaguar modelleri ----- */
let deerProto = null, jaguarProto = null, jaguarClip = null, SkeletonUtilsMod = null;
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
    const bloom = new BLOOM.UnrealBloomPass(new THREE.Vector2(w, h), 0.7, 0.55, 0.8); comp.addPass(bloom); // ateş/gözler/ay parlar
    // film grain + vignette
    grainPass = new SP.ShaderPass({
      uniforms: { tDiffuse: { value: null }, t: { value: 0 }, vig: { value: 1.05 }, grain: { value: 0.07 } },
      vertexShader: "varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }",
      fragmentShader:
        "uniform sampler2D tDiffuse; uniform float t, vig, grain; varying vec2 vUv;" +
        "float rand(vec2 c){return fract(sin(dot(c,vec2(12.9898,78.233)))*43758.5453);}" +
        "void main(){ vec4 col=texture2D(tDiffuse,vUv);" +
        " vec2 q=vUv-0.5; float v=smoothstep(0.9,0.25,length(q)*vig); col.rgb*=mix(0.55,1.0,v);" +  // vignette
        " float g=(rand(vUv*vec2(t*60.0+1.0, t*37.0+1.0))-0.5)*grain; col.rgb+=g;" +                 // grain
        " gl_FragColor=col; }",
    });
    comp.addPass(grainPass);
    comp.addPass(new OUT.OutputPass());
    comp.setSize(w, h); comp.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    composer = comp; postOn = true;
  } catch (e) { console.warn("[postfx] yüklenemedi, düz render:", e); postOn = false; }
}

/* ----- ateş böcekleri / gece parıltıları (Points) ----- */
function buildFireflies() {
  const N = 150, pos = new Float32Array(N * 3);
  for (let i = 0; i < N; i++) { pos[i * 3] = rnd(-60, 60); pos[i * 3 + 1] = rnd(0.5, 6); pos[i * 3 + 2] = rnd(-60, 60); }
  const geo = new THREE.BufferGeometry(); geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  const mat = new THREE.PointsMaterial({ color: 0xbfff8a, size: 0.22, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending });
  fireflies = new THREE.Points(geo, mat); fireflies.frustumCulled = false; fireflies.userData.phase = new Float32Array(N).map(() => rnd(0, 6.28));
  scene.add(fireflies);
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
    modelTrunkIM.instanceMatrix.needsUpdate = modelBranchIM.instanceMatrix.needsUpdate = true;
    trunkIM.visible = folLowIM.visible = folTopIM.visible = false;   // prosedürel ağaçları gizle
    console.log("[trees] GLB ağaç modeli uygulandı:", trunk.name, branch ? branch.name : "(dal yok)");
  } catch (e) { console.warn("[trees] GLB yüklenemedi — prosedürel ağaçlar kalıyor:", e); }
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
    trees.push({ x, z, s: rnd(0.8, 1.6), rot: rnd(0, 6.28), r: 0, hp: 4, alive: true, regrow: 0 });
    trees[i].r = 0.9 * trees[i].s;
    writeTree(i);
    // gövde rengi (kahve tonları)
    col.setHSL(0.08, rnd(0.35, 0.5), rnd(0.14, 0.22)); trunkIM.setColorAt(i, col);
    // yaprak rengi (orman yeşili çeşitliliği)
    const h = rnd(0.27, 0.36);
    col.setHSL(h, rnd(0.45, 0.65), rnd(0.18, 0.30)); folLowIM.setColorAt(i, col);
    col.setHSL(h, rnd(0.45, 0.65), rnd(0.26, 0.40)); folTopIM.setColorAt(i, col);
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
  const bushIM = new THREE.InstancedMesh(bushGeo, bushMat, CFG.BUSHES);
  bushIM.frustumCulled = false; if (shadowsOn) { bushIM.castShadow = true; bushIM.receiveShadow = true; }
  for (let i = 0; i < CFG.BUSHES; i++) { _d.position.set(rnd(-CFG.WORLD, CFG.WORLD), 0.5, rnd(-CFG.WORLD, CFG.WORLD)); _d.rotation.set(0, rnd(0, 6.3), 0); _d.scale.setScalar(rnd(0.7, 1.7)); _d.updateMatrix(); bushIM.setMatrixAt(i, _d.matrix); col.setHSL(rnd(0.26, 0.34), rnd(0.45, 0.65), rnd(0.16, 0.28)); bushIM.setColorAt(i, col); }
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
  const grassIM = new THREE.InstancedMesh(grassGeo, grassMat, CFG.GRASS);
  grassIM.frustumCulled = false;
  for (let i = 0; i < CFG.GRASS; i++) { _d.position.set(rnd(-CFG.WORLD, CFG.WORLD), 0.45, rnd(-CFG.WORLD, CFG.WORLD)); _d.rotation.set(rnd(-0.15, 0.15), rnd(0, 6.3), rnd(-0.15, 0.15)); _d.scale.set(rnd(0.7, 1.5), rnd(0.8, 1.8), rnd(0.7, 1.5)); _d.updateMatrix(); grassIM.setMatrixAt(i, _d.matrix); col.setHSL(rnd(0.24, 0.33), rnd(0.5, 0.7), rnd(0.20, 0.32)); grassIM.setColorAt(i, col); }
  grassIM.instanceColor.needsUpdate = true; scene.add(grassIM);
}

/* ----- yapılar: metal hurda + sandık + terk edilmiş kulübeler (99 Nights tarzı) ----- */
const scraps = [];   // {x,z,group,taken}
const chests = [];   // {x,z,group,lid,opened}
const houses = [];   // {x,z,group}
function farFromSpawn(min) { let x, z; do { x = rnd(-CFG.WORLD + 6, CFG.WORLD - 6); z = rnd(-CFG.WORLD + 6, CFG.WORLD - 6); } while (Math.hypot(x, z) < min); return [x, z]; }
function makeScrap(x, z) {
  const g = new THREE.Group(); g.position.set(x, 0, z);
  const mat = new THREE.MeshStandardMaterial({ color: 0x8a8f96, metalness: 0.7, roughness: 0.5 });
  const rust = new THREE.MeshStandardMaterial({ color: 0x6b4a2e, roughness: 0.9 });
  for (let i = 0; i < 3; i++) { const p = new THREE.Mesh(new THREE.BoxGeometry(rnd(0.3, 0.6), rnd(0.1, 0.25), rnd(0.3, 0.6)), i ? mat : rust); p.position.set(rnd(-0.25, 0.25), 0.12 + i * 0.12, rnd(-0.25, 0.25)); p.rotation.y = rnd(0, 6.3); g.add(p); }
  if (shadowsOn) g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  scene.add(g); const s = { x, z, group: g, taken: false }; scraps.push(s); return s;
}
function makeChest(x, z) {
  const g = new THREE.Group(); g.position.set(x, 0, z);
  const wood = new THREE.MeshStandardMaterial({ color: 0x6b4a26, roughness: 0.9 });
  const iron = new THREE.MeshStandardMaterial({ color: 0x55585c, metalness: 0.6, roughness: 0.5 });
  const base = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.5, 0.6), wood); base.position.y = 0.25; g.add(base);
  const lid = new THREE.Mesh(new THREE.BoxGeometry(0.92, 0.22, 0.62), wood); lid.position.set(0, 0.5, -0.3); g.add(lid);
  const lock = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.18, 0.06), iron); lock.position.set(0, 0.34, 0.31); g.add(lock);
  if (shadowsOn) g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  scene.add(g); const c = { x, z, group: g, lid, opened: false }; chests.push(c); return c;
}
function makeHouse(x, z) {
  const g = new THREE.Group(); g.position.set(x, 0, z); g.rotation.y = rnd(0, 6.3);
  const wall = new THREE.MeshStandardMaterial({ color: 0x4a3a28, roughness: 1 });
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
function buildStructures() {
  for (let i = 0; i < CFG.HOUSES; i++) { const [x, z] = farFromSpawn(26); makeHouse(x, z); }
  for (let i = 0; i < CFG.CHESTS; i++) { const [x, z] = farFromSpawn(16); makeChest(x, z); }
  for (let i = 0; i < CFG.SCRAP; i++) { const [x, z] = farFromSpawn(10); makeScrap(x, z); }
}

/* ----------------------- GAME STATE ----------------------- */
let S;
function newState() {
  return {
    running: false, paused: false, over: false, won: false,
    time: 0.16, day: 1,
    health: 100, hunger: 100, warmth: 100, sanity: 100, stamina: 100,
    inv: { wood: 10, raw: 0, cooked: 2, metal: 0, pelt: 0, bandage: 1 },
    tools: { pickaxe: false, tent: false, spear: false },
    swingCd: 0, stepT: 0, sick: 0, hurt: 0, bob: 0,
    cookT: 0, fireCrackleT: 0, deathReason: "",
    heart: 0, heartLevel: 0, jumpCd: 12, firstNightDone: false, scripted: false, bloodMoon: false, dreadT: null, glitchCd: 35,
    shake: 0,
    downed: false, bleed: 0, reviveT: 0,   // co-op: yere düşme / kan kaybı / diriltme ilerlemesi
    sleeping: 0,                            // çadırda uyuma animasyonu
  };
}

/* ----- dinamik nesneler ----- */
const animals = [];   // {group,x,z,type,hp,state,dir,atkCd}
const fires = [];     // {group,light,flame,x,z,fuel,max,safeR}
const walls = [];     // {x,z,group,r} — oyuncunun diktiği barikatlar
const traps = [];     // {x,z,group,cd} — çivili tuzaklar
const photos = [];    // {mesh,mat,t} — kamera korkusunda ağaca asılan fotoğraflar
let watcher = null;   // {group,head,x,z,seen,life,alpha}
let wCd = 8, wEnc = 0;

function clearDynamic() {
  for (const a of animals) scene.remove(a.group); animals.length = 0;
  for (const f of fires) scene.remove(f.group); fires.length = 0;
  for (const w of walls) scene.remove(w.group); walls.length = 0;
  for (const t of traps) scene.remove(t.group); traps.length = 0;
  for (const p of photos) scene.remove(p.mesh); photos.length = 0;
  if (watcher) { scene.remove(watcher.group); watcher = null; }
  // yapıları sıfırla (yeniden oyun): hurda görünür, sandıklar kapalı
  for (const s of scraps) { s.taken = false; s.hp = 0; s.group.visible = true; }
  for (const c of chests) { c.opened = false; if (c.lid) c.lid.rotation.x = 0; }
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
  if (animalProtos[type]) {                                   // yüklenmiş gerçek GLB (boar/capybara/tapir)
    const src = animalProtos[type]; const m = SkeletonUtilsMod ? SkeletonUtilsMod.clone(src.proto) : src.proto.clone(true);
    m.rotation.y = Math.PI / 2; g.add(m); g.userData.model = m;
    if (src.clip) { const mixer = new THREE.AnimationMixer(m); mixer.clipAction(src.clip).play(); g.userData.mixer = mixer; }
    scene.add(g); return g;
  }
  const col = { capybara: 0x8a6a44, deer: 0x9a7a52, tapir: 0x5a4a44, boar: 0x4a3a30, jaguar: 0xc8902c }[type] || 0x8a6a44;
  const big = type === "jaguar" || type === "tapir";
  const mat = new THREE.MeshStandardMaterial({ color: col, roughness: 1, flatShading: true });
  const body = new THREE.Mesh(new THREE.BoxGeometry(big ? 1.6 : 1.1, 0.7, 0.6), mat);
  body.position.y = 0.55; g.add(body);
  // boyun + kafa (ileriye, +X)
  const headY = type === "deer" ? 1.05 : 0.72, headFwd = big ? 0.9 : 0.66;
  if (type === "deer") { const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.16, 0.6, 6), mat); neck.position.set(0.45, 0.95, 0); neck.rotation.z = -0.7; g.add(neck); }
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.42, 0.42), mat); head.position.set(headFwd, headY, 0); g.add(head);
  // snout / namlu
  const snout = new THREE.Mesh(new THREE.BoxGeometry(type === "tapir" ? 0.45 : 0.28, 0.22, 0.26), mat); snout.position.set(headFwd + (type === "tapir" ? 0.3 : 0.24), headY - 0.05, 0); g.add(snout);
  // bacaklar
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.16, type === "deer" ? 0.7 : 0.5, 0.16), new THREE.MeshStandardMaterial({ color: 0x2a2018 }));
    leg.position.set(sx * (big ? 0.6 : 0.42), (type === "deer" ? 0.35 : 0.25), sz * 0.22); g.add(leg);
  }
  if (type === "deer") for (const sx of [-1, 1]) { const horn = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.5, 4), new THREE.MeshStandardMaterial({ color: 0x6a5436 })); horn.position.set(headFwd, headY + 0.4, sx * 0.12); horn.rotation.z = sx * 0.3; g.add(horn); }
  if (type === "boar") for (const sx of [-1, 1]) { const tusk = new THREE.Mesh(new THREE.ConeGeometry(0.04, 0.22, 4), new THREE.MeshStandardMaterial({ color: 0xe8e0c8 })); tusk.position.set(headFwd + 0.22, headY - 0.12, sx * 0.1); tusk.rotation.z = 1.6; g.add(tusk); }
  if (type === "jaguar") {
    const em = new THREE.MeshStandardMaterial({ color: 0xffd83a, emissive: 0xffcc22, emissiveIntensity: 1.4 });
    for (const sz of [-1, 1]) { const e = new THREE.Mesh(new THREE.SphereGeometry(0.07, 6, 6), em); e.position.set((big ? 1.15 : 0.9), 0.78, sz * 0.13); g.add(e); }
  }
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

/* ----- ateş modeli ----- */
function makeFire(x, z) {
  const g = new THREE.Group(); g.position.set(x, 0, z);
  for (let i = 0; i < 5; i++) { const log = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 1, 5), new THREE.MeshStandardMaterial({ color: 0x2a1c10 })); log.rotation.z = Math.PI / 2; log.rotation.y = i / 5 * Math.PI; log.position.y = 0.1; g.add(log); }
  const flame = new THREE.Mesh(new THREE.ConeGeometry(0.35, 1.1, 7), new THREE.MeshBasicMaterial({ color: 0xff7a1a, transparent: true, opacity: 0.92 })); flame.position.y = 0.7; g.add(flame);
  const flame2 = new THREE.Mesh(new THREE.ConeGeometry(0.2, 0.7, 6), new THREE.MeshBasicMaterial({ color: 0xffd24a, transparent: true, opacity: 0.95 })); flame2.position.y = 0.55; g.add(flame2);
  const light = new THREE.PointLight(0xff8a3c, 2.2, 16, 1.5); light.position.y = 1; g.add(light);
  // kıvılcımlar
  const EN = 26, ep = new Float32Array(EN * 3), ev = [];
  for (let i = 0; i < EN; i++) { ep[i * 3] = rnd(-0.2, 0.2); ep[i * 3 + 1] = rnd(0.2, 1.5); ep[i * 3 + 2] = rnd(-0.2, 0.2); ev.push(rnd(0.6, 1.8)); }
  const egeo = new THREE.BufferGeometry(); egeo.setAttribute("position", new THREE.BufferAttribute(ep, 3));
  const emat = new THREE.PointsMaterial({ color: 0xffb24a, size: 0.12, transparent: true, opacity: 0.9, depthWrite: false, blending: THREE.AdditiveBlending });
  const embers = new THREE.Points(egeo, emat); embers.frustumCulled = false; g.add(embers);
  scene.add(g);
  const f = { group: g, light, flame, flame2, embers, ev, x, z, fuel: 70, max: 140, safeR: 11, big: false }; fires.push(f); return f;
}

/* ----- üs: barikat duvarı + çivili tuzak (oyuncu diker) ----- */
function makeWall(x, z, rotY) {
  const g = new THREE.Group(); g.position.set(x, 0, z); g.rotation.y = rotY || 0;
  const wood = new THREE.MeshStandardMaterial({ color: 0x5a3f22, roughness: 1, flatShading: true });
  for (let i = -2; i <= 2; i++) { const p = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.18, 2.0, 6), wood); p.position.set(i * 0.42, 1.0, 0); p.rotation.x = rnd(-0.05, 0.05); g.add(p); const tip = new THREE.Mesh(new THREE.ConeGeometry(0.18, 0.35, 6), wood); tip.position.set(i * 0.42, 2.1, 0); g.add(tip); }
  const rail = new THREE.Mesh(new THREE.BoxGeometry(2.1, 0.16, 0.16), wood); rail.position.set(0, 1.4, 0); g.add(rail);
  if (shadowsOn) g.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  scene.add(g); const w = { x, z, group: g, r: 1.25 }; walls.push(w); return w;
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
const inp = { jx: 0, jy: 0, joy: false, sprint: false, action: false, fire: false, eat: false, bandage: false, sleep: false };

const typingInField = (e) => { const t = e.target; return t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable); };
addEventListener("keydown", (e) => {
  if (typingInField(e)) return;            // input/şifre/e-posta alanına yazarken oyun tuşlarını yok say
  const k = e.key.toLowerCase(); const first = !keys[k]; keys[k] = true;
  if (["w", "a", "s", "d", " ", "shift"].includes(k)) e.preventDefault();
  if (k === "e" || k === " ") inp.action = true;
  if (k === "f") inp.fire = true;
  if (k === "g") inp.eat = true;
  if (k === "v") startTalk();           // bas-konuş (sesli sohbet)
  if (first && k === "c") toggleCraft();   // tezgah
  if (first && k === "b") inp.bandage = true;  // bandaj (can / dirilt)
  if (first && k === "t") inp.sleep = true;    // çadırda uyu
});
addEventListener("keyup", (e) => { if (typingInField(e)) return; const k = e.key.toLowerCase(); keys[k] = false; if (k === "v") stopTalk(); });

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
bindBtn("btn-bandage", () => (inp.bandage = true));
const sprintBtn = bindBtn("btn-sprint", null, true);
{ const cb = $("btn-craft"); if (cb) { cb.addEventListener("touchstart", (e) => { isTouch = true; toggleCraft(); e.preventDefault(); }, { passive: false }); cb.addEventListener("click", () => toggleCraft()); } }

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
  for (const s of scraps) if (!s.taken) consider(s.x, s.z, 3.4, "scrap", s);
  for (const c of chests) if (!c.opened) consider(c.x, c.z, 3.6, "chest", c);
  return best;
}
function doAction() {
  if (S.swingCd > 0) return;
  const t = findTarget(); if (!t) return;
  S.swingCd = 0.4; S.stamina = clamp(S.stamina - 4, 0, 100);
  if (t.kind === "tree") {
    Sound.chop(); const tr = t.obj; tr.hp--; S.inv.wood++;
    if (tr.hp <= 0) { tr.alive = false; tr.regrow = 95; S.inv.wood += 2; writeTree(trees.indexOf(tr)); treesNeedUpdate(); toast("🪵 Ağaç devrildi (+3)", "good"); }
    return;
  }
  if (t.kind === "scrap") {                                   // metal hurda topla (kazma daha hızlı)
    Sound.chop(); const s = t.obj; s.hp = (s.hp || (S.tools.pickaxe ? 1 : 2)) - 1;
    if (s.hp <= 0) { s.taken = true; s.group.visible = false; const m = S.tools.pickaxe ? rndi(2, 4) : rndi(1, 2); S.inv.metal += m; toast("⚙️ +" + m + " metal" + (S.tools.pickaxe ? " (kazma)" : ""), "good"); }
    else toast("⚙️ Hurda... (kazma işi hızlandırır)");
    return;
  }
  if (t.kind === "chest") {                                   // sandık aç → ganimet
    const c = t.obj; c.opened = true; if (c.lid) c.lid.rotation.x = -1.2; Sound.crackle();
    const loot = [];
    const wood = rndi(2, 6); S.inv.wood += wood; loot.push("🪵" + wood);
    if (Math.random() < 0.75) { const m = rndi(1, 4); S.inv.metal += m; loot.push("⚙️" + m); }
    if (Math.random() < 0.6) { const b = rndi(1, 2); S.inv.bandage += b; loot.push("🩹" + b); }
    if (Math.random() < 0.5) { const f = rndi(1, 3); S.inv.cooked += f; loot.push("🍗" + f); }
    if (Math.random() < 0.35) { const p = rndi(1, 2); S.inv.pelt += p; loot.push("🧵" + p); }
    toast("📦 Sandık: " + loot.join("  "), "good");
    return;
  }
  if (t.kind === "animal") {
    Sound.chop(); const a = t.obj; a.hp -= S.tools.spear ? 6 : 3;
    if (a.type === "boar" || a.type === "jaguar") { a.hostile = true; a.state = "chase"; }
    else { a.state = "flee"; a.dir = Math.atan2(a.z - camera.position.z, a.x - camera.position.x); }
    if (a.hp <= 0) killAnimal(a);
  }
}
function killAnimal(a) {
  const y = a.type === "jaguar" ? rndi(5, 7) : a.type === "tapir" ? rndi(3, 5) : rndi(2, 4);
  S.inv.raw += y; const pelt = a.type === "jaguar" ? rndi(2, 3) : rndi(1, 2); S.inv.pelt += pelt;
  toast("🥩 +" + y + " et · 🧵 +" + pelt + " post (" + nameTR(a.type) + ")", "good");
  scene.remove(a.group); animals.splice(animals.indexOf(a), 1);
  if (a.type !== "jaguar") setTimeout(() => { if (S.running && animals.length < 18) spawnPrey(); }, 9000);
}
const nameTR = (t) => ({ capybara: "kapibara", deer: "geyik", tapir: "tapir", boar: "yaban domuzu", jaguar: "jaguar" }[t] || t);

function doFire() {
  const px = camera.position.x, pz = camera.position.z;
  let near = null, nd = 64;   // 8 m içindeki ateş
  for (const f of fires) { const d = (f.x - px) ** 2 + (f.z - pz) ** 2; if (d < nd) { nd = d; near = f; } }
  if (near) {                 // YAKININDAKİ ATEŞE ODUN AT — ne kadar atarsan o kadar uzun yanar
    if (S.inv.wood <= 0) { toast("Odun yok — ağaç kes", "bad"); return; }
    const add = Math.min(S.inv.wood, 25); S.inv.wood -= add; near.fuel = Math.min(near.fuel + add * 13, near.max);
    const secs = Math.round(near.fuel / 2.4);
    toast("🔥 +" + add + " odun → ateş ~" + secs + " sn yanar", "good"); return;
  }
  if (S.inv.wood < 5) { toast("Yeni ateş için 5 odun lazım (" + S.inv.wood + ")", "bad"); return; }
  S.inv.wood -= 5; camera.getWorldDirection(_fwd); _fwd.y = 0; _fwd.normalize();
  makeFire(px + _fwd.x * 2.2, pz + _fwd.z * 2.2); toast("🔥 Kamp ateşi yakıldı!", "good");
}
function doEat() {
  const inv = S.inv;
  if (inv.cooked > 0) { inv.cooked--; S.hunger = clamp(S.hunger + 45, 0, 100); toast("🍗 Pişmiş et yedin (+45)", "good"); }
  else if (inv.raw > 0) { inv.raw--; S.hunger = clamp(S.hunger + 18, 0, 100); if (Math.random() < 0.45) { S.health = clamp(S.health - 12, 0, 100); S.sanity = clamp(S.sanity - 4, 0, 100); S.sick = 3; toast("🤢 Çiğ et seni hasta etti!", "bad"); } else toast("🥩 Çiğ et yedin (+18)", "good"); }
  else toast("Yiyecek yok!", "bad");
}

/* ----------------------- CRAFTING (TEZGAH) ----------------------- */
const RECIPES = [
  { id: "bandage", name: "🩹 Bandaj", desc: "Can doldurur / düşen arkadaşı diriltir", cost: { pelt: 2, wood: 1 }, make: (s) => s.inv.bandage++ },
  { id: "torch", name: "🔥 Meşale (kamp ateşi)", desc: "Önüne yeni kamp ateşi kurar", cost: { wood: 5 }, make: () => { const [x, z] = placeInFront(2.4); makeFire(x, z); } },
  { id: "wall", name: "🧱 Barikat duvarı", desc: "Önüne sivri kazıklı duvar diker (seni + canavarı durdurur)", cost: { wood: 4 }, make: () => { camera.getWorldDirection(_fwd); _fwd.y = 0; _fwd.normalize(); const [x, z] = placeInFront(2.2); makeWall(x, z, Math.atan2(-_fwd.x, -_fwd.z)); toast("🧱 Duvar dikildi", "good"); } },
  { id: "trap", name: "🪤 Çivili tuzak", desc: "Önüne tuzak kurar — üstünden geçen canavarı yaralar", cost: { metal: 2, wood: 3 }, make: () => { const [x, z] = placeInFront(2.6); makeSpikeTrap(x, z); toast("🪤 Tuzak kuruldu", "good"); } },
  { id: "pickaxe", name: "⛏️ Kazma", desc: "Metali hızlı toplar, daha sert vurur", cost: { metal: 4, wood: 3 }, once: () => S.tools.pickaxe, make: (s) => s.tools.pickaxe = true },
  { id: "spear", name: "🗡️ Mızrak", desc: "Avı/canavarı daha çok yaralar", cost: { metal: 2, wood: 4 }, once: () => S.tools.spear, make: (s) => s.tools.spear = true },
  { id: "tent", name: "⛺ Çadır", desc: "Güvendeyken uyu, sabaha atla (T)", cost: { pelt: 4, wood: 6, metal: 2 }, once: () => S.tools.tent, make: (s) => s.tools.tent = true },
  { id: "bonfire", name: "🔥 Şenlik ateşi (yükselt)", desc: "Yakındaki ateşi büyütür: geniş güvenli alan + uzun yanma", cost: { metal: 3, wood: 8 }, make: () => upgradeNearestFire() },
];
function upgradeNearestFire() {
  let near = null, nd = 100; for (const f of fires) { const d = (f.x - camera.position.x) ** 2 + (f.z - camera.position.z) ** 2; if (d < nd && !f.big) { nd = d; near = f; } }
  if (!near) { toast("Yükseltmek için yakında (≤10m) normal bir ateş olmalı", "bad"); return false; }
  near.big = true; near.max = Math.max(near.max, 900); near.fuel = Math.min(near.fuel + 200, near.max); near.safeR = 19;
  near.flame.scale.multiplyScalar(1.6); if (near.flame2) near.flame2.scale.multiplyScalar(1.6);
  toast("🔥 Şenlik ateşi! Güvenli alan büyüdü, yavaş yanar", "good"); return true;
}
function canAfford(r) { for (const k in r.cost) if ((S.inv[k] || 0) < r.cost[k]) return false; return !(r.once && r.once()); }
function craft(r) {
  if (r.once && r.once()) { toast("Zaten var.", "bad"); return; }
  if (!canAfford(r)) { toast("Yetersiz malzeme.", "bad"); return; }
  for (const k in r.cost) S.inv[k] -= r.cost[k];
  const ok = r.make(S);
  if (ok === false) { for (const k in r.cost) S.inv[k] += r.cost[k]; renderCraft(); return; }   // başarısız → malzeme iadesi
  Sound.chop(); toast("🛠️ Üretildi: " + r.name, "good"); renderCraft();
}
const costStr = (c) => Object.entries(c).map(([k, v]) => ({ wood: "🪵", metal: "⚙️", pelt: "🧵", bandage: "🩹" }[k] + v)).join(" ");
function renderCraft() {
  const list = $("craftList"); if (!list) return;
  $("craftInv").textContent = `🪵${S.inv.wood} ⚙️${S.inv.metal} 🧵${S.inv.pelt} 🩹${S.inv.bandage}`;
  list.innerHTML = "";
  for (const r of RECIPES) {
    const row = document.createElement("div"); row.className = "craft-row";
    const owned = r.once && r.once();
    row.innerHTML = `<div class="ci">${r.name}<small>${r.desc} · ${costStr(r.cost)}</small></div>`;
    const b = document.createElement("button"); b.className = "minibtn"; b.textContent = owned ? "✓ VAR" : "ÜRET";
    b.disabled = owned || !canAfford(r); b.addEventListener("click", () => craft(r));
    row.appendChild(b); list.appendChild(row);
  }
}
let craftOpen = false;
function openCraft() { if (!S || !S.running || S.downed) return; craftOpen = true; renderCraft(); $("craft").classList.remove("hidden"); if (document.exitPointerLock) document.exitPointerLock(); }
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
  if (S.inv.bandage <= 0) { toast("Bandaj yok 🩹 (tezgahta üret)", "bad"); return; }
  if (S.health >= 100) { toast("Canın zaten dolu.", "bad"); return; }
  S.inv.bandage--; S.health = clamp(S.health + 35, 0, 100); S.sick = 0; toast("🩹 Bandaj: +35 can", "good");
}

/* ----------------------- ÇADIR: güvendeyken uyu, sabaha atla ----------------------- */
function doSleep() {
  if (!S.tools.tent) { toast("Önce ⛺ çadır üret (tezgah / C)", "bad"); return; }
  if (S.sleeping > 0) return;
  let safe = false; for (const f of fires) if (Math.hypot(f.x - camera.position.x, f.z - camera.position.z) < (f.safeR || 11)) safe = true;
  if (!safe) { toast("Sadece yanan ateşin yanında uyuyabilirsin 🔥", "bad"); return; }
  if (watcher || animals.some((a) => a.hostile && Math.hypot(a.x - camera.position.x, a.z - camera.position.z) < 22)) { toast("Tehlike yakın — uyuyamazsın!", "bad"); return; }
  S.sleeping = 2.0; toast("⛺ Uyuyorsun... sabaha atlanıyor", "good");
}

/* ----------------------- JUMPSCARE ----------------------- */
let jumpT = 0, jumpFace = 0;
function jumpscare(face, san, hp) {
  jumpT = 1.0; jumpFace = face != null ? face : rndi(0, 2);
  S.shake = Math.max(S.shake, 0.9);
  S.sanity = clamp(S.sanity - (san || 12), 0, 100);
  if (hp) { S.health = clamp(S.health - hp, 0, 100); S.hurt = 0.6; if (S.health <= 0) playerDied("kalp krizi"); }
  Sound.screech();
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
function playerDied(reason) {
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
function die(reason) {
  if (S.over) return; S.over = true; S.running = false; S.deathReason = reason; S.downed = false; $("downed").classList.add("hidden"); Sound.screech();
  document.exitPointerLock && document.exitPointerLock();
  setTimeout(() => { $("deathReason").textContent = "Sebep: " + reason; $("daysSurvived").textContent = S.day; $("gameover").classList.remove("hidden"); }, 700);
}
function winGame() { S.won = true; S.running = false; document.exitPointerLock && document.exitPointerLock(); $("win").classList.remove("hidden"); }

/* ----------------------- UPDATE ----------------------- */
function update(dt) {
  // zaman / gün
  S.time += dt / CFG.DAY_LENGTH;
  if (S.time >= 1) {
    S.time -= 1; S.day++; S.firstNightDone = false; S.scripted = false;
    if (S.day > CFG.WIN_DAY) { winGame(); return; }
    S.bloodMoon = S.day >= 6 && Math.random() < (0.12 + S.day / 100 * 0.4);   // ilerledikçe daha sık KANLI AY
    toast("☀️ GÜN " + S.day + " başladı" + (S.bloodMoon ? " — bu gece KANLI AY 🔴" : ""), S.bloodMoon ? "bad" : "good");
  }
  const night = isNight();
  const dread = dreadLevel();

  // bakış (kamera) uygula — her durumda etrafa bakılabilir
  camera.rotation.set(pitch, yaw, 0, "YXZ");

  // ÇADIRDA UYUMA → sabaha atla
  if (S.sleeping > 0) {
    S.sleeping -= dt;
    if (S.sleeping <= 0) {
      if (S.time >= 0.5) { S.day++; if (S.day > CFG.WIN_DAY) { winGame(); return; } S.bloodMoon = false; }
      S.time = 0.18; S.warmth = clamp(S.warmth + 25, 0, 100); S.stamina = 100; S.sanity = clamp(S.sanity + 15, 0, 100); S.hunger = clamp(S.hunger - 10, 0, 100);
      toast("🌅 Uyandın — GÜN " + S.day, "good");
    }
    updateHUD(night); return;
  }

  // YERE DÜŞTÜ (co-op) → kan kaybı, hareket yok, diriltilmeyi bekle
  if (S.downed) {
    S.bleed -= dt; S.heartLevel = 1; if ((S.heart -= dt) <= 0) { Sound.thump(); S.heart = 0.5; }
    $("bleedTxt").textContent = Math.max(0, Math.ceil(S.bleed)) + " sn";
    if (net.online) { S.netT = (S.netT || 0) - dt; if (S.netT <= 0) { S.netT = 0.2; try { net.broadcast({ t: "state", x: camera.position.x, z: camera.position.z, yaw, day: S.day, time: S.time, hp: 0, downed: true }); } catch (e) {} } }
    lerpRemotes(dt);
    if (S.bleed <= 0) { die(S.deathReason || "kan kaybı"); return; }
    updateHUD(night); return;
  }

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
  // barikat duvarı çarpışması
  for (const w of walls) { const dx = nx - w.x, dz = nz - w.z, rr = w.r + 0.4; if (dx * dx + dz * dz < rr * rr) { const d = Math.hypot(dx, dz) || 0.001; nx = w.x + dx / d * rr; nz = w.z + dz / d * rr; } }
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
  if (inp.bandage) { inp.bandage = false; useBandage(); }
  if (inp.sleep) { inp.sleep = false; doSleep(); }

  // ateşler
  let nearFire = false, fireDist = 1e9;
  for (let i = fires.length - 1; i >= 0; i--) {
    const f = fires[i]; f.fuel -= dt * (night ? 2.4 : 3.2) * (f.big ? 0.5 : 1);   // şenlik ateşi yavaş yanar
    if (f.fuel <= 0) { scene.remove(f.group); fires.splice(i, 1); toast("🪵 Ateş söndü", "bad"); continue; }
    const flick = 0.85 + Math.sin(performance.now() / 70 + i) * 0.15 + Math.random() * 0.1, bs = f.big ? 1.7 : 1;
    f.light.intensity = map(f.fuel, 0, f.max, 0.8, 2.6) * flick * (f.big ? 1.5 : 1);
    f.light.distance = map(f.fuel, 0, f.max, 8, 17) * (f.big ? 1.6 : 1);
    f.flame.scale.set(flick * bs, (0.8 + flick * 0.5) * bs, flick * bs); f.flame.rotation.y += dt * 3;
    if (f.flame2) { f.flame2.scale.set(flick * 0.9 * bs, (0.7 + flick * 0.6) * bs, flick * 0.9 * bs); f.flame2.rotation.y -= dt * 4; }
    // kıvılcımları yükselt
    if (f.embers) { const pa = f.embers.geometry.attributes.position, ar = pa.array; for (let k = 0; k < f.ev.length; k++) { ar[k * 3 + 1] += f.ev[k] * dt; if (ar[k * 3 + 1] > 2.6) { ar[k * 3] = rnd(-0.2, 0.2); ar[k * 3 + 1] = 0.3; ar[k * 3 + 2] = rnd(-0.2, 0.2); } } pa.needsUpdate = true; }
    const d = Math.hypot(f.x - camera.position.x, f.z - camera.position.z); if (d < (f.big ? 9 : 6)) { nearFire = true; fireDist = Math.min(fireDist, d); }
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
  if (S.health <= 0) { playerDied(S.deathReason || "bilinmeyen"); if (S.over || S.downed) return; }

  // korku — İzleyen
  updateWatcher(dt, night);
  // jumpscare zamanlayıcı
  S.jumpCd -= dt;
  if (jumpT <= 0 && S.jumpCd <= 0 && night) { const p = (0.02 + (1 - S.sanity / 100) * 0.07) * (1 + dread * 1.6); if (Math.random() < p) { jumpscare(null, 11, 0); S.jumpCd = rnd(16, 38) * (1 - dread * 0.45); } }
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
        if (ev === 0) { whisperText(choice(["arkanda", "seni görüyorum", "kaç", "100 gün... hayır", "yaklaşıyor", "ışığı söndür"])); Sound.whisper(); }
        else if (ev === 1) Sound.growl();
        else if (ev === 2) { S.heartLevel = Math.max(S.heartLevel, 0.9); Sound.thump(); }
        else { S.shake = Math.max(S.shake, 0.25); Sound.whoosh(); }
        if (dread > 0.5 && Math.random() < dread - 0.4) S.sanity = clamp(S.sanity - 4, 0, 100);
      }
    }
  }
  if (night && S.day === 1 && !S.scripted && S.time > 0.80) { S.scripted = true; setTimeout(() => { if (S.running) jumpscare(1, 10, 0); }, rndi(3000, 8000)); }
  if (jumpT > 0) jumpT -= dt;

  // gece jaguarı
  if (night && S.day > 1 && Math.random() < 0.0009 && animals.filter((a) => a.type === "jaguar").length < 2) { spawnJaguar(); Sound.growl(); whisperText("bir hırıltı..."); }
  // SÜRÜNEN — gece avcısı (gün geçtikçe + kanlı ayda daha çok)
  if (night && S.day >= 2 && Math.random() < (0.0007 + dread * 0.0014) && animals.filter((a) => a.type === "crawler").length < (S.bloodMoon ? 3 : 2)) { spawnCrawler(); Sound.growl(); whisperText(choice(["sürünüyor...", "duydun mu?", "çok ayak sesi"])); }
  // TAKLİTÇİ (gün ≥3): arkadaş gibi durup yaklaşınca saldırır — tek seferde bir tane
  if (night && S.day >= 3 && Math.random() < (0.0004 + dread * 0.0009) && !animals.some((a) => a.type === "mimic")) spawnMimic();
  // PUSUCU (gün ≥3): ağaca gizlenir
  if (night && S.day >= 3 && Math.random() < (0.0005 + dread * 0.001) && animals.filter((a) => a.type === "lurker").length < 2) spawnLurker();
  // SÜRÜ (gün ≥4 / kanlı ay): hızlı yavrular dalga halinde
  if (night && (S.day >= 4 || S.bloodMoon) && Math.random() < (0.00035 + dread * 0.0009) && !animals.some((a) => a.type === "pup")) spawnPack();

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
  hemi.intensity = lerp(0.012, 0.95, dayK); amb.intensity = lerp(0.012, 0.5, dayK);
  headlamp.intensity = lerp(0.0, 1.0, dk); headlamp.position.copy(camera.position); // meşale/fenerin dar ışığı
  const dayCol = new THREE.Color(0x9fb7a0), nightCol = new THREE.Color(0x05080f);
  const skyCol = nightCol.clone().lerp(dayCol, dayK);
  const golden = Math.max(0, 1 - Math.abs(S.time - 0.16) / 0.10) + Math.max(0, 1 - Math.abs(S.time - 0.63) / 0.08);
  if (golden > 0) skyCol.lerp(new THREE.Color(0xd98a4a), Math.min(golden, 1) * 0.5);  // şafak/akşam altın tonu
  if (S.bloodMoon && dk > 0.4) skyCol.lerp(new THREE.Color(0x3a0608), 0.6);   // KANLI AY -> kırmızı sis/gökyüzü
  scene.background = skyCol; scene.fog.color = skyCol;
  scene.fog.density = lerp(0.013, 0.12, dk);   // gece yoğun sis → dar görüş, klostrofobi
  // ateş böcekleri (gece görünür, hafif salınır)
  if (fireflies) {
    fireflies.material.opacity = dk * 0.9; fireflies.position.set(camera.position.x, 0, camera.position.z);
    if (dk > 0.2) { const pa = fireflies.geometry.attributes.position, ar = pa.array, ph = fireflies.userData.phase, tt = performance.now() / 1000; for (let k = 0; k < ph.length; k++) ar[k * 3 + 1] = 2.6 + Math.sin(tt * 0.8 + ph[k]) * 1.8; pa.needsUpdate = true; }
  }

  // kalp atışı
  let hl = (1 - S.sanity / 100) * 0.8;
  if (watcher) hl = Math.max(hl, map(Math.hypot(watcher.x - camera.position.x, watcher.z - camera.position.z), 4, 30, 1, 0.2));
  for (const a of animals) if (a.hostile && Math.hypot(a.x - camera.position.x, a.z - camera.position.z) < 16) hl = Math.max(hl, 0.7);
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

function updateWatcher(dt, night) {
  const dread = dreadLevel();
  let safe = false;
  for (const f of fires) { if (Math.hypot(f.x - camera.position.x, f.z - camera.position.z) < (f.safeR || 11)) { safe = true; break; } }
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
    w.group.scale.setScalar(1 + (0.5 - Math.max(0, w.lunge)) * 1.8);
    S.shake = 0.6;
    if (w.lunge <= 0) { jumpscare(0, 22, 11); w.group.scale.setScalar(1); vanishWatcher(true); wCd = rnd(20, 34); }
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
  const px = camera.position.x, pz = camera.position.z;
  for (let i = animals.length - 1; i >= 0; i--) {
    const a = animals[i], d = Math.hypot(a.x - px, a.z - pz);
    if (a.atkCd > 0) a.atkCd -= dt;
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
      if (d < 2.4 && a.bite <= 0) { S.health = clamp(S.health - 11, 0, 100); S.hurt = 0.45; S.shake = 0.45; a.bite = 1.2; Sound.growl(); S.deathReason = "jaguar saldırısı"; if (S.health <= 0) { playerDied("jaguar saldırısı"); return; } }
      if (a.bite > 0) a.bite -= dt;
      if (!isNight() && d > 45) { scene.remove(a.group); animals.splice(i, 1); continue; }
    } else if (a.type === "crawler") {                         // SÜRÜNEN — hızlı gece avcısı, ateşten korkar
      let fearFire = false; for (const f of fires) if (Math.hypot(a.x - f.x, a.z - f.z) < (f.safeR ? f.safeR - 3 : 8)) fearFire = true;
      if (fearFire && fires.length) { const f = fires[0]; a.dir = Math.atan2(a.z - f.z, a.x - f.x); }
      else a.dir = Math.atan2(pz - a.z, px - a.x);
      const sp = fearFire ? 5 : 8 + dreadLevel() * 3;
      a.x += Math.cos(a.dir) * sp * dt; a.z += Math.sin(a.dir) * sp * dt;
      if (d < 2.2 && a.bite <= 0) { S.health = clamp(S.health - 9, 0, 100); S.sanity = clamp(S.sanity - 6, 0, 100); S.hurt = 0.5; S.shake = 0.5; a.bite = 1.1; Sound.screech(); S.deathReason = "ormandaki şey"; if (S.health <= 0) { playerDied("ormandaki şey"); return; } }
      if (a.bite > 0) a.bite -= dt;
      if (!isNight() && d > 14) { scene.remove(a.group); animals.splice(i, 1); continue; }  // gündüz dağılır
    } else if (a.type === "mimic") {                            // TAKLİTÇİ — arkadaş taklidi, yaklaşınca atılır
      a.dir = Math.atan2(pz - a.z, px - a.x);
      if (a.bite > 0) a.bite -= dt;
      if (d < 4.8 && a.bite <= 0) {                             // maske düşer → saldırı
        if (a.group.userData.eyeMat) a.group.userData.eyeMat.emissiveIntensity = 4;
        S.health = clamp(S.health - 13, 0, 100); S.sanity = clamp(S.sanity - 14, 0, 100); S.hurt = 0.6; S.shake = 0.7; Sound.screech(); jumpscare(0, 0, 0);
        S.deathReason = "taklitçi"; if (S.health <= 0) { playerDied("taklitçi"); return; }
        scene.remove(a.group); animals.splice(i, 1); continue;   // saldırıp kaybolur
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
        if (d < 2.1 && a.bite <= 0) { S.health = clamp(S.health - 10, 0, 100); S.sanity = clamp(S.sanity - 5, 0, 100); S.hurt = 0.5; S.shake = 0.5; a.bite = 1.3; a.hits = (a.hits || 0) + 1; Sound.growl(); S.deathReason = "pusucu"; if (S.health <= 0) { playerDied("pusucu"); return; } }
        if ((a.hits || 0) >= 2 || d > 30) { scene.remove(a.group); animals.splice(i, 1); continue; }   // vurup kaçar
      }
      if (!isNight()) { scene.remove(a.group); animals.splice(i, 1); continue; }
    } else if (a.type === "pup") {                             // SÜRÜ yavrusu — hızlı, zayıf, kalabalık
      let fearFire = false; for (const f of fires) if (Math.hypot(a.x - f.x, a.z - f.z) < (f.safeR ? f.safeR - 4 : 6)) fearFire = true;
      a.dir = fearFire ? Math.atan2(a.z - camera.position.z, a.x - camera.position.x) : Math.atan2(pz - a.z, px - a.x);
      a.x += Math.cos(a.dir) * (fearFire ? 4 : 7.5) * dt; a.z += Math.sin(a.dir) * (fearFire ? 4 : 7.5) * dt;
      if (a.bite > 0) a.bite -= dt;
      if (d < 1.8 && a.bite <= 0) { S.health = clamp(S.health - 4, 0, 100); S.hurt = 0.35; S.shake = 0.25; a.bite = 1.0; Sound.chop(); S.deathReason = "sürü"; if (S.health <= 0) { playerDied("sürü saldırısı"); return; } }
      if (!isNight() && d > 12) { scene.remove(a.group); animals.splice(i, 1); continue; }
    } else if (a.type === "boar" && a.hostile) {
      a.dir = Math.atan2(pz - a.z, px - a.x); a.x += Math.cos(a.dir) * 5.5 * dt; a.z += Math.sin(a.dir) * 5.5 * dt;
      if (d < 2 && a.atkCd <= 0) { S.health = clamp(S.health - 7, 0, 100); S.hurt = 0.4; S.shake = 0.3; a.atkCd = 1.4; S.deathReason = "yaban domuzu"; if (S.health <= 0) { playerDied("yaban domuzu saldırısı"); return; } }
      if (d > 30) a.hostile = false;
    } else {
      if (d < 9 && a.state !== "flee") { a.state = "flee"; a.dir = Math.atan2(a.z - pz, a.x - px) + rnd(-0.4, 0.4); }
      if (a.state === "flee") { a.x += Math.cos(a.dir) * 5 * dt; a.z += Math.sin(a.dir) * 5 * dt; if (d > 22) a.state = "wander"; }
      else { a.t -= dt; if (a.t <= 0) { a.t = rnd(1.5, 4); a.dir = rnd(0, 6.28); a.moving = Math.random() < 0.6; } if (a.moving) { a.x += Math.cos(a.dir) * 1.6 * dt; a.z += Math.sin(a.dir) * 1.6 * dt; } }
    }
    // OYUNCUYA GİRMESİN: atılım dışında bir dur-mesafesi koru (jaguar/domuz içimize giriyordu)
    const STOP = a.type === "jaguar" ? 1.7 : a.type === "crawler" ? 1.5 : a.type === "lurker" && a.state === "ambush" ? 1.4 : a.type === "pup" ? 0.9 : a.type === "boar" && a.hostile ? 1.6 : 0;
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
const bars = { health: $("bar-health"), hunger: $("bar-hunger"), warmth: $("bar-warmth"), sanity: $("bar-sanity"), stamina: $("bar-stamina") };
const invEl = { wood: $("inv-wood"), raw: $("inv-raw"), cooked: $("inv-cooked"), metal: $("inv-metal"), pelt: $("inv-pelt"), bandage: $("inv-bandage") };
const mmCanvas = $("minimap"), mmctx = mmCanvas.getContext("2d");
function drawMinimap() {
  const W = mmCanvas.width, H = mmCanvas.height, cx = W / 2, cy = H / 2, R = 55, sc = (W / 2 - 6) / R;
  mmctx.clearRect(0, 0, W, H);
  const px = camera.position.x, pz = camera.position.z;
  mmctx.fillStyle = "#2f6b3a";
  for (const t of trees) { if (!t.alive) continue; const dx = t.x - px, dz = t.z - pz; if (dx * dx + dz * dz > R * R) continue; mmctx.fillRect(cx + dx * sc - 1, cy + dz * sc - 1, 2, 2); }
  for (const a of animals) { const dx = a.x - px, dz = a.z - pz; if (dx * dx + dz * dz > R * R) continue; mmctx.fillStyle = a.hostile ? "#ff5a4d" : "#d8c060"; mmctx.fillRect(cx + dx * sc - 1.5, cy + dz * sc - 1.5, 3, 3); }
  mmctx.fillStyle = "#9aa0a6"; for (const s of scraps) { if (s.taken) continue; const dx = s.x - px, dz = s.z - pz; if (dx * dx + dz * dz > R * R) continue; mmctx.fillRect(cx + dx * sc - 1, cy + dz * sc - 1, 2, 2); }
  mmctx.fillStyle = "#e0b14a"; for (const c of chests) { if (c.opened) continue; const dx = c.x - px, dz = c.z - pz; if (dx * dx + dz * dz > R * R) continue; mmctx.fillRect(cx + dx * sc - 1.5, cy + dz * sc - 1.5, 3, 3); }
  for (const f of fires) { const dx = f.x - px, dz = f.z - pz; if (dx * dx + dz * dz > R * R) continue; mmctx.fillStyle = "#ff9a3c"; mmctx.beginPath(); mmctx.arc(cx + dx * sc, cy + dz * sc, 3, 0, 6.3); mmctx.fill(); }
  for (const id in remotes) { const r = remotes[id]; if (!r.g) continue; const dx = r.g.position.x - px, dz = r.g.position.z - pz; if (dx * dx + dz * dz > R * R) continue; mmctx.fillStyle = "#6fa3d6"; mmctx.beginPath(); mmctx.arc(cx + dx * sc, cy + dz * sc, 2.5, 0, 6.3); mmctx.fill(); }
  if (watcher) { const dx = watcher.x - px, dz = watcher.z - pz; if (dx * dx + dz * dz <= R * R) { mmctx.fillStyle = "#ff1010"; mmctx.beginPath(); mmctx.arc(cx + dx * sc, cy + dz * sc, 3.6, 0, 6.3); mmctx.fill(); } }
  camera.getWorldDirection(_fwd);
  mmctx.save(); mmctx.translate(cx, cy); mmctx.rotate(Math.atan2(_fwd.z, _fwd.x) + Math.PI / 2);
  mmctx.fillStyle = "#fff"; mmctx.beginPath(); mmctx.moveTo(0, -6); mmctx.lineTo(4.5, 5); mmctx.lineTo(-4.5, 5); mmctx.closePath(); mmctx.fill(); mmctx.restore();
}
function updateHUD(night) {
  $("dayNum").textContent = S.day;
  const [ic, tx] = phaseInfo(S.time); $("phaseIcon").textContent = ic; $("phaseText").textContent = tx;
  bars.health.style.width = S.health + "%"; bars.hunger.style.width = S.hunger + "%"; bars.warmth.style.width = S.warmth + "%"; bars.sanity.style.width = S.sanity + "%"; bars.stamina.style.width = S.stamina + "%";
  invEl.wood.textContent = S.inv.wood; invEl.raw.textContent = S.inv.raw; invEl.cooked.textContent = S.inv.cooked;
  invEl.metal.textContent = S.inv.metal; invEl.pelt.textContent = S.inv.pelt; invEl.bandage.textContent = S.inv.bandage;
  const t = findTarget();
  if (t) {
    const key = isTouch ? "VUR" : "[Sol tık / E]";
    const txt = t.kind === "tree" ? "🪓 Odun kes " : t.kind === "scrap" ? "⚙️ Metal topla " : t.kind === "chest" ? "📦 Sandığı aç " : "⚔️ " + (t.obj.hostile ? "Savaş " : "Avla ");
    promptEl.textContent = txt + key; promptEl.classList.remove("hidden");
  } else promptEl.classList.add("hidden");
  // pusula
  let nf = null, nd = 1e9; for (const f of fires) { const d = (f.x - camera.position.x) ** 2 + (f.z - camera.position.z) ** 2; if (d < nd) { nd = d; nf = f; } }
  const comp = $("compass");
  if (nf && Math.sqrt(nd) > 12) { $("compassDist").textContent = Math.round(Math.sqrt(nd)) + "m"; comp.classList.remove("hidden"); } else comp.classList.add("hidden");
  whisperEl.style.color = "rgba(180,20,20," + clamp(whisperT / 2.2, 0, 1) * 0.85 + ")";
  drawMinimap();
}

/* ----------------------- RESIZE ----------------------- */
function resize() {
  const w = window.innerWidth, h = window.innerHeight, dpr = Math.min(window.devicePixelRatio || 1, 2);
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
  }
  if (jumpT > 0 && !glitch) { fxc.fillStyle = Math.random() > 0.5 ? "#120000" : "#3a0000"; fxc.fillRect(0, 0, w, h); drawScaryFace(w, h, jumpFace); }
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
function startTalk() {
  if (talking || !S || !S.running) return; talking = true;
  $("voice").classList.remove("hidden");
  const vb = $("btn-voice"); if (vb) vb.classList.add("on");
  if (net.online) net.setMic(true);
  else if (!micStream && navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
    navigator.mediaDevices.getUserMedia({ audio: true }).then((s) => { micStream = s; }).catch(() => {});
  }
  if (!voiceHinted) { voiceHinted = true; toast(net.online ? "🎤 Konuşuyorsun (co-op)" : "🎤 Bas-konuş — co-op'ta arkadaşlara iletilir", "good"); }
}
function stopTalk() {
  if (!talking) return; talking = false;
  $("voice").classList.add("hidden");
  const vb = $("btn-voice"); if (vb) vb.classList.remove("on");
  if (net.online) net.setMic(false);
}

/* ----------------------- BOOT / MENU ----------------------- */
function startGame() {
  if (!built) { try { buildScene(); built = true; } catch (e) { $("loadNote").textContent = "3B başlatılamadı: " + e.message + " — 'npm install' yaptın mı?"; throw e; } }
  S = newState();
  glitch = null; jumpT = 0;
  // dünyayı sıfırla
  for (let i = 0; i < trees.length; i++) { trees[i].alive = true; trees[i].hp = 4; trees[i].regrow = 0; }
  refreshTrees();
  clearDynamic(); watcherGroup = null; wCd = 8; wEnc = 0;
  for (let i = 0; i < 16; i++) spawnPrey();
  camera.position.set(0, CFG.EYE, 0); yaw = 0; pitch = 0;
  // başlangıç kamp ateşi (üs): büyük yakıt deposu — odun atıp uzun yakabilirsin
  const base = makeFire(0, -3); base.max = 600; base.fuel = 150;
  Sound.init(); Sound.resume();
  S.running = true;
  craftOpen = false; pauseOpen = false;
  $("craft").classList.add("hidden"); $("pause").classList.add("hidden"); $("downed").classList.add("hidden");
  $("start").classList.add("hidden"); $("gameover").classList.add("hidden"); $("win").classList.add("hidden");
  $("hud").classList.remove("hidden"); crosshair.classList.remove("hidden"); $("pauseBtn").classList.remove("hidden");
  $("btn-craft").classList.toggle("hidden", false);
  const wantMobile = isTouch || (window.matchMedia && window.matchMedia("(pointer: coarse)").matches) || window.innerWidth < 820;
  if (wantMobile) $("mobile").classList.remove("hidden");
  else { $("mobile").classList.add("hidden"); threeCanvas.requestPointerLock && threeCanvas.requestPointerLock(); }
  goFullscreen();                                  // BAŞLA ile tam ekran (F11)
  toast("🌴 Amazon'a hoş geldin. Ateşi besle, geceye hazırlan...", "good");
  setTimeout(() => toast("🪓 Ağaç kes → 🔥'e odun at (çok odun = uzun yanar). ⚙️ hurda + 📦 sandık topla.", "good"), 2600);
  setTimeout(() => toast(isTouch ? "🛠️ Üret · 🩹 bandaj · KOŞ" : "🛠️ C: tezgah · 🩹 B: bandaj · ⛺ T: çadırda uyu · V: konuş", "good"), 5600);
}

$("startBtn").addEventListener("click", startGame);
$("retryBtn").addEventListener("click", startGame);
$("winBtn").addEventListener("click", startGame);
let audioOn = true;
$("audioToggleStart").addEventListener("click", () => { audioOn = !audioOn; Sound.setOn(audioOn); $("audioToggleStart").textContent = audioOn ? "🔊 Ses: AÇIK" : "🔇 Ses: KAPALI"; });
$("camToggleStart").addEventListener("click", async () => {
  const b = $("camToggleStart");
  if (camEnabled) { try { camStream && camStream.getTracks().forEach((t) => t.stop()); } catch (e) {} camEnabled = false; camStream = null; b.textContent = "📷 Kamera korkusu: KAPALI"; return; }
  b.textContent = "📷 İzin isteniyor..."; try { await enableCamScare(); b.textContent = "📷 Kamera korkusu: AÇIK 😈"; } catch (e) { b.textContent = "📷 Kamera açılamadı (izin yok)"; }
});
$("cr-close").addEventListener("click", () => closeCraft());
const pauseBtn = $("pauseBtn");
pauseBtn.addEventListener("click", () => togglePause());
pauseBtn.addEventListener("touchstart", (e) => { isTouch = true; togglePause(); e.preventDefault(); }, { passive: false });
addEventListener("keydown", (e) => { if (e.key === "Escape" && S && S.running) { e.preventDefault(); if (craftOpen) closeCraft(); else togglePause(); } });
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

loadAccount(); if (account) showMe();
$("ac-create").addEventListener("click", () => {
  const email = $("ac-email").value.trim(), user = $("ac-user").value.trim(), p = $("ac-pass").value, p2 = $("ac-pass2").value;
  if (!email || !email.includes("@")) return acctMsg("Geçerli bir e-posta gir.");
  if (user.length < 2) return acctMsg("Kullanıcı adı en az 2 karakter.");
  if (p.length < 4) return acctMsg("Şifre en az 4 karakter.");
  if (p !== p2) return acctMsg("Şifreler eşleşmiyor.");
  account = { email, user, pass: p, id: genFriendId() }; saveAccount(); showMe(); acctMsg("Hesap oluşturuldu! ID: " + account.id, true);
});
$("ac-login").addEventListener("click", () => {
  const u = $("ac-luser").value.trim(), p = $("ac-lpass").value;
  if (account && (u === account.user || u === account.email) && p === account.pass) { showMe(); acctMsg("Giriş başarılı.", true); }
  else acctMsg("Bu cihazda eşleşen hesap yok (yerel kayıt). Önce hesap oluştur.");
});
$("ac-copy").addEventListener("click", () => { if (account && navigator.clipboard) navigator.clipboard.writeText(account.id).then(() => acctMsg("ID kopyalandı.", true), () => {}); });
$("ac-continue").addEventListener("click", () => {
  if (!account) { account = { email: "", user: "Gezgin" + Math.floor(Math.random() * 900 + 100), pass: "", id: genFriendId() }; saveAccount(); }
  $("account").classList.add("hidden"); $("start").classList.remove("hidden");
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
  r.tx = d.x; r.tz = d.z; r.yaw = d.yaw; r.downed = !!d.downed;
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
$("mp-copy").addEventListener("click", () => { if (net.id && navigator.clipboard) navigator.clipboard.writeText(net.id); });
$("pz-voice").addEventListener("click", async () => {
  try { await net.enableMic(); $("pz-voice").classList.add("on"); $("pz-voice").textContent = "🎤 Sesli sohbet: AÇIK (V ile bas-konuş)"; mpMsg("Mikrofon hazır — konuşmak için V'ye basılı tut."); }
  catch (e) { mpMsg("Mikrofon açılamadı (tarayıcı izni gerekli)."); }
});
$("pz-resume").addEventListener("click", () => closePause());
$("pz-menu").addEventListener("click", () => location.reload());

net.onStatus = (s) => mpMsg(s);
net.onJoin = (id, meta) => { remoteName[id] = (meta && meta.name) || id; toast("🟢 Katıldı: " + remoteName[id], "good"); renderFriends(); };
net.onLeave = (id) => { toast("🔴 Ayrıldı: " + (remoteName[id] || id), "bad"); removeRemote(id); renderFriends(); };
net.onState = (id, d) => updateRemote(id, d);
net.onData = (id, d) => {
  if (!d || !S) return;
  if (d.t === "down") { toast("🩸 " + (remoteName[id] || "Arkadaşın") + " yere düştü — bandajla diriltin!", "bad"); const r = remotes[id]; if (r) r.downed = true; }
  else if (d.t === "revived" && d.id === net.id) { if (S.downed) reviveSelf(); }                 // biri beni diriltti
  else if (d.t === "revived") { const r = remotes[d.id]; if (r) r.downed = false; }
};

/* ESC: durdur / sosyal menü */
let pauseOpen = false;
function openPause() {
  if (!S || !S.running || pauseOpen) return; pauseOpen = true;
  const multi = net.online && net.peerCount() > 0;
  if (!multi) S.paused = true;                       // tek oyunculu -> oyunu durdur
  $("pauseStatus").textContent = multi ? "👥 Co-op sürüyor — oyun ARKA PLANDA devam ediyor" : "Oyun duraklatıldı";
  $("mp-myid").textContent = net.id || (account && account.id) || "—";
  renderFriends();
  $("pause").classList.remove("hidden");
  if (document.exitPointerLock) document.exitPointerLock();
}
function closePause() {
  pauseOpen = false; if (S) S.paused = false; $("pause").classList.add("hidden");
  if (!isTouch && S && S.running && threeCanvas.requestPointerLock) threeCanvas.requestPointerLock();
}
function togglePause() { if (pauseOpen) closePause(); else openPause(); }

resize();
// Render döngüsü: sahne kurulmadan da (menüde) FX katmanını temiz tutar; START ile sahne kurulur.
function rafLoop() { loop(); requestAnimationFrame(rafLoop); }
requestAnimationFrame(rafLoop);
