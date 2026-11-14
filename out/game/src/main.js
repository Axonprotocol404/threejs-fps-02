// DUSTLINE Sector 7 — entry point. Renders the simulation: three.js scene,
// viewmodel gun, bot meshes, tracers, explosions and smoke. The loop runs the
// simulation at a fixed 1/60 s step and renders the state; it never simulates.
import * as THREE from 'three';
import { Sim, STEP } from './sim.js';
import { Input } from './input.js';
import { HUD } from './hud.js';
import { PALETTE } from './palette.js';
import { WALLS, SITES, ARENA } from './world.js';
import { ensureAudio, sfx } from './audio.js';

const params = new URLSearchParams(location.search);
const SHOT = params.get('shot'); // start | play | end — scripted shot for screenshots
const SEED = Number(params.get('seed') || 1);

window.__errors = [];
window.addEventListener('error', (e) => window.__errors.push(String(e.message || e.error)));

let seedState = SEED * 2654435761 >>> 0;
function seededRandom() {
  seedState = (seedState * 1664525 + 1013904223) >>> 0;
  return seedState / 4294967296;
}
if (SHOT) Math.random = seededRandom;

const sim = new Sim();
const canvasHost = document.getElementById('game');
const input = new Input(canvasHost);
const hud = new HUD(sim,
  (id) => { if (sim.buyWeapon(id)) { sfx.buy(); } else sfx.denied(); },
  (kind) => { if (sim.buyGrenade(kind)) { sfx.buy(); } else sfx.denied(); },
  () => resumeGame());

window.__game = { sim, input };

// ---------- Renderer / scene ----------
let renderer;
try {
  renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
} catch (e) {
  document.getElementById('overlay-title').textContent = 'WebGL unavailable';
  document.getElementById('overlay-copy').textContent = 'DUSTLINE needs a browser with WebGL 2. ' + e.message;
  throw e;
}
renderer.setSize(innerWidth, innerHeight);
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
canvasHost.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(PALETTE.sky);
scene.fog = new THREE.Fog(PALETTE.fog, 30, 110);

const camera = new THREE.PerspectiveCamera(75, innerWidth / innerHeight, 0.05, 200);
camera.rotation.order = 'YXZ';
scene.add(camera);

const hemi = new THREE.HemisphereLight(0xa8bfd4, 0x4a4034, 1.5);
scene.add(hemi);
const fill = new THREE.DirectionalLight(0x8aa2c0, 0.95);
fill.position.set(-24, 30, -18);
scene.add(fill);
const sun = new THREE.DirectionalLight(0xffd9a0, 2.4);
sun.position.set(28, 42, 14);
sun.castShadow = true;
sun.shadow.mapSize.set(1024, 1024);
sun.shadow.camera.left = -40;
sun.shadow.camera.right = 40;
sun.shadow.camera.top = 40;
sun.shadow.camera.bottom = -40;
sun.shadow.camera.far = 120;
scene.add(sun);

// ---------- Procedural textures (the game's own art, made in code) ----------
function concreteTexture() {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = '#3a3f45';
  g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 2600; i++) {
    g.fillStyle = `rgba(${20 + Math.random() * 40 | 0},${20 + Math.random() * 40 | 0},${22 + Math.random() * 40 | 0},0.25)`;
    g.fillRect(Math.random() * 256, Math.random() * 256, 2, 2);
  }
  g.strokeStyle = 'rgba(0,0,0,0.35)';
  g.lineWidth = 2;
  for (let i = 0; i <= 4; i++) {
    g.beginPath(); g.moveTo(i * 64, 0); g.lineTo(i * 64, 256); g.stroke();
    g.beginPath(); g.moveTo(0, i * 64); g.lineTo(256, i * 64); g.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(16, 11);
  return t;
}

function hazardTexture(base) {
  const c = document.createElement('canvas');
  c.width = 128; c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = base;
  g.fillRect(0, 0, 128, 128);
  g.fillStyle = '#f0a830';
  for (let i = -2; i < 6; i++) {
    g.beginPath();
    g.moveTo(i * 32, 128); g.lineTo(i * 32 + 32, 128); g.lineTo(i * 32 + 64, 0); g.lineTo(i * 32 + 32, 0);
    g.closePath(); g.fill();
  }
  g.fillStyle = 'rgba(0,0,0,0.45)';
  g.fillRect(0, 0, 128, 14);
  return new THREE.CanvasTexture(c);
}

