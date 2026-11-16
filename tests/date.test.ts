import { describe, expect, it } from 'vitest';
import { addMonthsClamped, monthlyDatesThrough, parseMonth, todayInMadrid } from '../src/lib/date.js';

describe('helpers de fechas', () => {
  it('limita el día de recurrencia al último día del mes', () => {
    expect(addMonthsClamped(new Date('2026-01-31T00:00:00.000Z'), 1, 31).toISOString()).toBe('2026-02-28T00:00:00.000Z');
  });

  it('genera una fecha al mes y conserva el día deseado', () => {
    const dates = monthlyDatesThrough(new Date('2026-01-31T00:00:00.000Z'), 31, new Date('2026-03-31T00:00:00.000Z'));
    expect(dates.map((date) => date.toISOString().slice(0, 10))).toEqual(['2026-01-31', '2026-02-28', '2026-03-31']);
  });

  it('normaliza el mes al primer día UTC', () => {
    expect(parseMonth('2026-11').toISOString()).toBe('2026-11-01T00:00:00.000Z');
    expect(() => parseMonth('2026-13')).toThrow();
  });

  it('calcula el día actual según Europe/Madrid', () => {
    expect(todayInMadrid(new Date('2026-03-01T23:30:00.000Z')).toISOString()).toBe('2026-03-02T00:00:00.000Z');
  });
});
