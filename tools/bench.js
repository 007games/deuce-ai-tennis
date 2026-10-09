import { League } from '../server/trainer.js';
const lg = new League({ dataDir: '/tmp/deuce-bench', workers: 6 });
lg.seed(); lg.startWorkers();
const N = +(process.argv[2] || 40);
for (let i = 0; i < N; i++) {
  await lg.step();
  const h = lg.history[lg.history.length - 1];
  if (i % 5 === 0 || i === N - 1) console.log(`gen ${h.g} best ${h.best} mean ${h.mean} rally(inPlay/pt) ${h.rally} elo ${h.elo} ${h.ms}ms hall ${lg.hall.length}`);
}
process.exit(0);
