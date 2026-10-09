// DEUCE viewer: watch the self-trained AI play itself, or play against a saved champion yourself.
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { createMatch, step, aiController, pointLabel, DT, COURT, CONTACT_AHEAD } from '/shared/tennis.js';
import { buildStadium } from './stadium.js';
import { makePlayer } from './players3d.js';

const $ = (id) => document.getElementById(id);
const touch = matchMedia('(pointer: coarse)').matches;
const small = Math.min(innerWidth, innerHeight) < 600;

// --- renderer / scene ---------------------------------------------------------------------------
const renderer = new THREE.WebGLRenderer({ canvas: $('view'), antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, small ? 1.5 : 2));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.95;
renderer.outputColorSpace = THREE.SRGBColorSpace;
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x070c18);
scene.fog = new THREE.Fog(0x070c18, 60, 130);
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.35;
scene.add(new THREE.HemisphereLight(0xdfe9ff, 0x1d3555, 0.45));
const key = new THREE.DirectionalLight(0xfff4e6, 2.1);
key.position.set(-14, 34, -10);
key.castShadow = true;
key.shadow.mapSize.set(small ? 1024 : 2048, small ? 1024 : 2048);
const sc = key.shadow.camera;
sc.left = -16; sc.right = 16; sc.top = 24; sc.bottom = -24; sc.near = 5; sc.far = 80;
key.shadow.bias = -0.0004;
key.shadow.normalBias = 0.02;
scene.add(key);
const fill = new THREE.DirectionalLight(0xbcd4ff, 0.6);
fill.position.set(12, 20, 16);
scene.add(fill);

const stadium = buildStadium(scene, { mobile: small });

// the one camera: broadcast view from behind the near baseline
const camera = new THREE.PerspectiveCamera(36, innerWidth / innerHeight, 0.5, 300);
const camTarget = new THREE.Vector3(0, 0, 1.0);
const camDir = new THREE.Vector3(0, 0.42, -1).normalize();
function fitCamera() {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  const pts = [[-6.2, -12.4], [6.2, -12.4], [-6.2, 12.4], [6.2, 12.4]].map(([x, z]) => new THREE.Vector3(x, 0, z));
  let lo = 10, hi = 120;
  for (let k = 0; k < 30; k++) {
    const d = (lo + hi) / 2;
    camera.position.copy(camTarget).addScaledVector(camDir, d);
    camera.lookAt(camTarget);
    camera.updateMatrixWorld();
    const ok = pts.every(p => { const v = p.clone().project(camera); return Math.abs(v.x) < 0.9 && Math.abs(v.y) < 0.92; });
    if (ok) hi = d; else lo = d;
  }
  camera.position.copy(camTarget).addScaledVector(camDir, Math.max(hi, 27));
  camera.lookAt(camTarget);
}
fitCamera();

// --- ball, shadow, trail, aim marker -------------------------------------------------------------
const ballMesh = new THREE.Mesh(new THREE.SphereGeometry(0.075, 16, 12), new THREE.MeshStandardMaterial({ color: 0xd9f24f, emissive: 0x6b7a10, emissiveIntensity: 0.6, roughness: 0.5 }));
ballMesh.castShadow = true;
scene.add(ballMesh);
const shadow = new THREE.Mesh(new THREE.CircleGeometry(0.11, 16), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.4, depthWrite: false }));
shadow.rotation.x = -Math.PI / 2;
scene.add(shadow);
const TRAIL = 18;
const trailPos = new Float32Array(TRAIL * 3), trailA = new Float32Array(TRAIL);
const trailGeo = new THREE.BufferGeometry();
trailGeo.setAttribute('position', new THREE.BufferAttribute(trailPos, 3));
trailGeo.setAttribute('a', new THREE.BufferAttribute(trailA, 1));
const trail = new THREE.Points(trailGeo, new THREE.ShaderMaterial({
  transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  uniforms: { uScale: { value: 400 } },
  vertexShader: 'attribute float a; varying float va; uniform float uScale; void main(){ vec4 mv = modelViewMatrix*vec4(position,1.0); gl_Position = projectionMatrix*mv; gl_PointSize = (0.05 + 0.1*a) * uScale / -mv.z; va = a; }',
  fragmentShader: 'varying float va; void main(){ float d = length(gl_PointCoord-0.5); if (d>0.5) discard; gl_FragColor = vec4(0.9,1.0,0.5, va*0.5*(1.0-d*2.0)); }',
}));
trail.frustumCulled = false;
scene.add(trail);
const aimMarker = new THREE.Mesh(new THREE.RingGeometry(0.28, 0.4, 32), new THREE.MeshBasicMaterial({ color: 0xd9f24f, transparent: true, opacity: 0.8, depthWrite: false }));
aimMarker.rotation.x = -Math.PI / 2;
aimMarker.position.y = 0.01;
aimMarker.visible = false;
scene.add(aimMarker);
const rings = [];
function bounceRing(x, z) {
  const r = new THREE.Mesh(new THREE.RingGeometry(0.1, 0.16, 24), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.8, depthWrite: false }));
  r.rotation.x = -Math.PI / 2;
  r.position.set(x, 0.012, z);
  scene.add(r);
  rings.push({ r, t: 0 });
}

