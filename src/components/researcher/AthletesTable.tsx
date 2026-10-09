'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Avatar from './Avatar';

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

const DEPORTE_BADGE: Record<string, string> = {
  basquet: 'bg-blue-50 text-blue-700',
  hockey: 'bg-emerald-50 text-emerald-700',
};
const DEPORTE_LABELS: Record<string, string> = {
  basquet: 'Básquet',
  hockey: 'Hockey',
};
const SEXO_LABELS: Record<string, string> = { F: 'Femenino', M: 'Masculino' };

function complianceTone(pct: number): string {
  if (pct >= 80) return 'bg-emerald-50 text-emerald-700';
  if (pct >= 50) return 'bg-amber-50 text-amber-700';
  return 'bg-rose-50 text-rose-700';
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

  return (
    <div className="rounded-2xl bg-white shadow-sm ring-1 ring-slate-100">
      {/* Header + filters */}
      <div className="border-b border-slate-100 p-5 space-y-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-lg font-bold text-slate-900">Deportistas</h2>
            <p className="text-sm text-slate-500">
              {filtered.length !== athletes.length
                ? `${filtered.length} de ${athletes.length} deportista${athletes.length !== 1 ? 's' : ''}`
                : `${athletes.length} deportista${athletes.length !== 1 ? 's' : ''} registrado${athletes.length !== 1 ? 's' : ''}`}
              {selectedIds.size > 0 && (
                <span className="ml-2 font-medium text-blue-600">
                  · {selectedIds.size} seleccionado{selectedIds.size !== 1 ? 's' : ''}
                </span>
              )}
            </p>
          </div>
          <div className="relative sm:w-64">
            <svg
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-500"
              width="18"
              height="18"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={1.8}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="m21 21-4.35-4.35M17 11a6 6 0 1 1-12 0 6 6 0 0 1 12 0Z"
              />
            </svg>
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Buscar deportista..."
              className="w-full rounded-xl border border-slate-200 bg-slate-50 py-2 pl-10 pr-3 text-sm text-slate-900 placeholder:text-slate-500 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/30"
            />
          </div>
        </div>

        {/* Filter dropdowns */}
        <div className="flex flex-wrap items-center gap-2">
          <span className="flex items-center gap-1 text-xs font-medium uppercase tracking-wide text-slate-500">
            <svg
              className="h-3.5 w-3.5"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2a1 1 0 01-.293.707L13 13.414V19a1 1 0 01-.553.894l-4 2A1 1 0 017 21v-7.586L3.293 6.707A1 1 0 013 6V4z"
              />
            </svg>
            Filtros
          </span>

          <select
            value={unidadFilter}
            onChange={(e) => {
              setUnidadFilter(e.target.value);
              setCarreraFilter('');
            }}
            className="rounded-lg border border-slate-200 bg-slate-50 py-1.5 pl-3 pr-8 text-xs text-slate-700 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/30"
          >
            <option value="">Unidad académica</option>
            {unidades.map((u) => (
              <option key={u} value={u}>
                {u}
              </option>
            ))}
          </select>

          <select
            value={carreraFilter}
            onChange={(e) => setCarreraFilter(e.target.value)}
            disabled={carreras.length === 0}
            className="rounded-lg border border-slate-200 bg-slate-50 py-1.5 pl-3 pr-8 text-xs text-slate-700 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/30 disabled:opacity-50"
          >
            <option value="">Carrera</option>
            {carreras.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>

          <select
            value={anioFilter}
            onChange={(e) => setAnioFilter(e.target.value)}
            className="rounded-lg border border-slate-200 bg-slate-50 py-1.5 pl-3 pr-8 text-xs text-slate-700 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/30"
          >
            <option value="">Año ingreso</option>
            {anios.map((y) => (
              <option key={y} value={String(y)}>
                {y}
              </option>
            ))}
          </select>

          <select
            value={deporteFilter}
            onChange={(e) => setDeporteFilter(e.target.value)}
            className="rounded-lg border border-slate-200 bg-slate-50 py-1.5 pl-3 pr-8 text-xs text-slate-700 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/30"
          >
            <option value="">Deporte</option>
            <option value="basquet">Básquet</option>
            <option value="hockey">Hockey</option>
          </select>

          {(activeFilters > 0 || query) && (
            <button
              onClick={clearFilters}
              className="rounded-lg px-2.5 py-1.5 text-xs font-medium text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-700"
            >
              Limpiar
            </button>
          )}
        </div>
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
                    <span
                      className={`rounded-full px-2.5 py-1 text-xs font-medium ${
                        DEPORTE_BADGE[a.deporte] ?? 'bg-slate-100 text-slate-600'
                      }`}
                    >
                      {DEPORTE_LABELS[a.deporte] ?? a.deporte}
                    </span>
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
                    <span
                      className={`inline-block rounded-full px-2.5 py-1 text-xs font-semibold ${complianceTone(a.compliance)}`}
                    >
                      {a.compliance}%
                    </span>
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
          <div className="py-10 text-center text-sm text-slate-500">
            {athletes.length === 0
              ? 'No hay deportistas registrados aún.'
              : 'No se encontraron deportistas con los filtros aplicados.'}
          </div>
        )}
      </div>
    </div>
  );
}
