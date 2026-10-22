'use client';

/**
 * NUT-149 — Modal de revisión de un ítem de la cola, sobre el Modal base. Dos columnas desde 768 px
 * (foto con la marca del ítem a la izquierda; datos y corrección a la derecha) y una columna por debajo.
 * Usa la fila y la foto (signed URL de corta duración) que ya trajo la lista: abrir el modal no pide nada.
 * Compara IA / Deportista / Investigador sin pisar nada, y "Tu corrección" deja elegir, por separado,
 * mantener o ingresar el nombre y mantener o ingresar el peso (la lógica está en `lib/revisionIaForm`).
 */
import { useId, useState } from 'react';
import Button from '@/components/ui/Button';
import Modal from '@/components/ui/Modal';
import { formatFechaCorta } from '@/lib/date';
import { cajaDeFila } from '@/lib/marcaFoto';
import { fmt } from '@/lib/numeros';
import {
  FORM_INICIAL,
  PESO_MAXIMO_G,
  diferencia,
  parsearGramos,
  resultadoCorreccion,
  textoDiferencia,
  validarCorreccion,
  type ContextoForm,
  type EstadoForm,
} from '@/lib/revisionIaForm';
import AlimentoAutocomplete from './AlimentoAutocomplete';
import FotoConMarca from './FotoConMarca';
import MotivosRevision from './MotivosRevision';
import {
  confirmarRevisionAction,
  corregirRevisionAction,
  marcarCandidatoAction,
  type AccionResultado,
  type RevisionFila,
} from './actions';

interface Props {
  /** El ítem a revisar (la fila de la lista); null = cerrado. El padre lo monta con `key` = id para reiniciar el formulario. */
  fila: RevisionFila | null;
  /** La misma signed URL de la miniatura; mientras no venza no se pide otra. */
  fotoUrl: string | null;
  /** La imagen falló (URL vencida): el padre pide una nueva una sola vez; null = no hay otra. */
  onFotoFallo: (urlFallida: string) => Promise<string | null>;
  onClose: () => void;
  /** Se llama tras cualquier acción exitosa (la página refresca el listado, respetando el filtro de Estado). */
  onCambio: () => void;
}

const VAJILLA_LABEL: Record<string, string> = {
  plato_playo: 'Plato playo',
  plato_postre: 'Plato postre',
  plato_hondo: 'Plato hondo',
};

const gramosTexto = (g: number | null | undefined) => (g == null ? '—' : `${fmt(g)} g`);

/** Comparativa de sólo lectura: IA / Deportista (final) / Investigador, para nombre y peso. */
function TablaComparativa({ fila }: { fila: RevisionFila }) {
  const quitado = fila.item_quitado || fila.alimento_usuario == null;
  const revisado = fila.estado_revision !== 'pendiente';
  const celdaInv = (valor: string | null) =>
    revisado ? (valor ?? '—') : <span className="font-normal text-slate-500">Sin revisar</span>;
  return (
    <table className="w-full table-fixed border-separate border-spacing-0 overflow-hidden rounded-xl border border-slate-200 text-sm">
      <caption className="sr-only">Comparación entre lo que detectó la IA, lo que dejó el deportista y lo que corrigió el investigador</caption>
      <thead>
        <tr className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-600">
          <th scope="col" className="w-16 px-3 py-2"><span className="sr-only">Dato</span></th>
          <th scope="col" className="px-3 py-2 font-semibold">IA</th>
          <th scope="col" className="px-3 py-2 font-semibold">Deportista (final)</th>
          <th scope="col" className="bg-blue-50 px-3 py-2 font-semibold text-blue-800">Investigador</th>
        </tr>
      </thead>
      <tbody className="align-top">
        <tr>
          <th scope="row" className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-600">Nombre</th>
          <td className="px-3 py-2 font-medium text-slate-900">{fila.alimento_ia}</td>
          <td className="px-3 py-2 font-medium text-slate-900">{quitado ? <span className="text-red-800">Lo quitó</span> : fila.alimento_usuario}</td>
          <td className="bg-blue-50/60 px-3 py-2 font-medium text-slate-900">{celdaInv(fila.nutricionista_alimento)}</td>
        </tr>
        <tr>
          <th scope="row" className="border-t border-slate-100 px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-600">Peso</th>
          <td className="border-t border-slate-100 px-3 py-2 text-slate-800">{gramosTexto(fila.gramos_ia)}</td>
          <td className="border-t border-slate-100 px-3 py-2 text-slate-800">{quitado ? '—' : gramosTexto(fila.gramos_usuario)}</td>
          <td className="border-t border-slate-100 bg-blue-50/60 px-3 py-2 text-slate-800">
            {celdaInv(fila.nutricionista_gramos == null ? null : gramosTexto(fila.nutricionista_gramos))}
          </td>
        </tr>
      </tbody>
    </table>
  );
}

