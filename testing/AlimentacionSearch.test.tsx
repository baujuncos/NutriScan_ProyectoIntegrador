import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import AlimentacionClient from '@/app/alimentacion/AlimentacionClient';
import type { AlimentoOption } from '@/app/alimentacion/actions';
import { searchAlimentosAction, getAlimentosRecientesAction } from '@/app/alimentacion/actions';

// ─────────────────────────────────────────────────────────────────────────────
// Mocks
// ─────────────────────────────────────────────────────────────────────────────

vi.mock('@/lib/date', () => ({
  todayAR:   () => '2026-09-21',
  daysAgoAR: () => '2026-09-14',
}));

vi.mock('@/app/alimentacion/actions', () => ({
  searchAlimentosAction:        vi.fn().mockResolvedValue([]),
  getAlimentosRecientesAction:  vi.fn().mockResolvedValue([]),
  addItemAction:                vi.fn(),
  addManualItemAction:          vi.fn(),
  deleteItemAction:             vi.fn(),
  updateItemAction:             vi.fn(),
}));

vi.mock('@/app/alimentacion/AIRecognitionModal', () => ({ default: () => null }));
vi.mock('@/app/alimentacion/ChatFoodModal',      () => ({ default: () => null }));
vi.mock('@/app/alimentacion/BarcodeScannerModal', () => ({ default: () => null }));

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
 * El nombre de un resultado puede venir partido en varios nodos por el
 * `<mark>` del resaltado (`Ace` + `itunas...`), y `getByText(string)` solo
 * mira los text nodes directos — se matchea por `textContent` completo.
 */
const porNombre = (nombre: string) => (_: string, el: Element | null) => el?.textContent === nombre;

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
  await screen.findByText(porNombre(esperado), {}, { timeout: 1500 });
}

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

