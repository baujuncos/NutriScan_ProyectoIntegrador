'use server';

/**
 * Acciones de Antropometrías (NUT-235). Toda acción arranca con
 * `clienteInvestigador()`; además de ese chequeo, la base aplica RLS
 * (supabase/022_antropometria_nut247.sql).
 */

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { ErrorAntropometria, variablesFaltantes } from '@/lib/antropometria';
import { todayAR } from '@/lib/date';
import { parseDateLocal } from '@/lib/dates';
import { clienteInvestigador, type SupabaseServidor } from '@/lib/researcher/clienteInvestigador';
import { cargarMedicion, cargarMediciones, cargarPaciente } from '@/lib/researcher/antropometria/datos';
import { decidirMasaOsea, esLaMedicionMasAntigua, sanearSeries } from '@/lib/researcher/antropometria/guardado';
import {
  borrarObjetos,
  cargarFilasFotos,
  cargarFotos,
  esPosicionFoto,
  existeObjeto,
  MENSAJE_BORRADO_FOTOS,
  pathCorresponde,
  type FotoMedicion,
} from '@/lib/researcher/antropometria/fotos';
import { cargarUsuarioId, esInvestigador } from '@/lib/researcher/antropometria/investigadores';
import { columnasInstrumentos, instrumentosSchema } from '@/lib/researcher/antropometria/instrumentos';
import { cargarListado } from '@/lib/researcher/antropometria/listado';
import {
  buscarDuplicado,
  edadEn,
  esMayorDeEdad,
  MENSAJE_LIMITE_MEDICIONES,
  MENSAJE_MENOR_DE_EDAD,
  puedeAgregarMedicion,
} from '@/lib/researcher/antropometria/reglas';
import { RUTA_CONFIGURACION, RUTA_LISTADO, rutaEvolucion, rutaFicha, rutaInforme } from '@/lib/researcher/antropometria/rutas';
import type { MedicionRow, PacienteAntropometria } from '@/types/antropometria';

export type ResultadoError = { error: string };
export type PacienteDuplicado = { id: string; origen: 'deportista' | 'manual'; nombre: string; apellido: string };

const EDAD_MAXIMA = 100;

// ───────────────────────── Pacientes manuales ─────────────────────────

const pacienteManualSchema = z.object({
  nombre: z.string().trim().min(1, 'Ingresá el nombre.').max(80, 'El nombre es demasiado largo.'),
  apellido: z.string().trim().min(1, 'Ingresá el apellido.').max(80, 'El apellido es demasiado largo.'),
  fechaNacimiento: z
    .string()
    .refine((v) => parseDateLocal(v) !== null, 'Ingresá una fecha de nacimiento válida.'),
  sexo: z.enum(['M', 'F'], { message: 'Elegí el sexo.' }),
});

export type PacienteManualInput = z.input<typeof pacienteManualSchema>;

/**
 * Alta de un paciente manual. Rechaza menores. Si ya hay alguien con el mismo
 * nombre, apellido y fecha de nacimiento devuelve `duplicado` SIN guardar: la UI
 * avisa y vuelve a llamar con `confirmarDuplicado = true` (el aviso no bloquea).
 */
