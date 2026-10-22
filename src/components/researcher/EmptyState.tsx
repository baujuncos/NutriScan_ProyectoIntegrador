interface Props {
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
}

/** Estado vacío de listas, tablas y tarjetas: mensaje centrado, con una acción opcional (ej. "Limpiar filtros"). */
export default function EmptyState({ title, description, action, className = '' }: Props) {
  return (
    <div className={`flex flex-col items-center justify-center gap-1 px-4 py-10 text-center ${className}`}>
      <p className="text-sm font-medium text-slate-700">{title}</p>
      {description && <p className="text-sm text-slate-500">{description}</p>}
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}
