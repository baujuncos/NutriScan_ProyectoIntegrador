'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Modal from '@/components/ui/Modal';
import Button from '@/components/ui/Button';
import { obtenerProductoPorEAN, type ProductoOFF } from '@/lib/openFoodFacts';
import { addScannedItemAction } from './actions';
import { calcularRecorte, recortarImagen } from '@/lib/recorteFoto';

type Stage = 'source' | 'cropping' | 'fetching' | 'confirm' | 'mode' | 'paquete' | 'porcion' | 'discarded';
type CaptureTab = 'camara' | 'subir';

const SCANNER_ELEMENT_ID = 'barcode-scanner-region';

const PORCIONES_FABRICANTE = [
  { label: '1/2 porción', fraccion: 0.5 },
  { label: '1 porción', fraccion: 1 },
  { label: '2 porciones', fraccion: 2 },
  { label: '3 porciones', fraccion: 3 },
] as const;

const PAQUETE_FRACCIONES = [
  { label: 'Entero (1 envase)', fraccion: 1 },
  { label: 'Mitad (1/2)', fraccion: 0.5 },
  { label: 'Un cuarto (1/4)', fraccion: 0.25 },
  { label: 'Un quinto (1/5)', fraccion: 0.2 },
] as const;

const NUTRISCORE_COLORES: Record<'a' | 'b' | 'c' | 'd' | 'e', string> = {
  a: '#038141',
  b: '#85BB2F',
  c: '#FECB02',
  d: '#EE8100',
  e: '#E63E11',
};

const NOVA_DESCRIPCIONES: Record<1 | 2 | 3 | 4, string> = {
  1: 'Sin procesar o mínimamente procesado',
  2: 'Ingrediente culinario procesado',
  3: 'Procesado',
  4: 'Ultraprocesado',
};

function esTactil(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  return window.matchMedia('(pointer: coarse)').matches;
}

type ScannerInstance = InstanceType<typeof import('html5-qrcode').Html5Qrcode>;

