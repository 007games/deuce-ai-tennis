// The arena: blue hard court with crisp lines, a sagging net with tape and posts, dark sponsor walls,
// tiered blue stands with a sprinkling of spectators, umpire chair and live scoreboards.
// Sponsors are fictional.
import * as THREE from 'three';
import { COURT, netHeight } from '/shared/tennis.js';

function rng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

function canvasTex(w, h, draw, srgb = true) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

function noiseFill(g, w, h, base, amp, seed) {
  g.fillStyle = base;
  g.fillRect(0, 0, w, h);
  const r = rng(seed);
  const img = g.getImageData(0, 0, w, h);
  for (let i = 0; i < img.data.length; i += 4) {
    const n = (r() - 0.5) * amp;
    img.data[i] += n; img.data[i + 1] += n; img.data[i + 2] += n;
  }
  g.putImageData(img, 0, 0);
}

const SPONSORS = [
  ['VOLTA', '#ffffff', 'italic 900'],
  ['SKYWARD', '#ffffff', '700', 'FLY FURTHER'],
  ['MERIDIAN', '#f2e6c9', '700', 'EST. 1832'],
  ['DEUCE', '#7fd3ff', '900'],
  ['NOVA TIME', '#ffffff', '600'],
  ['AURORA', '#ffffff', 'italic 800'],
];

function sponsorTex(i) {
  const [name, col, weight, sub] = SPONSORS[i % SPONSORS.length];
  return canvasTex(512, 64, (g, w, h) => {
    g.fillStyle = '#0d1424';
    g.fillRect(0, 0, w, h);
    g.fillStyle = col;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.font = `${weight} ${sub ? 30 : 40}px Inter, Arial, sans-serif`;
    g.fillText(name, w / 2, sub ? h * 0.38 : h / 2 + 2);
    if (sub) {
      g.font = '600 16px Inter, Arial, sans-serif';
      g.fillText(sub, w / 2, h * 0.78);
    }
  });
}

