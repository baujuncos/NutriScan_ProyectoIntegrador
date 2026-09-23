'use client';

import { useEffect, useRef, useState } from 'react';
import Modal from '@/components/ui/Modal';
import Button from '@/components/ui/Button';
import {
  construirMetadataVajilla,
  getDiametroDefault,
  getVajillaInfo,
  requiereDiametro,
  validarDiametro,
  type VajillaTipo,
} from '@/lib/vajilla';
import { evaluarAngulo, type LecturaAngulo } from '@/lib/anguloDispositivo';
import {
  calcularRecorte,
  recortarImagen,
  type EntradaReconocimiento,
} from '@/lib/recorteFoto';
import {
  normalizarIngrediente,
  type FoodDetectionResult,
  type PreguntasPorIngrediente,
} from '@/lib/geminiFoodPrompt';
import VajillaSelector, { VajillaGuia } from './VajillaSelector';
import CameraCapture from './CameraCapture';
import { llamarReconocimiento, ReconocimientoError } from './reconocimientoApi';

type Stage = 'vajilla' | 'diametro' | 'capture' | 'preview' | 'recognizing' | 'done' | 'otro';

export default function AIRecognitionModal({
  open,
  onClose,
  onSelectOtro,
}: {
  open: boolean;
  onClose: () => void;
  onSelectOtro: () => void;
}) {
  const [stage, setStage] = useState<Stage>('vajilla');
  const [vajillaTipo, setVajillaTipo] = useState<VajillaTipo | null>(null);
  const [diametroInput, setDiametroInput] = useState('');
  const [diametroCm, setDiametroCm] = useState<number | null>(null);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  // Encuadre de la foto: zoom + desplazamiento para alinear el plato con la guía.
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const dragRef = useRef<{ x: number; y: number } | null>(null);
  // El File capturado no necesita re-render; se guarda en un ref para el payload.
  const capturedFileRef = useRef<File | null>(null);
  // Espejo del object URL vigente para poder liberarlo al desmontar.
  const imageUrlRef = useRef<string | null>(null);
  // Lectura de ángulo al momento de capturar + tamaño natural de la foto + contenedor de preview.
  const anguloRef = useRef<LecturaAngulo>(evaluarAngulo(null));
  const imgSizeRef = useRef<{ w: number; h: number } | null>(null);
  const previewContainerRef = useRef<HTMLDivElement>(null);
  // NUT-154/156 — resultado del reconocimiento (o error) y estado del loop de
  // preguntas aclaratorias, mantenido en memoria: el endpoint es stateless.
  const [recognitionResult, setRecognitionResult] = useState<FoodDetectionResult | null>(null);
  const [recognitionError, setRecognitionError] = useState<string | null>(null);
  const [preguntasPorIngrediente, setPreguntasPorIngrediente] = useState<PreguntasPorIngrediente>({});
  const [respuestaDraft, setRespuestaDraft] = useState<Record<string, string>>({});
  const [refiningIngredient, setRefiningIngredient] = useState<string | null>(null);

  const setImage = (url: string | null) => {
    if (imageUrlRef.current) URL.revokeObjectURL(imageUrlRef.current);
    imageUrlRef.current = url;
    setImageUrl(url);
  };

  // Liberar el último object URL al desmontar.
  useEffect(() => () => {
    if (imageUrlRef.current) URL.revokeObjectURL(imageUrlRef.current);
  }, []);

  const resetEncuadre = () => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
    dragRef.current = null;
  };

  const resetState = () => {
    setImage(null);
    setStage('vajilla');
    setVajillaTipo(null);
    setDiametroInput('');
    setDiametroCm(null);
    capturedFileRef.current = null;
    anguloRef.current = evaluarAngulo(null);
    imgSizeRef.current = null;
    setRecognitionResult(null);
    setRecognitionError(null);
    setPreguntasPorIngrediente({});
    setRespuestaDraft({});
    setRefiningIngredient(null);
    resetEncuadre();
  };

  const handleClose = () => {
    resetState();
    onClose();
  };

  // "Otro" (NUT-160): deriva a la carga manual y deja el modal listo para la próxima apertura.
  const handleSelectOtro = () => {
    onSelectOtro();
    resetState();
  };

  const handleSelectVajilla = (tipo: VajillaTipo) => {
    setVajillaTipo(tipo);
    if (!requiereDiametro(tipo)) {
      setStage('otro');
      return;
    }
    const def = getDiametroDefault(tipo);
    setDiametroInput(def != null ? String(def) : '');
    setDiametroCm(def);
    setStage('diametro');
  };

  const adjustDiametro = (delta: number) => {
    if (!vajillaTipo) return;
    const info = getVajillaInfo(vajillaTipo);
    const current = Number(diametroInput) || info.diametroDefaultCm || 0;
    let next = Math.round(current + delta);
    if (info.diametroMinCm != null) next = Math.max(info.diametroMinCm, next);
    if (info.diametroMaxCm != null) next = Math.min(info.diametroMaxCm, next);
    setDiametroInput(String(next));
  };

  const diametroValidacion = vajillaTipo
    ? validarDiametro(vajillaTipo, diametroInput)
    : { valido: false };

  const handleConfirmDiametro = () => {
    if (!vajillaTipo || !diametroValidacion.valido) return;
    setDiametroCm(Number(diametroInput));
    setStage('capture');
  };

  const handleCaptured = (file: File, angulo: LecturaAngulo) => {
    setImage(URL.createObjectURL(file));
    capturedFileRef.current = file;
    anguloRef.current = angulo;
    imgSizeRef.current = null;
    resetEncuadre();
    setStage('preview');
  };

  const handlePointerDown = (e: React.PointerEvent) => {
    if (stage !== 'preview') return;
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
    if (!vajillaTipo || vajillaTipo === 'otro' || diametroCm == null || !file) return;
    setStage('recognizing');
    setRecognitionResult(null);
    setRecognitionError(null);

    // NUT-165: recortar la foto según el encuadre manual (zoom/pan) antes del
    // reconocimiento. Con zoom=1 y pan=0,0 el recorte es la imagen completa.
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
    // Recordar la foto ya recortada: hace falta reenviarla si el usuario
    // responde una pregunta aclaratoria (NUT-154/156).
    capturedFileRef.current = imagen;

    const angulo = anguloRef.current;
    const entrada: EntradaReconocimiento = {
      imagen,
      vajilla: construirMetadataVajilla(vajillaTipo, diametroCm),
      encuadre: { zoom: Number(zoom.toFixed(2)), panX: Math.round(pan.x), panY: Math.round(pan.y) },
      angulo: { beta: angulo.beta, estado: angulo.estado, dentroDeRango: angulo.dentroDeRango },
    };

    try {
      const result = await llamarReconocimiento({
        imagen: entrada.imagen,
        vajilla: { tipo: vajillaTipo, diametroCm },
        angulo: entrada.angulo,
        preguntasPorIngrediente,
      });
      setRecognitionResult(result);
    } catch (err) {
      setRecognitionError(
        err instanceof ReconocimientoError
          ? err.message
          : 'No pudimos completar el reconocimiento. Probá de nuevo.',
      );
    }
    setStage('done');
  };

  const handleAnswerQuestion = async (ingredient: string) => {
    const file = capturedFileRef.current;
    const respuesta = respuestaDraft[ingredient]?.trim();
    if (!vajillaTipo || vajillaTipo === 'otro' || diametroCm == null || !file || !recognitionResult || !respuesta) {
      return;
    }
    const clave = normalizarIngrediente(ingredient);
    const siguientesPreguntas: PreguntasPorIngrediente = {
      ...preguntasPorIngrediente,
      [clave]: (preguntasPorIngrediente[clave] ?? 0) + 1,
    };
    setRefiningIngredient(ingredient);
    setRecognitionError(null);
    try {
      const result = await llamarReconocimiento({
        imagen: file,
        vajilla: { tipo: vajillaTipo, diametroCm },
        angulo: {
          beta: anguloRef.current.beta,
          estado: anguloRef.current.estado,
          dentroDeRango: anguloRef.current.dentroDeRango,
        },
        preguntasPorIngrediente: siguientesPreguntas,
        refinamiento: { previousDetection: recognitionResult, respuestaUsuario: { ingredient, respuesta } },
      });
      setPreguntasPorIngrediente(siguientesPreguntas);
      setRecognitionResult(result);
      setRespuestaDraft((prev) => ({ ...prev, [ingredient]: '' }));
    } catch (err) {
      setRecognitionError(
        err instanceof ReconocimientoError
          ? err.message
          : 'No pudimos completar el reconocimiento. Probá de nuevo.',
      );
    }
    setRefiningIngredient(null);
  };

  const chipVajilla =
    vajillaTipo && vajillaTipo !== 'otro'
      ? `${getVajillaInfo(vajillaTipo).label}${diametroCm ? ` · ${diametroCm} cm` : ''}`
      : null;

  return (
    <Modal open={open} onClose={handleClose} title="✨ Reconocimiento por IA">
      <div className="space-y-4">
        {stage === 'vajilla' && (
          <>
            <p className="text-sm text-gray-500">
              Antes de la foto, elegí el tipo de vajilla. Lo usamos como referencia de escala para
              estimar mejor el peso de la comida.
            </p>
            <VajillaSelector value={vajillaTipo} onSelect={handleSelectVajilla} />
          </>
        )}

        {stage === 'diametro' && vajillaTipo && (
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <span className="text-gray-400">
                <VajillaGuia tipo={vajillaTipo} className="h-12 w-12" />
              </span>
              <div>
                <p className="text-sm font-semibold text-gray-900">{getVajillaInfo(vajillaTipo).label}</p>
                <p className="text-xs text-gray-400">Confirmá el diámetro real de tu plato.</p>
              </div>
            </div>

            <div>
              <label htmlFor="vajilla-diametro" className="text-sm font-medium text-gray-700">
                Diámetro
              </label>
              <div className="mt-1 flex items-center gap-2">
                <button
                  type="button"
                  aria-label="Disminuir diámetro"
                  onClick={() => adjustDiametro(-1)}
                  className="h-10 w-10 flex-shrink-0 rounded-xl bg-gray-100 text-lg font-semibold text-gray-600 hover:bg-gray-200"
                >
                  −
                </button>
                <div className="relative flex-1">
                  <input
                    id="vajilla-diametro"
                    type="number"
                    inputMode="numeric"
                    value={diametroInput}
                    onChange={(e) => setDiametroInput(e.target.value)}
                    min={getVajillaInfo(vajillaTipo).diametroMinCm ?? undefined}
                    max={getVajillaInfo(vajillaTipo).diametroMaxCm ?? undefined}
                    step={1}
                    className={`w-full rounded-xl border bg-white px-3 py-2.5 pr-10 text-sm text-gray-900 focus:outline-none focus:ring-2 ${
                      diametroValidacion.valido
                        ? 'border-gray-200 focus:ring-blue-500'
                        : 'border-red-400 focus:ring-red-500'
                    }`}
                  />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm font-medium text-gray-500">
                    cm
                  </span>
                </div>
                <button
                  type="button"
                  aria-label="Aumentar diámetro"
                  onClick={() => adjustDiametro(1)}
                  className="h-10 w-10 flex-shrink-0 rounded-xl bg-gray-100 text-lg font-semibold text-gray-600 hover:bg-gray-200"
                >
                  +
                </button>
              </div>
              <div aria-live="polite" className="min-h-[1rem]">
                {!diametroValidacion.valido && diametroValidacion.error && (
                  <p className="pt-1 text-xs text-red-500">{diametroValidacion.error}</p>
                )}
              </div>
              <p className="text-xs text-gray-400">
                Rango habitual: {getVajillaInfo(vajillaTipo).diametroMinCm}–
                {getVajillaInfo(vajillaTipo).diametroMaxCm} cm.
              </p>
            </div>

            <div className="flex gap-2">
              <Button
                type="button"
                variant="primary"
                className="flex-1"
                disabled={!diametroValidacion.valido}
                onClick={handleConfirmDiametro}
              >
                Continuar
              </Button>
              <Button type="button" variant="outline" className="flex-1" onClick={() => setStage('vajilla')}>
                Volver
              </Button>
            </div>
          </div>
        )}

        {stage === 'capture' && vajillaTipo && (
          <div className="space-y-4">
            <CameraCapture guiaTipo={vajillaTipo} onCapture={handleCaptured} />
            <Button type="button" variant="outline" className="w-full" onClick={() => setStage('diametro')}>
              Volver
            </Button>
          </div>
        )}

        {(stage === 'preview' || stage === 'recognizing' || stage === 'done') && imageUrl && vajillaTipo && (
          <div className="space-y-4">
            {chipVajilla && (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-purple-50 px-3 py-1 text-xs font-semibold text-purple-700">
                📐 {chipVajilla}
              </span>
            )}
            <div
              ref={previewContainerRef}
              className="relative h-72 overflow-hidden rounded-2xl border border-gray-100 bg-gray-900"
              style={{ touchAction: 'none', cursor: stage === 'preview' ? 'grab' : 'default' }}
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
              <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                <VajillaGuia tipo={vajillaTipo} variant="overlay" className="h-full w-full" />
              </div>
              {stage === 'recognizing' && (
                <div className="absolute inset-0 flex items-center justify-center bg-black/40">
                  <svg className="h-8 w-8 animate-spin text-white" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                </div>
              )}
            </div>

            {stage === 'preview' && (
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
            )}
            {stage === 'preview' && (
              <p className="text-xs text-gray-400">
                Arrastrá y ajustá el zoom para que el borde del plato coincida con la elipse.
              </p>
            )}

            {stage === 'done' && recognitionError && (
              <p
                className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
                aria-live="polite"
              >
                {recognitionError}
              </p>
            )}

            {stage === 'done' && recognitionResult && (
              <div className="space-y-3" aria-live="polite">
                <ul className="space-y-2">
                  {recognitionResult.detectedIngredients.map((item) => (
                    <li
                      key={item.ingredient}
                      className="rounded-xl border border-gray-100 bg-white px-3 py-2.5"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div>
                          <p className="text-sm font-semibold text-gray-900">{item.ingredient}</p>
                          <p className="text-xs text-gray-400">
                            {item.type} · {Math.round(item.confidence * 100)}% de confianza
                          </p>
                        </div>
                        <span className="text-sm font-semibold text-purple-700">
                          {Math.round(item.estimatedWeightGrams)} g
                        </span>
                      </div>
                      {item.questionForUser && (
                        <div className="mt-2 space-y-1.5 rounded-lg bg-amber-50 px-3 py-2">
                          <p className="text-xs text-amber-700">{item.questionForUser}</p>
                          <div className="flex gap-2">
                            <input
                              type="text"
                              value={respuestaDraft[item.ingredient] ?? ''}
                              onChange={(e) =>
                                setRespuestaDraft((prev) => ({ ...prev, [item.ingredient]: e.target.value }))
                              }
                              placeholder="Tu respuesta"
                              className="flex-1 rounded-lg border border-amber-200 bg-white px-2.5 py-1.5 text-xs text-gray-900 focus:outline-none focus:ring-2 focus:ring-amber-400"
                            />
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              loading={refiningIngredient === item.ingredient}
                              disabled={!respuestaDraft[item.ingredient]?.trim() || refiningIngredient !== null}
                              onClick={() => void handleAnswerQuestion(item.ingredient)}
                            >
                              Responder
                            </Button>
                          </div>
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
                <p className="text-right text-sm font-semibold text-gray-700">
                  Total estimado: {Math.round(recognitionResult.totalEstimatedWeightGrams)} g
                </p>
              </div>
            )}

            <div className="flex gap-2">
              <Button
                type="button"
                variant="primary"
                className="flex-1"
                loading={stage === 'recognizing'}
                disabled={stage === 'recognizing'}
                onClick={() => void handleRecognize()}
              >
                {stage === 'recognizing'
                  ? 'Reconociendo...'
                  : stage === 'done' && recognitionError
                    ? 'Reintentar'
                    : 'Reconocer alimentos'}
              </Button>
              <Button
                type="button"
                variant="outline"
                className="flex-1"
                onClick={() => {
                  setImage(null);
                  capturedFileRef.current = null;
                  setStage('capture');
                }}
              >
                Repetir / Cambiar foto
              </Button>
            </div>
          </div>
        )}

        {stage === 'otro' && (
          <div className="space-y-4">
            <p className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">
              &quot;Otro&quot; no tiene una guía de escala calibrada, así que la estimación de peso por foto
              puede ser muy imprecisa. Te recomendamos usar otro método de carga.
            </p>
            <div className="flex flex-col gap-2">
              <Button type="button" variant="primary" onClick={handleSelectOtro}>
                Cargar sin foto
              </Button>
              <Button type="button" variant="ghost" onClick={() => setStage('vajilla')}>
                Elegir otra vajilla
              </Button>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}
