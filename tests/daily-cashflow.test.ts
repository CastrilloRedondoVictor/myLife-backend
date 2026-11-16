import { describe, expect, it } from 'vitest';
import { aggregateDailyCashflow } from '../src/lib/daily-cashflow.js';

describe('flujo diario de caja', () => {
  it('agrupa totales diarios confirmados y ordena las fechas', () => {
    expect(aggregateDailyCashflow([
      { date: new Date('2026-11-03T00:00:00.000Z'), type: 'EXPENSE', status: 'CONFIRMED', amount: 12.35, isFixed: true },
      { date: new Date('2026-11-01T00:00:00.000Z'), type: 'INCOME', status: 'CONFIRMED', amount: 100, isFixed: true },
      { date: new Date('2026-11-03T00:00:00.000Z'), type: 'INCOME', status: 'CONFIRMED', amount: 20.25, isFixed: false },
      { date: new Date('2026-11-03T00:00:00.000Z'), type: 'EXPENSE', status: 'CONFIRMED', amount: 4.1, isFixed: false },
      { date: new Date('2026-11-03T00:00:00.000Z'), type: 'EXPENSE', status: 'PENDING', amount: 90, isFixed: false },
    ])).toEqual([
      { date: '2026-11-01', income: 100, expense: 0, fixedExpense: 0, variableExpense: 0 },
      { date: '2026-11-03', income: 20.25, expense: 16.45, fixedExpense: 12.35, variableExpense: 4.1 },
    ]);
  });

  it('deja fuera estados o tipos no válidos', () => {
    expect(aggregateDailyCashflow([
      { date: new Date('2026-11-01T00:00:00.000Z'), type: 'INCOME', status: 'PENDING', amount: 10, isFixed: false },
      { date: new Date('2026-11-01T00:00:00.000Z'), type: 'TRANSFER', status: 'CONFIRMED', amount: 10, isFixed: false },
    ])).toEqual([]);
  });
});
