'use client';

/**
 * NUT-119 — Columna de contexto del "Revisar alimento": dónde apareció el alimento. La foto de
 * referencia (la primera comida) va siempre a la vista, con la persona, la fecha, el peso en la
 * foto y el rastro de lo que detectó la IA y lo que respondió el deportista. Las demás comidas
 * van plegadas bajo "Ver otras N comidas".
 */
import { useState } from 'react';
import { formatFechaCorta } from '@/lib/date';
import { fmt } from '@/lib/numeros';
import type { OcurrenciaDetalle } from './actions';

function Foto({ o }: { o: OcurrenciaDetalle }) {
  if (!o.fotoUrl) {
    return (
      <div className="flex h-[84px] w-[84px] shrink-0 items-center justify-center rounded-xl bg-slate-200 text-center text-xs text-slate-600 md:h-[104px] md:w-[104px]">
        Sin foto
      </div>
    );
  }
  return (
    <div className="relative h-[84px] w-[84px] shrink-0 overflow-hidden rounded-xl bg-slate-900 md:h-[104px] md:w-[104px]">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={o.fotoUrl}
        alt={`Foto del plato de ${o.deportista ?? 'un deportista'}, ${formatFechaCorta(o.fecha)}`}
        className="h-full w-full object-cover"
      />
      {o.bbox && (
        <div
          data-testid="bbox"
          aria-hidden="true"
          className="pointer-events-none absolute rounded border-2 border-amber-400"
          style={{
            left: `${o.bbox.x * 100}%`,
            top: `${o.bbox.y * 100}%`,
            width: `${o.bbox.width * 100}%`,
            height: `${o.bbox.height * 100}%`,
          }}
        />
      )}
    </div>
  );
}

function Comida({ o }: { o: OcurrenciaDetalle }) {
  const mismoNombre = o.nombreIa != null && o.nombreIa.trim().toLowerCase() === o.nombreFinal.trim().toLowerCase();
  return (
    <li className="list-none">
      <div className="flex items-start gap-3 rounded-2xl border border-slate-200 bg-white p-2.5 md:gap-3.5 md:p-3">
        <Foto o={o} />
        <div className="flex min-w-0 flex-col gap-1">
          <b className="text-sm text-slate-900">{o.deportista ?? 'Deportista'}</b>
          <span className="text-[13px] text-slate-600">{formatFechaCorta(o.fecha)}</span>
          {o.esReferencia && (
            <span className="inline-flex self-start rounded-full bg-blue-50 px-2 py-0.5 text-xs font-semibold text-blue-700">
              Foto de referencia
            </span>
          )}
          <span className="text-[13px] font-semibold text-slate-900">Pesa {fmt(o.gramosFinal)} g en la foto</span>
          {o.gramosIa != null && <span className="text-xs text-slate-600">IA estimó {fmt(o.gramosIa)} g</span>}
        </div>
      </div>
      <ul className="mt-3.5 flex flex-col">
        <Paso etiqueta="La IA detectó" valor={o.nombreIa ?? 'Agregado a mano'} />
        {!mismoNombre && o.nombreIa != null && <Paso etiqueta="Quedó cargado como" valor={o.nombreFinal} />}
        {o.respuestas.map((r, i) => (
          <Paso key={i} etiqueta={r.question} valor={r.answer ?? 'No sé'} />
        ))}
      </ul>
    </li>
  );
}

function Paso({ etiqueta, valor }: { etiqueta: string; valor: string }) {
  return (
    <li className="relative grid list-none grid-cols-[22px_1fr] gap-2.5 pb-3 last:pb-0 [&:not(:last-child)]:before:absolute [&:not(:last-child)]:before:bottom-0 [&:not(:last-child)]:before:left-[5px] [&:not(:last-child)]:before:top-4 [&:not(:last-child)]:before:w-0.5 [&:not(:last-child)]:before:bg-slate-200 [&:not(:last-child)]:before:content-['']">
      <span aria-hidden="true" className="mt-1 h-3 w-3 rounded-full border-2 border-blue-700 bg-white" />
      <div>
        <small className="block text-xs text-slate-600">{etiqueta}</small>
        <span className="font-semibold text-slate-900">{valor}</span>
      </div>
    </li>
  );
}

interface Props {
  ocurrencias: OcurrenciaDetalle[];
  /** Total real de comidas (puede ser mayor a las que se listan). */
  total: number;
}

export default function ContextoComidas({ ocurrencias, total }: Props) {
  const [verOtras, setVerOtras] = useState(false);
  const [principal, ...otras] = ocurrencias;
  const sinMostrar = Math.max(0, total - ocurrencias.length);

  return (
    <section aria-label="Dónde apareció">
      <p className="mb-2.5 text-[11px] font-bold uppercase tracking-[0.08em] text-slate-600">
        Dónde apareció · {total} {total === 1 ? 'comida' : 'comidas'}
      </p>
      <ul>{principal && <Comida o={principal} />}</ul>

      {otras.length > 0 && (
        <div className="mt-3.5">
          <button
            type="button"
            aria-expanded={verOtras}
            onClick={() => setVerOtras((v) => !v)}
            className="flex min-h-11 w-full items-center gap-2 rounded-xl px-1 text-left text-sm font-semibold text-blue-700 hover:bg-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700"
          >
            <span aria-hidden="true">{verOtras ? '▾' : '▸'}</span>
            Ver otras {otras.length} {otras.length === 1 ? 'comida' : 'comidas'}
          </button>
          {verOtras && (
            <ul className="mt-2 space-y-4">
              {otras.map((o) => (
                <Comida key={o.idGuardadoItem} o={o} />
              ))}
            </ul>
          )}
        </div>
      )}

      {sinMostrar > 0 && <p className="mt-2 text-xs text-slate-600">y {sinMostrar} más</p>}
    </section>
  );
}
