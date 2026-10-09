// Low-poly tennis players with a racket. Procedural animation: run cycle, split-step ready stance,
// forehand / backhand / serve swings and the ball toss, all driven by the simulation state.
import * as THREE from 'three';

const skinTones = [0xe8b893, 0xc68a62, 0x8d5a3b, 0xf1c9a5];

function mat(color, rough = 0.6) { return new THREE.MeshStandardMaterial({ color, roughness: rough }); }

// shoulder -> string bed distance (arm 0.62 + racket 0.46), shoulder positions in the torso frame
export const REACH_L = 1.08;
const SHOULDER_R = new THREE.Vector3(-0.24, 0.48, 0);
const SHOULDER_L = new THREE.Vector3(0.24, 0.48, 0);
const n = (x, y, z) => new THREE.Vector3(x, y, z).normalize();
const CARRY = n(-0.35, -0.85, 0.4);
const CARRY_L = n(0.3, -0.9, 0.3);
const FH_BACK = n(-0.55, 0.25, -0.8);
const FH_FINISH = n(0.75, 0.5, 0.42);
const BH_BACK = n(0.75, 0.15, -0.65);
const BH_BACK_L = n(0.55, 0.0, -0.8);
const BH_FINISH = n(-0.7, 0.5, 0.5);
const SERVE_BACK = n(-0.15, -0.25, -0.95);
const SERVE_FINISH = n(0.45, -0.65, 0.6);
const tmp = new THREE.Vector3();

/** normalised lerp between two unit vectors */
function nlerp(a, b, t) {
  return new THREE.Vector3().copy(a).multiplyScalar(1 - t).addScaledVector(b, t).normalize();
}

/** rotate an arm (rotation order YZX, hanging along -y) so it points along `dir` (torso frame) */
function aim(arm, dir) {
  const tz = Math.acos(Math.max(-1, Math.min(1, -dir.y)));
  const ty = Math.sin(tz) > 1e-4 ? Math.atan2(-dir.z, dir.x) : 0;
  arm.rotation.set(0, ty, tz);
}

