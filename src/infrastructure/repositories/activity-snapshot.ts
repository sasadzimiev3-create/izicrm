import { z } from 'zod';

import type { ActivitySnapshot } from '../../application/dto/activity-stats.js';

const countSchema = z.union([z.string(), z.number()]).transform((value) => String(value));

const snapshotSchema = z.object({
  newStartToday: countSchema,
  newStartWeek: countSchema,
  usedAfterStartToday: countSchema,
  usedAfterStartWeek: countSchema,
  streakToday: countSchema,
  streakWeek: countSchema,
  webToday: countSchema,
  webWeek: countSchema,
  registeredAll: countSchema,
  blockedAll: countSchema,
  withMaterialAll: countSchema,
});

export function parseActivitySnapshot(raw: unknown): ActivitySnapshot {
  return snapshotSchema.parse(raw);
}
