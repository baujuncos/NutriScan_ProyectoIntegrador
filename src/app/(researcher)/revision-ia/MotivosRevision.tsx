/**
 * NUT-149 — Chips con los motivos por los que un ítem está en la cola de
 * revisión. `item_quitado` (el usuario sacó algo que Gemini detectó: el caso
 * más grave) va primero, en rojo y con ícono de alerta; cada motivo tiene su color.
 */
import { MOTIVOS_REVISION, type MotivoRevision } from '@/lib/revisionIa';

export const MOTIVO_LABEL: Record<MotivoRevision, string> = {
  item_quitado: 'Ítem quitado',
  cambio_alimento: 'Cambio de alimento',
  correccion_peso_grande: 'Corrección de peso',
  confianza_baja: 'Confianza baja',
};

const MOTIVO_CLASE: Record<MotivoRevision, string> = {
  item_quitado: 'bg-red-100 text-red-800',
  cambio_alimento: 'bg-violet-100 text-violet-800',
  correccion_peso_grande: 'bg-blue-100 text-blue-800',
  confianza_baja: 'bg-amber-100 text-amber-800',
};

export default function MotivosRevision({ motivos }: { motivos: MotivoRevision[] }) {
  const ordenados = MOTIVOS_REVISION.filter((m) => motivos.includes(m));
  return (
    <ul className="flex flex-wrap gap-1.5" aria-label="Motivos de revisión">
      {ordenados.map((m) => (
        <li
          key={m}
          data-motivo={m}
          className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold ${MOTIVO_CLASE[m]}`}
        >
          {m === 'item_quitado' && (
            <svg aria-hidden="true" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
              <circle cx="12" cy="12" r="9" />
              <path strokeLinecap="round" d="M12 8v5M12 16.5v.01" />
            </svg>
          )}
          {MOTIVO_LABEL[m]}
        </li>
      ))}
    </ul>
  );
}