function Opcion({ nombre, checked, onChange, children }: { nombre: string; checked: boolean; onChange: () => void; children: React.ReactNode }) {
  return (
    <label className="flex cursor-pointer items-start gap-2 text-sm text-slate-800">
      <input type="radio" name={nombre} checked={checked} onChange={onChange} className="mt-0.5 h-4 w-4 accent-blue-600" />
      <span>{children}</span>
    </label>
  );
}

export default function RevisionIaDetalle({ fila, fotoUrl, onFotoFallo, onClose, onCambio }: Props) {
  const grupo = useId();
  const [form, setForm] = useState<EstadoForm>(FORM_INICIAL);
  const [tocado, setTocado] = useState({ nombre: false, peso: false });
  const [trabajando, setTrabajando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ejemplo, setEjemplo] = useState(fila?.candidato_ejemplo ?? false);

  const cambiar = (parcial: Partial<EstadoForm>) => setForm((f) => ({ ...f, ...parcial }));

  async function ejecutar(accion: () => Promise<AccionResultado>, alExito: () => void) {
    setTrabajando(true);
    setError(null);
    const r = await accion();
    setTrabajando(false);
    if ('error' in r) {
      setError(r.error); // el modal queda abierto con lo que había
      return;
    }
    alExito();
    onCambio();
  }

  const pendiente = fila?.estado_revision === 'pendiente';
  const ctx: ContextoForm | null = fila
    ? {
        quitado: fila.item_quitado || fila.alimento_usuario == null,
        nombreUsuario: fila.alimento_usuario,
        gramosUsuario: fila.gramos_usuario,
        gramosIa: fila.gramos_ia,
      }
    : null;
  const validacion = ctx ? validarCorreccion(form, ctx) : { valido: false, errores: {} as { nombre?: string; peso?: string } };

  function guardar() {
    if (!fila || !ctx) return;
    const r = resultadoCorreccion(form, ctx);
    if (!r) return;
    if (r.accion === 'confirmar') {
      ejecutar(() => confirmarRevisionAction(fila.id_deteccion_item), onClose);
    } else {
      ejecutar(() => corregirRevisionAction({ id: fila.id_deteccion_item, alimento: r.alimento, gramos: r.gramos }), onClose);
    }
  }

  const pideNombre = ctx != null && (ctx.quitado ? form.modoQuitado === 'restaurar' : form.modoNombre === 'otro');
  const pidePeso = ctx != null && (ctx.quitado ? form.modoQuitado === 'restaurar' : form.modoPeso === 'otro');
  const gramosNuevos = parsearGramos(form.pesoOtro);
  const mostrarDiferencia = pidePeso && gramosNuevos != null && gramosNuevos > 0 && gramosNuevos <= PESO_MAXIMO_G;

  const pie = fila && (
    <>
      <Button type="button" variant="ghost" disabled={trabajando} onClick={onClose}>
        Cancelar
      </Button>
      {pendiente && (
        <>
          <Button type="button" variant="outline" disabled={trabajando} onClick={() => ejecutar(() => confirmarRevisionAction(fila.id_deteccion_item), onClose)}>
            Confirmar sin cambios
          </Button>
          <Button type="button" disabled={trabajando || !validacion.valido} loading={trabajando} onClick={guardar}>
            Guardar corrección
          </Button>
        </>
      )}
    </>
  );

  return (
    <Modal open={fila != null} onClose={onClose} title="Revisar predicción" size="xl" footer={pie}>
      {fila && ctx && (
        <div className="grid gap-6 md:grid-cols-2">
          <div className="space-y-2">
            <FotoConMarca
              src={fotoUrl}
              alt={`Foto de la comida: ${fila.alimento_ia}`}
              caja={cajaDeFila(fila)}
              etiqueta={fila.alimento_ia}
              onFallo={onFotoFallo}
            />
            <p className="text-xs text-slate-600">
              {VAJILLA_LABEL[fila.vajilla_tipo] ?? fila.vajilla_tipo} de {fmt(fila.vajilla_diametro_cm)} cm · ángulo{' '}
              {fila.angulo_aproximado ? '≈ ' : ''}
              {fila.angulo_captura_grados}° · {formatFechaCorta(fila.created_at)}
            </p>
          </div>

          <div className="min-w-0 space-y-4">
            <div className="space-y-2">
              <MotivosRevision motivos={fila.motivos_revision} />
              <p className="text-sm text-slate-700">Confianza de la IA: {Math.round(fila.confidence * 100)}%</p>
            </div>

            <TablaComparativa fila={fila} />

            {pendiente && (
              <fieldset className="space-y-4 rounded-xl border border-slate-200 p-4">
                <legend className="px-1 text-sm font-semibold text-slate-900">Tu corrección</legend>

                {ctx.quitado ? (
                  <div className="space-y-3" role="radiogroup" aria-label="Ítem quitado">
                    <p className="text-sm text-slate-700">El deportista quitó este ítem. ¿Estaba en el plato?</p>
                    <Opcion nombre={`${grupo}-quitado`} checked={form.modoQuitado === 'restaurar'} onChange={() => cambiar({ modoQuitado: 'restaurar' })}>
                      Estaba en el plato: restaurar
                    </Opcion>
                    <Opcion nombre={`${grupo}-quitado`} checked={form.modoQuitado === 'mantener_quitado'} onChange={() => cambiar({ modoQuitado: 'mantener_quitado' })}>
                      No estaba: mantener quitado
                    </Opcion>
                  </div>
                ) : (
                  <div className="space-y-2" role="radiogroup" aria-label="Alimento">
                    <p className="text-sm font-medium text-slate-900">Alimento</p>
                    <Opcion nombre={`${grupo}-nombre`} checked={form.modoNombre === 'mantener'} onChange={() => cambiar({ modoNombre: 'mantener' })}>
                      Mantener: <strong className="font-semibold">{fila.alimento_usuario}</strong>
                    </Opcion>
                    <Opcion nombre={`${grupo}-nombre`} checked={form.modoNombre === 'otro'} onChange={() => cambiar({ modoNombre: 'otro' })}>
                      Ingresar otro
                    </Opcion>
                  </div>
                )}

                {pideNombre && (
                  <AlimentoAutocomplete
                    label="Nombre del alimento"
                    value={form.nombreOtro}
                    onChange={(nombreOtro) => {
                      cambiar({ nombreOtro });
                      setTocado((t) => ({ ...t, nombre: true }));
                    }}
                    error={tocado.nombre ? validacion.errores.nombre : undefined}
                    disabled={trabajando}
                  />
                )}

                {!ctx.quitado && (
                  <div className="space-y-2" role="radiogroup" aria-label="Peso">
                    <p className="text-sm font-medium text-slate-900">Peso</p>
                    <Opcion nombre={`${grupo}-peso`} checked={form.modoPeso === 'mantener'} onChange={() => cambiar({ modoPeso: 'mantener' })}>
                      Mantener: <strong className="font-semibold">{gramosTexto(fila.gramos_usuario)}</strong>
                    </Opcion>
                    <Opcion nombre={`${grupo}-peso`} checked={form.modoPeso === 'otro'} onChange={() => cambiar({ modoPeso: 'otro' })}>
                      Ingresar otro
                    </Opcion>
                  </div>
                )}

                {pidePeso && (
                  <div>
                    <label htmlFor={`${grupo}-gramos`} className="mb-1 block text-xs font-medium text-slate-600">
                      Peso (g)
                    </label>
                    <input
                      id={`${grupo}-gramos`}
                      type="number"
                      inputMode="decimal"
                      min={0}
                      max={PESO_MAXIMO_G}
                      step="any"
                      value={form.pesoOtro}
                      disabled={trabajando}
                      aria-invalid={tocado.peso && validacion.errores.peso ? true : undefined}
                      aria-describedby={`${grupo}-diferencia`}
                      onChange={(e) => {
                        cambiar({ pesoOtro: e.target.value });
                        setTocado((t) => ({ ...t, peso: true }));
                      }}
                      className="h-10 w-full rounded-lg border border-slate-200 bg-slate-50 px-3 text-sm text-slate-700 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/30 sm:w-40"
                    />
                    <div id={`${grupo}-diferencia`} aria-live="polite" className="mt-1 space-y-0.5 text-xs">
                      {tocado.peso && validacion.errores.peso && <p className="text-red-700">{validacion.errores.peso}</p>}
                      {mostrarDiferencia && (
                        <>
                          <p className="text-slate-700">
                            Contra la IA ({fmt(fila.gramos_ia)} g): <strong>{textoDiferencia(diferencia(gramosNuevos as number, fila.gramos_ia))}</strong>
                          </p>
                          {!ctx.quitado && fila.gramos_usuario != null && (
                            <p className="text-slate-700">
                              Contra el deportista ({fmt(fila.gramos_usuario)} g): <strong>{textoDiferencia(diferencia(gramosNuevos as number, fila.gramos_usuario))}</strong>
                            </p>
                          )}
                        </>
                      )}
                    </div>
                  </div>
                )}
              </fieldset>
            )}

            {!pendiente && (
              <p className="text-sm text-slate-700">
                {fila.estado_revision === 'confirmado' ? 'Confirmado' : 'Corregido'}
                {fila.revisor_nombre ? ` por ${fila.revisor_nombre}` : ''}
                {fila.revisado_en ? ` el ${formatFechaCorta(fila.revisado_en)}` : ''}.
              </p>
            )}

            <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-800">
              <input
                type="checkbox"
                checked={ejemplo}
                disabled={trabajando}
                onChange={() => ejecutar(() => marcarCandidatoAction(fila.id_deteccion_item, !ejemplo), () => setEjemplo(!ejemplo))}
                className="h-4 w-4 accent-blue-600"
              />
              Ejemplo para la IA
            </label>

            {error && (
              <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">
                {error}
              </p>
            )}
          </div>
        </div>
      )}
    </Modal>
  );
}