// ---------- World meshes ----------
const materials = {
  wall: new THREE.MeshStandardMaterial({ color: PALETTE.wall, roughness: 0.9 }),
  wallDark: new THREE.MeshStandardMaterial({ color: PALETTE.wallDark, roughness: 0.95 }),
  wallTop: new THREE.MeshStandardMaterial({ color: PALETTE.wallTop, roughness: 0.85 }),
  crate: new THREE.MeshStandardMaterial({ color: PALETTE.crate, roughness: 0.85 }),
  crateDark: new THREE.MeshStandardMaterial({ color: PALETTE.crateDark, roughness: 0.9 }),
  containerA: new THREE.MeshStandardMaterial({ map: hazardTexture('#7a4a2e'), roughness: 0.8 }),
  containerB: new THREE.MeshStandardMaterial({ map: hazardTexture('#2e5d6e'), roughness: 0.8 }),
};

const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(70, 50),
  new THREE.MeshStandardMaterial({ map: concreteTexture(), roughness: 0.95 }),
);
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);

for (const w of WALLS) {
  const mat = materials[w.kind] || materials.wall;
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w.w, w.h, w.d), mat);
  mesh.position.set(w.x, w.h / 2, w.z);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  scene.add(mesh);
  // A pale cap so wall tops read as a separate plane.
  const cap = new THREE.Mesh(new THREE.BoxGeometry(w.w + 0.06, 0.08, w.d + 0.06), materials.wallTop);
  cap.position.set(w.x, w.h + 0.02, w.z);
  scene.add(cap);
}

// Site markers: glowing rings + lights.
const siteMeshes = {};
for (const [key, s] of Object.entries(SITES)) {
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(s.r - 0.35, s.r, 48),
    new THREE.MeshBasicMaterial({ color: key === 'A' ? PALETTE.siteA : PALETTE.siteB, transparent: true, opacity: 0.55, side: THREE.DoubleSide }),
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.set(s.x, 0.03, s.z);
  scene.add(ring);
  const light = new THREE.PointLight(key === 'A' ? PALETTE.siteA : PALETTE.siteB, 12, 18, 1.8);
  light.position.set(s.x, 3.2, s.z);
  scene.add(light);
  siteMeshes[key] = ring;
}

// ---------- Bot meshes ----------
const botMeshes = [];
function makeBotMesh(i) {
  const g = new THREE.Group();
  const bodyMat = new THREE.MeshStandardMaterial({ color: 0x8a4a38, roughness: 0.8 });
  const darkMat = new THREE.MeshStandardMaterial({ color: 0x2b2320, roughness: 0.85 });
  const visorMat = new THREE.MeshStandardMaterial({ color: PALETTE.enemy, emissive: PALETTE.enemy, emissiveIntensity: 0.9 });
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.32, 0.72, 4, 10), bodyMat);
  body.position.y = 0.82;
  body.castShadow = true;
  g.add(body);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.2, 14, 12), darkMat);
  head.position.y = 1.52;
  head.castShadow = true;
  g.add(head);
  const visor = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.07, 0.06), visorMat);
  visor.position.set(0, 1.54, -0.17);
  g.add(visor);
  const gun = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.12, 0.85), darkMat);
  gun.position.set(0.22, 1.05, -0.35);
  g.add(gun);
  // Name tag: a small floating sprite is overkill; the visor + colour carry it.
  scene.add(g);
  return g;
}
for (let i = 0; i < 4; i++) botMeshes.push(makeBotMesh(i));

// ---------- Spike, grenades, smoke, explosion ----------
const spikeMesh = new THREE.Group();
{
  const box = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.2, 0.44),
    new THREE.MeshStandardMaterial({ color: 0x222222, emissive: PALETTE.accentHot, emissiveIntensity: 0.4 }));
  box.position.y = 0.1;
  spikeMesh.add(box);
  const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 8),
    new THREE.MeshBasicMaterial({ color: PALETTE.accentHot }));
  lamp.position.set(0, 0.24, 0);
  spikeMesh.add(lamp);
  spikeMesh.visible = false;
  scene.add(spikeMesh);
}

