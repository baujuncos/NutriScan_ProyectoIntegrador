/**
 * NUT-151 — Cálculo de las métricas de calidad. Datos de prueba, sin I/O.
 */
import { describe, expect, it } from 'vitest';
import {
  alimentosConVolumen,
  confianzaVsCorreccion,
  cuadranteDe,
  estadoCola,
  evolucionPorPrompt,
  noDetectados,
  rankingAlimentos,
  resumenEvolucion,
  type ItemMetrica,
} from '@/lib/metricasIa';

let n = 0;
const item = (over: Partial<ItemMetrica> = {}): ItemMetrica => ({
  alimento: 'Milanesa',
  alimento_norm: 'milanesa',
  confidence: 0.9,
  gramos_ia: 100,
  gramos_usuario: 100,
  motivos_revision: [],
  estado_revision: null,
  prompt_version: 'nut166-v1',
  created_at: `2026-10-${String(10 + (n++ % 10)).padStart(2, '0')}T12:00:00Z`,
  ...over,
});

describe('rankingAlimentos', () => {
  const milanesas = [
    item({ motivos_revision: ['correccion_peso_grande'] }),
    item({ motivos_revision: ['cambio_alimento'] }),
    item({ motivos_revision: ['item_quitado'], gramos_usuario: null }),
    item({ motivos_revision: ['confianza_baja'] }), // dudosa pero NO corregida
  ];

  it('separa % corrección de nombre, de peso y quitado (no un solo porcentaje)', () => {
    const [m] = rankingAlimentos(milanesas);
    expect(m).toMatchObject({ detecciones: 4, tasaNombre: 0.25, tasaPeso: 0.25, tasaQuitado: 0.25 });
  });

  it('la tasa total cuenta nombre, peso y quitado, pero no la confianza baja sola', () => {
    expect(rankingAlimentos(milanesas)[0].tasaCorreccion).toBe(0.75);
  });

  it('un ítem con dos motivos de corrección cuenta una sola vez en la tasa total', () => {
    const [m] = rankingAlimentos([item({ motivos_revision: ['item_quitado', 'confianza_baja'] }), item()]);
    expect(m.tasaCorreccion).toBe(0.5);
  });

  it('agrupa por nombre normalizado y muestra el nombre más frecuente', () => {
    const [f] = rankingAlimentos([
      item({ alimento: 'Milanesa' }),
      item({ alimento: 'milanesa ' }),
      item({ alimento: 'Milanesa' }),
    ]);
    expect(f).toMatchObject({ alimento: 'Milanesa', detecciones: 3 });
  });

  it('ordena por tasa de corrección y desempata por cantidad de detecciones', () => {
    const r = rankingAlimentos([
      item({ alimento: 'Arroz', alimento_norm: 'arroz' }),
      item({ alimento: 'Flan', alimento_norm: 'flan', motivos_revision: ['cambio_alimento'] }),
      item({ alimento: 'Pan', alimento_norm: 'pan', motivos_revision: ['cambio_alimento'] }),
      item({ alimento: 'Pan', alimento_norm: 'pan' }),
      item({ alimento: 'Pan', alimento_norm: 'pan', motivos_revision: ['cambio_alimento'] }),
    ]);
    expect(r.map((f) => f.alimento)).toEqual(['Flan', 'Pan', 'Arroz']);
  });

  it('con un solo alimento y una sola detección no rompe', () => {
    expect(rankingAlimentos([item()])).toEqual([
      { alimento: 'Milanesa', alimento_norm: 'milanesa', detecciones: 1, tasaNombre: 0, tasaPeso: 0, tasaQuitado: 0, tasaCorreccion: 0 },
    ]);
  });

  it('sin datos devuelve lista vacía', () => {
    expect(rankingAlimentos([])).toEqual([]);
  });
});

