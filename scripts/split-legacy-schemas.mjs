import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const sourcePath = join(root, 'packages/schemas/src/index.ts');
const outDir = join(root, 'packages/schemas/src/contracts');

const source = readFileSync(sourcePath, 'utf8');
const lines = source.split('\n');
if (!lines[0]?.startsWith("import { z } from 'zod';")) {
  throw new Error('Unexpected schemas/src/index.ts header.');
}

const targets = [
  { file: 'foundation.ts', end: 611 },
  { file: 'campaign-ids.ts', end: 1400 },
  { file: 'campaign-bundle.ts', end: 2027 },
  { file: 'labels-search.ts', end: 2703 },
  { file: 'entity-core.ts', end: 3400 },
  { file: 'entity-graph.ts', end: 4071 },
  { file: 'control-surface-a.ts', end: 4900 },
  { file: 'control-surface-b.ts', end: 5742 },
  { file: 'launches.ts', end: 6240 },
  { file: 'realizable-value.ts', end: 6763 },
  { file: 'claims-a.ts', end: 7520 },
  { file: 'claims-b.ts', end: 8279 },
  { file: 'capture-actions.ts', end: Number.POSITIVE_INFINITY },
];

function scanTopLevel(text) {
  const exportLines = [];
  let quote = null;
  let escaped = false;
  let lineComment = false;
  let blockComment = false;
  let depth = 0;
  let line = 1;
  let lineStart = 0;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    const next = text[i + 1];
    if (ch === '\n') {
      line += 1;
      lineStart = i + 1;
      lineComment = false;
      continue;
    }
    if (lineComment) continue;
    if (blockComment) {
      if (ch === '*' && next === '/') {
        blockComment = false;
        i += 1;
      }
      continue;
    }
    if (quote) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (ch === '\\' && quote !== "'") {
        escaped = true;
        continue;
      }
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '/' && next === '/') {
      lineComment = true;
      i += 1;
      continue;
    }
    if (ch === '/' && next === '*') {
      blockComment = true;
      i += 1;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') {
      quote = ch;
      continue;
    }
    if (ch === '{') {
      depth += 1;
      continue;
    }
    if (ch === '}') {
      depth = Math.max(0, depth - 1);
      continue;
    }
    if (depth === 0 && i === lineStart) {
      const rest = text.slice(
        i,
        text.indexOf('\n', i) === -1 ? text.length : text.indexOf('\n', i),
      );
      if (/^(export\s+(const|type|function|class|interface)|const\s+\w+)/.test(rest.trimStart())) {
        exportLines.push(line);
      }
    }
  }
  return exportLines;
}

const exportLines = scanTopLevel(source);

function snapEnd(desiredExclusive) {
  if (!Number.isFinite(desiredExclusive) || desiredExclusive >= lines.length + 1) {
    return lines.length + 1;
  }
  return exportLines.find((line) => line >= desiredExclusive) ?? desiredExclusive;
}

let start = 2;
const chunks = [];
for (const target of targets) {
  const end = Math.max(snapEnd(target.end), start + 1);
  chunks.push({ file: target.file, start, end });
  start = end;
}
chunks[chunks.length - 1].end = lines.length + 1;

function collectNames(chunkLines) {
  const names = [];
  for (const line of chunkLines) {
    const match = line.match(/^export (?:const|function|class|type|interface) (\w+)/);
    if (match?.[1]) names.push(match[1]);
  }
  return names;
}

function rewritePrev(sourceText, names) {
  if (names.length === 0) return sourceText;
  const nameSet = new Set(names);
  let output = '';
  let quote = null;
  let escaped = false;
  let lineComment = false;
  let blockComment = false;
  let i = 0;
  while (i < sourceText.length) {
    const ch = sourceText[i];
    const next = sourceText[i + 1];
    if (lineComment) {
      output += ch;
      if (ch === '\n') lineComment = false;
      i += 1;
      continue;
    }
    if (blockComment) {
      output += ch;
      if (ch === '*' && next === '/') {
        output += next;
        blockComment = false;
        i += 2;
        continue;
      }
      i += 1;
      continue;
    }
    if (quote) {
      output += ch;
      if (escaped) escaped = false;
      else if (ch === '\\' && quote !== "'") escaped = true;
      else if (ch === quote) quote = null;
      i += 1;
      continue;
    }
    if (ch === '/' && next === '/') {
      output += '//';
      lineComment = true;
      i += 2;
      continue;
    }
    if (ch === '/' && next === '*') {
      output += '/*';
      blockComment = true;
      i += 2;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') {
      quote = ch;
      output += ch;
      i += 1;
      continue;
    }
    if (/[A-Za-z_]/.test(ch)) {
      let end = i + 1;
      while (end < sourceText.length && /[A-Za-z0-9_]/.test(sourceText[end] ?? '')) end += 1;
      const name = sourceText.slice(i, end);
      const before = sourceText.slice(Math.max(0, i - 96), i);
      const isDefinition =
        /(export\s+(?:const|type|function|class|interface)|(?:^|\n)const)\s*$/.test(before);
      const isProperty = /(?:\?|\.)\s*$/.test(before);
      output += !isDefinition && !isProperty && nameSet.has(name) ? `Prev.${name}` : name;
      i = end;
      continue;
    }
    output += ch;
    i += 1;
  }
  return output;
}

mkdirSync(outDir, { recursive: true });
let previousValues = [];
let previousFile;
const written = [];

for (const chunk of chunks) {
  const chunkLines = lines.slice(chunk.start - 1, chunk.end - 1);
  while (chunkLines[0] === '') chunkLines.shift();
  while (chunkLines.length > 0 && chunkLines[chunkLines.length - 1] === '') chunkLines.pop();
  const body = chunkLines.join('\n');
  const rewritten = previousFile ? rewritePrev(body, previousValues) : body;
  const moduleName = previousFile?.replace(/\.ts$/, '.js');
  const header = previousFile
    ? `import { z } from 'zod';\nimport * as Prev from './${moduleName}';\nexport * from './${moduleName}';\n\n`
    : `import { z } from 'zod';\n\n`;
  writeFileSync(join(outDir, chunk.file), `${header}${rewritten}\n`, 'utf8');
  const lineCount = `${header}${rewritten}\n`.split('\n').length;
  written.push({
    file: chunk.file,
    start: chunk.start,
    end: chunk.end,
    lines: lineCount,
  });
  previousValues = [...previousValues, ...collectNames(chunkLines)];
  previousFile = chunk.file;
}

const last = written[written.length - 1];
if (last === undefined) throw new Error('No schema chunks were written.');
const index = `export * from './contracts/${last.file.replace(/\.ts$/, '.js')}';\nexport * from './market-structure/index.js';\n`;
writeFileSync(sourcePath, index, 'utf8');
writeFileSync(join(outDir, 'split-manifest.json'), `${JSON.stringify({ written }, null, 2)}\n`);
console.log(JSON.stringify(written, null, 2));
