/**
 * NUT-149 — Geometría de la marca del ítem sobre la foto: caja → elipse, posición del recorte
 * de la miniatura, ubicación de la etiqueta y área real de una imagen con object-contain.
 */
import { describe, expect, it } from 'vitest';
import { areaContain, cajaDeFila, elipseDeCaja, esCajaValida, posicionEtiqueta, posicionObjeto } from '@/lib/marcaFoto';

describe('cajaDeFila', () => {
  it('lee las cuatro columnas bbox_* (número o texto, como las devuelve PostgREST)', () => {
    expect(cajaDeFila({ bbox_x: 0.1, bbox_y: '0.2', bbox_width: 0.3, bbox_height: '0.4' })).toEqual({ x: 0.1, y: 0.2, width: 0.3, height: 0.4 });
  });

  it('datos viejos o sin caja: null (no se dibuja nada)', () => {
    expect(cajaDeFila({})).toBeNull();
    expect(cajaDeFila({ bbox_x: null, bbox_y: null, bbox_width: null, bbox_height: null })).toBeNull();
    expect(cajaDeFila({ bbox_x: 0.1, bbox_y: 0.1, bbox_width: 0.2, bbox_height: null })).toBeNull();
  });

  it('una caja inválida (fuera de la imagen, de tamaño 0 o no numérica) también es null', () => {
    expect(cajaDeFila({ bbox_x: 0.8, bbox_y: 0, bbox_width: 0.5, bbox_height: 0.5 })).toBeNull();
    expect(cajaDeFila({ bbox_x: 0.1, bbox_y: 0.1, bbox_width: 0, bbox_height: 0.2 })).toBeNull();
    expect(cajaDeFila({ bbox_x: 'x', bbox_y: 0.1, bbox_width: 0.2, bbox_height: 0.2 })).toBeNull();
    expect(esCajaValida({ x: 0, y: 0, width: 1, height: 1 })).toBe(true);
  });
});

describe('elipseDeCaja', () => {
  it('la elipse queda inscripta en la caja: centro en el medio y semiejes = mitad del ancho y del alto', () => {
    expect(elipseDeCaja({ x: 0.2, y: 0.4, width: 0.4, height: 0.2 })).toEqual({ cx: 0.4, cy: 0.5, rx: 0.2, ry: 0.1 });
  });

  it('una caja que ocupa toda la foto da la elipse de toda la foto', () => {
    expect(elipseDeCaja({ x: 0, y: 0, width: 1, height: 1 })).toEqual({ cx: 0.5, cy: 0.5, rx: 0.5, ry: 0.5 });
  });
});

describe('posicionObjeto (recorte de la miniatura)', () => {
  it('centra el recorte en el centro de la caja del ítem', () => {
    expect(posicionObjeto({ x: 0.2, y: 0.4, width: 0.4, height: 0.2 })).toBe('40% 50%');
    expect(posicionObjeto({ x: 0.7, y: 0.1, width: 0.3, height: 0.2 })).toBe('85% 20%');
  });

  it('sin caja, centrado', () => {
    expect(posicionObjeto(null)).toBe('50% 50%');
  });
});

describe('posicionEtiqueta', () => {
  it('va arriba de la elipse, centrada sobre la caja', () => {
    expect(posicionEtiqueta({ x: 0.3, y: 0.4, width: 0.2, height: 0.2 })).toEqual({ lado: 'arriba', x: 0.4, y: 0.4 });
  });

  it('si el ítem está pegado al borde de arriba, va abajo; y nunca se sale por los costados', () => {
    expect(posicionEtiqueta({ x: 0.3, y: 0.02, width: 0.2, height: 0.3 })).toEqual({ lado: 'abajo', x: 0.4, y: 0.32 });
    expect(posicionEtiqueta({ x: 0, y: 0.5, width: 0.04, height: 0.1 }).x).toBe(0.05);
    expect(posicionEtiqueta({ x: 0.96, y: 0.5, width: 0.04, height: 0.1 }).x).toBe(0.95);
  });
});

describe('areaContain (imagen con object-contain en un contenedor de otra proporción)', () => {
  it('foto horizontal en un contenedor cuadrado: ocupa todo el ancho y deja bandas arriba y abajo', () => {
    expect(areaContain({ width: 400, height: 400 }, { width: 1024, height: 768 })).toEqual({ left: 0, top: 50, width: 400, height: 300 });
  });

  it('foto vertical en un contenedor ancho: ocupa todo el alto y deja bandas a los costados', () => {
    expect(areaContain({ width: 600, height: 400 }, { width: 768, height: 1024 })).toEqual({ left: 150, top: 0, width: 300, height: 400 });
  });

  it('con la misma proporción el área es todo el contenedor', () => {
    expect(areaContain({ width: 512, height: 384 }, { width: 1024, height: 768 })).toEqual({ left: 0, top: 0, width: 512, height: 384 });
  });

  it('un punto de la imagen (fracción 0–1) cae en el pixel correcto del contenedor, no del área completa', () => {
    const area = areaContain({ width: 400, height: 400 }, { width: 1024, height: 768 });
    const centro = { x: area.left + 0.5 * area.width, y: area.top + 0.5 * area.height };
    expect(centro).toEqual({ x: 200, y: 200 }); // el centro de la foto es el centro del contenedor
    const arriba = area.top + 0 * area.height; // el borde superior de la foto empieza en la banda, no en 0
    expect(arriba).toBe(50);
  });
});
