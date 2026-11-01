#!/usr/bin/env node
// `make doctor`: checks a Fenceline install from a clone and says what to fix. Read-only: it changes nothing.
// Checks: Node 18+, the claude CLI, this checkout has the dashboard, Fenceline is installed and the old standalone
// aos-dashboard plugin is not, and what answers on the dashboard port (Fenceline's sheet, an old AOS monitor, or nothing).
// Exit 0 when every check passes, 1 otherwise. Env: PORT (default 4318), CLAUDE_BIN (default `claude`).
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PORT) || 4318;
const CLAUDE = process.env.CLAUDE_BIN || 'claude';
let fails = 0;
const ok = (m) => console.log('  ok    ' + m);
const bad = (m, fix) => { fails++; console.log('  FIX   ' + m + (fix ? '\n        -> ' + fix : '')); };
const note = (m) => console.log('  note  ' + m);

function get(p) {
  return new Promise((resolve) => {
    const req = http.get({ host: '127.0.0.1', port: PORT, path: p, timeout: 1500 }, (res) => {
      let b = ''; res.setEncoding('utf8'); res.on('data', (d) => { if (b.length < 200000) b += d; }); res.on('end', () => resolve({ status: res.statusCode, body: b }));
    });
    req.on('timeout', () => { req.destroy(); resolve(null); });
    req.on('error', () => resolve(null));
  });
}

console.log('Fenceline doctor (' + REPO + ')');

const major = Number(process.versions.node.split('.')[0]);
if (major >= 18) ok('node ' + process.versions.node); else bad('node ' + process.versions.node + ' is too old', 'install Node 18 or newer');

if (fs.existsSync(path.join(REPO, 'dashboard', 'plugin', 'monitor.mjs'))) ok('this checkout has the dashboard');
else bad('this checkout has no dashboard/ folder (an older branch?)', 'git switch main && git pull');

const list = spawnSync(CLAUDE, ['plugin', 'list'], { encoding: 'utf8', timeout: 20000 });
if (list.error) bad('the claude CLI was not found', 'install Claude Code, then run: make install');
else {
  const out = (list.stdout || '') + (list.stderr || '');
  if (/fenceline/i.test(out)) ok('Fenceline plugin is installed');
  else bad('Fenceline plugin is not installed', 'make install');
  if (/aos-dashboard/i.test(out)) bad('the old standalone aos-dashboard plugin is installed too (it logs every event twice and fights over port ' + PORT + ')', 'make install removes it, or: claude plugin uninstall aos-dashboard@aos-local');
  else ok('no old aos-dashboard plugin');
}

const page = await get('/');
if (!page) {
  bad('nothing answers on 127.0.0.1:' + PORT, 'open a new Claude Code session (it starts the dashboard), or: make start');
} else if (/sheet\.js/.test(page.body)) {
  ok('the Fenceline dashboard answers on http://127.0.0.1:' + PORT);
  const st = await get('/api/state');
  let n = null; try { n = (JSON.parse(st.body).agents || []).length; } catch { /* ignore */ }
  if (n === 0) note('no sessions on the sheet yet: send a prompt in a Claude Code session opened after the install');
  else if (n != null) ok(n + (n === 1 ? ' agent' : ' agents') + ' on the sheet');
} else if (/app\.js|AOS/i.test(page.body)) {
  bad('an old AOS dashboard is answering on port ' + PORT + ', not Fenceline\'s', 'make stop && make start');
} else {
  bad('something else answers on port ' + PORT, 'stop it, or use another port: make start PORT=4328');
}

console.log(fails ? '\n' + fails + (fails === 1 ? ' thing' : ' things') + ' to fix.' : '\nAll good.');
process.exit(fails ? 1 : 0);
