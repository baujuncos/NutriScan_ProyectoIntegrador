/**
 * NUT-119 — Detalle de un alimento de la cola: pestañas IA / Del catálogo / A mano,
 * borrador que restaura (incluida la composición), indicador de cambios, plausibilidad,
 * confirmación y errores.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('@/app/(researcher)/validacion/actions', () => ({
  getPendienteDetalleAction: vi.fn(),
  buscarAlimentosPropiosAction: vi.fn(),
  verificarAlimentoPropioAction: vi.fn(),
  validarComoPropioAction: vi.fn(),
  retirarAlimentoPropioAction: vi.fn(),
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
  buscarAlimentosPropiosAction,
  verificarAlimentoPropioAction,
  validarComoPropioAction,
  retirarAlimentoPropioAction,
  type PropioInfo,
} from '@/app/(researcher)/validacion/actions';
import { searchAlimentosAction } from '@/app/alimentacion/actions';
import { OCURRENCIA, PENDIENTE } from './fixtures/validacion';

const FOTO_20 = { ...OCURRENCIA, gramosFinal: 20 };
const ACEITE = { id_alimento: 31, nombre: 'Aceite de oliva', categoria: 'aceites', fuente: 'SARA2', marca: null, denominacion: null, kcal_100g: 800, proteinas_100g: 0, grasas_100g: 90, carbs_100g: 0 };
const VINAGRE = { id_alimento: 32, nombre: 'Vinagre de alcohol', categoria: 'aderezos', fuente: 'SARA2', marca: null, denominacion: null, kcal_100g: 20, proteinas_100g: 0, grasas_100g: 0, carbs_100g: 4 };
const IA_VACIA = { modo: 'ia', id_guardado_item: null, gramos_foto: null, componentes: [] };
const COMP_GUARDADA = {
  modo: 'catalogo',
  id_guardado_item: 1,
  gramos_foto: 20,
  componentes: [
    { origen: 'catalogo', id: 31, nombre: 'Aceite de oliva', fuente: 'SARA2', gramos: 15, kcal_100g: 800, proteinas_100g: 0, grasas_100g: 90, carbs_100g: 0 },
    { origen: 'catalogo', id: 32, nombre: 'Vinagre de alcohol', fuente: 'SARA2', gramos: 5, kcal_100g: 20, proteinas_100g: 0, grasas_100g: 0, carbs_100g: 4 },
  ],
};

const detalle = (over: Partial<typeof PENDIENTE> = {}, ocurrencias = [OCURRENCIA], propio: PropioInfo | null = null) =>
  ({ ok: true, pendiente: { ...PENDIENTE, ...over }, ocurrencias, totalOcurrencias: 2, propio }) as const;

async function abrir(over: Partial<typeof PENDIENTE> = {}, ocurrencias = [OCURRENCIA], propio: PropioInfo | null = null) {
  vi.mocked(getPendienteDetalleAction).mockResolvedValue(detalle(over, ocurrencias, propio));
  const onClose = vi.fn();
  const onResuelto = vi.fn();
  const onGuardado = vi.fn();
  const user = userEvent.setup();
  render(<PendienteDetalle idPendiente={5} onClose={onClose} onResuelto={onResuelto} onGuardado={onGuardado} />);
  await screen.findByLabelText('Nombre');
  return { user, onClose, onResuelto, onGuardado };
}

/** Los métodos (IA / Del catálogo / A mano) son tarjetas con un radio. */
const pestana = (nombre: string) => screen.getByRole('radio', { name: new RegExp(`^${nombre}`) });
const contexto = () => screen.getByRole('region', { name: 'Dónde apareció' });
const resultado = () => screen.getByRole('region', { name: 'Resultado por 100 g' });

async function agregar(user: ReturnType<typeof userEvent.setup>, busqueda: string, nombre: string) {
  await user.type(screen.getByLabelText('Agregar alimento del catálogo'), busqueda);
  await user.click(await screen.findByRole('button', { name: new RegExp(`Agregar ${nombre}`) }));
}

async function gramos(user: ReturnType<typeof userEvent.setup>, nombre: string, valor: string) {
  const campo = screen.getByLabelText(`Gramos de ${nombre}`);
  await user.clear(campo);
  await user.type(campo, valor);
}

async function confirmarValidar(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: 'Validar' }));
  await user.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Confirmar' }));
}

beforeEach(() => {
  vi.mocked(getPendienteDetalleAction).mockReset();
  vi.mocked(modificarPendienteAction).mockReset().mockResolvedValue({ ok: true });
  vi.mocked(validarPendienteAction)
    .mockReset()
    .mockResolvedValue({ ok: true, idAlimento: null, itemsAfectados: 2 });
  vi.mocked(buscarAlimentosPropiosAction).mockReset().mockResolvedValue([]);
  vi.mocked(verificarAlimentoPropioAction).mockReset().mockResolvedValue({ ok: true, bloqueos: [], advertencias: [] });
  vi.mocked(retirarAlimentoPropioAction).mockReset().mockResolvedValue({ ok: true });
  vi.mocked(validarComoPropioAction).mockReset().mockResolvedValue({ ok: true, idAlimentoPropio: 9, itemsAfectados: 2 });
  vi.mocked(descartarPendienteAction).mockReset().mockResolvedValue({ ok: true, itemsAfectados: 2 });
  vi.mocked(searchAlimentosAction)
    .mockReset()
    .mockImplementation(async (q: string) =>
      q.startsWith('acei') ? [ACEITE] : q.startsWith('vina') ? [VINAGRE] : [],
    );
});

