/**
 * NUT-119 — Fotos del plato en Supabase Storage (bucket PRIVADO
 * `detecciones-fotos`). Nunca se exponen URLs públicas: la lectura es solo por
 * signed URLs de corta duración generadas en el servidor. Ninguna función de
 * acá lanza: una foto que falla nunca debe romper la detección ni el borrado
 * de cuenta (se loguea y se sigue).
 *
 * Decisión de producto (NUT-119): la foto SÍ se guarda — reemplaza la regla
 * anterior de no guardarla. Se borra junto con la cuenta (ver
 * `borrarFotosDeUsuario`, llamado antes de `deleteUser`).
 */

export const BUCKET_FOTOS = 'detecciones-fotos';

/** Duración de las signed URLs, en segundos. */
export const TTL_URL_FIRMADA_S = 300;

/** Lo mínimo de un cliente de Supabase que usamos (facilita mockear). */
export interface StorageClient {
  storage: { from: (bucket: string) => any };
}

/** Sube el JPEG a `{userId}/{uuid}.jpg`; devuelve el path o null si falló. */
export async function subirFotoDeteccion(
  client: StorageClient,
  userId: string,
  jpeg: Buffer,
): Promise<string | null> {
  const path = `${userId}/${crypto.randomUUID()}.jpg`;
  try {
    const { error } = await client.storage
      .from(BUCKET_FOTOS)
      .upload(path, jpeg, { contentType: 'image/jpeg', upsert: false });
    if (error) {
      console.error('No se pudo subir la foto de la detección:', error);
      return null;
    }
    return path;
  } catch (err) {
    console.error('No se pudo subir la foto de la detección:', err);
    return null;
  }
}

/** Borra una foto (limpieza best effort). */
export async function borrarFoto(client: StorageClient, path: string): Promise<void> {
  try {
    const { error } = await client.storage.from(BUCKET_FOTOS).remove([path]);
    if (error) console.error('No se pudo borrar la foto:', error);
  } catch (err) {
    console.error('No se pudo borrar la foto:', err);
  }
}

/** Signed URLs de varias fotos en UNA llamada. Los paths que fallen quedan fuera del mapa. */
export async function urlsFirmadas(client: StorageClient, paths: string[]): Promise<Map<string, string>> {
  const urls = new Map<string, string>();
  if (paths.length === 0) return urls;
  try {
    const { data, error } = await client.storage.from(BUCKET_FOTOS).createSignedUrls(paths, TTL_URL_FIRMADA_S);
    if (error) {
      console.error('No se pudieron firmar las URLs de las fotos:', error);
      return urls;
    }
    for (const fila of (data ?? []) as Array<{ path: string; signedUrl: string | null }>) {
      if (fila.signedUrl) urls.set(fila.path, fila.signedUrl);
    }
  } catch (err) {
    console.error('No se pudieron firmar las URLs de las fotos:', err);
  }
  return urls;
}
