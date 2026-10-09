// DEUCE server: runs self-play training and serves the stadium viewer + JSON API.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { League } from './trainer.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = +(process.env.PORT || 8080);
const league = new League({
  dataDir: process.env.DATA_DIR || path.join(root, 'data'),
  workers: process.env.WORKERS ? +process.env.WORKERS : undefined,
  genInterval: process.env.GEN_INTERVAL_MS ? +process.env.GEN_INTERVAL_MS : undefined,
});

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml' };
const STATIC = [['/vendor/three/', path.join(root, 'node_modules/three/')], ['/shared/', path.join(root, 'shared/')], ['/', path.join(root, 'public/')]];

function json(res, obj) { res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(obj)); }

function serveStatic(req, res) {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (p === '/') p = '/index.html';
  for (const [prefix, dir] of STATIC) {
    if (!p.startsWith(prefix)) continue;
    const file = path.normalize(path.join(dir, p.slice(prefix.length)));
    if (!file.startsWith(dir)) break;
    fs.stat(file, (err, st) => {
      if (err || !st.isFile()) { res.writeHead(404); res.end('not found'); return; }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': prefix === '/vendor/three/' ? 'public, max-age=86400' : 'no-cache' });
      fs.createReadStream(file).pipe(res);
    });
    return;
  }
  res.writeHead(404); res.end('not found');
}

http.createServer((req, res) => {
  if (req.url.startsWith('/api/status')) return json(res, league.status());
  if (req.url.startsWith('/api/showcase')) return json(res, league.showcase || { generation: -1 });
  if (req.url.startsWith('/api/levels')) return json(res, league.levels());
  if (req.url.startsWith('/api/reset') && req.method === 'POST') { league.requestReset(); return json(res, { ok: true }); }
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); res.end(); return; }
  serveStatic(req, res);
}).listen(PORT, () => console.log(`[deuce] viewer on http://0.0.0.0:${PORT}`));

league.run().catch((e) => { console.error(e); process.exit(1); });
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { try { league.save(); } catch (e) { console.error(e); } process.exit(0); });
