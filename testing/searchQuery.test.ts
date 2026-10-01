import { describe, it, expect, vi } from 'vitest';
import { buildMarcaDenominacionOr, aplicarFiltroSuplemento, idsRecientesUnicos, campoDeCoincidencia, rangoCoincidencia, CAMPOS_DEFAULT } from '@/app/alimentacion/searchQuery';

describe('buildMarcaDenominacionOr', () => {
  it('arma la clausula OR con marca y denominacion cuando ambos campos están tildados', () => {
    expect(buildMarcaDenominacionOr({ nombre: true, marca: true, denominacion: true }, 'leche'))
      .toBe('marca.ilike.*leche*,denominacion.ilike.*leche*');
  });

  it('arma la clausula solo con marca cuando denominacion está destildado', () => {
    expect(buildMarcaDenominacionOr({ nombre: true, marca: true, denominacion: false }, 'leche'))
      .toBe('marca.ilike.*leche*');
  });

  it('devuelve string vacío cuando ni marca ni denominacion están tildados', () => {
    expect(buildMarcaDenominacionOr({ nombre: true, marca: false, denominacion: false }, 'leche'))
      .toBe('');
  });
});

function fakeBuilder() {
  const builder = {
    or: vi.fn(() => builder),
    not: vi.fn(() => builder),
  };
  return builder;
}

describe('aplicarFiltroSuplemento — fix: mira categoria Y nombre en ambas ramas', () => {
  it('tab Suplementos: filtra por categoria O nombre conteniendo "suplemento"', () => {
    const builder = fakeBuilder();
    aplicarFiltroSuplemento(builder, true);
    expect(builder.or).toHaveBeenCalledWith('categoria.ilike.%suplemento%,nombre.ilike.%suplemento%');
    expect(builder.not).not.toHaveBeenCalled();
  });

  it('otros tabs: excluye por categoria Y por nombre conteniendo "suplemento"', () => {
    const builder = fakeBuilder();
    aplicarFiltroSuplemento(builder, false);
    expect(builder.not).toHaveBeenCalledWith('categoria', 'ilike', '%suplemento%');
    expect(builder.not).toHaveBeenCalledWith('nombre', 'ilike', '%suplemento%');
    expect(builder.or).not.toHaveBeenCalled();
  });
});

describe('campoDeCoincidencia', () => {
  it('detecta coincidencia por nombre', () => {
    expect(campoDeCoincidencia({ nombre: 'Leche entera', marca: null, denominacion: null }, 'leche')).toBe('nombre');
  });

  it('detecta coincidencia por marca cuando el nombre no matchea', () => {
    expect(campoDeCoincidencia({ nombre: 'Yogur', marca: 'La Serenísima', denominacion: null }, 'serenísima')).toBe('marca');
  });

  it('detecta coincidencia por denominación cuando nombre y marca no matchean', () => {
    expect(campoDeCoincidencia({ nombre: 'Producto', marca: null, denominacion: 'Bebida láctea fermentada' }, 'láctea')).toBe('denominacion');
  });

  it('devuelve null si no matchea en ningún campo', () => {
    expect(campoDeCoincidencia({ nombre: 'Agua', marca: null, denominacion: null }, 'zzz')).toBeNull();
  });
});

describe('rangoCoincidencia', () => {
  it('devuelve [inicio, fin) ignorando mayúsculas', () => {
    expect(rangoCoincidencia('Aceitunas verdes', 'ace')).toEqual([0, 3]);
    expect(rangoCoincidencia('Aceitunas verdes', 'VER')).toEqual([10, 13]);
  });

  it('ignora tildes en ambos lados ("mani" resalta "Maní", "maní" resalta "Mani")', () => {
    expect(rangoCoincidencia('Maní tostado', 'mani')).toEqual([0, 4]);
    expect(rangoCoincidencia('Mani tostado', 'maní')).toEqual([0, 4]);
  });

  it('devuelve null sin coincidencia o con query vacía', () => {
    expect(rangoCoincidencia('Agua', 'zzz')).toBeNull();
    expect(rangoCoincidencia('Agua', '')).toBeNull();
  });
});

describe('idsRecientesUnicos', () => {
  it('deduplica preservando el orden de aparición (más reciente primero)', () => {
    expect(idsRecientesUnicos([5, 3, 5, 7, 3], 10)).toEqual([5, 3, 7]);
  });

  it('corta en el límite pedido', () => {
    expect(idsRecientesUnicos([1, 2, 3, 4, 5], 3)).toEqual([1, 2, 3]);
  });

  it('devuelve vacío si la lista de entrada está vacía', () => {
    expect(idsRecientesUnicos([], 8)).toEqual([]);
  });
});
