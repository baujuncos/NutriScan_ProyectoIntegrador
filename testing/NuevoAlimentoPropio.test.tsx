/**
 * NUT-119 — Cuándo el alimento propio está listo para crearse (evaluación completa,
 * sin bloqueos y con las advertencias confirmadas).
 */
import { describe, expect, it } from 'vitest';
import { PROPIO_VACIO, propioListo, type PropioForm } from '@/app/(researcher)/validacion/NuevoAlimentoPropio';
import type { VerificacionPropio } from '@/app/(researcher)/validacion/actions';

const COMPLETO: PropioForm = {
  ...PROPIO_VACIO, activo: true, fuente: 'etiqueta_producto', justificacion: 'Etiqueta del envase.',
  reviseFuente: true, valores100: true, busque: true,
};
const LIMPIA: VerificacionPropio = { bloqueos: [], advertencias: [] };

describe('propioListo', () => {
  it('evaluación completa y verificación limpia: listo', () => {
    expect(propioListo(COMPLETO, LIMPIA)).toBe(true);
  });

  it.each([
    ['no está activo', { ...COMPLETO, activo: false }],
    ['sin fuente', { ...COMPLETO, fuente: '' as const }],
    ['justificación corta', { ...COMPLETO, justificacion: ' corta ' }],
    ['falta revisé la fuente', { ...COMPLETO, reviseFuente: false }],
    ['falta valores por 100 g', { ...COMPLETO, valores100: false }],
    ['falta busqué', { ...COMPLETO, busque: false }],
  ])('%s: no está listo', (_n, p) => {
    expect(propioListo(p, LIMPIA)).toBe(false);
  });

  it('sin verificación (todavía verificando o falló) no está listo', () => {
    expect(propioListo(COMPLETO, null)).toBe(false);
  });

  it('un bloqueo lo frena aunque todo lo demás esté completo', () => {
    expect(propioListo(COMPLETO, { bloqueos: [{ codigo: 'DUPLICADO' }], advertencias: [] })).toBe(false);
  });

  it('las advertencias exigen su confirmación', () => {
    const incoherente: VerificacionPropio = { bloqueos: [], advertencias: [{ codigo: 'KCAL_INCOHERENTE' }] };
    expect(propioListo(COMPLETO, incoherente)).toBe(false);
    expect(propioListo({ ...COMPLETO, confirmaIncoherente: true }, incoherente)).toBe(true);
    const similar: VerificacionPropio = { bloqueos: [], advertencias: [{ codigo: 'SIMILAR', similares: [] }] };
    expect(propioListo(COMPLETO, similar)).toBe(false);
    expect(propioListo({ ...COMPLETO, confirmaDistinto: true }, similar)).toBe(true);
  });
});