describe('confianza vs. corrección — cuadrante', () => {
  it('confianza alta + corrección alta = confiado_equivocado (bordes inclusivos en los umbrales)', () => {
    expect(cuadranteDe(0.75, 0.3)).toBe('confiado_equivocado');
    expect(cuadranteDe(0.95, 0.8)).toBe('confiado_equivocado');
  });

  it('el resto de los cuadrantes', () => {
    expect(cuadranteDe(0.74, 0.3)).toBe('dudoso_equivocado');
    expect(cuadranteDe(0.75, 0.29)).toBe('confiado_ok');
    expect(cuadranteDe(0.5, 0)).toBe('dudoso_ok');
  });

  it('calcula confianza promedio y tasa por alimento y los ubica en su cuadrante', () => {
    const puntos = confianzaVsCorreccion([
      item({ alimento: 'Yogur', alimento_norm: 'yogur', confidence: 0.9, motivos_revision: ['cambio_alimento'] }),
      item({ alimento: 'Yogur', alimento_norm: 'yogur', confidence: 0.8, motivos_revision: ['correccion_peso_grande'] }),
      item({ alimento: 'Arroz', alimento_norm: 'arroz', confidence: 0.9 }),
      item({ alimento: 'Arroz', alimento_norm: 'arroz', confidence: 0.85 }),
    ]);
    const yogur = puntos.find((p) => p.alimento === 'Yogur')!;
    expect(yogur.confianzaPromedio).toBeCloseTo(0.85);
    expect(yogur).toMatchObject({ tasaCorreccion: 1, cuadrante: 'confiado_equivocado', detecciones: 2 });
    expect(puntos.find((p) => p.alimento === 'Arroz')!.cuadrante).toBe('confiado_ok');
  });
});

describe('evolucionPorPrompt', () => {
  const v1 = (g: number | null, over: Partial<ItemMetrica> = {}) =>
    item({ prompt_version: 'nut166-v1', created_at: '2026-10-01T10:00:00Z', gramos_usuario: g, ...over });
  const v2 = (g: number | null, over: Partial<ItemMetrica> = {}) =>
    item({ prompt_version: 'nut166-v2', created_at: '2026-10-15T10:00:00Z', gramos_usuario: g, ...over });

  it('agrupa por versión, ordena por primer uso (aunque entren desordenadas) y calcula el delta', () => {
    const r = evolucionPorPrompt([v2(110), v1(150), v2(110), v1(150)]);
    expect(r.map((v) => v.prompt_version)).toEqual(['nut166-v1', 'nut166-v2']);
    expect(r[0]).toMatchObject({ detecciones: 2, errorPesoPromedio: 0.5, deltaError: null });
    expect(r[1].errorPesoPromedio).toBeCloseTo(0.1);
    expect(r[1].deltaError).toBeCloseTo(-0.4);
    expect(resumenEvolucion(r)).toEqual({ desde: 'nut166-v1', hasta: 'nut166-v2', puntos: -40 });
  });

  it('el error de peso ignora los ítems quitados y los que no tienen peso final', () => {
    const [r] = evolucionPorPrompt([v1(150), v1(null, { motivos_revision: ['item_quitado'] }), v1(null)]);
    expect(r.errorPesoPromedio).toBe(0.5);
    expect(r.detecciones).toBe(3);
  });

  it('la tasa de corrección por versión cuenta nombre, peso y quitado', () => {
    const [r] = evolucionPorPrompt([v1(100, { motivos_revision: ['cambio_alimento'] }), v1(100)]);
    expect(r.tasaCorreccion).toBe(0.5);
  });

  it('con una sola versión devuelve una barra, sin delta ni resumen (no rompe con poco histórico)', () => {
    const r = evolucionPorPrompt([v1(150), v1(120)]);
    expect(r).toHaveLength(1);
    expect(r[0].deltaError).toBeNull();
    expect(resumenEvolucion(r)).toBeNull();
  });

  it('una versión sin datos de peso tiene error null y no rompe el delta de las siguientes', () => {
    const r = evolucionPorPrompt([v1(null, { motivos_revision: ['item_quitado'] }), v2(110)]);
    expect(r[0].errorPesoPromedio).toBeNull();
    expect(r[1].deltaError).toBeNull();
    expect(resumenEvolucion(r)).toBeNull();
  });

  it('se puede acotar a un alimento', () => {
    const r = evolucionPorPrompt([v1(150), v1(150, { alimento_norm: 'arroz', alimento: 'Arroz' })], 'arroz');
    expect(r).toHaveLength(1);
    expect(r[0].detecciones).toBe(1);
  });

  it('sin datos devuelve lista vacía', () => {
    expect(evolucionPorPrompt([])).toEqual([]);
  });

  it('alimentosConVolumen ofrece sólo los que alcanzan el mínimo', () => {
    const items = [...Array(5)].map(() => item()).concat([item({ alimento: 'Flan', alimento_norm: 'flan' })]);
    expect(alimentosConVolumen(items)).toEqual([{ alimento_norm: 'milanesa', alimento: 'Milanesa', detecciones: 5 }]);
    expect(alimentosConVolumen(items, 1)).toHaveLength(2);
  });
});

