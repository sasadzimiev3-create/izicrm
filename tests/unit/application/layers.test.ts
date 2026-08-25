import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../../src/application');

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? walk(path) : [path];
  });
}

describe('границы слоя application', () => {
  it('сервисы не знают о Telegram: ни grammy, ни ctx, ни шаблонов сообщений', () => {
    const files = walk(ROOT).filter((path) => path.endsWith('.ts'));
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const source = readFileSync(file, 'utf8');
      expect(source, file).not.toMatch(/\bgrammy\b/);
      expect(source, file).not.toMatch(/\bctx\b/);
    }
  });
});
