'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Button from '@/components/ui/Button';
import { getVajillaInfo, type VajillaTipo } from '@/lib/vajilla';
import { VajillaGuia } from './VajillaSelector';

type Mode = 'loading' | 'live' | 'fallback';

/**
 * NUT-158 — Captura de foto con guía de vajilla calibrada superpuesta en vivo.
 *
 * Usa `getUserMedia` + `<video>` para poder overlayear la guía durante el
 * encuadre. Degrada en cascada a `<input type="file" capture>` cuando
 * `getUserMedia` no está disponible (contexto inseguro, navegador viejo) o
 * falla (permiso denegado, sin cámara). "Importar de galería" siempre disponible.
 */
export default function CameraCapture({
  guiaTipo,
  onCapture,
}: {
  guiaTipo: VajillaTipo;
  onCapture: (file: File) => void;
}) {
  const supportsCamera =
    typeof navigator !== 'undefined' && typeof navigator.mediaDevices?.getUserMedia === 'function';

  const [mode, setMode] = useState<Mode>(supportsCamera ? 'loading' : 'fallback');
  const [notice, setNotice] = useState<string | null>(
    supportsCamera ? null : 'Tu navegador no permite usar la cámara acá. Subí una foto en su lugar.',
  );
  const [stream, setStream] = useState<MediaStream | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const captureInputRef = useRef<HTMLInputElement>(null);
  const galleryInputRef = useRef<HTMLInputElement>(null);

  const stopStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    setStream(null);
  }, []);

  // Pedir la cámara.
  useEffect(() => {
    if (!supportsCamera) return;
    let cancelled = false;

    (async () => {
      try {
        const media = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' } },
          audio: false,
        });
        if (cancelled) {
          media.getTracks().forEach((track) => track.stop());
          return;
        }
        streamRef.current = media;
        setStream(media);
        setMode('live');
      } catch (err) {
        if (cancelled) return;
        const name = err instanceof DOMException ? err.name : '';
        setNotice(
          name === 'NotAllowedError'
            ? 'No diste permiso para la cámara. Podés subir una foto en su lugar.'
            : name === 'NotFoundError'
              ? 'No encontramos una cámara. Subí una foto en su lugar.'
              : 'No pudimos acceder a la cámara. Subí una foto en su lugar.',
        );
        setMode('fallback');
      }
    })();

    return () => {
      cancelled = true;
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    };
  }, [supportsCamera]);

  // Enganchar el stream al <video> una vez que ambos existen (el <video> recién
  // se monta cuando mode === 'live', así que esto corre después de ese render).
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !stream) return;
    video.srcObject = stream;
    void video.play().catch(() => {});
    return () => {
      video.srcObject = null;
    };
  }, [stream, mode]);

  const handleFile = (file: File | undefined) => {
    if (!file) return;
    stopStream();
    onCapture(file);
  };

  const handleShutter = () => {
    const video = videoRef.current;
    if (!video || !video.videoWidth) return;
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    canvas.toBlob(
      (blob) => {
        if (!blob) return;
        stopStream();
        onCapture(new File([blob], `comida-${Date.now()}.jpg`, { type: 'image/jpeg' }));
      },
      'image/jpeg',
      0.92,
    );
  };

  const guiaLabel = getVajillaInfo(guiaTipo).label;

  return (
    <div className="space-y-4">
      {mode === 'live' && (
        <div className="relative overflow-hidden rounded-2xl border border-gray-100 bg-black">
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted
            className="h-72 w-full object-cover"
            aria-label="Vista de la cámara"
          />
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <VajillaGuia tipo={guiaTipo} variant="overlay" className="h-full w-full" />
          </div>
          <p className="pointer-events-none absolute bottom-2 left-0 right-0 text-center text-xs font-medium text-white/90 drop-shadow">
            Encuadrá el {guiaLabel.toLowerCase()} en la elipse — sacá la foto en ángulo, no desde arriba
          </p>
        </div>
      )}

      {mode === 'loading' && (
        <div className="flex h-72 items-center justify-center rounded-2xl border border-gray-100 bg-gray-50">
          <svg className="h-8 w-8 animate-spin text-gray-400" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
        </div>
      )}

      {mode === 'fallback' && notice && (
        <p
          className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700"
          aria-live="polite"
        >
          {notice}
        </p>
      )}

      <div className="grid grid-cols-2 gap-3">
        {mode === 'live' ? (
          <Button type="button" variant="primary" className="flex-col gap-1.5 py-4" onClick={handleShutter}>
            <span className="text-xl" aria-hidden="true">📸</span>
            <span>Capturar foto</span>
          </Button>
        ) : (
          <Button
            type="button"
            variant="primary"
            className="flex-col gap-1.5 py-4"
            disabled={mode === 'loading'}
            onClick={() => captureInputRef.current?.click()}
          >
            <span className="text-xl" aria-hidden="true">📷</span>
            <span>Tomar foto</span>
          </Button>
        )}
        <Button
          type="button"
          variant="outline"
          className="flex-col gap-1.5 py-4"
          onClick={() => galleryInputRef.current?.click()}
        >
          <span className="text-xl" aria-hidden="true">🖼️</span>
          <span>Importar de galería</span>
        </Button>
      </div>

      <input
        ref={captureInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={(e) => handleFile(e.target.files?.[0])}
      />
      <input
        ref={galleryInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => handleFile(e.target.files?.[0])}
      />
    </div>
  );
}
