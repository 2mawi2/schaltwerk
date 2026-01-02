#!/usr/bin/env bun

import { readFileSync, writeFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

function getAllFiles(dir, fileList = []) {
  const files = readdirSync(dir);

  for (const file of files) {
    const filePath = join(dir, file);
    const stat = statSync(filePath);

    if (stat.isDirectory()) {
      if (file !== 'node_modules' && file !== '.git') {
        getAllFiles(filePath, fileList);
      }
    } else if (file.endsWith('.ts') || file.endsWith('.tsx')) {
      fileList.push(filePath);
    }
  }

  return fileList;
}

const files = getAllFiles('src');

let filesModified = 0;
let importsRemoved = 0;

for (const file of files) {
  const content = readFileSync(file, 'utf-8');
  const lines = content.split('\n');

  let modified = false;
  const newLines = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Check if this line imports theme
    const themeImportMatch = line.match(/^import\s*{\s*([^}]+)\s*}\s*from\s*['"]([^'"]*theme[^'"]*)['"]/);

    if (themeImportMatch) {
      const imports = themeImportMatch[1].split(',').map(s => s.trim());
      const importPath = themeImportMatch[2];

      // Check if 'theme' is in the imports
      const hasTheme = imports.some(imp => imp === 'theme');

      if (hasTheme) {
        // Check if theme is actually used in the file (excluding the import line itself)
        const restOfFile = lines.slice(i + 1).join('\n');
        const themeUsed = /\btheme\b/.test(restOfFile);

        if (!themeUsed) {
          // Remove 'theme' from imports
          const remainingImports = imports.filter(imp => imp !== 'theme');

          if (remainingImports.length === 0) {
            // Skip this line entirely (remove the import)
            modified = true;
            importsRemoved++;
            continue;
          } else {
            // Keep other imports
            newLines.push(`import { ${remainingImports.join(', ')} } from '${importPath}'`);
            modified = true;
            importsRemoved++;
            continue;
          }
        }
      }
    }

    newLines.push(line);
  }

  if (modified) {
    writeFileSync(file, newLines.join('\n'));
    filesModified++;
    console.log(`✓ ${file}`);
  }
}

console.log(`\nSummary:`);
console.log(`- Files modified: ${filesModified}`);
console.log(`- Theme imports removed: ${importsRemoved}`);
