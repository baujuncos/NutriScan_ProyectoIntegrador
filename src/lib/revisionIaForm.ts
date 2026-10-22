/**
 * NUT-149 — Lógica pura del formulario "Tu corrección" del modal de la cola: qué es válido y
 * qué se guarda. Para cada campo el investigador elige "Mantener" lo que dejó el deportista o
 * "Ingresar otro". Siempre se guardan los valores RESULTANTES (también los mantenidos), así el
 * valor del investigador es la verdad completa, sin tener que mirar dos tablas.
 */
import { MAX_CANTIDAD } from '@/lib/nutrition';

/** Gramos máximos de un ítem: el mismo tope que el resto de la app. */
export const PESO_MAXIMO_G = MAX_CANTIDAD;
export const NOMBRE_MIN = 2;
export const NOMBRE_MAX = 200;

export type ModoCampo = 'mantener' | 'otro';
/** Ítem que el deportista quitó: restaurarlo (pide nombre y peso) o dejarlo quitado. */
export type ModoQuitado = 'restaurar' | 'mantener_quitado';

export interface EstadoForm {
  modoNombre: ModoCampo;
  nombreOtro: string;
  modoPeso: ModoCampo;
  /** Texto del campo numérico (gramos). */
  pesoOtro: string;
  modoQuitado: ModoQuitado;
}

/** Por defecto "Mantener" en ambos campos; un ítem quitado arranca en "No estaba: mantener quitado". */
export const FORM_INICIAL: EstadoForm = {
  modoNombre: 'mantener',
  nombreOtro: '',
  modoPeso: 'mantener',
  pesoOtro: '',
  modoQuitado: 'mantener_quitado',
};

export interface ContextoForm {
  /** El deportista quitó el ítem: no hay nombre ni peso suyo que mantener. */
  quitado: boolean;
  nombreUsuario: string | null;
  gramosUsuario: number | null;
  gramosIa: number;
}

export interface ErroresForm {
  nombre?: string;
  peso?: string;
}

/** Espacios de más afuera y adentro fuera ("  Pollo   al horno " → "Pollo al horno"). */
export function normalizarNombre(texto: string): string {
  return texto.trim().replace(/\s+/g, ' ');
}

