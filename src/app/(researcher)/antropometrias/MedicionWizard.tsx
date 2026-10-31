'use client';

/**
 * Asistente de carga de una medición (NUT-239/240): datos básicos → diámetros →
 * perímetros → pliegues → revisión. Pensado para cargarse desde el celular:
 * teclado numérico, coma decimal y Enter pasa al campo siguiente.
 *
 * Mientras la medición es un borrador se autoguarda (debounce); una medición ya
 * generada ("vigente") se edita sin autoguardado y se guarda de una vez.
 */
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from 'react';
import Card from '@/components/researcher/Card';
import { CONTROL_CLASS } from '@/components/researcher/FilterBar';
import Button from '@/components/ui/Button';
import {
  deportesDisponibles,
  DEPORTE_NINGUNO,
  NIVELES_ACTIVIDAD,
  VARIABLES,
  type NivelActividad,
  type SeriesPorVariable,
} from '@/lib/antropometria';
import { FACTORES_ACTIVIDAD } from '@/lib/antropometria/datos/actividad';
import { parseDateLocal } from '@/lib/dates';
import { fmt } from '@/lib/numeros';
import {
  campoInvalido,
  estadoVariable,
  MAX_SERIES,
  PASOS,
  progresoPorGrupo,
  seriesDesdeTexto,
  textoDesdeSeries,
  textoVacio,
  TITULO_GRUPO,
  TOTAL_VARIABLES,
  totalCompletas,
  type TextoSeries,
} from '@/lib/researcher/antropometria/asistente';
import {
  edadEn,
  esMayorDeEdad,
  fechaLegible,
  medicionesDelMismoMes,
  MENSAJE_MENOR_DE_EDAD,
} from '@/lib/researcher/antropometria/reglas';
import { rutaFicha, rutaInforme } from '@/lib/researcher/antropometria/rutas';
import type { PacienteAntropometria } from '@/types/antropometria';
import { finalizarMedicionAction, guardarBorradorAction } from './actions';

export interface InicialMedicion {
  id: string;
  estado: 'borrador' | 'vigente';
  fechaMedicion: string;
  nivelActividad: NivelActividad | null;
  deporte: string | null;
  series: SeriesPorVariable;
}

interface Props {
  paciente: PacienteAntropometria;
  /** Otras mediciones vigentes del paciente (para avisar si ya hay una en el mismo mes). */
  otrasVigentes: { id: string; fecha_medicion: string }[];
  /** AAAA-MM-DD de hoy en Argentina (lo calcula el servidor). */
  hoy: string;
  inicial: InicialMedicion | null;
}

type EstadoBorrador = 'inactivo' | 'guardando' | 'guardado' | 'error';

const AUTOGUARDADO_MS = 1500;
const ETIQUETA = 'mb-1 block text-sm font-medium text-slate-700';
const INPUT_SERIE =
  'h-12 w-full rounded-lg border border-slate-300 bg-white px-3 text-base tabular-nums text-slate-900 placeholder:text-slate-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/30';

