/**
 * NUT-228 — Chequeos ESTRUCTURALES de la migración 021 (no ejecutan SQL; el comportamiento se prueba
 * contra un Postgres descartable, ver la entrega). Atrapan que alguien afloje un permiso, agregue una
 * política que abra la conversación o toque confirmar_chat_ia_registro más de lo autorizado.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const leer = (archivo: string) => readFileSync(path.resolve(__dirname, '../supabase', archivo), 'utf8').replace(/\r\n/g, '\n');
const sql021 = leer('021_chat_ia_cola_validacion_nut228.sql');
const consolidado = leer('schema_consolidado.sql');
const sin012y020 = consolidado.slice(0, consolidado.indexOf('-- 021 (NUT-228'));

const normalizar = (s: string) => s.replace(/--.*$/gm, '').replace(/\s+/g, ' ').trim();
const funcion = (sql: string, nombre: string) => {
  const ini = sql.indexOf(`create or replace function public.${nombre}(`);
  expect(ini, `no se encontró ${nombre}`).toBeGreaterThan(-1);
  return sql.slice(ini, sql.indexOf('\n$$;', ini) + 4);
};

describe('021 — es una sección del consolidado y coincide con el archivo suelto', () => {
  it('schema_consolidado.sql contiene la misma sección 021 (la 022 va después)', () => {
    const seccion = sql021.slice(sql021.indexOf('-- 021 (NUT-228'));
    expect(normalizar(consolidado.slice(consolidado.indexOf('-- 021 (NUT-228'), consolidado.indexOf('-- 022 (')))).toBe(normalizar(seccion));
  });
});

describe('021 — confirmar_chat_ia_registro: cambio aditivo', () => {
  const vigente = normalizar(funcion(sin012y020, 'confirmar_chat_ia_registro'));
  const nueva = funcion(sql021, 'confirmar_chat_ia_registro');

  it('quitando las líneas autorizadas, el cuerpo es idéntico al de la 012', () => {
    const bloque1 = `
    -- NUT-230: lo que el chat estimó sin catálogo entra a la cola de validación (como la foto).
    if v_item->>'destino' = 'diario' and v_item->>'macroSource' = 'estimado_ia' and v_item->>'idAlimento' is null then
      if public.chat_encolar_item(v_ri_id, v_item_id) is not null then
        v_encolados := v_encolados + 1;
      end if;
    end if;
`;
    const bloque2 = `  -- NUT-231: la conversación se guarda solo si algún ítem entró a la cola.
  if v_encolados > 0 and jsonb_typeof(p_payload->'conversacion') = 'array' then
    perform public.chat_guardar_conversacion(v_registro, p_payload->'conversacion');
  end if;

`;
    const piezas = [
      ['  v_ri_id        bigint;\n  v_encolados    integer := 0;\n', ''],
      [') returning id_registro_item into v_ri_id;', ');'],
      [bloque1, ''],
      [bloque2, ''],
    ] as const;
    let sinAgregados = nueva;
    for (const [agregado, original] of piezas) {
      expect(sinAgregados.split(agregado).length - 1, `falta o se repite: ${agregado.slice(0, 40)}`).toBe(1);
      sinAgregados = sinAgregados.replace(agregado, original);
    }
    expect(normalizar(sinAgregados)).toBe(vigente);
  });

  it('sigue siendo security invoker (corre con la RLS del usuario)', () => {
    expect(normalizar(nueva)).toMatch(/security invoker/);
    expect(normalizar(nueva)).not.toMatch(/security definer/);
  });

  it('solo llama a las dos funciones nuevas, y solo para estimado_ia sin catálogo del diario', () => {
    expect(nueva).toMatch(/destino' = 'diario' and v_item->>'macroSource' = 'estimado_ia' and v_item->>'idAlimento' is null/);
    expect([...nueva.matchAll(/public\.chat_[a-z_]+\(/g)].map((m) => m[0]).sort()).toEqual(['public.chat_encolar_item(', 'public.chat_guardar_conversacion(']);
  });
});

describe('021 — permisos de las funciones nuevas', () => {
  for (const [nombre, firma] of [['chat_encolar_item', 'bigint, bigint'], ['chat_guardar_conversacion', 'bigint, jsonb']] as const) {
    it(`${nombre}: security definer, search_path fijo, sin public ni anon, solo authenticated`, () => {
      const f = normalizar(funcion(sql021, nombre));
      expect(f).toMatch(/security definer set search_path = ''/);
      const t = normalizar(sql021);
      expect(t).toContain(`revoke all on function public.${nombre}(${firma}) from public, anon;`);
      expect(t).toContain(`grant execute on function public.${nombre}(${firma}) to authenticated;`);
      expect(t).not.toMatch(new RegExp(`grant execute on function public\\.${nombre}[^;]*to[^;]*(anon|public)`));
    });
    it(`${nombre}: valida que el registro pertenezca a auth.uid()`, () => {
      const f = normalizar(funcion(sql021, nombre));
      expect(f).toMatch(/auth\.uid\(\)/);
      expect(f).toMatch(/r\.id_usuario = v_uid/);
      expect(f).toMatch(/NO_AUTORIZADO/);
    });
  }

  it('chat_encolar_item valida también que el ítem del diario sea del usuario y excluye investigador/administrador', () => {
    const f = normalizar(funcion(sql021, 'chat_encolar_item'));
    expect(f).toMatch(/g\.id_usuario = v_uid/);
    expect(f).toMatch(/v_rol in \('investigador', 'administrador'\)/);
    expect(f).toMatch(/macro_source is distinct from 'estimado_ia'/);
    expect(f).toMatch(/exception when others then raise warning/);
  });
});

describe('021 — RLS y conversación', () => {
  it('no crea, cambia ni borra políticas (la conversación hereda las de chat_ia_registros)', () => {
    expect(normalizar(sql021)).not.toMatch(/create policy|alter policy|drop policy/i);
  });

  it('las políticas vigentes de chat_ia_registros solo dejan leer al dueño y a investigador/administrador', () => {
    const lecturas = [...sin012y020.matchAll(/CREATE POLICY "(chat_ia_registros: [^"]+)"\s+ON public\.chat_ia_registros FOR (\w+) TO authenticated\s+(USING|WITH CHECK) \(([^;]*?)\);/g)];
    const select = lecturas.filter((m) => m[2] === 'SELECT').map((m) => normalizar(m[4]));
    expect(select).toEqual(['id_usuario = auth.uid()', "public.get_my_role() IN ('investigador', 'administrador')"]);
  });

  it('nadie recibe UPDATE/DELETE en las tablas del chat ni acceso de anon; la conversación solo la escribe el servidor', () => {
    const t = normalizar(sql021);
    expect(t).not.toMatch(/grant (update|delete|all)/i);
    expect(t).not.toMatch(/\bto anon\b/i);
    expect(t).toMatch(/new\.conversacion is not null then raise exception 'COLUMNA_PROTEGIDA'/);
    expect(t).toMatch(/\(new\.id_pendiente is not null or new\.id_item is not null\) then raise exception 'COLUMNA_PROTEGIDA'/);
  });

  it('la conversación se acota (20 mensajes, 2000 caracteres, 12000 en total) igual que en TypeScript', async () => {
    const t = normalizar(funcion(sql021, 'chat_guardar_conversacion'));
    const { MAX_CONVERSATION_MESSAGES, MAX_CONVERSATION_MESSAGE_CHARS, MAX_CONVERSATION_TOTAL_CHARS } = await import('@/lib/chat/conversation');
    expect(t).toContain(`not between 1 and ${MAX_CONVERSATION_MESSAGES}`);
    expect(t).toContain(`> ${MAX_CONVERSATION_MESSAGE_CHARS}`);
    expect(t).toContain(`> ${MAX_CONVERSATION_TOTAL_CHARS}`);
  });
});

describe('021 — qué entra a la cola (paridad con TypeScript: isQueueable)', () => {
  const f = normalizar(funcion(sql021, 'chat_encolar_item'));
  it('exige estimado_ia, origin ai/edited, destino diario y sin id_alimento', () => {
    expect(f).toMatch(/v_ri\.macro_source is distinct from 'estimado_ia'/);
    expect(f).toMatch(/v_ri\.origin not in \('ai', 'edited'\)/);
    expect(f).toMatch(/v_ri\.destino <> 'diario'/);
    expect(f).toMatch(/v_ri\.id_alimento is not null/);
  });
});

describe('021 — no toca las funciones de la cola ni de la foto', () => {
  it('no redefine ninguna función existente salvo confirmar_chat_ia_registro', () => {
    const nuevas = [...normalizar(sql021).matchAll(/create or replace function public\.([a-z_0-9]+)\(/g)].map((m) => m[1]).sort();
    expect(nuevas).toEqual([
      'chat_encolar_item', 'chat_guardar_conversacion', 'chat_ia_registros_items_proteger_vinculo',
      'chat_ia_registros_proteger_conversacion', 'confirmar_chat_ia_registro',
    ]);
  });
});
