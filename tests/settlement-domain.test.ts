import { describe, expect, it } from 'vitest';
import { calculateBalances, calculateExpenseCorrectionAdjustments, suggestTransfers } from '../src/lib/settlement-domain.js';

describe('settlement ledger', () => {
  it('nets shared expenses once and applies partial payments independently', () => {
    const balances = calculateBalances([
      { totalCents: 900, payerUserId: 'alice', shares: [{ userId: 'alice', amountCents: 300 }, { userId: 'bob', amountCents: 600 }] },
    ], [
      { fromUserId: 'bob', toUserId: 'alice', amountCents: 250 },
    ]);
    expect(balances).toEqual([
      { userId: 'alice', balanceCents: 350 },
      { userId: 'bob', balanceCents: -350 },
    ]);
  });

  it('creates stable debtor-to-creditor suggestions', () => {
    expect(suggestTransfers([
      { userId: 'c', balanceCents: 100 },
      { userId: 'b', balanceCents: -80 },
      { userId: 'a', balanceCents: -20 },
    ])).toEqual([
      { fromUserId: 'a', toUserId: 'c', amountCents: 20 },
      { fromUserId: 'b', toUserId: 'c', amountCents: 80 },
    ]);
  });

  it('reconciles an edited or reversed expense without rewriting historical payments', () => {
    const original = {
      payerUserId: 'alice',
      totalCents: 1000,
      shares: [{ userId: 'alice', amountCents: 500 }, { userId: 'bob', amountCents: 500 }],
    };
    const edited = {
      payerUserId: 'alice',
      totalCents: 1200,
      shares: [{ userId: 'alice', amountCents: 600 }, { userId: 'bob', amountCents: 600 }],
    };

    expect(calculateExpenseCorrectionAdjustments(original, edited)).toEqual([
      { userId: 'alice', amountCents: -100 },
      { userId: 'bob', amountCents: 100 },
    ]);
    expect(calculateExpenseCorrectionAdjustments(original, null)).toEqual([
      { userId: 'alice', amountCents: 500 },
      { userId: 'bob', amountCents: -500 },
    ]);
  });
});