describe('noDetectados', () => {
  it('cuenta los alimentos agregados a mano por nombre normalizado, de más a menos', () => {
    const r = noDetectados([
      { alimento: 'Puré de papa', alimento_norm: 'pure de papa', prompt_version: 'v1' },
      { alimento: 'Aderezo', alimento_norm: 'aderezo', prompt_version: 'v1' },
      { alimento: 'puré de papa', alimento_norm: 'pure de papa', prompt_version: 'v2' },
    ]);
    expect(r).toEqual([
      { alimento: 'Puré de papa', alimento_norm: 'pure de papa', veces: 2 },
      { alimento: 'Aderezo', alimento_norm: 'aderezo', veces: 1 },
    ]);
  });

  it('es independiente del ranking: no suma detecciones ni tasas', () => {
    const items = [item({ motivos_revision: ['cambio_alimento'] })];
    const antes = rankingAlimentos(items);
    noDetectados([{ alimento: 'Flan', alimento_norm: 'flan', prompt_version: 'v1' }]);
    expect(rankingAlimentos(items)).toEqual(antes);
    expect(antes.map((f) => f.alimento)).not.toContain('Flan');
  });

  it('sin datos devuelve lista vacía', () => {
    expect(noDetectados([])).toEqual([]);
  });
});

describe('estadoCola', () => {
  it('cuenta pendientes, confirmados y corregidos; ignora los que no entraron a la cola', () => {
    expect(
      estadoCola([
        item({ estado_revision: 'pendiente' }),
        item({ estado_revision: 'pendiente' }),
        item({ estado_revision: 'confirmado' }),
        item({ estado_revision: 'corregido' }),
        item({ estado_revision: null }),
      ]),
    ).toEqual({ pendiente: 2, confirmado: 1, corregido: 1 });
  });
});

describe('correcciones del investigador (NUT-149) y métricas', () => {
  // Las métricas agregan lo que hizo el deportista contra lo que detectó la IA (motivos guardados al
  // guardar). Confirmar o corregir en la cola (cualquier combinación de mantener / ingresar) sólo
  // cambia el estado de revisión: no debe alterar ninguna tasa.
  const base = [
    item({ motivos_revision: ['correccion_peso_grande'], gramos_usuario: 150 }), // peso cambiado, nombre mantenido
    item({ motivos_revision: ['cambio_alimento'] }), // nombre cambiado, peso mantenido
    item({ motivos_revision: ['item_quitado'], gramos_usuario: null }),
    item({ motivos_revision: [] }),
  ];

  it('las tasas son las mismas con el ítem pendiente, confirmado o corregido', () => {
    const conEstado = (estado: 'pendiente' | 'confirmado' | 'corregido') => base.map((i) => ({ ...i, estado_revision: estado }));
    const esperado = rankingAlimentos(conEstado('pendiente'));
    expect(rankingAlimentos(conEstado('confirmado'))).toEqual(esperado);
    expect(rankingAlimentos(conEstado('corregido'))).toEqual(esperado);
    expect(confianzaVsCorreccion(conEstado('corregido'))).toEqual(confianzaVsCorreccion(conEstado('pendiente')));
  });

  it('mantener nombre + cambiar peso cuenta sólo como corrección de peso; cambiar nombre + mantener peso, sólo como de nombre', () => {
    const [m] = rankingAlimentos(base);
    expect(m).toMatchObject({ detecciones: 4, tasaPeso: 0.25, tasaNombre: 0.25, tasaQuitado: 0.25, tasaCorreccion: 0.75 });
  });

  it('la cola refleja el avance de la revisión sin tocar las tasas', () => {
    const items = base.map((i, n) => ({ ...i, estado_revision: (['pendiente', 'confirmado', 'corregido', null] as const)[n] }));
    expect(estadoCola(items)).toEqual({ pendiente: 1, confirmado: 1, corregido: 1 });
  });
});
