import { describe, expect, it } from 'vitest';
import { allocateExpense } from '../src/lib/shared-expense.js';

describe('allocateExpense', () => {
  it('distributes equal-share residual cents deterministically by user ID', () => {
    expect(allocateExpense(100, 'EQUAL', [{ userId: 'b' }, { userId: 'a' }, { userId: 'c' }])).toEqual([
      { userId: 'a', amountCents: 34, shareBasis: null },
      { userId: 'b', amountCents: 33, shareBasis: null },
      { userId: 'c', amountCents: 33, shareBasis: null },
    ]);
  });

  it('allocates percentage residuals by largest remainder and stable ID tie-break', () => {
    expect(allocateExpense(1, 'PERCENTAGE', [
      { userId: 'b', shareBasis: 5_000 },
      { userId: 'a', shareBasis: 5_000 },
    ])).toEqual([
      { userId: 'a', amountCents: 1, shareBasis: 5_000 },
      { userId: 'b', amountCents: 0, shareBasis: 5_000 },
    ]);
  });

  it('validates exact amounts against total cents', () => {
    expect(allocateExpense(500, 'EXACT', [
      { userId: 'member-a', amountCents: 125 },
      { userId: 'member-b', amountCents: 375 },
    ])).toEqual([
      { userId: 'member-a', amountCents: 125, shareBasis: null },
      { userId: 'member-b', amountCents: 375, shareBasis: null },
    ]);
    expect(() => allocateExpense(500, 'EXACT', [{ userId: 'member-a', amountCents: 499 }])).toThrow(/coincidir/);
  });

  it('rejects duplicate participants and percentages that do not total 100%', () => {
    expect(() => allocateExpense(100, 'EQUAL', [{ userId: 'a' }, { userId: 'a' }])).toThrow(/únicos/);
    expect(() => allocateExpense(100, 'PERCENTAGE', [
      { userId: 'a', shareBasis: 4_000 },
      { userId: 'b', shareBasis: 5_000 },
    ])).toThrow(/100/);
  });
});