export default function BarcodeScannerModal({
  open,
  onClose,
  fecha,
  tipoIngesta,
}: {
  open: boolean;
  onClose: () => void;
  fecha: string;
  tipoIngesta: string;
}) {
  const [stage, setStage] = useState<Stage>('source');
  const [activeTab, setActiveTab] = useState<CaptureTab>('camara');
  const [producto, setProducto] = useState<ProductoOFF | null>(null);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const scannerRef = useRef<ScannerInstance | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [pendingFileUrl, setPendingFileUrl] = useState<string | null>(null);
  const [zoomRecorte, setZoomRecorte] = useState(1);
  const [panRecorte, setPanRecorte] = useState({ x: 0, y: 0 });
  const dragRef = useRef<{ x: number; y: number } | null>(null);
  const imgSizeRef = useRef<{ w: number; h: number } | null>(null);
  const previewContainerRef = useRef<HTMLDivElement>(null);
  const pendingFileUrlRef = useRef<string | null>(null);

  const [esDispositivoTactil, setEsDispositivoTactil] = useState(true);
  const [mostrarInfoAmpliada, setMostrarInfoAmpliada] = useState(false);
  const [personalizarPaquete, setPersonalizarPaquete] = useState(false);
  const [personalizarPorcion, setPersonalizarPorcion] = useState(false);
  const [porcionesCustomValor, setPorcionesCustomValor] = useState('');

  useEffect(() => {
    if (!open) return;
    const tactil = esTactil();
    setEsDispositivoTactil(tactil);
    setActiveTab(tactil ? 'camara' : 'subir');
  }, [open]);

  const detenerCamara = useCallback(async () => {
    const scanner = scannerRef.current;
    scannerRef.current = null;
    if (!scanner) return;
    try {
      await scanner.stop();
    } catch {
      // Ya estaba detenida
    }
    scanner.clear();
  }, []);

  const setPendingImage = useCallback((url: string | null) => {
    if (pendingFileUrlRef.current) URL.revokeObjectURL(pendingFileUrlRef.current);
    pendingFileUrlRef.current = url;
    setPendingFileUrl(url);
  }, []);

  useEffect(
    () => () => {
      if (pendingFileUrlRef.current) URL.revokeObjectURL(pendingFileUrlRef.current);
    },
    [],
  );

  const resetEncuadre = () => {
    setZoomRecorte(1);
    setPanRecorte({ x: 0, y: 0 });
    dragRef.current = null;
  };

  const handlePointerDownRecorte = (e: React.PointerEvent) => {
    dragRef.current = { x: e.clientX - panRecorte.x, y: e.clientY - panRecorte.y };
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };
  const handlePointerMoveRecorte = (e: React.PointerEvent) => {
    if (!dragRef.current) return;
    setPanRecorte({ x: e.clientX - dragRef.current.x, y: e.clientY - dragRef.current.y });
  };
  const handlePointerUpRecorte = () => {
    dragRef.current = null;
  };

  const resetState = useCallback(() => {
    setStage('source');
    setProducto(null);
    setCameraError(null);
    setPendingImage(null);
    setPendingFile(null);
    imgSizeRef.current = null;
    resetEncuadre();
    setMostrarInfoAmpliada(false);
    setPersonalizarPaquete(false);
    setPersonalizarPorcion(false);
    setPorcionesCustomValor('');
  }, [setPendingImage]);

  const handleClose = useCallback(() => {
    void detenerCamara();
    resetState();
    onClose();
  }, [detenerCamara, resetState, onClose]);

  const buscarProducto = useCallback(async (ean: string) => {
    setStage('fetching');
    const resultado = await obtenerProductoPorEAN(ean);
    setProducto(resultado);
    setStage(resultado.encontrado ? 'confirm' : 'discarded');
  }, []);

  const handleDecoded = useCallback(
    (ean: string) => {
      void detenerCamara();
      void buscarProducto(ean);
    },
    [detenerCamara, buscarProducto],
  );

  // Cámara en vivo: arranca solo en la pantalla inicial con la pestaña "cámara" activa.
  useEffect(() => {
    if (!open || stage !== 'source' || activeTab !== 'camara') return;
    let cancelado = false;

    (async () => {
      const { Html5Qrcode, Html5QrcodeSupportedFormats } = await import('html5-qrcode');
      if (cancelado) return;
      const scanner = new Html5Qrcode(SCANNER_ELEMENT_ID, {
        formatsToSupport: [Html5QrcodeSupportedFormats.EAN_13],
        verbose: false,
      });
      scannerRef.current = scanner;
      try {
        await scanner.start(
          { facingMode: 'environment' },
          { fps: 10, qrbox: { width: 280, height: 140 } },
          (decodedText) => handleDecoded(decodedText),
          () => {},
        );
        if (cancelado) {
          // Nos pidieron cancelar mientras start() todavía estaba pendiente:
          // el stop() que disparó el cleanup de abajo ya corrió y falló
          // (html5-qrcode rechaza stop() hasta que start() resuelve), así que
          // la cámara quedó realmente encendida recién ahora. Apagarla de nuevo.
          try {
            await scanner.stop();
          } catch {
            // Ya estaba detenida
          }
          scanner.clear();
        }
      } catch (err) {
        if (cancelado) return;
        const name = err instanceof DOMException ? err.name : '';
        setCameraError(
          name === 'NotAllowedError'
            ? 'No diste permiso para la cámara. Subí una imagen en su lugar.'
            : name === 'NotFoundError'
              ? 'No encontramos una cámara. Subí una imagen en su lugar.'
              : 'No pudimos acceder a la cámara. Subí una imagen en su lugar.',
        );
        setActiveTab('subir');
      }
    })();

    return () => {
      cancelado = true;
      void detenerCamara();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, stage, activeTab]);

  const handleFile = (file: File | undefined) => {
    if (!file) return;
    setPendingFile(file);
    setPendingImage(URL.createObjectURL(file));
    imgSizeRef.current = null;
    resetEncuadre();
    setStage('cropping');
  };

  const handleProcesarCodigo = async () => {
    if (!pendingFile) return;
    const imgSize = imgSizeRef.current;
    const rectView = previewContainerRef.current?.getBoundingClientRect();
    let archivo = pendingFile;
    if (imgSize && rectView && rectView.width > 0) {
      const recorte = calcularRecorte({
        imgW: imgSize.w,
        imgH: imgSize.h,
        viewW: rectView.width,
        viewH: rectView.height,
        zoom: zoomRecorte,
        panX: panRecorte.x,
        panY: panRecorte.y,
      });
      archivo = await recortarImagen(pendingFile, recorte);
    }

    const { Html5Qrcode, Html5QrcodeSupportedFormats } = await import('html5-qrcode');
    const scanner = new Html5Qrcode(SCANNER_ELEMENT_ID, {
      formatsToSupport: [Html5QrcodeSupportedFormats.EAN_13],
      verbose: false,
    });
    try {
      const resultado = await scanner.scanFileV2(archivo, false);
      handleDecoded(resultado.decodedText);
    } catch {
      setCameraError('No pudimos leer un código EAN-13 en esa imagen. Probá reencuadrar y procesar de nuevo.');
    } finally {
      scanner.clear();
    }
  };

  const handleRechazar = () => setStage('discarded');
  const handleAceptar = () => setStage('mode');
  const handleEscanearOtro = () => {
    setProducto(null);
    setCameraError(null);
    setStage('source');
  };

  const renderVolver = (target: Stage) => (
    <button
      type="button"
      onClick={() => setStage(target)}
      className="mb-2 flex items-center gap-1 text-sm font-medium text-gray-500 hover:text-gray-700"
    >
      <span aria-hidden="true">←</span> Volver
    </button>
  );

  const tipoIngestaEfectivo = producto?.encontrado && producto.esSuplemento ? 'suplemento' : tipoIngesta;

  return (
    <Modal open={open} onClose={handleClose} title="📷 Escanear código de barras">
      <div className="space-y-4">
        <div
          id={SCANNER_ELEMENT_ID}
          className={
            stage === 'source' && activeTab === 'camara' ? 'overflow-hidden rounded-2xl bg-black min-h-56' : 'hidden'
          }
        />
        {stage === 'source' && (
          <>
            {esDispositivoTactil && (
              <div className="flex gap-2 rounded-xl bg-gray-100 p-1">
                <button
                  type="button"
                  onClick={() => setActiveTab('camara')}
                  className={`flex-1 rounded-lg py-2 text-sm font-semibold transition-colors ${
                    activeTab === 'camara' ? 'bg-white shadow text-gray-900' : 'text-gray-500'
                  }`}
                >
                  Escanear con cámara
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTab('subir')}
                  className={`flex-1 rounded-lg py-2 text-sm font-semibold transition-colors ${
                    activeTab === 'subir' ? 'bg-white shadow text-gray-900' : 'text-gray-500'
                  }`}
                >
                  Elegir de galería
                </button>
              </div>
            )}

            {activeTab === 'subir' && (
              <div
                role="button"
                tabIndex={0}
                onClick={() => fileInputRef.current?.click()}
                onKeyDown={(e) => e.key === 'Enter' && fileInputRef.current?.click()}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  void handleFile(e.dataTransfer.files?.[0]);
                }}
                className="flex h-56 cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-gray-200 text-center hover:border-orange-300"
              >
                <span className="text-3xl" aria-hidden="true">🖼️</span>
                <p className="text-sm font-medium text-gray-600">
                  Arrastrá una imagen del código de barras o hacé click para elegir un archivo
                </p>
              </div>
            )}

            {cameraError && (
              <p
                className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700"
                aria-live="polite"
              >
                {cameraError}
              </p>
            )}

            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              aria-label="Subir imagen del código de barras"
              className="hidden"
              onChange={(e) => void handleFile(e.target.files?.[0])}
            />
          </>
        )}

        {stage === 'cropping' && pendingFileUrl && (
          <div className="space-y-4">
            {renderVolver('source')}
            <div
              ref={previewContainerRef}
              className="relative h-56 overflow-hidden rounded-2xl border border-gray-100 bg-gray-900"
              style={{ touchAction: 'none', cursor: 'grab' }}
              onPointerDown={handlePointerDownRecorte}
              onPointerMove={handlePointerMoveRecorte}
              onPointerUp={handlePointerUpRecorte}
              onPointerCancel={handlePointerUpRecorte}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={pendingFileUrl}
                alt="Imagen a recortar"
                draggable={false}
                onLoad={(e) => {
                  imgSizeRef.current = { w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight };
                }}
                className="pointer-events-none absolute inset-0 h-full w-full select-none object-contain"
                style={{
                  transform: `translate(${panRecorte.x}px, ${panRecorte.y}px) scale(${zoomRecorte})`,
                  transformOrigin: 'center',
                }}
              />
              <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                <svg viewBox="0 0 250 100" className="h-full w-full" aria-hidden="true">
                  <rect
                    x="10" y="10" width="230" height="80" rx="8"
                    fill="none" stroke="white" strokeWidth="3" strokeDasharray="8 6" opacity="0.9"
                  />
                </svg>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <span className="text-xs font-medium text-gray-400" aria-hidden="true">Zoom</span>
              <input
                type="range"
                min={1}
                max={3}
                step={0.02}
                value={zoomRecorte}
                onChange={(e) => setZoomRecorte(Number(e.target.value))}
                aria-label="Zoom de la imagen"
                className="h-1.5 flex-1 cursor-pointer appearance-none rounded-full bg-gray-200 accent-orange-500"
              />
              <button type="button" onClick={resetEncuadre} className="text-xs font-semibold text-orange-600 hover:underline">
                Reencuadrar
              </button>
            </div>
            <p className="text-xs text-gray-400">
              Arrastrá y ajustá el zoom para que el código de barras coincida con el recuadro.
            </p>
            {cameraError && (
              <p className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700" aria-live="polite">
                {cameraError}
              </p>
            )}
            <Button type="button" variant="primary" className="w-full" onClick={() => void handleProcesarCodigo()}>
              Procesar código
            </Button>
          </div>
        )}

        {stage === 'fetching' && (
          <div className="flex h-56 items-center justify-center">
            <svg className="h-8 w-8 animate-spin text-gray-400" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
          </div>
        )}

        {stage === 'confirm' && producto?.encontrado && (
          <div className="space-y-4">
            {renderVolver('source')}
            <div className="flex gap-3">
              {producto.imagenUrl && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={producto.imagenUrl}
                  alt={producto.nombre}
                  className="h-20 w-20 rounded-xl object-cover"
                />
              )}
              <div className="min-w-0 flex-1">
                <p className="font-semibold text-gray-900">{producto.nombre}</p>
                {producto.marca && <p className="text-xs text-gray-500">{producto.marca}</p>}
                <p className="text-xs text-gray-400">{producto.categoria}</p>
              </div>
            </div>
            <div className="grid grid-cols-4 gap-2 rounded-2xl bg-gray-50 p-3 text-center">
              <div>
                <p className="text-sm font-bold text-gray-900">{producto.nutrientes100g.kcal.toFixed(1)}</p>
                <p className="text-[10px] text-gray-400">kcal/100g</p>
              </div>
              <div>
                <p className="text-sm font-bold text-gray-900">{producto.nutrientes100g.proteinas.toFixed(1)}g</p>
                <p className="text-[10px] text-gray-400">Proteínas</p>
              </div>
              <div>
                <p className="text-sm font-bold text-gray-900">{producto.nutrientes100g.grasas.toFixed(1)}g</p>
                <p className="text-[10px] text-gray-400">Grasas</p>
              </div>
              <div>
                <p className="text-sm font-bold text-gray-900">{producto.nutrientes100g.carbs.toFixed(1)}g</p>
                <p className="text-[10px] text-gray-400">Carbs</p>
              </div>
            </div>
            <p className="text-center text-xs text-gray-400">Valores expresados cada 100g / 100ml.</p>
            {producto.porcionEtiqueta && (
              <p className="text-center text-xs text-gray-500">
                Porción sugerida en envoltorio: {producto.porcionEtiqueta}
              </p>
            )}
            {producto.esSuplemento && (
              <p className="rounded-xl border border-sky-200 bg-sky-50 px-4 py-3 text-center text-sm text-sky-700">
                Detectamos que es un suplemento — se va a guardar en Suplementos.
              </p>
            )}

            <button
              type="button"
              onClick={() => setMostrarInfoAmpliada((v) => !v)}
              className="w-full text-center text-sm font-semibold text-orange-600 hover:underline"
            >
              Ampliar información del producto
            </button>
            {mostrarInfoAmpliada && (() => {
              const { nutriscore, novaGroup, sinGluten, vegano, vegetariano } = producto.infoAmpliada;
              const sinInfo = !nutriscore && !novaGroup && !sinGluten && !vegano && !vegetariano;
              return (
                <div className="space-y-3 rounded-2xl border border-gray-100 bg-gray-50 p-3 text-sm">
                  {sinInfo ? (
                    <p className="text-xs text-gray-400">Open Food Facts no tiene esta información para este producto.</p>
                  ) : (
                    <>
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-semibold uppercase tracking-wide text-gray-400">Nutri-Score</span>
                          {nutriscore ? (
                            <span
                              className="flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold text-white"
                              style={{ backgroundColor: NUTRISCORE_COLORES[nutriscore] }}
                            >
                              {nutriscore.toUpperCase()}
                            </span>
                          ) : (
                            <span className="text-xs text-gray-400">Sin datos</span>
                          )}
                        </div>
                        <p className="mt-1 text-xs text-gray-500">
                          Nutri-Score: calificación de A a E del perfil nutricional general (calorías, azúcares,
                          grasas saturadas, sodio, proteínas, fibra y frutas/verduras). A es el mejor perfil, E el peor.
                        </p>
                      </div>
                      <div>
                        <span className="text-xs font-semibold uppercase tracking-wide text-gray-400">Grupo NOVA</span>
                        <p className="mt-1 text-sm text-gray-700">
                          {novaGroup ? `${novaGroup} — ${NOVA_DESCRIPCIONES[novaGroup]}` : 'Sin datos'}
                        </p>
                        <p className="mt-1 text-xs text-gray-500">
                          Grupo NOVA: mide qué tan procesado está el alimento, de 1 (natural o casi sin procesar) a 4
                          (ultraprocesado — con ingredientes y aditivos industriales).
                        </p>
                      </div>
                      {(sinGluten || vegano || vegetariano) && (
                        <div className="flex flex-wrap gap-1.5">
                          {sinGluten && (
                            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-700">
                              Sin Gluten
                            </span>
                          )}
                          {vegano && (
                            <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-semibold text-green-700">
                              Vegano
                            </span>
                          )}
                          {vegetariano && (
                            <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-700">
                              Vegetariano
                            </span>
                          )}
                        </div>
                      )}
                    </>
                  )}
                </div>
              );
            })()}

            <p className="text-center text-sm font-medium text-gray-700">¿Es este tu alimento?</p>
            <div className="flex gap-2">
              <Button type="button" variant="primary" className="flex-1" onClick={handleAceptar}>
                Sí, es correcto
              </Button>
              <Button type="button" variant="outline" className="flex-1" onClick={handleRechazar}>
                No, es otro
              </Button>
            </div>
          </div>
        )}

        {stage === 'mode' && (
          <div className="space-y-4">
            {renderVolver('confirm')}
            <p className="text-center text-sm font-medium text-gray-700">¿Cómo deseas registrar tu ingesta?</p>
            <div className="grid grid-cols-1 gap-3">
              <button
                type="button"
                onClick={() => setStage('paquete')}
                aria-label="Por Paquete Completo"
                className="rounded-2xl border border-gray-200 p-4 text-left hover:border-orange-300 hover:bg-orange-50"
              >
                <p className="font-semibold text-gray-900">Por Paquete Completo</p>
                <p className="text-xs text-gray-500">Fracción del envase que consumiste (entero, mitad, etc.)</p>
              </button>
              <button
                type="button"
                onClick={() => setStage('porcion')}
                aria-label="Por Porción del Fabricante"
                className="rounded-2xl border border-gray-200 p-4 text-left hover:border-orange-300 hover:bg-orange-50"
              >
                <p className="font-semibold text-gray-900">Por Porción del Fabricante</p>
                <p className="text-xs text-gray-500">Según la porción indicada en la etiqueta del producto</p>
              </button>
            </div>
          </div>
        )}

        {stage === 'paquete' && producto?.encontrado && (
          <form action={addScannedItemAction} onSubmit={handleClose} className="space-y-4">
            {renderVolver('mode')}
            <input type="hidden" name="fecha" value={fecha} />
            <input type="hidden" name="tipo_ingesta" value={tipoIngestaEfectivo} />
            <input type="hidden" name="tipo_item" value="solido" />
            <input type="hidden" name="ean" value={producto.ean} />
            <p className="text-sm font-medium text-gray-700">
              ¿Cuánto del envase de {producto.nombre} consumiste?
            </p>
            <div className="grid grid-cols-2 gap-2">
              {PAQUETE_FRACCIONES.map(({ label, fraccion }) => {
                const gramos = producto.pesoNetoTotal != null ? Math.round(producto.pesoNetoTotal * fraccion) : null;
                return (
                  <button
                    key={label}
                    type="submit"
                    name="cantidad"
                    value={gramos ?? ''}
                    disabled={gramos == null}
                    className="rounded-xl border border-gray-200 py-3 text-sm font-semibold text-gray-700 enabled:hover:border-orange-300 enabled:hover:bg-orange-50 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    {label}
                    <span className="block text-xs font-normal text-gray-400">{gramos != null ? `${gramos} g` : '— g'}</span>
                  </button>
                );
              })}
            </div>
            {producto.pesoNetoTotal == null && (
              <p className="text-xs text-amber-600">
                No pudimos leer el peso del envase — usá &quot;Personalizar&quot; para ingresar los gramos directamente.
              </p>
            )}
            {!personalizarPaquete ? (
              <Button type="button" variant="outline" className="w-full" onClick={() => setPersonalizarPaquete(true)}>
                Personalizar fracción/peso
              </Button>
            ) : (
              <div className="space-y-2 rounded-xl border border-gray-200 p-3">
                <label htmlFor="paquete-gramos-custom" className="text-xs font-medium text-gray-600">
                  Gramos consumidos
                </label>
                <input
                  id="paquete-gramos-custom"
                  type="number"
                  name="cantidad"
                  min="1"
                  step="any"
                  placeholder="Ej: 45"
                  className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
                />
                <Button type="submit" variant="primary" className="w-full">
                  Guardar
                </Button>
              </div>
            )}
          </form>
        )}

        {stage === 'porcion' && producto?.encontrado && (
          <form action={addScannedItemAction} onSubmit={handleClose} className="space-y-4">
            {renderVolver('mode')}
            <input type="hidden" name="fecha" value={fecha} />
            <input type="hidden" name="tipo_ingesta" value={tipoIngestaEfectivo} />
            <input type="hidden" name="tipo_item" value="solido" />
            <input type="hidden" name="ean" value={producto.ean} />
            <p className="text-sm font-medium text-gray-700">
              1 porción equivale a: {producto.porcionEtiqueta ?? `${producto.porcion} g`}
            </p>
            <div className="grid grid-cols-2 gap-2">
              {PORCIONES_FABRICANTE.map(({ label, fraccion }) => {
                const gramos = Math.round(producto.porcion * fraccion);
                return (
                  <button
                    key={label}
                    type="submit"
                    name="cantidad"
                    value={gramos}
                    className="rounded-xl border border-gray-200 py-3 text-sm font-semibold text-gray-700 hover:border-orange-300 hover:bg-orange-50"
                  >
                    {label}
                    <span className="block text-xs font-normal text-gray-400">{gramos} g</span>
                  </button>
                );
              })}
            </div>
            {!personalizarPorcion ? (
              <Button type="button" variant="outline" className="w-full" onClick={() => setPersonalizarPorcion(true)}>
                Personalizar porciones
              </Button>
            ) : (
              <div className="space-y-2 rounded-xl border border-gray-200 p-3">
                <label htmlFor="porciones-custom" className="text-xs font-medium text-gray-600">
                  Cantidad de porciones
                </label>
                <input
                  id="porciones-custom"
                  type="number"
                  min="0.1"
                  step="any"
                  value={porcionesCustomValor}
                  onChange={(e) => setPorcionesCustomValor(e.target.value)}
                  placeholder="Ej: 1.5"
                  className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
                />
                <input
                  type="hidden"
                  name="cantidad"
                  value={Math.round((Number(porcionesCustomValor) || 0) * producto.porcion)}
                />
                <Button
                  type="submit"
                  variant="primary"
                  className="w-full"
                  disabled={!(Number(porcionesCustomValor) > 0)}
                >
                  Guardar
                </Button>
              </div>
            )}
          </form>
        )}

        {stage === 'discarded' && (
          <div className="space-y-4">
            <p className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">
              {producto?.encontrado === false
                ? 'No pudimos encontrar datos nutricionales confiables para este código de barras. '
                : ''}
              Te sugerimos usar otro método de registro: búsqueda manual por nombre o registro por chat.
            </p>
            <Button type="button" variant="primary" className="w-full" onClick={handleEscanearOtro}>
              Escanear otro código
            </Button>
          </div>
        )}
      </div>
    </Modal>
  );
}
