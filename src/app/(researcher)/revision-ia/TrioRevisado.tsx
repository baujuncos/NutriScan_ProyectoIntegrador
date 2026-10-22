import { formatFechaCorta } from '@/lib/date';
import { fmt } from '@/lib/numeros';
import { resumenInvestigador } from '@/lib/revisionIaForm';
import type { RevisionFila } from './actions';

const Flecha = () => (
  <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="self-center text-slate-500">
    <path strokeLinecap="round" strokeLinejoin="round" d="M5 12h14m-5-5 5 5-5 5" />
  </svg>
);

function Columna({ titulo, nombre, peso, destacada = false }: { titulo: string; nombre: React.ReactNode; peso: React.ReactNode; destacada?: boolean }) {
  return (
    <div className={`min-w-0 rounded-lg px-3 py-2 ${destacada ? 'bg-blue-50 ring-1 ring-blue-200' : 'bg-slate-50'}`}>
      <p className={`text-[11px] font-semibold uppercase tracking-wide ${destacada ? 'text-blue-800' : 'text-slate-600'}`}>{titulo}</p>
      <p className="mt-0.5 truncate text-sm font-semibold text-slate-900">{nombre}</p>
      <p className="text-sm text-slate-700">{peso}</p>
    </div>
  );
}

const SinCambios = () => <span className="ml-1 text-xs font-normal text-slate-600">(sin cambios)</span>;

/** "Corregido por Ana Pérez el 6/10/2026" / "Confirmado por …". */
export function lineaRevision(fila: Pick<RevisionFila, 'estado_revision' | 'revisor_nombre' | 'revisado_en'>): string {
  const que = fila.estado_revision === 'confirmado' ? 'Confirmado' : 'Corregido';
  return `${que} por ${fila.revisor_nombre ?? 'el equipo de nutrición'}${fila.revisado_en ? ` el ${formatFechaCorta(fila.revisado_en)}` : ''}`;
}

/** Ítem Corregido: IA → Deportista → Investigador (nombre y peso), con la columna del investigador resaltada, quién y cuándo. */
export default function TrioRevisado({ fila }: { fila: RevisionFila }) {
  const quitado = fila.item_quitado || fila.alimento_usuario == null;
  const inv = resumenInvestigador(fila);
  return (
    <div className="mt-2 space-y-2">
      <div role="group" aria-label="IA, deportista e investigador" data-testid="trio-revisado" className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)_auto_minmax(0,1fr)] gap-1.5">
        <Columna titulo="IA" nombre={fila.alimento_ia} peso={`${fmt(fila.gramos_ia)} g`} />
        <Flecha />
        <Columna
          titulo="Deportista"
          nombre={quitado ? <span className="text-red-800">Lo quitó</span> : fila.alimento_usuario}
          peso={quitado ? '—' : `${fmt(fila.gramos_usuario ?? 0)} g`}
        />
        <Flecha />
        <Columna
          destacada
          titulo="Investigador"
          nombre={
            inv.nombre == null ? (
              'Sigue quitado'
            ) : (
              <>
                {inv.nombre}
                {inv.nombreSinCambios && <SinCambios />}
              </>
            )
          }
          peso={
            inv.gramos == null ? (
              '—'
            ) : (
              <>
                {fmt(inv.gramos)} g{inv.pesoSinCambios && <SinCambios />}
              </>
            )
          }
        />
      </div>
      <p className="text-xs text-slate-600">{lineaRevision(fila)}</p>
    </div>
  );
}
