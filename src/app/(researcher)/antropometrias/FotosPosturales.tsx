'use client';

/**
 * Sección de la revisión del asistente (NUT-251/NUT-240): hasta 3 fotos posturales por medición, en posiciones
 * fijas (frente, lateral, espalda). Todo opcional: nunca bloquea "Guardar y generar informe".
 *
 * Las fotos se suben al instante (no esperan al "Guardar"): se comprimen en el navegador, se suben directo al
 * bucket privado con la sesión del investigador y una server action registra la fila. Necesitan el id de la
 * medición, por eso sin borrador guardado los espacios están deshabilitados.
 */
import { useRef, useState } from 'react';
import Button from '@/components/ui/Button';
import { comprimirImagen } from '@/lib/recorteFoto';
import {
  borrarObjetos,
  ETIQUETA_POSICION,
  MAX_FOTOS_POR_MEDICION,
  subirFotoPostural,
  validarArchivoFoto,
  type FotoMedicion,
} from '@/lib/researcher/antropometria/fotos';
import { createClient } from '@/lib/supabase/client';
import { POSICIONES_FOTO, type PosicionFoto } from '@/types/antropometria';
import { quitarFotoAction, registrarFotoAction } from './actions';

interface Props {
  /** null mientras la medición no tiene borrador guardado. */
  medicionId: string | null;
  fotos: readonly FotoMedicion[];
  onFotos: (fotos: FotoMedicion[]) => void;
}

type Fase = 'comprimiendo' | 'subiendo' | 'quitando';

const kb = (bytes: number) => `${Math.max(1, Math.round(bytes / 1024)).toLocaleString('es-AR')} KB`;
const TEXTO_FASE: Record<Fase, string> = { comprimiendo: 'Comprimiendo…', subiendo: 'Subiendo…', quitando: 'Quitando…' };

export default function FotosPosturales({ medicionId, fotos, onFotos }: Props) {
  const [ocupada, setOcupada] = useState<{ posicion: PosicionFoto; fase: Fase } | null>(null);
  const [errores, setErrores] = useState<Partial<Record<PosicionFoto, string>>>({});
  const [pesos, setPesos] = useState<Partial<Record<PosicionFoto, number>>>({});
  const entradas = useRef<Partial<Record<PosicionFoto, HTMLInputElement | null>>>({});

  const habilitada = medicionId !== null;

  function fallar(posicion: PosicionFoto, mensaje: string) {
    setErrores((e) => ({ ...e, [posicion]: mensaje }));
    setOcupada(null);
  }

  async function subir(posicion: PosicionFoto, archivo: File) {
    if (!medicionId) return;
    setErrores((e) => ({ ...e, [posicion]: undefined }));
    if (!archivo.type.startsWith('image/')) return fallar(posicion, 'Elegí una imagen.');

    try {
      setOcupada({ posicion, fase: 'comprimiendo' });
      const comprimida = await comprimirImagen(archivo);
      const invalida = validarArchivoFoto(comprimida);
      if (invalida) return fallar(posicion, invalida);

      setOcupada({ posicion, fase: 'subiendo' });
      const cliente = createClient();
      const subida = await subirFotoPostural(cliente, medicionId, posicion, comprimida);
      if ('error' in subida) return fallar(posicion, subida.error);

      const registro = await registrarFotoAction(medicionId, posicion, subida.path);
      if ('error' in registro) {
        await borrarObjetos(cliente, [subida.path]);
        return fallar(posicion, registro.error);
      }
      setPesos((p) => ({ ...p, [posicion]: comprimida.size }));
      onFotos(registro.fotos);
      setOcupada(null);
    } catch {
      fallar(posicion, 'No se pudo subir la foto. Probá de nuevo.');
    }
  }

  async function quitar(posicion: PosicionFoto) {
    if (!medicionId) return;
    setErrores((e) => ({ ...e, [posicion]: undefined }));
    setOcupada({ posicion, fase: 'quitando' });
    try {
      const r = await quitarFotoAction(medicionId, posicion);
      if ('error' in r) return fallar(posicion, r.error);
      setPesos((p) => ({ ...p, [posicion]: undefined }));
      onFotos(r.fotos);
      setOcupada(null);
    } catch {
      fallar(posicion, 'No se pudo quitar la foto. Probá de nuevo.');
    }
  }

  return (
    <section aria-labelledby="fotos-titulo" className="space-y-3 rounded-xl border border-slate-200 p-4">
      <div>
        <h3 id="fotos-titulo" className="text-sm font-semibold text-slate-900">
          Fotos posturales
        </h3>
        <p className="text-xs text-slate-600">
          Opcional · hasta {MAX_FOTOS_POR_MEDICION} por medición · {fotos.length} de {MAX_FOTOS_POR_MEDICION} cargadas. Se guardan al instante y no
          se muestran en el informe impreso.
        </p>
        {!habilitada && (
          <p role="status" className="mt-1 text-xs text-amber-800">
            Se habilitan cuando se guarda el borrador.
          </p>
        )}
      </div>

      <ul className="grid gap-3 sm:grid-cols-3">
        {POSICIONES_FOTO.map((posicion) => {
          const etiqueta = ETIQUETA_POSICION[posicion];
          const foto = fotos.find((f) => f.posicion === posicion);
          const enCurso = ocupada?.posicion === posicion ? ocupada.fase : null;
          const bloqueada = !habilitada || ocupada !== null;
          const error = errores[posicion];
          return (
            <li key={posicion} className="space-y-2 rounded-lg bg-slate-50 p-3">
              <p className="text-sm font-medium text-slate-900">{etiqueta}</p>
              <div className="flex aspect-[3/4] items-center justify-center overflow-hidden rounded-md bg-slate-200 text-xs text-slate-600">
                {foto?.url ? (
                  // eslint-disable-next-line @next/next/no-img-element -- signed URL de Storage (corta duración): next/image la cachearía
                  <img src={foto.url} alt={`Foto postural: ${etiqueta.toLowerCase()}`} className="h-full w-full object-cover" />
                ) : foto ? (
                  'No se pudo mostrar la foto'
                ) : (
                  'Sin foto'
                )}
              </div>
              <input
                ref={(el) => {
                  entradas.current[posicion] = el;
                }}
                type="file"
                accept="image/*"
                capture="environment"
                className="sr-only"
                tabIndex={-1}
                aria-label={`Archivo de la foto de ${etiqueta.toLowerCase()}`}
                disabled={bloqueada}
                onChange={(e) => {
                  const archivo = e.target.files?.[0];
                  e.target.value = '';
                  if (archivo) void subir(posicion, archivo);
                }}
              />
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={bloqueada}
                  loading={enCurso === 'comprimiendo' || enCurso === 'subiendo'}
                  aria-label={`${foto ? 'Cambiar' : 'Subir'} foto de ${etiqueta.toLowerCase()}`}
                  onClick={() => entradas.current[posicion]?.click()}
                >
                  {foto ? 'Cambiar foto' : 'Subir foto'}
                </Button>
                {foto && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={bloqueada}
                    loading={enCurso === 'quitando'}
                    aria-label={`Quitar foto de ${etiqueta.toLowerCase()}`}
                    onClick={() => void quitar(posicion)}
                  >
                    Quitar
                  </Button>
                )}
              </div>
              <p className="min-h-4 text-xs text-slate-600" role="status" aria-live="polite">
                {enCurso ? TEXTO_FASE[enCurso] : pesos[posicion] ? `Subida: ${kb(pesos[posicion]!)} (comprimida)` : ''}
              </p>
              {error && (
                <p role="alert" className="text-xs text-red-700">
                  {error}
                </p>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
