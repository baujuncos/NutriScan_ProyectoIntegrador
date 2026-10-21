/**
 * NUT-192 — Paridad ESTRUCTURAL entre registrar_guardado_deteccion (013, IA) y
 * registrar_item_manual (020, carga manual): ante el mismo estado de la cola
 * (validado / descartado / pendiente) ambos deben dar el mismo origen_macros y
 * usar los mismos valores.
 *
 * OJO: no ejecuta SQL (no hay Postgres en el entorno de tests). Compara el
 * texto de las dos funciones, así que atrapa que una se desvíe de la otra al
 * editarla, pero no reemplaza correr la migración contra una base real (ver el
 * checklist de prueba manual en el PR).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const leer = (archivo: string) => readFileSync(path.resolve(__dirname, '../supabase', archivo), 'utf8');
const sql013 = leer('013_matching_macros_validacion_nut119.sql');
const sql020 = leer('020_alimento_personalizado_cola_nut192.sql');
const consolidado = leer('schema_consolidado.sql');

/** Sin comentarios SQL y con espacios colapsados. */
const normalizar = (s: string) => s.replace(/--.*$/gm, '').replace(/\s+/g, ' ').trim();

/** Cuerpo de la función `nombre` (del `create or replace function` al `$$;` de cierre). */
function cuerpo(sql: string, nombre: string): string {
  const ini = sql.indexOf(`create or replace function public.${nombre}(`);
  expect(ini, `no se encontró ${nombre}`).toBeGreaterThan(-1);
  const fin = sql.indexOf('\n$$;', ini);
  return normalizar(sql.slice(ini, fin));
}

const ia = cuerpo(sql013, 'registrar_guardado_deteccion');
const manual = cuerpo(sql020, 'registrar_item_manual');

const rama = (texto: string, desde: RegExp): string => {
  const m = texto.match(desde);
  expect(m, `no se encontró la rama ${desde}`).not.toBeNull();
  return m![1].trim();
};

