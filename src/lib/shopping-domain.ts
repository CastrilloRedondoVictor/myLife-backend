export const shoppingUnits = ['g', 'kg', 'ml', 'l', 'unit'] as const;
export type ShoppingUnit = typeof shoppingUnits[number];
export type ShoppingDimension = 'WEIGHT' | 'VOLUME' | 'COUNT';

export function normalizeShoppingName(value: string) {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().replace(/\s+/g, ' ').toLocaleLowerCase('es');
}

export function moneyToCents(value: number) {
  return Math.round(value * 100);
}

export function toBaseQuantity(quantity: number, unit: ShoppingUnit, unitsPurchased = 1) {
  const totalQuantity = quantity * unitsPurchased;
  return unit === 'kg' || unit === 'l' ? totalQuantity * 1000 : totalQuantity;
}

export function dimensionForUnit(unit: ShoppingUnit): ShoppingDimension {
  if (unit === 'g' || unit === 'kg') return 'WEIGHT';
  if (unit === 'ml' || unit === 'l') return 'VOLUME';
  return 'COUNT';
}

export function pricePerStandard(amount: number, quantityBase: number, dimension: ShoppingDimension) {
  if (quantityBase <= 0) throw new RangeError('La cantidad debe ser mayor que cero.');
  return dimension === 'COUNT' ? amount / quantityBase : amount * 1000 / quantityBase;
}
