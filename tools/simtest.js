import { createTiebreak, step, aiController, randomGenome, mulberry32, solveShot, COURT } from '../shared/tennis.js';
// shot solver sanity: baseline to baseline at 30 m/s with topspin
const v = solveShot(0, 1, -11, 0, 9, 30, 0.5, 0.4);
console.log('solver vel', v, 'speed', Math.hypot(v.vx, v.vy, v.vz).toFixed(1));
const rng = mulberry32(5);
let t0 = Date.now(), steps = 0;
const tally = { matches: 0, points: 0, contacts: 0, inPlay: 0, faults: 0, why: {} };
for (let k = 0; k < 30; k++) {
  const m = createTiebreak(1000 + k);
  const c = [aiController(randomGenome(rng)), aiController(randomGenome(rng))];
  let n = 0;
  while (m.phase !== 'over' && n < 200000) {
    step(m, c); n++;
    for (const e of m.events) { if (e.type === 'point') tally.why[e.why] = (tally.why[e.why] || 0) + 1; if (e.type === 'fault') tally.faults++; }
  }
  steps += n;
  tally.matches++;
  tally.points += m.stats[0].points + m.stats[1].points;
  tally.contacts += m.stats[0].contacts + m.stats[1].contacts;
  tally.inPlay += m.stats[0].inPlay + m.stats[1].inPlay;
}
const ms = Date.now() - t0;
console.log(`30 random matches: ${steps} steps in ${ms} ms (${(steps / ms).toFixed(0)} steps/ms)`, JSON.stringify(tally));