describe('Buscador de alimentos — integración ANMAT + SARA2', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(searchAlimentosAction).mockResolvedValue([]);
    vi.mocked(getAlimentosRecientesAction).mockResolvedValue([]);
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
      expect(within(modal).getByText(porNombre(A_ANMAT_COMPLETO.nombre))).toBeInTheDocument();
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

    it('clickear "?" no cierra el dropdown de resultados', async () => {
      vi.mocked(searchAlimentosAction).mockResolvedValue([A_ANMAT_COMPLETO]);
      const { user } = mount();
      await buscar(user, 'ace', A_ANMAT_COMPLETO.nombre);
      await user.click(screen.getByRole('button', { name: 'Ver detalle del alimento' }));
      await user.click(within(screen.getByRole('dialog')).getByText('Cerrar'));
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
      expect(screen.getByText(porNombre(A_ANMAT_COMPLETO.nombre))).toBeInTheDocument();
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
          { nombre: true, marca: true, denominacion: true },
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
      expect(screen.getByText(porNombre(A_ANMAT_COMPLETO.nombre))).toBeInTheDocument();
      expect(screen.getByText(porNombre(A_SARA2_CON_CATEGORIA.nombre))).toBeInTheDocument();
    });

    it('resalta con <mark> la parte del nombre que coincide con la búsqueda', async () => {
      vi.mocked(searchAlimentosAction).mockResolvedValue([A_ANMAT_COMPLETO]);
      const { user } = mount();
      await buscar(user, 'ace', A_ANMAT_COMPLETO.nombre);
      expect(screen.getByText('Ace', { selector: 'mark' })).toBeInTheDocument();
    });

    it('no resalta nada en "Recientes" (no hay búsqueda)', async () => {
      vi.mocked(getAlimentosRecientesAction).mockResolvedValue([A_ANMAT_COMPLETO]);
      const { user } = mount();
      await user.click(screen.getByRole('textbox'));
      await screen.findByText(A_ANMAT_COMPLETO.nombre);
      expect(document.querySelector('mark')).toBeNull();
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

  describe('ítems escaneados por código de barras (id_alimento_barcode)', () => {
    it('muestra el nombre del producto de alimentos_barcode en vez de "Alimento sin nombre"', () => {
      render(
        <AlimentacionClient
          ingesta={{
            id_ingesta: 1,
            tipo: 'almuerzo',
            kcal_total: 202.5,
            proteinas_total_g: 2.25,
            grasas_total_g: 9,
            carbs_total_g: 27,
            items: [
              {
                id_item: 1,
                id_alimento: null,
                nombre_manual: null,
                tipo_item: 'solido',
                cantidad: 45,
                kcal: 202.5,
                proteinas_g: 2.25,
                grasas_g: 9,
                carbs_g: 27,
                alimentos: null,
                id_alimento_barcode: 10,
                alimentos_barcode: { nombre: 'Alfajor Triple', marca: 'Havanna' },
              },
            ],
          }}
          tipoIngesta="almuerzo"
          fecha="2026-09-21"
          hideNutrition={false}
        />,
      );

      expect(screen.getByText('Alfajor Triple')).toBeInTheDocument();
      expect(screen.queryByText('Alimento sin nombre')).not.toBeInTheDocument();
    });
  });

  describe('rol deportista (hideNutrition): solo ve gramos, no kcal/macros', () => {
    const INGESTA_UN_ITEM = {
      id_ingesta: 1,
      tipo: 'almuerzo' as const,
      kcal_total: 202.5,
      proteinas_total_g: 2.25,
      grasas_total_g: 9,
      carbs_total_g: 27,
      items: [
        {
          id_item: 1,
          id_alimento: 42,
          nombre_manual: null,
          tipo_item: 'solido',
          cantidad: 45,
          kcal: 202.5,
          proteinas_g: 2.25,
          grasas_g: 9,
          carbs_g: 27,
          alimentos: { nombre: 'Arroz blanco', categoria: 'Cereales' },
        },
      ],
    };

    it('sigue mostrando los gramos del ítem aunque hideNutrition sea true', () => {
      render(
        <AlimentacionClient
          ingesta={INGESTA_UN_ITEM}
          tipoIngesta="almuerzo"
          fecha="2026-09-21"
          hideNutrition={true}
        />,
      );

      expect(screen.getByText('45 g')).toBeInTheDocument();
      expect(screen.queryByText(/203 kcal|202\.5 kcal/)).not.toBeInTheDocument();
      expect(screen.queryByText(/^P /)).not.toBeInTheDocument();
    });

    it('con hideNutrition en false, sigue mostrando gramos y kcal/macros (no se toca el rol particular)', () => {
      render(
        <AlimentacionClient
          ingesta={INGESTA_UN_ITEM}
          tipoIngesta="almuerzo"
          fecha="2026-09-21"
          hideNutrition={false}
        />,
      );

      expect(screen.getByText('45 g')).toBeInTheDocument();
      expect(screen.getAllByText('203 kcal').length).toBeGreaterThan(0);
    });
  });

  describe('botón "×" de limpiar búsqueda', () => {
    it('aparece solo cuando hay texto y limpia el input al clickear', async () => {
      vi.mocked(searchAlimentosAction).mockResolvedValue([A_SARA2_CON_CATEGORIA]);
      const { user } = mount();
      expect(screen.queryByRole('button', { name: 'Limpiar búsqueda' })).not.toBeInTheDocument();

      await buscar(user, 'ar', A_SARA2_CON_CATEGORIA.nombre);
      await user.click(screen.getByRole('button', { name: 'Limpiar búsqueda' }));

      expect(screen.getByRole('textbox')).toHaveValue('');
      expect(screen.queryByText(porNombre(A_SARA2_CON_CATEGORIA.nombre))).not.toBeInTheDocument();
    });

    it('una respuesta de búsqueda que resuelve después de limpiar no repuebla el dropdown', async () => {
      let resolverBusqueda: (v: AlimentoOption[]) => void = () => {};
      vi.mocked(searchAlimentosAction).mockReturnValue(new Promise((resolve) => { resolverBusqueda = resolve; }));
      const { user } = mount();

      await user.type(screen.getByRole('textbox'), 'ar');
      // Esperar a que venza el debounce de 300ms y la búsqueda real arranque
      // (quede "en vuelo") antes de limpiar — si no, el cleanup del effect
      // cancela el setTimeout antes de que searchAlimentosAction se llegue a
      // llamar, y el test no prueba la carrera real.
      await waitFor(() => expect(searchAlimentosAction).toHaveBeenCalled());
      await user.click(screen.getByRole('button', { name: 'Limpiar búsqueda' }));
      // El input nunca pierde el foco real (el botón "×" usa preventDefault
      // en mousedown justamente para eso), así que un click no dispara un
      // nuevo evento focus — se dispara el evento a mano para reabrir el
      // dropdown (showDropdown=true) con query vacía, que es el momento en
      // que la respuesta vieja, si no se descarta, se colaría igual aunque
      // el usuario ya limpió y no está tipeando nada.
      fireEvent.focus(screen.getByRole('textbox'));
      resolverBusqueda([A_SARA2_CON_CATEGORIA]);

      await new Promise((r) => setTimeout(r, 50));
      expect(screen.queryByText(porNombre(A_SARA2_CON_CATEGORIA.nombre))).not.toBeInTheDocument();
    });
  });

  describe('filtros de búsqueda (Nombre/Marca/Denominación)', () => {
    it('el toggle "Buscar" revela los 3 checkboxes, todos tildados por default', async () => {
      const { user } = mount();
      expect(screen.queryByRole('checkbox', { name: 'Nombre' })).not.toBeInTheDocument();
      await user.click(screen.getByRole('button', { name: /buscar/i }));
      expect(screen.getByRole('checkbox', { name: 'Nombre' })).toBeChecked();
      expect(screen.getByRole('checkbox', { name: 'Marca' })).toBeChecked();
      expect(screen.getByRole('checkbox', { name: 'Denominación' })).toBeChecked();
    });

    it('destildar un campo lo manda en false al server action', async () => {
      vi.mocked(searchAlimentosAction).mockResolvedValue([]);
      const { user } = mount();
      await user.click(screen.getByRole('button', { name: /buscar/i }));
      await user.click(screen.getByRole('checkbox', { name: 'Marca' }));
      await user.type(screen.getByRole('textbox'), 'ar');
      await waitFor(() => expect(searchAlimentosAction).toHaveBeenCalledWith('ar', 'almuerzo', { nombre: true, marca: false, denominacion: true }));
    });

    it('desmarcar los 3 campos muestra un aviso de "elegí al menos un campo", no "sin resultados"', async () => {
      const { user } = mount();
      await user.click(screen.getByRole('button', { name: /buscar/i }));
      await user.click(screen.getByRole('checkbox', { name: 'Nombre' }));
      await user.click(screen.getByRole('checkbox', { name: 'Marca' }));
      await user.click(screen.getByRole('checkbox', { name: 'Denominación' }));
      await user.type(screen.getByRole('textbox'), 'ar');
      expect(await screen.findByText(/elegí al menos un campo/i)).toBeInTheDocument();
      expect(screen.queryByText(/no encontramos/i)).not.toBeInTheDocument();
    });

    it('mientras busca, no se renderiza (ni vacío) el contenedor de "sin resultados" encima de "Buscando..."', async () => {
      vi.mocked(searchAlimentosAction).mockReturnValue(new Promise(() => {}));
      const { user } = mount();
      await user.type(screen.getByRole('textbox'), 'xyz');
      await screen.findByText('Buscando...', {}, { timeout: 1500 });
      expect(screen.queryByTestId('dropdown-sin-resultados')).not.toBeInTheDocument();
    });

    it('"Quitar filtros" vuelve a tildar los 3 campos', async () => {
      vi.mocked(searchAlimentosAction).mockResolvedValue([]);
      const { user } = mount();
      await user.click(screen.getByRole('button', { name: /buscar/i }));
      await user.click(screen.getByRole('checkbox', { name: 'Marca' }));
      await user.type(screen.getByRole('textbox'), 'xyz');
      await screen.findByText(/no encontramos/i);
      await user.click(screen.getByRole('button', { name: 'Quitar filtros' }));
      expect(screen.getByRole('checkbox', { name: 'Marca' })).toBeChecked();
    });
  });

  describe('sección "Recientes"', () => {
    it('se muestra al enfocar el buscador vacío', async () => {
      vi.mocked(getAlimentosRecientesAction).mockResolvedValue([A_SARA2_CON_CATEGORIA]);
      const { user } = mount();
      await user.click(screen.getByRole('textbox'));
      expect(await screen.findByText(porNombre(A_SARA2_CON_CATEGORIA.nombre))).toBeInTheDocument();
      expect(screen.getByText('Recientes')).toBeInTheDocument();
    });

    it('desaparece en cuanto se empieza a tipear', async () => {
      vi.mocked(getAlimentosRecientesAction).mockResolvedValue([A_SARA2_CON_CATEGORIA]);
      vi.mocked(searchAlimentosAction).mockResolvedValue([]);
      const { user } = mount();
      await user.click(screen.getByRole('textbox'));
      await screen.findByText('Recientes');
      await user.type(screen.getByRole('textbox'), 'xy');
      await waitFor(() => expect(screen.queryByText('Recientes')).not.toBeInTheDocument());
    });
  });

  describe('selector de cantidad del formulario de agregar', () => {
    it('clickear un botón rápido actualiza la cantidad y el submit queda habilitado', async () => {
      vi.mocked(searchAlimentosAction).mockResolvedValue([A_SARA2_CON_CATEGORIA]);
      const { user } = mount();
      await buscar(user, 'ar', A_SARA2_CON_CATEGORIA.nombre);
      await user.click(screen.getByText(porNombre(A_SARA2_CON_CATEGORIA.nombre)));
      await user.click(screen.getByRole('button', { name: '150 g' }));
      expect(screen.getByRole('button', { name: /agregar a/i })).toBeEnabled();
    });

    it('cambiar de alimento seleccionado resetea la cantidad a 50 g', async () => {
      vi.mocked(searchAlimentosAction).mockResolvedValue([A_SARA2_CON_CATEGORIA, A_ANMAT_CON_MARCA_SIN_DENOM]);
      const { user } = mount();
      await buscar(user, 'ar', A_SARA2_CON_CATEGORIA.nombre);
      await user.click(screen.getByText(porNombre(A_SARA2_CON_CATEGORIA.nombre)));
      await user.click(screen.getByRole('button', { name: 'Personalizar' }));
      await user.clear(screen.getByPlaceholderText('Cantidad en gramos'));
      await user.type(screen.getByPlaceholderText('Cantidad en gramos'), '1200');

      await user.click(screen.getByRole('button', { name: 'Quitar selección' }));
      await buscar(user, 'nu', A_ANMAT_CON_MARCA_SIN_DENOM.nombre);
      await user.click(screen.getByText(porNombre(A_ANMAT_CON_MARCA_SIN_DENOM.nombre)));

      expect(screen.getByRole('button', { name: '50 g' })).toHaveClass('text-white');
    });

    it('tipear un valor inválido en "Personalizar" deshabilita el submit', async () => {
      vi.mocked(searchAlimentosAction).mockResolvedValue([A_SARA2_CON_CATEGORIA]);
      const { user } = mount();
      await buscar(user, 'ar', A_SARA2_CON_CATEGORIA.nombre);
      await user.click(screen.getByText(porNombre(A_SARA2_CON_CATEGORIA.nombre)));
      await user.click(screen.getByRole('button', { name: 'Personalizar' }));
      await user.clear(screen.getByPlaceholderText('Cantidad en gramos'));
      expect(screen.getByRole('button', { name: /agregar a/i })).toBeDisabled();
    });

    it('muestra el aviso de ANMAT sin valores cuando el alimento seleccionado no tiene macros', async () => {
      const sinValores: AlimentoOption = { ...A_ANMAT_VACIO, kcal_100g: null, proteinas_100g: null, grasas_100g: null, carbs_100g: null };
      vi.mocked(searchAlimentosAction).mockResolvedValue([sinValores]);
      const { user } = mount();
      await buscar(user, 'prod', sinValores.nombre);
      await user.click(screen.getByText(porNombre(sinValores.nombre)));
      expect(await screen.findByText(/no tiene valores nutricionales/i)).toBeInTheDocument();
    });

    it('con hideNutrition en true, NO muestra el aviso de ANMAT sin valores (no filtra información nutricional a un rol bloqueado)', async () => {
      const sinValores: AlimentoOption = { ...A_ANMAT_VACIO, kcal_100g: null, proteinas_100g: null, grasas_100g: null, carbs_100g: null };
      vi.mocked(searchAlimentosAction).mockResolvedValue([sinValores]);
      const user = userEvent.setup();
      render(
        <AlimentacionClient
          ingesta={null}
          tipoIngesta="almuerzo"
          fecha="2026-09-21"
          hideNutrition={true}
        />,
      );
      await buscar(user, 'prod', sinValores.nombre);
      await user.click(screen.getByText(porNombre(sinValores.nombre)));
      expect(screen.queryByText(/no tiene valores nutricionales/i)).not.toBeInTheDocument();
    });

    it('"Quitar selección" también limpia el texto del buscador, no solo la selección', async () => {
      vi.mocked(searchAlimentosAction).mockResolvedValue([A_SARA2_CON_CATEGORIA]);
      const { user } = mount();
      await buscar(user, 'ar', A_SARA2_CON_CATEGORIA.nombre);
      await user.click(screen.getByText(porNombre(A_SARA2_CON_CATEGORIA.nombre)));
      await user.click(screen.getByRole('button', { name: 'Quitar selección' }));
      expect(screen.getByRole('textbox')).toHaveValue('');
    });

    it('cerrar el modal de carga manual también limpia el texto del buscador', async () => {
      vi.mocked(searchAlimentosAction).mockResolvedValue([]);
      const { user } = mount();
      await user.type(screen.getByRole('textbox'), 'xyz');
      await screen.findByText(/no encontramos/i);
      await user.click(screen.getByText('Cargar alimento manualmente'));
      await user.click(within(screen.getByRole('dialog')).getByText('Cancelar'));
      expect(screen.getByRole('textbox')).toHaveValue('');
    });
  });

  it('el nombre del ítem cargado tiene title para ver el nombre completo si está truncado', () => {
    render(
      <AlimentacionClient
        ingesta={{
          id_ingesta: 1, tipo: 'almuerzo',
          kcal_total: 100, proteinas_total_g: 5, grasas_total_g: 2, carbs_total_g: 10,
          items: [{
            id_item: 1, id_alimento: 1, nombre_manual: null, tipo_item: 'solido',
            cantidad: 100, kcal: 100, proteinas_g: 5, grasas_g: 2, carbs_g: 10,
            alimentos: { nombre: 'Un nombre de alimento muy pero muy largo para una fila', categoria: null },
          }],
        }}
        tipoIngesta="almuerzo"
        fecha="2026-09-21"
        hideNutrition={false}
      />,
    );
    expect(screen.getByText('Un nombre de alimento muy pero muy largo para una fila'))
      .toHaveAttribute('title', 'Un nombre de alimento muy pero muy largo para una fila');
  });
});
