import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import AlimentacionClient from '@/app/alimentacion/AlimentacionClient';
import type { AlimentoOption } from '@/app/alimentacion/actions';
import { searchAlimentosAction } from '@/app/alimentacion/actions';

// ─────────────────────────────────────────────────────────────────────────────
// Mocks
// ─────────────────────────────────────────────────────────────────────────────

vi.mock('@/lib/date', () => ({
  todayAR:   () => '2026-09-21',
  daysAgoAR: () => '2026-09-14',
}));

vi.mock('@/app/alimentacion/actions', () => ({
  searchAlimentosAction:  vi.fn().mockResolvedValue([]),
  addItemAction:          vi.fn(),
  addManualItemAction:    vi.fn(),
  deleteItemAction:       vi.fn(),
  updateItemAction:       vi.fn(),
}));

vi.mock('@/app/alimentacion/AIRecognitionModal', () => ({ default: () => null }));
vi.mock('@/app/alimentacion/ChatFoodModal',      () => ({ default: () => null }));

// ─────────────────────────────────────────────────────────────────────────────
// Fixtures
// ─────────────────────────────────────────────────────────────────────────────

/** ANMAT con marca, denominación y categoría — el botón "?" debe aparecer */
const A_ANMAT_COMPLETO: AlimentoOption = {
  id_alimento:  1_000_001,
  nombre:       'Aceitunas verdes en salmuera',
  categoria:    'Vegetales semi procesados',
  fuente:       'ANMAT',
  marca:        'Finca la fortaleza',
  denominacion: 'Aceitunas verdes en salmuera de origen argentino',
};

/** ANMAT sin ningún campo opcional — el botón "?" NO debe aparecer */
const A_ANMAT_VACIO: AlimentoOption = {
  id_alimento:  1_000_009,
  nombre:       'Producto genérico',
  categoria:    null,
  fuente:       'ANMAT',
  marca:        null,
  denominacion: null,
};

/** SARA2 clásico sin campos opcionales — el botón "?" NO debe aparecer */
const A_SARA2_VACIO: AlimentoOption = {
  id_alimento:  99,
  nombre:       'Agua mineral',
  categoria:    null,
  fuente:       'SARA2',
  marca:        null,
  denominacion: null,
};

/** SARA2 con categoría — para probar badge SARA2 con categoría visible */
const A_SARA2_CON_CATEGORIA: AlimentoOption = {
  id_alimento:  42,
  nombre:       'Arroz blanco cocido',
  categoria:    'Cereales',
  fuente:       'SARA2',
  marca:        null,
  denominacion: null,
};

/** ANMAT con marca pero sin denominación */
const A_ANMAT_CON_MARCA_SIN_DENOM: AlimentoOption = {
  id_alimento:  1_000_002,
  nombre:       'Nuez sin cáscara',
  categoria:    'Frutos secos',
  fuente:       'ANMAT',
  marca:        'Finca la florida-nuts',
  denominacion: null,
};

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function mount() {
  const user = userEvent.setup();
  render(
    <AlimentacionClient
      ingesta={null}
      tipoIngesta="almuerzo"
      fecha="2026-09-21"
      hideNutrition={false}
    />,
  );
  return { user };
}

/**
 * Escribe en el buscador y espera a que el texto `esperado` aparezca.
 * Cubre el debounce de 300 ms + resolución del server action.
 */
async function buscar(
  user: ReturnType<typeof userEvent.setup>,
  query: string,
  esperado: string,
) {
  await user.type(screen.getByRole('textbox'), query);
  await screen.findByText(esperado, {}, { timeout: 1500 });
}

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

