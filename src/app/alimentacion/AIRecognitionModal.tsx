'use client';

import { useEffect, useRef, useState } from 'react';
import Modal from '@/components/ui/Modal';
import Button from '@/components/ui/Button';
import {
  construirMetadataVajilla,
  getDiametroDefault,
  getVajillaInfo,
  validarDiametro,
  type VajillaTipo,
} from '@/lib/vajilla';
import type { IngestaTipo } from '@/lib/nutrition';
import { evaluarAngulo, type LecturaAngulo } from '@/lib/anguloDispositivo';
import {
  calcularRecorte,
  recortarImagen,
  type EntradaReconocimiento,
} from '@/lib/recorteFoto';
import {
  armarSaveRequest,
  crearItemManual,
  crearWorkingItems,
  opcionesDudaOriginal,
  reemplazarAlimento,
  ajustarPeso,
  deshacerPeso,
  aplicarRespuesta,
  type WorkingItem,
} from '@/lib/deteccionResultado';
import VajillaSelector, { VajillaGuia } from './VajillaSelector';
import CameraCapture, { type FuenteCaptura } from './CameraCapture';
import AIRecognitionResult from './AIRecognitionResult';
import ChangeFoodSheet from './ChangeFoodSheet';
import { llamarReconocimiento, guardarCorrecciones, ReconocimientoError } from './reconocimientoApi';
import { leerUltimaVajilla, guardarUltimaVajilla } from '@/lib/vajillaPreferencia';
import { nutritionProviderMock } from '@/lib/nutritionMock';
import { IconSparkle } from './icons';

type Stage = 'foto' | 'resultado' | 'cambiar-alimento' | 'agregar-alimento';

