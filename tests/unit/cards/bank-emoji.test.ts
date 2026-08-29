import { describe, expect, it } from 'vitest';

import { detectBankKind, getBankEmoji } from '../../../src/domain/cards/bank-emoji.js';

describe('getBankEmoji', () => {
  it('Сбер и Сбербанк — зелёный, в том числе как подстрока', () => {
    expect(getBankEmoji('Сбер')).toBe('🟢');
    expect(getBankEmoji('Сбербанк')).toBe('🟢');
    expect(getBankEmoji('сБЕР 7121*')).toBe('🟢');
    expect(getBankEmoji('Мой сбербанк')).toBe('🟢');
    expect(getBankEmoji('Sberbank')).toBe('🟢');
  });

  it('ВТБ — синий, в том числе «Втб2312»', () => {
    expect(getBankEmoji('ВТБ')).toBe('🔵');
    expect(getBankEmoji('Втб2312')).toBe('🔵');
    expect(getBankEmoji('втб 0134*')).toBe('🔵');
    expect(getBankEmoji('VTB')).toBe('🔵');
  });

  it('Альфа — красный при любом регистре и дефисе', () => {
    expect(getBankEmoji('Альфа')).toBe('🔴');
    expect(getBankEmoji('Альфа-Банк')).toBe('🔴');
    expect(getBankEmoji('Альфа Банк')).toBe('🔴');
    expect(getBankEmoji('альфа банк')).toBe('🔴');
    expect(getBankEmoji('АЛЬФА')).toBe('🔴');
    expect(getBankEmoji('Alfa-Bank')).toBe('🔴');
  });

  it('Т / Тинькофф / T bank — жёлтый, буква «т» внутри ВТБ не перебивает синий', () => {
    expect(getBankEmoji('Т')).toBe('🟡');
    expect(getBankEmoji('T')).toBe('🟡');
    expect(getBankEmoji('Тинькофф')).toBe('🟡');
    expect(getBankEmoji('Т банк')).toBe('🟡');
    expect(getBankEmoji('Т-Банк')).toBe('🟡');
    expect(getBankEmoji('T bank')).toBe('🟡');
    expect(getBankEmoji('T-Bank')).toBe('🟡');
    expect(getBankEmoji('T123')).toBe('🟡');
    expect(getBankEmoji('Т1234')).toBe('🟡');
    expect(getBankEmoji('tinkoff')).toBe('🟡');
    expect(getBankEmoji('Втб2312')).toBe('🔵');
    expect(getBankEmoji('Тестовая')).not.toBe('🟡');
  });

  it('ОТП / OTP — оранжевый', () => {
    expect(getBankEmoji('ОТП')).toBe('🟠');
    expect(getBankEmoji('ОТП Банк')).toBe('🟠');
    expect(detectBankKind('otp 4455')).toBe('otp');
    expect(detectBankKind('OTP Bank')).toBe('otp');
  });

  it('прочие названия — 💳', () => {
    expect(getBankEmoji('Газпром')).toBe('💳');
    expect(getBankEmoji('Наличные')).toBe('💳');
    expect(getBankEmoji('Райффайзен')).toBe('💳');
    expect(detectBankKind('')).toBe('other');
  });
});
