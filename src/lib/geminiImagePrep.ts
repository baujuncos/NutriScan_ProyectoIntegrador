/**
 * Compresión server-side de la foto antes de mandarla a Gemini (épica NUT-12).
 *
 * El recorte del cliente (`recortarImagen` en recorteFoto.ts) ya baja la
 * imagen a ≤1024px con calidad 0.9, pero degrada al archivo original sin
 * tocar si el canvas no está disponible (jsdom, navegadores viejos, etc.).
 * Esta es la garantía server-side: sin importar qué mande el cliente, lo que
 * viaja a Gemini nunca supera `MAX_LADO_PX` ni pesa más de lo necesario.
 */
import sharp from 'sharp';

export const MAX_LADO_PX = 1024;
const JPEG_QUALITY = 78;

export class ImagenInvalidaError extends Error {}

export interface ImagenComprimida {
  base64: string;
  mimeType: string;
}

/** Redimensiona a ≤1024px de lado mayor, re-orienta por EXIF y comprime a JPEG calidad 78. */
export async function comprimirImagenParaGemini(buffer: Buffer): Promise<ImagenComprimida> {
  let salida: Buffer;
  try {
    salida = await sharp(buffer)
      .rotate() // aplica la orientación EXIF antes de recortar el buffer que la contiene
      .resize({ width: MAX_LADO_PX, height: MAX_LADO_PX, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: JPEG_QUALITY })
      .toBuffer();
  } catch {
    throw new ImagenInvalidaError('No pudimos procesar la imagen. Probá con otra foto.');
  }
  return { base64: salida.toString('base64'), mimeType: 'image/jpeg' };
}
