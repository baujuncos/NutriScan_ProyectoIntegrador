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

const CONTEOS = { pendiente: 12, confirmado: 34, corregido: 9 };

function renderCliente(over: Partial<React.ComponentProps<typeof RevisionIaClient>> = {}) {
  return render(<RevisionIaClient rows={[FILA, QUITADO]} total={2} params={parseRevisionParams({})} conteos={CONTEOS} {...over} />);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getRevisionDetalleAction).mockResolvedValue({ ok: true, fila: FILA, fotoUrl: 'https://x/firmada' });
});

describe('RevisionIaClient — encabezado y filtros', () => {
  it('muestra los conteos por estado como links que filtran', () => {
    renderCliente();
    const nav = screen.getByRole('navigation', { name: 'Filtrar por estado' });
    expect(within(nav).getByRole('link', { name: /12\s*Pendientes/ })).toHaveAttribute('aria-current', 'true');
    expect(within(nav).getByRole('link', { name: /34\s*Confirmados/ })).toHaveAttribute('href', '/revision-ia?estado=confirmado');
    expect(within(nav).getByRole('link', { name: /9\s*Corregidos/ })).toHaveAttribute('href', '/revision-ia?estado=corregido');
  });

  it('el chip activo vuelve a "todos"', () => {
    renderCliente();
    expect(screen.getByRole('link', { name: /12\s*Pendientes/ })).toHaveAttribute('href', '/revision-ia?estado=todos');
  });

  it('tiene las pestañas y los filtros: motivo, búsqueda, vajilla, orden y fechas', () => {
    renderCliente();
    expect(screen.getByRole('tab', { name: 'Cola de revisión' })).toHaveAttribute('aria-selected', 'true');
    for (const label of ['Motivo', 'Buscar por alimento', 'Vajilla', 'Ordenar por', 'Desde', 'Hasta']) {
      expect(screen.getByLabelText(label)).toBeInTheDocument();
    }
    expect(screen.getByLabelText('Vajilla')).toHaveValue('todas');
  });
});

describe('RevisionIaClient — listado', () => {
  it('muestra motivos, Gemini vs. final, peso con % y confianza', () => {
    renderCliente();
    const fila = screen.getByRole('listitem', { name: 'Milanesa' });
    expect(within(fila).getByText('Confianza baja')).toBeInTheDocument();
    expect(within(fila).getByText('Corrección de peso')).toBeInTheDocument();
    expect(within(fila).getByText('— sin cambio')).toBeInTheDocument();
    expect(within(fila).getByText('150 g estimado')).toBeInTheDocument();
    expect(within(fila).getByText('250 g final')).toBeInTheDocument();
    expect(within(fila).getByText('(+67%)')).toBeInTheDocument();
    expect(within(fila).getByText('Confianza 45%')).toBeInTheDocument();
    expect(within(fila).getByText(/Plato playo · 26 cm · 45°/)).toBeInTheDocument();
  });

  it('un cambio de alimento muestra Gemini → Final', () => {
    renderCliente({ rows: [{ ...FILA, motivos_revision: ['cambio_alimento'], alimento_usuario: 'Pollo' }] });
    const fila = screen.getByRole('listitem', { name: 'Milanesa' });
    expect(within(fila).getByText('Pollo')).toBeInTheDocument();
    expect(within(fila).queryByText('— sin cambio')).not.toBeInTheDocument();
  });

  it('distingue visualmente el ítem quitado (marca, chip rojo con ícono y leyenda)', () => {
    renderCliente();
    const quitado = screen.getByRole('listitem', { name: 'Perejil' });
    expect(quitado).toHaveAttribute('data-quitado', 'true');
    expect(within(quitado).getByText('Ítem quitado').closest('li')?.className).toMatch(/red/);
    expect(within(quitado).getByText(/el usuario lo quitó/)).toBeInTheDocument();
    expect(within(quitado).queryByText(/g final/)).not.toBeInTheDocument();
    expect(screen.getByRole('listitem', { name: 'Milanesa' })).not.toHaveAttribute('data-quitado');
  });

  it('la miniatura es un placeholder: la lista no pide detalle ni foto', () => {
    renderCliente();
    expect(screen.queryAllByRole('img')).toHaveLength(0);
    expect(getRevisionDetalleAction).not.toHaveBeenCalled();
  });

  it('sin filas muestra un mensaje vacío', () => {
    renderCliente({ rows: [], total: 0 });
    expect(screen.getByText(/No hay ítems/)).toBeInTheDocument();
  });

  it('un ítem ya revisado muestra su estado en vez de Confirmar / Corregir', () => {
    renderCliente({ rows: [{ ...FILA, estado_revision: 'confirmado' }] });
    expect(screen.queryByRole('button', { name: /^Confirmar/ })).not.toBeInTheDocument();
    expect(screen.getByText('Confirmado')).toBeInTheDocument();
  });
});

