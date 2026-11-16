export function parseMonth(value: string | undefined, now = new Date()): Date {
  if (!value) return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  if (!/^\d{4}-\d{2}$/.test(value)) throw new Error('El mes debe tener formato YYYY-MM.');
  const [year, month] = value.split('-').map(Number);
  if (month < 1 || month > 12) throw new Error('El mes indicado no es válido.');
  return new Date(Date.UTC(year, month - 1, 1));
}

export function todayInMadrid(now = new Date()): Date {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Madrid',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  return new Date(Date.UTC(Number(values.year), Number(values.month) - 1, Number(values.day)));
}

export function addMonthsClamped(date: Date, count: number, preferredDay = date.getUTCDate()): Date {
  const firstOfTargetMonth = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + count, 1));
  const lastDay = new Date(Date.UTC(firstOfTargetMonth.getUTCFullYear(), firstOfTargetMonth.getUTCMonth() + 1, 0)).getUTCDate();
  return new Date(Date.UTC(firstOfTargetMonth.getUTCFullYear(), firstOfTargetMonth.getUTCMonth(), Math.min(preferredDay, lastDay)));
}

export function monthlyDatesThrough(startDate: Date, scheduleDay: number, today = new Date()): Date[] {
  const dates: Date[] = [];
  const start = new Date(Date.UTC(startDate.getUTCFullYear(), startDate.getUTCMonth(), scheduleDay));
  const end = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
  for (let cursor = start; cursor <= end; cursor = addMonthsClamped(cursor, 1, scheduleDay)) dates.push(cursor);
  return dates;
}
