'use client';

/**
 * Barra de filtros estándar del panel de investigador. Sin botón "Filtrar": los
 * selects y las fechas se aplican apenas cambian y la búsqueda de texto con
 * debounce (`debounceMs`; 0 = al instante, para listas que filtran en memoria).
 * Una sola fila desde 1024 px (búsqueda de ancho flexible, selects y fechas
 * compactos con ancho fijo); por debajo pasan a otra línea, sin scroll horizontal.
 *
 * Es presentacional: el que la usa decide dónde vive el estado (URL, memoria).
 * `onChange` puede devolver una promesa: la barra muestra "actualizando" hasta que
 * termine la ÚLTIMA y descarta lo que digan las anteriores (respuestas viejas).
 */
import { useEffect, useRef, useState } from 'react';
import { CARD_CLASS } from './Card';

export interface SelectOption {
  value: string;
  label: string;
}

type Ancho = 'sm' | 'md' | 'lg';

export type FilterField =
  | { type: 'search'; id: string; label: string; value: string; placeholder?: string }
  | { type: 'select'; id: string; label: string; value: string; options: SelectOption[]; width?: Ancho; disabled?: boolean }
  | {
      type: 'date';
      id: string;
      label: string;
      value: string;
      /** YYYY-MM-DD; un valor fuera de rango no se aplica y se muestra `invalidMessage`. */
      min?: string;
      max?: string;
      invalidMessage?: string;
    };

interface Props {
  fields: FilterField[];
  onChange: (id: string, value: string) => void | Promise<unknown>;
  onClear?: () => void | Promise<unknown>;
  /** Hay filtros distintos de los de por defecto: muestra "Limpiar". */
  canClear?: boolean;
  debounceMs?: number;
  /** Carga en curso decidida por afuera (ej. transición de ruta). */
  busy?: boolean;
  ariaLabel?: string;
}

/** Ancho fijo desde 1024 px; por debajo, 2 por fila (≥ 640 px) o 1 por fila. */
const ANCHO: Record<Ancho, string> = { sm: 'lg:w-32', md: 'lg:w-40', lg: 'lg:w-48' };
const RESPONSIVE = 'w-full sm:w-[calc(50%-0.375rem)] lg:shrink-0';

export const CONTROL_CLASS =
  'h-10 w-full rounded-lg border border-slate-200 bg-slate-50 px-3 text-sm text-slate-700 placeholder:text-slate-500 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/30 disabled:opacity-50';
const LABEL_CLASS = 'mb-1 block text-xs font-medium text-slate-600';

const esTexto = (f: FilterField) => f.type === 'search' || f.type === 'date';