export async function crearPacienteManualAction(
  input: unknown,
  confirmarDuplicado = false,
): Promise<{ ok: true; id: string } | ResultadoError | { duplicado: PacienteDuplicado }> {
  const auth = await clienteInvestigador();
  if ('error' in auth) return auth;

  const parsed = pacienteManualSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Datos inválidos.' };
  const { nombre, apellido, fechaNacimiento, sexo } = parsed.data;

  if (!esMayorDeEdad(fechaNacimiento)) return { error: MENSAJE_MENOR_DE_EDAD };
  if ((edadEn(fechaNacimiento) ?? 0) > EDAD_MAXIMA) return { error: 'Revisá la fecha de nacimiento.' };

  if (!confirmarDuplicado) {
    const existente = buscarDuplicado({ nombre, apellido, fechaNacimiento }, await cargarListado(auth.supabase));
    if (existente) {
      return { duplicado: { id: existente.id, origen: existente.origen, nombre: existente.nombre, apellido: existente.apellido } };
    }
  }

  // `creado_por` lo completa la base con auth.uid() (default) y la policy lo exige.
  const { data, error } = await auth.supabase
    .from('antropometria_pacientes_manuales')
    .insert({ nombre, apellido, fecha_nacimiento: fechaNacimiento, sexo })
    .select('id')
    .single();
  if (error || !data) return { error: 'No se pudo guardar el paciente. Probá de nuevo.' };

  revalidatePath(RUTA_LISTADO);
  return { ok: true, id: (data as { id: string }).id };
}

// ───────────────────────── Mediciones (borrador y vigente) ─────────────────────────

const NIVELES = ['sedentaria', 'liviana', 'moderada', 'intensa', 'extremada'] as const;
const ID = z.string().regex(/^[0-9a-f-]{36}$/i, 'Identificador inválido.');
const fechaIso = z.string().refine((v) => parseDateLocal(v) !== null, 'Ingresá una fecha válida.');

const medicionSchema = z.object({
  /** Presente al retomar un borrador o editar una medición; ausente en la primera grabación. */
  medicionId: ID.nullish(),
  origen: z.enum(['deportista', 'manual']),
  pacienteId: ID,
  fechaMedicion: fechaIso.refine((v) => v <= todayAR(), 'La fecha de medición no puede ser futura.'),
  nivelActividad: z.enum(NIVELES).nullish(),
  deporte: z.string().max(80).nullish(),
  series: z.unknown(),
  /** Investigador que midió (opcional; '' o ausente = el que la carga). Tiene que ser investigador o administrador. */
  medidoPor: z.preprocess((v) => (v === '' ? null : v), ID.nullish()),
  /** Instrumentos usados (opcionales, texto libre). Si no vienen, la medición conserva los que tenía. */
  instrumentos: instrumentosSchema.nullish(),
  /** Solo para deportistas sin `physical_data`: lo que el asistente pidió en el primer paso. */
  datosPaciente: z.object({ sexo: z.enum(['M', 'F']).nullish(), fechaNacimiento: fechaIso.nullish() }).nullish(),
});

export type MedicionInput = z.input<typeof medicionSchema>;
export type ResultadoMedicion = { ok: true; id: string } | ResultadoError;

interface ContextoMedicion {
  supabase: SupabaseServidor;
  datos: z.output<typeof medicionSchema>;
  paciente: PacienteAntropometria;
  existente: MedicionRow | null;
  /** Mediciones vigentes del paciente SIN la que se está guardando. */
  otrasVigentes: MedicionRow[];
}

/**
 * Columnas de "quién midió" y de instrumentos. Lo que no llega no se toca; los instrumentos vacíos se guardan como null.
 * Si una medición vieja (medido_por null = quien la cargó) vuelve a mandar a quien la cargó, no se escribe nada.
 */
function camposAutoria(datos: z.output<typeof medicionSchema>, existente: MedicionRow | null) {
  const campos: Record<string, string | null> = {};
  if (datos.medidoPor !== undefined && !(existente && existente.medido_por === null && datos.medidoPor === existente.investigador_id)) {
    campos.medido_por = datos.medidoPor;
  }
  if (datos.instrumentos) Object.assign(campos, columnasInstrumentos(datos.instrumentos));
  return campos;
}

