export type AllocationMode = 'EQUAL' | 'PERCENTAGE' | 'EXACT';

export interface AllocationInput {
  userId: string;
  shareBasis?: number;
  amountCents?: number;
}

export interface AllocationResult {
  userId: string;
  amountCents: number;
  shareBasis: number | null;
}

const MAX_TOTAL_CENTS = 999_999_999_999;
const PERCENTAGE_BASIS = 10_000;

function validateCommon(totalCents: number, participants: AllocationInput[]) {
  if (!Number.isSafeInteger(totalCents) || totalCents <= 0 || totalCents > MAX_TOTAL_CENTS) {
    throw new RangeError('El gasto debe ser un importe positivo expresado en céntimos.');
  }
  if (participants.length === 0 || participants.length > 100) {
    throw new RangeError('Selecciona entre 1 y 100 participantes.');
  }
  const userIds = participants.map(({ userId }) => userId);
  if (userIds.some((userId) => !userId) || new Set(userIds).size !== userIds.length) {
    throw new RangeError('Los participantes deben ser únicos y válidos.');
  }
}

export function allocateExpense(totalCents: number, mode: AllocationMode, participants: AllocationInput[]): AllocationResult[] {
  validateCommon(totalCents, participants);
  const sorted = [...participants].sort((a, b) => a.userId.localeCompare(b.userId));

  if (mode === 'EQUAL') {
    if (participants.some(({ amountCents, shareBasis }) => amountCents !== undefined || shareBasis !== undefined)) {
      throw new RangeError('El reparto igualitario no admite importes ni porcentajes individuales.');
    }
    const base = Math.floor(totalCents / sorted.length);
    let residual = totalCents - base * sorted.length;
    return sorted.map(({ userId }) => ({ userId, amountCents: base + (residual-- > 0 ? 1 : 0), shareBasis: null }));
  }

  if (mode === 'PERCENTAGE') {
    if (sorted.some(({ shareBasis, amountCents }) => !Number.isInteger(shareBasis) || shareBasis! <= 0 || shareBasis! > PERCENTAGE_BASIS || amountCents !== undefined)) {
      throw new RangeError('Cada participante necesita un porcentaje positivo en puntos básicos.');
    }
    const basisSum = sorted.reduce((sum, participant) => sum + participant.shareBasis!, 0);
    if (basisSum !== PERCENTAGE_BASIS) throw new RangeError('Los porcentajes deben sumar exactamente 100 %.');

    const shares = sorted.map(({ userId, shareBasis }) => {
      const numerator = BigInt(totalCents) * BigInt(shareBasis!);
      return {
        userId,
        shareBasis: shareBasis!,
        amountCents: Number(numerator / BigInt(PERCENTAGE_BASIS)),
        remainder: Number(numerator % BigInt(PERCENTAGE_BASIS)),
      };
    });
    const residual = totalCents - shares.reduce((sum, share) => sum + share.amountCents, 0);
    const byRemainder = [...shares].sort((a, b) => b.remainder - a.remainder || a.userId.localeCompare(b.userId));
    const extraCentRecipients = new Set(byRemainder.slice(0, residual).map(({ userId }) => userId));
    return shares.map(({ userId, shareBasis, amountCents }) => ({
      userId,
      amountCents: amountCents + (extraCentRecipients.has(userId) ? 1 : 0),
      shareBasis,
    }));
  }

  if (sorted.some(({ amountCents, shareBasis }) => !Number.isSafeInteger(amountCents) || amountCents! <= 0 || shareBasis !== undefined)) {
    throw new RangeError('Cada participante necesita un importe positivo expresado en céntimos.');
  }
  const exactTotal = sorted.reduce((sum, participant) => sum + BigInt(participant.amountCents!), 0n);
  if (exactTotal !== BigInt(totalCents)) throw new RangeError('La suma de los importes individuales debe coincidir con el gasto.');
  return sorted.map(({ userId, amountCents }) => ({ userId, amountCents: amountCents!, shareBasis: null }));
}
