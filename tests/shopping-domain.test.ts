import { describe, expect, it } from 'vitest';
import { dimensionForUnit, moneyToCents, normalizeShoppingName, pricePerStandard, toBaseQuantity } from '../src/lib/shopping-domain.js';

describe('dominio de compras', () => {
  it('normaliza nombres ignorando acentos y espacios', () => {
    expect(normalizeShoppingName('  Queso   Curado Á  ')).toBe('queso curado a');
  });

  it('convierte peso y volumen a unidades base', () => {
    expect(toBaseQuantity(1.25, 'kg')).toBe(1250);
    expect(toBaseQuantity(1.5, 'l')).toBe(1500);
    expect(toBaseQuantity(250, 'g')).toBe(250);
    expect(toBaseQuantity(330, 'ml')).toBe(330);
    expect(toBaseQuantity(250, 'g', 3)).toBe(750);
    expect(toBaseQuantity(0.5, 'l', 2)).toBe(1000);
  });

  it('asigna cada unidad a su dimensión de comparación', () => {
    expect(dimensionForUnit('kg')).toBe('WEIGHT');
    expect(dimensionForUnit('ml')).toBe('VOLUME');
    expect(dimensionForUnit('unit')).toBe('COUNT');
  });

  it('calcula precios por kg, litro o unidad', () => {
    expect(pricePerStandard(3.5, 250, 'WEIGHT')).toBe(14);
    expect(pricePerStandard(1.99, 500, 'VOLUME')).toBe(3.98);
    expect(pricePerStandard(2.5, 2, 'COUNT')).toBe(1.25);
    expect(() => pricePerStandard(1, 0, 'COUNT')).toThrow(RangeError);
  });

  it('convierte importes a céntimos', () => {
    expect(moneyToCents(0.29)).toBe(29);
    expect(moneyToCents(12.34)).toBe(1234);
  });
});
