'use client';

import Link from 'next/link';
import Button from '@/components/ui/Button';

interface Props {
  /** Nombre sugerido del archivo al guardar como PDF (paciente + fecha). */
  nombreArchivo: string;
  hrefEditar: string;
}

/**
 * Exportar a PDF = diálogo de impresión del navegador ("Guardar como PDF"), con la hoja de estilos
 * A4 de globals.css. El título de la pestaña se cambia mientras se imprime porque los navegadores
 * lo usan como nombre sugerido del archivo.
 */
export default function AccionesInforme({ nombreArchivo, hrefEditar }: Props) {
  function exportarPdf() {
    const tituloPrevio = document.title;
    const restaurar = () => {
      document.title = tituloPrevio;
      window.removeEventListener('afterprint', restaurar);
    };
    window.addEventListener('afterprint', restaurar);
    document.title = nombreArchivo;
    window.print();
  }

  return (
    <div className="no-imprimir flex flex-wrap gap-2">
      <Link
        href={hrefEditar}
        className="inline-flex items-center rounded-lg border border-blue-700 px-4 py-2 text-sm font-medium text-blue-700 hover:bg-blue-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2"
      >
        Editar
      </Link>
      <Button type="button" onClick={exportarPdf}>
        Exportar PDF
      </Button>
    </div>
  );
}
