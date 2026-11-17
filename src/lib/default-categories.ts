export const DEFAULT_CATEGORIES = [
  { name: 'Vivienda', type: 'EXPENSE', color: '#b48cff', icon: 'house' },
  { name: 'Alimentación', type: 'EXPENSE', color: '#ffb86b', icon: 'utensils' },
  { name: 'Transporte', type: 'EXPENSE', color: '#77a9ff', icon: 'car' },
  { name: 'Salud', type: 'EXPENSE', color: '#ff8292', icon: 'heart' },
  { name: 'Ocio', type: 'EXPENSE', color: '#ed8bd4', icon: 'sparkles' },
  { name: 'Servicios', type: 'EXPENSE', color: '#57cdb7', icon: 'bolt' },
  { name: 'Otros gastos', type: 'EXPENSE', color: '#7c8da6', icon: 'circle' },
  { name: 'Salario', type: 'INCOME', color: '#57cdb7', icon: 'briefcase' },
  { name: 'Otros ingresos', type: 'INCOME', color: '#77a9ff', icon: 'coins' },
] as const;