/** Gramos del campo numérico: null si está vacío o no es un número. Acepta coma decimal. */
export function parsearGramos(texto: string): number | null {
  const t = texto.trim().replace(',', '.');
  if (t === '') return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

function errorNombre(texto: string): string | undefined {
  const n = normalizarNombre(texto);
  if (n.length < NOMBRE_MIN) return `Ingresá el nombre del alimento (al menos ${NOMBRE_MIN} letras).`;
  if (n.length > NOMBRE_MAX) return `El nombre es muy largo (máximo ${NOMBRE_MAX} caracteres).`;
  return undefined;
}

function errorPeso(texto: string): string | undefined {
  const g = parsearGramos(texto);
  if (g == null || g <= 0) return 'Ingresá un peso mayor a 0 g.';
  if (g > PESO_MAXIMO_G) return `El peso máximo es ${PESO_MAXIMO_G} g.`;
  return undefined;
}

/** ¿Se pide el campo nombre / peso? (siempre en "Ingresar otro"; en un ítem quitado, sólo si se lo restaura.) */
export function camposActivos(form: EstadoForm, ctx: ContextoForm): { nombre: boolean; peso: boolean } {
  if (ctx.quitado) return { nombre: form.modoQuitado === 'restaurar', peso: form.modoQuitado === 'restaurar' };
  return { nombre: form.modoNombre === 'otro', peso: form.modoPeso === 'otro' };
}

export function validarCorreccion(form: EstadoForm, ctx: ContextoForm): { valido: boolean; errores: ErroresForm } {
  const activos = camposActivos(form, ctx);
  const errores: ErroresForm = {};
  if (activos.nombre) errores.nombre = errorNombre(form.nombreOtro);
  if (activos.peso) errores.peso = errorPeso(form.pesoOtro);
  // Mantener un nombre o peso que no existe (dato inconsistente) no se puede guardar.
  if (!ctx.quitado && !activos.nombre && !ctx.nombreUsuario) errores.nombre = 'No hay un nombre del deportista para mantener.';
  if (!ctx.quitado && !activos.peso && (ctx.gramosUsuario == null || ctx.gramosUsuario <= 0)) errores.peso = 'No hay un peso del deportista para mantener.';
  const valido = !errores.nombre && !errores.peso;
  return { valido, errores: valido ? {} : Object.fromEntries(Object.entries(errores).filter(([, v]) => v)) };
}

export type ResultadoCorreccion =
  /** "No estaba en el plato": se deja quitado. Equivale a Confirmar (no hay valores del investigador que guardar). */
  | { accion: 'confirmar' }
  /** Valores finales del investigador (los mantenidos también). */
  | { accion: 'corregir'; alimento: string; gramos: number };

/** Qué se manda al servidor; null si el formulario no es válido. */
export function resultadoCorreccion(form: EstadoForm, ctx: ContextoForm): ResultadoCorreccion | null {
  if (!validarCorreccion(form, ctx).valido) return null;
  if (ctx.quitado && form.modoQuitado === 'mantener_quitado') return { accion: 'confirmar' };
  const activos = camposActivos(form, ctx);
  const alimento = activos.nombre ? normalizarNombre(form.nombreOtro) : (ctx.nombreUsuario as string);
  const gramos = activos.peso ? (parsearGramos(form.pesoOtro) as number) : (ctx.gramosUsuario as number);
  return { accion: 'corregir', alimento, gramos };
}

export interface Diferencia {
  gramos: number;
  /** null si la referencia es 0 (no se puede calcular). */
  porcentaje: number | null;
}

/** Diferencia de `nuevo` contra `referencia`, en gramos y en % de la referencia. */
export function diferencia(nuevo: number, referencia: number): Diferencia {
  const gramos = nuevo - referencia;
  return { gramos, porcentaje: referencia > 0 ? (gramos / referencia) * 100 : null };
}

/** "+30 g (+20 %)", "−10 g (−4 %)" o "sin diferencia". */
export function textoDiferencia(d: Diferencia): string {
  const redondeado = Math.round(d.gramos * 10) / 10;
  if (redondeado === 0) return 'sin diferencia';
  const signo = (n: number) => (n > 0 ? '+' : '−');
  const g = `${signo(redondeado)}${Math.abs(redondeado)} g`;
  if (d.porcentaje == null) return g;
  const p = Math.round(d.porcentaje);
  return p === 0 ? g : `${g} (${signo(p)}${Math.abs(p)} %)`;
}

/** Lo mínimo de la fila de la cola que se necesita para mostrar la revisión del investigador. */
export interface FilaRevisada {
  estado_revision: 'pendiente' | 'confirmado' | 'corregido';
  item_quitado: boolean;
  alimento_usuario: string | null;
  gramos_usuario: number | null;
  nutricionista_alimento: string | null;
  nutricionista_gramos: number | null;
}

export interface ResumenInvestigador {
  /** Nombre y peso que quedaron como verdad del investigador (null = ítem que sigue quitado, o sin revisar). */
  nombre: string | null;
  gramos: number | null;
  /** Eligió "Mantener" en ese campo: el valor es el mismo que dejó el deportista. */
  nombreSinCambios: boolean;
  pesoSinCambios: boolean;
}

/**
 * Cómo quedó la revisión. Corregido: los valores que guardó el investigador (los mantenidos también, con la
 * marca "sin cambios" si coinciden con los del deportista). Confirmado: el valor del deportista pasó a ser el final.
 */
export function resumenInvestigador(fila: FilaRevisada): ResumenInvestigador {
  const quitado = fila.item_quitado || fila.alimento_usuario == null;
  if (fila.estado_revision === 'confirmado') {
    return { nombre: quitado ? null : fila.alimento_usuario, gramos: quitado ? null : fila.gramos_usuario, nombreSinCambios: !quitado, pesoSinCambios: !quitado };
  }
  if (fila.estado_revision === 'corregido') {
    return {
      nombre: fila.nutricionista_alimento,
      gramos: fila.nutricionista_gramos,
      nombreSinCambios: !quitado && fila.nutricionista_alimento != null && fila.nutricionista_alimento === fila.alimento_usuario,
      pesoSinCambios: !quitado && fila.nutricionista_gramos != null && Number(fila.nutricionista_gramos) === Number(fila.gramos_usuario),
    };
  }
  return { nombre: null, gramos: null, nombreSinCambios: false, pesoSinCambios: false };
}
