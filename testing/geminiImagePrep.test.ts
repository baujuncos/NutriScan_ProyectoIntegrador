import { describe, it, expect } from 'vitest';
import sharp from 'sharp';
import { comprimirImagenParaGemini, ImagenInvalidaError, MAX_LADO_PX } from '@/lib/geminiImagePrep';

async function pngDeTamaño(w: number, h: number): Promise<Buffer> {
  return sharp({ create: { width: w, height: h, channels: 3, background: { r: 200, g: 120, b: 60 } } })
    .png()
    .toBuffer();
}

describe('comprimirImagenParaGemini (procesamiento local con sharp, sin red)', () => {
  it('redimensiona una imagen más grande que 1024px al lado mayor permitido', async () => {
    const original = await pngDeTamaño(2000, 1500);
    const { base64, mimeType } = await comprimirImagenParaGemini(original);

    const metadata = await sharp(Buffer.from(base64, 'base64')).metadata();
    expect(mimeType).toBe('image/jpeg');
    expect(metadata.format).toBe('jpeg');
    expect(Math.max(metadata.width!, metadata.height!)).toBeLessThanOrEqual(MAX_LADO_PX);
  });

  it('no agranda una imagen más chica que 1024px (withoutEnlargement)', async () => {
    const original = await pngDeTamaño(300, 200);
    const { base64 } = await comprimirImagenParaGemini(original);

    const metadata = await sharp(Buffer.from(base64, 'base64')).metadata();
    expect(metadata.width).toBe(300);
    expect(metadata.height).toBe(200);
  });

  it('reduce sustancialmente el peso de una imagen grande', async () => {
    const original = await pngDeTamaño(2000, 1500);
    const { base64 } = await comprimirImagenParaGemini(original);

    const comprimidoBytes = Buffer.from(base64, 'base64').length;
    expect(comprimidoBytes).toBeLessThan(original.length);
  });

  it('rechaza un buffer que no es una imagen válida', async () => {
    await expect(comprimirImagenParaGemini(Buffer.from('esto no es una imagen'))).rejects.toBeInstanceOf(
      ImagenInvalidaError,
    );
  });
});
