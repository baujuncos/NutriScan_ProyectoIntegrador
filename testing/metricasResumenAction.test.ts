/**
 * NUT-151 — Acción que genera el resumen .md: sólo investigadores, mismos filtros que el dashboard,
 * lee de las dos vistas de métricas y no incluye datos personales.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createSupabaseFromMock } from './supabaseMock';
import { PROMPT_VERSION } from '@/lib/deteccion';

const { getUserMock } = vi.hoisted(() => ({ getUserMock: vi.fn() }));
const sb = createSupabaseFromMock();
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ auth: { getUser: getUserMock }, from: sb.from, rpc: sb.rpc, storage: sb.storage }),
}));

import { generarResumenMdAction } from '@/app/(researcher)/revision-ia/metricas/actions';

const FILTROS = { desde: '2026-10-01', hasta: '2026-10-31', vajilla: 'todas', prompt: 'todas' };

const FILA = {
  alimento: 'Empanada',
  alimento_norm: 'empanada',
  confidence: '0.540',
  gramos_ia: '110.00',
  gramos_usuario: '160.00',
  motivos_revision: ['correccion_peso_grande', 'confianza_baja'],
  estado_revision: 'corregido',
  candidato_ejemplo: true,
  prompt_version: PROMPT_VERSION,
  vajilla_tipo: 'plato_playo',
  created_at: '2026-10-18T12:00:00Z',
  alimento_usuario: 'Empanada (pollo)',
  origen_usuario: 'answered',
  nutricionista_alimento: 'Empanada de pollo',
  nutricionista_gramos: '150.00',
  vajilla_diametro_cm: '26.00',
  angulo_captura_grados: 35,
};

function comoRol(role: string | null) {
  getUserMock.mockResolvedValue({ data: { user: { id: 'inv-1' } } });
  sb.mockTable('profiles', { data: role ? { role } : null, error: null });
}

beforeEach(() => {
  sb.reset();
  getUserMock.mockReset();
});

describe('generarResumenMdAction', () => {
  it('sin sesión o sin rol de investigador no lee ninguna vista', async () => {
    getUserMock.mockResolvedValue({ data: { user: null } });
    expect(await generarResumenMdAction(FILTROS)).toEqual({ error: 'No autenticado' });
    for (const rol of ['deportista_ucc', 'particular', null]) {
      comoRol(rol);
      expect(await generarResumenMdAction(FILTROS)).toEqual({ error: 'Acceso denegado' });
    }
    expect(sb.tablasLlamadas().filter((t) => t.startsWith('v_metricas'))).toHaveLength(0);
  });

  it('genera el .md con las filas de las dos vistas, el prompt actual y un nombre de archivo con fecha', async () => {
    comoRol('investigador');
    sb.mockTable('v_metricas_ia_items', { data: [FILA], error: null });
    sb.mockTable('v_metricas_ia_no_detectados', { data: [{ alimento: 'Puré de papa', alimento_norm: 'pure de papa', prompt_version: PROMPT_VERSION }], error: null });

    const r = await generarResumenMdAction(FILTROS);

    expect(r).toMatchObject({ ok: true, filename: expect.stringMatching(/^nutriscan-resumen-calidad-\d{4}-\d{2}-\d{2}\.md$/) });
    if (!('ok' in r)) throw new Error('esperaba ok');
    expect(sb.tablasLlamadas()).toEqual(expect.arrayContaining(['v_metricas_ia_items', 'v_metricas_ia_no_detectados']));
    expect(r.markdown).toContain(`versión \`${PROMPT_VERSION}\``);
    expect(r.markdown).toContain('Sos el módulo de reconocimiento visual de alimentos de NutriScan'); // el prompt real
    expect(r.markdown).toContain('Puré de papa');
    expect(r.markdown).toContain('Empanada de pollo · 150 g'); // lo que corrigió el equipo (numeric normalizado)
    expect(r.markdown).toContain('Ejemplo para la IA');
  });

  it('aplica los mismos filtros que el dashboard (fecha y vajilla en la base; versión en memoria)', async () => {
    comoRol('investigador');
    sb.mockTable('v_metricas_ia_items', { data: [FILA, { ...FILA, prompt_version: 'otra-version' }], error: null });
    sb.mockTable('v_metricas_ia_no_detectados', { data: [], error: null });

    const r = await generarResumenMdAction({ desde: '2026-10-01', hasta: '2026-10-15', vajilla: 'plato_hondo', prompt: PROMPT_VERSION });

    const filtros = sb.filtrosLlamados().map((f) => [f.metodo, ...f.args]);
    expect(filtros).toContainEqual(['gte', 'created_at', '2026-10-01T00:00:00-03:00']);
    expect(filtros).toContainEqual(['lte', 'created_at', '2026-10-15T23:59:59.999-03:00']);
    expect(sb.eqLlamados().map((f) => f.args)).toContainEqual(['vajilla_tipo', 'plato_hondo']);
    if (!('ok' in r)) throw new Error('esperaba ok');
    expect(r.markdown).toContain('**Versión del prompt:** ' + PROMPT_VERSION);
    expect(r.markdown).toContain('**Detecciones evaluadas:** 1'); // la otra versión queda fuera del resumen...
    expect(r.markdown).toContain('| otra-version |'); // ...pero aparece en la evolución, para poder comparar
  });

  it('normaliza filtros inválidos igual que la URL (no rompe ni consulta con basura)', async () => {
    comoRol('investigador');
    sb.mockTable('v_metricas_ia_items', { data: [], error: null });
    sb.mockTable('v_metricas_ia_no_detectados', { data: [], error: null });
    const r = await generarResumenMdAction({ desde: 'ayer', hasta: '2026-13', vajilla: '; drop table', prompt: '' });
    expect('ok' in r).toBe(true);
    expect(sb.eqLlamados().map((f) => f.args[0])).not.toContain('vajilla_tipo');
  });

  it('si la lectura falla devuelve un error genérico, sin detalles internos', async () => {
    comoRol('investigador');
    sb.mockTable('v_metricas_ia_items', { data: null, error: { message: 'relation secreta no existe', code: 'XX' } });
    sb.mockTable('v_metricas_ia_no_detectados', { data: [], error: null });
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await generarResumenMdAction(FILTROS)).toEqual({ error: 'No se pudieron leer las métricas. Probá de nuevo.' });
    spy.mockRestore();
  });

  it('el archivo no incluye datos personales', async () => {
    comoRol('investigador');
    sb.mockTable('v_metricas_ia_items', { data: [FILA], error: null });
    sb.mockTable('v_metricas_ia_no_detectados', { data: [], error: null });
    const r = await generarResumenMdAction(FILTROS);
    if (!('ok' in r)) throw new Error('esperaba ok');
    expect(r.markdown).not.toMatch(/id_usuario|user_id|imagen_path|revisado_por|https?:\/\/|@ucc/i);
  });
});
