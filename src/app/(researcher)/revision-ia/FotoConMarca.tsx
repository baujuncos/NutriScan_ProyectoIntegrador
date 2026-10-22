'use client';

/**
 * NUT-149 — Foto grande del plato con una elipse sobre el ítem que se está evaluando (la caja
 * es la del ítem ORIGINAL que detectó la IA, también para ítems quitados o con cambio de alimento).
 *
 * Alineación: la imagen y el overlay van en un contenedor que se ajusta EXACTAMENTE al tamaño
 * renderizado de la foto (`inline-block` con la imagen dentro, `max-h`/`max-w` sobre la imagen). El
 * SVG de `viewBox="0 0 1 1"` cubre ese contenedor, así que las fracciones 0–1 del boundingBox caen
 * en el lugar correcto sea cual sea la proporción de la foto y del modal (sin bandas ni object-contain
 * sobre un contenedor más grande que la imagen).
 */
import { useId, useState } from 'react';
import { elipseDeCaja, posicionEtiqueta, type CajaFoto } from '@/lib/marcaFoto';

interface Props {
  /** Signed URL de la foto; null si no hay o no se pudo firmar. */
  src: string | null;
  alt: string;
  /** Caja del ítem; null = sin marca (detección vieja o la IA no la devolvió). */
  caja: CajaFoto | null;
  /** Nombre del ítem, en la etiqueta pegada a la elipse. */
  etiqueta: string;
  /** La imagen falló (URL vencida): el padre pide una nueva una sola vez; null = no hay otra. */
  onFallo: (urlFallida: string) => Promise<string | null>;
}

const ACENTO = '#2563eb'; // blue-600
const CONTORNO = '#ffffff';

/** Elipse + atenuado del resto de la foto. Decorativo para lectores de pantalla (el texto de al lado dice qué ítem es). */
export function MarcaElipse({ caja }: { caja: CajaFoto }) {
  const idMascara = `marca-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const e = elipseDeCaja(caja);
  const forma = { cx: e.cx, cy: e.cy, rx: e.rx, ry: e.ry };
  return (
    <svg
      data-testid="marca-foto"
      viewBox="0 0 1 1"
      preserveAspectRatio="none"
      aria-hidden="true"
      focusable="false"
      className="pointer-events-none absolute inset-0 h-full w-full"
    >
      <defs>
        <mask id={idMascara}>
          <rect width="1" height="1" fill="white" />
          <ellipse {...forma} fill="black" />
        </mask>
      </defs>
      {/* Oscurece levemente todo menos el ítem. */}
      <rect width="1" height="1" fill="black" fillOpacity="0.35" mask={`url(#${idMascara})`} />
      {/* Contorno claro por fuera + borde de acento de 3 px: se ve sobre fotos claras y oscuras. */}
      <ellipse {...forma} fill="none" stroke={CONTORNO} strokeWidth="7" vectorEffect="non-scaling-stroke" />
      <ellipse {...forma} fill="none" stroke={ACENTO} strokeWidth="3" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

function Etiqueta({ caja, texto }: { caja: CajaFoto; texto: string }) {
  const pos = posicionEtiqueta(caja);
  return (
    <span
      aria-hidden="true"
      data-testid="etiqueta-marca"
      style={{ left: `${pos.x * 100}%`, top: `${pos.y * 100}%`, transform: `translate(-50%, ${pos.lado === 'arriba' ? '-110%' : '10%'})` }}
      className="pointer-events-none absolute max-w-[90%] truncate whitespace-nowrap rounded-md bg-blue-600 px-2 py-0.5 text-xs font-semibold text-white shadow ring-2 ring-white"
    >
      {texto}
    </span>
  );
}

function Imagen({ src, alt, caja, etiqueta, onFallo }: Omit<Props, 'src'> & { src: string }) {
  const [estado, setEstado] = useState<'cargando' | 'ok' | 'fallo'>('cargando');
  if (estado === 'fallo') return <SinFoto />;
  return (
    <div className={`relative inline-block max-w-full align-top ${estado === 'cargando' ? 'min-h-48 min-w-48' : ''}`}>
      {estado === 'cargando' && <div aria-hidden="true" className="absolute inset-0 animate-pulse rounded-xl bg-slate-200" />}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt={alt}
        decoding="async"
        onLoad={() => setEstado('ok')}
        onError={async () => {
          if (!(await onFallo(src))) setEstado('fallo'); // si hay una URL nueva, el padre cambia `src` y esto se vuelve a montar
        }}
        className="block h-auto max-h-[70vh] w-auto max-w-full rounded-xl bg-slate-900"
      />
      {estado === 'ok' && caja && (
        <>
          <MarcaElipse caja={caja} />
          <Etiqueta caja={caja} texto={etiqueta} />
        </>
      )}
    </div>
  );
}

function SinFoto() {
  return <p className="rounded-xl bg-slate-100 px-3 py-10 text-center text-sm text-slate-600">No se pudo cargar la foto</p>;
}

export default function FotoConMarca({ src, alt, caja, etiqueta, onFallo }: Props) {
  return (
    <figure className="space-y-2">
      <div className="flex justify-center rounded-xl bg-slate-100">
        {src ? <Imagen key={src} src={src} alt={alt} caja={caja} etiqueta={etiqueta} onFallo={onFallo} /> : <SinFoto />}
      </div>
      <figcaption className="space-y-1 text-xs text-slate-600">
        <p className="text-sm font-medium text-slate-800">Se evalúa: {etiqueta}</p>
        {!caja && <p>Esta detección no tiene marca en la foto</p>}
      </figcaption>
    </figure>
  );
}
