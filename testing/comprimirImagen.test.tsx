/**
 * NUT-251 — Compresión en el navegador de las fotos posturales (jsdom: sin canvas real, se simula).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { comprimirImagen, MAX_LADO_FOTO_POSTURAL_PX, recortarImagen } from '@/lib/recorteFoto';

const foto = (nombre = 'IMG_0001.HEIC.png', tipo = 'image/png') => new File([new Uint8Array(2048)], nombre, { type: tipo });

/** Canvas simulado: registra el tamaño al que se dibuja y la calidad pedida a toBlob. */
function simularCanvas(imagen: { width: number; height: number } | Error, blob: Blob | null = new Blob([new Uint8Array(512)], { type: 'image/jpeg' })) {
  const drawImage = vi.fn();
  const toBlob = vi.fn((cb: (b: Blob | null) => void) => cb(blob));
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage } as unknown as CanvasRenderingContext2D);
  vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(toBlob as never);
  const close = vi.fn();
  vi.stubGlobal(
    'createImageBitmap',
    vi.fn(() => (imagen instanceof Error ? Promise.reject(imagen) : Promise.resolve({ ...imagen, close }))),
  );
  return { drawImage, toBlob, close };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('comprimirImagen', () => {
  it('sin canvas (jsdom) devuelve el archivo original sin tocarlo y no tira', async () => {
    const original = foto();
    expect(await comprimirImagen(original)).toBe(original);
  });

  it('reduce el lado mayor a 1600 px, mantiene el aspecto y exporta JPEG de calidad 0,85', async () => {
    const { drawImage, toBlob, close } = simularCanvas({ width: 4000, height: 3000 });

    const r = await comprimirImagen(foto());

    expect(MAX_LADO_FOTO_POSTURAL_PX).toBe(1600);
    // se dibuja la imagen entera (sin recorte) en 1600 × 1200
    expect(drawImage).toHaveBeenCalledWith(expect.anything(), 0, 0, 4000, 3000, 0, 0, 1600, 1200);
    expect(toBlob).toHaveBeenCalledWith(expect.any(Function), 'image/jpeg', 0.85);
    expect(close).toHaveBeenCalled();
    expect(r.type).toBe('image/jpeg');
    expect(r.name).toBe('IMG_0001.HEIC.jpg');
    expect(r.size).toBe(512);
  });

  it('una foto vertical se escala por el alto y una chica no se agranda', async () => {
    const grande = simularCanvas({ width: 3000, height: 4000 });
    await comprimirImagen(foto());
    expect(grande.drawImage).toHaveBeenCalledWith(expect.anything(), 0, 0, 3000, 4000, 0, 0, 1200, 1600);

    const chica = simularCanvas({ width: 800, height: 600 });
    await comprimirImagen(foto());
    expect(chica.drawImage).toHaveBeenCalledWith(expect.anything(), 0, 0, 800, 600, 0, 0, 800, 600);
  });

  it('acepta otro lado máximo y otra calidad', async () => {
    const { drawImage, toBlob } = simularCanvas({ width: 2000, height: 1000 });
    await comprimirImagen(foto(), 1000, 0.7);
    expect(drawImage).toHaveBeenCalledWith(expect.anything(), 0, 0, 2000, 1000, 0, 0, 1000, 500);
    expect(toBlob).toHaveBeenCalledWith(expect.any(Function), 'image/jpeg', 0.7);
  });

  it('si la imagen no se puede leer o el canvas no exporta, devuelve el original', async () => {
    const original = foto();
    simularCanvas(new Error('ilegible'));
    expect(await comprimirImagen(original)).toBe(original);

    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    simularCanvas({ width: 4000, height: 3000 }, null);
    expect(await comprimirImagen(original)).toBe(original);
  });

  it('recortarImagen sigue igual: calidad 0,9 y nombre "-recortada"', async () => {
    const { drawImage, toBlob } = simularCanvas({ width: 4000, height: 3000 });
    const r = await recortarImagen(foto('plato.jpg', 'image/jpeg'), { sx: 100, sy: 50, sw: 2000, sh: 1500 });
    expect(drawImage).toHaveBeenCalledWith(expect.anything(), 100, 50, 2000, 1500, 0, 0, 1024, 768);
    expect(toBlob).toHaveBeenCalledWith(expect.any(Function), 'image/jpeg', 0.9);
    expect(r.name).toBe('plato-recortada.jpg');
  });
});
