import { describe, expect, it } from 'vitest';

import { flowsForDailyUpdate } from '../../../src/application/services/balance-update.service.js';
import { Money } from '../../../src/domain/money/money.js';
import { makeCard, d } from '../finance/fixtures.js';

describe('flowsForDailyUpdate', () => {
  it('П-8: исправление в день создания правит депозит', () => {
    const card = makeCard({ id: 1, createdOn: '2024-08-20' });
    const locf = {
      cardId: card.id,
      amount: Money.from('30000.00'),
      capitalIn: Money.from('30000.00'),
      capitalOut: Money.zero(),
      effectiveDate: d('2024-08-20'),
    };
    const flows = flowsForDailyUpdate(card, locf, Money.from('3000.00'), d('2024-08-20'));
    expect(flows.capitalIn.toFixed()).toBe('3000.00');
    expect(flows.capitalOut.toFixed()).toBe('0.00');
    expect(flows.source).toBe('CORRECTION');
  });

  it('первый ввод за дату — потоки 0/0', () => {
    const card = makeCard({ id: 1, createdOn: '2024-08-01' });
    const locf = {
      cardId: card.id,
      amount: Money.from('80000.00'),
      capitalIn: Money.from('80000.00'),
      capitalOut: Money.zero(),
      effectiveDate: d('2024-08-19'),
    };
    const flows = flowsForDailyUpdate(card, locf, Money.from('85000.00'), d('2024-08-20'));
    expect(flows.capitalIn.toFixed()).toBe('0.00');
    expect(flows.source).toBe('DAILY_UPDATE');
  });

  it('исправление в другой день сохраняет потоки', () => {
    const card = makeCard({ id: 1, createdOn: '2024-08-01' });
    const locf = {
      cardId: card.id,
      amount: Money.from('95000.00'),
      capitalIn: Money.from('10000.00'),
      capitalOut: Money.zero(),
      effectiveDate: d('2024-08-20'),
    };
    const flows = flowsForDailyUpdate(card, locf, Money.from('96000.00'), d('2024-08-20'));
    expect(flows.capitalIn.toFixed()).toBe('10000.00');
    expect(flows.source).toBe('CORRECTION');
  });
});
