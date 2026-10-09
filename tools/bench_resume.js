// Continue training a copy of the league headlessly and print progress: node tools/bench_resume.js <gens>
import { League } from '../server/trainer.js';
const lg = new League({ dataDir: '/data', workers: 6 });
lg.load(); lg.startWorkers();
const N = +(process.argv[2] || 20);
for (let i = 0; i < N; i++) {
  await lg.step();
  const h = lg.history[lg.history.length - 1];
  if (i % 3 === 0 || i === N - 1) console.log(`gen ${h.g} shots/point ${h.rally} returns ${(h.ret * 100).toFixed(0)}% best ${h.best} ${h.ms}ms`);
}
process.exit(0);
