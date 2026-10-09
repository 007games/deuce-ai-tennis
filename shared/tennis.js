// DEUCE tennis simulation. One ES module shared by the self-play trainer (Node worker threads) and the
// browser (watch + play), so the AI you play against is exactly the AI that was trained.
//
// World: x across the court, y up, z along the court; the net is at z = 0.
// Player 0 plays from the near half (z < 0), player 1 from the far half (z > 0).
// Each player "sees" the court from its own side: local coords = world * sign (sign = +1 / -1).

export const DT = 1 / 60;
export const COURT = { halfW: 4.115, halfL: 11.885, serviceZ: 6.40, netCenter: 0.914, netPost: 1.07, postX: 6.4, dHalfW: 5.485 };
export const BALL_R = 0.033;
const G = 9.81;
const DRAG = 0.0175;          // per metre (0.5 rho Cd A / m)
const MAGNUS = 0.0065;        // topspin dip per (m/s)^2
const REACH = 1.45;           // racket reach (horizontal, m): arm + racket + a sideways lean
export const CONTACT_AHEAD = 0.45;   // the ball is struck about this far in front of the body
const PLAYER = { vmax: 7.4, acc: 22 };
export const MIN_DEPTH = 4.5;  // shortest rally target from the net (m)
const NET_GAP = 1.2;          // closest a player may stand to the net (m)
const REACTION = 0.28;        // seconds a player needs after the opponent's shot before striking

export const INPUTS = 22;
export const LAYERS = [INPUTS, 32, 24, 7];

