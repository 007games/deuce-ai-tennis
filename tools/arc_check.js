// How high do the champions play? Peak height of each rally shot and its clearance over the net.
import fs from 'node:fs';
import { createTiebreak, step, aiController, netHeight } from '../shared/tennis.js';
const st = JSON.parse(fs.readFileSync(process.argv[2] || 'data/state.json', 'utf8'));
const dec = (b) => { const x = Buffer.from(b, 'base64'); return new Float32Array(x.buffer.slice(x.byteOffset, x.byteOffset + x.byteLength)); };
const top = st.hall.slice().sort((a, b) => b.elo - a.elo).slice(0, 3).map(h => dec(h.genome));
const peaks = [], clear = [], lifts = [], powers = [];
for (let k = 0; k < 10; k++) {
  const m = createTiebreak(700 + k, 99);
  const c = [aiController(top[k % 3]), aiController(top[(k + 1) % 3])];
  c.forEach((cc) => { const o = cc.shot; cc.shot = (...a) => { const s = o(...a); if (!a[2]) { lifts.push(s.lift); powers.push(s.power); } return s; }; });
  let n = 0, peak = 0, pz = 0, tracking = false;
  while (m.pointCount < 16 && n < 60000) {
    step(m, c); n++;
    const b = m.ball;
    for (const e of m.events) if (e.type === 'hit' && !e.serve) { if (tracking) peaks.push(peak); tracking = true; peak = 0; }
    if (tracking && b.live) {
      peak = Math.max(peak, b.y);
      if ((pz < 0) !== (b.z < 0)) clear.push(b.y - netHeight(b.x));
    }
    pz = b.z;
    if (m.phase !== 'rally') tracking = false;
  }
}
const avg = (a) => (a.reduce((x, y) => x + y, 0) / a.length).toFixed(2);
const pct = (a, f) => (100 * a.filter(f).length / a.length).toFixed(0) + '%';
console.log(`rally shots: ${peaks.length}; average peak height ${avg(peaks)} m; peaks above 4 m: ${pct(peaks, v => v > 4)}`);
console.log(`average clearance over the net: ${avg(clear)} m (pros: roughly 0.5-1.5 m)`);
console.log(`chosen arc ("lift" 0..1): average ${avg(lifts)}; power average ${avg(powers)}`);
