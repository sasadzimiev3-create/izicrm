import { describe, expect, it } from 'vitest';

import pg from 'pg';

import { adminPool, insertUser, useAppDb } from './harness.js';
import { PG_OID, assertNumericParserIsIdentity, configurePgTypes } from '../../src/infrastructure/db/types.js';

describe('pg type parsers', () => {
  const db = useAppDb();

  it('NUMERIC и BIGINT — строки; DATE — YYYY-MM-DD', async () => {
    configurePgTypes();
    assertNumericParserIsIdentity();

    expect(pg.types.getTypeParser(PG_OID.NUMERIC)('1234.56')).toBe('1234.56');
    expect(pg.types.getTypeParser(PG_OID.INT8)('9223372036854775807')).toBe('9223372036854775807');
    expect(pg.types.getTypeParser(PG_OID.DATE)('2024-08-15')).toBe('2024-08-15');

    const userId = await insertUser(db.pool(), '1700');
    expect(typeof userId).toBe('string');
    expect(userId).toMatch(/^\d+$/);

    const admin = adminPool(db.cluster());
    try {
      const result = await admin.query<{ n: unknown; b: unknown; d: unknown }>(
        `SELECT '1000000000000000.01'::numeric AS n, 42::bigint AS b, DATE '2024-08-15' AS d`,
      );
      const row = result.rows[0];
      expect(row?.n).toBe('1000000000000000.01');
      expect(row?.b).toBe('42');
      expect(row?.d).toBe('2024-08-15');
      expect(typeof row?.n).toBe('string');
      expect(typeof row?.b).toBe('string');
      expect(typeof row?.d).toBe('string');
    } finally {
      await admin.end();
    }
  });
});
