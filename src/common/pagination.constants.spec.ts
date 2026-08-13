import { MAX_PAGE_SIZE, resolvePageSize } from './pagination.constants';

describe('resolvePageSize', () => {
  it('usa 20 como default si no se define', () => {
    expect(resolvePageSize(undefined)).toBe(20);
  });

  it('respeta el valor si es un entero positivo válido', () => {
    expect(resolvePageSize('5')).toBe(5);
  });

  it.each(['abc', '-5', '0', '3.5', ''])(
    'ignora un valor inválido ("%s") y usa el default',
    (invalid) => {
      expect(resolvePageSize(invalid)).toBe(20);
    },
  );

  it('nunca deja que el resultado supere el techo fijo MAX_PAGE_SIZE', () => {
    expect(resolvePageSize('999')).toBe(MAX_PAGE_SIZE);
  });
});
