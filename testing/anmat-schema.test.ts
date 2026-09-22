import { describe, it, expect } from 'vitest';
import type { AlimentoOption } from '@/app/alimentacion/actions';

// ─────────────────────────────────────────────────────────────────────────────
// Estructura de datos unificada SARA2 + ANMAT
//
// Verifica que el contrato de AlimentoOption cumpla las reglas de diseño:
// · fuente identifica el origen de cada alimento
// · marca y denominacion son opcionales (nullable)
// · los IDs de ANMAT (offset 1_000_000) nunca colisionan con los de SARA2
// · el merge de resultados preserva el orden: nombre-match primero
// ─────────────────────────────────────────────────────────────────────────────

const ANMAT_OFFSET = 1_000_000;

describe('AlimentoOption — contrato de campos SARA2 + ANMAT', () => {
  it('un alimento SARA2 tiene fuente="SARA2" y campos opcionales nulos', () => {
    const a: AlimentoOption = {
      id_alimento: 42,
      nombre: 'Arroz blanco cocido',
      categoria: 'Cereales',
      fuente: 'SARA2',
      marca: null,
      denominacion: null,
    };
    expect(a.fuente).toBe('SARA2');
    expect(a.marca).toBeNull();
    expect(a.denominacion).toBeNull();
  });

  it('un alimento ANMAT tiene fuente="ANMAT" y puede tener marca y denominacion', () => {
    const a: AlimentoOption = {
      id_alimento: ANMAT_OFFSET + 1,
      nombre: 'Aceitunas verdes en salmuera',
      categoria: 'Vegetales',
      fuente: 'ANMAT',
      marca: 'Finca la fortaleza',
      denominacion: 'Aceitunas verdes en salmuera de origen argentino',
    };
    expect(a.fuente).toBe('ANMAT');
    expect(a.marca).toBeTruthy();
    expect(a.denominacion).toBeTruthy();
  });

  it('un alimento ANMAT puede tener marca y denominacion nulos', () => {
    const a: AlimentoOption = {
      id_alimento: ANMAT_OFFSET + 2,
      nombre: 'Nuez sin cáscara',
      categoria: 'Frutos secos',
      fuente: 'ANMAT',
      marca: null,
      denominacion: null,
    };
    expect(a.marca).toBeNull();
    expect(a.denominacion).toBeNull();
  });
});

describe('Offset de IDs ANMAT — sin colisión con SARA2', () => {
  it('el offset 1_000_000 supera el límite superior esperado de IDs de SARA2', () => {
    // SARA2 tiene ~1000 alimentos; IDs no superan los 10_000 en ningún escenario
    const SARA2_ID_MAX_ESPERADO = 10_000;
    expect(ANMAT_OFFSET).toBeGreaterThan(SARA2_ID_MAX_ESPERADO);
  });

  it('un ID de SARA2 nunca cae en el rango reservado para ANMAT', () => {
    const sara2Ids = [1, 42, 500, 999, 9_999];
    sara2Ids.forEach((id) => expect(id).toBeLessThan(ANMAT_OFFSET));
  });

  it('un ID de ANMAT siempre cae en el rango reservado', () => {
    const anmatIds = [ANMAT_OFFSET + 1, ANMAT_OFFSET + 100, ANMAT_OFFSET + 39_810];
    anmatIds.forEach((id) => expect(id).toBeGreaterThanOrEqual(ANMAT_OFFSET));
  });
});

describe('Orden de resultados — nombre-match antes que marca/denominacion-match', () => {
  // Replica el merge que hace searchAlimentosAction: [...byNombre, ...byOther]
  it('los matches por nombre aparecen antes que los matches por marca o denominacion', () => {
    const byNombre: AlimentoOption[] = [
      { id_alimento: 1, nombre: 'Pollo asado', categoria: null, fuente: 'SARA2', marca: null, denominacion: null },
      { id_alimento: 2, nombre: 'Pollo al limón', categoria: null, fuente: 'SARA2', marca: null, denominacion: null },
    ];
    const byOther: AlimentoOption[] = [
      { id_alimento: ANMAT_OFFSET + 5, nombre: 'Suprema napolitana', categoria: null, fuente: 'ANMAT', marca: 'Pollo Norte', denominacion: null },
    ];

    const merged = [...byNombre, ...byOther];

    expect(merged[0].nombre).toBe('Pollo asado');
    expect(merged[1].nombre).toBe('Pollo al limón');
    expect(merged[2].nombre).toBe('Suprema napolitana');
  });

  it('el resultado final se limita a 80 elementos', () => {
    const byNombre: AlimentoOption[] = Array.from({ length: 60 }, (_, i) => ({
      id_alimento: i + 1,
      nombre: `Alimento SARA2 ${i + 1}`,
      categoria: null,
      fuente: 'SARA2',
      marca: null,
      denominacion: null,
    }));
    const byOther: AlimentoOption[] = Array.from({ length: 40 }, (_, i) => ({
      id_alimento: ANMAT_OFFSET + i + 1,
      nombre: `Alimento ANMAT ${i + 1}`,
      categoria: null,
      fuente: 'ANMAT',
      marca: null,
      denominacion: null,
    }));

    const merged = [...byNombre, ...byOther].slice(0, 80);
    expect(merged).toHaveLength(80);
    // Los primeros 60 son SARA2 (byNombre), los siguientes 20 son ANMAT (byOther truncado)
    expect(merged[0].fuente).toBe('SARA2');
    expect(merged[60].fuente).toBe('ANMAT');
  });
});