/** Validación y carga comunes a "guardar borrador" y "guardar y generar informe". */
async function prepararMedicion(input: unknown): Promise<ContextoMedicion | ResultadoError> {
  const auth = await clienteInvestigador();
  if ('error' in auth) return auth;
  const { supabase } = auth;

  const parsed = medicionSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Datos inválidos.' };
  const datos = parsed.data;

  const base = await cargarPaciente(supabase, datos.origen, datos.pacienteId);
  if (!base) return { error: 'No se encontró al paciente.' };
  const mediciones = await cargarMediciones(supabase, base);

  const existente = datos.medicionId ? (mediciones.find((m) => m.id === datos.medicionId) ?? null) : null;
  if (datos.medicionId && !existente) return { error: 'No se encontró la medición.' };

  // Quién midió: solo se valida si cambia (si a alguien le sacan el rol, sus mediciones viejas siguen editables).
  const medidoPorActual = existente ? (existente.medido_por ?? existente.investigador_id) : null;
  if (datos.medidoPor && datos.medidoPor !== medidoPorActual && !(await esInvestigador(supabase, datos.medidoPor))) {
    return { error: 'El investigador que midió tiene que ser un investigador o administrador.' };
  }

  // Un deportista sin `physical_data` no tiene sexo ni nacimiento: se piden una vez y se guardan en la tabla auxiliar.
  // Lo que ya existe nunca se pisa.
  const sexo = base.sexo ?? datos.datosPaciente?.sexo ?? null;
  const fechaNacimiento = base.fechaNacimiento ?? datos.datosPaciente?.fechaNacimiento ?? null;
  const paciente: PacienteAntropometria = { ...base, sexo, fechaNacimiento };

  if (fechaNacimiento) {
    const referencia = parseDateLocal(datos.fechaMedicion);
    if (!referencia || !esMayorDeEdad(fechaNacimiento, referencia)) return { error: MENSAJE_MENOR_DE_EDAD };
  }

  if (base.origen === 'deportista' && (sexo !== base.sexo || fechaNacimiento !== base.fechaNacimiento)) {
    const completar: Record<string, string> = { user_id: base.id };
    if (base.sexo === null && sexo) completar.sexo = sexo;
    if (base.fechaNacimiento === null && fechaNacimiento) completar.fecha_nacimiento = fechaNacimiento;
    const { error } = await supabase.from('antropometria_deportistas_datos').upsert(completar, { onConflict: 'user_id' });
    if (error) return { error: 'No se pudieron guardar el sexo y la fecha de nacimiento del deportista.' };
  }

  return {
    supabase,
    datos,
    paciente,
    existente,
    otrasVigentes: mediciones.filter((m) => m.estado === 'vigente' && m.id !== existente?.id),
  };
}

/** Autoguardado: crea o actualiza la fila en estado `borrador` (series parciales permitidas). */
export async function guardarBorradorAction(input: unknown): Promise<ResultadoMedicion> {
  const ctx = await prepararMedicion(input);
  if ('error' in ctx) return ctx;
  const { supabase, datos, paciente, existente, otrasVigentes } = ctx;

  // Una vigente se edita con "guardar y generar informe"; el autoguardado nunca la toca.
  if (existente && existente.estado !== 'borrador') {
    return { error: 'Esta medición ya está generada: guardala para actualizar el informe.' };
  }
  if (!existente && !puedeAgregarMedicion(otrasVigentes.length)) return { error: MENSAJE_LIMITE_MEDICIONES };

  const campos = {
    fecha_medicion: datos.fechaMedicion,
    nivel_actividad: datos.nivelActividad ?? null,
    deporte: datos.deporte ?? null,
    series: sanearSeries(datos.series),
    ...camposAutoria(datos, existente),
  };

  if (existente) {
    const { error } = await supabase.from('antropometria_mediciones').update(campos).eq('id', existente.id);
    if (error) return { error: 'No se pudo guardar el borrador.' };
    return { ok: true, id: existente.id };
  }

  const { data, error } = await supabase
    .from('antropometria_mediciones')
    .insert({
      ...(paciente.origen === 'deportista' ? { user_id: paciente.id } : { paciente_manual_id: paciente.id }),
      ...campos,
      estado: 'borrador',
    })
    .select('id')
    .single();
  if (error || !data) return { error: 'No se pudo guardar el borrador.' };
  return { ok: true, id: (data as { id: string }).id };
}

