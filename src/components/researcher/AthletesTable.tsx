'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Avatar from './Avatar';
import EmptyState from './EmptyState';
import FilterBar, { type FilterField } from './FilterBar';
import { CARD_CLASS } from './Card';
import StatusBadge, { type BadgeTone } from './StatusBadge';

export interface AthleteRow {
  user_id: string;
  nombre: string;
  apellido: string;
  email: string;
  created_at: string;
  sexo: 'M' | 'F' | null;
  deporte: 'hockey' | 'basquet' | null;
  compliance: number;
  unidad_academica: string | null;
  carrera: string | null;
  anio: number | null;
}

interface Props {
  athletes: AthleteRow[];
  onSelectionChange: (ids: string[]) => void;
  onRowClick: (athlete: AthleteRow) => void;
}

const DEPORTE_TONE: Record<string, BadgeTone> = {
  basquet: 'blue',
  hockey: 'emerald',
};
const DEPORTE_LABELS: Record<string, string> = {
  basquet: 'Básquet',
  hockey: 'Hockey',
};
const SEXO_LABELS: Record<string, string> = { F: 'Femenino', M: 'Masculino' };

function complianceTone(pct: number): BadgeTone {
  if (pct >= 80) return 'emerald';
  if (pct >= 50) return 'amber';
  return 'rose';
}

function normalizeStr(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
}

