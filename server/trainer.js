// Self-play league for tennis brains (neuroevolution).
// Every generation each player plays short matches against random rivals from the population and
// against saved champions (the hall of fame) so it cannot over-specialise against one style.
// Champions are snapshotted into the hall of fame and rated with Elo; the hall becomes the
// difficulty levels a human can play against.
import { Worker } from 'node:worker_threads';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { mulberry32, gaussian, randomGenome, genomeSize } from '../shared/tennis.js';

const NAMES = ['Ace', 'Volley', 'Lob', 'Slice', 'Smash', 'Drop', 'Spin', 'Rally', 'Baseline', 'Net', 'Topspin', 'Chip', 'Kick', 'Flat', 'Swing', 'Deuce'];
const FIRST = ['Rafa', 'Nina', 'Bjorn', 'Iga', 'Novak', 'Coco', 'Andy', 'Elena', 'Carlos', 'Aryna', 'Jannik', 'Ons', 'Holger', 'Mirra', 'Taylor', 'Leylah', 'Casper', 'Jasmine', 'Felix', 'Qinwen'];
// bump when the game rules change: saved champions are re-rated under the new rules
const RULES_VERSION = 7;

export const LEVEL_NAMES = ['Beginner', 'Novice', 'Club', 'Club+', 'County', 'Regional', 'National', 'Pro', 'Elite', 'Champion'];

function encode(f32) { return Buffer.from(f32.buffer, f32.byteOffset, f32.byteLength).toString('base64'); }
function decode(b64) { const b = Buffer.from(b64, 'base64'); return new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)); }
function thin(arr, max) {
  if (arr.length <= max) return arr;
  const out = [], step = arr.length / max;
  for (let i = 0; i < max; i++) out.push(arr[Math.floor(i * step)]);
  out[out.length - 1] = arr[arr.length - 1];
  return out;
}

export class League {
  constructor(opts = {}) {
    this.dataDir = opts.dataDir || './data';
    this.popSize = opts.popSize || 128;
    this.workerCount = opts.workers || Math.max(2, Math.min(12, os.cpus().length - 4));
    this.genInterval = opts.genInterval ?? 1000;
    this.size = genomeSize();
    this.rng = mulberry32(Date.now() >>> 0);
    this.generation = 0;
    this.nextId = 1;
    this.population = [];
    this.hall = [];                 // {id, name, gen, elo, genome}
    this.history = [];
    this.sigma = 0.15;
    this.showcase = null;
    this.workers = [];
    this.pending = new Map();
    this.jobId = 0;
    this.gensPerMin = 0;
    this.resets = 0;
  }

  statePath() { return path.join(this.dataDir, 'state.json'); }

  name(id) { return `${FIRST[(id * 7919) % FIRST.length]} ${NAMES[(id * 104729) % NAMES.length]}`; }

  load() {
    try {
      const raw = JSON.parse(fs.readFileSync(this.statePath(), 'utf8'));
      if (raw.size !== this.size) throw new Error('network shape changed');
      Object.assign(this, { generation: raw.generation, nextId: raw.nextId, history: raw.history || [], sigma: raw.sigma || 0.15, resets: raw.resets || 0, rulesVersion: raw.rulesVersion || 1 });
      this.population = raw.population.map(p => ({ ...p, genome: decode(p.genome) }));
      this.hall = raw.hall.map(h => ({ ...h, genome: decode(h.genome) }));
      console.log(`[league] resumed at generation ${this.generation} (${this.hall.length} champions in the hall)`);
      return true;
    } catch (e) {
      if (e.code !== 'ENOENT') console.log('[league] could not load state:', e.message);
      return false;
    }
  }

