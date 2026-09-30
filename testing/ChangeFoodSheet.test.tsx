import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ChangeFoodSheet from '@/app/alimentacion/ChangeFoodSheet';
import { nutritionProviderMock } from '@/lib/nutritionMock';
import { searchAlimentosAction } from '@/app/alimentacion/actions';

vi.mock('@/app/alimentacion/actions', () => ({
  searchAlimentosAction: vi.fn(),
}));

const mockedSearch = vi.mocked(searchAlimentosAction);

beforeEach(() => {
  mockedSearch.mockReset();
});

describe('ChangeFoodSheet — modo "replace"', () => {
  it('muestra la tarjeta "Reemplaza" con el alimento y peso actuales', () => {
    render(
      <ChangeFoodSheet
        mode="replace"
        target={{ name: 'Topping blanco', grams: 35, boundingBox: null, dudaOptions: [] }}
        photoUrl="blob:foto"
        mealType="desayuno"
        provider={nutritionProviderMock}
        onConfirm={vi.fn()}
      />,
    );
    expect(screen.getByText(/Topping blanco · 35 g/)).toBeInTheDocument();
  });

  it('los chips de "La IA dudó entre" completan la búsqueda al tocarlos', async () => {
    mockedSearch.mockResolvedValue([]);
    const user = userEvent.setup();
    render(
      <ChangeFoodSheet
        mode="replace"
        target={{
          name: 'Topping blanco',
          grams: 35,
          boundingBox: null,
          dudaOptions: ['Crema chantilly', 'Yogur griego'],
        }}
        photoUrl={null}
        mealType="desayuno"
        provider={nutritionProviderMock}
        onConfirm={vi.fn()}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Yogur griego' }));
    expect(screen.getByLabelText('Buscar alimento')).toHaveValue('Yogur griego');
  });

  it('busca con debounce, muestra resultados con kcal/macros del provider mock y confirma la elección', async () => {
    mockedSearch.mockResolvedValue([
      { id_alimento: 1, nombre: 'Yogur griego natural', categoria: 'Lácteo', fuente: 'SARA2', marca: null, denominacion: null },
      { id_alimento: 2, nombre: 'Yogur griego descremado', categoria: 'Lácteo', fuente: 'SARA2', marca: null, denominacion: null },
    ]);
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    render(
      <ChangeFoodSheet
        mode="replace"
        target={{ name: 'Topping blanco', grams: 35, boundingBox: null, dudaOptions: [] }}
        photoUrl={null}
        mealType="desayuno"
        provider={nutritionProviderMock}
        onConfirm={onConfirm}
      />,
    );

    await user.type(screen.getByLabelText('Buscar alimento'), 'yogur');
    expect(await screen.findByText('Yogur griego natural')).toBeInTheDocument();
    expect(screen.getByText('97 kcal')).toBeInTheDocument();
    expect(mockedSearch).toHaveBeenCalledWith('yogur', 'desayuno');

    await user.click(screen.getByText('Yogur griego natural'));
    await user.click(screen.getByRole('button', { name: 'Usar Yogur griego natural' }));

    expect(onConfirm).toHaveBeenCalledWith({ nombre: 'Yogur griego natural', categoria: 'Lácteo' });
  });

  it('el botón de confirmar está deshabilitado hasta elegir un resultado', async () => {
    mockedSearch.mockResolvedValue([
      { id_alimento: 1, nombre: 'Yogur griego natural', categoria: 'Lácteo', fuente: 'SARA2', marca: null, denominacion: null },
    ]);
    const user = userEvent.setup();
    render(
      <ChangeFoodSheet
        mode="replace"
        target={{ name: 'Topping blanco', grams: 35, boundingBox: null, dudaOptions: [] }}
        photoUrl={null}
        mealType="desayuno"
        provider={nutritionProviderMock}
        onConfirm={vi.fn()}
      />,
    );
    expect(screen.getByRole('button', { name: 'Usar alimento' })).toBeDisabled();
    await user.type(screen.getByLabelText('Buscar alimento'), 'yogur');
    await screen.findByText('Yogur griego natural');
    expect(screen.getByRole('button', { name: 'Usar alimento' })).toBeDisabled();
  });
});

describe('ChangeFoodSheet — modo "add"', () => {
  it('no muestra tarjeta "Reemplaza" ni chips de duda', () => {
    render(
      <ChangeFoodSheet
        mode="add"
        photoUrl={null}
        mealType="desayuno"
        provider={nutritionProviderMock}
        onConfirm={vi.fn()}
      />,
    );
    expect(screen.queryByText(/Reemplaza/)).not.toBeInTheDocument();
    expect(screen.queryByText('La IA dudó entre')).not.toBeInTheDocument();
  });
});
