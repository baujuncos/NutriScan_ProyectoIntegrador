'use client';

/**
 * NUT-228 — Pedidos hechos por el chat con IA (sin foto) de una entrada de la cola: el alimento
 * que interpretó el chat, lo que escribió la persona y, si hubo, las preguntas aclaratorias con
 * sus respuestas. Va debajo de "Dónde apareció" y comparte la pantalla con las cargas manuales.
 */
import { formatFechaCorta } from '@/lib/date';
import { fmt } from '@/lib/numeros';
import type { SolicitudChat } from './actions';

interface Props {
  solicitudes: SolicitudChat[];
  /** Total real de ítems del chat (puede ser mayor a los que se listan). */
  total: number;
  /** Usuarios distintos que pidieron el alimento (por foto, a mano o por chat). */
  usuarios: number;
}

export default function SolicitudesChat({ solicitudes, total, usuarios }: Props) {
  if (total <= 0) return null;
  const sinMostrar = Math.max(0, total - solicitudes.length);
  return (
    <section aria-label="Estimado por el chat">
      <p className="mb-1 text-[11px] font-bold uppercase tracking-[0.08em] text-slate-600">
        Estimado por el chat · {total} {total === 1 ? 'solicitud' : 'solicitudes'}
      </p>
      <p className="mb-2.5 text-xs text-slate-600">
        Sin foto: la persona describió la comida por texto y el chat no encontró el alimento en el catálogo. Lo pidieron {usuarios}{' '}
        {usuarios === 1 ? 'usuario' : 'usuarios'}.
      </p>
      <ul className="space-y-2">
        {solicitudes.map((s, i) => (
          <li key={s.idItem ?? `chat-${i}`} className="rounded-xl border border-slate-200 bg-white p-2.5 text-[13px]">
            <b className="text-slate-900">{s.deportista ?? 'Usuario'}</b> <span className="text-slate-600">· {formatFechaCorta(s.fecha)}</span>
            <span className="block text-slate-700">
              El chat interpretó «{s.interpretado}»{s.gramos != null && <> · {fmt(s.gramos)} g</>}
            </span>
            {s.conversacion && s.conversacion.length > 0 && (
              <ul aria-label="Conversación" className="mt-1.5 space-y-1 border-l-2 border-slate-200 pl-2.5">
                {s.conversacion.map((m, j) => (
                  <li key={j} className="text-slate-700">
                    <span className="font-semibold text-slate-600">{m.role === 'user' ? 'Escribió: ' : 'El chat preguntó: '}</span>
                    {m.content}
                  </li>
                ))}
              </ul>
            )}
          </li>
        ))}
      </ul>
      {sinMostrar > 0 && <p className="mt-2 text-xs text-slate-600">y {sinMostrar} más</p>}
    </section>
  );
}
