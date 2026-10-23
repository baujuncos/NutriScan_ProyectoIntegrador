'use client';

/**
 * NUT-151 — Botón que descarga el resumen de métricas en Markdown (con los filtros actuales) para
 * pasárselo a una IA y mejorar el prompt de reconocimiento y estimación.
 */
import { useState } from 'react';
import Button from '@/components/ui/Button';
import type { MetricasParams } from '@/lib/metricasIaQuery';
import { generarResumenMdAction } from './actions';

export default function DescargarResumenMd({ params }: { params: MetricasParams }) {
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function descargar() {
    setCargando(true);
    setError(null);
    try {
      const r = await generarResumenMdAction({ desde: params.desde, hasta: params.hasta, vajilla: params.vajilla, prompt: params.prompt });
      if ('error' in r) {
        setError(r.error);
        return;
      }
      const url = URL.createObjectURL(new Blob([r.markdown], { type: 'text/markdown;charset=utf-8' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = r.filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch {
      setError('No se pudo generar el resumen. Probá de nuevo.');
    } finally {
      setCargando(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <Button type="button" variant="outline" loading={cargando} onClick={descargar} title="Resumen con los filtros actuales, listo para pasárselo a una IA que mejore el prompt">
        <svg className="mr-2 h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
        </svg>
        Descargar resumen (.md)
      </Button>
      {error && (
        <p role="alert" className="max-w-xs text-right text-xs text-red-700">
          {error}
        </p>
      )}
    </div>
  );
}