// --- players -------------------------------------------------------------------------------------------
const looks = [{ shirt: 0xf5f7fa, shorts: 0x1b2a4a, skin: 0, hat: 0xffffff }, { shirt: 0xff6b4a, shorts: 0x222222, skin: 1, hat: 0x1b1b1b }];
const views = looks.map(l => makePlayer(l));
views.forEach(v => scene.add(v.root));
const swingSide = [0, 0];

// --- audio (synthesised) ----------------------------------------------------------------------------------
let actx = null;
function audio() {
  if (!actx) { try { actx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { actx = null; } }
  if (actx && actx.state === 'suspended') actx.resume();
  return actx;
}
function pop(freq, dur, vol) {
  const a = actx; if (!a || speed > 2) return;
  const o = a.createOscillator(), g = a.createGain();
  o.frequency.setValueAtTime(freq, a.currentTime);
  o.frequency.exponentialRampToValueAtTime(freq * 0.45, a.currentTime + dur);
  g.gain.setValueAtTime(vol, a.currentTime);
  g.gain.exponentialRampToValueAtTime(0.001, a.currentTime + dur);
  o.connect(g).connect(a.destination);
  o.start(); o.stop(a.currentTime + dur);
}
function cheer(len = 1.6, vol = 0.12) {
  const a = actx; if (!a || speed > 2) return;
  const n = a.sampleRate * len, buf = a.createBuffer(1, n, a.sampleRate), d = buf.getChannelData(0);
  for (let i = 0; i < n; i++) { const t = i / n; d[i] = (Math.random() * 2 - 1) * Math.min(1, t * 6) * (1 - t) * (0.6 + 0.4 * Math.sin(i * 0.002)); }
  const s = a.createBufferSource(), f = a.createBiquadFilter(), g = a.createGain();
  f.type = 'bandpass'; f.frequency.value = 1400; f.Q.value = 0.5;
  g.gain.value = vol;
  s.buffer = buf; s.connect(f).connect(g).connect(a.destination); s.start();
}

// --- state ----------------------------------------------------------------------------------------------
let mode = 'watch';
let speed = 1;
let match = null, ctrls = null, names = ['', ''], acc = 0, matchSeedT = 0;
let status = null, levels = [], chosenLevel = -1;
let lastScoreKey = '';

function decode(b64) {
  const bin = atob(b64), u = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  return new Float32Array(u.buffer);
}
async function getJSON(u) { const r = await fetch(u, { cache: 'no-store' }); return r.json(); }

let bannerT = 0;
function banner(text, sub = '', ms = 1500) {
  const b = $('banner');
  b.innerHTML = '';
  b.append(document.createTextNode(text));
  if (sub) { const s = document.createElement('small'); s.textContent = sub; b.append(s); }
  b.classList.add('show');
  clearTimeout(bannerT);
  bannerT = setTimeout(() => b.classList.remove('show'), ms);
}

// --- human controller ---------------------------------------------------------------------------------------
const human = {
  kind: 'human', mx: 0, mz: 0, aimX: 0, aimZ: 8, lob: false, slice: false, serveReq: false, forceServe: false,
  decide() {},
  wantsServe() { const r = this.serveReq || this.forceServe; this.serveReq = false; this.forceServe = false; return r; },
  shot(m, p, isServe) {
    if (isServe) {
      const deuce = (m.score.points[0] + m.score.points[1]) % 2 === 0;
      const r0 = deuce ? 0.25 : -COURT.halfW + 0.25, r1 = deuce ? COURT.halfW - 0.25 : -0.25;
      const ax = Math.max(r0, Math.min(r1, this.aimX));
      return { aimX: ((ax - r0) / (r1 - r0)) * 2 - 1, depth: Math.max(0, Math.min(1, (Math.min(this.aimZ, 6.2) - 2.2) / (COURT.serviceZ - 2.5))), power: 0.62, spin: 0.25, lift: 0 };
    }
    const base = { aimX: Math.max(-1, Math.min(1, this.aimX / (COURT.halfW - 0.35))), depth: Math.max(0, Math.min(1, (this.aimZ - 2) / (COURT.halfL - 2.5))) };
    if (this.lob) return { ...base, power: 0.28, spin: 0.25, lift: 0.95 };
    if (this.slice) return { ...base, power: 0.45, spin: -0.7, lift: 0.2 };
    return { ...base, power: 0.66, spin: 0.55, lift: 0.12 };
  },
};

// keyboard
const keys = new Set();
addEventListener('keydown', (e) => {
  keys.add(e.code);
  if (mode === 'play' && (e.code === 'Enter' || e.code === 'Space')) human.serveReq = true;
  if (e.code === 'Space') e.preventDefault();
  audio();
});
addEventListener('keyup', (e) => keys.delete(e.code));
function readKeys() {
  if (touchMove) return;
  let mx = 0, mz = 0;
  if (keys.has('KeyW') || keys.has('ArrowUp')) mz += 1;
  if (keys.has('KeyS') || keys.has('ArrowDown')) mz -= 1;
  if (keys.has('KeyA') || keys.has('ArrowLeft')) mx += 1;     // screen-left is +x from this camera
  if (keys.has('KeyD') || keys.has('ArrowRight')) mx -= 1;
  const l = Math.hypot(mx, mz) || 1;
  human.mx = mx / l; human.mz = mz / l;
  human.lob = keys.has('Space') || touchLob;
  human.slice = keys.has('ShiftLeft') || keys.has('ShiftRight') || touchSlice;
}

// aiming with the mouse / a finger on the far court
const ray = new THREE.Raycaster(), ground = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), hitP = new THREE.Vector3();
function aimAt(clientX, clientY) {
  const v = new THREE.Vector2((clientX / innerWidth) * 2 - 1, -(clientY / innerHeight) * 2 + 1);
  ray.setFromCamera(v, camera);
  if (!ray.ray.intersectPlane(ground, hitP)) return;
  human.aimX = Math.max(-COURT.halfW + 0.3, Math.min(COURT.halfW - 0.3, hitP.x));
  human.aimZ = Math.max(1.6, Math.min(COURT.halfL - 0.4, hitP.z));
}
$('view').addEventListener('pointermove', (e) => { if (mode === 'play' && e.pointerType === 'mouse') aimAt(e.clientX, e.clientY); });
$('view').addEventListener('pointerdown', (e) => {
  audio();
  if (mode !== 'play') return;
  aimAt(e.clientX, e.clientY);
  if (e.pointerType === 'mouse') human.serveReq = true;
});

