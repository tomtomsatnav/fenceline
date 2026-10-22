#!/usr/bin/env node
// Record the demo from REAL recorded runs: the map replays each run's hook events at a constant speed (labelled
// "Replay ×N · recorded session" on screen), Playwright records the page, ffmpeg makes the MP4 and the GIF. Adapted from
// dfaith scripts/record-demo.mjs. Nothing on screen is mocked; the speed is the only change.
//   node scripts/record-demo.mjs --run <evals/results/runs NAME> [--run NAME2 ...] [--speed 3] [--format 169|45] [--name demo] [--gif]
// Needs ffmpeg on PATH and playwright (PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs if it is not resolvable).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createServer } from '../viewer/server.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2); const opt = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : d; };
const runs = args.flatMap((a, i) => (args[i - 1] === '--run' ? [a] : [])); if (!runs.length) throw new Error('--run NAME required');
const speed = Number(opt('speed', '3')); const hold = Number(opt('hold', '2500'));
const v45 = opt('format', '169') === '45'; const W = v45 ? 1080 : 1280; const H = v45 ? 1350 : 720;
const name = opt('name', 'demo') + (v45 ? '-4x5' : ''); const out = path.resolve(opt('out', path.join(root, 'docs')));
const pw = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');

const server = createServer({ recordingsDir: path.join(root, 'evals', 'results', 'runs') }); await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fenceline-video-'));
const browser = await pw.chromium.launch();
const ctx = await browser.newContext({ colorScheme: 'light', viewport: { width: W, height: H }, recordVideo: { dir: tmp, size: { width: W, height: H } } });
const page = await ctx.newPage();
const errors = []; page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); }); page.on('pageerror', (e) => errors.push(String(e)));
const tVideo = Date.now(); const marks = [];
for (const run of runs) {
  await page.goto(`http://127.0.0.1:${port}/?recording=${encodeURIComponent(run)}&autoplay=1&speed=${speed}`);
  await page.waitForFunction(() => ['playing', 'done'].includes(document.body.dataset.state), null, { timeout: 30000 });
  marks.push({ run, start: (Date.now() - tVideo) / 1000 });
  await page.waitForFunction(() => document.body.dataset.state === 'done', null, { timeout: 600000 });
  await page.waitForTimeout(hold);
  marks.at(-1).end = (Date.now() - tVideo) / 1000;
}
await ctx.close(); await browser.close(); server.close();
if (errors.length) throw new Error(`console errors during recording:\n${errors.join('\n')}`);
const webm = path.join(tmp, fs.readdirSync(tmp).find((f) => f.endsWith('.webm')));
fs.mkdirSync(out, { recursive: true });
// cut each run's segment (drops page loads between runs), then join; h264 for LinkedIn and GitHub
const parts = marks.map((m, i) => { const p = path.join(tmp, `part${i}.mp4`); execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-ss', (m.start - 0.1).toFixed(3), '-to', m.end.toFixed(3), '-i', webm, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '18', '-r', '30', p]); return p; });
const list = path.join(tmp, 'list.txt'); fs.writeFileSync(list, parts.map((p) => `file '${p}'`).join('\n'));
const mp4 = path.join(out, `${name}.mp4`);
execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', list, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '20', '-movflags', '+faststart', mp4]);
const dur = Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', mp4], { encoding: 'utf8' }).trim());
let gif = null;
if (args.includes('--gif')) {
  gif = path.join(out, `${name}.gif`);
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', mp4, '-vf', `fps=12,scale=${v45 ? 720 : 960}:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=96[p];[b][p]paletteuse=dither=bayer:bayer_scale=4`, '-loop', '0', gif]);
}
fs.writeFileSync(path.join(out, `${name}-source.json`), JSON.stringify({ runs, speed, format: v45 ? '4:5' : '16:9', duration_s: Number(dur.toFixed(1)), recorded_at: new Date().toISOString(),
  note: 'replay of real recorded runs (evals/results/runs/<run>) at a constant speed; nothing on screen is mocked' }, null, 2));
console.log(`wrote ${path.relative(root, mp4)} (${dur.toFixed(1)} s)${gif ? ` and ${path.relative(root, gif)} (${(fs.statSync(gif).size / 1e6).toFixed(1)} MB)` : ''}`);
