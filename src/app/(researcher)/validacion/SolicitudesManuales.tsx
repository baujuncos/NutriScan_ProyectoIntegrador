'use client';

/**
 * NUT-192 — Cargas manuales (sin foto) de una entrada de la cola: lo que escribió cada persona y
 * cuántos gramos. Va debajo de "Dónde apareció" (que solo muestra comidas con foto) y, en una
 * entrada mixta, comparte la pantalla con ella.
 */
import { formatFechaCorta } from '@/lib/date';
import { fmt } from '@/lib/numeros';
import type { SolicitudManual } from './actions';

interface Props {
  solicitudes: SolicitudManual[];
  /** Total real de cargas manuales (puede ser mayor a las que se listan). */
  total: number;
  /** Usuarios distintos que pidieron el alimento (por foto o manualmente). */
  usuarios: number;
}

export default function SolicitudesManuales({ solicitudes, total, usuarios }: Props) {
  if (total <= 0) return null;
  const sinMostrar = Math.max(0, total - solicitudes.length);
  return (
    <section aria-label="Cargado manualmente">
      <p className="mb-1 text-[11px] font-bold uppercase tracking-[0.08em] text-slate-600">
        Cargado manualmente · {total} {total === 1 ? 'solicitud' : 'solicitudes'}
      </p>
      <p className="mb-2.5 text-xs text-slate-600">
        Sin foto: la persona escribió el nombre y los gramos. Lo pidieron {usuarios} {usuarios === 1 ? 'usuario' : 'usuarios'}.
      </p>
      <ul className="space-y-2">
        {solicitudes.map((s) => (
          <li key={s.idItem} className="rounded-xl border border-slate-200 bg-white p-2.5 text-[13px]">
            <b className="text-slate-900">{s.deportista ?? 'Usuario'}</b> <span className="text-slate-600">· {formatFechaCorta(s.fecha)}</span>
            <span className="block text-slate-700">
              Escribió «{s.nombre}» · {fmt(s.gramos)} g
            </span>
          </li>
        ))}
      </ul>
      {sinMostrar > 0 && <p className="mt-2 text-xs text-slate-600">y {sinMostrar} más</p>}
    </section>
  );
}
