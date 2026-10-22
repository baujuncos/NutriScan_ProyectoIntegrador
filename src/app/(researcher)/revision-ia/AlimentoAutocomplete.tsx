'use client';

/**
 * NUT-149 — Campo de alimento con autocompletado del catálogo (el mismo buscador del resto de la
 * app: `searchAlimentosAction`, con debounce de 300 ms). Elegir una opción pone el nombre EXACTO del
 * catálogo, así un mismo alimento no queda escrito de dos formas; también se puede escribir un nombre
 * que no esté (texto libre, normalizado al guardar). Combobox accesible: flechas, Enter y Esc.
 */
import { useEffect, useId, useRef, useState } from 'react';
import { searchAlimentosAction, type AlimentoOption } from '@/app/alimentacion/actions';
import { CONTROL_CLASS } from '@/components/researcher/FilterBar';

const DEBOUNCE_MS = 300;
const MAX_OPCIONES = 8;

interface Props {
  label: string;
  value: string;
  onChange: (nombre: string) => void;
  error?: string;
  disabled?: boolean;
}

export default function AlimentoAutocomplete({ label, value, onChange, error, disabled }: Props) {
  const id = useId();
  const [opciones, setOpciones] = useState<AlimentoOption[]>([]);
  const [abierto, setAbierto] = useState(false);
  const [activo, setActivo] = useState(-1);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const secuencia = useRef(0); // descarta las respuestas viejas si se sigue escribiendo
  useEffect(() => () => clearTimeout(timer.current), []);

  function escribir(texto: string) {
    onChange(texto);
    setActivo(-1);
    clearTimeout(timer.current);
    const mia = ++secuencia.current;
    if (texto.trim().length < 2) {
      setOpciones([]);
      setAbierto(false);
      return;
    }
    timer.current = setTimeout(async () => {
      const resultados = await searchAlimentosAction(texto, '').catch(() => [] as AlimentoOption[]);
      if (mia !== secuencia.current) return;
      setOpciones(resultados.slice(0, MAX_OPCIONES));
      setAbierto(resultados.length > 0);
    }, DEBOUNCE_MS);
  }

  function elegir(o: AlimentoOption) {
    secuencia.current++; // lo que venga en camino ya no vale
    clearTimeout(timer.current);
    onChange(o.nombre);
    setAbierto(false);
    setActivo(-1);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown' && opciones.length > 0) {
      e.preventDefault();
      setAbierto(true);
      setActivo((a) => (a + 1) % opciones.length);
    } else if (e.key === 'ArrowUp' && opciones.length > 0) {
      e.preventDefault();
      setActivo((a) => (a <= 0 ? opciones.length - 1 : a - 1));
    } else if (e.key === 'Enter' && abierto && activo >= 0) {
      e.preventDefault();
      elegir(opciones[activo]);
    } else if (e.key === 'Escape' && abierto) {
      e.stopPropagation(); // cierra la lista, no el modal
      setAbierto(false);
    }
  }

  const idLista = `${id}-lista`;
  return (
    <div className="relative">
      <label htmlFor={id} className="mb-1 block text-xs font-medium text-slate-600">
        {label}
      </label>
      <input
        id={id}
        type="text"
        role="combobox"
        aria-expanded={abierto}
        aria-controls={idLista}
        aria-autocomplete="list"
        aria-activedescendant={abierto && activo >= 0 ? `${id}-op-${activo}` : undefined}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-error` : undefined}
        autoComplete="off"
        disabled={disabled}
        value={value}
        maxLength={200}
        onChange={(e) => escribir(e.target.value)}
        onKeyDown={onKeyDown}
        onBlur={() => setAbierto(false)}
        placeholder="Buscá en el catálogo o escribí un nombre"
        className={`${CONTROL_CLASS} ${error ? 'border-red-400' : ''}`}
      />
      {abierto && (
        <ul
          id={idLista}
          role="listbox"
          aria-label={`Alimentos para ${label}`}
          className="absolute z-10 mt-1 max-h-56 w-full overflow-auto rounded-lg border border-slate-200 bg-white py-1 shadow-lg"
        >
          {opciones.map((o, i) => (
            <li
              key={`${o.fuente}-${o.id_alimento}`}
              id={`${id}-op-${i}`}
              role="option"
              aria-selected={i === activo}
              // mousedown (no click): se elige antes de que el input pierda el foco y cierre la lista.
              onMouseDown={(e) => {
                e.preventDefault();
                elegir(o);
              }}
              className={`flex cursor-pointer items-baseline justify-between gap-2 px-3 py-1.5 text-sm ${i === activo ? 'bg-blue-50 text-blue-900' : 'text-slate-800 hover:bg-slate-50'}`}
            >
              <span className="truncate">{o.nombre}</span>
              <span className="shrink-0 text-xs text-slate-500">{o.fuente}</span>
            </li>
          ))}
        </ul>
      )}
      {error && (
        <p id={`${id}-error`} className="mt-1 text-xs text-red-700">
          {error}
        </p>
      )}
    </div>
  );
}
