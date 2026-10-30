// Spawning `claude`. STUDY_CLAUDE_BIN swaps in another executable (the tests use a fake one that drives the real hook).
import { spawn, execFileSync } from 'node:child_process';

export const claudeBin = () => process.env.STUDY_CLAUDE_BIN || 'claude';
const viaNode = (bin) => /\.m?js$/.test(bin);

/** Run claude with args in cwd; resolves {code, json, stderr, wall_s, timed_out}. */
export function runClaude(args, { cwd, env, timeoutMs }) {
  return new Promise((resolve) => {
    const t0 = Date.now(); const bin = claudeBin();
    const p = spawn(viaNode(bin) ? process.execPath : bin, viaNode(bin) ? [bin, ...args] : args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = ''; let err = ''; let timedOut = false;
    p.stdout.on('data', (d) => { out += d; }); p.stderr.on('data', (d) => { err += d; });
    const timer = setTimeout(() => { timedOut = true; p.kill('SIGTERM'); }, timeoutMs);
    p.on('close', (code) => { clearTimeout(timer); let json = null; try { json = JSON.parse(out); } catch { /* not json */ } resolve({ code, json, stderr: err.slice(-2000), wall_s: (Date.now() - t0) / 1000, timed_out: timedOut }); });
  });
}

export function claudeVersion() {
  const bin = claudeBin();
  try { return execFileSync(viaNode(bin) ? process.execPath : bin, viaNode(bin) ? [bin, '--version'] : ['--version'], { encoding: 'utf8' }).trim(); } catch { return 'unknown'; }
}
