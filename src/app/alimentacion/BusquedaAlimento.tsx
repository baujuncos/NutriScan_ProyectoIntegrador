'use client';

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { searchAlimentosAction, getAlimentosRecientesAction, type AlimentoOption } from './actions';
import { CAMPOS_DEFAULT, campoDeCoincidencia, rangoCoincidencia, type CamposBusqueda } from './searchQuery';
import { type IngestaTipo } from '@/lib/nutrition';
import { useBodyScrollLock, useEsMobile, useVisualViewportBox } from '@/lib/overlayMovil';

export type BusquedaAlimentoHandle = { focus: () => void; clear: () => void };

type FuenteFiltro = 'todas' | 'SARA2' | 'ANMAT';

/**
 * Una fila de resultado (búsqueda o "Recientes"): nombre (con la coincidencia
 * resaltada), "Marca · Categoría" (o "Genérico"), denominación completa
 * truncada con tooltip y badge de fuente. Mismo diseño en ambas listas, como
 * pide el mockup — se factoriza acá para no duplicarlo.
 */
function FilaResultado({
  a,
  query,
  idx,
  activeIndex,
  onSelect,
}: {
  a: AlimentoOption;
  query: string;
  idx: number;
  activeIndex: number;
  onSelect: (a: AlimentoOption) => void;
}) {
  const campoMatch = query.length >= 2 ? campoDeCoincidencia(a, query) : null;
  const rango = query.length >= 2 ? rangoCoincidencia(a.nombre, query) : null;
  const activo = idx === activeIndex;

  return (
    <div
      id={`opt-${a.id_alimento}`}
      role="option"
      aria-selected={activo}
      onMouseDown={() => onSelect(a)}
      className={`w-full text-left px-4 py-3 text-sm border-b border-[#E2E8F0]/60 last:border-0 transition-colors cursor-pointer ${
        activo ? 'bg-[#FFF7ED]' : 'hover:bg-[#F8FAFC]'
      }`}
    >
      <div className="flex items-center gap-2">
        <span className="font-medium text-[#0F172A] flex-1 min-w-0 truncate" title={a.nombre}>
          {rango ? (
            <>
              {a.nombre.slice(0, rango[0])}
              <mark className="rounded-sm bg-[#FED7AA] text-inherit">{a.nombre.slice(rango[0], rango[1])}</mark>
              {a.nombre.slice(rango[1])}
            </>
          ) : a.nombre}
        </span>
        <span className={`text-xs px-1.5 py-0.5 rounded-md font-semibold flex-shrink-0 ${
          a.fuente === 'ANMAT' ? 'bg-[#ECFDF3] text-[#067647]' : 'bg-[#EFF6FF] text-[#1D4ED8]'
        }`}>
          {a.fuente}
        </span>
      </div>
      <p className="text-xs text-[#64748B] mt-0.5 truncate">
        <span>{a.marca ?? 'Genérico'}</span>
        {a.categoria && <span> · {a.categoria}</span>}
        {campoMatch === 'denominacion' && (
          <span className="ml-1.5 text-[10px] font-semibold uppercase tracking-wide text-[#64748B]">en denominación</span>
        )}
      </p>
      {a.denominacion && (
        <p className="text-xs text-[#64748B] truncate" title={a.denominacion}>{a.denominacion}</p>
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
  const [recientes, setRecientes] = useState<AlimentoOption[]>([]);
  const [campos, setCampos] = useState<CamposBusqueda>(CAMPOS_DEFAULT);
  const [showFiltros, setShowFiltros] = useState(false);
  // Persiste durante la sesión de búsqueda a propósito (no se resetea al
  // limpiar el query) — así como "campos", es un filtro de sesión.
  const [fuenteFiltro, setFuenteFiltro] = useState<FuenteFiltro>('todas');
  const [activeIndex, setActiveIndex] = useState(-1);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const ningunCampoTildado = !campos.nombre && !campos.marca && !campos.denominacion;
  // Con un alimento ya elegido no hay nada que buscar: el panel se reabre recién al tipear.
  const abierto = showDropdown && !selectedAlimento;

  // iOS: al abrirse el teclado, Safari desplaza la página y la barra (fixed, arriba) se va de la
  // zona visible. En mobile se bloquea el scroll del fondo y el overlay se ajusta al área visible.
  const esMobile = useEsMobile();
  const overlayMovil = abierto && esMobile;
  useBodyScrollLock(overlayMovil);
  const areaVisible = useVisualViewportBox(overlayMovil);

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

  const cerrar = () => {
    setShowDropdown(false);
    setShowFiltros(false);
    setActiveIndex(-1);
  };

  const handleSelect = (a: AlimentoOption) => {
    onSelectAlimento(a);
    setQuery(a.nombre);
    cerrar();
  };

  const handleClear = () => {
    setQuery('');
    setSearchResults([]);
    cerrar();
    onClearSelection();
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') {
      cerrar();
      return;
    }
    if (!abierto || listaVisible.length === 0) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex((i) => (i + 1) % listaVisible.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex((i) => (i <= 0 ? listaVisible.length - 1 : i - 1));
    } else if (e.key === 'Enter' && activeIndex >= 0) {
      e.preventDefault();
      handleSelect(listaVisible[activeIndex]);
    }
  };

  if (!canEdit) return null;

  return (
    <div className="space-y-2">
      <div className="flex items-start gap-2">
        {/*
          Un único árbol DOM para mobile y desktop, conmutado por CSS: abierto
          en mobile, este contenedor pasa a pantalla completa (fixed inset-0);
          en desktop queda en su lugar y el panel se vuelve un popover. Así el
          <input> nunca se desmonta (no pierde foco ni estado) — ver spec fase 2.
        */}
        <div
          className="relative flex-1 min-w-0"
          onBlur={(e) => {
            // Foco movido por teclado (Tab) fuera del buscador → cerrar. Un click
            // en algo no enfocable da relatedTarget null: de eso se encarga el scrim.
            if (e.relatedTarget && !e.currentTarget.contains(e.relatedTarget as Node)) cerrar();
          }}
        >
          {abierto && (
            <div
              data-testid="busqueda-scrim"
              aria-hidden="true"
              onMouseDown={cerrar}
              className="hidden sm:block fixed inset-0 z-30 bg-slate-900/10"
            />
          )}
          <div
            data-testid="busqueda-overlay"
            style={areaVisible ? { top: areaVisible.top, height: areaVisible.height, bottom: 'auto' } : undefined}
            className={abierto
              ? 'fixed inset-0 z-[60] flex flex-col bg-[#F8FAFC] sm:relative sm:inset-auto sm:z-40 sm:block sm:bg-transparent'
              : 'relative'}
          >
            <div
              className={abierto
                ? 'flex items-center gap-2 bg-white px-3 pb-3 pt-[calc(0.75rem+env(safe-area-inset-top))] border-b border-[#E2E8F0] sm:p-0 sm:border-0 sm:bg-transparent'
                : ''}
            >
              <div className="relative flex-1">
                <svg
                  className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4.5 h-4.5 text-[#64748B]"
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
                  onKeyDown={handleKeyDown}
                  aria-autocomplete="list"
                  aria-expanded={abierto}
                  aria-controls="busqueda-listbox"
                  aria-activedescendant={activeIndex >= 0 && listaVisible[activeIndex] ? `opt-${listaVisible[activeIndex].id_alimento}` : undefined}
                  placeholder={
                    tipoIngesta === 'suplemento'
                      ? 'Buscar suplemento: proteína, creatina...'
                      : 'Buscar en SARA2 y ANMAT: arroz, pollo, banana...'
                  }
                  className="w-full pl-10 pr-10 py-3.5 rounded-2xl border border-[#E2E8F0] bg-white text-sm text-[#0F172A] placeholder-[#64748B] focus:outline-none focus:ring-2 transition-all"
                  style={{ ['--tw-ring-color' as string]: `${accentColor}40` }}
                />
                {query.length > 0 && (
                  <button
                    type="button"
                    aria-label="Limpiar búsqueda"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={handleClear}
                    className="absolute right-3.5 top-1/2 -translate-y-1/2 text-[#64748B] hover:text-[#0F172A]"
                  >
                    <svg width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                    </svg>
                  </button>
                )}
              </div>
              {abierto && (
                <button
                  type="button"
                  onClick={() => { cerrar(); searchInputRef.current?.blur(); }}
                  className="sm:hidden flex-shrink-0 px-1 text-sm font-semibold text-[#C2410C]"
                >
                  Cancelar
                </button>
              )}
            </div>

            {abierto && (
              <div className="flex-1 min-h-0 flex flex-col bg-white overflow-hidden sm:absolute sm:top-full sm:left-0 sm:mt-2 sm:w-[640px] sm:max-w-[calc(100vw-2rem)] sm:rounded-2xl sm:border sm:border-[#E2E8F0] sm:shadow-[0_16px_40px_rgba(15,23,42,0.14)]">
                {/* Cabecera: campos + fuente. En mobile, chips con scroll horizontal. */}
                <div className="flex items-center gap-2 px-4 py-2.5 border-b border-[#E2E8F0] overflow-x-auto whitespace-nowrap sm:flex-wrap">
                  <button
                    type="button"
                    onClick={() => setShowFiltros((v) => !v)}
                    aria-expanded={showFiltros}
                    className="inline-flex flex-shrink-0 items-center gap-1 rounded-full border border-[#E2E8F0] px-3 py-1 text-xs font-semibold text-[#475569] hover:bg-[#F8FAFC]"
                  >
                    Buscar<span className="sm:hidden"> en</span>
                    <svg width="12" height="12" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}
                      className={`transition-transform ${showFiltros ? 'rotate-180' : ''}`}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5" />
                    </svg>
                  </button>
                  {query.length >= 2 && searchResults.length > 0 && (
                    <div role="group" aria-label="Filtrar por fuente" className="inline-flex flex-shrink-0 items-center gap-1 rounded-full bg-[#F1F5F9] p-0.5 text-xs">
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
                            fuenteFiltro === key ? 'bg-white text-[#0F172A] shadow-sm' : 'text-[#475569] hover:text-[#0F172A]'
                          }`}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                {showFiltros && (
                  <>
                    {/* Mobile: "Buscar en" es un bottom sheet. Desktop: fila inline dentro del popover. */}
                    <div aria-hidden="true" onMouseDown={() => setShowFiltros(false)} className="sm:hidden fixed inset-0 z-[70] bg-slate-900/30" />
                    <div className="fixed inset-x-0 bottom-0 z-[71] rounded-t-3xl bg-white p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] shadow-2xl sm:static sm:z-auto sm:rounded-none sm:shadow-none sm:px-4 sm:py-2.5 sm:border-b sm:border-[#E2E8F0]">
                      <p className="sm:hidden mb-3 text-sm font-semibold text-[#0F172A]">Buscar en</p>
                      <div className="flex flex-col gap-3 text-sm text-[#475569] sm:flex-row sm:flex-wrap sm:text-xs">
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
                      <button
                        type="button"
                        onClick={() => setShowFiltros(false)}
                        className="sm:hidden mt-4 w-full rounded-xl bg-[#C2410C] py-3 text-sm font-semibold text-white hover:bg-[#9A3412]"
                      >
                        Listo
                      </button>
                    </div>
                  </>
                )}

                <div className="flex-1 min-h-0 overflow-y-auto sm:flex-none sm:max-h-[360px]">
                  {searchLoading && query.length >= 2 && (
                    <p className="p-3 text-center text-xs text-[#64748B]">Buscando...</p>
                  )}

                  {!searchLoading && filtered.length > 0 && (
                    <div id="busqueda-listbox" role="listbox">
                      {filtered.map((a, idx) => (
                        <FilaResultado key={a.id_alimento} a={a} query={query} idx={idx} activeIndex={activeIndex} onSelect={handleSelect} />
                      ))}
                    </div>
                  )}

                  {query.length === 0 && recientes.length > 0 && (
                    <div id="busqueda-listbox" role="listbox">
                      <p className="px-4 pt-3 pb-1 text-xs font-semibold uppercase tracking-wide text-[#64748B]">Recientes</p>
                      {recientes.map((a, idx) => (
                        <FilaResultado key={a.id_alimento} a={a} query="" idx={idx} activeIndex={activeIndex} onSelect={handleSelect} />
                      ))}
                    </div>
                  )}

                  {query.length < 2 && !(query.length === 0 && recientes.length > 0) && (
                    <p className="p-4 text-center text-xs text-[#64748B]">Escribí al menos 2 letras para buscar.</p>
                  )}

                  {query.length >= 2 && filtered.length === 0 && (ningunCampoTildado || !searchLoading) && (
                    <div data-testid="dropdown-sin-resultados" className="p-4 text-center">
                      {ningunCampoTildado ? (
                        <>
                          <p className="text-sm text-[#475569]">Elegí al menos un campo para buscar.</p>
                          <button
                            type="button"
                            onMouseDown={() => setCampos(CAMPOS_DEFAULT)}
                            className="mt-2 text-sm font-semibold hover:underline"
                            style={{ color: accentColor }}
                          >
                            Quitar filtros
                          </button>
                        </>
                      ) : (
                        <>
                          <p className="text-sm text-[#475569]">No encontramos &quot;{query}&quot; en el catálogo.</p>
                          <div className="mt-2 flex flex-col items-center gap-1">
                            <button
                              type="button"
                              onMouseDown={() => { cerrar(); onOpenManual(query); }}
                              className="inline-flex items-center gap-1.5 text-sm font-semibold hover:underline"
                              style={{ color: accentColor }}
                            >
                              <svg width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                              </svg>
                              Cargar alimento manualmente
                            </button>
                            {campos !== CAMPOS_DEFAULT && (
                              <button type="button" onMouseDown={() => setCampos(CAMPOS_DEFAULT)} className="text-xs font-semibold text-[#64748B] hover:underline">
                                Quitar filtros
                              </button>
                            )}
                          </div>
                        </>
                      )}
                    </div>
                  )}
                </div>

                <div className="hidden sm:flex items-center gap-4 px-4 py-2 border-t border-[#E2E8F0] bg-[#F8FAFC] text-[11px] text-[#64748B]">
                  <span><kbd className="font-sans font-semibold">↑</kbd> <kbd className="font-sans font-semibold">↓</kbd> para navegar</span>
                  <span><kbd className="font-sans font-semibold">Enter</kbd> para elegir</span>
                  <span><kbd className="font-sans font-semibold">Esc</kbd> para cerrar</span>
                </div>
              </div>
            )}
          </div>
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
    </div>
  );
});

export default BusquedaAlimento;