describe('PendienteDetalle — contexto', () => {
  it('muestra la foto con alt descriptivo y el recuadro del bbox en porcentajes', async () => {
    await abrir();
    expect(screen.getByAltText('Foto del plato de Ana Pérez, 6/10/2026')).toHaveAttribute('src', 'https://signed.example/1.jpg');
    expect(screen.getByTestId('bbox')).toHaveStyle({ left: '10%', top: '20%', width: '30%', height: '40%' });
  });

  it('muestra nombre de la IA vs final, respuestas, gramaje IA vs final y deportista', async () => {
    await abrir();
    expect(screen.getByText('Postre blanco')).toBeInTheDocument();
    expect(screen.getByText('¿Qué es el postre?')).toBeInTheDocument();
    expect(screen.getByText('Flan')).toBeInTheDocument();
    expect(screen.getByText(/IA estimó 100 g/)).toBeInTheDocument();
    expect(screen.getByText(/Pesa 120 g en la foto/)).toBeInTheDocument();
    expect(within(contexto()).getByText('Ana Pérez')).toBeInTheDocument();
  });

  it('sin foto muestra un aviso en vez de la imagen', async () => {
    await abrir({}, [{ ...OCURRENCIA, fotoUrl: null, bbox: null }]);
    expect(screen.getByText(/Sin foto/)).toBeInTheDocument();
    expect(screen.queryByTestId('bbox')).not.toBeInTheDocument();
  });

  it('muestra los valores originales de Gemini (solo lectura) y el modelo', async () => {
    await abrir();
    const gem = screen.getByRole('region', { name: 'Estimación original de Gemini' });
    expect(within(gem).getByText('150 kcal')).toBeInTheDocument();
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

  it('marca cuál es la foto de referencia (la primera) y la usa sin que el investigador elija', async () => {
    const otra = { ...OCURRENCIA, idGuardadoItem: 2, gramosFinal: 60, deportista: 'Beto Gómez', esReferencia: false };
    const { user } = await abrir({}, [{ ...FOTO_20 }, otra]);
    expect(screen.getAllByText('Foto de referencia')).toHaveLength(1);
    expect(screen.getByText(/Pesa 20 g en la foto/)).toBeInTheDocument();
    expect(screen.queryByText(/Pesa 60 g en la foto/)).not.toBeInTheDocument(); // la otra comida va plegada
    await user.click(pestana('Del catálogo'));
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
  });

  it('sin una foto de referencia con peso, Del catálogo lo avisa y no deja validar', async () => {
    const { user } = await abrir({}, [{ ...FOTO_20, esReferencia: false }]);
    await user.click(pestana('Del catálogo'));
    await agregar(user, 'aceite', 'Aceite de oliva');
    expect(screen.getByText(/No hay una foto de referencia con peso/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Validar' })).toBeDisabled();
  });

  it('las otras comidas van plegadas bajo "Ver otras N comidas" y se pueden abrir', async () => {
    const otra = { ...OCURRENCIA, idGuardadoItem: 2, gramosFinal: 60, deportista: 'Beto Gómez', esReferencia: false };
    const { user } = await abrir({}, [{ ...FOTO_20 }, otra]);
    const boton = screen.getByRole('button', { name: /Ver otras 1 comida/ });
    expect(boton).toHaveAttribute('aria-expanded', 'false');
    expect(within(contexto()).queryByText('Beto Gómez')).not.toBeInTheDocument();
    await user.click(boton);
    expect(boton).toHaveAttribute('aria-expanded', 'true');
    expect(within(contexto()).getByText('Beto Gómez')).toBeInTheDocument();
    expect(screen.getByText(/Pesa 60 g en la foto/)).toBeInTheDocument();
  });

});

describe('PendienteDetalle — pestañas y apertura', () => {
  it('abre en IA cuando Gemini dio valores, con su explicación y el resultado', async () => {
    await abrir();
    expect(pestana('IA')).toBeChecked();
    expect(screen.getByText(/Estimación de Gemini\. Revisala antes de usarla/)).toBeInTheDocument();
    expect(within(resultado()).getByText('150')).toBeInTheDocument();
  });

  it('abre en A mano cuando Gemini no pudo estimar', async () => {
    await abrir({ gemini_kcal_100g: null, gemini_proteinas_100g: null, gemini_grasas_100g: null, gemini_carbs_100g: null });
    expect(pestana('A mano')).toBeChecked();
    expect(screen.getByRole('button', { name: 'Validar' })).toBeDisabled();
  });

  it('un borrador viejo sin composición (sólo valores finales) abre en A mano con esos valores', async () => {
    await abrir({ nombre_final: 'Flan de vainilla', final_kcal_100g: 160, final_proteinas_100g: 3, final_grasas_100g: 5, final_carbs_100g: 25 });
    expect(pestana('A mano')).toBeChecked();
    expect(screen.getByLabelText('Nombre')).toHaveValue('Flan de vainilla');
    expect(screen.getByLabelText('Energía en kcal por 100 g')).toHaveValue(160);
  });

  it('un borrador con composición abre en Del catálogo con sus ingredientes y gramos', async () => {
    await abrir({ composicion: COMP_GUARDADA, final_kcal_100g: 605, final_proteinas_100g: 0, final_grasas_100g: 67.5, final_carbs_100g: 1 }, [FOTO_20]);
    expect(pestana('Del catálogo')).toBeChecked();
    expect(screen.getByLabelText('Gramos de Aceite de oliva')).toHaveValue(15);
    expect(screen.getByLabelText('Gramos de Vinagre de alcohol')).toHaveValue(5);
    expect(within(resultado()).getByText('605')).toBeInTheDocument();
  });

  it('una composición corrupta no rompe la pantalla (abre como un borrador común)', async () => {
    await abrir({ composicion: { modo: 'raro' } });
    expect(pestana('IA')).toBeChecked();
  });

  it('cambiar de pestaña no pierde lo cargado en las otras', async () => {
    const { user } = await abrir({}, [FOTO_20]);
    await user.click(pestana('A mano'));
    const kcal = screen.getByLabelText('Energía en kcal por 100 g');
    expect(kcal).toHaveValue(150); // arranca con la estimación de Gemini
    await user.clear(kcal);
    await user.type(kcal, '200');

    await user.click(pestana('Del catálogo'));
    await agregar(user, 'aceite', 'Aceite de oliva');

    await user.click(pestana('IA'));
    expect(within(resultado()).getByText('150')).toBeInTheDocument();
    await user.click(pestana('A mano'));
    expect(screen.getByLabelText('Energía en kcal por 100 g')).toHaveValue(200);
    await user.click(pestana('Del catálogo'));
    expect(screen.getByLabelText('Gramos de Aceite de oliva')).toHaveValue(20);
  });
});

describe('PendienteDetalle — A mano y vista previa', () => {
  it('editar kcal actualiza la vista previa para el gramaje de cada ocurrencia', async () => {
    const { user } = await abrir();
    await user.click(pestana('A mano'));
    const preview = () => screen.getByRole('region', { name: 'Vista previa por ocurrencia' });
    expect(within(preview()).getByText(/180 kcal/)).toBeInTheDocument(); // 150 × 120 / 100
    const kcal = screen.getByLabelText('Energía en kcal por 100 g');
    await user.clear(kcal);
    await user.type(kcal, '200');
    expect(within(preview()).getByText(/240 kcal/)).toBeInTheDocument();
  });

  it('avisa si los valores no son plausibles pero NO bloquea', async () => {
    const { user } = await abrir();
    await user.click(pestana('A mano'));
    const kcal = screen.getByLabelText('Energía en kcal por 100 g');
    await user.clear(kcal);
    await user.type(kcal, '800');
    expect(screen.getByText(/no parecen coherentes/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Validar' })).toBeEnabled();
  });

  it('categoría y observaciones viven en "Más datos"', async () => {
    const { user } = await abrir();
    expect(screen.queryByLabelText('Observaciones')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Más datos/ }));
    expect(screen.getByLabelText('Categoría')).toHaveValue('postre');
    expect(screen.getByLabelText('Observaciones')).toHaveValue('');
  });
});

describe('PendienteDetalle — borrador', () => {
  it('"Guardar borrador" en IA manda la composición, avisa y refresca el listado', async () => {
    const { user, onGuardado } = await abrir();
    await user.click(screen.getByRole('button', { name: 'Guardar borrador' }));
    expect(modificarPendienteAction).toHaveBeenCalledWith({
      id: 5, nombre: 'Flan casero', categoria: 'postre', observaciones: null,
      kcal: 150, proteinas: 3, grasas: 5, carbs: 23, composicion: IA_VACIA,
    });
    expect(await screen.findByText('Guardado hace un momento')).toBeInTheDocument();
    expect(onGuardado).toHaveBeenCalledTimes(1);
  });

  it('guarda las observaciones escritas en "Más datos"', async () => {
    const { user } = await abrir();
    await user.click(screen.getByRole('button', { name: /Más datos/ }));
    await user.type(screen.getByLabelText('Observaciones'), 'revisar porción');
    await user.click(screen.getByRole('button', { name: 'Guardar borrador' }));
    expect(modificarPendienteAction).toHaveBeenCalledWith(expect.objectContaining({ observaciones: 'revisar porción' }));
  });

  it('indica los cambios sin guardar y lo apaga al guardar', async () => {
    const { user } = await abrir();
    expect(screen.queryByText(/^Sin guardar$/)).not.toBeInTheDocument();
    await user.type(screen.getByLabelText('Nombre'), ' 2');
    expect(screen.getByText(/^Sin guardar$/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Guardar borrador' }));
    await screen.findByText('Guardado hace un momento');
    expect(screen.queryByText(/^Sin guardar$/)).not.toBeInTheDocument();
  });

  it('si el guardado falla muestra el error, mantiene el indicador y no refresca', async () => {
    vi.mocked(modificarPendienteAction).mockResolvedValue({ error: 'No se pudo completar la acción. Probá de nuevo.' });
    const { user, onGuardado } = await abrir();
    await user.type(screen.getByLabelText('Nombre'), ' 2');
    await user.click(screen.getByRole('button', { name: 'Guardar borrador' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('No se pudo completar');
    expect(screen.getByText(/^Sin guardar$/)).toBeInTheDocument();
    expect(onGuardado).not.toHaveBeenCalled();
  });

  it('el borrador en Del catálogo guarda ingredientes, gramos y foto de referencia', async () => {
    const { user } = await abrir({}, [FOTO_20]);
    await user.click(pestana('Del catálogo'));
    await agregar(user, 'aceite', 'Aceite de oliva');
    await agregar(user, 'vinagre', 'Vinagre de alcohol');
    await gramos(user, 'Aceite de oliva', '15');
    await gramos(user, 'Vinagre de alcohol', '5');
    await user.click(screen.getByRole('button', { name: 'Guardar borrador' }));
    expect(modificarPendienteAction).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 5,
        kcal: 605, proteinas: 0, grasas: 67.5, carbs: 1,
        composicion: COMP_GUARDADA,
      }),
    );
  });

  it('guardar estando en otra pestaña conserva los ingredientes cargados en Del catálogo', async () => {
    const { user } = await abrir({}, [FOTO_20]);
    await user.click(pestana('Del catálogo'));
    await agregar(user, 'aceite', 'Aceite de oliva');
    await agregar(user, 'vinagre', 'Vinagre de alcohol');
    await gramos(user, 'Aceite de oliva', '15');
    await gramos(user, 'Vinagre de alcohol', '5');
    await user.click(pestana('A mano'));
    await user.click(screen.getByRole('button', { name: 'Guardar borrador' }));
    expect(modificarPendienteAction).toHaveBeenCalledWith(
      expect.objectContaining({ composicion: { ...COMP_GUARDADA, modo: 'manual' } }),
    );
  });

  it('al validar desde otra pestaña NO se mandan los ingredientes sueltos', async () => {
    const { user } = await abrir({}, [FOTO_20]);
    await user.click(pestana('Del catálogo'));
    await agregar(user, 'aceite', 'Aceite de oliva');
    await user.click(pestana('A mano'));
    await confirmarValidar(user);
    expect(validarPendienteAction).toHaveBeenCalledWith(
      expect.objectContaining({ composicion: { modo: 'manual', id_guardado_item: null, gramos_foto: null, componentes: [] } }),
    );
  });

  it('en Del catálogo recién abierta (sin ingredientes) se puede guardar el borrador', async () => {
    const { user } = await abrir({}, [FOTO_20]);
    await user.click(pestana('Del catálogo'));
    await user.click(screen.getByRole('button', { name: 'Guardar borrador' }));
    expect(modificarPendienteAction).toHaveBeenCalledWith(
      expect.objectContaining({
        kcal: null, proteinas: null, grasas: null, carbs: null,
        composicion: { modo: 'catalogo', id_guardado_item: 1, gramos_foto: 20, componentes: [] },
      }),
    );
  });

  it('con un gramaje vacío no guarda y dice de qué alimento falta', async () => {
    const { user } = await abrir({}, [FOTO_20]);
    await user.click(pestana('Del catálogo'));
    await agregar(user, 'aceite', 'Aceite de oliva');
    await user.clear(screen.getByLabelText('Gramos de Aceite de oliva'));
    await user.click(screen.getByRole('button', { name: 'Guardar borrador' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Indicá los gramos de Aceite de oliva');
    expect(modificarPendienteAction).not.toHaveBeenCalled();
  });
});

describe('PendienteDetalle — Del catálogo y validación', () => {
  it('aceite 15 g + vinagre 5 g sobre 20 g: valida con la composición y los valores en pantalla (sin guardar antes)', async () => {
    const { user, onResuelto } = await abrir({}, [FOTO_20]);
    await user.click(pestana('Del catálogo'));
    await agregar(user, 'aceite', 'Aceite de oliva');
    await agregar(user, 'vinagre', 'Vinagre de alcohol');
    await gramos(user, 'Aceite de oliva', '15');
    await gramos(user, 'Vinagre de alcohol', '5');
    await confirmarValidar(user);
    expect(validarPendienteAction).toHaveBeenCalledWith({
      id: 5, nombre: 'Flan casero', categoria: 'postre', observaciones: null,
      kcal: 605, proteinas: 0, grasas: 67.5, carbs: 1,
      composicion: COMP_GUARDADA,
    });
    expect(onResuelto).toHaveBeenCalledTimes(1);
  });

  it('un solo alimento con todo el peso de la foto se confirma como vínculo', async () => {
    const { user } = await abrir({}, [FOTO_20]);
    await user.click(pestana('Del catálogo'));
    await agregar(user, 'aceite', 'Aceite de oliva');
    await user.click(screen.getByRole('button', { name: 'Validar' }));
    expect(within(screen.getByRole('alertdialog')).getByText(/vinculado a Aceite de oliva/)).toBeInTheDocument();
  });

  it('sin ingredientes, o con un gramaje vacío, Validar está deshabilitado', async () => {
    const { user } = await abrir({}, [FOTO_20]);
    await user.click(pestana('Del catálogo'));
    expect(screen.getByRole('button', { name: 'Validar' })).toBeDisabled();
    await agregar(user, 'aceite', 'Aceite de oliva');
    expect(screen.getByRole('button', { name: 'Validar' })).toBeEnabled();
    await user.clear(screen.getByLabelText('Gramos de Aceite de oliva'));
    expect(screen.getByRole('button', { name: 'Validar' })).toBeDisabled();
  });

  it('un alimento sin datos nutricionales bloquea Validar', async () => {
    vi.mocked(searchAlimentosAction).mockResolvedValue([{ ...VINAGRE, id_alimento: 99, nombre: 'Misterio', kcal_100g: null }]);
    const { user } = await abrir({}, [FOTO_20]);
    await user.click(pestana('Del catálogo'));
    await agregar(user, 'mist', 'Misterio');
    expect(within(screen.getByRole('region', { name: 'Resultado de la composición' })).getByText(/Misterio no tiene datos nutricionales/)).toBeInTheDocument();
    expect(screen.getByRole('status', { name: 'Estado de la validación' })).toHaveTextContent(/Misterio no tiene datos nutricionales/);
    expect(screen.getByRole('button', { name: 'Validar' })).toBeDisabled();
  });

  it('un error del servidor sobre la composición se muestra y no cierra', async () => {
    vi.mocked(validarPendienteAction).mockResolvedValue({ error: 'La composición no es válida: ya no existe el alimento' });
    const { user, onResuelto } = await abrir({}, [FOTO_20]);
    await user.click(pestana('Del catálogo'));
    await agregar(user, 'aceite', 'Aceite de oliva');
    await confirmarValidar(user);
    expect(await screen.findByRole('alert')).toHaveTextContent('La composición no es válida');
    expect(onResuelto).not.toHaveBeenCalled();
  });
});

describe('PendienteDetalle — validar y descartar con confirmación', () => {
  it('Validar en IA pide confirmación con la cantidad de ítems y recién ahí llama a la acción', async () => {
    const { user, onResuelto } = await abrir();
    await user.click(screen.getByRole('button', { name: 'Validar' }));
    expect(validarPendienteAction).not.toHaveBeenCalled();
    expect(within(screen.getByRole('alertdialog')).getByText(/2 ítems/)).toBeInTheDocument();

    await user.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Confirmar' }));
    expect(validarPendienteAction).toHaveBeenCalledWith({
      id: 5, nombre: 'Flan casero', categoria: 'postre', observaciones: null,
      kcal: 150, proteinas: 3, grasas: 5, carbs: 23, composicion: IA_VACIA,
    });
    expect(onResuelto).toHaveBeenCalledTimes(1);
  });

  it('Validar a mano manda la composición manual con los valores cargados', async () => {
    const { user } = await abrir();
    await user.click(pestana('A mano'));
    const kcal = screen.getByLabelText('Energía en kcal por 100 g');
    await user.clear(kcal);
    await user.type(kcal, '160');
    await confirmarValidar(user);
    expect(validarPendienteAction).toHaveBeenCalledWith(
      expect.objectContaining({ kcal: 160, composicion: { modo: 'manual', id_guardado_item: null, gramos_foto: null, componentes: [] } }),
    );
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
    vi.mocked(validarPendienteAction).mockResolvedValue({ error: 'Este alimento ya fue resuelto por otro investigador' });
    const { user, onResuelto } = await abrir();
    await confirmarValidar(user);
    expect(await screen.findByRole('alert')).toHaveTextContent('ya fue resuelto por otro investigador');
    expect(onResuelto).not.toHaveBeenCalled();
  });

  it('un alimento ya resuelto es de solo lectura (sin Validar/Descartar ni buscador)', async () => {
    const { user } = await abrir({ estado: 'validado', composicion: COMP_GUARDADA }, [FOTO_20]);
    expect(screen.queryByRole('button', { name: 'Validar' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Descartar' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Guardar borrador' })).not.toBeInTheDocument();
    expect(screen.getByLabelText('Nombre')).toBeDisabled();
    expect(pestana('Del catálogo')).toBeChecked();
    expect(screen.getByLabelText('Gramos de Aceite de oliva')).toBeDisabled();
    expect(screen.queryByLabelText('Agregar alimento del catálogo')).not.toBeInTheDocument();
    await user.click(pestana('A mano')); // se puede mirar la otra pestaña sin editar
    expect(screen.getByLabelText('Energía en kcal por 100 g')).toBeDisabled();
  });
});

describe('PendienteDetalle — crear un alimento propio desde A mano', () => {
  const CASILLA = 'Agregar este alimento al catálogo propio';

  async function abrirAMano() {
    const r = await abrir();
    await r.user.click(pestana('A mano'));
    return r;
  }

  /** La verificación del servidor tarda ~400 ms (debounce): Validar se habilita recién cuando vuelve. */
  async function esperarListo() {
    await waitFor(() => expect(screen.getByRole('button', { name: 'Validar' })).toBeEnabled());
  }

  async function completarEvaluacion(user: ReturnType<typeof userEvent.setup>) {
    await user.selectOptions(screen.getByLabelText('Fuente del dato'), 'etiqueta_producto');
    await user.type(screen.getByLabelText('Justificación'), 'Etiqueta del envase, por 100 g.');
    await user.click(screen.getByLabelText('Revisé la fuente'));
    await user.click(screen.getByLabelText('Los valores son por 100 g'));
    await user.click(screen.getByLabelText('Busqué y no existe ya en SARA2, ANMAT ni en los propios'));
  }

  it('la casilla sólo existe en A mano, no en IA ni en Del catálogo', async () => {
    const { user } = await abrir();
    expect(screen.queryByLabelText(CASILLA)).not.toBeInTheDocument();
    await user.click(pestana('Del catálogo'));
    expect(screen.queryByLabelText(CASILLA)).not.toBeInTheDocument();
    await user.click(pestana('A mano'));
    expect(screen.getByLabelText(CASILLA)).not.toBeChecked();
  });

  it('marcarla pide fuente, justificación y las tres confirmaciones; Validar espera a que esté todo', async () => {
    const { user } = await abrirAMano();
    await user.click(screen.getByLabelText(CASILLA));
    expect(screen.getByRole('button', { name: 'Validar' })).toBeDisabled();
    await completarEvaluacion(user);
    await esperarListo();
  });

  it('crea el propio: manda la evaluación, NO llama a validar común y cierra', async () => {
    const { user, onResuelto } = await abrirAMano();
    await user.click(screen.getByLabelText(CASILLA));
    await completarEvaluacion(user);
    await esperarListo();
    await user.click(screen.getByRole('button', { name: 'Validar' }));
    expect(within(screen.getByRole('alertdialog')).getByText(/se agregará «Flan casero» al catálogo propio/)).toBeInTheDocument();
    await user.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Confirmar' }));
    expect(validarComoPropioAction).toHaveBeenCalledWith({
      id: 5, nombre: 'Flan casero', categoria: 'postre', observaciones: null,
      kcal: 150, proteinas: 3, grasas: 5, carbs: 23,
      propio: {
        fuenteDato: 'etiqueta_producto',
        justificacion: 'Etiqueta del envase, por 100 g.',
        confirmaciones: { reviseFuente: true, valoresPor100g: true, busqueExistente: true },
        confirmaIncoherente: false,
        confirmaDistinto: false,
      },
    });
    expect(validarPendienteAction).not.toHaveBeenCalled();
    expect(onResuelto).toHaveBeenCalledTimes(1);
  });

  it('un bloqueo del servidor (nombre duplicado) se muestra con el alimento existente y frena Validar', async () => {
    vi.mocked(verificarAlimentoPropioAction).mockResolvedValue({
      ok: true,
      bloqueos: [{ codigo: 'DUPLICADO', existente: { origen: 'catalogo', id: 5, nombre: 'Huevo', fuente: 'ANMAT' } }],
      advertencias: [],
    });
    const { user } = await abrirAMano();
    await user.click(screen.getByLabelText(CASILLA));
    await completarEvaluacion(user);
    expect(await screen.findByText(/Ya existe «Huevo» \(ANMAT\)/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Validar' })).toBeDisabled();
  });

  it('un nombre parecido lista los similares y exige confirmar que es distinto', async () => {
    vi.mocked(verificarAlimentoPropioAction).mockResolvedValue({
      ok: true,
      bloqueos: [],
      advertencias: [{ codigo: 'SIMILAR', similares: [{ origen: 'catalogo', id: 1, nombre: 'Flan de vainilla', fuente: 'SARA2', similitud: 0.9 }] }],
    });
    const { user } = await abrirAMano();
    await user.click(screen.getByLabelText(CASILLA));
    await completarEvaluacion(user);
    expect(await screen.findByText(/Flan de vainilla/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Validar' })).toBeDisabled();
    await user.click(screen.getByLabelText('Confirmo que es un alimento distinto'));
    await esperarListo();
  });

  it('kcal incoherentes exigen confirmación explícita', async () => {
    vi.mocked(verificarAlimentoPropioAction).mockResolvedValue({ ok: true, bloqueos: [], advertencias: [{ codigo: 'KCAL_INCOHERENTE' }] });
    const { user } = await abrirAMano();
    await user.click(screen.getByLabelText(CASILLA));
    await completarEvaluacion(user);
    expect(await screen.findByText(/Las kcal no cierran con 4 kcal/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Validar' })).toBeDisabled();
    await user.click(screen.getByLabelText('Confirmo que las kcal son correctas'));
    await esperarListo();
  });

  it('al editar un valor se vuelve a verificar y Validar espera el resultado nuevo', async () => {
    const { user } = await abrirAMano();
    await user.click(screen.getByLabelText(CASILLA));
    await completarEvaluacion(user);
    await esperarListo();
    await waitFor(() => expect(verificarAlimentoPropioAction).toHaveBeenCalledWith({ nombre: 'Flan casero', kcal: 150, proteinas: 3, grasas: 5, carbs: 23 }));

    let resolver: (v: Awaited<ReturnType<typeof verificarAlimentoPropioAction>>) => void = () => {};
    vi.mocked(verificarAlimentoPropioAction).mockImplementation(() => new Promise((r) => { resolver = r; }));
    const kcal = screen.getByLabelText('Energía en kcal por 100 g');
    await user.clear(kcal);
    await user.type(kcal, '160');
    await waitFor(() => expect(verificarAlimentoPropioAction).toHaveBeenLastCalledWith(expect.objectContaining({ kcal: 160 })));
    expect(screen.getByRole('button', { name: 'Validar' })).toBeDisabled(); // verificando: no se valida con una verificación vieja
    resolver({ ok: true, bloqueos: [], advertencias: [] });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Validar' })).toBeEnabled());
  });

  it('un error del servidor al crear se muestra y no cierra', async () => {
    vi.mocked(validarComoPropioAction).mockResolvedValue({ error: 'Otro investigador acaba de crear un alimento con ese nombre. Usalo desde "Del catálogo".' });
    const { user, onResuelto } = await abrirAMano();
    await user.click(screen.getByLabelText(CASILLA));
    await completarEvaluacion(user);
    await esperarListo();
    await user.click(screen.getByRole('button', { name: 'Validar' }));
    await user.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Confirmar' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Otro investigador acaba de crear');
    expect(onResuelto).not.toHaveBeenCalled();
  });

  it('marcar la casilla y volver a IA valida como siempre, sin crear el propio', async () => {
    const { user } = await abrirAMano();
    await user.click(screen.getByLabelText(CASILLA));
    await user.click(pestana('IA'));
    await confirmarValidar(user);
    expect(validarPendienteAction).toHaveBeenCalledTimes(1);
    expect(validarComoPropioAction).not.toHaveBeenCalled();
  });

  it('marcar la casilla no cuenta como "cambios sin guardar" (el borrador no la guarda)', async () => {
    const { user } = await abrirAMano();
    await user.click(screen.getByRole('button', { name: 'Guardar borrador' })); // cambiar de pestaña ya es un cambio: se guarda primero
    await screen.findByText('Guardado hace un momento');
    await user.click(screen.getByLabelText(CASILLA));
    expect(screen.queryByText(/^Sin guardar$/)).not.toBeInTheDocument();
  });
});

describe('PendienteDetalle — las confirmaciones no sobreviven a una edición', () => {
  const CASILLA = 'Agregar este alimento al catálogo propio';
  const INCOHERENTE = { ok: true, bloqueos: [], advertencias: [{ codigo: 'KCAL_INCOHERENTE' }] } as const;

  async function prepararConfirmado() {
    vi.mocked(verificarAlimentoPropioAction).mockResolvedValue(INCOHERENTE as never);
    const r = await abrir();
    await r.user.click(pestana('A mano'));
    await r.user.click(screen.getByLabelText(CASILLA));
    await r.user.selectOptions(screen.getByLabelText('Fuente del dato'), 'etiqueta_producto');
    await r.user.type(screen.getByLabelText('Justificación'), 'Etiqueta del envase, por 100 g.');
    await r.user.click(screen.getByLabelText('Revisé la fuente'));
    await r.user.click(screen.getByLabelText('Los valores son por 100 g'));
    await r.user.click(screen.getByLabelText('Busqué y no existe ya en SARA2, ANMAT ni en los propios'));
    await r.user.click(await screen.findByLabelText('Confirmo que las kcal son correctas'));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Validar' })).toBeEnabled());
    return r;
  }

  it('al editar un valor se pide confirmar de nuevo la advertencia', async () => {
    const { user } = await prepararConfirmado();
    const kcal = screen.getByLabelText('Energía en kcal por 100 g');
    await user.clear(kcal);
    await user.type(kcal, '50');
    const casilla = await screen.findByLabelText('Confirmo que las kcal son correctas');
    await waitFor(() => expect(casilla).not.toBeChecked());
    expect(screen.getByRole('button', { name: 'Validar' })).toBeDisabled();
  });

  it('con el diálogo de confirmación abierto, editar un valor deshabilita Confirmar', async () => {
    const { user } = await prepararConfirmado();
    await user.click(screen.getByRole('button', { name: 'Validar' }));
    const confirmar = within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Confirmar' });
    expect(confirmar).toBeEnabled();
    const kcal = screen.getByLabelText('Energía en kcal por 100 g');
    await user.clear(kcal);
    await user.type(kcal, '50');
    expect(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Confirmar' })).toBeDisabled();
    expect(validarComoPropioAction).not.toHaveBeenCalled();
  });
});

describe('PendienteDetalle — retirar un alimento propio', () => {
  const PROPIO: PropioInfo = { id: 9, estado: 'activo', fuenteDato: 'etiqueta_producto', justificacion: 'Etiqueta del envase.', motivoRetiro: null };
  const validado = { estado: 'validado' as const, id_alimento_propio: 9 };

  it('muestra la fuente y la justificación del propio y el botón Retirar', async () => {
    await abrir(validado, [OCURRENCIA], PROPIO);
    const seccion = screen.getByRole('region', { name: 'Alimento propio' });
    expect(within(seccion).getByText(/Etiqueta del producto/)).toBeInTheDocument();
    expect(within(seccion).getByText(/Etiqueta del envase\./)).toBeInTheDocument();
    expect(within(seccion).getByRole('button', { name: 'Retirar del catálogo propio' })).toBeInTheDocument();
  });

  it('pide un motivo de al menos 10 caracteres antes de confirmar', async () => {
    const { user } = await abrir(validado, [OCURRENCIA], PROPIO);
    await user.click(screen.getByRole('button', { name: 'Retirar del catálogo propio' }));
    const confirmar = screen.getByRole('button', { name: 'Confirmar retiro' });
    expect(confirmar).toBeDisabled();
    await user.type(screen.getByLabelText('Motivo del retiro'), 'corto');
    expect(confirmar).toBeDisabled();
    await user.type(screen.getByLabelText('Motivo del retiro'), ' pero ya largo');
    expect(confirmar).toBeEnabled();
  });

  it('retira, avisa, oculta el botón y refresca el listado', async () => {
    const { user, onGuardado } = await abrir(validado, [OCURRENCIA], PROPIO);
    await user.click(screen.getByRole('button', { name: 'Retirar del catálogo propio' }));
    await user.type(screen.getByLabelText('Motivo del retiro'), 'Los valores de la etiqueta estaban mal.');
    await user.click(screen.getByRole('button', { name: 'Confirmar retiro' }));
    expect(retirarAlimentoPropioAction).toHaveBeenCalledWith({ id: 9, motivo: 'Los valores de la etiqueta estaban mal.' });
    expect(await screen.findByText(/Retirado del catálogo propio/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Retirar del catálogo propio' })).not.toBeInTheDocument();
    expect(onGuardado).toHaveBeenCalledTimes(1);
  });

  it('si el servidor rechaza el retiro muestra el error y deja el botón', async () => {
    vi.mocked(retirarAlimentoPropioAction).mockResolvedValue({ error: 'Este alimento ya fue resuelto por otro investigador' });
    const { user, onGuardado } = await abrir(validado, [OCURRENCIA], PROPIO);
    await user.click(screen.getByRole('button', { name: 'Retirar del catálogo propio' }));
    await user.type(screen.getByLabelText('Motivo del retiro'), 'Los valores de la etiqueta estaban mal.');
    await user.click(screen.getByRole('button', { name: 'Confirmar retiro' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('ya fue resuelto');
    expect(onGuardado).not.toHaveBeenCalled();
  });

  it('un propio ya retirado muestra el motivo y no ofrece retirar', async () => {
    await abrir(validado, [OCURRENCIA], { ...PROPIO, estado: 'retirado', motivoRetiro: 'Valores incorrectos.' });
    expect(screen.getByText(/Retirado del catálogo propio/)).toBeInTheDocument();
    expect(screen.getByText(/Valores incorrectos\./)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Retirar del catálogo propio' })).not.toBeInTheDocument();
  });

  it('un alimento validado sin propio, o uno todavía pendiente, no muestra la sección', async () => {
    await abrir({ estado: 'validado' });
    expect(screen.queryByRole('region', { name: 'Alimento propio' })).not.toBeInTheDocument();
  });
});

describe('PendienteDetalle — rediseño: pasos, resultado único y pie con estado', () => {
  it('muestra los dos pasos numerados y el resultado una sola vez con su fuente', async () => {
    await abrir();
    expect(screen.getByRole('heading', { name: 'Nombre del alimento' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '¿De dónde salen los valores?' })).toBeInTheDocument();
    const card = resultado();
    expect(within(card).getByText('IA (Gemini)')).toBeInTheDocument();
    expect(within(card).getByText(/150/)).toBeInTheDocument();
    expect(within(card).getByText('kcal por 100 g')).toBeInTheDocument();
    expect(within(card).getByText(/Así queda en tu comida/)).toBeInTheDocument();
  });

  it('la fuente del resultado cambia con el método elegido', async () => {
    const { user } = await abrir({}, [FOTO_20]);
    await user.click(pestana('A mano'));
    expect(within(resultado()).getByText('A mano')).toBeInTheDocument();
    await user.click(pestana('Del catálogo'));
    expect(within(resultado()).getByText('Del catálogo')).toBeInTheDocument();
  });

  it('el pie explica por qué Validar está deshabilitado y avisa cuando está listo', async () => {
    const { user } = await abrir();
    const estado = screen.getByRole('status', { name: 'Estado de la validación' });
    expect(estado).toHaveTextContent('Listo para validar');
    await user.clear(screen.getByLabelText('Nombre'));
    expect(estado).toHaveTextContent('Poné un nombre al alimento');
    expect(screen.getByRole('button', { name: 'Validar' })).toBeDisabled();
    await user.click(pestana('Del catálogo'));
    await user.type(screen.getByLabelText('Nombre'), 'Flan');
    expect(estado).toHaveTextContent('Agregá al menos un alimento del catálogo');
  });

  it('si el nombre cambió ofrece volver al original con un toque', async () => {
    const { user } = await abrir();
    expect(screen.queryByRole('button', { name: /Usar «Flan casero»/ })).not.toBeInTheDocument();
    await user.type(screen.getByLabelText('Nombre'), ' 2');
    await user.click(screen.getByRole('button', { name: /Usar «Flan casero»/ }));
    expect(screen.getByLabelText('Nombre')).toHaveValue('Flan casero');
  });

  it('con una sola comida listada no hay "Ver otras"', async () => {
    await abrir();
    expect(screen.queryByRole('button', { name: /Ver otras/ })).not.toBeInTheDocument();
    expect(screen.getByText(/Dónde apareció · 2 comidas/)).toBeInTheDocument(); // totalOcurrencias del fixture
  });
});
