/**
 * NUT-149 — Geometría de la marca de un ítem sobre la foto del plato. El
 * `boundingBox` de cada ítem son fracciones 0–1 de la imagen que se mandó a Gemini
 * (la misma que se guarda en Storage), con origen arriba a la izquierda.
 */

export interface CajaFoto {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Columnas bbox_* tal como llegan de `v_revision_ia` (numeric: número o texto; null o ausentes en datos viejos). */
export interface FilaConCaja {
  bbox_x?: number | string | null;
  bbox_y?: number | string | null;
  bbox_width?: number | string | null;
  bbox_height?: number | string | null;
}

/** Caja válida: 4 números finitos, ancho y alto positivos, y entera dentro de la imagen (con una tolerancia de redondeo). */
export function esCajaValida(c: CajaFoto): boolean {
  const EPS = 1e-6;
  return (
    [c.x, c.y, c.width, c.height].every(Number.isFinite) &&
    c.x >= -EPS &&
    c.y >= -EPS &&
    c.width > 0 &&
    c.height > 0 &&
    c.x + c.width <= 1 + EPS &&
    c.y + c.height <= 1 + EPS
  );
}

/** Caja del ítem, o null si no tiene (detecciones anteriores a que se guardara, o la IA no la devolvió) o es inválida. */
export function cajaDeFila(fila: FilaConCaja): CajaFoto | null {
  const valores = [fila.bbox_x, fila.bbox_y, fila.bbox_width, fila.bbox_height];
  if (valores.some((v) => v == null || v === '')) return null;
  const [x, y, width, height] = valores.map(Number);
  const caja = { x, y, width, height };
  return esCajaValida(caja) ? caja : null;
}

export interface Elipse {
  cx: number;
  cy: number;
  rx: number;
  ry: number;
}

/** Elipse inscripta en la caja, en coordenadas 0–1 (para un SVG de `viewBox="0 0 1 1"` que cubre exactamente la imagen). */
export function elipseDeCaja(caja: CajaFoto): Elipse {
  return { cx: caja.x + caja.width / 2, cy: caja.y + caja.height / 2, rx: caja.width / 2, ry: caja.height / 2 };
}

/** Dónde poner la etiqueta del ítem: arriba de la elipse, o abajo si no hay lugar arriba (ítem pegado al borde superior). */
export function posicionEtiqueta(caja: CajaFoto, espacioMinimo = 0.1): { lado: 'arriba' | 'abajo'; x: number; y: number } {
  const x = Math.min(Math.max(caja.x + caja.width / 2, 0.05), 0.95);
  return caja.y >= espacioMinimo ? { lado: 'arriba', x, y: caja.y } : { lado: 'abajo', x, y: caja.y + caja.height };
}

const pct = (n: number) => `${Math.round(Math.min(Math.max(n, 0), 1) * 1000) / 10}%`;

/** `object-position` para que el recorte `object-cover` de una miniatura quede centrado en el ítem; centrado si no hay caja. */
export function posicionObjeto(caja: CajaFoto | null): string {
  return caja ? `${pct(caja.x + caja.width / 2)} ${pct(caja.y + caja.height / 2)}` : '50% 50%';
}

/**
 * Área que ocupa una imagen mostrada con `object-contain` dentro de un contenedor, en px relativos al contenedor.
 * La marca tiene que cubrir ESTA área y no el contenedor entero (si no, la elipse se corre).
 */
export function areaContain(contenedor: { width: number; height: number }, imagen: { width: number; height: number }) {
  const escala = Math.min(contenedor.width / imagen.width, contenedor.height / imagen.height);
  const width = imagen.width * escala;
  const height = imagen.height * escala;
  return { left: (contenedor.width - width) / 2, top: (contenedor.height - height) / 2, width, height };
}