// touch joystick + buttons
let touchMove = false, touchLob = false, touchSlice = false;
if (touch) {
  const stick = $('stick'), knob = $('knob');
  let id = null, cx = 0, cy = 0;
  stick.addEventListener('pointerdown', (e) => { id = e.pointerId; const r = stick.getBoundingClientRect(); cx = r.left + r.width / 2; cy = r.top + r.height / 2; stick.setPointerCapture(id); touchMove = true; move(e); audio(); });
  const move = (e) => {
    if (e.pointerId !== id) return;
    let dx = e.clientX - cx, dy = e.clientY - cy;
    const l = Math.hypot(dx, dy), max = 50;
    if (l > max) { dx *= max / l; dy *= max / l; }
    knob.style.transform = `translate(${dx}px, ${dy}px)`;
    human.mx = -dx / max; human.mz = -dy / max;
  };
  stick.addEventListener('pointermove', move);
  const end = (e) => { if (e.pointerId !== id) return; id = null; knob.style.transform = ''; human.mx = human.mz = 0; touchMove = false; };
  stick.addEventListener('pointerup', end);
  stick.addEventListener('pointercancel', end);
  const hold = (el, set) => {
    el.addEventListener('pointerdown', (e) => { e.preventDefault(); set(true); el.classList.add('on'); });
    for (const ev of ['pointerup', 'pointerleave', 'pointercancel']) el.addEventListener(ev, () => { set(false); el.classList.remove('on'); });
  };
  hold($('b-lob'), (v) => { touchLob = v; });
  hold($('b-slice'), (v) => { touchSlice = v; });
  $('b-serve').addEventListener('pointerdown', (e) => { e.preventDefault(); human.serveReq = true; audio(); });
  $('view').addEventListener('pointermove', (e) => { if (mode === 'play' && e.pointerType !== 'mouse' && e.buttons) aimAt(e.clientX, e.clientY); });
}

