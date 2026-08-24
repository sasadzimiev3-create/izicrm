import { describe, expect, it } from 'vitest';

import { isFrozen, isInScope, isWorking } from '../../../src/domain/finance/card-scope.js';
import { d, makeCard } from './fixtures.js';

describe('isInScope', () => {
  const live = makeCard({ id: 1, createdOn: '2024-08-10' });
  const archived = makeCard({
    id: 2,
    createdOn: '2024-08-01',
    archivedOn: '2024-08-15',
    archiveReason: 'WITHDRAWN',
  });

  it('created_on ≤ D, до архивирования', () => {
    expect(isInScope(live, d('2024-08-09'))).toBe(false);
    expect(isInScope(live, d('2024-08-10'))).toBe(true);
    expect(isInScope(live, d('2024-08-20'))).toBe(true);
  });

  it('в день архивирования уже не в scope', () => {
    expect(isInScope(archived, d('2024-08-14'))).toBe(true);
    expect(isInScope(archived, d('2024-08-15'))).toBe(false);
    expect(isInScope(archived, d('2024-08-16'))).toBe(false);
  });
});

describe('isFrozen / isWorking', () => {
  const working = makeCard({ id: 1, createdOn: '2024-08-01' });
  const frozen = makeCard({ id: 2, createdOn: '2024-08-01', frozenOn: '2024-08-20' });
  const archivedFrozenShape = makeCard({
    id: 3,
    createdOn: '2024-08-01',
    archivedOn: '2024-08-10',
    archiveReason: 'WITHDRAWN',
  });

  it('заморозка — текущий флаг, не функция от D', () => {
    expect(isFrozen(working)).toBe(false);
    expect(isFrozen(frozen)).toBe(true);
    expect(isWorking(working, d('2024-08-20'))).toBe(true);
    expect(isWorking(frozen, d('2024-08-20'))).toBe(false);
    expect(isWorking(frozen, d('2024-08-01'))).toBe(false);
    expect(isWorking(archivedFrozenShape, d('2024-08-20'))).toBe(false);
  });
});
