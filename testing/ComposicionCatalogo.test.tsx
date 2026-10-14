/**
 * NUT-119 — Pestaña "Del catálogo": gramos reales de cada alimento sobre el peso
 * de la foto de referencia, avisos de suma y resultado por 100 g.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useState } from 'react';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('@/app/alimentacion/actions', () => ({ searchAlimentosAction: vi.fn() }));

import ComposicionCatalogo from '@/app/(researcher)/validacion/ComposicionCatalogo';
import { aEditables, type ComponenteComposicion, type ComponenteEditable } from '@/lib/composicion';
import { searchAlimentosAction } from '@/app/alimentacion/actions';
import { OCURRENCIA } from './fixtures/validacion';

const ACEITE = { id_alimento: 31, nombre: 'Aceite de oliva', categoria: 'aceites', fuente: 'SARA2', marca: null, denominacion: null, kcal_100g: 800, proteinas_100g: 0, grasas_100g: 90, carbs_100g: 0 };
const VINAGRE = { id_alimento: 32, nombre: 'Vinagre de alcohol', categoria: 'aderezos', fuente: 'SARA2', marca: null, denominacion: null, kcal_100g: 20, proteinas_100g: 0, grasas_100g: 0, carbs_100g: 4 };
const SIN_DATOS = { ...VINAGRE, id_alimento: 99, nombre: 'Misterio', kcal_100g: null };

const FOTO_20 = { ...OCURRENCIA, idGuardadoItem: 10, gramosFinal: 20 };
const FOTO_40 = { ...OCURRENCIA, idGuardadoItem: 11, gramosFinal: 40, deportista: 'Beto Gómez', fecha: '2026-10-07T12:00:00Z' };

function Wrapper({ ocurrencias = [FOTO_20], inicial = [], soloLectura = false }: {
  ocurrencias?: typeof FOTO_20[]; inicial?: ComponenteEditable[]; soloLectura?: boolean;
}) {
  const [ingredientes, setIngredientes] = useState(inicial);
  const [referencia, setReferencia] = useState<number | null>(ocurrencias[0]?.idGuardadoItem ?? null);
  return (
    <ComposicionCatalogo
      ocurrencias={ocurrencias}
      referencia={referencia}
      onReferencia={setReferencia}
      ingredientes={ingredientes}
      onIngredientes={setIngredientes}
      soloLectura={soloLectura}
    />
  );
}

function mockBusqueda() {
  vi.mocked(searchAlimentosAction).mockImplementation(async (q: string) =>
    q.startsWith('acei') ? [ACEITE] : q.startsWith('vina') ? [VINAGRE] : q.startsWith('mist') ? [SIN_DATOS] : [],
  );
}

async function agregar(user: ReturnType<typeof userEvent.setup>, busqueda: string, nombre: string) {
  await user.type(screen.getByLabelText('Agregar alimento del catálogo'), busqueda);
  await user.click(await screen.findByRole('button', { name: new RegExp(`Agregar ${nombre}`) }));
}

async function gramos(user: ReturnType<typeof userEvent.setup>, nombre: string, valor: string) {
  const campo = screen.getByLabelText(`Gramos de ${nombre}`);
  await user.clear(campo);
  if (valor) await user.type(campo, valor);
}

const resultado = () => screen.getByRole('region', { name: 'Resultado de la composición' });

beforeEach(() => {
  vi.mocked(searchAlimentosAction).mockReset().mockResolvedValue([]);
  mockBusqueda();
});

describe('ComposicionCatalogo', () => {
  it('muestra cuánto pesa el alimento en la foto de referencia', () => {
    render(<Wrapper />);
    expect(screen.getByText(/En la foto de Ana Pérez/)).toHaveTextContent('pesa 20 g');
  });

  it('el primer ingrediente arranca con el peso total de la foto; los siguientes, vacío', async () => {
    const user = userEvent.setup();
    render(<Wrapper />);
    await agregar(user, 'aceite', 'Aceite de oliva');
    expect(screen.getByLabelText('Gramos de Aceite de oliva')).toHaveValue(20);
    await agregar(user, 'vinagre', 'Vinagre de alcohol');
    expect(screen.getByLabelText('Gramos de Vinagre de alcohol')).toHaveValue(null);
  });

  it('15 g de aceite + 5 g de vinagre en una foto de 20 g: valores por 100 g y suma completa', async () => {
    const user = userEvent.setup();
    render(<Wrapper />);
    await agregar(user, 'aceite', 'Aceite de oliva');
    await agregar(user, 'vinagre', 'Vinagre de alcohol');
    await gramos(user, 'Aceite de oliva', '15');
    await gramos(user, 'Vinagre de alcohol', '5');
    expect(within(resultado()).getByText(/Sumás 20 g de 20 g/)).toBeInTheDocument();
    expect(within(resultado()).getByText(/605 kcal/)).toBeInTheDocument();
    expect(within(resultado()).getByText(/G 67\.5 g/)).toBeInTheDocument();
    expect(within(resultado()).queryByText(/restantes/)).not.toBeInTheDocument();
  });

  it('si falta peso avisa cuántos gramos restan, sin bloquear el resultado', async () => {
    const user = userEvent.setup();
    render(<Wrapper />);
    await agregar(user, 'aceite', 'Aceite de oliva');
    await gramos(user, 'Aceite de oliva', '8');
    expect(within(resultado()).getByText(/Sumás 8 g de 20 g/)).toBeInTheDocument();
    expect(within(resultado()).getByText(/12 g restantes se cuentan sin aporte/)).toBeInTheDocument();
    expect(within(resultado()).getByText(/320 kcal/)).toBeInTheDocument(); // 800 × 8 / 20
  });

  it('si se pasa del peso de la foto avisa que revise', async () => {
    const user = userEvent.setup();
    render(<Wrapper />);
    await agregar(user, 'aceite', 'Aceite de oliva');
    await gramos(user, 'Aceite de oliva', '25');
    expect(within(resultado()).getByText(/Superás el peso de la foto por 5 g/)).toBeInTheDocument();
  });

  it('un solo alimento con todo el peso de la foto es el mismo alimento del catálogo', async () => {
    const user = userEvent.setup();
    render(<Wrapper />);
    await agregar(user, 'aceite', 'Aceite de oliva');
    expect(within(resultado()).getByText(/mismo alimento del catálogo/)).toHaveTextContent('Aceite de oliva');
    expect(within(resultado()).getByText(/800 kcal/)).toBeInTheDocument();
  });

  it('sin ingredientes lo dice y no muestra valores', () => {
    render(<Wrapper />);
    expect(within(resultado()).getByText(/Agregá al menos un alimento/)).toBeInTheDocument();
    expect(within(resultado()).queryByText(/kcal/)).not.toBeInTheDocument();
  });

  it('un gramaje vacío se pide por nombre y bloquea el resultado', async () => {
    const user = userEvent.setup();
    render(<Wrapper />);
    await agregar(user, 'aceite', 'Aceite de oliva');
    await gramos(user, 'Aceite de oliva', '');
    expect(within(resultado()).getByText(/Indicá los gramos de Aceite de oliva/)).toBeInTheDocument();
    expect(within(resultado()).queryByText(/kcal/)).not.toBeInTheDocument();
  });

  it('un alimento sin datos nutricionales avisa por nombre y bloquea el resultado', async () => {
    const user = userEvent.setup();
    render(<Wrapper />);
    await agregar(user, 'misterio', 'Misterio');
    expect(within(resultado()).getByText(/Misterio no tiene datos nutricionales en el catálogo/)).toBeInTheDocument();
    expect(within(resultado()).queryByText(/kcal/)).not.toBeInTheDocument();
  });

  it('se puede quitar un ingrediente y no se agrega dos veces el mismo', async () => {
    const user = userEvent.setup();
    render(<Wrapper />);
    await agregar(user, 'aceite', 'Aceite de oliva');
    await user.type(screen.getByLabelText('Agregar alimento del catálogo'), 'aceite');
    await user.click(await screen.findByRole('button', { name: /Agregar Aceite de oliva/ }));
    expect(screen.getAllByLabelText('Gramos de Aceite de oliva')).toHaveLength(1);
    await user.click(screen.getByRole('button', { name: 'Quitar Aceite de oliva' }));
    expect(screen.queryByLabelText('Gramos de Aceite de oliva')).not.toBeInTheDocument();
  });

  it('con varias fotos permite elegir la de referencia y el peso cambia', async () => {
    const user = userEvent.setup();
    render(<Wrapper ocurrencias={[FOTO_20, FOTO_40]} />);
    await user.selectOptions(screen.getByLabelText('Foto de referencia'), '11');
    expect(screen.getByText(/En la foto de Beto Gómez/)).toHaveTextContent('pesa 40 g');
  });

  it('con una sola foto no muestra el selector', () => {
    render(<Wrapper />);
    expect(screen.queryByLabelText('Foto de referencia')).not.toBeInTheDocument();
  });

  it('restaura ingredientes guardados y en solo lectura no deja buscar ni editar', () => {
    const guardados: ComponenteComposicion[] = [
      { origen: 'catalogo', id: 31, nombre: 'Aceite de oliva', fuente: 'SARA2', gramos: 15, kcal_100g: 800, proteinas_100g: 0, grasas_100g: 90, carbs_100g: 0 },
    ];
    render(<Wrapper inicial={aEditables(guardados)} soloLectura />);
    expect(screen.getByLabelText('Gramos de Aceite de oliva')).toBeDisabled();
    expect(screen.queryByLabelText('Agregar alimento del catálogo')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Quitar Aceite de oliva' })).not.toBeInTheDocument();
  });

  it('sin fotos con peso avisa que no hay referencia', () => {
    render(<Wrapper ocurrencias={[]} />);
    expect(screen.getByText(/No hay una foto de referencia con peso/)).toBeInTheDocument();
  });
});
