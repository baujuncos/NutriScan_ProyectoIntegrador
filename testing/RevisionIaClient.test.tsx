/**
 * NUT-149 — Pantalla /revision-ia: listado, motivos, filtros y detalle.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { act, fireEvent, render, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const refresh = vi.fn();
const replace = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh, push: vi.fn(), replace }) }));
vi.mock('@/app/(researcher)/revision-ia/actions', () => ({
  renovarFotoAction: vi.fn(),
  confirmarRevisionAction: vi.fn().mockResolvedValue({ ok: true }),
  corregirRevisionAction: vi.fn().mockResolvedValue({ ok: true }),
  marcarCandidatoAction: vi.fn().mockResolvedValue({ ok: true }),
  reabrirRevisionAction: vi.fn().mockResolvedValue({ ok: true }),
}));

import RevisionIaClient from '@/app/(researcher)/revision-ia/RevisionIaClient';
import {
  confirmarRevisionAction,
  corregirRevisionAction,
  renovarFotoAction,
  marcarCandidatoAction,
  reabrirRevisionAction,
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
  bbox_x: 0.2,
  bbox_y: 0.4,
  bbox_width: 0.4,
  bbox_height: 0.2,
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

const FOTOS = { 'user-1/a.jpg': 'https://x/firmada-1' };

function renderCliente(over: Partial<React.ComponentProps<typeof RevisionIaClient>> = {}) {
  return render(<RevisionIaClient rows={[FILA, QUITADO]} total={2} params={parseRevisionParams({})} conteos={CONTEOS} fotos={FOTOS} {...over} />);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(renovarFotoAction).mockResolvedValue({ ok: true, url: 'https://x/nueva' });
});

describe('RevisionIaClient — encabezado y filtros', () => {
  it('muestra los conteos por estado como links que filtran', () => {
    renderCliente();
    const nav = screen.getByRole('navigation', { name: 'Estado de la cola de revisión' });
    expect(within(nav).getByRole('link', { name: /12\s*Pendientes/ })).toHaveAttribute('aria-current', 'true');
    expect(within(nav).getByRole('link', { name: /34\s*Confirmados/ })).toHaveAttribute('href', '/revision-ia?estado=confirmado');
    expect(within(nav).getByRole('link', { name: /9\s*Corregidos/ })).toHaveAttribute('href', '/revision-ia?estado=corregido');
  });

  it('el chip activo vuelve a "todos"', () => {
    renderCliente();
    expect(screen.getByRole('link', { name: /12\s*Pendientes/ })).toHaveAttribute('href', '/revision-ia?estado=todos');
  });

  it('tiene encabezado con ayuda, pestañas Cola / Métricas y ningún botón "Filtrar"', () => {
    renderCliente();
    expect(screen.getByRole('heading', { level: 1, name: 'Revisión de IA' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Ayuda sobre esta pantalla' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Cola de revisión' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: 'Métricas' })).toHaveAttribute('href', '/revision-ia/metricas');
    expect(screen.queryByRole('button', { name: /^filtrar$/i })).not.toBeInTheDocument();
  });

  it('todos los filtros están en una sola barra: estado, motivo, búsqueda, vajilla y orden', () => {
    renderCliente();
    const barra = screen.getByRole('search', { name: 'Filtros' });
    for (const label of ['Estado', 'Motivo', 'Buscar por alimento', 'Vajilla', 'Ordenar por']) {
      expect(barra).toContainElement(screen.getByLabelText(label));
    }
    expect(screen.getByLabelText('Estado')).toHaveValue('pendiente');
    expect(screen.getByLabelText('Vajilla')).toHaveValue('todas');
  });

  it('el filtro Estado ofrece Pendientes / Confirmados / Corregidos / Todos y se aplica al cambiar', () => {
    renderCliente({ params: parseRevisionParams({ page: '2' }) });
    const estado = screen.getByLabelText('Estado');
    expect(within(estado).getAllByRole('option').map((o) => o.textContent)).toEqual(['Pendientes', 'Confirmados', 'Corregidos', 'Todos']);
    fireEvent.change(estado, { target: { value: 'confirmado' } });
    expect(replace).toHaveBeenLastCalledWith('/revision-ia?estado=confirmado', { scroll: false }); // vuelve a la página 1
    fireEvent.change(estado, { target: { value: 'todos' } });
    expect(replace).toHaveBeenLastCalledWith('/revision-ia?estado=todos', { scroll: false });
  });

  it('los contadores son clicables y activan el filtro Estado (el activo vuelve a "todos")', () => {
    renderCliente({ params: parseRevisionParams({ estado: 'corregido' }) });
    const nav = screen.getByRole('navigation', { name: 'Estado de la cola de revisión' });
    expect(within(nav).getByRole('link', { name: /9\s*Corregidos/ })).toHaveAttribute('href', '/revision-ia?estado=todos');
    expect(within(nav).getByRole('link', { name: /12\s*Pendientes/ })).toHaveAttribute('href', '/revision-ia');
    expect(within(nav).getByRole('link', { name: /34\s*Confirmados/ })).toHaveAttribute('href', '/revision-ia?estado=confirmado');
  });

  it('un select se aplica al cambiar: reescribe la URL y vuelve a la página 1', () => {
    renderCliente({ params: parseRevisionParams({ page: '4', q: 'flan' }) });
    fireEvent.change(screen.getByLabelText('Motivo'), { target: { value: 'item_quitado' } });
    expect(replace).toHaveBeenCalledTimes(1);
    expect(replace).toHaveBeenCalledWith('/revision-ia?motivo=item_quitado&q=flan', { scroll: false });
  });

  it('la búsqueda espera ~300 ms antes de tocar la URL', () => {
    vi.useFakeTimers();
    try {
      renderCliente();
      fireEvent.change(screen.getByLabelText('Buscar por alimento'), { target: { value: 'emp' } });
      act(() => void vi.advanceTimersByTime(299));
      expect(replace).not.toHaveBeenCalled();
      act(() => void vi.advanceTimersByTime(1));
      expect(replace).toHaveBeenCalledWith('/revision-ia?q=emp', { scroll: false });
    } finally {
      vi.useRealTimers();
    }
  });

  it('"Limpiar" aparece con filtros activos y vuelve a los de por defecto', async () => {
    const { unmount } = renderCliente();
    expect(screen.queryByRole('button', { name: 'Limpiar' })).not.toBeInTheDocument();
    unmount();
    renderCliente({ params: parseRevisionParams({ motivo: 'confianza_baja', estado: 'todos' }) });
    await userEvent.click(screen.getByRole('button', { name: 'Limpiar' }));
    expect(replace).toHaveBeenCalledWith('/revision-ia', { scroll: false });
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
    expect(within(quitado).getByText('Ítem quitado').className).toMatch(/red/);
    expect(within(quitado).getByText(/el usuario lo quitó/)).toBeInTheDocument();
    expect(within(quitado).queryByText(/g final/)).not.toBeInTheDocument();
    expect(screen.getByRole('listitem', { name: 'Milanesa' })).not.toHaveAttribute('data-quitado');
  });

  it('sin filas muestra un mensaje vacío', () => {
    renderCliente({ rows: [], total: 0 });
    expect(screen.getByText(/No hay ítems/)).toBeInTheDocument();
  });
});

describe('RevisionIaClient — fotos reales en la lista', () => {
  const miniatura = (nombre: string) => within(screen.getByRole('listitem', { name: nombre })).getByRole('img', { name: `Foto de la comida: ${nombre}` });

  it('cada tarjeta muestra la foto firmada, con alt descriptivo, carga diferida y sin pedir nada al abrir la lista', () => {
    renderCliente();
    const img = miniatura('Milanesa');
    expect(img).toHaveAttribute('src', 'https://x/firmada-1');
    expect(img).toHaveAttribute('loading', 'lazy');
    expect(renovarFotoAction).not.toHaveBeenCalled();
  });

  it('el recorte se centra en el ítem (object-position según su boundingBox); sin caja, centrado', () => {
    renderCliente({ rows: [FILA, { ...QUITADO, bbox_x: null, bbox_y: null, bbox_width: null, bbox_height: null }] });
    expect(miniatura('Milanesa').style.objectPosition).toBe('40% 50%');
    expect(miniatura('Perejil').style.objectPosition).toBe('50% 50%');
  });

  it('muestra un skeleton mientras carga y lo saca cuando la imagen cargó', () => {
    renderCliente({ rows: [FILA] });
    const tarjeta = screen.getByRole('listitem', { name: 'Milanesa' });
    expect(tarjeta.querySelector('.animate-pulse')).not.toBeNull();
    fireEvent.load(miniatura('Milanesa'));
    expect(tarjeta.querySelector('.animate-pulse')).toBeNull();
  });

  it('si la URL venció pide UNA nueva, reintenta con ella y no cae en el fallback', async () => {
    renderCliente({ rows: [FILA] });
    fireEvent.error(miniatura('Milanesa'));
    await waitFor(() => expect(miniatura('Milanesa')).toHaveAttribute('src', 'https://x/nueva'));
    expect(renovarFotoAction).toHaveBeenCalledTimes(1);
    expect(renovarFotoAction).toHaveBeenCalledWith('user-1/a.jpg');
    expect(screen.queryByText('No se pudo cargar la foto')).not.toBeInTheDocument();
  });

  it('si la URL nueva también falla muestra "No se pudo cargar la foto" y NO vuelve a pedir (sin loops)', async () => {
    renderCliente({ rows: [FILA] });
    fireEvent.error(miniatura('Milanesa'));
    await waitFor(() => expect(miniatura('Milanesa')).toHaveAttribute('src', 'https://x/nueva'));
    fireEvent.error(miniatura('Milanesa'));
    expect(await screen.findByText('No se pudo cargar la foto')).toBeInTheDocument();
    expect(renovarFotoAction).toHaveBeenCalledTimes(1);
  });

  it('si no se puede renovar, muestra el fallback', async () => {
    vi.mocked(renovarFotoAction).mockResolvedValue({ error: 'No se pudo cargar la foto' });
    renderCliente({ rows: [FILA] });
    fireEvent.error(miniatura('Milanesa'));
    expect(await screen.findByText('No se pudo cargar la foto')).toBeInTheDocument();
  });

  it('varias tarjetas de la misma foto que fallan juntas renuevan una sola vez y todas se recuperan', async () => {
    const otra = { ...FILA, id_deteccion_item: 3, alimento_ia: 'Arroz' };
    renderCliente({ rows: [FILA, otra] });
    fireEvent.error(miniatura('Milanesa'));
    fireEvent.error(miniatura('Arroz'));
    await waitFor(() => expect(miniatura('Arroz')).toHaveAttribute('src', 'https://x/nueva'));
    expect(miniatura('Milanesa')).toHaveAttribute('src', 'https://x/nueva');
    expect(renovarFotoAction).toHaveBeenCalledTimes(1);
  });

  it('un ítem sin foto (o sin URL firmada) muestra el ícono con el aviso, sin pedir nada', () => {
    renderCliente({ rows: [{ ...FILA, imagen_path: null }], fotos: {} });
    expect(screen.getByText('No se pudo cargar la foto')).toBeInTheDocument();
    expect(renovarFotoAction).not.toHaveBeenCalled();
  });
});

const CORREGIDA: RevisionFila = {
  ...FILA,
  estado_revision: 'corregido',
  revisado_por: 'inv-1',
  revisado_en: '2026-10-20T15:00:00Z',
  revisor_nombre: 'Ana Pérez',
  nutricionista_alimento: 'Milanesa',
  nutricionista_gramos: 180,
};
const CONFIRMADA: RevisionFila = { ...FILA, estado_revision: 'confirmado', revisado_por: 'inv-1', revisado_en: '2026-10-20T15:00:00Z', revisor_nombre: 'Ana Pérez' };

describe('RevisionIaClient — lo ya revisado', () => {
  it('Corregido: trío IA → Deportista → Investigador (nombre y peso), con la columna del investigador resaltada', () => {
    renderCliente({ rows: [CORREGIDA] });
    const trio = within(screen.getByRole('listitem', { name: 'Milanesa' })).getByTestId('trio-revisado');
    expect(within(trio).getByText('IA')).toBeInTheDocument();
    expect(within(trio).getByText('Deportista')).toBeInTheDocument();
    const inv = within(trio).getByText('Investigador').parentElement!;
    expect(inv.className).toContain('bg-blue-50'); // resaltada
    expect(inv).toHaveTextContent('180 g'); // peso nuevo
    expect(within(trio).getByText('150 g')).toBeInTheDocument(); // IA
    expect(within(trio).getByText('250 g')).toBeInTheDocument(); // deportista
  });

  it('muestra "(sin cambios)" en el campo que el investigador mantuvo (el nombre) y no en el que cambió (el peso)', () => {
    renderCliente({ rows: [CORREGIDA] });
    const inv = within(screen.getByTestId('trio-revisado')).getByText('Investigador').parentElement!;
    const sinCambios = within(inv).getAllByText('(sin cambios)');
    expect(sinCambios).toHaveLength(1);
    expect(sinCambios[0].parentElement).toHaveTextContent('Milanesa');
  });

  it('muestra quién corrigió y cuándo', () => {
    renderCliente({ rows: [CORREGIDA] });
    expect(screen.getByText(/Corregido por Ana Pérez el 20\/10\/2026/)).toBeInTheDocument();
  });

  it('un ítem quitado y confirmado como tal muestra "Sigue quitado" en la columna del investigador', () => {
    renderCliente({ rows: [{ ...QUITADO, estado_revision: 'corregido', revisor_nombre: 'Ana Pérez', revisado_en: '2026-10-20T15:00:00Z', nutricionista_alimento: 'Perejil', nutricionista_gramos: 12 }] });
    const inv = within(screen.getByTestId('trio-revisado')).getByText('Investigador').parentElement!;
    expect(inv).toHaveTextContent('Perejil');
    expect(inv).toHaveTextContent('12 g');
    expect(inv).not.toHaveTextContent('(sin cambios)');
  });

  it('Confirmado: "Confirmado por {persona} el {fecha}" y el valor final', () => {
    renderCliente({ rows: [CONFIRMADA] });
    const fila = screen.getByRole('listitem', { name: 'Milanesa' });
    expect(within(fila).getByText(/Confirmado por Ana Pérez el 20\/10\/2026/)).toBeInTheDocument();
    expect(within(fila).getByText('Milanesa · 250 g')).toBeInTheDocument(); // valor final = el del deportista
    expect(within(fila).queryByTestId('trio-revisado')).not.toBeInTheDocument();
  });

  it('sin nombre de quien revisó no rompe: dice "el equipo de nutrición"', () => {
    renderCliente({ rows: [{ ...CONFIRMADA, revisor_nombre: null }] });
    expect(screen.getByText(/Confirmado por el equipo de nutrición/)).toBeInTheDocument();
  });

  it('los botones Confirmar / Corregir se reemplazan por Ver detalle y Reabrir; los pendientes no cambian', () => {
    renderCliente({ rows: [CORREGIDA, { ...FILA, id_deteccion_item: 5, alimento_ia: 'Arroz' }] });
    expect(screen.queryByRole('button', { name: 'Confirmar Milanesa' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Corregir Milanesa' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Ver detalle de Milanesa' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reabrir Milanesa' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Confirmar Arroz' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Corregir Arroz' })).toBeInTheDocument();
  });

  it('Ver detalle abre el modal en modo lectura: investigador con sus valores, sin formulario y con Reabrir', async () => {
    renderCliente({ rows: [CORREGIDA] });
    await userEvent.click(screen.getByRole('button', { name: 'Ver detalle de Milanesa' }));
    const dlg = within(await screen.findByRole('dialog', { name: 'Revisar predicción' }));
    expect(dlg.queryByText('Tu corrección')).not.toBeInTheDocument();
    expect(dlg.queryByRole('button', { name: 'Guardar corrección' })).not.toBeInTheDocument();
    const tabla = dlg.getByRole('table');
    expect(within(tabla).getByText('180 g')).toBeInTheDocument();
    expect(dlg.getByText(/Corregido por Ana Pérez el 20\/10\/2026/)).toBeInTheDocument();
    expect(dlg.getByRole('button', { name: 'Reabrir' })).toBeInTheDocument();
  });

  it('Reabrir pide confirmación, llama a la acción y refresca la lista', async () => {
    renderCliente({ rows: [CORREGIDA] });
    await userEvent.click(screen.getByRole('button', { name: 'Reabrir Milanesa' }));
    const dlg = within(await screen.findByRole('dialog', { name: 'Reabrir revisión' }));
    expect(dlg.getByText(/se borra la corrección del investigador/)).toBeInTheDocument();
    expect(reabrirRevisionAction).not.toHaveBeenCalled();
    await userEvent.click(dlg.getByRole('button', { name: 'Reabrir' }));
    await waitFor(() => expect(reabrirRevisionAction).toHaveBeenCalledWith(1));
    expect(refresh).toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('Cancelar en la confirmación no reabre nada', async () => {
    renderCliente({ rows: [CORREGIDA] });
    await userEvent.click(screen.getByRole('button', { name: 'Reabrir Milanesa' }));
    await userEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Cancelar' }));
    expect(reabrirRevisionAction).not.toHaveBeenCalled();
  });

  it('si reabrir falla muestra el error y no refresca', async () => {
    vi.mocked(reabrirRevisionAction).mockResolvedValueOnce({ error: 'Este ítem ya está pendiente' });
    renderCliente({ rows: [CORREGIDA] });
    await userEvent.click(screen.getByRole('button', { name: 'Reabrir Milanesa' }));
    await userEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Reabrir' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('ya está pendiente');
    expect(refresh).not.toHaveBeenCalled();
  });
});

describe('RevisionIaClient — acciones en la lista', () => {
  it('Confirmar confirma ese ítem sin abrir el detalle y refresca', async () => {
    renderCliente();
    await userEvent.click(screen.getByRole('button', { name: 'Confirmar Milanesa' }));
    await waitFor(() => expect(confirmarRevisionAction).toHaveBeenCalledWith(1));
    expect(refresh).toHaveBeenCalled();
    expect(corregirRevisionAction).not.toHaveBeenCalled();
  });

  it('la estrella marca como candidato sin confirmar ni corregir', async () => {
    renderCliente();
    const estrella = screen.getByRole('button', { name: 'Ejemplo para la IA: Milanesa' });
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
    await screen.findByRole('dialog');
  }

  it('al abrir reutiliza la misma foto de la lista (sin pedir otra URL) y muestra el contexto de captura', async () => {
    await abrir();
    expect(dialogo().getByRole('img', { name: 'Foto de la comida: Milanesa' })).toHaveAttribute('src', 'https://x/firmada-1');
    expect(renovarFotoAction).not.toHaveBeenCalled();
    expect(screen.getByText(/Plato playo de 26 cm/)).toBeInTheDocument();
  });

  it('si la foto del modal falla, renueva una vez y la lista y el modal quedan con la URL nueva', async () => {
    await abrir();
    fireEvent.error(dialogo().getByRole('img', { name: 'Foto de la comida: Milanesa' }));
    await waitFor(() => expect(dialogo().getByRole('img', { name: 'Foto de la comida: Milanesa' })).toHaveAttribute('src', 'https://x/nueva'));
    expect(renovarFotoAction).toHaveBeenCalledTimes(1);
  });

  it('"Confirmar sin cambios" del modal llama a su acción y refresca la lista', async () => {
    await abrir();
    await userEvent.click(dialogo().getByRole('button', { name: 'Confirmar sin cambios' }));
    await waitFor(() => expect(confirmarRevisionAction).toHaveBeenCalledWith(1));
    expect(corregirRevisionAction).not.toHaveBeenCalled();
    expect(refresh).toHaveBeenCalled();
  });

  it('el botón Corregir de la lista abre el mismo modal, con el formulario "Tu corrección"', async () => {
    await abrir('Corregir Milanesa');
    expect(dialogo().getByText('Tu corrección')).toBeInTheDocument();
    await userEvent.click(dialogo().getByRole('button', { name: 'Guardar corrección' }));
    await waitFor(() => expect(corregirRevisionAction).toHaveBeenCalledWith({ id: 1, alimento: 'Milanesa', gramos: 250 }));
    expect(confirmarRevisionAction).not.toHaveBeenCalled();
    expect(refresh).toHaveBeenCalled(); // la lista se actualiza sin recargar la página
  });

  it('marcar "Ejemplo para la IA" en el modal es independiente: no confirma ni corrige', async () => {
    await abrir();
    await userEvent.click(dialogo().getByRole('checkbox', { name: 'Ejemplo para la IA' }));
    await waitFor(() => expect(marcarCandidatoAction).toHaveBeenCalledWith(1, true));
    expect(confirmarRevisionAction).not.toHaveBeenCalled();
    expect(corregirRevisionAction).not.toHaveBeenCalled();
    expect(refresh).toHaveBeenCalled();
  });
});