export default function FilterBar({ fields, onChange, onClear, canClear = false, debounceMs = 300, busy = false, ariaLabel = 'Filtros' }: Props) {
  // Valor que se ve en los campos de texto y fecha (puede ir por delante del aplicado mientras se espera el debounce).
  const [local, setLocal] = useState<Record<string, string>>(() => Object.fromEntries(fields.filter(esTexto).map((f) => [f.id, f.value])));
  const [errores, setErrores] = useState<Record<string, string>>({});
  const [cargando, setCargando] = useState(false);
  const timers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const emitido = useRef<Record<string, string>>({});
  const secuencia = useRef(0);

  // Cambios que vienen de afuera (ej. "Limpiar", botón Atrás): se reflejan. El eco de lo que acabamos de emitir se ignora,
  // para que una respuesta lenta no pise lo que el usuario siguió escribiendo.
  const firma = fields.filter(esTexto).map((f) => `${f.id}=${f.value}`).join('&');
  useEffect(() => {
    setLocal((prev) => {
      const next = { ...prev };
      for (const f of fields.filter(esTexto)) {
        if (f.value !== emitido.current[f.id]) {
          next[f.id] = f.value;
          emitido.current[f.id] = f.value;
        }
      }
      return next;
    });
    setErrores({});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [firma]);

  useEffect(() => {
    const t = timers.current;
    return () => Object.values(t).forEach(clearTimeout);
  }, []);

  function emitir(id: string, value: string) {
    emitido.current[id] = value;
    const mia = ++secuencia.current;
    const resultado = onChange(id, value);
    if (resultado && typeof (resultado as Promise<unknown>).then === 'function') {
      setCargando(true);
      // Sólo la última petición apaga el indicador; las anteriores se descartan.
      Promise.resolve(resultado).then(
        () => mia === secuencia.current && setCargando(false),
        () => mia === secuencia.current && setCargando(false),
      );
    }
  }

  function cambiarTexto(f: FilterField, value: string) {
    setLocal((p) => ({ ...p, [f.id]: value }));
    clearTimeout(timers.current[f.id]);
    if (debounceMs <= 0) emitir(f.id, value);
    else timers.current[f.id] = setTimeout(() => emitir(f.id, value), debounceMs);
  }

  function cambiarFecha(f: Extract<FilterField, { type: 'date' }>, e: React.ChangeEvent<HTMLInputElement>) {
    const value = e.target.value;
    setLocal((p) => ({ ...p, [f.id]: value }));
    // Fecha a medio escribir (el navegador informa '' con badInput): no se consulta.
    if (e.target.validity.badInput) return;
    const fuera = value !== '' && ((f.min && value < f.min) || (f.max && value > f.max));
    if (fuera) {
      setErrores((p) => ({ ...p, [f.id]: f.invalidMessage ?? 'La fecha está fuera de rango.' }));
      return;
    }
    setErrores((p) => {
      const resto = { ...p };
      delete resto[f.id];
      return resto;
    });
    emitir(f.id, value);
  }

  const mensajes = Object.values(errores);
  const ocupado = busy || cargando;

  return (
    <div role="search" aria-label={ariaLabel} aria-busy={ocupado} className={`${CARD_CLASS} p-4`}>
      <div className="flex flex-wrap items-end gap-3 lg:flex-nowrap">
        {fields.map((f) => {
          const inputId = `filtro-${f.id}`;
          if (f.type === 'search') {
            return (
              <div key={f.id} className="min-w-0 flex-1 basis-full sm:basis-60 lg:min-w-[9rem]">
                <label htmlFor={inputId} className={LABEL_CLASS}>
                  {f.label}
                </label>
                <div className="relative">
                  <svg className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8} aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" d="m21 21-4.35-4.35M17 11a6 6 0 1 1-12 0 6 6 0 0 1 12 0Z" />
                  </svg>
                  <input
                    id={inputId}
                    type="search"
                    value={local[f.id] ?? ''}
                    onChange={(e) => cambiarTexto(f, e.target.value)}
                    placeholder={f.placeholder}
                    className={`${CONTROL_CLASS} pl-9`}
                  />
                </div>
              </div>
            );
          }
          if (f.type === 'select') {
            return (
              <div key={f.id} className={`${RESPONSIVE} ${ANCHO[f.width ?? 'md']}`}>
                <label htmlFor={inputId} className={LABEL_CLASS}>
                  {f.label}
                </label>
                <select id={inputId} value={f.value} disabled={f.disabled} onChange={(e) => emitir(f.id, e.target.value)} className={CONTROL_CLASS}>
                  {f.options.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </div>
            );
          }
          return (
            <div key={f.id} className={`${RESPONSIVE} lg:w-36`}>
              <label htmlFor={inputId} className={LABEL_CLASS}>
                {f.label}
              </label>
              <input
                id={inputId}
                type="date"
                value={local[f.id] ?? ''}
                min={f.min}
                max={f.max}
                aria-invalid={errores[f.id] ? true : undefined}
                onChange={(e) => cambiarFecha(f, e)}
                className={`${CONTROL_CLASS} ${errores[f.id] ? 'border-red-400' : ''}`}
              />
            </div>
          );
        })}

        {canClear && onClear && (
          <button
            type="button"
            onClick={() => {
              Object.values(timers.current).forEach(clearTimeout);
              onClear();
            }}
            className="h-10 shrink-0 rounded-lg px-3 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
          >
            Limpiar
          </button>
        )}

        {/* Espacio fijo: el indicador aparece sin mover el resto de la fila. */}
        <span role="status" className="flex h-10 w-5 shrink-0 items-center justify-center">
          {ocupado && (
            <>
              <svg className="h-4 w-4 animate-spin text-slate-500" fill="none" viewBox="0 0 24 24" aria-hidden="true">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
              </svg>
              <span className="sr-only">Actualizando resultados</span>
            </>
          )}
        </span>
      </div>

      <div aria-live="polite" className="empty:hidden">
        {mensajes.map((m) => (
          <p key={m} className="mt-2 text-xs text-red-700">
            {m}
          </p>
        ))}
      </div>
    </div>
  );
}
