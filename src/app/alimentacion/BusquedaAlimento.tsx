'use client';

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import Modal from '@/components/ui/Modal';
import { searchAlimentosAction, getAlimentosRecientesAction, type AlimentoOption } from './actions';
import { CAMPOS_DEFAULT, campoDeCoincidencia, type CamposBusqueda } from './searchQuery';
import { type IngestaTipo } from '@/lib/nutrition';

export type BusquedaAlimentoHandle = { focus: () => void; clear: () => void };

type FuenteFiltro = 'todas' | 'SARA2' | 'ANMAT';

/**
 * Una fila de resultado (búsqueda o "Recientes"): nombre, "Marca · Categoría"
 * (o "Genérico"), denominación completa truncada con tooltip, badge de
 * fuente y el botón "?" opcional. Mismo diseño en ambas listas, como pide el
 * mockup — se factoriza acá para no duplicarlo.
 */
function FilaResultado({
  a,
  query,
  idx,
  activeIndex,
  onSelect,
  onVerDetalle,
}: {
  a: AlimentoOption;
  query: string;
  idx: number;
  activeIndex: number;
  onSelect: (a: AlimentoOption) => void;
  onVerDetalle: (a: AlimentoOption) => void;
}) {
  const campoMatch = query.length >= 2 ? campoDeCoincidencia(a, query) : null;
  const activo = idx === activeIndex;

  return (
    <div
      id={`opt-${a.id_alimento}`}
      role="option"
      aria-selected={activo}
      onMouseDown={() => onSelect(a)}
      className={`w-full text-left px-4 py-3 text-sm border-b border-gray-50 last:border-0 transition-colors cursor-pointer ${
        activo ? 'bg-gray-50' : 'hover:bg-gray-50'
      }`}
    >
      <div className="flex items-center gap-2">
        <span className="font-medium text-gray-900 flex-1 min-w-0 truncate">{a.nombre}</span>
        <span className={`text-xs px-1.5 py-0.5 rounded font-semibold flex-shrink-0 ${
          a.fuente === 'ANMAT' ? 'bg-green-50 text-green-700' : 'bg-blue-50 text-blue-700'
        }`}>
          {a.fuente}
        </span>
        {(a.denominacion || a.categoria) && (
          <button
            type="button"
            aria-label="Ver detalle del alimento"
            onMouseDown={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onVerDetalle(a);
            }}
            className="w-6 h-6 rounded-full bg-blue-500 text-white text-xs font-bold flex-shrink-0 flex items-center justify-center hover:bg-blue-600 transition-colors"
          >
            ?
          </button>
        )}
      </div>
      <p className="text-xs text-gray-400 mt-0.5 truncate">
        <span>{a.marca ?? 'Genérico'}</span>
        {a.categoria && <span> · {a.categoria}</span>}
        {campoMatch === 'denominacion' && (
          <span className="ml-1.5 text-[10px] font-semibold uppercase tracking-wide text-gray-400">en denominación</span>
        )}
      </p>
      {a.denominacion && (
        <p className="text-xs text-gray-400 truncate" title={a.denominacion}>{a.denominacion}</p>
      )}
    </div>
  );
}

