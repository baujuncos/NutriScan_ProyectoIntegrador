'use client';

/**
 * NUT-149 — Foto real del plato en la tarjeta de la cola: tamaño reservado (sin saltos de layout),
 * skeleton mientras carga, `loading="lazy"` y recorte centrado en el ítem (object-position según su
 * boundingBox). Si la imagen falla (típicamente, la URL firmada venció) pide UNA URL nueva al padre y
 * reintenta; si falla de nuevo, o no hay URL, muestra el ícono con "No se pudo cargar la foto".
 */
import { useState } from 'react';
import { posicionObjeto, type CajaFoto } from '@/lib/marcaFoto';

interface Props {
  /** Signed URL de la foto; null si el ítem no tiene foto o no se pudo firmar. */
  src: string | null;
  alt: string;
  caja: CajaFoto | null;
  /** Pide una URL nueva para la que falló (el padre lo hace una sola vez por foto); null = no hay otra. */
  onFallo: (urlFallida: string) => Promise<string | null>;
  className?: string;
}

const Icono = () => (
  <svg aria-hidden="true" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
    <rect x="3" y="3" width="18" height="18" rx="3" />
    <circle cx="9" cy="9" r="1.75" />
    <path strokeLinecap="round" strokeLinejoin="round" d="m21 15-4.5-4.5L6 21" />
  </svg>
);

function Fallback({ texto }: { texto: string }) {
  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-1 px-1 text-center text-slate-500">
      <Icono />
      <span className="text-[10px] leading-tight">{texto}</span>
    </div>
  );
}

function Imagen({ src, alt, caja, onFallo }: Omit<Props, 'src' | 'className'> & { src: string }) {
  const [estado, setEstado] = useState<'cargando' | 'ok' | 'fallo'>('cargando');
  return (
    <>
      {estado === 'cargando' && <div aria-hidden="true" className="absolute inset-0 animate-pulse bg-slate-200" />}
      {estado === 'fallo' ? (
        <Fallback texto="No se pudo cargar la foto" />
      ) : (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src}
          alt={alt}
          loading="lazy"
          decoding="async"
          style={{ objectPosition: posicionObjeto(caja) }}
          onLoad={() => setEstado('ok')}
          onError={async () => {
            const nueva = await onFallo(src);
            if (!nueva) setEstado('fallo'); // si hay una nueva, el padre cambia `src` y este componente se vuelve a montar
          }}
          className="h-full w-full object-cover"
        />
      )}
    </>
  );
}

export default function FotoMiniatura({ src, alt, caja, onFallo, className = '' }: Props) {
  return (
    <div className={`relative h-24 w-24 shrink-0 overflow-hidden rounded-xl border border-slate-200 bg-slate-100 ${className}`}>
      {src ? <Imagen key={src} src={src} alt={alt} caja={caja} onFallo={onFallo} /> : <Fallback texto="No se pudo cargar la foto" />}
    </div>
  );
}