const grenadeMeshes = new Map(); // sim grenade object -> mesh
const smokeMeshes = [];
function makeSmokeMesh() {
  const m = new THREE.Mesh(
    new THREE.SphereGeometry(1, 18, 14),
    new THREE.MeshStandardMaterial({ color: PALETTE.smoke, transparent: true, opacity: 0.5, roughness: 1, depthWrite: false }),
  );
  m.visible = false;
  scene.add(m);
  return m;
}
for (let i = 0; i < 4; i++) smokeMeshes.push(makeSmokeMesh());

const explosion = new THREE.Group();
const explosionBall = new THREE.Mesh(
  new THREE.SphereGeometry(1, 20, 16),
  new THREE.MeshBasicMaterial({ color: 0xff8c2a, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }),
);
const explosionLight = new THREE.PointLight(0xff8c2a, 0, 30, 1.6);
explosion.add(explosionBall);
explosion.add(explosionLight);
explosion.visible = false;
scene.add(explosion);
let explosionT = 1e9;

// ---------- Viewmodel gun ----------
const gun = new THREE.Group();
{
  const dark = new THREE.MeshStandardMaterial({ color: 0x1c1e22, roughness: 0.5, metalness: 0.6 });
  const mid = new THREE.MeshStandardMaterial({ color: 0x3a3f45, roughness: 0.55, metalness: 0.5 });
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.13, 0.42), dark);
  gun.add(body);
  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.26, 10), mid);
  barrel.rotation.x = Math.PI / 2;
  barrel.position.set(0, 0.02, -0.32);
  gun.add(barrel);
  const mag = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.15, 0.1), mid);
  mag.position.set(0, -0.12, -0.04);
  mag.rotation.x = 0.25;
  gun.add(mag);
  const sight = new THREE.Mesh(new THREE.BoxGeometry(0.018, 0.03, 0.05), new THREE.MeshStandardMaterial({ color: PALETTE.accent, emissive: PALETTE.accent, emissiveIntensity: 0.5 }));
  sight.position.set(0, 0.08, -0.07);
  gun.add(sight);
  gun.scale.setScalar(0.55);
  gun.position.set(0.27, -0.24, -0.55);
  camera.add(gun);
}
const muzzle = new THREE.PointLight(0xffd27a, 0, 9, 2);
muzzle.position.set(0.26, -0.18, -0.8);
camera.add(muzzle);
let muzzleT = 1e9;

// ---------- Tracers ----------
const tracers = [];
for (let i = 0; i < 32; i++) {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
  const mat = new THREE.LineBasicMaterial({ color: PALETTE.tracer, transparent: true, opacity: 0, blending: THREE.AdditiveBlending });
  const line = new THREE.Line(geo, mat);
  line.visible = false;
  line.frustumCulled = false;
  scene.add(line);
  tracers.push({ line, life: 0 });
}
function spawnTracer(from, to, by) {
  const t = tracers.find((x) => x.life <= 0) || tracers[0];
  const pos = t.line.geometry.attributes.position;
  pos.setXYZ(0, from.x, from.y, from.z);
  pos.setXYZ(1, to.x, to.y, to.z);
  pos.needsUpdate = true;
  t.line.material.color.set(by === 'player' ? PALETTE.tracer : 0xff7a5a);
  t.line.visible = true;
  t.life = 0.12;
}