/**
 * Baja lógica: pasa la medición a `anulada` (la fila nunca se borra). Una anulada deja de verse en la ficha,
 * en el listado y como "medición anterior" de las comparaciones. Vale también para descartar un borrador.
 *
 * Las fotos posturales SÍ se borran (decisión de producto, NUT-251; no se puede deshacer): primero los archivos
 * del bucket y las filas, y recién después se anula. Si Storage falla no se anula nada: la persona reintenta
 * y no queda una medición anulada con fotos de una persona dando vueltas.
 */
export async function anularMedicionAction(medicionId: unknown): Promise<{ ok: true; fichaHref: string } | ResultadoError> {
  const auth = await clienteInvestigador();
  if ('error' in auth) return auth;

  const id = ID.safeParse(medicionId);
  if (!id.success) return { error: 'Identificador inválido.' };

  const medicion = await cargarMedicion(auth.supabase, id.data);
  if (!medicion) return { error: 'No se encontró la medición.' };
  if (medicion.estado === 'anulada') return { error: 'La medición ya estaba anulada.' };

  const fotos = await cargarFilasFotos(auth.supabase, medicion.id);
  if (fotos.length > 0) {
    if (!(await borrarObjetos(auth.supabase, fotos.map((f) => f.path)))) return { error: MENSAJE_BORRADO_FOTOS };
    const { error: errorFilas } = await auth.supabase.from('antropometria_fotos').delete().eq('medicion_id', medicion.id);
    if (errorFilas) return { error: MENSAJE_BORRADO_FOTOS };
  }

  const { error } = await auth.supabase.from('antropometria_mediciones').update({ estado: 'anulada' }).eq('id', medicion.id);
  if (error) return { error: 'No se pudo anular la medición. Probá de nuevo.' };

  const origen = medicion.user_id ? 'deportista' : 'manual';
  const pacienteId = medicion.user_id ?? medicion.paciente_manual_id ?? '';
  const fichaHref = rutaFicha(origen, pacienteId);
  revalidatePath(RUTA_LISTADO);
  revalidatePath(fichaHref);
  revalidatePath(rutaEvolucion(origen, pacienteId));
  revalidatePath(rutaInforme(medicion.id));
  return { ok: true, fichaHref };
}

/**
 * "Guardar y generar informe": exige las 25 variables, valida con el motor ANTES de escribir,
 * deja la medición `vigente` y actualiza la masa ósea de referencia si corresponde.
 * También sirve para guardar la edición de una medición vigente (el informe se recalcula al abrirlo).
 */
