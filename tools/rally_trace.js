import fs from 'node:fs';
import { createTiebreak, step, aiController } from '../shared/tennis.js';
const st = JSON.parse(fs.readFileSync(process.argv[2] || 'data/state.json', 'utf8'));
const dec = (b) => { const x = Buffer.from(b, 'base64'); return new Float32Array(x.buffer.slice(x.byteOffset, x.byteOffset + x.byteLength)); };
const top = st.hall.slice().sort((a, b) => b.elo - a.elo).slice(0, 2).map(h => dec(h.genome));
const m = createTiebreak(901, 99);
const c = [aiController(top[0]), aiController(top[1])];
let s = 0, shown = 0, bounces = 0;
while (shown < 24 && s < 100000) {
  step(m, c); s++;
  for (const e of m.events) {
    if (e.type === 'bounce') bounces++;
    if (e.type === 'hit' && shown < 24) {
      const p = m.players[e.side], o = m.players[1 - e.side];
      console.log(`t=${m.t.toFixed(2)} side${e.side} hit at (${e.x?.toFixed(1)}, y${e.y?.toFixed(2)}, z${e.z?.toFixed(1)}) speed ${e.speed.toFixed(1)} | hitter (${p.x.toFixed(1)}, ${p.z.toFixed(1)}) opp (${o.x.toFixed(1)}, ${o.z.toFixed(1)}) bounces since last hit ${bounces}`);
      bounces = 0;
      shown++;
    }
  }
}