// ---------- Event handling ----------
let scriptedFire = 0; // shot mode: hold the trigger for a few steps
function handleEvents() {
  for (const ev of sim.events.splice(0)) {
    switch (ev.type) {
      case 'shot':
        sfx.shot(ev.weapon, ev.dist || 0);
        if (ev.by === 'player') muzzleT = 0;
        break;
      case 'tracer': spawnTracer(ev.from, ev.to, ev.by); break;
      case 'hitmarker': hud.showHitmarker(ev.killed); if (ev.killed) sfx.kill(); else sfx.hit(); break;
      case 'hurt': hud.showHurt(); sfx.hurt(); break;
      case 'dryFire': sfx.dryFire(); break;
      case 'reload': sfx.reload(); break;
      case 'grenadePin': sfx.grenadePin(); break;
      case 'bounce': sfx.bounce(); break;
      case 'explosion': {
        explosion.position.set(ev.x, ev.y, ev.z);
        explosion.visible = true;
        explosionT = 0;
        sfx.explosion();
        break;
      }
      case 'smoke': break;
      case 'plantBeep': sfx.plantBeep(); break;
      case 'planted': sfx.roundWin(); break;
      case 'roundEnd': {
        const won = ev.winner === 'atk';
        hud.showBanner(won ? 'ROUND WON' : 'ROUND LOST',
          ev.reason === 'detonation' ? 'Spike detonated' : ev.reason === 'elimination' ? 'All Sentinels eliminated'
            : ev.reason === 'defused' ? 'Spike defused' : ev.reason === 'time' ? 'Time expired'
              : ev.reason === 'eliminated' ? 'You were eliminated' : '',
          won ? 'win' : 'lose', 4);
        if (won) sfx.roundWin(); else sfx.roundLose();
        break;
      }
      case 'matchEnd': {
        const w = ev.winner;
        hud.setOverlay(
          w === 'atk' ? 'VICTORY — SECTOR 7 IS YOURS' : w === 'def' ? 'DEFEAT — SENTINELS HOLD SECTOR 7' : 'DRAW',
          `Final score ${sim.scoreAtk} : ${sim.scoreDef}. ${w === 'atk' ? 'The spike did its work.' : 'The Sentinels kept their ground.'}`,
          'Play again');
        break;
      }
      case 'roundStart': hud.showBanner('ROUND ' + ev.round, 'Plant the spike at A or B — or clear the Sentinels', '', 3); break;
      default: break;
    }
  }
}

// ---------- Game flow ----------
let started = false;
function resumeGame() {
  ensureAudio();
  hud.hideOverlay();
  hud.setBuyOpen(false);
  input.enabled = true;
  if (!started) {
    started = true;
    sim.startMatch();
  }
  if (!SHOT) input.requestLock();
}

input.onLockChange = (locked) => {
  if (!locked && started && sim.phase === 'live' && !hud.buyOpen && !SHOT) {
    hud.setOverlay('Paused', 'Click to resume — the Sentinels are still out there.', 'Resume');
  }
};
input.onFirstGesture = () => ensureAudio();

document.addEventListener('keydown', (e) => {
  if (e.code === 'KeyB' && started && sim.phase === 'buy' && !SHOT) {
    const open = !hud.buyOpen;
    hud.setBuyOpen(open);
    input.enabled = !open;
    if (open) input.exitLock();
    else input.requestLock();
  }
  if (e.code === 'Escape' && hud.buyOpen) {
    hud.setBuyOpen(false);
    input.enabled = true;
    input.requestLock();
  }
});

hud.setOverlay('DUSTLINE — SECTOR 7',
  'Round-based tactical FPS. Plant the spike at A (Foundry) or B (Yard), or eliminate all four Sentinels. Earn money, buy better guns between rounds. WASD move · mouse look · click fire · R reload · Ctrl crouch · Shift sprint · Space jump · G frag · H smoke · B buy menu.',
  'Click to play');
if (SHOT) hud.hideOverlay();

