import { describe, expect, it } from 'vitest';

import { flowsForDailyUpdate } from '../../../src/application/services/balance-update.service.js';
import { Money } from '../../../src/domain/money/money.js';
import { cardId } from '../../../src/domain/cards/card.js';
import { d } from '../finance/fixtures.js';

describe('flowsForDailyUpdate', () => {
  it('П-8: обновление в день создания сохраняет депозит, разница — P&L', () => {
    const locf = {
      cardId: cardId(1),
      amount: Money.from('30000.00'),
      capitalIn: Money.from('30000.00'),
      capitalOut: Money.zero(),
      effectiveDate: d('2024-08-20'),
    };
    const flows = flowsForDailyUpdate(locf, d('2024-08-20'));
    expect(flows.capitalIn.toFixed()).toBe('30000.00');
    expect(flows.capitalOut.toFixed()).toBe('0.00');
    expect(flows.source).toBe('CORRECTION');
  });

  it('первый ввод за дату — потоки 0/0', () => {
    const locf = {
      cardId: cardId(1),
      amount: Money.from('80000.00'),
      capitalIn: Money.from('80000.00'),
      capitalOut: Money.zero(),
      effectiveDate: d('2024-08-19'),
    };
    const flows = flowsForDailyUpdate(locf, d('2024-08-20'));
    expect(flows.capitalIn.toFixed()).toBe('0.00');
    expect(flows.source).toBe('DAILY_UPDATE');
  });

  it('исправление в другой день сохраняет потоки', () => {
    const locf = {
      cardId: cardId(1),
      amount: Money.from('95000.00'),
      capitalIn: Money.from('10000.00'),
      capitalOut: Money.zero(),
      effectiveDate: d('2024-08-20'),
    };
    const flows = flowsForDailyUpdate(locf, d('2024-08-20'));
    expect(flows.capitalIn.toFixed()).toBe('10000.00');
    expect(flows.source).toBe('CORRECTION');
  });
});
