'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import Button from '@/components/ui/Button';
import Modal from '@/components/ui/Modal';
import { anularMedicionAction } from './actions';

interface Props {
  medicionId: string;
  /** "24/10/2026": se nombra en la confirmación para que no haya dudas de cuál se anula. */
  fecha: string;
  /** Un borrador se "descarta"; una medición generada se "anula". */
  esBorrador?: boolean;
  /** Después de anular: ir a la ficha (desde el informe) o refrescar la lista (desde la ficha). */
  destino: 'ficha' | 'refrescar';
}

const BOTON_ABRIR =
  'rounded px-1 text-sm font-medium text-red-700 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500';

/** Baja lógica con confirmación: la medición no se borra, solo deja de verse y de contar. */
export default function AnularMedicion({ medicionId, fecha, esBorrador = false, destino }: Props) {
  const router = useRouter();
  const [abierto, setAbierto] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendiente, empezar] = useTransition();
  const verbo = esBorrador ? 'Descartar' : 'Anular';

  function confirmar() {
    setError(null);
    empezar(async () => {
      const r = await anularMedicionAction(medicionId);
      if ('error' in r) {
        setError(r.error);
        return;
      }
      setAbierto(false);
      if (destino === 'ficha') router.push(r.fichaHref);
      else router.refresh();
    });
  }

  return (
    <>
      <button type="button" onClick={() => setAbierto(true)} className={`${BOTON_ABRIR} no-imprimir`}>
        {verbo}
      </button>
      <Modal
        open={abierto}
        onClose={() => (pendiente ? undefined : setAbierto(false))}
        title={esBorrador ? 'Descartar borrador' : 'Anular medición'}
        size="sm"
        footer={
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => setAbierto(false)} disabled={pendiente}>
              Cancelar
            </Button>
            <Button type="button" onClick={confirmar} loading={pendiente} className="!bg-none !bg-red-700 hover:!bg-red-800">
              {esBorrador ? 'Descartar borrador' : 'Anular medición'}
            </Button>
          </div>
        }
      >
        <p className="text-sm text-slate-700">
          {esBorrador
            ? `El borrador del ${fecha} deja de verse.`
            : `La medición del ${fecha} deja de verse en la ficha, en los gráficos y en las comparaciones con otras mediciones.`}{' '}
          No se borra: queda registrada como anulada.
        </p>
        {error && (
          <p role="alert" className="mt-3 text-sm text-red-700">
            {error}
          </p>
        )}
      </Modal>
    </>
  );
}