describe('Buscador de alimentos — integración ANMAT + SARA2', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(searchAlimentosAction).mockResolvedValue([]);
  });

  // ── Badge de fuente ────────────────────────────────────────────────────────
  describe('badge de fuente', () => {
    it('muestra el badge "ANMAT" para alimentos de ANMAT', async () => {
      vi.mocked(searchAlimentosAction).mockResolvedValue([A_ANMAT_COMPLETO]);
      const { user } = mount();
      await buscar(user, 'ace', A_ANMAT_COMPLETO.nombre);
      expect(screen.getByText('ANMAT')).toBeInTheDocument();
    });

    it('muestra el badge "SARA2" para alimentos de SARA2', async () => {
      vi.mocked(searchAlimentosAction).mockResolvedValue([A_SARA2_CON_CATEGORIA]);
      const { user } = mount();
      await buscar(user, 'ar', A_SARA2_CON_CATEGORIA.nombre);
      expect(screen.getByText('SARA2')).toBeInTheDocument();
    });

    it('muestra ambas fuentes cuando los resultados son mixtos', async () => {
      vi.mocked(searchAlimentosAction).mockResolvedValue([A_ANMAT_COMPLETO, A_SARA2_CON_CATEGORIA]);
      const { user } = mount();
      await buscar(user, 'ac', A_ANMAT_COMPLETO.nombre);
      expect(screen.getByText('ANMAT')).toBeInTheDocument();
      expect(screen.getByText('SARA2')).toBeInTheDocument();
    });
  });

  // ── Botón "?" de detalle ───────────────────────────────────────────────────
  describe('botón "?" de detalle', () => {
    it('aparece y está habilitado cuando el alimento tiene denominación o categoría', async () => {
      vi.mocked(searchAlimentosAction).mockResolvedValue([A_ANMAT_COMPLETO]);
      const { user } = mount();
      await buscar(user, 'ace', A_ANMAT_COMPLETO.nombre);

      const btn = screen.getByRole('button', { name: 'Ver detalle del alimento' });
      expect(btn).toBeInTheDocument();
      expect(btn).not.toBeDisabled();
    });

    it('no está en el DOM cuando el alimento no tiene categoría ni denominación (SARA2)', async () => {
      vi.mocked(searchAlimentosAction).mockResolvedValue([A_SARA2_VACIO]);
      const { user } = mount();
      await buscar(user, 'ag', A_SARA2_VACIO.nombre);

      expect(
        screen.queryByRole('button', { name: 'Ver detalle del alimento' }),
      ).not.toBeInTheDocument();
    });

    it('no está en el DOM cuando un alimento ANMAT tampoco tiene categoría ni denominación', async () => {
      vi.mocked(searchAlimentosAction).mockResolvedValue([A_ANMAT_VACIO]);
      const { user } = mount();
      await buscar(user, 'pr', A_ANMAT_VACIO.nombre);

      expect(
        screen.queryByRole('button', { name: 'Ver detalle del alimento' }),
      ).not.toBeInTheDocument();
    });

    it('al hacer click abre el modal con todos los campos disponibles del alimento', async () => {
      vi.mocked(searchAlimentosAction).mockResolvedValue([A_ANMAT_COMPLETO]);
      const { user } = mount();
      await buscar(user, 'ace', A_ANMAT_COMPLETO.nombre);
      await user.click(screen.getByRole('button', { name: 'Ver detalle del alimento' }));

      // El modal se identifica por su título
      const modal = screen.getByRole('dialog');
      expect(within(modal).getByText(A_ANMAT_COMPLETO.nombre)).toBeInTheDocument();
      expect(within(modal).getByText(A_ANMAT_COMPLETO.denominacion!)).toBeInTheDocument();
      expect(within(modal).getByText(A_ANMAT_COMPLETO.marca!)).toBeInTheDocument();
      expect(within(modal).getByText(A_ANMAT_COMPLETO.categoria!)).toBeInTheDocument();
      // La fuente también debe aparecer en el modal
      expect(within(modal).getByText('ANMAT')).toBeInTheDocument();
    });

    it('el modal no muestra el id_alimento', async () => {
      vi.mocked(searchAlimentosAction).mockResolvedValue([A_ANMAT_COMPLETO]);
      const { user } = mount();
      await buscar(user, 'ace', A_ANMAT_COMPLETO.nombre);
      await user.click(screen.getByRole('button', { name: 'Ver detalle del alimento' }));

      const modal = screen.getByRole('dialog');
      expect(within(modal).queryByText(String(A_ANMAT_COMPLETO.id_alimento))).not.toBeInTheDocument();
    });

    it('el modal se cierra al hacer click en Cerrar', async () => {
      vi.mocked(searchAlimentosAction).mockResolvedValue([A_ANMAT_COMPLETO]);
      const { user } = mount();
      await buscar(user, 'ace', A_ANMAT_COMPLETO.nombre);
      await user.click(screen.getByRole('button', { name: 'Ver detalle del alimento' }));

      expect(screen.getByRole('dialog')).toBeInTheDocument();

      // El modal tiene dos botones "Cerrar": la X del header y el botón azul.
      // getByText apunta únicamente al botón azul con texto visible.
      await user.click(within(screen.getByRole('dialog')).getByText('Cerrar'));
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    });
  });

  // ── Campo marca en el dropdown ─────────────────────────────────────────────
  describe('campo marca en el dropdown', () => {
    it('muestra la marca cuando está presente', async () => {
      vi.mocked(searchAlimentosAction).mockResolvedValue([A_ANMAT_CON_MARCA_SIN_DENOM]);
      const { user } = mount();
      await buscar(user, 'nu', A_ANMAT_CON_MARCA_SIN_DENOM.nombre);
      expect(screen.getByText(A_ANMAT_CON_MARCA_SIN_DENOM.marca!)).toBeInTheDocument();
    });

    it('no renderiza texto de marca cuando es null', async () => {
      vi.mocked(searchAlimentosAction).mockResolvedValue([A_SARA2_VACIO]);
      const { user } = mount();
      await buscar(user, 'ag', A_SARA2_VACIO.nombre);
      expect(screen.queryByText('null')).not.toBeInTheDocument();
      expect(screen.queryByText('undefined')).not.toBeInTheDocument();
    });
  });

  // ── Comportamiento del buscador ────────────────────────────────────────────
  describe('comportamiento del buscador', () => {
    it('llama a searchAlimentosAction con el query y el tipo de ingesta', async () => {
      const { user } = mount();
      await user.type(screen.getByRole('textbox'), 'po');
      await waitFor(
        () => expect(vi.mocked(searchAlimentosAction)).toHaveBeenCalledWith(
          expect.stringContaining('po'),
          'almuerzo',
        ),
        { timeout: 1500 },
      );
    });

    it('no llama al action con menos de 2 caracteres', async () => {
      const { user } = mount();
      await user.type(screen.getByRole('textbox'), 'p');
      await new Promise((r) => setTimeout(r, 500));
      expect(vi.mocked(searchAlimentosAction)).not.toHaveBeenCalled();
    });

    it('muestra resultados de SARA2 y ANMAT en la misma lista', async () => {
      vi.mocked(searchAlimentosAction).mockResolvedValue([A_ANMAT_COMPLETO, A_SARA2_CON_CATEGORIA]);
      const { user } = mount();
      await buscar(user, 'ac', A_ANMAT_COMPLETO.nombre);
      expect(screen.getByText(A_ANMAT_COMPLETO.nombre)).toBeInTheDocument();
      expect(screen.getByText(A_SARA2_CON_CATEGORIA.nombre)).toBeInTheDocument();
    });

    it('muestra "Buscando..." mientras se espera la respuesta', async () => {
      vi.mocked(searchAlimentosAction).mockReturnValue(new Promise(() => {}));
      const { user } = mount();
      await user.type(screen.getByRole('textbox'), 'po');
      await screen.findByText('Buscando...', {}, { timeout: 1500 });
    });

    it('muestra el estado vacío cuando no hay resultados', async () => {
      vi.mocked(searchAlimentosAction).mockResolvedValue([]);
      const { user } = mount();
      await user.type(screen.getByRole('textbox'), 'xzxzxz');
      await screen.findByText(/No encontramos/, {}, { timeout: 1500 });
    });
  });
});