const BusquedaAlimento = forwardRef<BusquedaAlimentoHandle, {
  tipoIngesta: IngestaTipo;
  accentColor: string;
  canEdit: boolean;
  selectedAlimento: AlimentoOption | null;
  onSelectAlimento: (a: AlimentoOption) => void;
  onClearSelection: () => void;
  onOpenManual: (query: string) => void;
  onOpenAI: () => void;
  onOpenChat: () => void;
  onOpenBarcode: () => void;
}>(function BusquedaAlimento(
  { tipoIngesta, accentColor, canEdit, selectedAlimento, onSelectAlimento, onClearSelection, onOpenManual, onOpenAI, onOpenChat, onOpenBarcode },
  ref,
) {
  const [query, setQuery] = useState('');
  const [showDropdown, setShowDropdown] = useState(false);
  const [searchResults, setSearchResults] = useState<AlimentoOption[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [denominacionModal, setDenominacionModal] = useState<AlimentoOption | null>(null);
  const [recientes, setRecientes] = useState<AlimentoOption[]>([]);
  const [campos, setCampos] = useState<CamposBusqueda>(CAMPOS_DEFAULT);
  const [showFiltros, setShowFiltros] = useState(false);
  // Persiste durante la sesión de búsqueda a propósito (no se resetea al
  // limpiar el query) — así como "campos", es un filtro de sesión.
  const [fuenteFiltro, setFuenteFiltro] = useState<FuenteFiltro>('todas');
  const [activeIndex, setActiveIndex] = useState(-1);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const ningunCampoTildado = !campos.nombre && !campos.marca && !campos.denominacion;

  useImperativeHandle(ref, () => ({
    focus: () => searchInputRef.current?.focus(),
    clear: () => handleClear(),
  }));

  useEffect(() => {
    getAlimentosRecientesAction().then(setRecientes);
  }, []);

  useEffect(() => {
    if (query.length < 2 || ningunCampoTildado) {
      setSearchResults([]);
      setSearchLoading(false);
      return;
    }
    let cancelado = false;
    setSearchLoading(true);
    const t = setTimeout(async () => {
      const data = await searchAlimentosAction(query, tipoIngesta, campos);
      // Si el query cambió (o se limpió) mientras esta búsqueda estaba en
      // vuelo, descartamos la respuesta — si no, puede repoblar el dropdown
      // con resultados de una búsqueda vieja después de que el usuario ya
      // navegó lejos de ella.
      if (!cancelado) {
        setSearchResults(data);
        setSearchLoading(false);
      }
    }, 300);
    return () => { cancelado = true; clearTimeout(t); };
  }, [query, tipoIngesta, campos, ningunCampoTildado]);

  // El índice activo (teclado ↑ ↓) es relativo a la lista visible en cada
  // momento — se resetea cada vez que esa lista puede haber cambiado.
  useEffect(() => { setActiveIndex(-1); }, [query, campos, fuenteFiltro, searchResults, recientes]);

  const countTodas = searchResults.length;
  const countSARA2 = searchResults.filter((a) => a.fuente === 'SARA2').length;
  const countANMAT = searchResults.filter((a) => a.fuente === 'ANMAT').length;

  const filtered = selectedAlimento
    ? []
    : fuenteFiltro === 'todas'
      ? searchResults
      : searchResults.filter((a) => a.fuente === fuenteFiltro);

  const listaVisible = selectedAlimento ? [] : query.length === 0 ? recientes : filtered;

  const handleSelect = (a: AlimentoOption) => {
    onSelectAlimento(a);
    setQuery(a.nombre);
    setShowDropdown(false);
  };

  const handleClear = () => {
    setQuery('');
    setSearchResults([]);
    setShowDropdown(false);
    onClearSelection();
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!showDropdown || listaVisible.length === 0) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex((i) => (i + 1) % listaVisible.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex((i) => (i <= 0 ? listaVisible.length - 1 : i - 1));
    } else if (e.key === 'Enter' && activeIndex >= 0) {
      e.preventDefault();
      handleSelect(listaVisible[activeIndex]);
    } else if (e.key === 'Escape') {
      setShowDropdown(false);
      setActiveIndex(-1);
    }
  };

  if (!canEdit) return null;

  return (
    <div className="space-y-2">
      <div className="flex items-start gap-2">
        <div className="relative flex-1">
          <div className="relative">
            <svg
              className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4.5 h-4.5 text-gray-400"
              width="18" height="18"
              fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z" />
            </svg>
            <input
              ref={searchInputRef}
              type="text"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                if (selectedAlimento) onClearSelection();
                setShowDropdown(true);
                if (e.target.value.length < 2) setSearchResults([]);
              }}
              onFocus={() => setShowDropdown(true)}
              onBlur={() => setTimeout(() => setShowDropdown(false), 150)}
              onKeyDown={handleKeyDown}
              aria-autocomplete="list"
              aria-expanded={showDropdown}
              aria-controls="busqueda-listbox"
              aria-activedescendant={activeIndex >= 0 && listaVisible[activeIndex] ? `opt-${listaVisible[activeIndex].id_alimento}` : undefined}
              placeholder={
                tipoIngesta === 'suplemento'
                  ? 'Buscar suplemento: proteína, creatina...'
                  : 'Buscar en SARA2 y ANMAT: arroz, pollo, banana...'
              }
              className="w-full pl-10 pr-10 py-3.5 rounded-2xl border border-gray-200 bg-white text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 transition-all"
              style={{ ['--tw-ring-color' as string]: `${accentColor}40` }}
            />
            {query.length > 0 && (
              <button
                type="button"
                aria-label="Limpiar búsqueda"
                onMouseDown={(e) => e.preventDefault()}
                onClick={handleClear}
                className="absolute right-3.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
              >
                <svg width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                </svg>
              </button>
            )}
          </div>

          {showDropdown && searchLoading && query.length >= 2 && !selectedAlimento && (
            <div className="absolute top-full left-0 right-0 bg-white rounded-2xl shadow-lg border border-gray-100 z-20 mt-1 p-3 text-center">
              <span className="text-xs text-gray-400">Buscando...</span>
            </div>
          )}

          {showDropdown && !searchLoading && filtered.length > 0 && !selectedAlimento && (
            <div id="busqueda-listbox" role="listbox" className="absolute top-full left-0 right-0 bg-white rounded-2xl shadow-lg border border-gray-100 z-20 mt-1 overflow-hidden max-h-64 overflow-y-auto">
              {filtered.map((a, idx) => (
                <FilaResultado
                  key={a.id_alimento}
                  a={a}
                  query={query}
                  idx={idx}
                  activeIndex={activeIndex}
                  onSelect={handleSelect}
                  onVerDetalle={setDenominacionModal}
                />
              ))}
            </div>
          )}

          {showDropdown && query.length === 0 && !selectedAlimento && recientes.length > 0 && (
            <div id="busqueda-listbox" role="listbox" className="absolute top-full left-0 right-0 bg-white rounded-2xl shadow-lg border border-gray-100 z-20 mt-1 overflow-hidden max-h-64 overflow-y-auto">
              <p className="px-4 pt-3 pb-1 text-xs font-semibold uppercase tracking-wide text-gray-400">Recientes</p>
              {recientes.map((a, idx) => (
                <FilaResultado
                  key={a.id_alimento}
                  a={a}
                  query=""
                  idx={idx}
                  activeIndex={activeIndex}
                  onSelect={handleSelect}
                  onVerDetalle={setDenominacionModal}
                />
              ))}
            </div>
          )}

          {showDropdown && query.length >= 2 && filtered.length === 0 && !selectedAlimento && (ningunCampoTildado || !searchLoading) && (
            <div data-testid="dropdown-sin-resultados" className="absolute top-full left-0 right-0 bg-white rounded-2xl shadow-lg border border-gray-100 z-20 mt-1 p-4 text-center">
              {ningunCampoTildado ? (
                <>
                  <p className="text-sm text-gray-500">Elegí al menos un campo para buscar.</p>
                  <button
                    type="button"
                    onMouseDown={() => setCampos(CAMPOS_DEFAULT)}
                    className="mt-2 text-sm font-semibold hover:underline"
                    style={{ color: accentColor }}
                  >
                    Quitar filtros
                  </button>
                </>
              ) : !searchLoading ? (
                <>
                  <p className="text-sm text-gray-500">No encontramos &quot;{query}&quot; en el catálogo.</p>
                  <div className="mt-2 flex flex-col items-center gap-1">
                    <button
                      type="button"
                      onMouseDown={() => { setShowDropdown(false); onOpenManual(query); }}
                      className="inline-flex items-center gap-1.5 text-sm font-semibold hover:underline"
                      style={{ color: accentColor }}
                    >
                      <svg width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                      </svg>
                      Cargar alimento manualmente
                    </button>
                    {campos !== CAMPOS_DEFAULT && (
                      <button type="button" onMouseDown={() => setCampos(CAMPOS_DEFAULT)} className="text-xs font-semibold text-gray-400 hover:underline">
                        Quitar filtros
                      </button>
                    )}
                  </div>
                </>
              ) : null}
            </div>
          )}
        </div>

        <div className="hidden sm:flex items-start gap-2 flex-shrink-0" data-testid="metodos-desktop">
          <button
            type="button"
            onClick={onOpenAI}
            className="flex-shrink-0 flex items-center gap-1.5 rounded-2xl px-4 py-3.5 text-sm font-semibold text-white transition-transform hover:scale-[1.03] active:scale-[0.98]"
            style={{ backgroundImage: 'linear-gradient(135deg, #6366f1 0%, #a855f7 50%, #ec4899 100%)', boxShadow: '0 8px 20px rgba(168,85,247,0.35)' }}
          >
            <span aria-hidden="true">✨</span>
            <span>Reconocimiento por IA</span>
          </button>
          <button
            type="button"
            onClick={onOpenChat}
            className="flex-shrink-0 flex items-center gap-1.5 rounded-2xl px-4 py-3.5 text-sm font-semibold text-white transition-transform hover:scale-[1.03] active:scale-[0.98]"
            style={{ backgroundImage: 'linear-gradient(135deg, #0ea5e9 0%, #22c55e 100%)', boxShadow: '0 8px 20px rgba(14,165,233,0.35)' }}
          >
            <span aria-hidden="true">💬</span>
            <span>Registrar por chat</span>
          </button>
          <button
            type="button"
            onClick={onOpenBarcode}
            className="flex-shrink-0 flex items-center gap-1.5 rounded-2xl px-4 py-3.5 text-sm font-semibold text-white transition-transform hover:scale-[1.03] active:scale-[0.98]"
            style={{ backgroundImage: 'linear-gradient(135deg, #f97316 0%, #f59e0b 100%)', boxShadow: '0 8px 20px rgba(249,115,22,0.35)' }}
          >
            <span aria-hidden="true">📷</span>
            <span>Escanear código</span>
          </button>
        </div>

        {query.length > 0 && (
          <button
            type="button"
            onClick={onOpenBarcode}
            aria-label="Escanear código"
            data-testid="metodos-mobile"
            className="sm:hidden flex-shrink-0 w-12 h-12 rounded-2xl flex items-center justify-center text-white"
            style={{ backgroundImage: 'linear-gradient(135deg, #f97316 0%, #f59e0b 100%)', boxShadow: '0 8px 20px rgba(249,115,22,0.35)' }}
          >
            <span aria-hidden="true" className="text-lg">📷</span>
          </button>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        {query.length >= 2 && !selectedAlimento && searchResults.length > 0 && (
          <div role="group" aria-label="Filtrar por fuente" className="inline-flex items-center gap-1 rounded-full bg-gray-100 p-0.5 text-xs">
            {([
              ['todas', `Todas (${countTodas})`],
              ['SARA2', `SARA2 (${countSARA2})`],
              ['ANMAT', `ANMAT (${countANMAT})`],
            ] as const).map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => setFuenteFiltro(key)}
                aria-pressed={fuenteFiltro === key}
                className={`rounded-full px-2.5 py-1 font-semibold transition-colors ${
                  fuenteFiltro === key ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        )}
        <button
          type="button"
          onClick={() => setShowFiltros((v) => !v)}
          className="inline-flex items-center gap-1 rounded-full border border-gray-200 px-3 py-1 text-xs font-semibold text-gray-600 hover:bg-gray-50"
        >
          Buscar
          <svg width="12" height="12" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}
            className={`transition-transform ${showFiltros ? 'rotate-180' : ''}`}>
            <path strokeLinecap="round" strokeLinejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5" />
          </svg>
        </button>
        {showFiltros && (
          <div className="flex flex-wrap gap-3 text-xs text-gray-600">
            {(['nombre', 'marca', 'denominacion'] as const).map((campo) => (
              <label key={campo} className="inline-flex items-center gap-1.5">
                <input
                  type="checkbox"
                  checked={campos[campo]}
                  onChange={(e) => setCampos((c) => ({ ...c, [campo]: e.target.checked }))}
                />
                {campo === 'nombre' ? 'Nombre' : campo === 'marca' ? 'Marca' : 'Denominación'}
              </label>
            ))}
          </div>
        )}
      </div>

      {query.length === 0 && (
        <div className="flex sm:hidden items-center gap-2" data-testid="metodos-mobile">
          <button
            type="button"
            onClick={onOpenAI}
            aria-label="Reconocimiento por IA"
            className="flex-1 h-12 rounded-2xl flex items-center justify-center text-white"
            style={{ backgroundImage: 'linear-gradient(135deg, #6366f1 0%, #a855f7 50%, #ec4899 100%)', boxShadow: '0 8px 20px rgba(168,85,247,0.35)' }}
          >
            <span aria-hidden="true" className="text-lg">✨</span>
          </button>
          <button
            type="button"
            onClick={onOpenChat}
            aria-label="Registrar por chat"
            className="flex-1 h-12 rounded-2xl flex items-center justify-center text-white"
            style={{ backgroundImage: 'linear-gradient(135deg, #0ea5e9 0%, #22c55e 100%)', boxShadow: '0 8px 20px rgba(14,165,233,0.35)' }}
          >
            <span aria-hidden="true" className="text-lg">💬</span>
          </button>
          <button
            type="button"
            onClick={onOpenBarcode}
            aria-label="Escanear código"
            className="flex-1 h-12 rounded-2xl flex items-center justify-center text-white"
            style={{ backgroundImage: 'linear-gradient(135deg, #f97316 0%, #f59e0b 100%)', boxShadow: '0 8px 20px rgba(249,115,22,0.35)' }}
          >
            <span aria-hidden="true" className="text-lg">📷</span>
          </button>
        </div>
      )}

      <Modal open={denominacionModal !== null} onClose={() => setDenominacionModal(null)} title="Detalle del alimento">
        <p className="text-sm font-semibold text-gray-900">{denominacionModal?.nombre}</p>
        <dl className="mt-3 space-y-2 text-sm">
          {([
            ['Fuente', denominacionModal?.fuente],
            ['Categoría', denominacionModal?.categoria],
            ['Marca', denominacionModal?.marca],
            ['Denominación', denominacionModal?.denominacion],
          ] as const).map(([label, value]) =>
            value ? (
              <div key={label}>
                <dt className="text-xs font-semibold uppercase tracking-wide text-gray-400">{label}</dt>
                <dd className="text-gray-700 leading-relaxed">{value}</dd>
              </div>
            ) : null
          )}
        </dl>
        <button
          type="button"
          onClick={() => setDenominacionModal(null)}
          className="mt-4 w-full rounded-xl py-2.5 text-sm font-semibold text-white bg-blue-500 hover:bg-blue-600 transition-colors"
        >
          Cerrar
        </button>
      </Modal>
    </div>
  );
});

export default BusquedaAlimento;
