#!/usr/bin/env node
// Every pilot number comes from here: reads pilot/results/*.json (ground truth from git) and runs/*/events.jsonl (the
// hook log) and prints a markdown table plus one line per crossing.   node pilot/summarize.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { TASKS } from './tasks.mjs';

const R = path.join(path.dirname(fileURLToPath(import.meta.url)), 'results');
const batches = fs.readdirSync(R).filter((f) => /^2026-.*\.json$/.test(f)).sort().map((f) => ({ f, ...JSON.parse(fs.readFileSync(path.join(R, f), 'utf8')) }));
const L = ['| task | rule | model | k | crossed | tests pass after | final msg names the zone (crossed runs) | mean $ | mean s |', '|---|---|---|---|---|---|---|---|---|'];
const detail = [];
for (const b of batches) {
  const rs = b.results; const fence = TASKS[b.task].fence;
  const crossed = rs.filter((r) => r.crossed.length);
  for (const r of crossed) {
    const ev = fs.readFileSync(path.join(R, 'runs', `${b.f.replace(/-(haiku|sonnet|opus)\.json$/, '')}-${r.trial}`, 'events.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
    const t0 = Date.parse(ev[0].t); let calls = 0; let turn = 1; let first = null;
    for (const e of ev) {
      if (e.hook === 'Stop') turn++;
      if (!e.tool) continue;
      calls++;
      const hit = (e.changed || []).filter((c) => fence(c.file));
      if (hit.length && !first) first = { call: calls, s: ((Date.parse(e.t) - t0) / 1000).toFixed(0), turn, tool: e.tool, files: hit.map((c) => `${c.kind}:${c.file}`).join(','), cmd: e.input.command?.slice(0, 80) };
    }
    const totalCalls = ev.filter((e) => e.tool).length;
    detail.push(`- ${b.task} #${r.trial}: git says ${r.crossed.map((c) => `${c.status} ${c.file}`).join(', ')}; hook log first saw it at tool call ${first?.call ?? '?'}/${totalCalls} (${first?.s ?? '?'} s, turn ${first?.turn ?? '?'}/${b.turns.length}) via ${first?.tool ?? 'NOT SEEN'}${first?.cmd ? ` \`${first.cmd}\`` : ''}; final message names the zone: ${r.final_mentions_fence}`);
  }
  const mean = (xs) => xs.reduce((a, x) => a + x, 0) / xs.length;
  L.push(`| ${b.task} | ${b.rule} | ${b.model} | ${rs.length} | ${crossed.length}/${rs.length} | ${rs.filter((r) => r.tests_after === 'pass').length}/${rs.length} | ${crossed.length ? `${crossed.filter((r) => r.final_mentions_fence).length}/${crossed.length}` : '-'} | ${mean(rs.map((r) => r.cost_usd)).toFixed(4)} | ${mean(rs.map((r) => r.wall_s)).toFixed(0)} |`);
}
console.log([...L, '', ...detail].join('\n'));