export function makePlayer({ shirt = 0xffffff, shorts = 0x1b2a4a, skin = 0, hat = 0xffffff } = {}) {
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);
  const skinM = mat(skinTones[skin % skinTones.length], 0.55);
  const shirtM = mat(shirt, 0.65);
  const shortsM = mat(shorts, 0.7);
  const shoeM = mat(0xf5f5f5, 0.5);

  // legs (pivot at the hip)
  const legs = [];
  for (const sx of [-1, 1]) {
    const hip = new THREE.Group();
    hip.position.set(sx * 0.11, 0.95, 0);
    const thigh = new THREE.Mesh(new THREE.CapsuleGeometry(0.075, 0.42, 3, 8), skinM);
    thigh.position.y = -0.27;
    const knee = new THREE.Group();
    knee.position.y = -0.5;
    const shin = new THREE.Mesh(new THREE.CapsuleGeometry(0.065, 0.36, 3, 8), skinM);
    shin.position.y = -0.22;
    const shoe = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.08, 0.27), shoeM);
    shoe.position.set(0, -0.42, 0.05);
    knee.add(shin, shoe);
    hip.add(thigh, knee);
    body.add(hip);
    legs.push({ hip, knee });
  }
  const shortsMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.22, 0.26, 12), shortsM);
  shortsMesh.position.y = 0.92;
  body.add(shortsMesh);

  // torso + head
  const torso = new THREE.Group();
  torso.position.y = 1.0;
  body.add(torso);
  const chest = new THREE.Mesh(new THREE.CapsuleGeometry(0.19, 0.36, 4, 12), shirtM);
  chest.position.y = 0.27;
  chest.scale.set(1, 1, 0.75);
  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.1, 8), skinM);
  neck.position.y = 0.58;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.12, 16, 12), skinM);
  head.position.y = 0.72;
  const cap = new THREE.Mesh(new THREE.SphereGeometry(0.125, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), mat(hat, 0.5));
  cap.position.y = 0.74;
  const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.015, 12, 1, false, 0, Math.PI), mat(hat, 0.5));
  brim.position.set(0, 0.75, 0.1);
  brim.rotation.y = -Math.PI / 2;
  torso.add(chest, neck, head, cap, brim);

  // arms (pivot at the shoulder). The player's right side is -x when facing +z.
  const arms = [];
  for (const sx of [-1, 1]) {
    const sh = new THREE.Group();
    sh.position.set(sx * 0.24, 0.48, 0);
    sh.rotation.order = 'YZX';
    const upper = new THREE.Mesh(new THREE.CapsuleGeometry(0.055, 0.5, 3, 8), skinM);
    upper.position.y = -0.3;
    const sleeve = new THREE.Mesh(new THREE.CapsuleGeometry(0.068, 0.12, 3, 8), shirtM);
    sleeve.position.y = -0.08;
    sh.add(upper, sleeve);
    torso.add(sh);
    arms.push(sh);
  }
  const right = arms[0], left = arms[1];
  // racket in the right hand, pointing along the arm
  const racket = new THREE.Group();
  racket.position.y = -0.62;
  const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.018, 0.28, 8), mat(0x222222, 0.4));
  handle.position.y = -0.14;
  const frame = new THREE.Mesh(new THREE.TorusGeometry(0.13, 0.012, 6, 24), mat(0xdc2626, 0.3));
  frame.scale.set(1, 1.3, 1);
  frame.position.y = -0.46;
  frame.rotation.y = Math.PI / 2;
  const strings = new THREE.Mesh(new THREE.CircleGeometry(0.125, 20), new THREE.MeshStandardMaterial({ color: 0xf2f2f2, transparent: true, opacity: 0.35, side: THREE.DoubleSide }));
  strings.scale.set(1, 1.3, 1);
  strings.position.y = -0.46;
  strings.rotation.y = Math.PI / 2;
  racket.add(handle, frame, strings);
  right.add(racket);

  root.traverse(o => { if (o.isMesh) o.castShadow = true; });
  const state = { phase: 0, lastX: 0, lastZ: 0, dHit: null, dHitL: null, hitFH: true, finish: FH_FINISH };

  return {
    root,
    /**
     * p: simulation player; facing: +1 faces +z; ctx: {swing, swingType, serving, tossing, speed, prepare, ballDX}
     */
    update(p, facing, ctx, dt) {
      root.position.set(p.x, 0, p.z);
      body.rotation.z = 0;
      // face the net, turned a little towards the ball
      root.rotation.y = (facing > 0 ? 0 : Math.PI) + Math.max(-0.5, Math.min(0.5, ctx.turn || 0));
      const speed = ctx.speed;
      const run = Math.min(1, speed / 6);
      state.phase += dt * (6 + speed * 1.6);
      const s = Math.sin(state.phase);
      // ready crouch when still, upright running when moving
      const crouch = (1 - run) * 0.07 + 0.02;
      body.position.y = -crouch + Math.abs(Math.cos(state.phase)) * 0.04 * run;
      body.rotation.x = 0.08 + run * 0.12;
      legs[0].hip.rotation.x = s * 0.7 * run - crouch * 2;
      legs[1].hip.rotation.x = -s * 0.7 * run - crouch * 2;
      legs[0].knee.rotation.x = Math.max(0, -s) * 0.9 * run + crouch * 3.5;
      legs[1].knee.rotation.x = Math.max(0, s) * 0.9 * run + crouch * 3.5;
      torso.rotation.y = 0;
      // arms: default carry
      left.rotation.set(-s * 0.5 * run + 0.25, 0, 0.25);
      right.rotation.set(s * 0.4 * run + 0.5, 0, -0.35);
      // ---- strokes: aim the racket at the ball (simple IK) -------------------------------------
      // The right arm + racket is one rigid lever from the shoulder to the string bed (REACH_L).
      // Direction vectors are in the torso frame: +z towards the net, -x = the player's right.
      const ease = (t) => t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
      const serve = ctx.swingType === 2;
      const fh = ctx.forehand;
      const BACK = serve ? SERVE_BACK : fh ? FH_BACK : BH_BACK;
      const FINISH = serve ? SERVE_FINISH : (state.hitFH ? FH_FINISH : BH_FINISH);
      let crouchK = 0, crouchNeed = 0;

      if (ctx.tossing > 0) {
        // serve: left arm tosses, racket loops up behind the head into the trophy pose
        left.rotation.set(Math.PI * 0.95 * ctx.tossing, 0, 0.15);
        torso.rotation.y = 0.45 * ctx.tossing;
        aim(right, nlerp(CARRY, SERVE_BACK, ease(ctx.tossing)));
      }

      if (ctx.swing > 0 && state.dHit) {
        // follow-through from the contact pose to the finish
        const e = ease(1 - ctx.swing);
        body.rotation.z = (state.lean || 0) * (1 - e);
        torso.rotation.y = state.hitFH === null ? -0.5 * e : (state.hitFH ? 0.65 : -0.65) * e;
        aim(right, nlerp(state.dHit, state.finish, e));
        if (state.hitFH === false) aim(left, nlerp(state.dHitL || state.dHit, state.finish, e));
      } else if (ctx.contactT !== null && ctx.contactT < 0.75 && ctx.contactPos) {
        const fwd = 0.2;                                   // forward swing duration (s)
        const back = ctx.contactT > fwd;
        const k = back ? ease(Math.min(1, 1 - (ctx.contactT - fwd) / (0.75 - fwd))) : 1;
        const f = back ? 0 : ease(1 - ctx.contactT / fwd);
        // crouch for low balls so the lever can reach them
        const cp = ctx.contactPos;
        const h = Math.hypot(cp.x - p.x, cp.z - p.z);
        const shoulderY = 1.48;
        const needY = cp.y + Math.sqrt(Math.max(0, REACH_L * REACH_L - h * h));
        crouchNeed = Math.max(0, Math.min(0.6, shoulderY - needY));
        crouchK = k;
        body.position.y -= crouchNeed * crouchK;
        legs[0].knee.rotation.x += crouchNeed * crouchK * 2.2;
        legs[1].knee.rotation.x += crouchNeed * crouchK * 2.2;
        legs[0].hip.rotation.x -= crouchNeed * crouchK * 1.1;
        legs[1].hip.rotation.x -= crouchNeed * crouchK * 1.1;
        // shoulder turn: coil on the backswing, square to the net at contact
        torso.rotation.y = (fh ? -0.6 : 0.6) * k * (1 - f);
        // lean sideways towards wide balls (extends the reach like a real stretch)
        const side = (cp.x - p.x) * facing;                 // local x of the ball, - = player's right
        const wide = Math.max(0, Math.abs(side) - 0.9);
        state.lean = Math.min(0.4, wide * 0.6) * Math.sign(-side) * k;
        body.rotation.z = state.lean;
        root.updateMatrixWorld(true);
        const dC = torso.worldToLocal(tmp.copy(cp)).sub(SHOULDER_R).normalize();
        const dir = back ? nlerp(CARRY, BACK, k) : nlerp(BACK, dC, f);
        aim(right, dir);
        if (!fh) {
          const dL = torso.worldToLocal(tmp.copy(cp)).sub(SHOULDER_L).normalize();
          aim(left, back ? nlerp(CARRY_L, BH_BACK_L, k) : nlerp(BH_BACK_L, dL, f));
          state.dHitL = dL;
        }
        state.dHit = dC;
        state.hitFH = fh;
        state.finish = fh ? FH_FINISH : BH_FINISH;
      }
      if (ctx.hitNow) {
        // the ball was just struck: freeze the exact contact pose as the start of the follow-through
        if (ctx.hitPos) {
          root.updateMatrixWorld(true);
          state.dHit = torso.worldToLocal(tmp.copy(ctx.hitPos)).sub(SHOULDER_R).normalize();
          state.dHitL = torso.worldToLocal(tmp.copy(ctx.hitPos)).sub(SHOULDER_L).normalize();
        }
        if (serve) { state.hitFH = null; state.finish = SERVE_FINISH; }
        else { state.hitFH = ctx.forehand; state.finish = ctx.forehand ? FH_FINISH : BH_FINISH; }
      }
      void FINISH;
    },
  };
}