// ---------- Shot modes (scripted scenes for the screenshots) ----------
function applyShotMode() {
  if (!SHOT) return;
  ensureAudio();
  started = true;
  sim.startMatch();
  const p = sim.player;
  if (SHOT === 'start') {
    // Spawn view, buy phase, two Sentinels visible down the west lane.
    p.x = -26; p.z = 17; p.yaw = -1.0; p.pitch = 0.01;
    sim.bots[0].x = -14; sim.bots[0].z = -6; sim.bots[0].yaw = Math.PI;
    sim.bots[1].x = -8; sim.bots[1].z = 2; sim.bots[1].yaw = Math.PI * 0.5;
    sim.bots[2].x = 22; sim.bots[2].z = -12; sim.bots[2].yaw = Math.PI;
    sim.bots[3].x = 6; sim.bots[3].z = -2; sim.bots[3].yaw = Math.PI;
  } else if (SHOT === 'play') {
    // Mid-round firefight, west lane: rifle bought with granted funds, two
    // Sentinels in the open lane ahead, tracer streaking between them to the
    // far wall. (The mid block at x in [-6, 6] hides anything placed behind
    // it, so both bots stand clear of it; the aim point sits between them so
    // the burst stays visible and neither bot dies before the screenshot.)
    sim.money = 5000;
    sim.buyWeapon('ar77');
    // Scripted capture only: the player cannot die mid-screenshot while
    // Sentinel 3 returns fire down the lane. Real rounds never set this.
    sim.shotInvulnerable = true;
    sim.phase = 'live';
    sim.phaseT = 78;
    p.x = -14; p.z = 10; p.yaw = -0.11; p.pitch = 0.02;
    // Both Sentinels face north, down the lane, backs to the player: at
    // 12 m they only spot the player inside their view cone, so they hold
    // their angles instead of gunning the player down mid-screenshot.
    // (Their hearing still pulls them to investigate the gunfire — but the
    // walk takes seconds, and the capture lands first.)
    sim.bots[0].x = -16; sim.bots[0].z = -2; sim.bots[0].yaw = 0; sim.bots[0].state = 'hold'; sim.bots[0].targetSeen = 0;
    sim.bots[1].x = -9; sim.bots[1].z = -5; sim.bots[1].yaw = 0;
    sim.bots[2].x = 22; sim.bots[2].z = -12; sim.bots[2].yaw = 0; sim.bots[2].state = 'hold';
    // The fourth Sentinel, far west at A, holds the lane on the player: at
    // 25 m its bursts mostly miss, but its orange tracers streak across the
    // view — the visible firefight — while the player survives the capture.
    sim.bots[3].x = -22; sim.bots[3].z = -14; sim.bots[3].yaw = Math.PI; sim.bots[3].state = 'engage'; sim.bots[3].targetSeen = 1.5;
  } else if (SHOT === 'end') {
    // Round won at site A: spike planted, Sentinels down, banner up.
    sim.phase = 'roundEnd';
    sim.phaseT = 4.0;
    sim.roundWinner = 'atk';
    sim.scoreAtk = 4; sim.scoreDef = 2;
    sim.planted = { site: 'A', x: -23, z: -16, timer: 12 };
    p.x = -18; p.z = -10; p.yaw = 0.9; p.pitch = 0.0;
    for (const b of sim.bots) { b.hp = 0; }
    sim.bots[0].x = -24; sim.bots[0].z = -15;
    sim.bots[1].x = -20; sim.bots[1].z = -18;
    hud.showBanner('ROUND WON', 'Spike detonated', 'win', 30);
  }
  sim.events.length = 0;
}
applyShotMode();

// ---------- Main loop ----------
let last = performance.now();
let acc = 0;
let frames = 0;
let bobPhase = 0;

