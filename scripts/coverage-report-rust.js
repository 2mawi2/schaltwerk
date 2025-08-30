#!/usr/bin/env node
 
import fs from 'fs';
import path from 'path';

const lcovPath = path.resolve('coverage', 'rust-lcov.info');
if (!fs.existsSync(lcovPath)) {
  console.error('rust-lcov.info not found. Run `npm run coverage:rust:run` first.');
  process.exit(1);
}

// Very small LCOV parser for file summaries
const content = fs.readFileSync(lcovPath, 'utf-8');
const files = [];
let current = null;
for (const line of content.split(/\r?\n/)) {
  if (line.startsWith('SF:')) {
    if (current) files.push(current);
    current = { file: line.slice(3), linesFound: 0, linesHit: 0, functionsFound: 0, functionsHit: 0, branchesFound: 0, branchesHit: 0 };
  } else if (line.startsWith('LF:') && current) {
    current.linesFound = parseInt(line.slice(3), 10) || 0;
  } else if (line.startsWith('LH:') && current) {
    current.linesHit = parseInt(line.slice(3), 10) || 0;
  } else if (line.startsWith('FNF:') && current) {
    current.functionsFound = parseInt(line.slice(4), 10) || 0;
  } else if (line.startsWith('FNH:') && current) {
    current.functionsHit = parseInt(line.slice(4), 10) || 0;
  } else if (line.startsWith('BRF:') && current) {
    current.branchesFound = parseInt(line.slice(4), 10) || 0;
  } else if (line.startsWith('BRH:') && current) {
    current.branchesHit = parseInt(line.slice(4), 10) || 0;
  } else if (line === 'end_of_record') {
    if (current) files.push(current);
    current = null;
  }
}

const entries = files
  .filter(f => f.file.includes('/src-tauri/src/'))
  .map(f => {
    const pct = (hit, found) => (found ? (hit / found) * 100 : 100);
    const linesPct = pct(f.linesHit, f.linesFound);
    const funcsPct = pct(f.functionsHit, f.functionsFound);
    const branchesPct = pct(f.branchesHit, f.branchesFound);
    const avg = (linesPct + funcsPct + branchesPct) / 3;
    return {
      file: f.file,
      lines: linesPct,
      functions: funcsPct,
      branches: branchesPct,
      avg,
    };
  })
  .sort((a, b) => a.avg - b.avg);

const format = (n) => `${n.toFixed(1).padStart(5)}%`;

console.log('\nLeast-tested Rust files (lowest average coverage)');
console.log('------------------------------------------------');
console.log('   Avg   Lines  Funcs  Branch  File');
for (const e of entries.slice(0, 25)) {
  const rel = e.file.replace(process.cwd() + '/', '');
  console.log(`${format(e.avg)}  ${format(e.lines)}  ${format(e.functions)}  ${format(e.branches)}  ${rel}`);
}
