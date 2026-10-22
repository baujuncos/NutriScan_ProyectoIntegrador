import Link from 'next/link';

export interface SubTab {
  label: string;
  href: string;
}

/** Pestañas de una misma sección (ej. Cola / Métricas); la activa se marca con `activeHref`. */
export default function SubTabs({ tabs, activeHref, label = 'Secciones' }: { tabs: SubTab[]; activeHref: string; label?: string }) {
  return (
    <div role="tablist" aria-label={label} className="inline-flex gap-1 rounded-xl bg-slate-100 p-1 text-sm font-medium">
      {tabs.map((t) => {
        const activa = t.href === activeHref;
        return (
          <Link
            key={t.href}
            href={t.href}
            role="tab"
            aria-selected={activa}
            className={`rounded-lg px-4 py-2 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${
              activa ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            {t.label}
          </Link>
        );
      })}
    </div>
  );
}
