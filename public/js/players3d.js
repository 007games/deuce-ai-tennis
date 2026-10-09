// Low-poly tennis players with a racket. Procedural animation: run cycle, split-step ready stance,
// forehand / backhand / serve swings and the ball toss, all driven by the simulation state.
import * as THREE from 'three';

const skinTones = [0xe8b893, 0xc68a62, 0x8d5a3b, 0xf1c9a5];

function mat(color, rough = 0.6) { return new THREE.MeshStandardMaterial({ color, roughness: rough }); }

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
  const state = { phase: 0, lastX: 0, lastZ: 0 };

  return {
    root,
    /**
     * p: simulation player; facing: +1 faces +z; ctx: {swing, swingType, serving, tossing, speed, prepare, ballDX}
     */
    update(p, facing, ctx, dt) {
      root.position.set(p.x, 0, p.z);
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
      // Stroke timing. Racket yaw for the right arm (raised to the side): forehand contact ~0.3 rad
      // (right, slightly in front), backhand contact ~2.85 (left, slightly in front).
      const FH = { back: -1.6, contact: 0.3, finish: 2.2 };
      const BH = { back: 3.9, contact: 2.85, finish: 1.0 };
      const ease = (t) => t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
      const strokePose = (yaw, fh, k) => {
        right.rotation.set(0.15, yaw, -1.25 * k);
        if (!fh) left.rotation.set(0.2, yaw - 0.4, 1.1 * k);    // two-handed backhand
        torso.rotation.y = (fh ? -0.6 : 0.7) * (1 - Math.min(1, Math.abs(yaw - (fh ? FH.back : BH.back)) / 2.2)) + (fh ? 0.5 : -0.5) * Math.max(0, (fh ? yaw - FH.contact : BH.contact - yaw) / 2);
      };
      const sw = ctx.swing;               // 1 -> 0 after the ball was struck: follow-through
      if (sw > 0) {
        const e = ease(1 - sw);
        if (ctx.swingType === 2) {
          right.rotation.set(3.7 + 1.5 * e, 0, 0);
          torso.rotation.y = 0.2 - 0.6 * e;
        } else {
          const P = ctx.swingType === 0 ? FH : BH;
          strokePose(P.contact + (P.finish - P.contact) * e, ctx.swingType === 0, 1);
        }
      } else if (ctx.contactT !== null && ctx.contactT < 0.75) {
        // take the racket back while the ball approaches, then swing forward to meet it at contact
        const P = ctx.forehand ? FH : BH;
        const fwdPhase = 0.2;                              // forward swing duration (s)
        let yaw, k;
        if (ctx.contactT > fwdPhase) {
          k = ease(Math.min(1, 1 - (ctx.contactT - fwdPhase) / (0.75 - fwdPhase)));
          yaw = (ctx.forehand ? -0.4 : 3.3) * (1 - k) + P.back * k;
        } else {
          k = 1;
          const f = ease(1 - ctx.contactT / fwdPhase);
          yaw = P.back + (P.contact - P.back) * f;
        }
        strokePose(yaw, ctx.forehand, k);
      }
    },
  };
}
