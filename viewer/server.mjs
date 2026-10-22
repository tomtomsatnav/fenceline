// Fenceline viewer: a local, read-only web page that draws the repo as a map and lights up the agent's path.
// Zero dependencies. Binds to 127.0.0.1 only.
//   GET /                     the page            GET /glob.mjs, /layout.mjs   shared ES modules
//   GET /api/sessions         sessions under <home>/sessions, newest first
//   GET /api/session/:id      meta + events + summary
//   GET /api/stream/:id       SSE: events appended after connect (event: ev), summary when it appears (event: summary)
//   GET /api/recordings, /api/recording/:name   recorded sessions bundled with the repo
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { home as defaultHome } from '../src/session.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const SID = /^[A-Za-z0-9_-]{1,128}$/;
const NAME = /^[A-Za-z0-9_.-]{1,200}$/;
const STATIC = { '/': ['index.html', 'text/html; charset=utf-8'], '/index.html': ['index.html', 'text/html; charset=utf-8'],
  '/layout.mjs': ['layout.mjs', 'text/javascript; charset=utf-8'], '/glob.mjs': ['../src/glob.mjs', 'text/javascript; charset=utf-8'] };

const readJson = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };
const readJsonl = (f) => { try { return fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean); } catch { return []; } };
const bundle = (dir) => ({ meta: readJson(path.join(dir, 'meta.json')), events: readJsonl(path.join(dir, 'events.jsonl')), summary: readJson(path.join(dir, 'summary.json')) });

function send(res, code, body, type = 'application/json') {
  res.writeHead(code, { 'content-type': type, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
  res.end(type === 'application/json' ? JSON.stringify(body) : body);
}

export function createServer({ home = defaultHome(), recordingsDir = path.join(here, '..', 'recordings') } = {}) {
  const sessions = path.join(home, 'sessions');
  const listDirs = (root) => { try { return fs.readdirSync(root).map((n) => ({ n, mtime: fs.statSync(path.join(root, n)).mtimeMs })); } catch { return []; } };

  function stream(req, res, dir) {
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive', 'x-content-type-options': 'nosniff' });
    const efile = path.join(dir, 'events.jsonl'); const sfile = path.join(dir, 'summary.json');
    const size = () => { try { return fs.statSync(efile).size; } catch { return 0; } };
    let offset = size(); let buf = ''; let summaryMtime = 0;
    res.write(': connected\n\n');
    const tick = () => {
      const sz = size();
      if (sz < offset) { offset = 0; buf = ''; }
      if (sz > offset) {
        try {
          const fd = fs.openSync(efile, 'r'); const b = Buffer.alloc(sz - offset);
          fs.readSync(fd, b, 0, b.length, offset); fs.closeSync(fd); offset = sz;
          buf += b.toString('utf8');
          const lines = buf.split('\n'); buf = lines.pop();
          for (const l of lines) if (l.trim()) { try { res.write(`event: ev\ndata: ${JSON.stringify(JSON.parse(l))}\n\n`); } catch { /* skip bad line */ } }
        } catch { /* retry next tick */ }
      }
      try { const mt = fs.statSync(sfile).mtimeMs; if (mt !== summaryMtime) { const s = readJson(sfile); if (s) { summaryMtime = mt; res.write(`event: summary\ndata: ${JSON.stringify(s)}\n\n`); } } } catch { /* not yet */ }
    };
    tick(); const iv = setInterval(tick, 250);
    req.on('close', () => clearInterval(iv));
  }

  return http.createServer((req, res) => {
    // local only: refuse any Host but loopback (DNS rebinding)
    const host = String(req.headers.host || '').replace(/:\d+$/, '');
    if (!['127.0.0.1', 'localhost', '[::1]'].includes(host)) return send(res, 403, { error: 'forbidden host' });
    const p = new URL(req.url, 'http://x').pathname;
    try {
      if (p === '/favicon.ico') { res.writeHead(204); return res.end(); }
      if (STATIC[p]) return send(res, 200, fs.readFileSync(path.join(here, STATIC[p][0]), 'utf8'), STATIC[p][1]);
      if (p === '/api/sessions') {
        return send(res, 200, listDirs(sessions).filter((d) => SID.test(d.n)).sort((a, b) => b.mtime - a.mtime).slice(0, 100)
          .map((d) => { const m = readJson(path.join(sessions, d.n, 'meta.json')); return { id: d.n, repo_name: m?.repo_name ?? null, started_at: m?.started_at ?? null }; }));
      }
      if (p === '/api/recordings') {
        return send(res, 200, listDirs(recordingsDir).filter((d) => NAME.test(d.n) && d.n !== '.' && d.n !== '..' && fs.existsSync(path.join(recordingsDir, d.n, 'events.jsonl')))
          .sort((a, b) => a.n.localeCompare(b.n)).map((d) => { const m = readJson(path.join(recordingsDir, d.n, 'meta.json')); return { name: d.n, repo_name: m?.repo_name ?? null, started_at: m?.started_at ?? null }; }));
      }
      let m = /^\/api\/(session|stream|recording)\/([^/]*)$/.exec(p);
      if (m) {
        const [, kind, id] = m;
        const rec = kind === 'recording';
        if (!(rec ? NAME.test(id) && id !== '.' && id !== '..' : SID.test(id))) return send(res, 400, { error: 'bad name' });
        const dir = path.join(rec ? recordingsDir : sessions, id);
        if (!fs.existsSync(path.join(dir, rec ? 'events.jsonl' : 'meta.json')) && !(kind === 'stream' && fs.existsSync(dir))) return send(res, 404, { error: 'not found' });
        if (kind === 'stream') { stream(req, res, dir); return undefined; }
        return send(res, 200, { id, ...bundle(dir) });
      }
      return send(res, 404, { error: 'not found' });
    } catch (e) { return send(res, 500, { error: String(e?.message || e).slice(0, 200) }); }
  });
}

export function serve({ port = 4321, host = '127.0.0.1', ...opts } = {}) {
  return new Promise((resolve) => {
    const s = createServer(opts);
    s.listen(port, host, () => { console.log(`fenceline viewer: http://${host}:${s.address().port}`); resolve(s); });
  });
}

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url))) {
  const i = process.argv.indexOf('--port');
  serve({ port: i > 0 ? Number(process.argv[i + 1]) || 4321 : 4321 });
}