// --- matches ----------------------------------------------------------------------------------------------
async function startWatch() {
  mode = 'watch';
  document.body.classList.remove('playing');
  $('touch').hidden = true;
  $('keys').hidden = true;
  aimMarker.visible = false;
  let sc;
  try { sc = await getJSON('/api/showcase'); } catch (e) { setTimeout(startWatch, 3000); return; }
  if (mode !== 'watch') return;
  if (!sc.players) { $('w-match').textContent = 'Waiting for the first training generation…'; setTimeout(startWatch, 2000); return; }
  match = createMatch({ seed: sc.seed, format: { sets: 1, games: 4 } });
  ctrls = [aiController(decode(sc.players[0].genome)), aiController(decode(sc.players[1].genome))];
  names = [sc.players[0].name, sc.players[1].name];
  $('w-match').innerHTML = `<b>${names[0]}</b> <span style="color:#93a4bd">(${sc.players[0].label})</span><br>vs <b>${names[1]}</b> <span style="color:#93a4bd">(${sc.players[1].label})</span>`;
  acc = 0;
  lastScoreKey = '';
  $('loading').classList.add('hide');
}

function startPlay() {
  const lv = levels[chosenLevel];
  if (!lv) return;
  mode = 'play';
  speed = 1;
  document.body.classList.add('playing');
  const games = +document.querySelector('input[name=fmt]:checked').value;
  match = createMatch({ seed: (Math.random() * 1e9) | 0, format: { sets: 1, games }, server: 0 });
  ctrls = [human, aiController(decode(lv.genome))];
  names = ['You', `${lv.name} (L${lv.level})`];
  acc = 0;
  lastScoreKey = '';
  $('touch').hidden = !touch;
  $('keys').hidden = touch;
  $('quit').hidden = false;
  aimMarker.visible = true;
  banner(`LEVEL ${lv.level}`, `${lv.title} · ${lv.name}`, 2000);
  audio();
}

function handleEvents() {
  for (const e of match.events) {
    if (e.type === 'hit') {
      const p = match.players[e.side];
      swingSide[e.side] = (match.ball.x - p.x) * p.sign < 0 ? 0 : 1;   // racket is in the right hand (-x local)
      pop(e.serve ? 520 : 760, 0.09, 0.35);
    } else if (e.type === 'bounce') {
      bounceRing(e.x, e.z);
      pop(240, 0.06, 0.15);
    } else if (e.type === 'fault') {
      banner(e.why === 'net' ? 'NET · FAULT' : 'FAULT', '', 1100);
    } else if (e.type === 'point') {
      const label = { ace: 'ACE', winner: 'WINNER', out: 'OUT', net: 'NET', 'own side': 'OUT', 'double fault': 'DOUBLE FAULT' }[e.why] || '';
      if (label) banner(label, names[e.winner], 1300);
      cheer(e.why === 'winner' || e.why === 'ace' ? 2.0 : 1.2, e.why === 'winner' ? 0.16 : 0.09);
    } else if (e.type === 'match') {
      const who = names[e.winner];
      banner('GAME, SET & MATCH', mode === 'play' ? (e.winner === 0 ? 'You win!' : `${who} wins`) : who, 4000);
      cheer(3, 0.2);
    }
  }
}

function updateScore() {
  const s = match.score;
  const key = JSON.stringify([s.points, s.games, s.sets, s.server, s.tiebreak, names]);
  if (key === lastScoreKey) return;
  const prevGames = lastScoreKey ? JSON.parse(lastScoreKey)[1] : null;
  lastScoreKey = key;
  for (const i of [0, 1]) {
    const row = $('s' + i);
    row.classList.toggle('serving', s.server === i && match.phase !== 'over');
    row.querySelector('.nm').textContent = names[i];
    row.querySelector('.sets').textContent = s.sets[i] ? `${s.sets[i]} set` : '';
    row.querySelector('.gm').textContent = s.games[i];
    row.querySelector('.pt').textContent = match.phase === 'over' ? '' : pointLabel(match, i);
  }
  $('s-sub').textContent = s.tiebreak ? 'TIE-BREAK' : mode === 'play' ? 'YOU vs AI' : 'AI vs AI · SELF-PLAY';
  if (prevGames && (prevGames[0] !== s.games[0] || prevGames[1] !== s.games[1]) && match.phase !== 'over') {
    const w = s.games[0] > prevGames[0] ? 0 : 1;
    setTimeout(() => banner('GAME', names[w], 1400), 900);
  }
  stadium.setScoreboard([0, 1].map(i => ({ name: names[i], games: s.games[i], points: pointLabel(match, i), serving: s.server === i })));
}

