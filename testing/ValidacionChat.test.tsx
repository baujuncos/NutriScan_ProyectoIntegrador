/**
 * NUT-228 / NUT-231 — /validacion con entradas del chat con IA (sin foto): marca "Chat" en el listado,
 * detalle sin imagen con el alimento interpretado, el texto original y las aclaraciones, las mismas
 * acciones que el resto (IA con valores precargados, a mano, vincular, descartar) y entradas mixtas.
 * Las entradas de foto y de carga manual tienen sus propios tests (ValidacionClient / ValidacionManuales).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));
vi.mock('@/app/(researcher)/validacion/actions', () => ({
  getPendienteDetalleAction: vi.fn(),
  buscarAlimentosPropiosAction: vi.fn().mockResolvedValue([]),
  verificarAlimentoPropioAction: vi.fn(),
  validarComoPropioAction: vi.fn(),
  retirarAlimentoPropioAction: vi.fn(),
  modificarPendienteAction: vi.fn(),
  validarPendienteAction: vi.fn(),
  descartarPendienteAction: vi.fn(),
}));
vi.mock('@/app/alimentacion/actions', () => ({ searchAlimentosAction: vi.fn().mockResolvedValue([]) }));

import PendienteDetalle from '@/app/(researcher)/validacion/PendienteDetalle';
import ValidacionClient from '@/app/(researcher)/validacion/ValidacionClient';
import {
  descartarPendienteAction,
  getPendienteDetalleAction,
  validarPendienteAction,
  type SolicitudChat,
  type SolicitudManual,
} from '@/app/(researcher)/validacion/actions';
import { parseParams } from '@/lib/validacionQuery';
import { OCURRENCIA, PENDIENTE } from './fixtures/validacion';

const SOLO_CHAT = {
  ...PENDIENTE,
  id_pendiente: 9,
  nombre_original: 'Empanada de carne',
  nombre_normalizado: 'empanada de carne',
  categoria_ia: 'otro',
  gemini_kcal_100g: 250,
  gemini_proteinas_100g: 10.5,
  gemini_grasas_100g: 11,
  gemini_carbs_100g: 27,
  origen: 'chat' as const,
  ocurrencias: 0,
  ultima_ocurrencia: null,
  ocurrencias_manuales: 0,
  ocurrencias_chat: 2,
  usuarios_distintos: 2,
};

const SOLICITUDES_CHAT: SolicitudChat[] = [
  {
    idItem: 1,
    fecha: '2026-10-06',
    deportista: 'Ana Pérez',
    interpretado: 'Empanada de carne',
    gramos: 240,
    conversacion: [
      { role: 'user', content: 'Comí una empanada' },
      { role: 'assistant', content: '¿De qué es?' },
      { role: 'user', content: 'De carne' },
    ],
  },
  { idItem: 2, fecha: '2026-10-05', deportista: 'Juan Gómez', interpretado: 'empanada de carne', gramos: 100, conversacion: null },
];

const MANUALES: SolicitudManual[] = [{ idItem: 7, fecha: '2026-10-04', deportista: 'Luz Díaz', nombre: 'Empanada', gramos: 90 }];

const detalle = (pendiente: object, extra: Record<string, unknown> = {}) => ({
  ok: true as const,
  pendiente: pendiente as never,
  ocurrencias: [],
  totalOcurrencias: 0,
  propio: null,
  solicitudesManuales: [],
  totalSolicitudesManuales: 0,
  solicitudesChat: SOLICITUDES_CHAT,
  totalSolicitudesChat: 2,
  existentesCatalogo: [],
  ...extra,
});

async function abrir(d: ReturnType<typeof detalle>) {
  vi.mocked(getPendienteDetalleAction).mockResolvedValue(d);
  const user = userEvent.setup();
  render(<PendienteDetalle idPendiente={(d.pendiente as { id_pendiente: number }).id_pendiente} onClose={vi.fn()} onResuelto={vi.fn()} onGuardado={vi.fn()} />);
  await screen.findByLabelText('Nombre');
  return user;
}

describe('/validacion — listado con entradas del chat', () => {
  const lista = (rows: Array<Record<string, unknown>>) =>
    render(<ValidacionClient rows={rows as never} total={rows.length} params={parseParams({})} />);

  it('una entrada creada por el chat muestra la marca "Chat" (y no "Manual"), "N chats" y los usuarios', () => {
    lista([SOLO_CHAT]);
    const fila = screen.getByRole('listitem', { name: /Empanada de carne/ });
    expect(within(fila).getByText('Chat')).toBeInTheDocument();
    expect(within(fila).queryByText('Manual')).not.toBeInTheDocument();
    expect(within(fila).getByText('2 chats')).toBeInTheDocument();
    expect(within(fila).getByText('2 usuarios')).toBeInTheDocument();
    expect(fila).not.toHaveTextContent(/manual/i);
  });

  it('un solo ítem del chat va en singular y sin el 0 de ocurrencias con foto', () => {
    lista([{ ...SOLO_CHAT, ocurrencias_chat: 1, usuarios_distintos: 1 }]);
    const c = screen.getByRole('listitem').querySelector('span.text-sm.text-slate-700') as HTMLElement;
    expect(c).toHaveTextContent('Ocurrencias: 1 chat');
    expect(c).not.toHaveTextContent(/\b0\b/);
  });

  it('una entrada de foto con ítems del chat conserva su número y suma "+N chat"; sin marca "Chat" (se creó por IA)', () => {
    lista([{ ...PENDIENTE, ocurrencias_chat: 3, usuarios_distintos: 4 }]);
    const fila = screen.getByRole('listitem', { name: /Flan casero/ });
    expect(within(fila).queryByText('Chat')).not.toBeInTheDocument();
    expect(within(fila).getByText('2')).toBeInTheDocument();
    expect(within(fila).getByText('+3 chats')).toBeInTheDocument();
  });

  it('manual + chat sin foto muestra ambas cifras sin duplicar el término "manual" en el chat', () => {
    lista([{ ...SOLO_CHAT, origen: 'manual', ocurrencias_manuales: 2, ocurrencias_chat: 1, usuarios_distintos: 3 }]);
    const fila = screen.getByRole('listitem');
    expect(within(fila).getByText('2 manuales')).toBeInTheDocument();
    expect(within(fila).getByText('+1 chat')).toBeInTheDocument();
    expect(within(fila).getByText('Manual')).toBeInTheDocument();
    expect(within(fila).queryByText('Chat')).not.toBeInTheDocument();
  });

  it('las entradas de foto y manuales se ven exactamente como antes (sin líneas de chat)', () => {
    lista([PENDIENTE, { ...PENDIENTE, id_pendiente: 6, nombre_original: 'Otro', ocurrencias_manuales: 2, origen: 'manual' }]);
    expect(screen.queryByText(/chat/i)).not.toBeInTheDocument();
    expect(screen.getByText('+2 manuales')).toBeInTheDocument();
  });
});

describe('/validacion — detalle de una entrada del chat (sin foto)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('muestra el alimento interpretado, el texto original y las preguntas aclaratorias con sus respuestas, sin imagen', async () => {
    await abrir(detalle(SOLO_CHAT));
    const sec = screen.getByRole('region', { name: 'Estimado por el chat' });
    expect(within(sec).getByText(/2 solicitudes/)).toBeInTheDocument();
    expect(within(sec).getByText(/Lo pidieron 2 usuarios/)).toBeInTheDocument();
    expect(within(sec).getByText('Ana Pérez')).toBeInTheDocument();
    expect(within(sec).getByText(/El chat interpretó «Empanada de carne» · 240 g/)).toBeInTheDocument();
    const conv = within(sec).getByRole('list', { name: 'Conversación' });
    expect(within(conv).getByText('Comí una empanada')).toBeInTheDocument();
    expect(within(conv).getByText('¿De qué es?')).toBeInTheDocument();
    expect(within(conv).getByText('De carne')).toBeInTheDocument();
    expect(within(conv).getAllByText('Escribió:')).toHaveLength(2);
    expect(within(conv).getByText('El chat preguntó:')).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Dónde apareció' })).not.toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Cargado manualmente' })).not.toBeInTheDocument();
    expect(screen.queryByAltText(/Foto del plato/)).not.toBeInTheDocument();
  });

  it('un ítem sin conversación guardada se muestra igual (sin lista de mensajes)', async () => {
    await abrir(detalle(SOLO_CHAT, { solicitudesChat: [SOLICITUDES_CHAT[1]], totalSolicitudesChat: 1 }));
    const sec = screen.getByRole('region', { name: 'Estimado por el chat' });
    expect(within(sec).getByText(/El chat interpretó «empanada de carne» · 100 g/)).toBeInTheDocument();
    expect(within(sec).queryByRole('list', { name: 'Conversación' })).not.toBeInTheDocument();
  });

  it('ofrece IA (con los valores precargados) y «A mano», NO «Del catálogo», y permite vincular; lo explica', async () => {
    await abrir(detalle(SOLO_CHAT));
    expect(screen.getByRole('radio', { name: /^IA/ })).toBeChecked();
    expect(screen.getByRole('radio', { name: /^A mano/ })).toBeInTheDocument();
    expect(screen.queryByRole('radio', { name: /^Del catálogo/ })).not.toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /Vincular con un alimento existente/ })).toBeInTheDocument();
    expect(screen.getByText(/lo estimó el chat, sin foto/)).toBeInTheDocument();
    expect(screen.queryByText(/se cargó manualmente, sin foto/)).not.toBeInTheDocument();
  });

  it('el investigador valida con los valores de la IA; la confirmación cuenta los ítems del chat', async () => {
    vi.mocked(validarPendienteAction).mockResolvedValue({ ok: true, idAlimento: null, itemsAfectados: 0 });
    const user = await abrir(detalle(SOLO_CHAT));
    await user.click(screen.getByRole('button', { name: 'Validar' }));
    expect(screen.getByRole('alertdialog')).toHaveTextContent('Se actualizarán 2 ítems del diario');
    await user.click(screen.getByRole('button', { name: 'Confirmar' }));
    expect(validarPendienteAction).toHaveBeenCalledWith(
      expect.objectContaining({ id: 9, nombre: 'Empanada de carne', kcal: 250, proteinas: 10.5, grasas: 11, carbs: 27 }),
    );
  });

  it('también puede cargar los 4 valores a mano', async () => {
    vi.mocked(validarPendienteAction).mockResolvedValue({ ok: true, idAlimento: null, itemsAfectados: 0 });
    const user = await abrir(detalle(SOLO_CHAT));
    await user.click(screen.getByRole('radio', { name: /^A mano/ }));
    const kcal = screen.getByLabelText('Energía en kcal por 100 g');
    await user.clear(kcal);
    await user.type(kcal, '300');
    await user.click(screen.getByRole('button', { name: 'Validar' }));
    await user.click(screen.getByRole('button', { name: 'Confirmar' }));
    expect(validarPendienteAction).toHaveBeenCalledWith(expect.objectContaining({ id: 9, kcal: 300 }));
  });

  it('descartar cuenta los ítems del chat, no los borra y manda el motivo', async () => {
    vi.mocked(descartarPendienteAction).mockResolvedValue({ ok: true, itemsAfectados: 0 });
    const user = await abrir(detalle(SOLO_CHAT));
    await user.click(screen.getByRole('button', { name: /Más datos/ }));
    await user.type(screen.getByLabelText('Observaciones'), 'No es un alimento');
    await user.click(screen.getByRole('button', { name: 'Descartar' }));
    expect(screen.getByRole('alertdialog')).toHaveTextContent('2 ítems quedarán marcados como descartados');
    expect(screen.getByRole('alertdialog')).toHaveTextContent('Los ítems no se borran');
    await user.click(screen.getByRole('button', { name: 'Confirmar' }));
    expect(descartarPendienteAction).toHaveBeenCalledWith({ id: 9, observaciones: 'No es un alimento' });
  });
});

describe('/validacion — entradas mixtas con chat', () => {
  beforeEach(() => vi.clearAllMocks());

  it('foto + chat: muestra las dos secciones y conserva los tres métodos (incluida la mezcla «Del catálogo»)', async () => {
    const mixta = { ...PENDIENTE, ocurrencias_chat: 2, usuarios_distintos: 4 };
    vi.mocked(getPendienteDetalleAction).mockResolvedValue(
      detalle(mixta, { ocurrencias: [OCURRENCIA], totalOcurrencias: 2, solicitudesChat: SOLICITUDES_CHAT, totalSolicitudesChat: 2 }),
    );
    render(<PendienteDetalle idPendiente={5} onClose={vi.fn()} onResuelto={vi.fn()} onGuardado={vi.fn()} />);
    await screen.findByLabelText('Nombre');
    expect(screen.getByRole('region', { name: 'Dónde apareció' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Estimado por el chat' })).toBeInTheDocument();
    for (const m of [/^IA/, /^Del catálogo/, /^A mano/]) expect(screen.getByRole('radio', { name: m })).toBeInTheDocument();
    expect(screen.queryByRole('radio', { name: /Vincular con un alimento existente/ })).not.toBeInTheDocument();
  });

  it('manual + chat sin foto: muestra ambas secciones, la frase del chat con «también se cargó manualmente» y cuenta todos los ítems', async () => {
    vi.mocked(validarPendienteAction).mockResolvedValue({ ok: true, idAlimento: null, itemsAfectados: 0 });
    const user = await abrir(
      detalle({ ...SOLO_CHAT, origen: 'manual', ocurrencias_manuales: 1 }, { solicitudesManuales: MANUALES, totalSolicitudesManuales: 1 }),
    );
    expect(screen.getByRole('region', { name: 'Cargado manualmente' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Estimado por el chat' })).toBeInTheDocument();
    expect(screen.getByText(/lo estimó el chat y también se cargó manualmente, sin foto/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Validar' }));
    expect(screen.getByRole('alertdialog')).toHaveTextContent('Se actualizarán 3 ítems del diario');
  });
});

describe('no regresión — foto y carga manual', () => {
  beforeEach(() => vi.clearAllMocks());

  it('una entrada solo manual sigue limitada a «A mano» (sin IA, aunque la fila traiga valores de IA ausentes) y con su frase', async () => {
    const soloManual = {
      ...PENDIENTE, id_pendiente: 8, nombre_original: 'Tarta casera', nombre_normalizado: 'tarta casera', origen: 'manual' as const,
      gemini_kcal_100g: null, gemini_proteinas_100g: null, gemini_grasas_100g: null, gemini_carbs_100g: null, categoria_ia: null,
      ocurrencias: 0, ocurrencias_manuales: 1, usuarios_distintos: 1,
    };
    await abrir(detalle(soloManual, { solicitudesManuales: MANUALES, totalSolicitudesManuales: 1, solicitudesChat: [], totalSolicitudesChat: 0 }));
    expect(screen.getByRole('radio', { name: /^A mano/ })).toBeChecked();
    expect(screen.queryByRole('radio', { name: /^IA/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('radio', { name: /^Del catálogo/ })).not.toBeInTheDocument();
    expect(screen.getByText(/se cargó manualmente, sin foto/)).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Estimado por el chat' })).not.toBeInTheDocument();
    cleanup();
  });

  it('una entrada de foto sin chat no muestra la sección del chat y mantiene los tres métodos', async () => {
    vi.mocked(getPendienteDetalleAction).mockResolvedValue(
      detalle(PENDIENTE, { ocurrencias: [OCURRENCIA], totalOcurrencias: 2, solicitudesChat: [], totalSolicitudesChat: 0 }),
    );
    render(<PendienteDetalle idPendiente={5} onClose={vi.fn()} onResuelto={vi.fn()} onGuardado={vi.fn()} />);
    await screen.findByLabelText('Nombre');
    expect(screen.queryByRole('region', { name: 'Estimado por el chat' })).not.toBeInTheDocument();
    for (const m of [/^IA/, /^Del catálogo/, /^A mano/]) expect(screen.getByRole('radio', { name: m })).toBeInTheDocument();
  });
});
