/**
 * NUT-119 — Detalle de un alimento de la cola: contexto, formulario con vista
 * previa, plausibilidad, confirmación, "buscar en catálogo" y errores.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('@/app/(researcher)/validacion/actions', () => ({
  getPendienteDetalleAction: vi.fn(),
  modificarPendienteAction: vi.fn(),
  validarPendienteAction: vi.fn(),
  descartarPendienteAction: vi.fn(),
}));
vi.mock('@/app/alimentacion/actions', () => ({ searchAlimentosAction: vi.fn() }));

import PendienteDetalle from '@/app/(researcher)/validacion/PendienteDetalle';
import {
  descartarPendienteAction,
  getPendienteDetalleAction,
  modificarPendienteAction,
  validarPendienteAction,
} from '@/app/(researcher)/validacion/actions';
import { searchAlimentosAction } from '@/app/alimentacion/actions';
import { OCURRENCIA, PENDIENTE } from './fixtures/validacion';

const detalle = (over: Partial<typeof PENDIENTE> = {}, ocurrencias = [OCURRENCIA]) =>
  ({ ok: true, pendiente: { ...PENDIENTE, ...over }, ocurrencias, totalOcurrencias: 2 }) as const;

async function abrir(over: Partial<typeof PENDIENTE> = {}, ocurrencias = [OCURRENCIA]) {
  vi.mocked(getPendienteDetalleAction).mockResolvedValue(detalle(over, ocurrencias));
  const onClose = vi.fn();
  const onResuelto = vi.fn();
  const user = userEvent.setup();
  render(<PendienteDetalle idPendiente={5} onClose={onClose} onResuelto={onResuelto} />);
  await screen.findByLabelText('Nombre');
  return { user, onClose, onResuelto };
}

beforeEach(() => {
  vi.mocked(getPendienteDetalleAction).mockReset();
  vi.mocked(modificarPendienteAction).mockReset().mockResolvedValue({ ok: true });
  vi.mocked(validarPendienteAction)
    .mockReset()
    .mockResolvedValue({ ok: true, idAlimento: null, itemsAfectados: 2 });
  vi.mocked(descartarPendienteAction).mockReset().mockResolvedValue({ ok: true, itemsAfectados: 2 });
  vi.mocked(searchAlimentosAction).mockReset().mockResolvedValue([]);
});

describe('PendienteDetalle — contexto', () => {
  it('muestra la foto con alt descriptivo y el recuadro del bbox en porcentajes', async () => {
    await abrir();
    expect(screen.getByAltText('Foto del plato de Ana Pérez, 6/10/2026')).toHaveAttribute(
      'src',
      'https://signed.example/1.jpg',
    );
    expect(screen.getByTestId('bbox')).toHaveStyle({ left: '10%', top: '20%', width: '30%', height: '40%' });
  });

  it('muestra nombre de la IA vs final, respuestas, gramaje IA vs final y deportista', async () => {
    await abrir();
    expect(screen.getByText('Postre blanco')).toBeInTheDocument();
    expect(screen.getByText('¿Qué es el postre?')).toBeInTheDocument();
    expect(screen.getByText('Flan')).toBeInTheDocument();
    expect(screen.getByText(/IA: 100 g/)).toBeInTheDocument();
    expect(screen.getByText(/final: 120 g/)).toBeInTheDocument();
    expect(screen.getByText('Ana Pérez')).toBeInTheDocument();
  });

  it('sin foto muestra un aviso en vez de la imagen', async () => {
    await abrir({}, [{ ...OCURRENCIA, fotoUrl: null, bbox: null }]);
    expect(screen.getByText(/Sin foto/)).toBeInTheDocument();
    expect(screen.queryByTestId('bbox')).not.toBeInTheDocument();
  });

  it('muestra los valores originales de Gemini (solo lectura) y el modelo', async () => {
    await abrir();
    const gem = screen.getByRole('region', { name: 'Estimación original de Gemini' });
    expect(within(gem).getByText(/150 kcal/)).toBeInTheDocument();
    expect(within(gem).getByText(/gemini-x/)).toBeInTheDocument();
  });

  it('si hay más ocurrencias de las que se listan dice "y N más"', async () => {
    vi.mocked(getPendienteDetalleAction).mockResolvedValue({ ...detalle(), totalOcurrencias: 25 });
    render(<PendienteDetalle idPendiente={5} onClose={vi.fn()} onResuelto={vi.fn()} />);
    expect(await screen.findByText(/y 24 más/)).toBeInTheDocument();
  });

  it('si la carga falla muestra el error', async () => {
    vi.mocked(getPendienteDetalleAction).mockResolvedValue({ error: 'Acceso denegado' });
    render(<PendienteDetalle idPendiente={5} onClose={vi.fn()} onResuelto={vi.fn()} />);
    expect(await screen.findByText('Acceso denegado')).toBeInTheDocument();
  });
});

describe('PendienteDetalle — formulario y vista previa', () => {
  it('precarga con los valores de Gemini cuando no hay finales', async () => {
    await abrir();
    expect(screen.getByLabelText('Nombre')).toHaveValue('Flan casero');
    expect(screen.getByLabelText('Categoría')).toHaveValue('postre');
    expect(screen.getByLabelText('kcal / 100 g')).toHaveValue(150);
  });

  it('precarga con los finales si el investigador ya guardó un borrador', async () => {
    await abrir({
      nombre_final: 'Flan de vainilla',
      final_kcal_100g: 160,
      final_proteinas_100g: 3,
      final_grasas_100g: 5,
      final_carbs_100g: 25,
    });
    expect(screen.getByLabelText('Nombre')).toHaveValue('Flan de vainilla');
    expect(screen.getByLabelText('kcal / 100 g')).toHaveValue(160);
  });

  it('editar kcal/100 g actualiza la vista previa del total para el gramaje de cada ocurrencia', async () => {
    const { user } = await abrir();
    const preview = screen.getByRole('region', { name: 'Vista previa por ocurrencia' });
    expect(within(preview).getByText(/180 kcal/)).toBeInTheDocument(); // 150 × 120 / 100
    const kcal = screen.getByLabelText('kcal / 100 g');
    await user.clear(kcal);
    await user.type(kcal, '200');
    expect(within(preview).getByText(/240 kcal/)).toBeInTheDocument();
  });

  it('avisa si los valores no son plausibles pero NO bloquea', async () => {
    const { user } = await abrir();
    const kcal = screen.getByLabelText('kcal / 100 g');
    await user.clear(kcal);
    await user.type(kcal, '800');
    expect(screen.getByText(/no parecen coherentes/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Validar' })).toBeEnabled();
  });

  it('"Guardar borrador" llama a modificar con los valores del formulario', async () => {
    const { user } = await abrir();
    await user.type(screen.getByLabelText('Observaciones'), 'revisar porción');
    await user.click(screen.getByRole('button', { name: 'Guardar borrador' }));
    expect(modificarPendienteAction).toHaveBeenCalledWith({
      id: 5,
      nombre: 'Flan casero',
      categoria: 'postre',
      kcal: 150,
      proteinas: 3,
      grasas: 5,
      carbs: 23,
      observaciones: 'revisar porción',
    });
    expect(await screen.findByText('Borrador guardado')).toBeInTheDocument();
  });
});

describe('PendienteDetalle — validar y descartar con confirmación', () => {
  it('Validar pide confirmación con la cantidad de ítems y recién ahí llama a la acción', async () => {
    const { user, onResuelto } = await abrir();
    await user.click(screen.getByRole('button', { name: 'Validar' }));
    expect(validarPendienteAction).not.toHaveBeenCalled();
    const confirm = screen.getByRole('alertdialog');
    expect(within(confirm).getByText(/2 ítems/)).toBeInTheDocument();

    await user.click(within(confirm).getByRole('button', { name: 'Confirmar' }));
    expect(validarPendienteAction).toHaveBeenCalledWith({
      id: 5,
      nombre: 'Flan casero',
      categoria: 'postre',
      kcal: 150,
      proteinas: 3,
      grasas: 5,
      carbs: 23,
      observaciones: null,
      idAlimentoExistente: null,
    });
    expect(onResuelto).toHaveBeenCalledTimes(1);
  });

  it('cancelar la confirmación no llama a nada', async () => {
    const { user } = await abrir();
    await user.click(screen.getByRole('button', { name: 'Descartar' }));
    await user.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Cancelar' }));
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(descartarPendienteAction).not.toHaveBeenCalled();
  });

  it('Descartar confirma, avisa que los ítems se conservan y llama a la acción', async () => {
    const { user, onResuelto } = await abrir();
    await user.click(screen.getByRole('button', { name: 'Descartar' }));
    const confirm = screen.getByRole('alertdialog');
    expect(within(confirm).getByText(/no se borran/i)).toBeInTheDocument();
    await user.click(within(confirm).getByRole('button', { name: 'Confirmar' }));
    expect(descartarPendienteAction).toHaveBeenCalledWith({ id: 5, observaciones: null });
    expect(onResuelto).toHaveBeenCalledTimes(1);
  });

  it('un error de la acción se muestra (aria-live) y no cierra', async () => {
    vi.mocked(validarPendienteAction).mockResolvedValue({
      error: 'Este alimento ya fue resuelto por otro investigador',
    });
    const { user, onResuelto } = await abrir();
    await user.click(screen.getByRole('button', { name: 'Validar' }));
    await user.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Confirmar' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('ya fue resuelto por otro investigador');
    expect(onResuelto).not.toHaveBeenCalled();
  });

  it('un alimento ya resuelto es de solo lectura (sin Validar/Descartar)', async () => {
    await abrir({ estado: 'validado' });
    expect(screen.queryByRole('button', { name: 'Validar' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Descartar' })).not.toBeInTheDocument();
    expect(screen.getByLabelText('Nombre')).toBeDisabled();
  });
});

describe('PendienteDetalle — buscar en catálogo', () => {
  it('elegir un alimento existente y validar manda idAlimentoExistente', async () => {
    vi.mocked(searchAlimentosAction).mockResolvedValue([
      { id_alimento: 77, nombre: 'Flan de vainilla', categoria: 'Postres', fuente: 'SARA2', marca: null, denominacion: null },
    ]);
    const { user } = await abrir();
    await user.type(screen.getByLabelText('Buscar en el catálogo'), 'flan');
    await user.click(await screen.findByRole('button', { name: /Flan de vainilla/ }));
    expect(screen.getByText(/Vinculado a: Flan de vainilla/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Validar' }));
    await user.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Confirmar' }));
    expect(validarPendienteAction).toHaveBeenCalledWith(expect.objectContaining({ id: 5, idAlimentoExistente: 77 }));
  });

  it('validar un alimento nuevo funciona aunque exista uno con el mismo nombre en el catálogo (no se inserta en `alimentos`)', async () => {
    vi.mocked(validarPendienteAction).mockResolvedValue({ ok: true, idAlimento: null, itemsAfectados: 2 });
    const { user, onResuelto } = await abrir();
    await user.click(screen.getByRole('button', { name: 'Validar' }));
    await user.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Confirmar' }));
    expect(onResuelto).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('button', { name: 'Vincular al existente' })).not.toBeInTheDocument();
  });
});

describe('PendienteDetalle — mezcla de varios alimentos ("Aceite y vinagre")', () => {
  const ACEITE = { id_alimento: 31, nombre: 'Aceite de oliva', categoria: 'aceites', fuente: 'SARA2', marca: null, denominacion: null, kcal_100g: 884, proteinas_100g: 0, grasas_100g: 100, carbs_100g: 0 };
  const VINAGRE = { id_alimento: 32, nombre: 'Vinagre de alcohol', categoria: 'aderezos', fuente: 'SARA2', marca: null, denominacion: null, kcal_100g: 19, proteinas_100g: 0, grasas_100g: 0, carbs_100g: 0.6 };

  async function agregarIngrediente(user: ReturnType<typeof userEvent.setup>, busqueda: string, nombre: string) {
    await user.type(screen.getByLabelText('Agregar ingrediente a la mezcla'), busqueda);
    await user.click(await screen.findByRole('button', { name: new RegExp(`Agregar ${nombre}`) }));
  }

  function mockBusqueda() {
    vi.mocked(searchAlimentosAction).mockImplementation(async (q: string) =>
      q.startsWith('acei') ? [ACEITE] : q.startsWith('vina') ? [VINAGRE] : [],
    );
  }

  it('se pueden sumar varios alimentos del catálogo, indicar los gramos de cada uno y ver los macros por 100 g de la mezcla', async () => {
    mockBusqueda();
    const { user } = await abrir();
    await agregarIngrediente(user, 'aceite', 'Aceite de oliva');
    await agregarIngrediente(user, 'vinagre', 'Vinagre de alcohol');

    await user.clear(screen.getByLabelText('Gramos de Aceite de oliva'));
    await user.type(screen.getByLabelText('Gramos de Aceite de oliva'), '70');
    await user.clear(screen.getByLabelText('Gramos de Vinagre de alcohol'));
    await user.type(screen.getByLabelText('Gramos de Vinagre de alcohol'), '30');

    const resultado = screen.getByRole('region', { name: 'Resultado de la mezcla' });
    expect(within(resultado).getByText(/624\.5 kcal/)).toBeInTheDocument(); // (884×70 + 19×30) / 100
    expect(within(resultado).getByText(/G 70 g/)).toBeInTheDocument();
  });

  it('"Usar estos valores" los vuelca al formulario (que sigue siendo editable) y suelta el vínculo a un alimento único', async () => {
    mockBusqueda();
    const { user } = await abrir();
    await agregarIngrediente(user, 'aceite', 'Aceite de oliva');
    await agregarIngrediente(user, 'vinagre', 'Vinagre de alcohol');
    await user.clear(screen.getByLabelText('Gramos de Aceite de oliva'));
    await user.type(screen.getByLabelText('Gramos de Aceite de oliva'), '70');
    await user.clear(screen.getByLabelText('Gramos de Vinagre de alcohol'));
    await user.type(screen.getByLabelText('Gramos de Vinagre de alcohol'), '30');

    await user.click(screen.getByRole('button', { name: 'Usar estos valores' }));

    expect(screen.getByLabelText('kcal / 100 g')).toHaveValue(624.5);
    expect(screen.getByLabelText('Grasas (g / 100 g)')).toHaveValue(70);
    expect(screen.getByLabelText('Carbohidratos (g / 100 g)')).toHaveValue(0.2);
    expect(screen.getByLabelText('Nombre')).toHaveValue('Flan casero'); // el nombre no se toca
    expect(screen.getByText(/Valores de la mezcla aplicados/)).toBeInTheDocument();

    // y se valida como un alimento NUEVO con esos valores (sin vincular a uno existente)
    await user.click(screen.getByRole('button', { name: 'Validar' }));
    await user.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Confirmar' }));
    expect(validarPendienteAction).toHaveBeenCalledWith(
      expect.objectContaining({ kcal: 624.5, grasas: 70, carbs: 0.2, idAlimentoExistente: null }),
    );
  });

  it('hacen falta al menos 2 ingredientes; con uno solo el botón está deshabilitado', async () => {
    mockBusqueda();
    const { user } = await abrir();
    await agregarIngrediente(user, 'aceite', 'Aceite de oliva');
    expect(screen.getByRole('button', { name: 'Usar estos valores' })).toBeDisabled();
    expect(screen.getByText(/al menos 2 ingredientes/i)).toBeInTheDocument();
  });

  it('se puede quitar un ingrediente, y un gramaje vacío o 0 bloquea el resultado', async () => {
    mockBusqueda();
    const { user } = await abrir();
    await agregarIngrediente(user, 'aceite', 'Aceite de oliva');
    await agregarIngrediente(user, 'vinagre', 'Vinagre de alcohol');

    await user.clear(screen.getByLabelText('Gramos de Vinagre de alcohol'));
    expect(screen.getByRole('button', { name: 'Usar estos valores' })).toBeDisabled();

    await user.click(screen.getByRole('button', { name: 'Quitar Vinagre de alcohol' }));
    expect(screen.queryByLabelText('Gramos de Vinagre de alcohol')).not.toBeInTheDocument();
  });

  it('un ingrediente sin datos nutricionales en el catálogo avisa y no permite usar la mezcla', async () => {
    vi.mocked(searchAlimentosAction).mockImplementation(async (q: string) =>
      q.startsWith('acei') ? [ACEITE] : q.startsWith('misterio') ? [{ ...VINAGRE, id_alimento: 99, nombre: 'Misterio', kcal_100g: null }] : [],
    );
    const { user } = await abrir();
    await agregarIngrediente(user, 'aceite', 'Aceite de oliva');
    await agregarIngrediente(user, 'misterio', 'Misterio');
    expect(screen.getByText(/Misterio no tiene datos nutricionales/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Usar estos valores' })).toBeDisabled();
  });

  it('un alimento ya resuelto (solo lectura) no muestra el armador de mezclas', async () => {
    await abrir({ estado: 'validado' });
    expect(screen.queryByLabelText('Agregar ingrediente a la mezcla')).not.toBeInTheDocument();
  });
});