// --- render loop -----------------------------------------------------------------------------------------
let last = performance.now(), matchEndT = 0;
const ballPrev = new THREE.Vector3();
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min((now - last) / 1000, 0.1);
  last = now;
  if (match) {
    if (mode === 'play') readKeys();
    acc += dt * speed;
    let n = 0;
    while (acc >= DT && n < 600) {
      step(match, ctrls);
      handleEvents();
      acc -= DT;
      n++;
    }
    if (n >= 600) acc = 0;
    updateScore();
    if (match.phase === 'over') {
      matchEndT += dt;
      if (matchEndT > 5 && mode === 'watch') { matchEndT = 0; startWatch(); }
    } else matchEndT = 0;
    render(dt);
  }
  for (let i = rings.length - 1; i >= 0; i--) {
    const r = rings[i];
    r.t += dt;
    r.r.scale.setScalar(1 + r.t * 6);
    r.r.material.opacity = Math.max(0, 0.8 - r.t * 1.6);
    if (r.t > 0.5) { scene.remove(r.r); r.r.geometry.dispose(); r.r.material.dispose(); rings.splice(i, 1); }
  }
  renderer.render(scene, camera);
}

function render(dt) {
  const b = match.ball;
  ballMesh.position.set(b.x, b.y, b.z);
  shadow.position.set(b.x, 0.006, b.z);
  shadow.material.opacity = Math.max(0.08, 0.45 - b.y * 0.08);
  shadow.scale.setScalar(1 + b.y * 0.15);
  // trail
  for (let i = TRAIL - 1; i > 0; i--) { trailPos[i * 3] = trailPos[i * 3 - 3]; trailPos[i * 3 + 1] = trailPos[i * 3 - 2]; trailPos[i * 3 + 2] = trailPos[i * 3 - 1]; }
  trailPos[0] = b.x; trailPos[1] = b.y; trailPos[2] = b.z;
  const live = b.live && match.phase === 'rally';
  for (let i = 0; i < TRAIL; i++) trailA[i] = live ? (1 - i / TRAIL) : trailA[i] * 0.85;
  trailGeo.attributes.position.needsUpdate = true;
  trailGeo.attributes.a.needsUpdate = true;
  ballPrev.copy(ballMesh.position);
  // players
  match.players.forEach((p, i) => {
    // seconds until the ball reaches this player's contact point (null if it is not coming)
    let contactT = null, ballDX = 0;
    if (b.live && b.lastHitter !== i && match.phase === 'rally' && !(b.serve && b.bounces === 0 && false)) {
      const fwd = (b.z - p.z) * p.sign - CONTACT_AHEAD;
      const vf = -b.vz * p.sign;
      if (vf > 0.5 && fwd > -0.3) {
        contactT = Math.max(0, fwd / vf);
        ballDX = (b.x + b.vx * contactT - p.x) * p.sign;      // local x of the ball at contact
      }
    }
    const serving = match.phase === 'serve' && match.score.server === i;
    const turn = Math.atan2((b.x - p.x) * p.sign, Math.max(1, (b.z - p.z) * p.sign)) * 0.4;
    views[i].update(p, p.sign, {
      speed: Math.hypot(p.vx, p.vz),
      swing: p.swing, swingType: p.swingType === 2 ? 2 : swingSide[i],
      tossing: serving ? Math.min(1, Math.max(0, (match.phaseT - 0.2) / 0.5)) : 0,
      contactT, forehand: ballDX < 0, turn: -turn * p.sign,
    }, dt * speed);
  });
  if (mode === 'play') {
    aimMarker.position.set(human.aimX, 0.012, human.aimZ);
    aimMarker.material.opacity = 0.55 + 0.25 * Math.sin(performance.now() * 0.006);
  }
}
requestAnimationFrame(frame);