describe('RevisionIaClient — acciones en la lista', () => {
  it('Confirmar confirma ese ítem sin abrir el detalle y refresca', async () => {
    renderCliente();
    await userEvent.click(screen.getByRole('button', { name: 'Confirmar Milanesa' }));
    await waitFor(() => expect(confirmarRevisionAction).toHaveBeenCalledWith(1));
    expect(refresh).toHaveBeenCalled();
    expect(getRevisionDetalleAction).not.toHaveBeenCalled();
    expect(corregirRevisionAction).not.toHaveBeenCalled();
  });

  it('la estrella marca como candidato sin confirmar ni corregir', async () => {
    renderCliente();
    const estrella = screen.getByRole('button', { name: 'Candidato a ejemplo: Milanesa' });
    expect(estrella).toHaveAttribute('aria-pressed', 'false');
    await userEvent.click(estrella);
    await waitFor(() => expect(marcarCandidatoAction).toHaveBeenCalledWith(1, true));
    expect(confirmarRevisionAction).not.toHaveBeenCalled();
    expect(corregirRevisionAction).not.toHaveBeenCalled();
  });

  it('un error de la acción se muestra y no refresca', async () => {
    vi.mocked(confirmarRevisionAction).mockResolvedValueOnce({ error: 'Este ítem ya fue revisado por otra persona' });
    renderCliente();
    await userEvent.click(screen.getByRole('button', { name: 'Confirmar Milanesa' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('ya fue revisado');
    expect(refresh).not.toHaveBeenCalled();
  });
});

describe('RevisionIaDetalle', () => {
  const dialogo = () => within(screen.getByRole('dialog'));

  async function abrir(boton = 'Ver detalle y foto de Milanesa') {
    renderCliente();
    await userEvent.click(screen.getByRole('button', { name: boton }));
    await screen.findByRole('img', { name: /Foto del plato/ });
  }

  it('al abrir pide el detalle de ESE ítem y muestra la foto firmada y el contexto de captura', async () => {
    await abrir();
    expect(getRevisionDetalleAction).toHaveBeenCalledTimes(1);
    expect(getRevisionDetalleAction).toHaveBeenCalledWith(1);
    expect(screen.getByRole('img', { name: /Foto del plato/ })).toHaveAttribute('src', 'https://x/firmada');
    expect(screen.getByText(/Plato playo de 26 cm/)).toBeInTheDocument();
  });

  it('Confirmar en el detalle llama a su acción y refresca', async () => {
    await abrir();
    await userEvent.click(dialogo().getByRole('button', { name: 'Confirmar' }));
    await waitFor(() => expect(confirmarRevisionAction).toHaveBeenCalledWith(1));
    expect(corregirRevisionAction).not.toHaveBeenCalled();
    expect(refresh).toHaveBeenCalled();
  });

  it('el botón Corregir de la lista abre el detalle directo en el formulario de corrección', async () => {
    await abrir('Corregir Milanesa');
    const guardar = dialogo().getByRole('button', { name: 'Guardar corrección' });
    expect(guardar).toBeDisabled();
    await userEvent.type(dialogo().getByLabelText('Peso (g)'), '200');
    await userEvent.click(guardar);
    await waitFor(() => expect(corregirRevisionAction).toHaveBeenCalledWith({ id: 1, alimento: null, gramos: 200 }));
    expect(confirmarRevisionAction).not.toHaveBeenCalled();
  });

  it('marcar candidato en el detalle es independiente: no confirma ni corrige', async () => {
    await abrir();
    await userEvent.click(dialogo().getByRole('button', { name: /Marcar como candidato a ejemplo/ }));
    await waitFor(() => expect(marcarCandidatoAction).toHaveBeenCalledWith(1, true));
    expect(confirmarRevisionAction).not.toHaveBeenCalled();
    expect(corregirRevisionAction).not.toHaveBeenCalled();
    expect(await dialogo().findByRole('button', { name: /Candidato a ejemplo/ })).toHaveAttribute('aria-pressed', 'true');
  });
});
