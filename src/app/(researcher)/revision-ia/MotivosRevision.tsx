/**
 * NUT-149 — Chips con los motivos por los que un ítem está en la cola de
 * revisión. `item_quitado` (el usuario sacó algo que Gemini detectó: el caso
 * más grave) va primero, en rojo y con ícono; el resto en ámbar.
 */
import { MOTIVOS_REVISION, type MotivoRevision } from '@/lib/revisionIa';

export const MOTIVO_LABEL: Record<MotivoRevision, string> = {
  item_quitado: 'Ítem quitado',
  cambio_alimento: 'Cambio de alimento',
  correccion_peso_grande: 'Corrección de peso grande',
  confianza_baja: 'Confianza baja',
};

export default function MotivosRevision({ motivos }: { motivos: MotivoRevision[] }) {
  const ordenados = MOTIVOS_REVISION.filter((m) => motivos.includes(m));
  return (
    <ul className="flex flex-wrap gap-1.5" aria-label="Motivos de revisión">
      {ordenados.map((m) =>
        m === 'item_quitado' ? (
          <li
            key={m}
            data-motivo={m}
            className="inline-flex items-center gap-1 rounded-full border border-red-300 bg-red-50 px-2.5 py-0.5 text-xs font-bold text-red-800"
          >
            <svg aria-hidden="true" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 6l12 12M6 18L18 6" />
            </svg>
            {MOTIVO_LABEL[m]}
          </li>
        ) : (
          <li
            key={m}
            data-motivo={m}
            className="inline-flex items-center rounded-full bg-amber-50 px-2.5 py-0.5 text-xs font-medium text-amber-800"
          >
            {MOTIVO_LABEL[m]}
          </li>
        ),
      )}
    </ul>
  );
}