describe('paridad registrar_guardado_deteccion (IA) vs registrar_item_manual (manual)', () => {
  it('ambas deduplican por nombre normalizado con ON CONFLICT DO NOTHING y toman la fila con FOR UPDATE', () => {
    for (const fn of [ia, manual]) {
      expect(fn).toContain('on conflict (nombre_normalizado) do nothing');
      expect(fn).toMatch(/from public\.alimentos_pendientes_validacion c where c\.nombre_normalizado = v_norm for update/);
    }
  });

  it('estado validado: mismo origen_macros, mismo alimento vinculado y mismos valores finales', () => {
    const re = /if v_cola\.estado = 'validado' then (.*?) elsif v_cola\.estado = 'descartado' then/;
    const rIa = rama(ia, re);
    const rManual = rama(manual, re);
    expect(rManual).toBe(rIa);
    expect(rManual).toContain("v_origen := 'validado'");
    expect(rManual).toContain('v_id_alim := v_cola.id_alimento_vinculado');
    for (const c of ['kcal', 'proteinas', 'grasas', 'carbs']) expect(rManual).toContain(`final_${c}_100g`);
  });

  it('estado descartado: mismo origen_macros y sin valores (el ítem hereda el descarte, no reabre la cola)', () => {
    const re = /elsif v_cola\.estado = 'descartado' then (.*?) else /;
    expect(rama(ia, re)).toContain("v_origen := 'descartado'");
    expect(rama(ia, re)).toContain('v_k := null');
    const rManual = rama(manual, re);
    expect(rManual).toContain("v_origen := 'descartado'");
    expect(rManual).not.toMatch(/v_k := (?!null)/);
    // En la manual los valores arrancan en NULL (declaración).
    expect(manual).toMatch(/v_k numeric := null/);
  });

  it("estado pendiente: mismo origen_macros 'pendiente'; la manual no tiene valores de Gemini (snapshot NULL)", () => {
    expect(ia).toContain("else v_origen := 'pendiente'");
    expect(manual).toContain("else v_origen := 'pendiente'");
    expect(manual).not.toContain('gemini_');
  });

  it('con id_alimento el snapshot es el del catálogo en ambas', () => {
    const lectura = /select a\.kcal_100g, a\.proteinas_100g, a\.grasas_100g, a\.carbs_100g into v_k, v_p, v_g, v_c from public\.alimentos a where a\.id_alimento = v_id_alim/;
    expect(ia).toMatch(lectura);
    expect(manual).toMatch(lectura);
  });

  it('el ítem manual guarda el vínculo con la cola (id_pendiente) y origen_macros; nunca id_guardado_item', () => {
    expect(manual).toMatch(/insert into public\.items \([^)]*id_pendiente \)/);
    expect(manual).toMatch(/insert into public\.items \([^)]*origen_macros/);
    expect(manual).not.toContain('id_guardado_item');
  });

  it('investigador y administrador no alimentan la cola (conservan el comportamiento anterior)', () => {
    expect(manual).toContain("v_rol not in ('investigador', 'administrador')");
    expect(manual).toMatch(/v_encola := v_rol is not null/);
  });

  it('una entrada creada por IA y pedida a mano conserva su origen: el insert solo fija origen en el alta (on conflict do nothing)', () => {
    expect(manual).toMatch(/insert into public\.alimentos_pendientes_validacion \(nombre_original, nombre_normalizado, origen\) values \(v_nombre, v_norm, 'manual'\) on conflict/);
  });

  it('locks en el orden del repo: la fila de la cola se toma antes de insertar ingestas e ítems', () => {
    expect(manual.indexOf('for update')).toBeGreaterThan(-1);
    expect(manual.indexOf('for update')).toBeLessThan(manual.indexOf('insert into public.ingestas'));
    expect(manual.indexOf('insert into public.ingestas')).toBeLessThan(manual.indexOf('insert into public.items'));
  });

  it('la RPC manual es solo para service role', () => {
    const grants = normalizar(sql020);
    expect(grants).toContain('revoke all on function public.registrar_item_manual(uuid, date, text, text, text, numeric) from public, anon, authenticated');
    expect(grants).toContain('grant execute on function public.registrar_item_manual(uuid, date, text, text, text, numeric) to service_role');
  });

  it('referencia cruzada en ambas funciones sin tocar el cuerpo de la RPC de IA', () => {
    expect(sql020).toMatch(/comment on function public\.registrar_item_manual[^;]*registrar_guardado_deteccion/);
    expect(sql020).toMatch(/comment on function public\.registrar_guardado_deteccion[^;]*registrar_item_manual/);
    expect(sql013).not.toContain('registrar_item_manual');
  });
});

describe('migración 020', () => {
  it('items.id_pendiente está en la lista de columnas protegidas (INSERT y UPDATE)', () => {
    const f = cuerpo(sql020, 'items_proteger_origen');
    expect(f).toMatch(/num_nonnulls\([^)]*new\.id_pendiente\) > 0/);
    expect(f).toMatch(/old\.id_pendiente\)/);
  });

  it('la FK de items.id_pendiente es ON DELETE SET NULL', () => {
    expect(normalizar(sql020)).toContain('foreign key (id_pendiente) references public.alimentos_pendientes_validacion(id_pendiente) on delete set null');
  });

  it('usuarios_distintos une ambas fuentes con UNION (sin doble conteo) y ocurrencias conserva su semántica', () => {
    const vista = normalizar(sql020.slice(sql020.indexOf('create view public.v_alimentos_pendientes')));
    expect(vista).toContain('from public.detecciones_guardados_items gi where gi.id_pendiente = p.id_pendiente ) o');
    expect(vista).toContain('join public.detecciones_guardados g on g.id_guardado = gi.id_guardado');
    expect(vista).toContain('join public.ingestas ing on ing.id_ingesta = it.id_ingesta');
    expect(vista).toMatch(/\bunion\b(?! all)/);
  });

  it('la sección 020 está repetida tal cual en schema_consolidado.sql', () => {
    const seccion = sql020.slice(sql020.indexOf('-- 020 (NUT-192/NUT-193)'));
    expect(normalizar(consolidado)).toContain(normalizar(seccion));
  });
});