export default function AthletesTable({ athletes, onSelectionChange, onRowClick }: Props) {
  const [query, setQuery] = useState('');
  const [unidadFilter, setUnidadFilter] = useState('');
  const [carreraFilter, setCarreraFilter] = useState('');
  const [anioFilter, setAnioFilter] = useState('');
  const [deporteFilter, setDeporteFilter] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const selectionRef = useRef(onSelectionChange);
  selectionRef.current = onSelectionChange;

  useEffect(() => {
    selectionRef.current([...selectedIds]);
  }, [selectedIds]);

  const unidades = useMemo(
    () => [...new Set(athletes.map((a) => a.unidad_academica).filter(Boolean) as string[])].sort(),
    [athletes],
  );
  const carreras = useMemo(() => {
    const base = unidadFilter
      ? athletes.filter((a) => a.unidad_academica === unidadFilter)
      : athletes;
    return [...new Set(base.map((a) => a.carrera).filter(Boolean) as string[])].sort();
  }, [athletes, unidadFilter]);
  const anios = useMemo(
    () =>
      [...new Set(athletes.map((a) => a.anio).filter((v): v is number => v !== null))].sort(
        (a, b) => b - a,
      ),
    [athletes],
  );

  const filtered = useMemo(() => {
    const q = normalizeStr(query.trim());
    const an = anioFilter ? Number(anioFilter) : null;

    return athletes.filter((a) => {
      if (q) {
        const tokens = normalizeStr(`${a.nombre} ${a.apellido} ${a.email}`).split(/\s+/);
        const words = q.split(/\s+/).filter(Boolean);
        if (!words.every((w) => tokens.some((t) => t.startsWith(w)))) return false;
      }
      if (unidadFilter && a.unidad_academica !== unidadFilter) return false;
      if (carreraFilter && a.carrera !== carreraFilter) return false;
      if (an !== null && a.anio !== an) return false;
      if (deporteFilter && a.deporte !== deporteFilter) return false;
      return true;
    });
  }, [athletes, query, unidadFilter, carreraFilter, anioFilter, deporteFilter]);

  useEffect(() => {
    if (carreraFilter && !carreras.includes(carreraFilter)) {
      setCarreraFilter('');
    }
  }, [carreras, carreraFilter]);

  const allFilteredSelected =
    filtered.length > 0 && filtered.every((a) => selectedIds.has(a.user_id));
  const someFilteredSelected =
    !allFilteredSelected && filtered.some((a) => selectedIds.has(a.user_id));

  const handleSelectAll = useCallback(() => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (allFilteredSelected) {
        filtered.forEach((a) => next.delete(a.user_id));
      } else {
        filtered.forEach((a) => next.add(a.user_id));
      }
      return next;
    });
  }, [filtered, allFilteredSelected]);

  const handleToggle = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const selectAllRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (selectAllRef.current) {
      selectAllRef.current.indeterminate = someFilteredSelected;
    }
  }, [someFilteredSelected]);

  const activeFilters = [unidadFilter, carreraFilter, anioFilter, deporteFilter].filter(Boolean)
    .length;

  function clearFilters() {
    setQuery('');
    setUnidadFilter('');
    setCarreraFilter('');
    setAnioFilter('');
    setDeporteFilter('');
  }

  const campos: FilterField[] = [
    { type: 'search', id: 'query', label: 'Buscar', value: query, placeholder: 'Nombre, apellido o email' },
    { type: 'select', id: 'unidad', label: 'Unidad académica', value: unidadFilter, width: 'lg', options: [{ value: '', label: 'Todas' }, ...unidades.map((u) => ({ value: u, label: u }))] },
    { type: 'select', id: 'carrera', label: 'Carrera', value: carreraFilter, width: 'lg', disabled: carreras.length === 0, options: [{ value: '', label: 'Todas' }, ...carreras.map((c) => ({ value: c, label: c }))] },
    { type: 'select', id: 'anio', label: 'Año ingreso', value: anioFilter, width: 'sm', options: [{ value: '', label: 'Todos' }, ...anios.map((y) => ({ value: String(y), label: String(y) }))] },
    { type: 'select', id: 'deporte', label: 'Deporte', value: deporteFilter, width: 'sm', options: [{ value: '', label: 'Todos' }, { value: 'basquet', label: 'Básquet' }, { value: 'hockey', label: 'Hockey' }] },
  ];

  // Deportistas filtra en memoria: la búsqueda se aplica al instante (sin debounce) y el estado vive acá, no en la URL.
  function cambiarFiltro(id: string, value: string) {
    if (id === 'query') setQuery(value);
    else if (id === 'unidad') {
      setUnidadFilter(value);
      setCarreraFilter('');
    } else if (id === 'carrera') setCarreraFilter(value);
    else if (id === 'anio') setAnioFilter(value);
    else if (id === 'deporte') setDeporteFilter(value);
  }

  return (
    <div className="space-y-4">
      <FilterBar fields={campos} onChange={cambiarFiltro} onClear={clearFilters} canClear={activeFilters > 0 || query !== ''} debounceMs={0} />

      <div className={CARD_CLASS}>
        <div className="border-b border-slate-100 px-5 py-4">
          <p className="text-sm text-slate-500">
            {filtered.length !== athletes.length
              ? `${filtered.length} de ${athletes.length} deportista${athletes.length !== 1 ? 's' : ''}`
              : `${athletes.length} deportista${athletes.length !== 1 ? 's' : ''} registrado${athletes.length !== 1 ? 's' : ''}`}
            {selectedIds.size > 0 && (
              <span className="ml-2 font-medium text-blue-700">
                · {selectedIds.size} seleccionado{selectedIds.size !== 1 ? 's' : ''}
              </span>
            )}
          </p>
        </div>

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-100 bg-slate-50/60 text-left text-xs uppercase tracking-wide text-slate-500">
              <th className="w-10 px-4 py-3">
                <input
                  ref={selectAllRef}
                  type="checkbox"
                  checked={allFilteredSelected}
                  onChange={handleSelectAll}
                  aria-label="Seleccionar todos"
                  className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                />
              </th>
              <th className="px-5 py-3 font-medium">Deportista</th>
              <th className="px-5 py-3 font-medium">Deporte</th>
              <th className="px-5 py-3 font-medium">Sexo</th>
              <th className="px-5 py-3 font-medium">Carrera</th>
              <th className="px-5 py-3 font-medium">Año ingreso</th>
              <th className="px-5 py-3 text-right font-medium">Cumple</th>
              <th className="px-5 py-3 text-center font-medium">Acciones</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-50">
            {filtered.map((a) => (
              <tr key={a.user_id} className="transition-colors hover:bg-slate-50">
                <td className="w-10 px-4 py-3" onClick={(e) => e.stopPropagation()}>
                  <input
                    type="checkbox"
                    checked={selectedIds.has(a.user_id)}
                    onChange={() => handleToggle(a.user_id)}
                    aria-label={`Seleccionar ${a.nombre} ${a.apellido}`}
                    className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                  />
                </td>
                <td className="cursor-pointer px-5 py-3" onClick={() => onRowClick(a)}>
                  <div className="flex items-center gap-3">
                    <Avatar nombre={a.nombre} apellido={a.apellido} size="sm" />
                    <div className="min-w-0">
                      <p className="truncate font-medium text-slate-900">
                        {a.nombre} {a.apellido}
                      </p>
                      <p className="truncate text-xs text-slate-500">{a.email}</p>
                    </div>
                  </div>
                </td>
                <td className="cursor-pointer px-5 py-3" onClick={() => onRowClick(a)}>
                  {a.deporte ? (
                    <StatusBadge tone={DEPORTE_TONE[a.deporte] ?? 'slate'}>{DEPORTE_LABELS[a.deporte] ?? a.deporte}</StatusBadge>
                  ) : (
                    <span className="text-slate-300">—</span>
                  )}
                </td>
                <td className="cursor-pointer px-5 py-3 text-slate-600" onClick={() => onRowClick(a)}>
                  {a.sexo ? SEXO_LABELS[a.sexo] : <span className="text-slate-300">—</span>}
                </td>
                <td
                  className="cursor-pointer px-5 py-3 text-slate-600"
                  onClick={() => onRowClick(a)}
                  style={{ maxWidth: '180px' }}
                >
                  {a.carrera ? (
                    <span className="block truncate text-xs">{a.carrera}</span>
                  ) : (
                    <span className="text-slate-300">—</span>
                  )}
                </td>
                <td className="cursor-pointer px-5 py-3 text-slate-600" onClick={() => onRowClick(a)}>
                  {a.anio ?? <span className="text-slate-300">—</span>}
                </td>
                <td className="cursor-pointer px-5 py-3 text-right" onClick={() => onRowClick(a)}>
                  <div className="flex items-center justify-end gap-2">
                    <div className="h-2 w-20 overflow-hidden rounded-full bg-slate-100">
                      <div
                        className={`h-full rounded-full ${
                          a.compliance >= 80
                            ? 'bg-emerald-500'
                            : a.compliance >= 50
                              ? 'bg-amber-400'
                              : 'bg-rose-400'
                        }`}
                        style={{ width: `${a.compliance}%` }}
                      />
                    </div>
                    <StatusBadge tone={complianceTone(a.compliance)} className="font-semibold">
                      {a.compliance}%
                    </StatusBadge>
                  </div>
                </td>
                <td className="px-5 py-3 text-center">
                  <button
                    onClick={() => onRowClick(a)}
                    className="text-xs font-medium text-blue-600 transition-colors hover:text-blue-800 hover:underline"
                  >
                    Ver detalle
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {filtered.length === 0 && (
          <EmptyState
            title={athletes.length === 0 ? 'No hay deportistas registrados aún.' : 'No se encontraron deportistas con los filtros aplicados.'}
            action={
              athletes.length > 0 ? (
                <button type="button" onClick={clearFilters} className="text-sm font-medium text-blue-700 hover:underline">
                  Limpiar filtros
                </button>
              ) : undefined
            }
          />
        )}
      </div>
      </div>
    </div>
  );
}
