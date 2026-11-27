import Card from '@/components/researcher/Card';
import { ETIQUETA_POSICION, type FotoMedicion } from '@/lib/researcher/antropometria/fotos';

/**
 * Fotos posturales en el informe EN PANTALLA (NUT-251/NUT-240). Va fuera de `#informe-imprimible` y con
 * `no-imprimir`: no sale en el PDF. Solo aparece si la medición tiene fotos. Las URLs son signed URLs de
 * corta duración (el bucket es privado): si la pestaña queda abierta un rato, recargar las renueva.
 */
export default function FotosInforme({ fotos }: { fotos: readonly FotoMedicion[] }) {
  if (fotos.length === 0) return null;
  return (
    <Card className="no-imprimir print:hidden p-4 sm:p-6">
      <section aria-labelledby="fotos-informe-titulo" className="space-y-3">
        <div>
          <h2 id="fotos-informe-titulo" className="text-base font-semibold text-slate-900">
            Fotos posturales
          </h2>
          <p className="text-xs text-slate-600">Solo se ven en pantalla: no se incluyen en el informe impreso ni en el PDF.</p>
        </div>
        <ul className="grid gap-3 sm:grid-cols-3">
          {fotos.map((f) => (
            <li key={f.id} className="space-y-1">
              <p className="text-sm font-medium text-slate-900">{ETIQUETA_POSICION[f.posicion]}</p>
              {f.url ? (
                // eslint-disable-next-line @next/next/no-img-element -- signed URL de Storage (corta duración): next/image la cachearía
                <img
                  src={f.url}
                  alt={`Foto postural: ${ETIQUETA_POSICION[f.posicion].toLowerCase()}`}
                  className="aspect-[3/4] w-full rounded-md bg-slate-200 object-cover"
                />
              ) : (
                <p className="flex aspect-[3/4] items-center justify-center rounded-md bg-slate-100 text-xs text-slate-600">No se pudo mostrar la foto</p>
              )}
            </li>
          ))}
        </ul>
      </section>
    </Card>
  );
}
