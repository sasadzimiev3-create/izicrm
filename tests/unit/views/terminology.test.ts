import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../../src/interface/telegram');

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? walk(path) : [path];
  });
}

describe('терминология интерфейса (C-18, FR-6.7)', () => {
  it('в views нет слова «карта»; в именах типов нет Material', () => {
    const files = walk(ROOT).filter((path) => path.endsWith('.ts'));
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const source = readFileSync(file, 'utf8');
      if (file.includes(`${join('views')}`) || file.endsWith(`${join('copy.ts')}`)) {
        expect(source, file).not.toMatch(/карт/i);
      }
      expect(source, file).not.toMatch(/\bMaterial\b/);
    }
  });
});
