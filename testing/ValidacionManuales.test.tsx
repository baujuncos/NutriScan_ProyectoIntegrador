/**
 * NUT-192 / NUT-194 — /validacion con entradas de carga manual (sin foto) y mixtas (IA + manual):
 * origen y usuarios distintos en el listado, sección de solicitudes sin foto, mezcla «Del catálogo»
 * solo con ocurrencias con foto y aviso no bloqueante si el nombre ya existe en SARA2/ANMAT.
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
  getPendienteDetalleAction,
  validarPendienteAction,
  type SolicitudManual,
} from '@/app/(researcher)/validacion/actions';
import { parseParams } from '@/lib/validacionQuery';
import { OCURRENCIA, PENDIENTE } from './fixtures/validacion';

const SOLO_MANUAL = {
  ...PENDIENTE,
  id_pendiente: 8,
  nombre_original: 'Tarta casera',
  nombre_normalizado: 'tarta casera',
  gemini_kcal_100g: null,
  gemini_proteinas_100g: null,
  gemini_grasas_100g: null,
  gemini_carbs_100g: null,
  gemini_modelo: null,
  categoria_ia: null,
  origen: 'manual' as const,
  ocurrencias: 0,
  ultima_ocurrencia: null,
  ocurrencias_manuales: 3,
  usuarios_distintos: 2,
};

const SOLICITUDES: SolicitudManual[] = [
  { idItem: 1, fecha: '2026-10-06', deportista: 'Ana Pérez', nombre: 'Tarta casera', gramos: 150 },
  { idItem: 2, fecha: '2026-10-05', deportista: 'Juan Gómez', nombre: 'tarta CASERA de verduras', gramos: 200 },
];

const detalle = (pendiente: typeof PENDIENTE | typeof SOLO_MANUAL, extra: Record<string, unknown> = {}) => ({
  ok: true as const,
  pendiente,
  ocurrencias: pendiente.ocurrencias > 0 ? [OCURRENCIA] : [],
  totalOcurrencias: pendiente.ocurrencias,
  propio: null,
  solicitudesManuales: SOLICITUDES,
  totalSolicitudesManuales: pendiente.ocurrencias_manuales,
  existentesCatalogo: [],
  ...extra,
});

async function abrir(d: ReturnType<typeof detalle>) {
  vi.mocked(getPendienteDetalleAction).mockResolvedValue(d);
  const user = userEvent.setup();
  render(<PendienteDetalle idPendiente={d.pendiente.id_pendiente} onClose={vi.fn()} onResuelto={vi.fn()} onGuardado={vi.fn()} />);
  await screen.findByLabelText('Nombre');
  return user;
}

describe('/validacion — listado con entradas manuales', () => {
  const render_ = (rows: Array<typeof PENDIENTE | typeof SOLO_MANUAL>) =>
    render(<ValidacionClient rows={rows as never} total={rows.length} params={parseParams({})} />);

  it('una entrada creada manualmente muestra la marca "Manual", sus solicitudes y los usuarios distintos', () => {
    render_([SOLO_MANUAL]);
    const fila = screen.getByRole('listitem', { name: /Tarta casera/ });
    expect(within(fila).getByText('Manual')).toBeInTheDocument();
    expect(within(fila).getByText('3 manuales')).toBeInTheDocument();
    expect(within(fila).getByText('2 usuarios')).toBeInTheDocument();
  });

  it('una entrada de IA sin cargas manuales se ve como antes (sin marca ni "+N manual")', () => {
    render_([PENDIENTE]);
    const fila = screen.getByRole('listitem', { name: /Flan casero/ });
    expect(within(fila).queryByText('Manual')).not.toBeInTheDocument();
    expect(within(fila).queryByText(/manual/i)).not.toBeInTheDocument();
    expect(within(fila).getByText('2')).toBeInTheDocument();
  });

  it('una entrada mixta (creada por IA, con cargas manuales posteriores) muestra ambas cifras', () => {
    render_([{ ...PENDIENTE, ocurrencias_manuales: 2, usuarios_distintos: 3 }]);
    const fila = screen.getByRole('listitem', { name: /Flan casero/ });
    expect(within(fila).queryByText('Manual')).not.toBeInTheDocument(); // se creó por IA
    expect(within(fila).getByText('2')).toBeInTheDocument();
    expect(within(fila).getByText('+2 manuales')).toBeInTheDocument();
    expect(within(fila).getByText('3 usuarios')).toBeInTheDocument();
  });

  it('1 solo usuario va en singular', () => {
    render_([{ ...SOLO_MANUAL, usuarios_distintos: 1 }]);
    expect(screen.getByText('1 usuario')).toBeInTheDocument();
  });
});

describe('/validacion — columna Ocurrencias', () => {
  const celda = (row: Record<string, unknown>) => {
    render(<ValidacionClient rows={[row] as never} total={1} params={parseParams({})} />);
    const fila = screen.getByRole('listitem');
    return Array.from(fila.querySelectorAll('span.text-sm.text-slate-700'))[0] as HTMLElement;
  };

  it('solo IA: el número de ocurrencias, sin líneas de manuales (idéntico a antes)', () => {
    const c = celda({ ...PENDIENTE, ocurrencias: 2, ocurrencias_manuales: 0, usuarios_distintos: 2 });
    expect(c).toHaveTextContent('Ocurrencias: 2');
    expect(within(c).queryByText(/manual/)).not.toBeInTheDocument();
    expect(within(c).getByText('2 usuarios')).toBeInTheDocument();
  });

  it('mixta: conserva el número de ocurrencias con foto y la línea "+N manual(es)" debajo', () => {
    const c = celda({ ...PENDIENTE, ocurrencias: 2, ocurrencias_manuales: 1, usuarios_distintos: 3 });
    expect(c).toHaveTextContent('Ocurrencias: 2');
    expect(within(c).getByText('+1 manual')).toBeInTheDocument();
    cleanup();
    const c2 = celda({ ...PENDIENTE, ocurrencias: 5, ocurrencias_manuales: 3, usuarios_distintos: 3 });
    expect(c2).toHaveTextContent('Ocurrencias: 5');
    expect(within(c2).getByText('+3 manuales')).toBeInTheDocument();
  });

  it('solo manual: únicamente "N manual(es)", sin el 0 ni la línea "+N"', () => {
    const c = celda({ ...SOLO_MANUAL, ocurrencias_manuales: 1, usuarios_distintos: 1 });
    expect(c).toHaveTextContent('Ocurrencias: 1 manual');
    expect(within(c).getByText('1 manual')).toBeInTheDocument();
    expect(c).not.toHaveTextContent(/\b0\b/);
    expect(within(c).queryByText(/^\+/)).not.toBeInTheDocument();
    cleanup();
    const c2 = celda({ ...SOLO_MANUAL, ocurrencias_manuales: 2, usuarios_distintos: 2 });
    expect(within(c2).getByText('2 manuales')).toBeInTheDocument();
    expect(c2).not.toHaveTextContent(/\b0\b/);
  });
});

describe('/validacion — detalle de una entrada solo manual', () => {
  beforeEach(() => vi.clearAllMocks());

  it('muestra las solicitudes sin foto y no la sección "Dónde apareció"', async () => {
    await abrir(detalle(SOLO_MANUAL));
    const sec = screen.getByRole('region', { name: 'Cargado manualmente' });
    expect(within(sec).getByText(/3 solicitudes/)).toBeInTheDocument();
    expect(within(sec).getByText(/Lo pidieron 2 usuarios/)).toBeInTheDocument();
    expect(within(sec).getByText('Ana Pérez')).toBeInTheDocument();
    expect(within(sec).getByText(/Escribió «tarta CASERA de verduras» · 200 g/)).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Dónde apareció' })).not.toBeInTheDocument();
    expect(screen.queryByAltText(/Foto del plato/)).not.toBeInTheDocument();
  });

  it('se limita a «A mano»: no ofrece IA ni «Del catálogo» y lo explica', async () => {
    await abrir(detalle(SOLO_MANUAL));
    expect(screen.getByRole('radio', { name: /^A mano/ })).toBeChecked();
    expect(screen.queryByRole('radio', { name: /^Del catálogo/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('radio', { name: /^IA/ })).not.toBeInTheDocument();
    expect(screen.getByText(/se cargó manualmente, sin foto/)).toBeInTheDocument();
  });

  it('el investigador puede validar cargando los 4 valores; la confirmación cuenta las solicitudes manuales', async () => {
    vi.mocked(validarPendienteAction).mockResolvedValue({ ok: true, idAlimento: null, itemsAfectados: 0 });
    const user = await abrir(detalle(SOLO_MANUAL));
    await user.type(screen.getByLabelText('Energía en kcal por 100 g'), '200');
    await user.type(screen.getByLabelText('Proteínas en gramos por 100 g'), '5');
    await user.type(screen.getByLabelText('Carbohidratos en gramos por 100 g'), '30');
    await user.type(screen.getByLabelText('Grasas en gramos por 100 g'), '6');
    await user.click(screen.getByRole('button', { name: 'Validar' }));
    expect(screen.getByRole('alertdialog')).toHaveTextContent('Se actualizarán 3 ítems del diario');
    await user.click(screen.getByRole('button', { name: 'Confirmar' }));
    expect(validarPendienteAction).toHaveBeenCalledWith(
      expect.objectContaining({ id: 8, nombre: 'Tarta casera', kcal: 200, proteinas: 5, carbs: 30, grasas: 6 }),
    );
  });

  it('descartar cuenta las solicitudes manuales y manda el motivo opcional', async () => {
    const { descartarPendienteAction } = await import('@/app/(researcher)/validacion/actions');
    vi.mocked(descartarPendienteAction).mockResolvedValue({ ok: true, itemsAfectados: 0 });
    const user = await abrir(detalle(SOLO_MANUAL));
    await user.click(screen.getByRole('button', { name: /Más datos/ }));
    await user.type(screen.getByLabelText('Observaciones'), 'No es un alimento');
    await user.click(screen.getByRole('button', { name: 'Descartar' }));
    expect(screen.getByRole('alertdialog')).toHaveTextContent('3 ítems quedarán marcados como descartados');
    await user.click(screen.getByRole('button', { name: 'Confirmar' }));
    expect(descartarPendienteAction).toHaveBeenCalledWith({ id: 8, observaciones: 'No es un alimento' });
  });
});

describe('/validacion — detalle de una entrada mixta (con foto y manual)', () => {
  beforeEach(() => vi.clearAllMocks());
  const MIXTA = { ...PENDIENTE, ocurrencias_manuales: 2, usuarios_distintos: 3 };

  it('muestra las comidas con foto Y las solicitudes manuales, sin romperse', async () => {
    await abrir(detalle(MIXTA));
    expect(screen.getByRole('region', { name: 'Dónde apareció' })).toBeInTheDocument();
    expect(screen.getByAltText(/Foto del plato de Ana Pérez/)).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Cargado manualmente' })).toBeInTheDocument();
  });

  it('conserva los tres métodos: «Del catálogo» sigue disponible porque hay una foto de referencia', async () => {
    await abrir(detalle(MIXTA));
    expect(screen.getByRole('radio', { name: /^Del catálogo/ })).toBeEnabled();
    expect(screen.getByRole('radio', { name: /^IA/ })).toBeEnabled();
    expect(screen.getByRole('radio', { name: /^A mano/ })).toBeEnabled();
    expect(screen.queryByText(/se cargó manualmente, sin foto/)).not.toBeInTheDocument();
  });

  it('la confirmación suma los ítems con foto y los manuales (2 + 2)', async () => {
    const user = await abrir(detalle(MIXTA));
    await user.click(screen.getByRole('button', { name: 'Validar' }));
    expect(screen.getByRole('alertdialog')).toHaveTextContent('Se actualizarán 4 ítems del diario');
  });
});

describe('/validacion — entrada de IA sin cargas manuales (no regresión)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('se ve como siempre: sin sección manual y con los tres métodos', async () => {
    await abrir(detalle(PENDIENTE, { solicitudesManuales: [], totalSolicitudesManuales: 0 }));
    expect(screen.queryByRole('region', { name: 'Cargado manualmente' })).not.toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Dónde apareció' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /^IA/ })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /^Del catálogo/ })).toBeInTheDocument();
  });

  it('una respuesta sin los campos nuevos (versión anterior de la acción) tampoco rompe', async () => {
    vi.mocked(getPendienteDetalleAction).mockResolvedValue({ ok: true, pendiente: PENDIENTE, ocurrencias: [OCURRENCIA], totalOcurrencias: 2, propio: null });
    render(<PendienteDetalle idPendiente={5} onClose={vi.fn()} onResuelto={vi.fn()} />);
    await screen.findByLabelText('Nombre');
    expect(screen.queryByRole('region', { name: 'Cargado manualmente' })).not.toBeInTheDocument();
  });
});

describe('/validacion — aviso de nombre ya existente en SARA2/ANMAT', () => {
  beforeEach(() => vi.clearAllMocks());
  const EXISTENTES = [
    { origen: 'catalogo' as const, id: 10, nombre: 'Tarta de verdura', fuente: 'SARA2' },
    { origen: 'catalogo' as const, id: 1000010, nombre: 'Tarta casera', fuente: 'ANMAT' },
  ];

  it('muestra el aviso, lista los existentes y NO bloquea validar', async () => {
    const user = await abrir(detalle(SOLO_MANUAL, { existentesCatalogo: EXISTENTES }));
    const aviso = screen.getByRole('note');
    expect(aviso).toHaveTextContent('«Tarta de verdura» (SARA2), «Tarta casera» (ANMAT)');
    expect(aviso).toHaveTextContent('No te impide validar');
    await user.type(screen.getByLabelText('Energía en kcal por 100 g'), '200');
    await user.type(screen.getByLabelText('Proteínas en gramos por 100 g'), '5');
    await user.type(screen.getByLabelText('Carbohidratos en gramos por 100 g'), '30');
    await user.type(screen.getByLabelText('Grasas en gramos por 100 g'), '6');
    expect(screen.getByRole('button', { name: 'Validar' })).toBeEnabled();
  });

  it('en una entrada con foto sugiere usarlo desde «Del catálogo»', async () => {
    await abrir(detalle(PENDIENTE, { existentesCatalogo: EXISTENTES, solicitudesManuales: [], totalSolicitudesManuales: 0 }));
    expect(screen.getByRole('note')).toHaveTextContent('usalo desde «Del catálogo»');
  });

  it('sin coincidencias no aparece ningún aviso', async () => {
    await abrir(detalle(SOLO_MANUAL));
    expect(screen.queryByRole('note')).not.toBeInTheDocument();
  });
});
