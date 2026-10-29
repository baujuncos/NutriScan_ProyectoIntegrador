/**
 * recortarImagen (NUT-165): aplica el recorte sobre un canvas y devuelve un JPEG.
 * Contrato clave: degrada de forma segura — si algo falla devuelve el archivo original y nunca lanza.
 * jsdom no implementa canvas, así que se reemplaza por un doble que registra las llamadas.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { recortarImagen } from '@/lib/recorteFoto';

const original = new File(['x'], 'plato.png', { type: 'image/png' });
const rect = { sx: 10.4, sy: 20.6, sw: 800.2, sh: 600.7 };

let drawImage: ReturnType<typeof vi.fn>;
let toBlob: ((cb: (b: Blob | null) => void, type?: string, q?: number) => void) | undefined;
let ctxDisponible: boolean;
let close: ReturnType<typeof vi.fn>;

beforeEach(() => {
  drawImage = vi.fn();
  close = vi.fn();
  ctxDisponible = true;
  toBlob = (cb) => cb(new Blob(['jpeg'], { type: 'image/jpeg' }));
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(((tipo: string) =>
    tipo === '2d' && ctxDisponible ? { drawImage } : null) as never);
  vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(((cb: (b: Blob | null) => void, t?: string, q?: number) =>
    toBlob ? toBlob(cb, t, q) : undefined) as never);
  vi.stubGlobal('createImageBitmap', vi.fn(async () => ({ close })));
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('recortarImagen', () => {
  it('devuelve un JPEG recortado con el nombre "<base>-recortada.jpg" y libera el bitmap', async () => {
    // Act
    const out = await recortarImagen(original, rect);
    // Assert
    expect(out).not.toBe(original);
    expect(out.name).toBe('plato-recortada.jpg');
    expect(out.type).toBe('image/jpeg');
    expect(drawImage).toHaveBeenCalledWith(expect.anything(), 10, 21, 800, 601, 0, 0, 800, 601);
    expect(close).toHaveBeenCalled();
  });

  it('achica al lado máximo pedido respetando el aspecto', async () => {
    await recortarImagen(original, { sx: 0, sy: 0, sw: 2000, sh: 1000 }, 1000);
    expect(drawImage).toHaveBeenCalledWith(expect.anything(), 0, 0, 2000, 1000, 0, 0, 1000, 500);
  });

  it('un recorte degenerado (0 × 0) se corrige a 1 × 1 px', async () => {
    await recortarImagen(original, { sx: 0, sy: 0, sw: 0, sh: 0 });
    expect(drawImage).toHaveBeenCalledWith(expect.anything(), 0, 0, 1, 1, 0, 0, 1, 1);
  });

  it('un archivo sin extensión usa "comida" como base del nombre', async () => {
    const out = await recortarImagen(new File(['x'], '.png'), rect);
    expect(out.name).toBe('comida-recortada.jpg');
  });

  it('sin contexto 2d devuelve el archivo original', async () => {
    ctxDisponible = false;
    expect(await recortarImagen(original, rect)).toBe(original);
  });

  it('si no se puede decodificar la imagen devuelve el original (no lanza)', async () => {
    vi.stubGlobal('createImageBitmap', vi.fn(async () => {
      throw new Error('imagen corrupta');
    }));
    expect(await recortarImagen(original, rect)).toBe(original);
  });

  it('si canvas.toBlob entrega null devuelve el original', async () => {
    toBlob = (cb) => cb(null);
    expect(await recortarImagen(original, rect)).toBe(original);
  });

  it('sin createImageBitmap usa <img> + objectURL', async () => {
    vi.stubGlobal('createImageBitmap', undefined);
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    URL.createObjectURL = vi.fn(() => 'blob:fake');
    vi.spyOn(HTMLImageElement.prototype, 'src', 'set').mockImplementation(function (this: HTMLImageElement) {
      queueMicrotask(() => this.onload?.(new Event('load')));
    });
    const out = await recortarImagen(original, rect);
    expect(out.type).toBe('image/jpeg');
    expect(revoke).toHaveBeenCalledWith('blob:fake');
  });

  it('sin createImageBitmap y con error de carga devuelve el original', async () => {
    vi.stubGlobal('createImageBitmap', undefined);
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    URL.createObjectURL = vi.fn(() => 'blob:fake');
    vi.spyOn(HTMLImageElement.prototype, 'src', 'set').mockImplementation(function (this: HTMLImageElement) {
      queueMicrotask(() => this.onerror?.(new Event('error')));
    });
    expect(await recortarImagen(original, rect)).toBe(original);
  });
});
