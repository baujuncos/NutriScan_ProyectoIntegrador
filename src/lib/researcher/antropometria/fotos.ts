/**
 * Fotos posturales de una medición (NUT-251, NUT-240). Bucket PRIVADO `antropometria-fotos`: nunca hay
 * URLs públicas, solo signed URLs de corta duración que se generan en el servidor.
 *
 * Tres posiciones fijas (frente, lateral, espalda), una foto por posición, hasta 3 por medición. El navegador
 * comprime y sube directo a Storage con la sesión del investigador (policies de la migración 024) y después
 * una server action registra la fila en `antropometria_fotos`: así la foto no pasa por el límite de ~1 MB
 * del body de las server actions.
 *
 * Este módulo no importa nada de servidor: lo usan las server actions, las páginas y el componente del navegador.
 */
import { TTL_URL_LISTA_S, urlsFirmadas, type StorageClient } from '@/lib/fotosDeteccion';
import type { SupabaseServidor } from '@/lib/researcher/clienteInvestigador';
import { POSICIONES_FOTO, type FotoRow, type PosicionFoto } from '@/types/antropometria';

export const BUCKET_FOTOS_ANTROPOMETRIA = 'antropometria-fotos';

/** Una foto por posición: el máximo por medición es la cantidad de posiciones. */
export const MAX_FOTOS_POR_MEDICION = POSICIONES_FOTO.length;

/** Tope del bucket (3 MB). Después de comprimir una foto pesa cientos de KB. */
export const MAX_BYTES_FOTO = 3 * 1024 * 1024;
export const TIPOS_FOTO = ['image/jpeg', 'image/webp', 'image/png'] as const;

export const ETIQUETA_POSICION: Record<PosicionFoto, string> = {
  frente: 'Frente',
  lateral: 'Lateral',
  espalda: 'Espalda',
};

/** Lo que ve la pantalla de una foto: nunca el path ni datos de quién la subió. `url` es una signed URL de corta duración. */
export interface FotoMedicion {
  id: string;
  posicion: PosicionFoto;
  url: string | null;
}

export const MENSAJE_BORRADO_FOTOS = 'No se pudieron borrar las fotos; la medición no se anuló. Probá de nuevo.';

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';

export function esPosicionFoto(valor: unknown): valor is PosicionFoto {
  return typeof valor === 'string' && (POSICIONES_FOTO as readonly string[]).includes(valor);
}

/** Convención del path en el bucket: `{medicion_id}/{posicion}-{uuid}.jpg`. */
export function pathFoto(medicionId: string, posicion: PosicionFoto, uuid: string = crypto.randomUUID()): string {
  return `${medicionId}/${posicion}-${uuid}.jpg`;
}

/** ¿El path es exactamente de esta medición y de esta posición? (la acción no confía en lo que manda el navegador) */
export function pathCorresponde(path: unknown, medicionId: string, posicion: PosicionFoto): path is string {
  return typeof path === 'string' && new RegExp(`^${medicionId}/${posicion}-${UUID}\\.jpg$`, 'i').test(path);
}

/** Mensaje de error si el archivo no se puede subir; null si está bien. */
export function validarArchivoFoto(archivo: { type: string; size: number }): string | null {
  if (!(TIPOS_FOTO as readonly string[]).includes(archivo.type)) return 'Elegí una imagen JPG, PNG o WebP.';
  if (archivo.size > MAX_BYTES_FOTO) return 'La foto pesa más de 3 MB incluso comprimida. Probá con otra.';
  return null;
}

/** Sube la foto (ya comprimida) con la sesión del navegador. Devuelve el path o un mensaje de error. */
export async function subirFotoPostural(
  client: StorageClient,
  medicionId: string,
  posicion: PosicionFoto,
  archivo: Blob,
): Promise<{ path: string } | { error: string }> {
  const path = pathFoto(medicionId, posicion);
  try {
    const { error } = await client.storage
      .from(BUCKET_FOTOS_ANTROPOMETRIA)
      .upload(path, archivo, { contentType: archivo.type || 'image/jpeg', upsert: false });
    if (error) return { error: 'No se pudo subir la foto. Probá de nuevo.' };
    return { path };
  } catch {
    return { error: 'No se pudo subir la foto. Probá de nuevo.' };
  }
}

/** Borra objetos del bucket. A diferencia de `borrarFoto`, el resultado importa: false si falló (la anulación se frena). */
export async function borrarObjetos(client: StorageClient, paths: string[]): Promise<boolean> {
  if (paths.length === 0) return true;
  try {
    const { error } = await client.storage.from(BUCKET_FOTOS_ANTROPOMETRIA).remove(paths);
    if (error) {
      console.error('No se pudieron borrar las fotos posturales:', error);
      return false;
    }
    return true;
  } catch (err) {
    console.error('No se pudieron borrar las fotos posturales:', err);
    return false;
  }
}

/** ¿Está el objeto en el bucket? (evita registrar un path que nunca se subió) */
export async function existeObjeto(client: StorageClient, path: string): Promise<boolean> {
  const carpeta = path.slice(0, path.lastIndexOf('/'));
  const nombre = path.slice(path.lastIndexOf('/') + 1);
  try {
    const { data, error } = await client.storage.from(BUCKET_FOTOS_ANTROPOMETRIA).list(carpeta, { search: nombre });
    if (error) return false;
    return ((data ?? []) as Array<{ name: string }>).some((o) => o.name === nombre);
  } catch {
    return false;
  }
}

/** Filas de fotos de una medición, en el orden de las posiciones. */
export async function cargarFilasFotos(supabase: SupabaseServidor, medicionId: string): Promise<FotoRow[]> {
  const { data } = await supabase.from('antropometria_fotos').select('*').eq('medicion_id', medicionId);
  const filas = (data ?? []) as FotoRow[];
  return [...filas].sort((a, b) => POSICIONES_FOTO.indexOf(a.posicion) - POSICIONES_FOTO.indexOf(b.posicion));
}

/** Fotos de una medición con su signed URL (válida unos minutos; la página se renderiza siempre en el servidor). */
export async function cargarFotos(supabase: SupabaseServidor, medicionId: string): Promise<FotoMedicion[]> {
  const filas = await cargarFilasFotos(supabase, medicionId);
  const urls = await urlsFirmadas(supabase, filas.map((f) => f.path), TTL_URL_LISTA_S, BUCKET_FOTOS_ANTROPOMETRIA);
  return filas.map((f) => ({ id: f.id, posicion: f.posicion, url: urls.get(f.path) ?? null }));
}

/** medicion_id → cantidad de fotos (para avisar en "Anular" cuántas se van a borrar). Las mediciones sin fotos no aparecen. */
export async function contarFotosPorMedicion(supabase: SupabaseServidor, medicionIds: readonly string[]): Promise<Map<string, number>> {
  const cuentas = new Map<string, number>();
  if (medicionIds.length === 0) return cuentas;
  const { data } = await supabase.from('antropometria_fotos').select('medicion_id').in('medicion_id', [...medicionIds]);
  for (const f of (data ?? []) as Array<{ medicion_id: string }>) cuentas.set(f.medicion_id, (cuentas.get(f.medicion_id) ?? 0) + 1);
  return cuentas;
}
