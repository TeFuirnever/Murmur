import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

const SRC_DIR = path.resolve(__dirname, '../../src');

function* walkJsFiles(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      // Skip frontend-only dirs that never run in main process
      if (['dist', 'components', 'hooks'].includes(entry.name)) continue;
      yield* walkJsFiles(full);
    } else if (entry.isFile() && entry.name.endsWith('.js')) {
      yield full;
    }
  }
}

const REQUIRE_RE = /require\s*\(\s*['"](\.[^'"]+)['"]\s*\)/g;

describe('main process module resolution', () => {
  const errors = [];

  for (const file of walkJsFiles(SRC_DIR)) {
    const source = fs.readFileSync(file, 'utf8');
    const relFile = path.relative(SRC_DIR, file);
    for (const [, reqPath] of source.matchAll(REQUIRE_RE)) {
      const resolvedBase = path.resolve(path.dirname(file), reqPath);
      const candidates = [
        resolvedBase,
        `${resolvedBase}.js`,
        `${resolvedBase}/index.js`,
      ];
      const exists = candidates.some((c) => fs.existsSync(c));
      if (!exists) {
        errors.push(`${relFile}: require('${reqPath}') does not resolve`);
      }
    }
  }

  it('all relative require() calls in src/ resolve to existing files', () => {
    expect(errors, `Unresolved requires:\n${errors.join('\n')}`).toHaveLength(0);
  });
});
