import fs from 'node:fs';
import { createTiebreak, step, aiController } from '../shared/tennis.js';
const st = JSON.parse(fs.readFileSync('data/state.json', 'utf8'));
const dec = (b) => { const x = Buffer.from(b, 'base64'); return new Float32Array(x.buffer.slice(x.byteOffset, x.byteOffset + x.byteLength)); };
const top = st.hall.slice().sort((a, b) => b.elo - a.elo).slice(0, 4).map(h => dec(h.genome));
let pts = 0, inPlay = 0;
for (let k = 0; k < 24; k++) {
  const m = createTiebreak(77 + k, 99);
  const c = [aiController(top[k % 4]), aiController(top[(k + 1) % 4])];
  let n = 0;
  while (m.pointCount < 16 && n < 400000) { step(m, c); n++; }
  pts += m.pointCount; inPlay += m.stats[0].inPlay + m.stats[1].inPlay;
}
console.log(`generation ${st.generation}: top champions, new contact rule -> ${(inPlay / pts).toFixed(2)} shots in play per point`);
console.log('history (old rule), last entries:', st.history.slice(-3).map(h => h.rally).join(', '));
