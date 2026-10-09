// Why do points end, and where is the ball at that moment? node tools/point_check.js
import fs from 'node:fs';
import { createTiebreak, step, aiController, COURT } from '../shared/tennis.js';
const st = JSON.parse(fs.readFileSync(process.argv[2] || 'data/state.json', 'utf8'));
const dec = (b) => { const x = Buffer.from(b, 'base64'); return new Float32Array(x.buffer.slice(x.byteOffset, x.byteOffset + x.byteLength)); };
const top = st.hall.slice().sort((a, b) => b.elo - a.elo).slice(0, 3).map(h => dec(h.genome));
const why = {}, air = {}, clampHits = { x: 0, z: 0 };
let n = 0, shots = 0, pts = 0, gameTime = 0;
for (let k = 0; k < 20; k++) {
  const m = createTiebreak(900 + k, 99);
  const c = [aiController(top[k % 3]), aiController(top[(k + 1) % 3])];
  let s = 0;
  while (m.pointCount < 16 && s < 400000) {
    step(m, c); s++;
    for (const p of m.players) { if (Math.abs(p.x) >= 7.99) clampHits.x++; if (Math.abs(p.z) >= 16.99) clampHits.z++; }
    for (const e of m.events) if (e.type === 'point' || e.type === 'fault') {
      const key = e.type + ':' + e.why;
      why[key] = (why[key] || 0) + 1;
      if (m.ball.y > 0.3) air[key] = (air[key] || 0) + 1;
      n++;
    }
  }
  shots += m.stats[0].contacts + m.stats[1].contacts; pts += m.pointCount; gameTime += m.t;
}
console.log(`points finished: ${pts} of ${20 * 16} - ${(shots / Math.max(1, pts)).toFixed(1)} racket contacts per point, ${(gameTime / Math.max(1, pts)).toFixed(1)} s per point`);
console.log('point/fault reasons:', JSON.stringify(why));
console.log('ended with the ball still in the air (>0.3 m):', JSON.stringify(air));
console.log('player pressed against the side/back limit (frames):', JSON.stringify(clampHits));