// ---------------------------------------------------------------------------------------------
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export function gaussian(rng) {
  let u = 0, v = 0;
  while (u === 0) u = rng();
  while (v === 0) v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

export function netHeight(x) {
  const f = Math.min(1, Math.abs(x) / COURT.postX);
  return COURT.netCenter + (COURT.netPost - COURT.netCenter) * f;
}

// ---------------------------------------------------------------------------------------------
// ball flight
function ballStep(b, dt) {
  const v = Math.hypot(b.vx, b.vy, b.vz);
  const d = DRAG * v;
  b.vx -= b.vx * d * dt;
  b.vz -= b.vz * d * dt;
  b.vy -= (G + b.vy * d + b.spin * MAGNUS * v * v * (b.spin > 0 ? 1 : 0.6)) * dt;
  b.x += b.vx * dt;
  b.y += b.vy * dt;
  b.z += b.vz * dt;
}

function bounce(b) {
  b.y = BALL_R;
  b.vy = -b.vy * 0.74;
  const keep = 0.80 + b.spin * 0.07;     // topspin kicks on, slice skids and stays low
  b.vx *= keep; b.vz *= keep;
  if (b.spin < 0) b.vy *= 0.85;
  b.spin *= 0.4;
}

/** simulate a ball copy until it lands; returns {x, z, t, clear} (clear = height margin over the net) */
function flyToLanding(x, y, z, vx, vy, vz, spin, maxT = 4) {
  const b = { x, y, z, vx, vy, vz, spin };
  let t = 0, clear = Infinity;
  const dt = 1 / 120;
  while (t < maxT) {
    const pz = b.z;
    ballStep(b, dt);
    t += dt;
    if ((pz < 0) !== (b.z < 0)) clear = Math.min(clear, b.y - BALL_R - netHeight(b.x));
    if (b.y <= BALL_R) return { x: b.x, z: b.z, t, clear };
  }
  return { x: b.x, z: b.z, t, clear };
}

/**
 * Find a launch velocity from P to land on target (tx, tz) with the given speed and spin, clearing the net
 * by at least `margin` metres. Lowers the speed (more arc) until the net is cleared. Returns velocity.
 */
export function solveShot(px, py, pz, tx, tz, speed, spin, margin) {
  const dx = tx - px, dz = tz - pz;
  const dist = Math.hypot(dx, dz);
  const ux = dx / dist, uz = dz / dist;
  let v = speed;
  let best = null;
  for (let attempt = 0; attempt < 10; attempt++) {
    // bisect the elevation angle for the landing distance (low-trajectory solution)
    let lo = -0.35, hi = 0.75;
    let sol = null;
    for (let k = 0; k < 18; k++) {
      const a = (lo + hi) / 2;
      const h = v * Math.cos(a);
      const r = flyToLanding(px, py, pz, ux * h, v * Math.sin(a), uz * h, spin);
      const along = (r.x - px) * ux + (r.z - pz) * uz;
      if (along < dist) lo = a; else hi = a;
      sol = { a, r };
    }
    const crosses = (pz < 0) !== (tz < 0);
    const h = v * Math.cos(sol.a);
    best = { vx: ux * h, vy: v * Math.sin(sol.a), vz: uz * h };
    if (!crosses || sol.r.clear >= margin) return best;
    v *= 0.88;                         // not enough clearance: hit softer with more arc
  }
  return best;
}

/**
 * Rally stroke: the player decides how high to clear the net (`clear`, metres above the tape) and
 * where to land; the pace follows from that. Low clearance = flat and fast, high = loopy and slow.
 * Solved analytically without drag, then corrected for drag and spin with a few real flights.
 * Returns {vx, vy, vz, speed}.
 */
export function solveByClearance(px, py, pz, tx, tz, clear, spin) {
  const dx = tx - px, dz = tz - pz;
  const D0 = Math.hypot(dx, dz);
  const ux = dx / D0, uz = dz / D0;
  // horizontal distance along the path to the net plane, and the net height there
  const dn = Math.abs(uz) > 1e-6 ? -pz / uz : D0 * 0.5;
  const hn = netHeight(px + ux * dn) + clear;
  // Solve the two-point parabola (through the net point and the landing point) with an
  // "effective gravity" that includes the topspin dip, then correct gently for drag.
  let D = D0, gEff = G;
  let out = null;
  for (let it = 0; it < 5; it++) {
    const det = dn * D * (dn - D);
    const A = (-(hn - py) * D * D - dn * dn * py) / det;
    const B = (dn * -py - D * (hn - py)) / det;
    if (!(B > 1e-3) || !isFinite(A)) {
      // no sensible arc through that point (e.g. contact above the clearance height): fall back
      const v = solveShot(px, py, pz, tx, tz, 30, spin, 0.3);
      return { ...v, speed: Math.hypot(v.vx, v.vy, v.vz) };
    }
    const vh = Math.sqrt(gEff / (2 * B));
    const vy = vh * A;
    out = { vx: ux * vh, vy, vz: uz * vh, speed: Math.hypot(vh, vy) };
    if (out.speed > 50) { const k = 50 / out.speed; out.vx *= k; out.vy *= k; out.vz *= k; out.speed = 50; }
    // spin dip (topspin) or lift (slice) at this pace, folded into gravity for the next pass
    const sp = out.speed * 0.85;
    gEff = Math.max(4, G + spin * MAGNUS * sp * sp * (spin > 0 ? 1 : 0.6));
    const r = flyToLanding(px, py, pz, out.vx, out.vy, out.vz, spin, 4);
    const landed = (r.x - px) * ux + (r.z - pz) * uz;
    if (it >= 1 && Math.abs(landed - D0) < 0.2) break;
    D *= Math.max(0.9, Math.min(1.15, D0 / Math.max(1, landed)));
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// match
export function createMatch({ seed = 1, format = { sets: 1, games: 4 }, training = false, server = -1 } = {}) {
  const m = {
    rng: mulberry32(seed), t: 0, format, training,
    ball: { x: 0, y: 1, z: 0, vx: 0, vy: 0, vz: 0, spin: 0, lastHitter: -1, bounces: 0, serve: false, live: false, held: true },
    players: [newPlayer(0), newPlayer(1)],
    score: { points: [0, 0], games: [0, 0], sets: [0, 0], tiebreak: false, server: 0, tbPoints: 0 },
    phase: 'serve', phaseT: 0, serveTry: 1, winner: -1,
    stats: [newStats(), newStats()],
    pred: [], predIdx: 0,
    events: [],                       // for the viewer: {type, ...}
    lastPoint: null,
    rallyHits: 0, pointCount: 0, lastHitT: -1,
  };
  m.score.server = server >= 0 ? server : Math.floor(m.rng() * 2);
  setupServe(m);
  return m;
}

function newPlayer(side) {
  return { side, sign: side === 0 ? 1 : -1, x: 0, z: side === 0 ? -12 : 12, vx: 0, vz: 0, tx: 0, tz: 0, swing: 0, swingType: 0, lastDecision: 0, aim: null };
}
function newStats() { return { points: 0, contacts: 0, inPlay: 0, aces: 0, winners: 0, errors: 0, doubleFaults: 0, approach: 0, chances: 0, servesFaced: 0, returnsIn: 0, deepIn: 0 }; }

function deuceCourt(m) {
  const s = m.score;
  if (s.tiebreak) return (s.points[0] + s.points[1]) % 2 === 0;
  return (s.points[0] + s.points[1]) % 2 === 0;
}

function setupServe(m) {
  const srv = m.players[m.score.server], rcv = m.players[1 - m.score.server];
  const deuce = deuceCourt(m);
  // server stands just behind the baseline, right of centre for the deuce court (from their view)
  const lx = deuce ? -0.7 : 0.7;
  srv.x = lx * srv.sign; srv.z = -(COURT.halfL + 0.3) * srv.sign;
  srv.vx = srv.vz = 0; srv.tx = srv.x; srv.tz = srv.z;
  // receiver diagonally opposite, a little behind their baseline
  const rlx = deuce ? -2.6 : 2.6;  // receiver's deuce side is their own right (local -x)
  rcv.x = rlx * rcv.sign; rcv.z = -(COURT.halfL + 0.8) * rcv.sign;
  rcv.vx = rcv.vz = 0; rcv.tx = rcv.x; rcv.tz = rcv.z;
  const b = m.ball;
  b.x = srv.x - 0.3 * srv.sign; b.y = 1.0; b.z = srv.z + 0.3 * srv.sign;   // toss on the racket side
  b.vx = b.vy = b.vz = 0; b.spin = 0; b.lastHitter = -1; b.bounces = 0; b.serve = true; b.live = false; b.held = true;
  m.phase = 'serve';
  m.phaseT = 0;
  m.pred = [];
  m.rallyHits = 0;
}

/** service box of the receiver for the current point, in world coords */
function serviceBox(m) {
  const srv = m.players[m.score.server];
  const deuce = deuceCourt(m);
  // diagonal: server on their right (local x<0) serves to local x>0 beyond the net
  const lx0 = deuce ? 0 : -COURT.halfW, lx1 = deuce ? COURT.halfW : 0;
  const xs = [lx0 * srv.sign, lx1 * srv.sign].sort((a, b) => a - b);
  const zs = [0, COURT.serviceZ * srv.sign].sort((a, b) => a - b);
  return { x0: xs[0], x1: xs[1], z0: zs[0], z1: zs[1] };
}

const LINE = 0.05 + BALL_R;   // ball touching the line is in

function inCourt(x, z, side) {
  // side: whose half the ball must land in
  if (Math.abs(x) > COURT.halfW + LINE) return false;
  if (side === 0) return z <= LINE && z >= -COURT.halfL - LINE;
  return z >= -LINE && z <= COURT.halfL + LINE;
}

// ---------------------------------------------------------------------------------------------
// prediction of the ball path (for AI inputs and for the viewer's swing timing)
function predict(m) {
  const b = m.ball;
  const p = { x: b.x, y: b.y, z: b.z, vx: b.vx, vy: b.vy, vz: b.vz, spin: b.spin };
  const out = [];
  let bounces = b.bounces;
  for (let i = 0; i < 200; i++) {
    ballStep(p, DT);
    if (p.y <= BALL_R && p.vy < 0) { bounce(p); bounces++; if (bounces >= 2) break; }
    if (i % 2 === 0) out.push({ x: p.x, y: p.y, z: p.z, t: (i + 1) * DT, bounces });
  }
  m.pred = out;
  m.predT = m.t;
}

/** best place for player p to hit the incoming ball: first predicted point on its side at a good height */
export function interception(m, p) {
  const b = m.ball;
  if (m.pred.length === 0 || b.lastHitter === p.side || !b.live) return null;
  const elapsed = m.t - m.predT;
  let fallback = null;
  for (const q of m.pred) {
    if (q.t < elapsed) continue;
    if (q.z * p.sign > 0) continue;                       // still on the other side
    const mustBounce = b.serve;
    if (mustBounce && q.bounces === 0) continue;
    if (q.y > 0.35 && q.y < 1.5) return { x: q.x, z: q.z, t: q.t - elapsed };
    if (!fallback && q.y < 2.4 && (q.bounces > 0 || !mustBounce)) fallback = { x: q.x, z: q.z, t: q.t - elapsed };
  }
  return fallback;
}

// ---------------------------------------------------------------------------------------------
// neural network
export function genomeSize() {
  let n = 0;
  for (let i = 0; i < LAYERS.length - 1; i++) n += LAYERS[i] * LAYERS[i + 1] + LAYERS[i + 1];
  return n;
}
export function randomGenome(rng) {
  const g = new Float32Array(genomeSize());
  let o = 0;
  for (let l = 0; l < LAYERS.length - 1; l++) {
    const sc = 1 / Math.sqrt(LAYERS[l]);
    for (let i = 0; i < LAYERS[l] * LAYERS[l + 1]; i++) g[o++] = gaussian(rng) * sc * 1.2;
    for (let i = 0; i < LAYERS[l + 1]; i++) g[o++] = gaussian(rng) * 0.1;
  }
  return g;
}
const bufA = new Float32Array(64), bufB = new Float32Array(64);
export function think(g, input, out) {
  let src = input, dst = bufA, o = 0;
  for (let l = 0; l < LAYERS.length - 1; l++) {
    const nin = LAYERS[l], nout = LAYERS[l + 1];
    for (let j = 0; j < nout; j++) {
      let sum = g[o + nin * nout + j];
      const base = o + j * nin;
      for (let i = 0; i < nin; i++) sum += src[i] * g[base + i];
      dst[j] = Math.tanh(sum);
    }
    o += nin * nout + nout;
    src = dst;
    dst = dst === bufA ? bufB : bufA;
  }
  for (let j = 0; j < LAYERS[LAYERS.length - 1]; j++) out[j] = src[j];
  return out;
}

const inBuf = new Float32Array(INPUTS);
/** what an AI player senses, from its own side of the court (it always "plays from the bottom") */
export function sense(m, p) {
  const s = p.sign, o = m.players[1 - p.side], b = m.ball;
  const x = inBuf;
  let k = 0;
  x[k++] = p.x * s / 5; x[k++] = p.z * s / 12;
  x[k++] = o.x * s / 5; x[k++] = o.z * s / 12;
  x[k++] = b.x * s / 5; x[k++] = b.y / 3; x[k++] = b.z * s / 12;
  x[k++] = b.vx * s / 30; x[k++] = b.vy / 15; x[k++] = b.vz * s / 30;
  const incoming = b.live && b.lastHitter !== p.side ? 1 : 0;
  x[k++] = incoming;
  x[k++] = b.live && b.bounces > 0 && b.z * s < 0 ? 1 : 0;
  const ic = incoming ? interception(m, p) : null;
  x[k++] = ic ? (ic.x - p.x) * s / 6 : 0;
  x[k++] = ic ? (ic.z - p.z) * s / 6 : 0;
  x[k++] = ic ? Math.min(ic.t, 3) / 3 : 1;
  x[k++] = ic ? 1 : 0;
  const serving = m.phase === 'serve' && m.score.server === p.side ? 1 : 0;
  x[k++] = serving;
  x[k++] = m.phase === 'serve' && m.score.server !== p.side ? 1 : 0;
  x[k++] = deuceCourt(m) ? 1 : -1;
  x[k++] = m.serveTry === 2 ? 1 : 0;
  // where the opponent is relative to the centre line (to aim away from them)
  x[k++] = o.x * s / COURT.halfW;
  x[k++] = 1;
  return x;
}

const outBuf = new Float32Array(8);
/** AI controller: a brain makes decisions about 10 times per second */
export function aiController(genome) {
  const out = new Float32Array(7);
  return {
    kind: 'ai',
    decide(m, p) {
      think(genome, sense(m, p), out);
      // movement target in local coords on the player's own half
      p.tx = out[0] * 5.6 * p.sign;
      // neutral output = just inside the baseline (the home position in real tennis);
      // positive moves in towards the net, negative drops back behind the baseline
      const o1 = out[1];
      p.tz = -(o1 > 0 ? 11.2 - o1 * 9.4 : 11.2 - o1 * 3.8) * p.sign;
    },
    shot() {
      return { aimX: out[2], depth: out[3] * 0.5 + 0.5, power: out[4] * 0.5 + 0.5, spin: out[5], lift: out[6] * 0.5 + 0.5 };
    },
    wantsServe() { return true; },
  };
}

// ---------------------------------------------------------------------------------------------
// step
export function step(m, ctrls) {
  m.t += DT;
  m.phaseT += DT;
  m.events.length = 0;
  for (const p of m.players) {
    const c = ctrls[p.side];
    if (c.kind === 'ai') {
      if (m.t - p.lastDecision >= 0.1 - 1e-6) { p.lastDecision = m.t; c.decide(m, p); }
    } else c.decide(m, p);
    movePlayer(m, p, c);
    if (p.swing > 0) p.swing = Math.max(0, p.swing - DT * 2.6);
  }
  if (m.phase === 'serve') return serveStep(m, ctrls);
  if (m.phase === 'point') {
    if (m.phaseT > (m.training ? 0.05 : 1.6)) nextPoint(m);
    // the dead ball keeps moving for the viewer
    deadBall(m);
    return;
  }
  if (m.phase === 'over') { deadBall(m); return; }
  rallyStep(m, ctrls);
}

function movePlayer(m, p, c) {
  if (m.phase === 'serve' && m.score.server === p.side) { p.vx = p.vz = 0; return; }
  let ax, az;
  if (c.kind === 'human') {
    // the human steers a velocity directly (joystick / keys)
    const tvx = c.mx * PLAYER.vmax, tvz = c.mz * PLAYER.vmax;
    ax = (tvx - p.vx) * 8; az = (tvz - p.vz) * 8;
  } else {
    // AI: arrive at the target position
    const dx = p.tx - p.x, dz = p.tz - p.z;
    const d = Math.hypot(dx, dz);
    const want = Math.min(PLAYER.vmax, d * 3.2);
    const tvx = d > 1e-3 ? dx / d * want : 0, tvz = d > 1e-3 ? dz / d * want : 0;
    ax = (tvx - p.vx) * 9; az = (tvz - p.vz) * 9;
  }
  const a = Math.hypot(ax, az);
  if (a > PLAYER.acc) { ax *= PLAYER.acc / a; az *= PLAYER.acc / a; }
  p.vx += ax * DT; p.vz += az * DT;
  const v = Math.hypot(p.vx, p.vz);
  if (v > PLAYER.vmax) { p.vx *= PLAYER.vmax / v; p.vz *= PLAYER.vmax / v; }
  p.x += p.vx * DT; p.z += p.vz * DT;
  // stay on your own half, inside the stadium
  p.x = Math.max(-8, Math.min(8, p.x));
  // players may not crowd the net (touching it is illegal in tennis)
  if (p.side === 0) p.z = Math.max(-17, Math.min(-NET_GAP, p.z)); else p.z = Math.min(17, Math.max(NET_GAP, p.z));
}

function serveStep(m, ctrls) {
  const srv = m.players[m.score.server];
  const b = m.ball;
  const c = ctrls[srv.side];
  // toss
  if (m.phaseT > 0.25) {
    const k = Math.min(1, (m.phaseT - 0.25) / 0.5);
    b.y = 1.0 + 1.55 * Math.sin(k * Math.PI * 0.5);
  }
  const ready = m.phaseT > 0.75 && (c.kind === 'ai' || c.wantsServe());
  if (!ready) {
    if (m.phaseT > 12) { // human never served: auto-serve
      if (c.kind === 'human') c.forceServe = true;
    }
    return;
  }
  const shot = c.shot(m, srv, true);
  const box = serviceBox(m);
  const s = srv.sign;
  // aim inside the box (local: x in 0..halfW on the diagonal side, z in 1.5..serviceZ-0.2)
  const deuce = deuceCourt(m);
  const lxRange = deuce ? [0.25, COURT.halfW - 0.25] : [-COURT.halfW + 0.25, -0.25];
  let lx = lxRange[0] + (shot.aimX * 0.5 + 0.5) * (lxRange[1] - lxRange[0]);
  let lz = 2.2 + shot.depth * (COURT.serviceZ - 2.5);
  const power = shot.power;
  const speed = 22 + power * 26 - (m.serveTry === 2 ? 4 : 0);
  const sigma = 0.2 + power * power * 1.0;
  lx += gaussian(m.rng) * sigma;
  lz += gaussian(m.rng) * sigma * 1.3;
  const v = solveShot(b.x, 2.55, b.z, lx * s, lz * s, speed, shot.spin * 0.6, 0.06);
  b.y = 2.55;
  b.vx = v.vx; b.vy = v.vy; b.vz = v.vz; b.spin = shot.spin * 0.6;
  b.lastHitter = srv.side; b.bounces = 0; b.serve = true; b.live = true; b.held = false;
  srv.swing = 1; srv.swingType = 2;
  m.stats[srv.side].contacts++;
  m.lastHitT = m.t;
  m.phase = 'rally';
  m.phaseT = 0;
  m.events.push({ type: 'hit', side: srv.side, serve: true, speed, x: b.x, y: 2.55, z: b.z });
  predict(m);
  void box;
}

function rallyStep(m, ctrls) {
  const b = m.ball;
  const pz = b.z;
  const steps = 2;
  for (let k = 0; k < steps; k++) {
    const prevZ = b.z;
    ballStep(b, DT / steps);
    // net
    if ((prevZ < 0) !== (b.z < 0) && Math.abs(b.x) < COURT.postX + 0.2) {
      if (b.y - BALL_R < netHeight(b.x)) {
        b.vz *= -0.12; b.vx *= 0.3; b.vy *= 0.3; b.z = prevZ;
        m.events.push({ type: 'net' });
        if (b.serve) return fault(m, 'net');
        return pointTo(m, 1 - b.lastHitter, 'net');
      }
    }
    if (b.y <= BALL_R && b.vy < 0) {
      bounce(b);
      b.bounces++;
      const side = b.z < 0 ? 0 : 1;
      m.events.push({ type: 'bounce', x: b.x, z: b.z });
      if (b.bounces === 1) {
        if (b.serve) {
          const box = serviceBox(m);
          const okBox = b.x >= box.x0 - LINE && b.x <= box.x1 + LINE && b.z >= box.z0 - LINE && b.z <= box.z1 + LINE;
          if (!okBox) return fault(m, 'out');
          m.stats[1 - b.lastHitter].servesFaced++;          // a good serve the receiver has to deal with
        } else {
          const target = 1 - b.lastHitter;
          if (side !== target || !inCourt(b.x, b.z, target)) {
            m.stats[b.lastHitter].errors++;
            // a ball that drops just short of the net was simply put into the net
            return pointTo(m, 1 - b.lastHitter, side !== target ? (Math.abs(b.z) < 1.5 ? 'net' : 'own side') : 'out');
          }
        }
        m.stats[b.lastHitter].inPlay++;
        if (!b.serve && Math.abs(b.z) > COURT.serviceZ) m.stats[b.lastHitter].deepIn++;
        if (!b.serve && m.rallyHits === 1) m.stats[b.lastHitter].returnsIn++;   // serve returned into play
      } else {
        // second bounce: the receiver could not get it back
        if (b.serve) m.stats[b.lastHitter].aces++;
        else m.stats[b.lastHitter].winners++;
        return pointTo(m, b.lastHitter, b.serve ? 'ace' : 'winner');
      }
      predict(m);
    }
  }
  // safety: ball leaving the stadium / dead ball
  // safety net for a ball that left the stadium or is stuck: judged from the LAST shot, not the
  // serve (a long rally is fine)
  if (Math.abs(b.z) > 30 || Math.abs(b.x) > 20 || m.t - m.lastHitT > 6) {
    return pointTo(m, b.bounces === 0 ? 1 - b.lastHitter : b.lastHitter, 'out');
  }
  void pz;
  // hitting
  for (const p of m.players) {
    if (b.lastHitter === p.side) continue;
    if (b.z * p.sign > -0.05) continue;                     // the ball must be on my side of the net
    if (m.t - m.lastHitT < REACTION) continue;              // human reaction time
    if (b.serve && b.bounces === 0) continue;               // must let the serve bounce
    if (b.bounces > 1) continue;
    if (b.y < 0.1 || b.y > 2.7) continue;
    // contact point: beside the body and a little in front of it (like a real stroke), not the
    // first moment the ball comes within reach
    const fwd = (b.z - p.z) * p.sign;                       // + = ball still in front of the player
    const lat = Math.abs(b.x - p.x);
    if (fwd > CONTACT_AHEAD || fwd < -0.7 || lat > REACH) continue;
    hit(m, p, ctrls[p.side], Math.hypot(lat, Math.max(0, fwd)));
    break;
  }
  // approach tracking (training signal: did the player get to the ball?)
  for (const p of m.players) {
    if (b.lastHitter === p.side || b.bounces > 1) continue;
    if (b.z * p.sign < 0 && b.y < 2.5) {
      const d = Math.hypot(b.x - p.x, b.z - p.z);
      p._closest = Math.min(p._closest ?? 99, d);
    }
  }
}

function hit(m, p, c, reach) {
  const b = m.ball;
  const hx = b.x, hy = b.y, hz = b.z;              // contact point (for the viewer)
  const shot = c.shot(m, p, false);
  const s = p.sign;
  const incoming = Math.hypot(b.vx, b.vy, b.vz);
  const pspeed = Math.hypot(p.vx, p.vz);
  // target in the opponent's half (local z > 0)
  let lx = shot.aimX * (COURT.halfW - 0.35);
  let lz = MIN_DEPTH + shot.depth * (COURT.halfL - MIN_DEPTH - 0.5);
  const power = shot.power;
  void power;
  // how high over the net the player chooses to play (0.25 m flat ... 2.75 m loopy)
  let clearance = 0.25 + shot.lift * 2.5;
  // pace of the intended shot (flat = fast = riskier, loopy = slow = safer)
  const nominal = solveByClearance(b.x, b.y, b.z, lx * s, lz * s, clearance, shot.spin);
  const pace = Math.max(0, Math.min(1, (nominal.speed - 14) / 24));
  // the harder the shot, the faster you were running, the further you stretch: the bigger the error
  // nobody is a machine: even an easy, slow ball has some scatter (base error), which ends rallies
  // A slow ball at a comfortable height, taken while balanced, is a "sitter": it can be attacked
  // hard without much extra risk. Balls above the shoulder are awkward.
  const comfort = Math.max(0, 1 - incoming / 26) * Math.max(0, 1 - pspeed / 4) * (b.y > 0.6 && b.y < 1.5 ? 1 : 0.4);
  const sigma = (0.34 + 0.32 * (pspeed / PLAYER.vmax) + 0.6 * Math.max(0, reach / REACH - 0.55) + 0.25 * incoming / 40
      + 0.55 * Math.max(0, b.y - 1.5))
    * (0.7 + pace * 0.9 * (1 - 0.65 * comfort))
    // volleys (no bounce) are much harder to control, especially against a fast ball
    * (b.bounces === 0 ? 1.5 + incoming / 25 : 1)
    // short "drop" targets need fine touch: aiming short is riskier than aiming deep
    * (1 + 1.8 * (1 - shot.depth) * (1 - shot.depth));
  lx += gaussian(m.rng) * sigma;
  lz += gaussian(m.rng) * sigma * 1.35;
  let margin = 0, netMishit = false;
  // unforced errors: every stroke can be mishit; more likely under pressure (fast or high ball,
  // running, stretching). The mishit goes into the net or long/wide.
  const pressure = Math.min(1, incoming / 35 + 0.6 * pspeed / PLAYER.vmax + 1.2 * Math.max(0, reach / REACH - 0.6) + 0.8 * Math.max(0, b.y - 1.5));
  if (m.rng() < 0.015 + 0.05 * pressure) {
    if (m.rng() < 0.5) netMishit = true;                                   // dumped into the net
    else { lx += gaussian(m.rng) * 2.5; lz = COURT.halfL + 0.8 + m.rng() * 2.5; }   // sprayed long
    m.events.push({ type: 'mishit', side: p.side });
  }
  const v = solveByClearance(b.x, b.y, b.z, lx * s, lz * s, clearance, shot.spin);
  // a mishit into the net: the same stroke, just hit too low
  if (netMishit) {
    // lower the launch just enough that the ball meets the net about halfway up
    const tNet = Math.abs(b.z) / Math.max(1, Math.abs(v.vz));
    v.vy -= (clearance + netHeight(b.x) * (0.4 + 0.3 * m.rng())) / tNet;
  }
  b.vx = v.vx; b.vy = v.vy; b.vz = v.vz; b.spin = shot.spin;
  b.lastHitter = p.side; b.bounces = 0; b.serve = false;
  p.swing = 1;
  p.swingType = (b.x - p.x) * s >= 0 ? 0 : 1;            // forehand on the right side (local), backhand left
  m.stats[p.side].contacts++;
  m.rallyHits++;
  m.lastHitT = m.t;
  m.events.push({ type: 'hit', side: p.side, speed: Math.hypot(v.vx, v.vy, v.vz), lob: shot.lift > 0.6, x: hx, y: hy, z: hz });
  predict(m);
}

function deadBall(m) {
  const b = m.ball;
  if (b.held) return;
  ballStep(b, DT);
  if (b.y <= BALL_R && b.vy < 0) { bounce(b); if (Math.abs(b.vy) < 0.4) { b.vy = 0; b.y = BALL_R; } }
  b.vx *= 0.995; b.vz *= 0.995;
}

function fault(m, why) {
  m.events.push({ type: 'fault', why });
  if (m.serveTry === 1) {
    m.serveTry = 2;
    m.phase = 'point';
    m.phaseT = 0;
    m.pendingFault = true;
    return;
  }
  m.stats[m.score.server].doubleFaults++;
  pointTo(m, 1 - m.score.server, 'double fault');
}

function nextPoint(m) {
  if (m.pendingFault) { m.pendingFault = false; setupServe(m); return; }
  if (m.phase === 'over') return;
  m.serveTry = 1;
  setupServe(m);
}

// ---------------------------------------------------------------------------------------------
// scoring
const NAMES = ['0', '15', '30', '40'];

function pointTo(m, w, why) {
  const sc = m.score;
  m.stats[w].points++;
  m.pointCount++;
  m.lastPoint = { winner: w, why, rally: m.rallyHits };
  m.events.push({ type: 'point', winner: w, why });
  for (const p of m.players) {
    // learning signal for players that got the incoming ball near them
    if (p._closest !== undefined) { m.stats[p.side].approach += Math.max(0, 1 - p._closest / 4); m.stats[p.side].chances++; }
    p._closest = undefined;
  }
  m.phase = 'point';
  m.phaseT = 0;
  m.pendingFault = false;
  if (sc.tiebreak) {
    sc.points[w]++;
    const [a, b] = sc.points;
    const target = m.format.tbTo || 7;
    if ((a >= target || b >= target) && Math.abs(a - b) >= 2) return winGame(m, w);
    // tiebreak serve: change after the first point, then every two points
    if ((a + b) % 2 === 1) sc.server = 1 - sc.server;
    return;
  }
  sc.points[w]++;
  const [a, b] = sc.points;
  if ((a >= 4 || b >= 4) && Math.abs(a - b) >= 2) winGame(m, w);
}

function winGame(m, w) {
  const sc = m.score;
  sc.games[w]++;
  sc.points = [0, 0];
  const G2 = m.format.games;
  const [a, b] = sc.games;
  if (sc.tiebreak || ((a >= G2 || b >= G2) && Math.abs(a - b) >= 2)) {
    sc.sets[w]++;
    sc.games = [0, 0];
    sc.tiebreak = false;
    if (sc.sets[w] >= m.format.sets) { m.phase = 'over'; m.winner = w; m.events.push({ type: 'match', winner: w }); return; }
  } else if (a === G2 && b === G2) {
    sc.tiebreak = true;
  }
  if (!sc.tiebreak || sc.points[0] + sc.points[1] === 0) sc.server = 1 - sc.server;
  if (m.format.tiebreakOnly) { sc.tiebreak = true; }
}

export function pointLabel(m, side) {
  const sc = m.score;
  if (sc.tiebreak) return String(sc.points[side]);
  const a = sc.points[side], b = sc.points[1 - side];
  if (a >= 3 && b >= 3) return a === b ? '40' : a > b ? 'AD' : '40';
  return NAMES[Math.min(a, 3)];
}

/** a quick training match: a single tiebreak to `to` points */
export function createTiebreak(seed, to = 7) {
  const m = createMatch({ seed, format: { sets: 1, games: 1, tbTo: to, tiebreakOnly: true }, training: true });
  m.score.tiebreak = true;
  return m;
}