export default function MedicionWizard({ paciente, otrasVigentes, hoy, inicial }: Props) {
  const router = useRouter();
  const editandoVigente = inicial?.estado === 'vigente';

  const [paso, setPaso] = useState(0);
  const [fecha, setFecha] = useState(inicial?.fechaMedicion ?? hoy);
  const [nivel, setNivel] = useState<NivelActividad | ''>(inicial?.nivelActividad ?? '');
  const [deporte, setDeporte] = useState(inicial?.deporte ?? '');
  const [sexoExtra, setSexoExtra] = useState<'' | 'M' | 'F'>('');
  const [nacimientoExtra, setNacimientoExtra] = useState('');
  const [texto, setTexto] = useState<TextoSeries>(() => (inicial ? textoDesdeSeries(inicial.series) : textoVacio()));
  const [estadoBorrador, setEstadoBorrador] = useState<EstadoBorrador>('inactivo');
  const [errorBorrador, setErrorBorrador] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [guardando, empezarGuardado] = useTransition();

  const sexo = paciente.sexo ?? (sexoExtra || null);
  const nacimiento = paciente.fechaNacimiento ?? (nacimientoExtra || null);
  const fechaDate = parseDateLocal(fecha);
  const fechaValida = fechaDate !== null && fecha <= hoy;
  const esMenor = nacimiento !== null && fechaDate !== null && !esMayorDeEdad(nacimiento, fechaDate);
  const mismoMes = fechaValida ? medicionesDelMismoMes(fecha, otrasVigentes) : [];

  const progreso = useMemo(() => progresoPorGrupo(texto), [texto]);
  const completas = totalCompletas(progreso);
  const faltaContexto = !fechaValida || !nivel || !sexo || !nacimiento;
  const puedeGuardar = completas === TOTAL_VARIABLES && !faltaContexto && !esMenor;

  // ── Autoguardado ──────────────────────────────────────────────────────────
  const contenedor = useRef<HTMLDivElement>(null);
  const sucio = useRef(false);
  const idRef = useRef<string | null>(inicial?.id ?? null);
  const enCurso = useRef<Promise<void> | null>(null);
  const repetir = useRef(false);
  const finalizando = useRef(false);
  const payloadRef = useRef<Record<string, unknown>>({});
  // Lo último que se ve en pantalla, para el autoguardado y el guardado final (se actualiza tras cada render).
  useEffect(() => {
    payloadRef.current = {
      origen: paciente.origen,
      pacienteId: paciente.id,
      fechaMedicion: fecha,
      nivelActividad: nivel || null,
      deporte: deporte || null,
      series: seriesDesdeTexto(texto),
      datosPaciente: { sexo: sexoExtra || null, fechaNacimiento: nacimientoExtra || null },
    };
  });

  const guardarBorrador = useCallback((): Promise<void> => {
    if (finalizando.current) return Promise.resolve();
    if (enCurso.current) {
      repetir.current = true;
      return enCurso.current;
    }
    setEstadoBorrador('guardando');
    // Una sola grabación a la vez (si no, dos primeras grabaciones crearían dos filas); si hubo
    // cambios mientras tanto, se vuelve a grabar con lo último.
    enCurso.current = (async () => {
      do {
        repetir.current = false;
        try {
          const r = await guardarBorradorAction({ ...payloadRef.current, medicionId: idRef.current });
          if ('ok' in r) {
            idRef.current = r.id;
            setEstadoBorrador('guardado');
            setErrorBorrador(null);
          } else {
            setEstadoBorrador('error');
            setErrorBorrador(r.error);
          }
        } catch {
          setEstadoBorrador('error');
          setErrorBorrador('No se pudo guardar el borrador.');
        }
      } while (repetir.current && !finalizando.current);
      enCurso.current = null;
    })();
    return enCurso.current;
  }, []);

  useEffect(() => {
    if (editandoVigente || !sucio.current || !fechaValida || esMenor) return;
    const t = setTimeout(() => void guardarBorrador(), AUTOGUARDADO_MS);
    return () => clearTimeout(t);
  }, [fecha, nivel, deporte, texto, sexoExtra, nacimientoExtra, editandoVigente, fechaValida, esMenor, guardarBorrador]);

  function tocar() {
    sucio.current = true;
  }

  function cambiarCampo(clave: string, indice: number, valor: string) {
    tocar();
    setTexto((t) => ({ ...t, [clave]: t[clave as keyof TextoSeries].map((v, i) => (i === indice ? valor : v)) }));
  }

  function siguienteCampo(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const campos = Array.from(contenedor.current?.querySelectorAll<HTMLInputElement>('input[data-serie]') ?? []);
    campos[campos.indexOf(e.currentTarget) + 1]?.focus();
  }

  function guardarYGenerar() {
    setError(null);
    finalizando.current = true;
    empezarGuardado(async () => {
      try {
        await enCurso.current;
        const r = await finalizarMedicionAction({ ...payloadRef.current, medicionId: idRef.current });
        if ('ok' in r) {
          router.push(rutaInforme(r.id));
          return;
        }
        setError(r.error);
      } catch {
        setError('No se pudo guardar la medición. Probá de nuevo.');
      }
      finalizando.current = false;
    });
  }

  // ── Render ────────────────────────────────────────────────────────────────
  const pasoActual = PASOS[paso];
  const deportes = sexo ? deportesDisponibles(sexo) : [];
  const edad = nacimiento ? edadEn(nacimiento, fechaDate ?? new Date()) : null;

  return (
    <div className="space-y-4" ref={contenedor}>
      {esMenor && (
        <p role="alert" className="rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-800">
          {MENSAJE_MENOR_DE_EDAD}
        </p>
      )}
      {editandoVigente && (
        <p role="status" className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm text-blue-900">
          Estás editando una medición ya generada. Los cambios se aplican cuando tocás &quot;Guardar cambios&quot; y el informe se recalcula con los valores nuevos.
        </p>
      )}

      <nav aria-label="Pasos de la medición">
        <ol className="flex flex-wrap gap-2">
          {PASOS.map((p, i) => {
            const g = progreso.find((x) => x.grupo === p.id);
            const lista = g ? g.completas === g.total : completas === TOTAL_VARIABLES;
            return (
              <li key={p.id}>
                <button
                  type="button"
                  onClick={() => setPaso(i)}
                  aria-current={i === paso ? 'step' : undefined}
                  className={`rounded-full px-3 py-1.5 text-sm font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${
                    i === paso ? 'bg-blue-700 text-white' : lista ? 'bg-green-100 text-green-900' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                  }`}
                >
                  {i + 1}. {p.titulo}
                  {g && (
                    <span className="ml-1 text-xs opacity-80">
                      {g.completas}/{g.total}
                    </span>
                  )}
                </button>
              </li>
            );
          })}
        </ol>
      </nav>

      <div role="status" aria-live="polite" className="min-h-5 text-xs text-slate-600">
        {editandoVigente
          ? null
          : estadoBorrador === 'guardando'
            ? 'Guardando borrador…'
            : estadoBorrador === 'guardado'
              ? 'Borrador guardado'
              : estadoBorrador === 'error'
                ? `No se pudo guardar el borrador: ${errorBorrador ?? 'error desconocido'}`
                : 'Se guarda solo como borrador mientras cargás.'}
      </div>

      {pasoActual.id === 'basicas' && (
        <Card className="space-y-4 p-4 sm:p-6">
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="fecha-medicion" className={ETIQUETA}>
                Fecha de medición
              </label>
              <input
                id="fecha-medicion"
                type="date"
                max={hoy}
                value={fecha}
                onChange={(e) => {
                  tocar();
                  setFecha(e.target.value);
                }}
                className={CONTROL_CLASS}
              />
              {!fechaValida && <p className="mt-1 text-xs text-red-700">Ingresá una fecha que no sea futura.</p>}
              {mismoMes.length > 0 && (
                <p role="status" className="mt-1 text-xs text-amber-800">
                  Ya hay una medición de este mes ({mismoMes.map((m) => fechaLegible(m.fecha_medicion)).join(', ')}). Podés guardar igual.
                </p>
              )}
            </div>

            <div>
              <label htmlFor="nivel-actividad" className={ETIQUETA}>
                Nivel de actividad
              </label>
              <select
                id="nivel-actividad"
                value={nivel}
                onChange={(e) => {
                  tocar();
                  setNivel(e.target.value as NivelActividad | '');
                }}
                className={CONTROL_CLASS}
              >
                <option value="">Elegí una opción</option>
                {NIVELES_ACTIVIDAD.map((n) => (
                  <option key={n} value={n}>
                    {FACTORES_ACTIVIDAD[n].categoria} ({FACTORES_ACTIVIDAD[n].codigo})
                  </option>
                ))}
              </select>
            </div>
          </div>

          {(paciente.sexo === null || paciente.fechaNacimiento === null) && (
            <div className="grid gap-4 rounded-lg border border-amber-200 bg-amber-50 p-3 sm:grid-cols-2">
              <p className="text-sm text-amber-900 sm:col-span-2">
                Este deportista no completó estos datos en la app. Se guardan una sola vez y no pisan nada.
              </p>
              {paciente.sexo === null && (
                <div>
                  <label htmlFor="sexo-paciente" className={ETIQUETA}>
                    Sexo
                  </label>
                  <select
                    id="sexo-paciente"
                    value={sexoExtra}
                    onChange={(e) => {
                      tocar();
                      setSexoExtra(e.target.value as '' | 'M' | 'F');
                      setDeporte('');
                    }}
                    className={CONTROL_CLASS}
                  >
                    <option value="">Elegí una opción</option>
                    <option value="F">Femenino</option>
                    <option value="M">Masculino</option>
                  </select>
                </div>
              )}
              {paciente.fechaNacimiento === null && (
                <div>
                  <label htmlFor="nacimiento-paciente" className={ETIQUETA}>
                    Fecha de nacimiento
                  </label>
                  <input
                    id="nacimiento-paciente"
                    type="date"
                    max={hoy}
                    value={nacimientoExtra}
                    onChange={(e) => {
                      tocar();
                      setNacimientoExtra(e.target.value);
                    }}
                    className={CONTROL_CLASS}
                  />
                  {edad !== null && !esMenor && <p className="mt-1 text-xs text-slate-600">Edad: {edad} años</p>}
                </div>
              )}
            </div>
          )}

          <div>
            <label htmlFor="deporte" className={ETIQUETA}>
              Deporte <span className="font-normal text-slate-500">(opcional, para comparar el somatotipo)</span>
            </label>
            <select
              id="deporte"
              value={deporte}
              disabled={!sexo}
              onChange={(e) => {
                tocar();
                setDeporte(e.target.value);
              }}
              className={CONTROL_CLASS}
            >
              <option value="">Sin comparación</option>
              {deportes.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.nombre}
                </option>
              ))}
            </select>
            {!sexo && <p className="mt-1 text-xs text-slate-600">Elegí primero el sexo.</p>}
          </div>
        </Card>
      )}

      {pasoActual.id !== 'revision' && (
        <Card className="space-y-3 p-4 sm:p-6">
          <h2 className="text-base font-semibold text-slate-900">{TITULO_GRUPO[pasoActual.id]}</h2>
          <p className="text-xs text-slate-600">
            Cargá 2 o 3 series por variable, siempre del lado derecho y en el mismo orden. El % de error es solo informativo.
          </p>
          <ul className="space-y-3">
            {VARIABLES.filter((v) => v.grupo === pasoActual.id).map((v) => {
              const estado = estadoVariable(texto[v.clave], v.clave);
              const e = estado.estadistica;
              return (
                <li key={v.clave} className="rounded-xl border border-slate-200 p-3">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="text-sm font-medium text-slate-900">{v.etiqueta}</span>
                    <span className="text-xs text-slate-500">{v.unidad}</span>
                  </div>
                  <div className="mt-2 grid grid-cols-3 gap-2">
                    {Array.from({ length: MAX_SERIES }, (_, i) => (
                      <input
                        key={i}
                        data-serie=""
                        type="text"
                        inputMode="decimal"
                        enterKeyHint="next"
                        autoComplete="off"
                        placeholder={i === 2 ? 'Serie 3 (opcional)' : `Serie ${i + 1}`}
                        aria-label={`${v.etiqueta}, serie ${i + 1}`}
                        aria-invalid={campoInvalido(texto[v.clave][i]) || undefined}
                        value={texto[v.clave][i]}
                        onChange={(ev) => cambiarCampo(v.clave, i, ev.target.value)}
                        onKeyDown={siguienteCampo}
                        onFocus={(ev) => ev.currentTarget.select()}
                        className={`${INPUT_SERIE} ${campoInvalido(texto[v.clave][i]) ? 'border-red-400' : ''}`}
                      />
                    ))}
                  </div>
                  <p className="mt-2 min-h-4 text-xs text-slate-600" aria-live="polite">
                    {e
                      ? `Mediana ${fmt(e.mediana, 2)} · Desvío ${fmt(e.desvioEstandar, 2)} · Error ${fmt(e.errorPorcentual, 1)} %`
                      : 'Faltan series: se necesitan al menos 2.'}
                  </p>
                </li>
              );
            })}
          </ul>
        </Card>
      )}

      {pasoActual.id === 'revision' && (
        <Card className="space-y-4 p-4 sm:p-6">
          <h2 className="text-base font-semibold text-slate-900">
            Revisión: {completas} de {TOTAL_VARIABLES} variables
          </h2>
          <ul className="divide-y divide-slate-100">
            {progreso.map((g) => (
              <li key={g.grupo} className="flex flex-wrap items-center justify-between gap-2 py-3 text-sm">
                <div>
                  <span className="font-medium text-slate-900">{TITULO_GRUPO[g.grupo]}</span>{' '}
                  <span className={g.completas === g.total ? 'text-green-800' : 'text-amber-800'}>
                    {g.completas} de {g.total}
                  </span>
                  {g.faltantes.length > 0 && (
                    <p className="text-xs text-slate-600">Faltan: {g.faltantes.map((f) => f.etiqueta).join(', ')}</p>
                  )}
                </div>
                <Button type="button" variant="outline" size="sm" onClick={() => setPaso(PASOS.findIndex((p) => p.id === g.grupo))}>
                  Editar
                </Button>
              </li>
            ))}
          </ul>

          <dl className="grid gap-2 text-sm sm:grid-cols-3">
            <div>
              <dt className="text-xs text-slate-600">Fecha de medición</dt>
              <dd className="font-medium text-slate-900">{fechaValida ? fechaLegible(fecha) : 'Falta'}</dd>
            </div>
            <div>
              <dt className="text-xs text-slate-600">Nivel de actividad</dt>
              <dd className="font-medium text-slate-900">{nivel ? FACTORES_ACTIVIDAD[nivel].categoria : 'Falta'}</dd>
            </div>
            <div>
              <dt className="text-xs text-slate-600">Deporte</dt>
              <dd className="font-medium text-slate-900">
                {deporte && deporte !== DEPORTE_NINGUNO ? (deportes.find((d) => d.id === deporte)?.nombre ?? deporte) : 'Sin comparación'}
              </dd>
            </div>
          </dl>
          {faltaContexto && (
            <p className="text-sm text-amber-800">
              Antes de generar el informe completá en &quot;Datos básicos&quot; la fecha, el nivel de actividad
              {paciente.sexo === null || paciente.fechaNacimiento === null ? ', el sexo y la fecha de nacimiento' : ''}.
            </p>
          )}
          {error && (
            <p role="alert" className="text-sm text-red-700">
              {error}
            </p>
          )}
          <div className="flex flex-wrap gap-3">
            <Button type="button" onClick={guardarYGenerar} disabled={!puedeGuardar} loading={guardando}>
              {editandoVigente ? 'Guardar cambios' : 'Guardar y generar informe'}
            </Button>
            <Button type="button" variant="ghost" onClick={() => setPaso(0)}>
              Volver a editar
            </Button>
          </div>
          {!puedeGuardar && !faltaContexto && !esMenor && (
            <p className="text-xs text-slate-600">El botón se habilita cuando están las 25 variables completas.</p>
          )}
        </Card>
      )}

      <div className="flex items-center justify-between gap-3">
        <Link
          href={rutaFicha(paciente.origen, paciente.id)}
          className="rounded px-2 py-1 text-sm text-slate-600 hover:text-slate-900 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
        >
          Salir
        </Link>
        <div className="flex gap-2">
          <Button type="button" variant="outline" disabled={paso === 0} onClick={() => setPaso((p) => p - 1)}>
            Anterior
          </Button>
          {paso < PASOS.length - 1 && (
            <Button type="button" onClick={() => setPaso((p) => p + 1)}>
              {paso === PASOS.length - 2 ? 'Revisar' : 'Siguiente'}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