function frame(now) {
  requestAnimationFrame(frame);
  const dtMs = Math.min(100, now - last);
  last = now;
  const dt = dtMs / 1000;
  frames += 1;
  // Shot mode: the play scene's burst starts once the simulation has run
  // ~150 ms — a tracer only lives 0.12 s, so firing from the first frame
  // would have faded long before the capture, and a frame-count trigger is
  // useless here (early frames run the whole sim to 400 ms before frame 40
  // ever arrives). It never stops: holding the trigger keeps a fresh tracer
  // and muzzle flash in the frame whenever the capture lands.
  if (SHOT === 'play' && sim.timeMs >= 150 && scriptedFire === 0) scriptedFire = Infinity;

  // Input for this step (zeroed while the buy menu owns the pointer).
  const axes = hud.buyOpen ? { f: 0, s: 0 } : input.moveAxes();
  const look = { dx: hud.buyOpen ? 0 : input.mouseDX, dy: hud.buyOpen ? 0 : input.mouseDY };
  const fireHeld = !hud.buyOpen && input.mouseDown;
  const stepInput = {
    axes,
    look,
    fire: fireHeld || scriptedFire > 0,
    fireEdge: input.mouseDownEdge || scriptedFire > 0,
    altFire: !hud.buyOpen && input.rightDown,
    keys: input.keys,
    pressed: input.pressed,
  };
  if (scriptedFire > 0) scriptedFire -= 1;

  if (started) {
    // Cap the catch-up so a slow frame never spirals; leftover time is kept,
    // so the simulation tracks real time up to 5 steps a frame.
    acc = Math.min(acc + dt, 0.25);
    let n = 0;
    while (acc >= STEP && n < 5) {
      sim.step(STEP, stepInput);
      // Fresh per-step edges: only the first step of the frame sees them.
      stepInput.pressed = new Set();
      stepInput.fireEdge = false;
      acc -= STEP;
      n += 1;
    }
  }
  handleEvents();

  // Sync camera + viewmodel.
  const p = sim.player;
  camera.position.set(p.x, p.y + p.eyeH, p.z);
  camera.rotation.y = p.yaw;
  camera.rotation.x = p.pitch + p.recoilPitch;
  camera.fov = 75 / (hud && sim.zoomed > 1 ? sim.zoomed : 1);
  camera.updateProjectionMatrix();
  bobPhase += p.speed * dt * 1.6;
  const bob = Math.min(1, p.speed / 5) * (p.onGround ? 1 : 0);
  gun.position.set(
    0.27 + Math.sin(bobPhase) * 0.008 * bob,
    -0.24 + Math.abs(Math.cos(bobPhase)) * 0.01 * bob - (p.crouched ? 0.02 : 0),
    -0.55 + (sim.zoomed > 1 ? 0.12 : 0),
  );
  gun.rotation.x = p.recoilPitch * 1.2;
  muzzleT += dt;
  muzzle.intensity = muzzleT < 0.05 ? 26 : 0;

  // Sync bot meshes.
  for (let i = 0; i < sim.bots.length; i++) {
    const b = sim.bots[i];
    const m = botMeshes[i];
    m.position.set(b.x, 0, b.z);
    m.rotation.y = b.yaw;
    if (b.hp <= 0) {
      m.rotation.x = -Math.PI / 2;
      m.position.y = 0.25;
    } else {
      m.rotation.x = 0;
      m.position.y = 0;
    }
    m.visible = true;
  }

  // Spike mesh.
  if (sim.planted) {
    spikeMesh.visible = true;
    spikeMesh.position.set(sim.planted.x, 0, sim.planted.z);
    spikeMesh.children[1].material.color.setHex(Math.floor(sim.time * 4) % 2 === 0 ? PALETTE.accentHot : 0x881100);
  } else {
    spikeMesh.visible = false;
  }

  // Grenade + smoke meshes.
  const seen = new Set();
  for (const g of sim.grenades) {
    seen.add(g);
    let m = grenadeMeshes.get(g);
    if (!m) {
      m = new THREE.Mesh(new THREE.SphereGeometry(0.09, 10, 8),
        new THREE.MeshStandardMaterial({ color: 0x222222 }));
      scene.add(m);
      grenadeMeshes.set(g, m);
    }
    m.position.set(g.x, g.y, g.z);
    m.visible = true;
  }
  for (const [g, m] of grenadeMeshes) {
    if (!seen.has(g)) { m.visible = false; grenadeMeshes.delete(g); }
  }
  sim.smoke.forEach((c, i) => {
    const m = smokeMeshes[i % smokeMeshes.length];
    m.visible = true;
    m.position.set(c.x, c.y, c.z);
    const s = c.r * (1 + 0.1 * Math.sin(sim.time * 0.7 + i));
    m.scale.set(s, s * 0.7, s);
  });
  for (let i = sim.smoke.length; i < smokeMeshes.length; i++) smokeMeshes[i].visible = false;

  // Explosion + tracers decay.
  explosionT += dt;
  if (explosionT < 0.7) {
    const k = explosionT / 0.7;
    explosionBall.scale.setScalar(1 + k * 7);
    explosionBall.material.opacity = 0.85 * (1 - k);
    explosionLight.intensity = 60 * (1 - k);
  } else {
    explosion.visible = false;
    explosionLight.intensity = 0;
  }
  for (const t of tracers) {
    if (t.life > 0) {
      t.life -= dt;
      t.line.material.opacity = Math.max(0, t.life / 0.12) * 0.9;
      if (t.life <= 0) t.line.visible = false;
    }
  }

  // HUD + site pulse.
  hud.update(sim.hudState());
  for (const [key, ring] of Object.entries(siteMeshes)) {
    ring.material.opacity = 0.4 + 0.2 * Math.sin(sim.time * 2 + (key === 'A' ? 0 : 2));
  }

  renderer.render(scene, camera);
  input.endFrame();

  if (SHOT && !window.__shotReady && sim.timeMs >= 400) {
    // Let the simulation (not the frame count) settle, then signal the
    // screenshot driver: under headless SwiftShader the sim advances only
    // ~17 ms per 45 frames, so a frame-count flag fires before the scene
    // has simulated at all.
    window.__shotReady = true;
  }
}

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

requestAnimationFrame(frame);
