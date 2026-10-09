// Where do the current champions aim and stand? node tools/aim_check.js
import fs from 'node:fs';
import { createTiebreak, step, aiController } from '../shared/tennis.js';
const st = JSON.parse(fs.readFileSync(process.argv[2] || 'data/state.json', 'utf8'));
const dec = (b) => { const x = Buffer.from(b, 'base64'); return new Float32Array(x.buffer.slice(x.byteOffset, x.byteOffset + x.byteLength)); };
const top = st.hall.slice().sort((a, b) => b.elo - a.elo).slice(0, 3).map(h => dec(h.genome));
const bx = [], px = [], aim = [], bz = [], pz = [], depth = [];
for (let k = 0; k < 12; k++) {
  const m = createTiebreak(500 + k, 99);
  const c = [aiController(top[k % 3]), aiController(top[(k + 1) % 3])];
  const origShot = c.map(cc => cc.shot);
  c.forEach((cc, i) => { cc.shot = (...a) => { const s = origShot[i](...a); if (!a[2]) { aim.push(s.aimX); depth.push(s.depth); } return s; }; });
  let n = 0;
  while (m.pointCount < 16 && n < 400000) {
    step(m, c); n++;
    for (const e of m.events) if (e.type === 'bounce') { bx.push(Math.abs(e.x)); bz.push(Math.abs(e.z)); }
    if (n % 30 === 0 && m.phase === 'rally') for (const p of m.players) { px.push(Math.abs(p.x)); pz.push(Math.abs(p.z)); }
  }
}
const hist = (a, edges) => edges.slice(0, -1).map((e, i) => `${e}-${edges[i + 1]}m: ${(100 * a.filter(v => v >= e && v < edges[i + 1]).length / a.length).toFixed(0)}%`).join('  ');
console.log('bounce |x| (court half-width 4.1 m):', hist(bx, [0, 1, 2, 3, 4.2, 99]));
console.log('player |x|:                         ', hist(px, [0, 1, 2, 3, 99]));
console.log('aimX output (-1..1) |value|:        ', hist(aim.map(Math.abs), [0, 0.2, 0.4, 0.6, 0.8, 1.01]));
console.log('bounce distance from net (baseline 11.9 m):', hist(bz, [0, 3, 6.4, 9, 11.9, 99]));
console.log('player distance from net:                 ', hist(pz, [0, 3, 6.4, 9, 11.9, 99]));
console.log('depth output (0..1):                      ', hist(depth, [0, 0.2, 0.4, 0.6, 0.8, 1.01]));