export async function finalizarMedicionAction(input: unknown): Promise<ResultadoMedicion> {
  const ctx = await prepararMedicion(input);
  if ('error' in ctx) return ctx;
  const { supabase, datos, paciente, existente, otrasVigentes } = ctx;

  if (!puedeAgregarMedicion(otrasVigentes.length)) return { error: MENSAJE_LIMITE_MEDICIONES };
  if (!paciente.sexo || !paciente.fechaNacimiento) return { error: 'Faltan el sexo y la fecha de nacimiento del paciente.' };
  if (!datos.nivelActividad) return { error: 'Elegí el nivel de actividad.' };

  const series = sanearSeries(datos.series);
  const faltantes = variablesFaltantes(series);
  if (faltantes.length > 0) return { error: `Faltan ${faltantes.length} de las 25 variables: no se puede generar el informe.` };

  let guardarReferencia: number | null;
  try {
    ({ guardarReferencia } = decidirMasaOsea(
      {
        sexo: paciente.sexo,
        fechaNacimiento: paciente.fechaNacimiento,
        fechaMedicion: datos.fechaMedicion,
        series,
        nivelActividad: datos.nivelActividad,
        deporte: datos.deporte ?? null,
      },
      paciente.masaOseaReferencia,
      esLaMedicionMasAntigua(datos.fechaMedicion, otrasVigentes),
    ));
  } catch (e) {
    if (e instanceof ErrorAntropometria) return { error: e.message };
    throw e;
  }

  const campos = {
    fecha_medicion: datos.fechaMedicion,
    nivel_actividad: datos.nivelActividad,
    deporte: datos.deporte ?? null,
    series,
    estado: 'vigente',
    ...camposAutoria(datos, existente),
  };

  let id: string;
  if (existente) {
    const { error } = await supabase.from('antropometria_mediciones').update(campos).eq('id', existente.id);
    if (error) return { error: 'No se pudo guardar la medición.' };
    id = existente.id;
  } else {
    const { data, error } = await supabase
      .from('antropometria_mediciones')
      .insert({
        ...(paciente.origen === 'deportista' ? { user_id: paciente.id } : { paciente_manual_id: paciente.id }),
        ...campos,
      })
      .select('id')
      .single();
    if (error || !data) return { error: 'No se pudo guardar la medición.' };
    id = (data as { id: string }).id;
  }

  if (guardarReferencia !== null) {
    const { error } =
      paciente.origen === 'manual'
        ? await supabase.from('antropometria_pacientes_manuales').update({ masa_osea_referencia: guardarReferencia }).eq('id', paciente.id)
        : await supabase
            .from('antropometria_deportistas_datos')
            .upsert({ user_id: paciente.id, masa_osea_referencia: guardarReferencia }, { onConflict: 'user_id' });
    if (error) {
      return { error: 'La medición se guardó, pero no se pudo guardar la masa ósea de referencia. Volvé a guardarla para reintentar.' };
    }
  }

  revalidatePath(RUTA_LISTADO);
  revalidatePath(rutaFicha(paciente.origen, paciente.id));
  revalidatePath(rutaEvolucion(paciente.origen, paciente.id));
  revalidatePath(rutaInforme(id));
  return { ok: true, id };
}

// ───────────────────────── Fotos posturales (NUT-251) ─────────────────────────

export type ResultadoFotos = { ok: true; fotos: FotoMedicion[] } | ResultadoError;

/** La medición de las fotos tiene que existir y no estar anulada (a una anulada se le borraron las fotos). */
async function medicionConFotos(supabase: SupabaseServidor, medicionId: unknown): Promise<{ id: string } | ResultadoError> {
  const id = ID.safeParse(medicionId);
  if (!id.success) return { error: 'Identificador inválido.' };
  const medicion = await cargarMedicion(supabase, id.data);
  if (!medicion) return { error: 'No se encontró la medición.' };
  if (medicion.estado === 'anulada') return { error: 'La medición está anulada: no admite fotos.' };
  return { id: medicion.id };
}

/** Fotos de la medición con signed URLs de corta duración. */
export async function listarFotosAction(medicionId: unknown): Promise<ResultadoFotos> {
  const auth = await clienteInvestigador();
  if ('error' in auth) return auth;

  const medicion = await medicionConFotos(auth.supabase, medicionId);
  if ('error' in medicion) return medicion;
  return { ok: true, fotos: await cargarFotos(auth.supabase, medicion.id) };
}

/**
 * Registra una foto que el navegador ya subió a `{medicionId}/{posicion}-{uuid}.jpg`. Si la posición ya tenía foto,
 * la reemplaza (se cambia el path de la fila y se borra el archivo anterior). Opcional: nunca bloquea guardar la medición.
 */
