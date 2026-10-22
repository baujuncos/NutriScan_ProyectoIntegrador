'use client';

import { useState } from 'react';
import Button from '@/components/ui/Button';
import { generateExcelAction } from './actions';

interface Props {
  selectedIds: string[];
}

export default function ExportPanel({ selectedIds }: Props) {
  const [loading, setLoading] = useState(false);

  async function handleExport() {
    if (selectedIds.length === 0 || loading) return;
    setLoading(true);
    try {
      const result = await generateExcelAction(selectedIds);
      if ('error' in result) {
        alert(`Error: ${result.error}`);
        return;
      }
      const binary = atob(result.xlsx);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      const blob = new Blob([bytes], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `nutriscan_deportistas_${new Date()
        .toLocaleDateString('es-AR', {
          timeZone: 'America/Argentina/Buenos_Aires',
          day: '2-digit',
          month: '2-digit',
          year: 'numeric',
        })
        .replace(/\//g, '-')}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      alert('Hubo un error al generar el informe. Intentá de nuevo.');
    } finally {
      setLoading(false);
    }
  }

  if (selectedIds.length === 0) return null;

  return (
    <Button onClick={handleExport} loading={loading} className="gap-2">
      {loading ? (
        'Generando...'
      ) : (
        <>
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
          </svg>
          Descargar informe ({selectedIds.length})
        </>
      )}
    </Button>
  );
}