export function buildStadium(scene, { mobile = false } = {}) {
  const group = new THREE.Group();
  scene.add(group);
  const R = rng(7);

  // --- surfaces --------------------------------------------------------------------------------
  const surroundTex = canvasTex(256, 256, (g, w, h) => noiseFill(g, w, h, '#2f7cc7', 10, 1));
  surroundTex.wrapS = surroundTex.wrapT = THREE.RepeatWrapping;
  surroundTex.repeat.set(10, 16);
  const surround = new THREE.Mesh(new THREE.PlaneGeometry(26, 42), new THREE.MeshStandardMaterial({ map: surroundTex, roughness: 0.82 }));
  surround.rotation.x = -Math.PI / 2;
  surround.receiveShadow = true;
  group.add(surround);
  const courtTex = canvasTex(256, 256, (g, w, h) => noiseFill(g, w, h, '#245ea6', 9, 2));
  courtTex.wrapS = courtTex.wrapT = THREE.RepeatWrapping;
  courtTex.repeat.set(4, 8);
  const court = new THREE.Mesh(new THREE.PlaneGeometry(COURT.dHalfW * 2, COURT.halfL * 2), new THREE.MeshStandardMaterial({ map: courtTex, roughness: 0.8 }));
  court.rotation.x = -Math.PI / 2;
  court.position.y = 0.002;
  court.receiveShadow = true;
  group.add(court);

  // --- lines ------------------------------------------------------------------------------------
  const lineMat = new THREE.MeshStandardMaterial({ color: 0xf4f7fb, roughness: 0.6 });
  const line = (x0, z0, x1, z1, w) => {
    const len = Math.hypot(x1 - x0, z1 - z0);
    const m = new THREE.Mesh(new THREE.PlaneGeometry(x0 === x1 ? w : len, x0 === x1 ? len : w), lineMat);
    m.rotation.x = -Math.PI / 2;
    m.position.set((x0 + x1) / 2, 0.004, (z0 + z1) / 2);
    m.receiveShadow = true;
    group.add(m);
  };
  const { halfW, dHalfW, halfL, serviceZ } = COURT;
  for (const s of [-1, 1]) {
    line(-dHalfW, s * halfL, dHalfW, s * halfL, 0.1);                 // baselines
    line(s * dHalfW, -halfL, s * dHalfW, halfL, 0.05);                // doubles sidelines
    line(s * halfW, -halfL, s * halfW, halfL, 0.05);                  // singles sidelines
    line(-halfW, s * serviceZ, halfW, s * serviceZ, 0.05);            // service lines
    line(0, s * halfL, 0, s * (halfL - 0.15), 0.05);                  // centre marks
  }
  line(0, -serviceZ, 0, serviceZ, 0.05);                              // centre service line

  // --- net ----------------------------------------------------------------------------------------
  const netW = COURT.postX * 2;
  const netTex = canvasTex(64, 64, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    g.strokeStyle = 'rgba(25,25,30,0.95)';
    g.lineWidth = 3;
    for (let k = 0; k <= w; k += 16) { g.beginPath(); g.moveTo(k, 0); g.lineTo(k, h); g.stroke(); g.beginPath(); g.moveTo(0, k); g.lineTo(w, k); g.stroke(); }
  });
  netTex.wrapS = netTex.wrapT = THREE.RepeatWrapping;
  netTex.repeat.set(netW / 0.09, 1.1 / 0.09);
  const netGeo = new THREE.PlaneGeometry(netW, 1, 64, 1);
  const pos = netGeo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const top = netHeight(x);
    pos.setY(i, pos.getY(i) > 0 ? top : 0.02);
  }
  netGeo.computeVertexNormals();
  const net = new THREE.Mesh(netGeo, new THREE.MeshStandardMaterial({ map: netTex, transparent: true, alphaTest: 0.25, side: THREE.DoubleSide, roughness: 0.9 }));
  net.castShadow = true;
  group.add(net);
  // tape along the top
  const tapePts = [];
  for (let k = 0; k <= 32; k++) { const x = -COURT.postX + k * netW / 32; tapePts.push(new THREE.Vector3(x, netHeight(x) - 0.03, 0)); }
  const tape = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(tapePts), 64, 0.035, 6), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.5 }));
  tape.castShadow = true;
  group.add(tape);
  const strap = new THREE.Mesh(new THREE.BoxGeometry(0.05, COURT.netCenter, 0.02), new THREE.MeshStandardMaterial({ color: 0xffffff }));
  strap.position.set(0, COURT.netCenter / 2, 0);
  group.add(strap);
  const postMat = new THREE.MeshStandardMaterial({ color: 0x1b2130, roughness: 0.4, metalness: 0.6 });
  for (const s of [-1, 1]) {
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 1.12, 12), postMat);
    post.position.set(s * COURT.postX, 0.56, 0);
    post.castShadow = true;
    group.add(post);
  }
  // net sign
  const netSign = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 0.24), new THREE.MeshBasicMaterial({ map: sponsorTex(0), transparent: true }));
  for (const s of [-1, 1]) {
    const n2 = netSign.clone();
    n2.position.set(s * 4.6, 0.62, -0.01);
    n2.rotation.y = Math.PI;
    group.add(n2);
  }

  // --- perimeter walls with sponsor boards -------------------------------------------------------
  const wallH = 1.3, wx = 12.6, wz = 20.2;
  const wallMat = new THREE.MeshStandardMaterial({ color: 0x0d1424, roughness: 0.7 });
  const boards = [];
  const addWall = (x0, z0, x1, z1, faceSign, idx) => {
    const len = Math.hypot(x1 - x0, z1 - z0);
    const wall = new THREE.Mesh(new THREE.BoxGeometry(len, wallH, 0.3), wallMat);
    const ang = Math.atan2(z1 - z0, x1 - x0);
    wall.position.set((x0 + x1) / 2, wallH / 2, (z0 + z1) / 2);
    wall.rotation.y = -ang;
    wall.receiveShadow = true;
    group.add(wall);
    // sponsor panels along the wall face
    const n = Math.max(1, Math.round(len / 7));
    for (let k = 0; k < n; k++) {
      const f = (k + 0.5) / n;
      const p = new THREE.Mesh(new THREE.PlaneGeometry(len / n - 0.4, 0.62), new THREE.MeshBasicMaterial({ map: sponsorTex(idx + k), toneMapped: false }));
      p.position.set(x0 + (x1 - x0) * f, 0.82, z0 + (z1 - z0) * f);
      p.rotation.y = -ang + (faceSign > 0 ? 0 : Math.PI);
      p.translateZ(0.16);
      group.add(p);
      boards.push(p);
    }
  };
  addWall(-wx, wz, wx, wz, -1, 0);       // far end
  addWall(-wx, -wz, wx, -wz, 1, 2);      // near end (behind the camera, mostly hidden)
  addWall(-wx, -wz, -wx, wz, 1, 3);
  addWall(wx, -wz, wx, wz, -1, 1);

  // --- stands: tiers of blue seats, some of them occupied ---------------------------------------------
  const seatGeo = new THREE.BoxGeometry(0.46, 0.42, 0.44);
  const seatMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.7 });
  const fanGeo = new THREE.CapsuleGeometry(0.13, 0.3, 3, 6);
  const fanMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.8 });
  const rows = mobile ? 11 : 15;
  const seats = [], fans = [];
  const stepMat = new THREE.MeshStandardMaterial({ color: 0x1a2236, roughness: 0.9 });
  const tiers = (axis, sgn, len) => {
    for (let r = 0; r < rows; r++) {
      const off = (axis === 'x' ? wx : wz) + 1.2 + r * 0.85;
      const y = wallH + 0.25 + r * 0.48;
      // concrete step under the row
      const step = new THREE.Mesh(new THREE.BoxGeometry(axis === 'x' ? 0.85 : len, y, axis === 'x' ? len : 0.85), stepMat);
      if (axis === 'x') step.position.set(sgn * off, y / 2 - 0.25, 0); else step.position.set(0, y / 2 - 0.25, sgn * off);
      step.receiveShadow = true;
      group.add(step);
      const count = Math.floor(len / 0.56);
      for (let k = 0; k < count; k++) {
        if (k % 20 === 10) continue;                       // aisles
        const a = -len / 2 + (k + 0.5) * (len / count);
        const p = axis === 'x' ? [sgn * off, y, a] : [a, y, sgn * off];
        seats.push(p);
        if (R() < 0.38) fans.push(p);
      }
    }
  };
  tiers('x', 1, 2 * wz);
  tiers('x', -1, 2 * wz);
  tiers('z', 1, 2 * wx + 2);
  const seatMesh = new THREE.InstancedMesh(seatGeo, seatMat, seats.length);
  const fanMesh = new THREE.InstancedMesh(fanGeo, fanMat, fans.length);
  const m4 = new THREE.Matrix4(), col = new THREE.Color();
  seats.forEach((p, i) => {
    m4.makeTranslation(p[0], p[1] + 0.21, p[2]);
    seatMesh.setMatrixAt(i, m4);
    seatMesh.setColorAt(i, col.setHSL(0.6 + R() * 0.02, 0.55, 0.26 + R() * 0.08));
  });
  const shirts = [0xb83a44, 0xd9dee5, 0xc9952a, 0x2a6f8f, 0x2a7d72, 0xeeeeee, 0x5b3a8c, 0xc0602a, 0x34588f, 0x1a1a1a];
  fans.forEach((p, i) => {
    m4.makeTranslation(p[0], p[1] + 0.55, p[2]);
    fanMesh.setMatrixAt(i, m4);
    fanMesh.setColorAt(i, col.set(shirts[Math.floor(R() * shirts.length)]));
  });
  group.add(seatMesh, fanMesh);

  // --- umpire chair ---------------------------------------------------------------------------------
  const chair = new THREE.Group();
  const navy = new THREE.MeshStandardMaterial({ color: 0x1c2a44, roughness: 0.5, metalness: 0.2 });
  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 1.0, 0.18, 24), new THREE.MeshStandardMaterial({ color: 0x2f7fd0, roughness: 0.6 }));
  base.position.y = 0.09;
  const column = new THREE.Mesh(new THREE.BoxGeometry(0.5, 2.0, 0.6), navy);
  column.position.y = 1.1;
  const seat = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.18, 0.9), navy);
  seat.position.set(0, 2.15, 0);
  const back = new THREE.Mesh(new THREE.BoxGeometry(0.16, 1.2, 0.9), navy);
  back.position.set(-0.45, 2.75, 0);
  const desk = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.12, 0.8), new THREE.MeshStandardMaterial({ color: 0x0f1626 }));
  desk.position.set(0.55, 2.55, 0);
  const ump = new THREE.Mesh(new THREE.CapsuleGeometry(0.2, 0.5, 4, 8), new THREE.MeshStandardMaterial({ color: 0x223a6b }));
  ump.position.set(-0.05, 2.65, 0);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.13, 12, 10), new THREE.MeshStandardMaterial({ color: 0xe2b48c }));
  head.position.set(-0.02, 3.08, 0);
  chair.add(base, column, seat, back, desk, ump, head);
  chair.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  chair.position.set(-(COURT.postX + 1.2), 0, 0);
  group.add(chair);

  // --- scoreboards on the far wall ------------------------------------------------------------------
  const sbCanvas = document.createElement('canvas');
  sbCanvas.width = 512; sbCanvas.height = 256;
  const sbTex = new THREE.CanvasTexture(sbCanvas);
  sbTex.colorSpace = THREE.SRGBColorSpace;
  const sb = new THREE.Mesh(new THREE.PlaneGeometry(3.6, 1.8), new THREE.MeshBasicMaterial({ map: sbTex, toneMapped: false }));
  sb.position.set(7.2, wallH + 1.5, wz + 0.4);
  sb.rotation.y = Math.PI;
  group.add(sb);
  const clock = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 1.6), new THREE.MeshBasicMaterial({ map: canvasTex(128, 128, (g) => {
    g.fillStyle = '#0f3d2a'; g.fillRect(0, 0, 128, 128);
    g.fillStyle = '#f2f2f2'; g.beginPath(); g.arc(64, 54, 34, 0, Math.PI * 2); g.fill();
    g.strokeStyle = '#111'; g.lineWidth = 4; g.beginPath(); g.moveTo(64, 54); g.lineTo(64, 30); g.moveTo(64, 54); g.lineTo(82, 60); g.stroke();
    g.fillStyle = '#e8d29a'; g.font = '700 18px Arial'; g.textAlign = 'center'; g.fillText('NOVA TIME', 64, 112);
  }), toneMapped: false }));
  clock.position.set(-7.6, wallH + 1.3, wz + 0.4);
  clock.rotation.y = Math.PI;
  group.add(clock);

  function setScoreboard(lines) {
    const g = sbCanvas.getContext('2d');
    g.fillStyle = '#0a1224'; g.fillRect(0, 0, 512, 256);
    g.fillStyle = '#7fd3ff'; g.font = '700 26px Inter, Arial'; g.fillText('DEUCE · CENTRE COURT', 22, 40);
    g.font = '700 40px Inter, Arial';
    lines.forEach((l, i) => {
      g.fillStyle = l.serving ? '#ffd166' : '#ffffff';
      g.fillText((l.serving ? '• ' : '  ') + l.name.slice(0, 12), 16, 112 + i * 70);
      g.textAlign = 'right';
      g.fillText(`${l.games}  ${l.points}`, 496, 112 + i * 70);
      g.textAlign = 'left';
    });
    sbTex.needsUpdate = true;
  }

  // --- floodlight rig silhouettes (cheap, read as stadium roof edge) ---------------------------------
  const roofMat = new THREE.MeshStandardMaterial({ color: 0x0b1020, roughness: 0.9 });
  const roofY = wallH + 0.25 + rows * 0.48 + 2.2;
  for (const s of [-1, 1]) {
    const beam = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.8, 2 * wz + 10), roofMat);
    beam.position.set(s * (wx + 1.2 + rows * 0.85 + 0.6), roofY, 0);
    group.add(beam);
  }
  const farBeam = new THREE.Mesh(new THREE.BoxGeometry(2 * wx + 30, 0.8, 1.2), roofMat);
  farBeam.position.set(0, roofY, wz + 1.2 + rows * 0.85 + 0.6);
  group.add(farBeam);

  return { group, setScoreboard };
}
