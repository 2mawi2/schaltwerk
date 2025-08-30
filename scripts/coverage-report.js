#!/usr/bin/env node
 
import fs from 'fs';
import path from 'path';

const summaryPath = path.resolve('coverage', 'coverage-summary.json');
if (!fs.existsSync(summaryPath)) {
  console.error('coverage-summary.json not found. Run `npm run test:frontend:coverage` first.');
  process.exit(1);
}

const raw = JSON.parse(fs.readFileSync(summaryPath, 'utf-8'));

// Flatten file entries and compute uncovered percentages
const entries = Object.entries(raw)
  .filter(([k]) => k !== 'total')
  .map(([filePath, metrics]) => {
    const { lines, statements, functions, branches } = metrics;
    const percent = {
      lines: lines.pct ?? 0,
      statements: statements.pct ?? 0,
      functions: functions.pct ?? 0,
      branches: branches.pct ?? 0,
    };
    const avg = (percent.lines + percent.statements + percent.functions + percent.branches) / 4;
    return {
      file: filePath,
      ...percent,
      avg,
    };
  });

entries.sort((a, b) => a.avg - b.avg);

const format = (n) => `${n.toFixed(1).padStart(5)}%`;

console.log('\nLeast-tested frontend files (lowest average coverage)');
console.log('---------------------------------------------------');
console.log('   Avg   Lines  Stmts  Funcs  Branch  File');
for (const e of entries.slice(0, 25)) {
  console.log(`${format(e.avg)}  ${format(e.lines)}  ${format(e.statements)}  ${format(e.functions)}  ${format(e.branches)}  ${e.file}`);
}

// Also print a quick summary of totals if present
if (raw.total) {
  const t = raw.total;
  const overallAvg = (t.lines.pct + t.statements.pct + t.functions.pct + t.branches.pct) / 4;
  console.log('\nOverall frontend coverage');
  console.log('--------------------------');
  console.log(`Avg: ${format(overallAvg)}  Lines: ${format(t.lines.pct)}  Stmts: ${format(t.statements.pct)}  Funcs: ${format(t.functions.pct)}  Branch: ${format(t.branches.pct)}`);
}
