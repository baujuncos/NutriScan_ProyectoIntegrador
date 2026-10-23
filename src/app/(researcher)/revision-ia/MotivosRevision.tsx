/**
 * NUT-149 — Chips con los motivos por los que un ítem está en la cola de
 * revisión. `item_quitado` (el usuario sacó algo que Gemini detectó: el caso
 * más grave) va primero, en rojo y con ícono de alerta; cada motivo tiene su color.
 */
import StatusBadge, { type BadgeTone } from '@/components/researcher/StatusBadge';
import { MOTIVOS_REVISION, type MotivoRevision } from '@/lib/revisionIa';

export const MOTIVO_LABEL: Record<MotivoRevision, string> = {
  item_quitado: 'Ítem quitado',
  cambio_alimento: 'Cambio de alimento',
  correccion_peso_grande: 'Corrección de peso',
  confianza_baja: 'Confianza baja',
};

const MOTIVO_TONE: Record<MotivoRevision, BadgeTone> = {
  item_quitado: 'red',
  cambio_alimento: 'violet',
  correccion_peso_grande: 'blue',
  confianza_baja: 'amber',
};

export default function MotivosRevision({ motivos }: { motivos: MotivoRevision[] }) {
  const ordenados = MOTIVOS_REVISION.filter((m) => motivos.includes(m));
  return (
    <ul className="flex flex-wrap gap-1.5" aria-label="Motivos de revisión">
      {ordenados.map((m) => (
        <li key={m} data-motivo={m}>
          <StatusBadge
            tone={MOTIVO_TONE[m]}
            className="font-semibold"
            icon={
              m === 'item_quitado' ? (
                <svg aria-hidden="true" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
                  <circle cx="12" cy="12" r="9" />
                  <path strokeLinecap="round" d="M12 8v5M12 16.5v.01" />
                </svg>
              ) : undefined
            }
          >
            {MOTIVO_LABEL[m]}
          </StatusBadge>
        </li>
      ))}
    </ul>
  );
}
