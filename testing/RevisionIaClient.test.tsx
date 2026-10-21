/**
 * NUT-149 — Pantalla /revision-ia: listado, motivos, filtros y detalle.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const refresh = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh, push: vi.fn() }) }));
vi.mock('@/app/(researcher)/revision-ia/actions', () => ({
  getRevisionDetalleAction: vi.fn(),
  confirmarRevisionAction: vi.fn().mockResolvedValue({ ok: true }),
  corregirRevisionAction: vi.fn().mockResolvedValue({ ok: true }),
  marcarCandidatoAction: vi.fn().mockResolvedValue({ ok: true }),
}));

import RevisionIaClient from '@/app/(researcher)/revision-ia/RevisionIaClient';
import {
  confirmarRevisionAction,
  corregirRevisionAction,
  getRevisionDetalleAction,
  marcarCandidatoAction,
  type RevisionFila,
} from '@/app/(researcher)/revision-ia/actions';
import { parseRevisionParams } from '@/lib/revisionIaQuery';

const FILA: RevisionFila = {
  id_deteccion_item: 1,
  id_deteccion: 10,
  item_uuid: 'u1',
  alimento_ia: 'Milanesa',
  gramos_ia: 150,
  confidence: 0.45,
  motivos_revision: ['confianza_baja', 'correccion_peso_grande'],
  item_quitado: false,
  estado_revision: 'pendiente',
  revisado_por: null,
  revisado_en: null,
  nutricionista_alimento: null,
  nutricionista_gramos: null,
  candidato_ejemplo: false,
  created_at: '2026-10-06T15:00:00Z',
  id_usuario: 'user-1',
  imagen_path: 'user-1/a.jpg',
  vajilla_tipo: 'plato_playo',
  vajilla_diametro_cm: 26,
  angulo_captura_grados: 45,
  angulo_aproximado: false,
  alimento_usuario: 'Milanesa',
  gramos_usuario: 250,
  origen_usuario: 'ai',
};
const QUITADO: RevisionFila = {
  ...FILA,
  id_deteccion_item: 2,
  alimento_ia: 'Perejil',
  motivos_revision: ['item_quitado'],
  item_quitado: true,
  alimento_usuario: null,
  gramos_usuario: null,
  origen_usuario: null,
};

function renderCliente(over: Partial<React.ComponentProps<typeof RevisionIaClient>> = {}) {
  return render(<RevisionIaClient rows={[FILA, QUITADO]} total={2} params={parseRevisionParams({})} {...over} />);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getRevisionDetalleAction).mockResolvedValue({ ok: true, fila: FILA, fotoUrl: 'https://x/firmada' });
});

describe('RevisionIaClient — listado', () => {
  it('muestra Gemini vs usuario, confianza y los motivos de cada ítem', () => {
    renderCliente();
    const fila = screen.getByRole('listitem', { name: 'Milanesa' });
    expect(within(fila).getByText(/150 g/)).toBeInTheDocument();
    expect(within(fila).getByText(/250 g/)).toBeInTheDocument();
    expect(within(fila).getByText('Confianza baja')).toBeInTheDocument();
    expect(within(fila).getByText('Corrección de peso grande')).toBeInTheDocument();
    expect(within(fila).getByText(/Confianza 45%/)).toBeInTheDocument();
  });

  it('distingue visualmente el ítem quitado (marca, chip rojo y "Lo quitó")', () => {
    renderCliente();
    const quitado = screen.getByRole('listitem', { name: 'Perejil' });
    expect(quitado).toHaveAttribute('data-quitado', 'true');
    expect(within(quitado).getByText('Ítem quitado').closest('li')?.className).toMatch(/red/);
    expect(within(quitado).getByText(/Lo quitó/)).toBeInTheDocument();
    expect(screen.getByRole('listitem', { name: 'Milanesa' })).not.toHaveAttribute('data-quitado');
  });

  it('tiene los filtros: estado, motivo, fechas, búsqueda y orden', () => {
    renderCliente();
    for (const label of ['Estado', 'Motivo', 'Desde', 'Hasta', 'Buscar por nombre de alimento', 'Ordenar por']) {
      expect(screen.getByLabelText(label)).toBeInTheDocument();
    }
    expect(screen.getByLabelText('Estado')).toHaveValue('pendiente');
  });

  it('sin filas muestra un mensaje vacío', () => {
    renderCliente({ rows: [], total: 0 });
    expect(screen.getByText(/No hay ítems/)).toBeInTheDocument();
  });

  it('la lista no pide el detalle (ni la foto) hasta abrir un ítem', () => {
    renderCliente();
    expect(getRevisionDetalleAction).not.toHaveBeenCalled();
  });
});

describe('RevisionIaDetalle', () => {
  async function abrir() {
    renderCliente();
    await userEvent.click(screen.getByRole('button', { name: 'Revisar Milanesa' }));
    await screen.findByRole('img', { name: /Foto del plato/ });
  }

  it('al abrir pide el detalle de ESE ítem y muestra la foto firmada y el contexto de captura', async () => {
    await abrir();
    expect(getRevisionDetalleAction).toHaveBeenCalledTimes(1);
    expect(getRevisionDetalleAction).toHaveBeenCalledWith(1);
    expect(screen.getByRole('img', { name: /Foto del plato/ })).toHaveAttribute('src', 'https://x/firmada');
    expect(screen.getByText(/Plato playo de 26 cm/)).toBeInTheDocument();
  });

  it('Confirmar llama a su acción y refresca', async () => {
    await abrir();
    await userEvent.click(screen.getByRole('button', { name: 'Confirmar' }));
    await waitFor(() => expect(confirmarRevisionAction).toHaveBeenCalledWith(1));
    expect(corregirRevisionAction).not.toHaveBeenCalled();
    expect(refresh).toHaveBeenCalled();
  });

  it('Corregir exige alimento y/o peso y manda sólo lo del nutricionista', async () => {
    await abrir();
    await userEvent.click(screen.getByRole('button', { name: 'Corregir' }));
    const guardar = screen.getByRole('button', { name: 'Guardar corrección' });
    expect(guardar).toBeDisabled();
    await userEvent.type(screen.getByLabelText('Peso (g)'), '200');
    await userEvent.click(guardar);
    await waitFor(() => expect(corregirRevisionAction).toHaveBeenCalledWith({ id: 1, alimento: null, gramos: 200 }));
    expect(confirmarRevisionAction).not.toHaveBeenCalled();
  });

  it('marcar candidato es independiente: no confirma ni corrige', async () => {
    await abrir();
    await userEvent.click(screen.getByRole('button', { name: /Marcar como candidato a ejemplo/ }));
    await waitFor(() => expect(marcarCandidatoAction).toHaveBeenCalledWith(1, true));
    expect(confirmarRevisionAction).not.toHaveBeenCalled();
    expect(corregirRevisionAction).not.toHaveBeenCalled();
    expect(await screen.findByRole('button', { name: /Candidato a ejemplo/ })).toHaveAttribute('aria-pressed', 'true');
  });
});
