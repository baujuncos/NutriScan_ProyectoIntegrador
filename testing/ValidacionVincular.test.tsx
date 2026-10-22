/**
 * NUT-225 — «Vincular con un alimento existente» en /validacion: solo para entradas SOLO manuales.
 * Las entradas con foto y las mixtas no lo ofrecen y se comportan como siempre.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
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
vi.mock('@/app/alimentacion/actions', () => ({ searchAlimentosAction: vi.fn() }));

import PendienteDetalle from '@/app/(researcher)/validacion/PendienteDetalle';
import { getPendienteDetalleAction, validarPendienteAction, validarComoPropioAction } from '@/app/(researcher)/validacion/actions';
import { searchAlimentosAction } from '@/app/alimentacion/actions';
import { OCURRENCIA, PENDIENTE } from './fixtures/validacion';

const SOLO_MANUAL = {
  ...PENDIENTE,
  id_pendiente: 8,
  nombre_original: 'barra kinder',
  nombre_normalizado: 'barra kinder',
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
const MIXTA = { ...PENDIENTE, ocurrencias_manuales: 2, usuarios_distintos: 3 };

const base = { categoria: null, marca: null, denominacion: null };
const BARRITA: ReturnType<typeof alimento> = { id_alimento: 2000001, fuente: 'VALIDADO', nombre: 'Barrita kinder', ...{ kcal_100g: 560, proteinas_100g: 8.7, grasas_100g: 35, carbs_100g: 53 }, ...base };
function alimento(over: Record<string, unknown> = {}) {
  return { id_alimento: 1, nombre: 'Arroz', fuente: 'SARA2', kcal_100g: 130, proteinas_100g: 2.7, grasas_100g: 0.3, carbs_100g: 28, ...base, ...over };
}
const INCOMPLETO = alimento({ id_alimento: 99, nombre: 'Barra de cereal sin datos', fuente: 'ANMAT', kcal_100g: 380, proteinas_100g: null });
const CERO = alimento({ id_alimento: 50, nombre: 'Agua mineral', fuente: 'SARA2', kcal_100g: 0, proteinas_100g: 0, grasas_100g: 0, carbs_100g: 0 });

const detalle = (pendiente: typeof PENDIENTE | typeof SOLO_MANUAL, extra: Record<string, unknown> = {}) => ({
  ok: true as const,
  pendiente,
  ocurrencias: pendiente.ocurrencias > 0 ? [OCURRENCIA] : [],
  totalOcurrencias: pendiente.ocurrencias,
  propio: null,
  solicitudesManuales: [{ idItem: 1, fecha: '2026-10-06', deportista: 'Ana Pérez', nombre: 'barra kinder', gramos: 40 }],
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
const radioVincular = () => screen.queryByRole('radio', { name: /^Vincular con un alimento existente/ });

async function buscar(user: ReturnType<typeof userEvent.setup>, texto: string, resultados: unknown[]) {
  vi.mocked(searchAlimentosAction).mockResolvedValue(resultados as never);
  await user.type(screen.getByLabelText('Buscar un alimento existente'), texto);
  // La búsqueda tiene debounce de 300 ms: se espera a que se dispare la del texto completo.
  await waitFor(() => expect(searchAlimentosAction).toHaveBeenCalledWith(texto, ''), { timeout: 1500 });
}

describe('«Vincular con un alimento existente» — cuándo se ofrece', () => {
  beforeEach(() => vi.clearAllMocks());

  it('aparece en una entrada solo manual, junto a «A mano» (que sigue ahí)', async () => {
    await abrir(detalle(SOLO_MANUAL));
    expect(radioVincular()).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /^A mano/ })).toBeChecked();
    expect(radioVincular()).not.toBeChecked();
  });

  it('NO aparece en una entrada con foto (IA / Del catálogo / A mano como siempre)', async () => {
    await abrir(detalle(PENDIENTE, { solicitudesManuales: [], totalSolicitudesManuales: 0 }));
    expect(radioVincular()).not.toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /^IA/ })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /^Del catálogo/ })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /^A mano/ })).toBeInTheDocument();
  });

  it('NO aparece en una entrada mixta (con foto y manual): conserva sus tres métodos', async () => {
    await abrir(detalle(MIXTA));
    expect(radioVincular()).not.toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /^Del catálogo/ })).toBeEnabled();
  });

  it('NO aparece en una entrada solo manual ya resuelta (solo lectura)', async () => {
    await abrir(detalle({ ...SOLO_MANUAL, estado: 'validado' as never, resuelto_at: '2026-10-07T12:00:00Z' }));
    expect(radioVincular()).not.toBeInTheDocument();
  });

  it('«A mano» no cambia: sigue con sus 4 campos y su comportamiento', async () => {
    const user = await abrir(detalle(SOLO_MANUAL));
    expect(screen.getByLabelText('Energía en kcal por 100 g')).toBeInTheDocument();
    await user.click(radioVincular()!);
    expect(screen.queryByLabelText('Energía en kcal por 100 g')).not.toBeInTheDocument();
    await user.click(screen.getByRole('radio', { name: /^A mano/ }));
    expect(screen.getByLabelText('Energía en kcal por 100 g')).toBeInTheDocument();
    expect(radioVincular()).not.toBeChecked();
  });
});

describe('«Vincular con un alimento existente» — el selector', () => {
  beforeEach(() => vi.clearAllMocks());

  it('busca con searchAlimentosAction, muestra fuente y valores por 100 g y deja elegir UN alimento (VALIDADO incluido)', async () => {
    const user = await abrir(detalle(SOLO_MANUAL));
    await user.click(radioVincular()!);
    await buscar(user, 'barrita', [BARRITA, alimento()]);
    expect(searchAlimentosAction).toHaveBeenCalledWith('barrita', '');
    const opcion = await screen.findByRole('button', { name: 'Vincular con Barrita kinder' });
    expect(within(opcion).getByText('VALIDADO')).toBeInTheDocument();
    expect(opcion).toHaveTextContent('560 kcal · P 8,7 · C 53 · G 35');
    await user.click(opcion);
    const elegido = screen.getByRole('region', { name: 'Alimento elegido' });
    expect(within(elegido).getByText('Barrita kinder')).toBeInTheDocument();
    expect(within(elegido).getByText('VALIDADO')).toBeInTheDocument();
  });

  it('bloquea un alimento al que le falta algún valor y explica por qué', async () => {
    const user = await abrir(detalle(SOLO_MANUAL));
    await user.click(radioVincular()!);
    await buscar(user, 'barra', [INCOMPLETO]);
    const opcion = await screen.findByRole('button', { name: 'Vincular con Barra de cereal sin datos' });
    expect(opcion).toBeDisabled();
    expect(opcion).toHaveTextContent('Sin sus 4 valores nutricionales cargados: no se puede vincular.');
    await user.click(opcion);
    expect(screen.queryByRole('region', { name: 'Alimento elegido' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Validar' })).toBeDisabled();
  });

  it('un valor 0 legítimo no se bloquea (agua: todo en 0)', async () => {
    const user = await abrir(detalle(SOLO_MANUAL));
    await user.click(radioVincular()!);
    await buscar(user, 'agua', [CERO]);
    const opcion = await screen.findByRole('button', { name: 'Vincular con Agua mineral' });
    expect(opcion).toBeEnabled();
    await user.click(opcion);
    expect(screen.getByRole('region', { name: 'Alimento elegido' })).toHaveTextContent('0 kcal · P 0 · C 0 · G 0');
  });

  it('permite cambiar el alimento elegido', async () => {
    const user = await abrir(detalle(SOLO_MANUAL));
    await user.click(radioVincular()!);
    await buscar(user, 'barrita', [BARRITA]);
    await user.click(await screen.findByRole('button', { name: 'Vincular con Barrita kinder' }));
    await user.click(screen.getByRole('button', { name: 'Elegir otro alimento' }));
    expect(screen.getByLabelText('Buscar un alimento existente')).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Alimento elegido' })).not.toBeInTheDocument();
  });

  it('avisa si no hay resultados', async () => {
    const user = await abrir(detalle(SOLO_MANUAL));
    await user.click(radioVincular()!);
    await buscar(user, 'zzzz', []);
    expect(await screen.findByText('No encontré alimentos con ese nombre.')).toBeInTheDocument();
  });
});

describe('«Vincular con un alimento existente» — validar', () => {
  beforeEach(() => vi.clearAllMocks());

  async function vincular(user: ReturnType<typeof userEvent.setup>, a = BARRITA) {
    await user.click(radioVincular()!);
    await buscar(user, 'barrita', [a]);
    await user.click(await screen.findByRole('button', { name: `Vincular con ${a.nombre}` }));
  }

  it('sin elegir alimento no se puede validar y el pie lo explica', async () => {
    const user = await abrir(detalle(SOLO_MANUAL));
    await user.click(radioVincular()!);
    expect(screen.getByRole('button', { name: 'Validar' })).toBeDisabled();
    expect(screen.getByRole('status', { name: 'Estado de la validación' })).toHaveTextContent('Elegí el alimento con el que vincular');
  });

  it('con un alimento elegido muestra el resultado con sus valores y habilita Validar', async () => {
    const user = await abrir(detalle(SOLO_MANUAL));
    await vincular(user);
    const res = screen.getByRole('region', { name: 'Resultado por 100 g' });
    expect(res).toHaveTextContent('Vinculado');
    expect(res).toHaveTextContent('560');
    expect(screen.getByRole('button', { name: 'Validar' })).toBeEnabled();
  });

  it('la confirmación nombra el alimento, los ítems y los usuarios afectados', async () => {
    const user = await abrir(detalle(SOLO_MANUAL));
    await vincular(user);
    await user.click(screen.getByRole('button', { name: 'Validar' }));
    const dialogo = screen.getByRole('alertdialog');
    expect(dialogo).toHaveTextContent('Se actualizarán 3 ítems del diario');
    expect(dialogo).toHaveTextContent('vinculado a Barrita kinder');
    expect(dialogo).toHaveTextContent('Lo pidieron 2 usuarios');
    expect(dialogo).toHaveTextContent('conserva el nombre que escribió la persona');
    expect(dialogo).toHaveTextContent('No se puede deshacer');
  });

  it('confirma: llama a validarPendienteAction con idAlimentoExistente, SIN valores ni composición', async () => {
    vi.mocked(validarPendienteAction).mockResolvedValue({ ok: true, idAlimento: 2000001, itemsAfectados: 0 });
    const onResuelto = vi.fn();
    vi.mocked(getPendienteDetalleAction).mockResolvedValue(detalle(SOLO_MANUAL));
    const user = userEvent.setup();
    render(<PendienteDetalle idPendiente={8} onClose={vi.fn()} onResuelto={onResuelto} />);
    await screen.findByLabelText('Nombre');
    await vincular(user);
    await user.click(screen.getByRole('button', { name: 'Validar' }));
    await user.click(screen.getByRole('button', { name: 'Confirmar' }));

    await waitFor(() => expect(validarPendienteAction).toHaveBeenCalledTimes(1));
    const args = vi.mocked(validarPendienteAction).mock.calls[0][0] as Record<string, unknown>;
    expect(args).toEqual({ id: 8, nombre: 'barra kinder', categoria: null, observaciones: null, idAlimentoExistente: 2000001 });
    expect(args).not.toHaveProperty('kcal');
    expect(args).not.toHaveProperty('composicion');
    expect(validarComoPropioAction).not.toHaveBeenCalled();
    await waitFor(() => expect(onResuelto).toHaveBeenCalled());
  });

  it('si la acción falla muestra el error y no cierra', async () => {
    vi.mocked(validarPendienteAction).mockResolvedValue({ error: 'El alimento elegido no existe' });
    const onResuelto = vi.fn();
    vi.mocked(getPendienteDetalleAction).mockResolvedValue(detalle(SOLO_MANUAL));
    const user = userEvent.setup();
    render(<PendienteDetalle idPendiente={8} onClose={vi.fn()} onResuelto={onResuelto} />);
    await screen.findByLabelText('Nombre');
    await vincular(user);
    await user.click(screen.getByRole('button', { name: 'Validar' }));
    await user.click(screen.getByRole('button', { name: 'Confirmar' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('El alimento elegido no existe');
    expect(onResuelto).not.toHaveBeenCalled();
  });

  it('volver a «A mano» valida como siempre (con los 4 valores y composición manual), ignorando el alimento elegido', async () => {
    vi.mocked(validarPendienteAction).mockResolvedValue({ ok: true, idAlimento: null, itemsAfectados: 0 });
    const user = await abrir(detalle(SOLO_MANUAL));
    await vincular(user);
    await user.click(screen.getByRole('radio', { name: /^A mano/ }));
    await user.type(screen.getByLabelText('Energía en kcal por 100 g'), '200');
    await user.type(screen.getByLabelText('Proteínas en gramos por 100 g'), '5');
    await user.type(screen.getByLabelText('Carbohidratos en gramos por 100 g'), '30');
    await user.type(screen.getByLabelText('Grasas en gramos por 100 g'), '6');
    await user.click(screen.getByRole('button', { name: 'Validar' }));
    expect(screen.getByRole('alertdialog')).not.toHaveTextContent('vinculado a');
    await user.click(screen.getByRole('button', { name: 'Confirmar' }));
    const args = vi.mocked(validarPendienteAction).mock.calls[0][0] as Record<string, unknown>;
    expect(args).toMatchObject({ id: 8, kcal: 200, proteinas: 5, carbs: 30, grasas: 6, composicion: { modo: 'manual' } });
    expect(args).not.toHaveProperty('idAlimentoExistente');
  });

  it('el alimento elegido no se arrastra al abrir otra entrada', async () => {
    vi.mocked(getPendienteDetalleAction).mockResolvedValue(detalle(SOLO_MANUAL));
    const user = userEvent.setup();
    const { rerender } = render(<PendienteDetalle idPendiente={8} onClose={vi.fn()} onResuelto={vi.fn()} />);
    await screen.findByLabelText('Nombre');
    await vincular(user);
    expect(screen.getByRole('region', { name: 'Alimento elegido' })).toBeInTheDocument();

    vi.mocked(getPendienteDetalleAction).mockResolvedValue(detalle({ ...SOLO_MANUAL, id_pendiente: 9, nombre_original: 'otra barra', nombre_final: null }));
    rerender(<PendienteDetalle idPendiente={9} onClose={vi.fn()} onResuelto={vi.fn()} />);
    await waitFor(() => expect(screen.getByLabelText('Nombre')).toHaveValue('otra barra'));
    expect(radioVincular()).not.toBeChecked();
    expect(screen.queryByRole('region', { name: 'Alimento elegido' })).not.toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /^A mano/ })).toBeChecked();
  });
});
