#!/usr/bin/env node
// Splice the generated tables into docs/results.md between <!-- TABLE:name --> markers, so the doc never drifts from the
// run files.   node evals/build-results.mjs
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tables = { evals: execFileSync('node', [path.join(root, 'evals', 'summarize.mjs')], { encoding: 'utf8' }).trim(), pilot: execFileSync('node', [path.join(root, 'pilot', 'summarize.mjs')], { encoding: 'utf8' }).trim() };
const file = path.join(root, 'docs', 'results.md');
let doc = fs.readFileSync(file, 'utf8');
for (const [k, v] of Object.entries(tables)) doc = doc.replace(new RegExp(`(<!-- TABLE:${k} -->)[\\s\\S]*?(<!-- /TABLE:${k} -->)`), `$1\n${v}\n$2`);
fs.writeFileSync(file, doc);
fs.writeFileSync(path.join(root, 'docs', 'results-table.md'), `${tables.evals}\n`);
fs.writeFileSync(path.join(root, 'docs', 'phase0-pilot-table.md'), `${tables.pilot}\n`);
console.log('docs/results.md tables rebuilt');
