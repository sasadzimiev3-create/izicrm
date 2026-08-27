import { describe, expect, it } from 'vitest';

import { cardId } from '../../../src/domain/cards/card.js';
import { parseBusinessDate } from '../../../src/domain/finance/period.js';
import { reduce } from '../../../src/interface/telegram/fsm/transitions.js';
import { IDLE } from '../../../src/interface/telegram/fsm/states.js';

const D = parseBusinessDate;
const C = cardId;

describe('FSM reduce — без Telegram', () => {
  it('UI-05: создание материала без вопроса о типе (C-29)', () => {
    let state = IDLE;
    state = reduce(state, { t: 'CardAdd' }).next;
    expect(state.t).toBe('CardCreateName');
    state = reduce(state, { t: 'NameEntered', name: 'Сбер1' }).next;
    expect(state).toEqual({ t: 'CardCreateBalance', name: 'Сбер1' });
    const created = reduce(state, { t: 'AmountEntered', amount: '10000.00', name: 'Сбер1' });
    expect(created.next).toEqual(IDLE);
    expect(created.effects).toEqual([{ t: 'CreateCard', name: 'Сбер1', amount: '10000.00' }]);
    expect(JSON.stringify(created)).not.toMatch(/PROFIT|CardCreateKind|CardCreateIcon|IconPicked/);
  });

  it('разморозка из меню расхода открывает список', () => {
    const result = reduce(IDLE, { t: 'UnfreezePick' });
    expect(result.next).toEqual({ t: 'UnfreezeSelect' });
    expect(result.effects).toEqual([{ t: 'ShowUnfreezeList' }]);
  });

  it('Назад из списков выбора материала возвращает в меню', () => {
    const unfreeze = reduce({ t: 'UnfreezeSelect' }, { t: 'ExpenseMenu' });
    const freeze = reduce({ t: 'FreezeSelect' }, { t: 'ExpenseMenu' });
    const spend = reduce({ t: 'SpendSelect' }, { t: 'ExpenseMenu' });
    const topup = reduce({ t: 'TopUpSelect' }, { t: 'TopUpMenu' });
    const frozenHome = reduce({ t: 'FrozenCardMenu', cardId: C(1) }, { t: 'Home' });
    expect(unfreeze).toEqual({ next: IDLE, effects: [{ t: 'ShowExpenseMenu' }] });
    expect(freeze).toEqual({ next: IDLE, effects: [{ t: 'ShowExpenseMenu' }] });
    expect(spend).toEqual({ next: IDLE, effects: [{ t: 'ShowExpenseMenu' }] });
    expect(topup).toEqual({ next: IDLE, effects: [{ t: 'ShowTopUpMenu' }] });
    expect(frozenHome.next).toEqual(IDLE);
    expect(frozenHome.effects).toEqual([{ t: 'ShowHome' }]);
  });

  it('дубль названия не продвигает состояние', () => {
    const state = { t: 'CardCreateName' as const };
    const result = reduce(state, { t: 'NameDuplicate' });
    expect(result.next).toEqual(state);
    expect(result.effects).toEqual([{ t: 'NameTaken' }]);
  });

  it('UI-12: невалидный ввод не продвигает index очереди', () => {
    const state = {
      t: 'BalanceUpdateAmount' as const,
      queue: [C(1), C(2)],
      index: 0,
      businessDate: D('2024-08-20'),
      done: [],
    };
    const result = reduce(state, { t: 'AmountInvalid', message: 'Копейки — не более двух знаков' });
    expect(result.next).toEqual(state);
    expect(result.next.t === 'BalanceUpdateAmount' && result.next.index).toBe(0);
  });

  it('UI-07: одна карта и все — одно состояние, разная длина queue', () => {
    const all = reduce(IDLE, {
      t: 'UpdateAll',
      queue: [C(1), C(2)],
      businessDate: D('2024-08-20'),
    });
    const one = reduce(IDLE, { t: 'UpdateOne', cardId: C(1), businessDate: D('2024-08-20') });
    expect(all.next.t).toBe('BalanceUpdateAmount');
    expect(one.next.t).toBe('BalanceUpdateAmount');
    if (all.next.t === 'BalanceUpdateAmount' && one.next.t === 'BalanceUpdateAmount') {
      expect(all.next.queue).toHaveLength(2);
      expect(one.next.queue).toEqual([C(1)]);
      expect(all.next.businessDate).toBe(one.next.businessDate);
    }
  });

  it('пустая очередь «все» не входит в проход', () => {
    const result = reduce(IDLE, { t: 'UpdateAll', queue: [], businessDate: D('2024-08-20') });
    expect(result.next).toEqual(IDLE);
    expect(result.effects).toEqual([{ t: 'NoWorkingCards' }]);
  });

  it('настройки не содержат переименование и стикер', () => {
    const state = reduce(IDLE, { t: 'Settings' });
    expect(state.effects).toEqual([{ t: 'ShowSettings' }]);
    expect(JSON.stringify(state)).not.toMatch(/Rename|IconChange|PromptRename|PromptSetIcon/);
  });

  it('cancel из любого шага возвращает Idle', () => {
    const mid = { t: 'CardCreateBalance' as const, name: 'X' };
    expect(reduce(mid, { t: 'Cancel' }).next).toEqual(IDLE);
  });

  it('архив: нулевой остаток без disposition; ненулевой — спрашивает', () => {
    const confirm = { t: 'ArchiveConfirm' as const, cardId: C(1) };
    const zero = reduce(confirm, {
      t: 'ArchiveYes',
      needsDisposition: false,
      remainder: '0.00',
      name: 'Сбер',
    });
    expect(zero.next).toEqual(IDLE);
    expect(zero.effects[0]).toMatchObject({ t: 'ApplyArchive', reason: 'WITHDRAWN' });

    const rest = reduce(confirm, {
      t: 'ArchiveYes',
      needsDisposition: true,
      remainder: '20000.00',
      name: 'Сбер',
    });
    expect(rest.next.t).toBe('ArchiveDisposition');
  });

  it('UI-08 ветви disposition: вывод, потеря, перевод', () => {
    const state = { t: 'ArchiveDisposition' as const, cardId: C(1), lastBalance: '20000.00' };
    expect(reduce(state, { t: 'Withdrawn' }).effects[0]).toMatchObject({ reason: 'WITHDRAWN' });
    expect(reduce(state, { t: 'Lost' }).effects[0]).toMatchObject({ reason: 'LOST' });
    const transfer = reduce(state, { t: 'Transferred' });
    expect(transfer.next.t).toBe('ArchiveTarget');
    expect(
      reduce({ t: 'ArchiveTarget', cardId: C(1), amount: '20000.00' }, { t: 'ArchiveTarget', cardId: C(2) })
        .effects[0],
    ).toMatchObject({ reason: 'TRANSFERRED', targetCardId: C(2) });
  });

  it('businessDate фиксируется в состоянии обновления', () => {
    const started = reduce(IDLE, {
      t: 'UpdateOne',
      cardId: C(1),
      businessDate: D('2024-08-31'),
    });
    expect(started.next.t === 'BalanceUpdateAmount' && started.next.businessDate).toBe('2024-08-31');
    const next = reduce(started.next, { t: 'AmountEntered', amount: '1.00', name: 'A', previous: '0.00' });
    expect(next.effects.some((effect) => effect.t === 'ApplyUpdate' && effect.businessDate === '2024-08-31')).toBe(
      true,
    );
  });
});
