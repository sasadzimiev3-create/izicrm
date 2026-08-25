import { Decimal } from 'decimal.js';

import { ValidationError } from '../errors.js';

/**
 * Precision 34 — decimal128-класс; ROUND_HALF_UP — единственный режим округления.
 * @see docs/financial-model.md §8
 */
Decimal.set({ precision: 34, rounding: Decimal.ROUND_HALF_UP });

export { Decimal };

/**
 * Деньги: branded-обёртка над `Decimal` со шкалой строго 2.
 * Создаётся только из строки — `Money.from(1.23)` не проходит проверку типов.
 * Промежуточные суммы капитала могут превышать предел ввода `±10^15`.
 *
 * @see docs/financial-model.md §8, docs/requirements.md C-25
 */
export class Money {
  readonly #amount: Decimal;

  private constructor(amount: Decimal) {
    this.#amount = amount;
  }

  /**
   * Создаёт `Money` из десятичной строки. Больше двух знаков после запятой
   * отклоняется, а не округляется.
   *
   * @see docs/financial-model.md §8, docs/requirements.md C-12
   */
  static from(amount: string): Money {
    // Каноническая десятичная запись: не 1e5, не 0x10, не "+1" (C-10).
    if (!/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(amount)) {
      throw new ValidationError('Некорректная сумма');
    }
    let value: Decimal;
    try {
      value = new Decimal(amount);
    } catch {
      throw new ValidationError('Некорректная сумма');
    }
    if (!value.isFinite()) {
      throw new ValidationError('Некорректная сумма');
    }
    if (value.decimalPlaces() > 2) {
      throw new ValidationError('Копейки — не более двух знаков');
    }
    return new Money(value);
  }

  static zero(): Money {
    return Money.from('0.00');
  }

  plus(other: Money): Money {
    return new Money(this.#amount.plus(other.#amount));
  }

  minus(other: Money): Money {
    return new Money(this.#amount.minus(other.#amount));
  }

  negated(): Money {
    return new Money(this.#amount.negated());
  }

  abs(): Money {
    return new Money(this.#amount.abs());
  }

  isZero(): boolean {
    return this.#amount.isZero();
  }

  isNegative(): boolean {
    return this.#amount.isNegative() && !this.#amount.isZero();
  }

  isPositive(): boolean {
    return this.#amount.isPositive() && !this.#amount.isZero();
  }

  eq(other: Money): boolean {
    return this.#amount.eq(other.#amount);
  }

  cmp(other: Money): number {
    return this.#amount.cmp(other.#amount);
  }

  /**
   * Доступ к `Decimal` для деления при расчёте процентов.
   * Результат деления денег на деньги в `Money` не записывается.
   *
   * @see docs/financial-model.md §8
   */
  toDecimal(): Decimal {
    return this.#amount;
  }

  /** Каноническая строка со шкалой 2 — для сравнения и сериализации, не для расчётов. */
  toFixed(): string {
    return this.#amount.toFixed(2);
  }

  toString(): string {
    return this.toFixed();
  }

  toJSON(): string {
    return this.toFixed();
  }
}
