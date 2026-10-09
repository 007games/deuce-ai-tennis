import fs from 'node:fs';
import { solveByClearance, createTiebreak, step, aiController } from '../shared/tennis.js';
const st = JSON.parse(fs.readFileSync(process.argv[2] || 'data/state.json', 'utf8'));
const dec = (b) => { const x = Buffer.from(b, 'base64'); return new Float32Array(x.buffer.slice(x.byteOffset, x.byteOffset + x.byteLength)); };
const top = st.hall.slice().sort((a, b) => b.elo - a.elo).slice(0, 2).map(h => dec(h.genome));
const m = createTiebreak(4242, 99);
const c = [aiController(top[0]), aiController(top[1])];
let shown = 0, last = null;
for (let n = 0; n < 60000 && shown < 14; n++) {
  step(m, c);
  for (const e of m.events) {
    if (e.type === 'hit' && !e.serve) last = { x: e.x, y: e.y, z: e.z, side: e.side, vx: m.ball.vx, vy: m.ball.vy, vz: m.ball.vz, spin: m.ball.spin, mishit: m.events.some(q => q.type === 'mishit') };
    if (e.type === 'bounce' && last && !m.ball.serve) last.bounceZ = e.z;
    if (e.type === 'point' && e.why === 'own side' && last) { console.log('own side after hit', JSON.stringify(last, (k, v) => typeof v === 'number' ? +v.toFixed(2) : v)); shown++; }
  }
}
// direct solver probes from awkward spots
for (const [py, pz, tz] of [[0.3, -11, 8], [2.4, -11, 8], [1.0, -2, 6], [1.0, -16, 11]]) {
  const v = solveByClearance(0, py, pz, 0, tz, 2.75, 0.8);
  console.log(`probe from y=${py} z=${pz} to z=${tz}:`, JSON.stringify(v, (k, x) => typeof x === 'number' ? +x.toFixed(2) : x));
}
