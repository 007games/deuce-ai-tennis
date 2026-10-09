// Plays batches of self-play matches between brains and reports the stats of both sides.
import { parentPort } from 'node:worker_threads';
import { createTiebreak, step, aiController, genomeSize } from '../shared/tennis.js';

const POINTS = 16;

export function playMatch(ga, gb, seed) {
  const m = createTiebreak(seed, 99);
  const c = [aiController(ga), aiController(gb)];
  let n = 0;
  while (m.pointCount < POINTS && m.phase !== 'over' && n < 400000) { step(m, c); n++; }
  return m.stats.map(s => ({ points: s.points, contacts: s.contacts, inPlay: s.inPlay, approach: s.chances ? s.approach / s.chances : 0, aces: s.aces, winners: s.winners, errors: s.errors, df: s.doubleFaults, total: m.pointCount }));
}

parentPort.on('message', (job) => {
  const size = genomeSize();
  const all = new Float32Array(job.genomes);
  const g = (i) => all.subarray(i * size, (i + 1) * size);
  const results = job.pairs.map(([a, b, seed]) => playMatch(g(a), g(b), seed));
  parentPort.postMessage({ id: job.id, results });
});
