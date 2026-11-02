#!/usr/bin/env node
// Sharp version of record-demo.mjs: the same replay of a REAL recorded run, captured as full-resolution screenshots instead
// of Playwright's screen video (VP8 at a low bitrate, which looks soft). The page replays SLOW times slower than asked and
// each screenshot's real time is recorded; the frames are then laid out at their own times, sped back up by SLOW, and
// resampled to a constant fps. So the speed on screen is exactly --speed, however fast this machine takes screenshots.
// (Faking the page clock does not work here: screenshots make the page run its animation frames on real time.)
// Nothing on screen is mocked; the replay speed is the only change.
//   node scripts/record-hires.mjs --run <evals/results/runs NAME> [--speed 3] [--theme dark|light] [--scale 2] [--fps 15]
//     [--width 1280 --height 720] [--gif-width 1600] [--hold 2500] [--slow 4] [--name demo-loop] [--out docs]
// Writes <name>[-dark].gif and .mp4 (and a -source.json). Needs ffmpeg on PATH and playwright.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createServer } from '../viewer/server.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2); const opt = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : d; };
const run = opt('run'); if (!run) throw new Error('--run NAME required');
const theme = opt('theme', 'dark'), speed = Number(opt('speed', '3')), scale = Number(opt('scale', '2')), fps = Number(opt('fps', '15'));
const W = Number(opt('width', '1280')), H = Number(opt('height', '720')), gifW = Number(opt('gif-width', '1600')), hold = Number(opt('hold', '2500'));
const name = opt('name', 'demo-loop') + (theme === 'dark' ? '-dark' : ''), out = path.resolve(opt('out', path.join(root, 'docs')));
const pwm = await import(process.env.PLAYWRIGHT_MODULE || 'playwright'); const pw = pwm.chromium ? pwm : pwm.default;

const server = createServer({ recordingsDir: path.join(root, 'evals', 'results', 'runs') }); await new Promise((r) => server.listen(0, '127.0.0.1', r));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fenceline-hires-'));
const browser = await pw.chromium.launch();
const ctx = await browser.newContext({ colorScheme: theme, viewport: { width: W, height: H }, deviceScaleFactor: scale });
const page = await ctx.newPage();
const errors = []; page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); }); page.on('pageerror', (e) => errors.push(String(e)));
const SLOW = Number(opt('slow', '4'));
await page.goto(`http://127.0.0.1:${server.address().port}/?recording=${encodeURIComponent(run)}&autoplay=1&speed=${speed / SLOW}&theme=${theme}&hold=1`);
await page.evaluate(() => document.fonts.ready);
await page.waitForFunction(() => ['playing', 'done'].includes(document.body.dataset.state), null, { timeout: 30000 });
// the page plays SLOW times slower so screenshots keep up; the finished video plays at --speed, so the label says that
await page.evaluate(([a, b]) => { const m = document.getElementById('mode'); if (m) for (const n of m.childNodes) if (n.nodeType === 3) n.textContent = n.textContent.replace('×' + a, '×' + b); }, [String(speed / SLOW), String(speed)]);
const times = []; let n = 0;
const shot = async () => { times.push(Date.now()); await page.screenshot({ path: path.join(tmp, `f${String(n++).padStart(5, '0')}.png`) }); };
while ((await page.evaluate(() => document.body.dataset.state)) !== 'done') await shot();
const tDone = Date.now(); while (Date.now() - tDone < hold * SLOW) await shot();
times.push(Date.now());
await ctx.close(); await browser.close(); server.close();
if (errors.length) throw new Error(`console errors during recording:\n${errors.join('\n')}`);

fs.mkdirSync(out, { recursive: true });
// each frame lasts until the next one was taken, divided by SLOW; then resample to a constant fps
const list = path.join(tmp, 'frames.txt');
fs.writeFileSync(list, Array.from({ length: n }, (_, i) => `file '${path.join(tmp, `f${String(i).padStart(5, '0')}.png`)}'\nduration ${((times[i + 1] - times[i]) / 1000 / SLOW).toFixed(4)}`).join('\n') + `\nfile '${path.join(tmp, `f${String(n - 1).padStart(5, '0')}.png`)}'\n`);
const cfr = path.join(tmp, 'cfr.mp4'), mp4 = path.join(out, `${name}.mp4`), gif = path.join(out, `${name}.gif`), pal = path.join(tmp, 'pal.png');
execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', list, '-vf', `fps=${fps}`, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '12', '-preset', 'slow', cfr]);
execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', cfr, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '18', '-preset', 'slow', '-movflags', '+faststart', mp4]);
execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', cfr, '-vf', `scale=${gifW}:-2:flags=lanczos,palettegen=max_colors=128:stats_mode=diff`, pal]);
execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', cfr, '-i', pal, '-lavfi', `scale=${gifW}:-2:flags=lanczos[x];[x][1:v]paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle`, '-loop', '0', gif]);
if (!process.env.KEEP_FRAMES) fs.rmSync(tmp, { recursive: true, force: true }); else console.log('frames in ' + tmp);
const dur = Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', mp4], { encoding: 'utf8' }).trim());
fs.writeFileSync(path.join(out, `${name}-source.json`), JSON.stringify({ runs: [run], speed, theme, format: `${W}x${H} @${scale}x`, fps, duration_s: Number(dur.toFixed(1)), recorded_at: new Date().toISOString(),
  note: 'replay of a real recorded run (evals/results/runs/<run>) at a constant speed, captured frame by frame; nothing on screen is mocked' }, null, 2) + '\n');
console.log(`wrote ${path.relative(root, gif)} (${(fs.statSync(gif).size / 1e6).toFixed(1)} MB, ${gifW}px) and ${path.relative(root, mp4)} (${W * scale}x${H * scale}), ${dur.toFixed(1)} s from ${n} screenshots`);