// --- training status + levels ---------------------------------------------------------------------------
function drawChart(h) {
  const cv = $('chart'), dpr = Math.min(devicePixelRatio, 2);
  const W = cv.clientWidth * dpr, H = cv.clientHeight * dpr;
  if (!W) return;
  cv.width = W; cv.height = H;
  const g = cv.getContext('2d');
  g.clearRect(0, 0, W, H);
  if (!h || h.length < 2) return;
  const x0 = h[0].g, x1 = h[h.length - 1].g;
  const X = (v) => 4 + (v - x0) / Math.max(1, x1 - x0) * (W - 8);
  const series = [['rally', '#d9f24f'], ['elo', '#7fd3ff']];
  for (const [k, c] of series) {
    let lo = Infinity, hi = -Infinity;
    for (const p of h) { lo = Math.min(lo, p[k]); hi = Math.max(hi, p[k]); }
    if (k === 'rally') lo = 0;
    const span = hi - lo || 1;
    g.strokeStyle = c; g.lineWidth = 2 * dpr; g.beginPath();
    let sm = h[0][k];
    h.forEach((p, i) => { sm = sm * 0.7 + p[k] * 0.3; const y = H - 4 - (sm - lo) / span * (H - 8); if (i) g.lineTo(X(p.g), y); else g.moveTo(X(p.g), y); });
    g.stroke();
  }
}

function renderLevels() {
  const ol = $('levels');
  ol.innerHTML = '';
  if (!levels.length) { ol.innerHTML = '<li class="empty">No champions saved yet – the AI is still learning its first shots. Try again in a minute.</li>'; $('start').disabled = true; return; }
  levels.forEach((lv, i) => {
    const li = document.createElement('li');
    const b = document.createElement('button');
    b.innerHTML = `<b>${lv.level}</b><span>${lv.title} · ${lv.name}</span><small>${lv.elo}</small>`;
    b.classList.toggle('on', i === chosenLevel);
    b.addEventListener('click', () => { chosenLevel = i; renderLevels(); });
    li.append(b);
    ol.append(li);
  });
  $('start').disabled = chosenLevel < 0;
}

async function poll() {
  try {
    status = await getJSON('/api/status');
    $('t-gen').textContent = `gen ${status.generation.toLocaleString()} · ${status.gensPerMin}/min`;
    $('t-elo').textContent = status.topElo ? `${status.topElo} · ${status.topName}` : '–';
    drawChart(status.history);
  } catch (e) { /* restarting */ }
  setTimeout(poll, 4000);
}
async function loadLevels() {
  try { levels = await getJSON('/api/levels'); } catch (e) { levels = []; }
  if (chosenLevel >= levels.length) chosenLevel = -1;
  if (chosenLevel < 0 && levels.length) chosenLevel = Math.min(2, levels.length - 1);
  renderLevels();
}

// --- UI wiring ---------------------------------------------------------------------------------------------
document.querySelectorAll('.tabs button').forEach((b) => b.addEventListener('click', () => {
  document.querySelectorAll('.tabs button').forEach(x => x.classList.toggle('on', x === b));
  $('p-watch').hidden = b.dataset.m !== 'watch';
  $('p-play').hidden = b.dataset.m !== 'play';
  if (b.dataset.m === 'play') loadLevels();
  else if (mode === 'play') { $('quit').hidden = true; startWatch(); }
}));
document.querySelectorAll('#speeds button').forEach((b) => b.addEventListener('click', () => {
  speed = +b.dataset.s;
  document.querySelectorAll('#speeds button').forEach(x => x.classList.toggle('on', x === b));
}));
$('w-next').addEventListener('click', startWatch);
$('start').addEventListener('click', startPlay);
$('quit').addEventListener('click', () => { $('quit').hidden = true; startWatch(); });
$('quit2').addEventListener('click', () => { $('quit').hidden = true; startWatch(); });
$('reset').addEventListener('click', async () => {
  if (!confirm('Wipe everything the AI has learned and start again from random players?\n(A backup is kept on the server.)')) return;
  await fetch('/api/reset', { method: 'POST' });
  banner('RESET', 'brand-new players are learning tennis', 2500);
});
$('fs').addEventListener('click', () => {
  if (document.fullscreenElement) document.exitFullscreen();
  else (document.documentElement.requestFullscreen || document.documentElement.webkitRequestFullscreen)?.call(document.documentElement);
});
addEventListener('resize', () => {
  renderer.setSize(innerWidth, innerHeight);
  fitCamera();
  trail.material.uniforms.uScale.value = renderer.domElement.height / (2 * Math.tan(camera.fov * Math.PI / 360));
});
trail.material.uniforms.uScale.value = renderer.domElement.height / (2 * Math.tan(camera.fov * Math.PI / 360));

poll();
startWatch();