export default function AIRecognitionModal({
  open,
  onClose,
  onSelectOtro,
  mealType,
  mealLabel,
}: {
  open: boolean;
  onClose: () => void;
  onSelectOtro: () => void;
  mealType: IngestaTipo;
  mealLabel: string;
}) {
  const [stage, setStage] = useState<Stage>('foto');

  // NUT-169 — última vajilla/diámetro usados, precargados (persistencia en
  // localStorage). Sin preferencia guardada (primer uso), arranca en "Plato
  // playo" para que la Pantalla 1 se vea siempre completa de entrada, como en
  // el mockup — nunca sólo el selector de vajilla.
  const [vajillaTipo, setVajillaTipo] = useState<VajillaTipo | null>(
    () => leerUltimaVajilla()?.tipo ?? 'plato_playo',
  );
  const [diametroInput, setDiametroInput] = useState<string>(() => {
    const pref = leerUltimaVajilla();
    if (pref?.diametroCm != null) return String(pref.diametroCm);
    const tipo = pref?.tipo && pref.tipo !== 'otro' ? pref.tipo : 'plato_playo';
    return String(getDiametroDefault(tipo) ?? '');
  });

  const [imageUrl, setImageUrl] = useState<string | null>(null);
  // "Con foto de galería se agrega el encuadre rápido... antes de reconocer. Con foto de cámara no."
  const [encuadrando, setEncuadrando] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const dragRef = useRef<{ x: number; y: number } | null>(null);
  const capturedFileRef = useRef<File | null>(null);
  const imageUrlRef = useRef<string | null>(null);
  const anguloRef = useRef<LecturaAngulo>(evaluarAngulo(null));
  const imgSizeRef = useRef<{ w: number; h: number } | null>(null);
  const previewContainerRef = useRef<HTMLDivElement>(null);

  const [recognizing, setRecognizing] = useState(false);
  const [recognitionError, setRecognitionError] = useState<string | null>(null);

  // NUT-169/170/171 — resultado editable: ítems de trabajo (contrato en src/lib/deteccion.ts).
  const [predictionId, setPredictionId] = useState<string | null>(null);
  const [items, setItems] = useState<WorkingItem[]>([]);
  const [removedItemIds, setRemovedItemIds] = useState<string[]>([]);
  const [changeFoodTarget, setChangeFoodTarget] = useState<WorkingItem | null>(null);

  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState(false);

  const setImage = (url: string | null) => {
    if (imageUrlRef.current) URL.revokeObjectURL(imageUrlRef.current);
    imageUrlRef.current = url;
    setImageUrl(url);
  };

  useEffect(() => () => {
    if (imageUrlRef.current) URL.revokeObjectURL(imageUrlRef.current);
  }, []);

  const resetEncuadre = () => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
    dragRef.current = null;
  };

  // Reinicia todo lo relativo a la foto/resultado — la vajilla y el diámetro
  // NO se resetean acá: quedan precargados para la próxima vez (NUT-169).
  const resetState = () => {
    setImage(null);
    setStage('foto');
    setEncuadrando(false);
    capturedFileRef.current = null;
    anguloRef.current = evaluarAngulo(null);
    imgSizeRef.current = null;
    setRecognizing(false);
    setRecognitionError(null);
    setPredictionId(null);
    setItems([]);
    setRemovedItemIds([]);
    setChangeFoodTarget(null);
    setSaving(false);
    setSaveError(null);
    setSaveSuccess(false);
    resetEncuadre();
  };

  const handleClose = () => {
    resetState();
    onClose();
  };

  const handleSelectOtro = () => {
    onSelectOtro();
    resetState();
  };

  const handleSelectVajilla = (tipo: VajillaTipo) => {
    setVajillaTipo(tipo);
    if (tipo === 'otro') {
      guardarUltimaVajilla({ tipo, diametroCm: null });
      return;
    }
    const def = getDiametroDefault(tipo);
    setDiametroInput(def != null ? String(def) : '');
    guardarUltimaVajilla({ tipo, diametroCm: def });
  };

  const handleDiametroChange = (value: string) => {
    setDiametroInput(value);
    const n = Number(value);
    if (vajillaTipo && vajillaTipo !== 'otro' && Number.isFinite(n)) {
      guardarUltimaVajilla({ tipo: vajillaTipo, diametroCm: n });
    }
  };

  const adjustDiametro = (delta: number) => {
    if (!vajillaTipo || vajillaTipo === 'otro') return;
    const info = getVajillaInfo(vajillaTipo);
    const current = Number(diametroInput) || info.diametroDefaultCm || 0;
    let next = Math.round(current + delta);
    if (info.diametroMinCm != null) next = Math.max(info.diametroMinCm, next);
    if (info.diametroMaxCm != null) next = Math.min(info.diametroMaxCm, next);
    handleDiametroChange(String(next));
  };

  const diametroValidacion = vajillaTipo && vajillaTipo !== 'otro' ? validarDiametro(vajillaTipo, diametroInput) : { valido: false };
  const diametroCmValido = diametroValidacion.valido ? Number(diametroInput) : null;

  const handlePointerDown = (e: React.PointerEvent) => {
    if (!encuadrando) return;
    dragRef.current = { x: e.clientX - pan.x, y: e.clientY - pan.y };
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };
  const handlePointerMove = (e: React.PointerEvent) => {
    if (!dragRef.current) return;
    setPan({ x: e.clientX - dragRef.current.x, y: e.clientY - dragRef.current.y });
  };
  const handlePointerUp = () => {
    dragRef.current = null;
  };

  const handleRecognize = async () => {
    const file = capturedFileRef.current;
    if (!vajillaTipo || vajillaTipo === 'otro' || diametroCmValido == null || !file) return;
    setRecognizing(true);
    setRecognitionError(null);

    // NUT-165: sólo hay recorte manual (zoom/pan) si venimos del paso de
    // encuadre de galería — con foto de cámara `imgSizeRef` nunca se seteó.
    const imgSize = imgSizeRef.current;
    const rectView = previewContainerRef.current?.getBoundingClientRect();
    let imagen = file;
    if (imgSize && rectView && rectView.width > 0) {
      const recorte = calcularRecorte({
        imgW: imgSize.w,
        imgH: imgSize.h,
        viewW: rectView.width,
        viewH: rectView.height,
        zoom,
        panX: pan.x,
        panY: pan.y,
      });
      imagen = await recortarImagen(file, recorte);
    }
    capturedFileRef.current = imagen;

    const angulo = anguloRef.current;
    const entrada: EntradaReconocimiento = {
      imagen,
      vajilla: construirMetadataVajilla(vajillaTipo, diametroCmValido),
      encuadre: { zoom: Number(zoom.toFixed(2)), panX: Math.round(pan.x), panY: Math.round(pan.y) },
      angulo: { beta: angulo.beta, estado: angulo.estado, dentroDeRango: angulo.dentroDeRango },
    };

    try {
      const result = await llamarReconocimiento({
        imagen: entrada.imagen,
        vajilla: { tipo: vajillaTipo, diametroCm: diametroCmValido },
        angulo: entrada.angulo,
      });
      setPredictionId(result.predictionId);
      setItems(crearWorkingItems(result));
      setEncuadrando(false);
      setStage('resultado');
    } catch (err) {
      setRecognitionError(
        err instanceof ReconocimientoError
          ? err.message
          : 'No pudimos completar el reconocimiento. Probá de nuevo.',
      );
    }
    setRecognizing(false);
  };

  const handleCaptured = (file: File, angulo: LecturaAngulo, source: FuenteCaptura) => {
    setImage(URL.createObjectURL(file));
    capturedFileRef.current = file;
    anguloRef.current = angulo;
    imgSizeRef.current = null;
    resetEncuadre();
    if (source === 'gallery') {
      setEncuadrando(true);
    } else {
      // Cámara en vivo: se reconoce directo, sin paso de encuadre.
      setEncuadrando(false);
      void handleRecognize();
    }
  };

  const handleDescartarFoto = () => {
    setImage(null);
    capturedFileRef.current = null;
    setEncuadrando(false);
    setRecognitionError(null);
  };

  const handleRepetir = () => {
    setImage(null);
    capturedFileRef.current = null;
    setEncuadrando(false);
    setRecognitionError(null);
    setPredictionId(null);
    setItems([]);
    setRemovedItemIds([]);
    setStage('foto');
  };

  const handleResponder = (uiId: string, respuesta: string | null, custom = false) => {
    setItems((prev) => prev.map((i) => (i.uiId === uiId ? aplicarRespuesta(i, respuesta, custom) : i)));
  };

  const handleAjustarPeso = (uiId: string, grams: number) => {
    setItems((prev) => prev.map((i) => (i.uiId === uiId ? ajustarPeso(i, grams) : i)));
  };

  const handleDeshacerPeso = (uiId: string) => {
    setItems((prev) => prev.map((i) => (i.uiId === uiId ? deshacerPeso(i) : i)));
  };

  const handleQuitarItem = (uiId: string) => {
    const item = items.find((i) => i.uiId === uiId);
    if (!item) return;
    if (item.sourceItemId) setRemovedItemIds((prev) => [...prev, item.sourceItemId as string]);
    setItems((prev) => prev.filter((i) => i.uiId !== uiId));
  };

  const handleAbrirCambiarAlimento = (item: WorkingItem) => {
    setChangeFoodTarget(item);
    setStage('cambiar-alimento');
  };

  const handleAbrirAgregarAlimento = () => {
    setChangeFoodTarget(null);
    setStage('agregar-alimento');
  };

  const handleVolverDeSheet = () => {
    setChangeFoodTarget(null);
    setStage('resultado');
  };

  const handleConfirmarAlimento = (alimento: { nombre: string; categoria: string }) => {
    if (stage === 'cambiar-alimento' && changeFoodTarget) {
      const targetId = changeFoodTarget.uiId;
      setItems((prev) => prev.map((i) => (i.uiId === targetId ? reemplazarAlimento(i, alimento) : i)));
    } else {
      setItems((prev) => [...prev, crearItemManual(alimento.nombre, alimento.categoria)]);
    }
    setChangeFoodTarget(null);
    setStage('resultado');
  };

  const handleGuardar = async () => {
    if (!predictionId) return;
    setSaving(true);
    setSaveError(null);
    try {
      const saveRequest = armarSaveRequest(predictionId, mealType, items, removedItemIds);
      await guardarCorrecciones(saveRequest);
      setSaveSuccess(true);
    } catch (err) {
      setSaveError(
        err instanceof ReconocimientoError ? err.message : 'No pudimos guardar los cambios. Probá de nuevo.',
      );
    }
    setSaving(false);
  };

  const chipVajilla =
    vajillaTipo && vajillaTipo !== 'otro'
      ? `${getVajillaInfo(vajillaTipo).label}${diametroCmValido ? ` · ${diametroCmValido} cm` : ''}`
      : '';

  const esHoja = stage === 'cambiar-alimento' || stage === 'agregar-alimento';
  const modalTitle = stage === 'cambiar-alimento' ? 'Cambiar alimento' : stage === 'agregar-alimento' ? 'Agregar alimento' : 'Reconocimiento por IA';
  const modalOnBack = esHoja ? handleVolverDeSheet : undefined;
  const modalIcon = esHoja ? undefined : <IconSparkle className="h-5 w-5" />;

  return (
    <Modal open={open} onClose={handleClose} title={modalTitle} onBack={modalOnBack} icon={modalIcon}>
      <div className="space-y-4">
        {stage === 'foto' && (
          <div className="space-y-4">
            <VajillaSelector value={vajillaTipo} onSelect={handleSelectVajilla} />

            {vajillaTipo === 'otro' && (
              <div className="space-y-4">
                <p className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">
                  &quot;Otro&quot; no tiene una guía de escala calibrada, así que la estimación de peso por foto
                  puede ser muy imprecisa. Te recomendamos usar otro método de carga.
                </p>
                <div className="flex flex-col gap-2">
                  <Button type="button" variant="primary" onClick={handleSelectOtro}>
                    Cargar sin foto
                  </Button>
                  <Button type="button" variant="ghost" onClick={() => setVajillaTipo(null)}>
                    Elegir otra vajilla
                  </Button>
                </div>
              </div>
            )}

            {/* La vajilla y el diámetro quedan siempre visibles arriba — tanto
                eligiendo la cámara en vivo como encuadrando una foto de galería. */}
            {vajillaTipo && vajillaTipo !== 'otro' && (
              <div className="space-y-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <label htmlFor="vajilla-diametro" className="text-sm font-medium text-gray-700">
                      Diámetro
                    </label>
                    <p className="text-xs text-gray-400">
                      Habitual: {getVajillaInfo(vajillaTipo).diametroMinCm}–{getVajillaInfo(vajillaTipo).diametroMaxCm} cm
                    </p>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      aria-label="Disminuir diámetro"
                      onClick={() => adjustDiametro(-1)}
                      className="h-9 w-9 flex-shrink-0 rounded-xl bg-gray-100 text-lg font-semibold text-gray-600 hover:bg-gray-200"
                    >
                      −
                    </button>
                    <div className="relative">
                      <input
                        id="vajilla-diametro"
                        type="number"
                        inputMode="numeric"
                        value={diametroInput}
                        onChange={(e) => handleDiametroChange(e.target.value)}
                        min={getVajillaInfo(vajillaTipo).diametroMinCm ?? undefined}
                        max={getVajillaInfo(vajillaTipo).diametroMaxCm ?? undefined}
                        step={1}
                        className={`w-20 rounded-xl border bg-white px-2 py-2 pr-7 text-center text-sm text-gray-900 focus:outline-none focus:ring-2 ${
                          diametroValidacion.valido
                            ? 'border-gray-200 focus:ring-blue-500'
                            : 'border-red-400 focus:ring-red-500'
                        }`}
                      />
                      <span className="pointer-events-none absolute right-1.5 top-1/2 -translate-y-1/2 text-xs font-medium text-gray-500">
                        cm
                      </span>
                    </div>
                    <button
                      type="button"
                      aria-label="Aumentar diámetro"
                      onClick={() => adjustDiametro(1)}
                      className="h-9 w-9 flex-shrink-0 rounded-xl bg-gray-100 text-lg font-semibold text-gray-600 hover:bg-gray-200"
                    >
                      +
                    </button>
                  </div>
                </div>
                <div aria-live="polite" className="min-h-[1rem]">
                  {!diametroValidacion.valido && 'error' in diametroValidacion && diametroValidacion.error && (
                    <p className="text-xs text-red-500">{diametroValidacion.error}</p>
                  )}
                </div>

                {!imageUrl && diametroCmValido != null && (
                  <CameraCapture guiaTipo={vajillaTipo} onCapture={handleCaptured} />
                )}

                {imageUrl && (
                  <div className="space-y-4">
                    <div
                      ref={previewContainerRef}
                      className="relative h-64 overflow-hidden rounded-2xl border border-gray-100 bg-gray-900"
                      style={{ touchAction: 'none', cursor: encuadrando ? 'grab' : 'default' }}
                      onPointerDown={handlePointerDown}
                      onPointerMove={handlePointerMove}
                      onPointerUp={handlePointerUp}
                      onPointerCancel={handlePointerUp}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={imageUrl}
                        alt="Vista previa de la comida"
                        draggable={false}
                        onLoad={(e) => {
                          imgSizeRef.current = {
                            w: e.currentTarget.naturalWidth,
                            h: e.currentTarget.naturalHeight,
                          };
                        }}
                        className="pointer-events-none absolute inset-0 h-full w-full select-none object-contain"
                        style={{
                          transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
                          transformOrigin: 'center',
                        }}
                      />
                      {encuadrando && (
                        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                          <VajillaGuia tipo={vajillaTipo} variant="overlay" className="h-full w-full" />
                        </div>
                      )}
                      {recognizing && (
                        <div className="absolute inset-0 flex items-center justify-center bg-black/40">
                          <svg className="h-8 w-8 animate-spin text-white" viewBox="0 0 24 24" fill="none">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                          </svg>
                        </div>
                      )}
                    </div>

                    {encuadrando && !recognizing && (
                      <>
                        <div className="flex items-center gap-3">
                          <span className="text-xs font-medium text-gray-400" aria-hidden="true">
                            Zoom
                          </span>
                          <input
                            type="range"
                            min={1}
                            max={3}
                            step={0.02}
                            value={zoom}
                            onChange={(e) => setZoom(Number(e.target.value))}
                            aria-label="Zoom de la foto"
                            className="h-1.5 flex-1 cursor-pointer appearance-none rounded-full bg-gray-200 accent-purple-500"
                          />
                          <button
                            type="button"
                            onClick={resetEncuadre}
                            className="text-xs font-semibold text-purple-600 hover:underline"
                          >
                            Reencuadrar
                          </button>
                        </div>
                        <p className="text-xs text-gray-400">
                          Arrastrá y ajustá el zoom para que el borde del plato coincida con la elipse.
                        </p>
                      </>
                    )}

                    {recognitionError && !recognizing && (
                      <p
                        className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
                        aria-live="polite"
                      >
                        {recognitionError}
                      </p>
                    )}

                    {!recognizing && (
                      <div className="flex gap-2">
                        <Button
                          type="button"
                          variant="primary"
                          className="flex-1"
                          onClick={() => void handleRecognize()}
                        >
                          {recognitionError ? 'Reintentar' : 'Reconocer alimentos'}
                        </Button>
                        <Button type="button" variant="outline" className="flex-1" onClick={handleDescartarFoto}>
                          {encuadrando ? 'Cancelar' : 'Tomar otra foto'}
                        </Button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {stage === 'resultado' && imageUrl && (
          <AIRecognitionResult
            photoUrl={imageUrl}
            vajillaChip={chipVajilla}
            items={items}
            mealLabel={mealLabel}
            saving={saving}
            saveError={saveError}
            saveSuccess={saveSuccess}
            onRepetir={handleRepetir}
            onResponder={handleResponder}
            onAjustarPeso={handleAjustarPeso}
            onDeshacerPeso={handleDeshacerPeso}
            onQuitarItem={handleQuitarItem}
            onAbrirCambiarAlimento={handleAbrirCambiarAlimento}
            onAbrirAgregarAlimento={handleAbrirAgregarAlimento}
            onGuardar={() => void handleGuardar()}
            onListo={handleClose}
          />
        )}

        {(stage === 'cambiar-alimento' || stage === 'agregar-alimento') && (
          <ChangeFoodSheet
            mode={stage === 'cambiar-alimento' ? 'replace' : 'add'}
            target={
              changeFoodTarget
                ? {
                    name: changeFoodTarget.name,
                    grams: changeFoodTarget.grams,
                    boundingBox: changeFoodTarget.boundingBox,
                    dudaOptions: opcionesDudaOriginal(changeFoodTarget),
                  }
                : undefined
            }
            photoUrl={imageUrl}
            mealType={mealType}
            provider={nutritionProviderMock}
            onConfirm={handleConfirmarAlimento}
          />
        )}
      </div>
    </Modal>
  );
}