  save() {
    fs.mkdirSync(this.dataDir, { recursive: true });
    const data = {
      size: this.size, generation: this.generation, nextId: this.nextId, history: this.history, sigma: this.sigma, resets: this.resets, rulesVersion: RULES_VERSION,
      population: this.population.map(p => ({ id: p.id, born: p.born, genome: encode(p.genome) })),
      hall: this.hall.map(h => ({ ...h, genome: encode(h.genome) })),
    };
    const tmp = this.statePath() + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(data));
    fs.renameSync(tmp, this.statePath());
  }

  seed() {
    this.population = [];
    for (let i = 0; i < this.popSize; i++) this.population.push({ id: this.nextId++, born: 0, genome: randomGenome(this.rng) });
  }

  startWorkers() {
    for (let i = 0; i < this.workerCount; i++) {
      const w = new Worker(new URL('./worker.js', import.meta.url));
      w.on('message', (m) => { const cb = this.pending.get(m.id); this.pending.delete(m.id); cb(m.results); });
      w.on('error', (e) => console.error('[worker]', e));
      this.workers.push(w);
    }
  }

  /** play a list of [genomeA, genomeB] matches across all workers */
  async playAll(matches) {
    const chunks = this.workers.map(() => []);
    matches.forEach((mt, i) => chunks[i % chunks.length].push(i));
    const res = new Array(matches.length);
    await Promise.all(chunks.map((idxs, w) => new Promise((resolve) => {
      if (idxs.length === 0) return resolve();
      // pack the distinct genomes of this chunk
      const genomes = [], index = new Map();
      const pairs = idxs.map((i) => {
        const [a, b, seed] = matches[i];
        for (const g of [a, b]) if (!index.has(g)) { index.set(g, genomes.length); genomes.push(g); }
        return [index.get(a), index.get(b), seed];
      });
      const buf = new Float32Array(genomes.length * this.size);
      genomes.forEach((g, k) => buf.set(g, k * this.size));
      const id = ++this.jobId;
      this.pending.set(id, (results) => { results.forEach((r, k) => { res[idxs[k]] = r; }); resolve(); });
      this.workers[w].postMessage({ id, genomes: buf.buffer, pairs }, [buf.buffer]);
    })));
    return res;
  }

  fitness(s) {
    // win points - but also return serves and keep rallies going, otherwise the league drifts into
    // pure serve-and-ace tennis that nobody learns anything from
    const total = Math.max(1, s.total);
    const returnRate = s.servesFaced ? s.returnsIn / s.servesFaced : 0;
    // (no reward per racket contact: that was exploited by endless net volleys)
    // depth: real tennis is played from the baseline; reward balls landing beyond the service line
    const deepRate = s.inPlay ? s.deepIn / s.inPlay : 0;
    // outright winners: attacking tennis should pay off
    return s.points / total + 0.35 * returnRate + 0.3 * deepRate + 0.25 * (s.winnersN || 0) / total + 0.02 * s.inPlay + 0.25 * s.approach - 0.02 * s.df;
  }

  async step() {
    const pop = this.population;
    for (const p of pop) { p.fit = 0; p.n = 0; p.pts = 0; p.tot = 0; p.inPlay = 0; }
    const matches = [], owners = [];
    const seedBase = Math.floor(this.rng() * 1e9);
    for (let i = 0; i < pop.length; i++) {
      for (let k = 0; k < 3; k++) {
        let j = Math.floor(this.rng() * pop.length);
        if (j === i) j = (j + 1) % pop.length;
        matches.push([pop[i].genome, pop[j].genome, seedBase + matches.length]);
        owners.push([i, j]);
      }
      if (this.hall.length) {
        const h = this.hall[this.hall.length - 1 - Math.floor(Math.pow(this.rng(), 2) * this.hall.length)];
        matches.push([pop[i].genome, h.genome, seedBase + matches.length]);
        owners.push([i, -1]);
      }
    }
    const t0 = Date.now();
    const res = await this.playAll(matches);
    const ms = Date.now() - t0;
    res.forEach(([a, b], k) => {
      const [i, j] = owners[k];
      const add = (p, s) => { p.fit += this.fitness(s); p.n++; p.pts += s.points; p.tot += s.total; p.inPlay += s.inPlay; };
      add(pop[i], a);
      if (j >= 0) add(pop[j], b);
    });
    for (const p of pop) p.fit /= Math.max(1, p.n);
    const sorted = pop.slice().sort((a, b) => b.fit - a.fit);
    const best = sorted[0];
    const rally = res.reduce((a, [x, y]) => a + (x.inPlay + y.inPlay) / Math.max(1, x.total), 0) / res.length;
    let faced = 0, returned = 0;
    for (const [x, y] of res) { faced += x.servesFaced + y.servesFaced; returned += x.returnsIn + y.returnsIn; }
    const returnRate = faced ? returned / faced : 0;
    this.history.push({ g: this.generation, best: +best.fit.toFixed(3), mean: +(pop.reduce((a, p) => a + p.fit, 0) / pop.length).toFixed(3),
      rally: +rally.toFixed(2), ret: +returnRate.toFixed(3), elo: this.hall.length ? Math.round(Math.max(...this.hall.map(h => h.elo))) : 1000, ms, t: Date.now() });
    if (this.history.length > 20000) this.history = thin(this.history, 10000);

    if (this.generation % 15 === 0) await this.enterHall(best);
    this.makeShowcase(best, sorted[1]);
    this.breed(sorted);
    this.generation++;
  }

  /** snapshot the champion into the hall of fame and rate it against the existing members */
  async enterHall(best) {
    const entry = { id: best.id, name: this.name(best.id), gen: this.generation, elo: this.hall.length ? this.hall[this.hall.length - 1].elo : 1000, genome: best.genome.slice() };
    if (this.hall.length) {
      const opps = [];
      for (let k = 0; k < 12; k++) opps.push(this.hall[Math.floor(this.rng() * this.hall.length)]);
      const res = await this.playAll(opps.map((o, k) => [entry.genome, o.genome, Math.floor(this.rng() * 1e9) + k]));
      res.forEach(([a, b], k) => {
        const o = opps[k];
        const score = a.points / Math.max(1, a.total);        // fraction of points won
        const exp = 1 / (1 + Math.pow(10, (o.elo - entry.elo) / 400));
        const K = 40;
        entry.elo += K * (score - exp) * 2;
        o.elo -= K * 0.5 * (score - exp);
      });
    }
    this.hall.push(entry);
    // keep the hall bounded: drop near-duplicates in rating among the older half
    while (this.hall.length > 80) {
      let bi = 1, bd = Infinity;
      for (let i = 1; i < this.hall.length - 20; i++) {
        const d = Math.abs(this.hall[i].elo - this.hall[i - 1].elo);
        if (d < bd) { bd = d; bi = i; }
      }
      this.hall.splice(bi, 1);
    }
  }

  makeShowcase(a, b) {
    // newest champion against a strong rival from the hall
    let opp = b;
    if (this.hall.length > 1 && this.rng() < 0.6) {
      const strong = this.hall.slice().sort((x, y) => y.elo - x.elo).slice(0, 5);
      opp = strong[Math.floor(this.rng() * strong.length)];
    }
    this.showcase = {
      generation: this.generation,
      players: [
        { name: this.name(a.id), genome: encode(a.genome), label: `gen ${this.generation} champion` },
        { name: opp.name || this.name(opp.id), genome: encode(opp.genome), label: opp.gen !== undefined ? `hall of fame · gen ${opp.gen}` : `gen ${this.generation} runner-up` },
      ],
      seed: Math.floor(this.rng() * 1e9),
    };
  }

  breed(sorted) {
    const next = [];
    const elite = Math.round(this.popSize * 0.06);
    for (let i = 0; i < elite; i++) next.push({ id: sorted[i].id, born: sorted[i].born, genome: sorted[i].genome });
    while (next.length < this.popSize - 3) {
      const a = this.tournament(sorted), b = this.tournament(sorted);
      const child = new Float32Array(this.size);
      const mix = this.rng() < 0.5;
      for (let i = 0; i < this.size; i++) {
        child[i] = mix ? (this.rng() < 0.5 ? a.genome[i] : b.genome[i]) : (a.genome[i] + b.genome[i]) * 0.5;
        if (this.rng() < 0.06) child[i] += gaussian(this.rng) * this.sigma;
      }
      next.push({ id: this.nextId++, born: this.generation, genome: child });
    }
    while (next.length < this.popSize) next.push({ id: this.nextId++, born: this.generation, genome: randomGenome(this.rng) });
    this.population = next;
  }

  tournament(sorted) {
    let best = null;
    for (let i = 0; i < 4; i++) { const c = sorted[Math.floor(this.rng() * sorted.length)]; if (!best || c.fit > best.fit) best = c; }
    return best;
  }

  /** ten opponents spread from the weakest to the strongest rated champion */
  levels() {
    if (this.hall.length === 0) return [];
    const byElo = this.hall.slice().sort((a, b) => a.elo - b.elo);
    const out = [];
    for (let k = 0; k < 10; k++) {
      const h = byElo[Math.round((k / 9) * (byElo.length - 1))];
      out.push({ level: k + 1, title: LEVEL_NAMES[k], name: h.name, elo: Math.round(h.elo), gen: h.gen, genome: encode(h.genome) });
    }
    return out;
  }

  /** round-robin re-rating of the whole hall (used after a rules change) */
  async rerateHall() {
    if (this.hall.length < 2) return;
    for (const h of this.hall) h.elo = 1000;
    for (let round = 0; round < 4; round++) {
      const games = [];
      for (let i = 0; i < this.hall.length; i++) {
        for (let k = 0; k < 2; k++) {
          let j = Math.floor(this.rng() * this.hall.length);
          if (j === i) j = (j + 1) % this.hall.length;
          games.push([i, j]);
        }
      }
      const res = await this.playAll(games.map(([i, j], k) => [this.hall[i].genome, this.hall[j].genome, Math.floor(this.rng() * 1e9) + k]));
      res.forEach(([a], k) => {
        const [i, j] = games[k];
        const A = this.hall[i], B = this.hall[j];
        const score = a.points / Math.max(1, a.total);
        const exp = 1 / (1 + Math.pow(10, (B.elo - A.elo) / 400));
        A.elo += 24 * (score - exp) * 2;
        B.elo -= 24 * (score - exp) * 2;
      });
    }
    console.log(`[league] re-rated ${this.hall.length} champions under rules v${RULES_VERSION}`);
  }

  requestReset() { this.resetRequested = true; }
  doReset() {
    this.resetRequested = false;
    try {
      this.save();
      fs.copyFileSync(this.statePath(), path.join(this.dataDir, `state-backup-${new Date().toISOString().replace(/[:.]/g, '-')}.json`));
    } catch (e) { console.error('[league] backup failed', e.message); }
    Object.assign(this, { generation: 0, history: [], hall: [], showcase: null, sigma: 0.15, resets: this.resets + 1 });
    this.seed();
    this.save();
    console.log('[league] knowledge wiped');
  }

  async run() {
    if (!this.load()) this.seed();
    this.startWorkers();
    if ((this.rulesVersion || RULES_VERSION) !== RULES_VERSION) await this.rerateHall();
    this.rulesVersion = RULES_VERSION;
    console.log(`[league] self-play with ${this.workerCount} workers, population ${this.popSize}`);
    let lastSave = Date.now(), win = [];
    for (;;) {
      if (this.resetRequested) this.doReset();
      const t0 = Date.now();
      await this.step();
      const now = Date.now();
      win.push(now); win = win.filter(t => now - t < 60000);
      this.gensPerMin = win.length * 60000 / Math.max(now - win[0], 1000);
      if (now - lastSave > 10000) { this.save(); lastSave = now; }
      await new Promise(r => setTimeout(r, Math.max(5, this.genInterval - (Date.now() - t0))));
    }
  }

  status() {
    const top = this.hall.length ? this.hall.reduce((a, b) => (b.elo > a.elo ? b : a)) : null;
    return { generation: this.generation, population: this.popSize, workers: this.workerCount, gensPerMin: +this.gensPerMin.toFixed(1),
      hall: this.hall.length, topElo: top ? Math.round(top.elo) : null, topName: top ? top.name : null,
      history: thin(this.history, 400), resets: this.resets };
  }
}