export async function registrarFotoAction(medicionId: unknown, posicion: unknown, path: unknown): Promise<ResultadoFotos> {
  const auth = await clienteInvestigador();
  if ('error' in auth) return auth;
  const { supabase } = auth;

  if (!esPosicionFoto(posicion)) return { error: 'La posición de la foto no es válida.' };
  const medicion = await medicionConFotos(supabase, medicionId);
  if ('error' in medicion) return medicion;
  if (!pathCorresponde(path, medicion.id, posicion)) return { error: 'La foto no corresponde a esta medición.' };

  // El archivo subido tiene que estar en el bucket: si no, quedaría una fila apuntando a la nada.
  if (!(await existeObjeto(supabase, path))) return { error: 'No se encontró la foto subida. Probá de nuevo.' };

  // El máximo de 3 fotos sale de las posiciones fijas (una por posición) y lo garantiza `unique (medicion_id, posicion)`:
  // si dos cargas de la misma posición compiten, la segunda falla en el insert y se limpia su archivo.
  const existente = (await cargarFilasFotos(supabase, medicion.id)).find((f) => f.posicion === posicion);

  const { error } = existente
    ? await supabase.from('antropometria_fotos').update({ path, creado_en: new Date().toISOString() }).eq('id', existente.id)
    : await supabase.from('antropometria_fotos').insert({ medicion_id: medicion.id, posicion, path });
  if (error) {
    await borrarObjetos(supabase, [path]);
    return { error: 'No se pudo guardar la foto. Probá de nuevo.' };
  }
  // El reemplazo ya quedó hecho: si el archivo viejo no se pudo borrar solo se loguea (borrarObjetos).
  if (existente) await borrarObjetos(supabase, [existente.path]);

  revalidatePath(rutaInforme(medicion.id));
  return { ok: true, fotos: await cargarFotos(supabase, medicion.id) };
}

/** Quita la foto de una posición: primero el archivo, después la fila (si el archivo no se borra, la foto sigue y se puede reintentar). */
export async function quitarFotoAction(medicionId: unknown, posicion: unknown): Promise<ResultadoFotos> {
  const auth = await clienteInvestigador();
  if ('error' in auth) return auth;
  const { supabase } = auth;

  if (!esPosicionFoto(posicion)) return { error: 'La posición de la foto no es válida.' };
  const medicion = await medicionConFotos(supabase, medicionId);
  if ('error' in medicion) return medicion;

  const existente = (await cargarFilasFotos(supabase, medicion.id)).find((f) => f.posicion === posicion);
  if (existente) {
    if (!(await borrarObjetos(supabase, [existente.path]))) return { error: 'No se pudo quitar la foto. Probá de nuevo.' };
    const { error } = await supabase.from('antropometria_fotos').delete().eq('id', existente.id);
    if (error) return { error: 'No se pudo quitar la foto. Probá de nuevo.' };
  }

  revalidatePath(rutaInforme(medicion.id));
  return { ok: true, fotos: await cargarFotos(supabase, medicion.id) };
}

// ───────────────────────── Mis instrumentos (NUT-246) ─────────────────────────

/**
 * Guarda "Mis instrumentos" del investigador con sesión (una fila propia, upsert). Los 4 campos son
 * opcionales: vacío = sin informar. Precargan las mediciones nuevas; no cambian las ya guardadas.
 */
export async function guardarMisInstrumentosAction(input: unknown): Promise<{ ok: true } | ResultadoError> {
  const auth = await clienteInvestigador();
  if ('error' in auth) return auth;

  const parsed = instrumentosSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Datos inválidos.' };

  const usuarioId = await cargarUsuarioId(auth.supabase);
  if (!usuarioId) return { error: 'No autenticado' };

  const { error } = await auth.supabase
    .from('antropometria_instrumentos_investigador')
    .upsert(
      { investigador_id: usuarioId, ...columnasInstrumentos(parsed.data), actualizado_en: new Date().toISOString() },
      { onConflict: 'investigador_id' },
    );
  if (error) return { error: 'No se pudieron guardar los instrumentos. Probá de nuevo.' };

  revalidatePath(RUTA_CONFIGURACION);
  return { ok: true };
}
