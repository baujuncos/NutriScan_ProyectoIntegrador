import { describe, it, expect } from 'vitest';
import { calcularRecorte, dimensionesSalida, MAX_LADO_PX } from '@/lib/recorteFoto';

const VIEW = { viewW: 464, viewH: 288 };

describe('calcularRecorte (NUT-165) — encuadre manual → recorte en px de la fuente', () => {
  it('zoom=1, pan=0 en imagen apaisada → imagen completa', () => {
    const r = calcularRecorte({ imgW: 4000, imgH: 3000, ...VIEW, zoom: 1, panX: 0, panY: 0 });
    expect(r.sx).toBeCloseTo(0, 0);
    expect(r.sy).toBeCloseTo(0, 0);
    expect(r.sw).toBeCloseTo(4000, 0);
    expect(r.sh).toBeCloseTo(3000, 0);
  });

  it('zoom=1, pan=0 en imagen vertical → imagen completa', () => {
    const r = calcularRecorte({ imgW: 1200, imgH: 1600, ...VIEW, zoom: 1, panX: 0, panY: 0 });
    expect(r.sx).toBeCloseTo(0, 0);
    expect(r.sy).toBeCloseTo(0, 0);
    expect(r.sw).toBeCloseTo(1200, 0);
    expect(r.sh).toBeCloseTo(1600, 0);
  });

  it('zoom=2, pan=0 → recorte centrado, ~mitad del alto (sin letterbox vertical)', () => {
    const r = calcularRecorte({ imgW: 4000, imgH: 3000, ...VIEW, zoom: 2, panX: 0, panY: 0 });
    expect(r.sh).toBeCloseTo(1500, 0);
    // centrado verticalmente
    expect(r.sy + r.sh / 2).toBeCloseTo(1500, 0);
    // el recorte es más chico que la imagen completa
    expect(r.sw).toBeLessThan(4000);
  });

  it('pan que empuja fuera del borde → recorte clampeado dentro de la imagen', () => {
    const r = calcularRecorte({
      imgW: 4000,
      imgH: 3000,
      ...VIEW,
      zoom: 2,
      panX: 100000,
      panY: 100000,
    });
    expect(r.sx).toBeGreaterThanOrEqual(0);
    expect(r.sy).toBeGreaterThanOrEqual(0);
    expect(r.sx + r.sw).toBeLessThanOrEqual(4000);
    expect(r.sy + r.sh).toBeLessThanOrEqual(3000);
    expect(r.sw).toBeGreaterThan(0);
    expect(r.sh).toBeGreaterThan(0);
  });

  it('entradas inválidas → imagen completa sin romper', () => {
    const r = calcularRecorte({ imgW: 800, imgH: 600, viewW: 0, viewH: 0, zoom: 0, panX: 0, panY: 0 });
    expect(r).toEqual({ sx: 0, sy: 0, sw: 800, sh: 600 });
  });
});

describe('dimensionesSalida', () => {
  it('achica al lado máximo respetando el aspecto', () => {
    expect(dimensionesSalida(2000, 1500)).toEqual({ w: MAX_LADO_PX, h: 768 });
    expect(dimensionesSalida(1500, 2000)).toEqual({ w: 768, h: MAX_LADO_PX });
  });

  it('no agranda imágenes chicas', () => {
    expect(dimensionesSalida(640, 480)).toEqual({ w: 640, h: 480 });
  });
});
