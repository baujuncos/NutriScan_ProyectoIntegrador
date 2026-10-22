import HelpDrawer from './HelpDrawer';
import type { HelpId } from './helpContent';

interface Props {
  title: string;
  subtitle?: string;
  /** Guía de ayuda ("i") de esta pantalla, junto al título. */
  helpId: HelpId;
  /** Acciones a la derecha (botones, chips de estado). */
  actions?: React.ReactNode;
}

/** Encabezado estándar de las pantallas del panel: título, botón de ayuda, subtítulo y acciones. */
export default function PageHeader({ title, subtitle, helpId, actions }: Props) {
  return (
    <header className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">{title}</h1>
          <HelpDrawer helpId={helpId} />
        </div>
        {subtitle && <p className="mt-1 max-w-2xl text-sm text-slate-500">{subtitle}</p>}
      </div>
      {actions && <div className="shrink-0">{actions}</div>}
    </header>
  );
}
