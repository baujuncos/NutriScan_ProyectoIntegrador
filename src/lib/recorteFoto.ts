/**
 * NUT-165 — Recorte de la foto según el encuadre manual (zoom / pan) antes de
 * (en el futuro, épica NUT-12) mandarla al reconocimiento visual.
 *
 * El usuario alinea el plato con la elipse guía usando zoom + arrastre en el
 * stage `preview` de AIRecognitionModal. Acá se traduce ese ajuste visual a un
 * recorte real de píxeles sobre la imagen fuente. Con `zoom = 1` y `pan = 0,0`
 * el recorte es la imagen completa.
 */

import type { EstadoAngulo } from './anguloDispositivo';
import type { VajillaMetadata } from './vajilla';

/** Lado máximo (px) de la imagen que se entrega al reconocimiento. */
export const MAX_LADO_PX = 1024;

export interface Recorte {
  sx: number;
  sy: number;
  sw: number;
  sh: number;
}

/**
 * Rectángulo (en px de la imagen fuente) visible a través del contenedor de
 * preview, deshaciendo el `object-contain` + `transform: translate(pan) scale(zoom)`
 * con `transform-origin: center`. Clampeado a `[0..imgW] × [0..imgH]`.
 */
export function calcularRecorte(p: {
  imgW: number;
  imgH: number;
  viewW: number;
  viewH: number;
  zoom: number;
  panX: number;
  panY: number;
}): Recorte {
  const { imgW, imgH, viewW, viewH, zoom, panX, panY } = p;

  if (imgW <= 0 || imgH <= 0 || viewW <= 0 || viewH <= 0 || zoom <= 0) {
    return { sx: 0, sy: 0, sw: Math.max(0, imgW), sh: Math.max(0, imgH) };
  }

  // Fit `object-contain`: tamaño renderizado de la imagen dentro del contenedor.
  const f = Math.min(viewW / imgW, viewH / imgH);
  const dispW = imgW * f;
  const dispH = imgH * f;
  const offX = (viewW - dispW) / 2;
  const offY = (viewH - dispH) / 2;

  const cx = viewW / 2;
  const cy = viewH / 2;

  // Esquinas del viewport (0,0) y (viewW,viewH) → coords del elemento sin transformar.
  const toLocalX = (sxScreen: number) => cx + (sxScreen - cx - panX) / zoom;
  const toLocalY = (syScreen: number) => cy + (syScreen - cy - panY) / zoom;

  const toSrcX = (local: number) => (local - offX) / f;
  const toSrcY = (local: number) => (local - offY) / f;

  const sx0 = toSrcX(toLocalX(0));
  const sx1 = toSrcX(toLocalX(viewW));
  const sy0 = toSrcY(toLocalY(0));
  const sy1 = toSrcY(toLocalY(viewH));

  const clamp = (v: number, max: number) => Math.min(Math.max(v, 0), max);

  const left = clamp(Math.min(sx0, sx1), imgW);
  const right = clamp(Math.max(sx0, sx1), imgW);
  const top = clamp(Math.min(sy0, sy1), imgH);
  const bottom = clamp(Math.max(sy0, sy1), imgH);

  return {
    sx: left,
    sy: top,
    sw: Math.max(1, right - left),
    sh: Math.max(1, bottom - top),
  };
}

/** Escala `sw × sh` para que el lado mayor no supere `maxLado`, respetando el aspecto. */
export function dimensionesSalida(
  sw: number,
  sh: number,
  maxLado = MAX_LADO_PX,
): { w: number; h: number } {
  const lado = Math.max(sw, sh);
  if (lado <= maxLado || lado <= 0) {
    return { w: Math.max(1, Math.round(sw)), h: Math.max(1, Math.round(sh)) };
  }
  const k = maxLado / lado;
  return { w: Math.max(1, Math.round(sw * k)), h: Math.max(1, Math.round(sh * k)) };
}

/** Contrato de entrada al reconocimiento visual (lo consumirá la llamada a Gemini de NUT-12). */
export interface EntradaReconocimiento {
  /** JPEG recortado al encuadre, lado máximo `MAX_LADO_PX`. */
  imagen: File;
  vajilla: VajillaMetadata;
  encuadre: { zoom: number; panX: number; panY: number };
  angulo: { beta: number | null; estado: EstadoAngulo; dentroDeRango: boolean };
}

function nombreRecortado(nombre: string): string {
  const base = nombre.replace(/\.[^.]+$/, '') || 'comida';
  return `${base}-recortada.jpg`;
}

async function cargarBitmap(file: File): Promise<ImageBitmap | HTMLImageElement> {
  if (typeof createImageBitmap === 'function') {
    return createImageBitmap(file);
  }
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('no se pudo cargar la imagen'));
    };
    img.src = url;
  });
}

/**
 * Aplica `rect` sobre `file` y devuelve un JPEG recortado (lado máx `maxLado`).
 * Degrada de forma segura: sin `document` / sin contexto 2d / sin `canvas.toBlob`
 * (jsdom, navegadores viejos) devuelve el `file` original sin tocar y nunca tira.
 */
export async function recortarImagen(
  file: File,
  rect: Recorte,
  maxLado = MAX_LADO_PX,
): Promise<File> {
  if (typeof document === 'undefined') return file;

  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx || typeof canvas.toBlob !== 'function') return file;

  let bitmap: ImageBitmap | HTMLImageElement;
  try {
    bitmap = await cargarBitmap(file);
  } catch {
    return file;
  }

  const sw = Math.max(1, Math.round(rect.sw));
  const sh = Math.max(1, Math.round(rect.sh));
  const { w, h } = dimensionesSalida(sw, sh, maxLado);
  canvas.width = w;
  canvas.height = h;
  ctx.drawImage(bitmap, Math.round(rect.sx), Math.round(rect.sy), sw, sh, 0, 0, w, h);
  if ('close' in bitmap && typeof bitmap.close === 'function') bitmap.close();

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, 'image/jpeg', 0.9),
  );
  if (!blob) return file;
  return new File([blob], nombreRecortado(file.name), { type: 'image/jpeg' });
}
