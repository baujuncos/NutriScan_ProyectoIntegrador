import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import BarcodeScannerModal from '@/app/alimentacion/BarcodeScannerModal';
import { obtenerProductoPorEAN } from '@/lib/openFoodFacts';
import { addScannedItemAction } from '@/app/alimentacion/actions';

const mockStart = vi.fn().mockResolvedValue(null);
const mockStop = vi.fn().mockResolvedValue(undefined);
const mockClear = vi.fn();
const mockScanFileV2 = vi.fn();

vi.mock('html5-qrcode', () => ({
  // Arrow functions can't be invoked with `new` — the real Html5Qrcode is a
  // class, and the component correctly does `new Html5Qrcode(...)`, so the
  // mock constructor must be a regular function.
  Html5Qrcode: vi.fn().mockImplementation(function () {
    return {
      start: mockStart,
      stop: mockStop,
      clear: mockClear,
      scanFileV2: mockScanFileV2,
    };
  }),
  Html5QrcodeSupportedFormats: { EAN_13: 9 },
}));

vi.mock('@/lib/openFoodFacts', () => ({
  obtenerProductoPorEAN: vi.fn(),
}));

vi.mock('@/app/alimentacion/actions', () => ({
  addScannedItemAction: vi.fn().mockResolvedValue(undefined),
}));

const PRODUCTO_OK = {
  encontrado: true as const,
  ean: '7790040000100',
  nombre: 'Alfajor Triple',
  categoria: 'Snacks dulces',
  marca: 'Havanna',
  porcion: 45,
  nutrientes100g: { kcal: 450, proteinas: 5, grasas: 20, carbs: 60 },
  imagenUrl: null,
  esSuplemento: false,
  porcionEtiqueta: null,
  pesoNetoTotal: null,
  infoAmpliada: { nutriscore: null, novaGroup: null, sinGluten: false, vegano: false, vegetariano: false },
};

function mockPointerCoarse(coarse: boolean) {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: query === '(pointer: coarse)' ? coarse : false,
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  })) as unknown as typeof window.matchMedia;
}

function renderModal(props: Partial<React.ComponentProps<typeof BarcodeScannerModal>> = {}) {
  const onClose = vi.fn();
  const user = userEvent.setup();
  const { rerender } = render(
    <BarcodeScannerModal
      open
      onClose={onClose}
      fecha="2026-09-21"
      tipoIngesta="almuerzo"
      hideNutrition={false}
      {...props}
    />,
  );
  // `onClose` es un mock: no cambia `open` solo. Un test que necesite simular
  // lo que hace AlimentacionClient en producción (bajar `open` a false cuando
  // se llama onClose) puede pasar rerenderWithOpen(false).
  const rerenderWithOpen = (open: boolean) =>
    rerender(
      <BarcodeScannerModal
        open={open}
        onClose={onClose}
        fecha="2026-09-21"
        tipoIngesta="almuerzo"
        hideNutrition={false}
        {...props}
      />,
    );
  return { onClose, user, rerenderWithOpen };
}

async function simularEscaneo() {
  await waitFor(() => expect(mockStart).toHaveBeenCalled());
  const successCallback = mockStart.mock.calls[0][2] as (decodedText: string) => void;
  await act(async () => successCallback('7790040000100'));
}

beforeEach(() => {
  vi.clearAllMocks();
  mockPointerCoarse(true);
  vi.mocked(obtenerProductoPorEAN).mockResolvedValue(PRODUCTO_OK);
});

describe('BarcodeScannerModal — captura', () => {
  it('en dispositivo táctil, la pestaña "Escanear con cámara" está activa por defecto y arranca restringida a EAN_13', async () => {
    renderModal();
    expect(screen.getByRole('button', { name: 'Escanear con cámara' })).toHaveClass('bg-white');
    await waitFor(() => expect(mockStart).toHaveBeenCalled());

    const { Html5Qrcode } = await import('html5-qrcode');
    expect(vi.mocked(Html5Qrcode).mock.calls[0][1]).toMatchObject({
      formatsToSupport: [9],
    });
  });

  it('en desktop (sin pointer coarse), no arranca la cámara automáticamente', async () => {
    mockPointerCoarse(false);
    renderModal();
    await new Promise((r) => setTimeout(r, 0));
    expect(mockStart).not.toHaveBeenCalled();
  });

  it('en desktop, la pestaña de cámara no existe (ni como botón)', async () => {
    mockPointerCoarse(false);
    renderModal();
    expect(screen.queryByRole('button', { name: 'Escanear con cámara' })).not.toBeInTheDocument();
    expect(screen.getByText(/arrastrá una imagen/i)).toBeInTheDocument();
  });

  it('en móvil, ambas pestañas existen', async () => {
    mockPointerCoarse(true);
    renderModal();
    expect(screen.getByRole('button', { name: 'Escanear con cámara' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Elegir de galería' })).toBeInTheDocument();
  });

  it('al elegir un archivo, pasa a la pantalla de recorte en vez de decodificar directo', async () => {
    mockPointerCoarse(false);
    const { user } = renderModal();
    const file = new File(['contenido'], 'codigo.jpg', { type: 'image/jpeg' });

    await user.upload(screen.getByLabelText('Subir imagen del código de barras'), file);

    expect(mockScanFileV2).not.toHaveBeenCalled();
    expect(await screen.findByRole('button', { name: 'Procesar código' })).toBeInTheDocument();
  });

  it('"Procesar código" decodifica la imagen y avanza a confirmar', async () => {
    mockPointerCoarse(false);
    mockScanFileV2.mockResolvedValue({ decodedText: '7790040000100' });
    const { user } = renderModal();
    const file = new File(['contenido'], 'codigo.jpg', { type: 'image/jpeg' });
    await user.upload(screen.getByLabelText('Subir imagen del código de barras'), file);

    await user.click(await screen.findByRole('button', { name: 'Procesar código' }));

    expect(await screen.findByText('¿Es este tu alimento?')).toBeInTheDocument();
    expect(obtenerProductoPorEAN).toHaveBeenCalledWith('7790040000100');
  });

  it('si no decodifica, muestra error y se queda en la pantalla de recorte', async () => {
    mockPointerCoarse(false);
    mockScanFileV2.mockRejectedValue(new Error('no barcode found'));
    const { user } = renderModal();
    const file = new File(['contenido'], 'codigo.jpg', { type: 'image/jpeg' });
    await user.upload(screen.getByLabelText('Subir imagen del código de barras'), file);

    await user.click(await screen.findByRole('button', { name: 'Procesar código' }));

    expect(await screen.findByText(/no pudimos leer un código ean-13/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Procesar código' })).toBeInTheDocument();
  });

  it('"← Volver" desde la pantalla de recorte regresa al origen', async () => {
    mockPointerCoarse(false);
    const { user } = renderModal();
    const file = new File(['contenido'], 'codigo.jpg', { type: 'image/jpeg' });
    await user.upload(screen.getByLabelText('Subir imagen del código de barras'), file);
    await screen.findByRole('button', { name: 'Procesar código' });

    await user.click(screen.getByRole('button', { name: /volver/i }));

    expect(screen.getByText(/arrastrá una imagen/i)).toBeInTheDocument();
  });

  it('detiene la cámara (stop + clear) al cerrar el modal', async () => {
    const { user } = renderModal();
    await waitFor(() => expect(mockStart).toHaveBeenCalled());

    await user.click(screen.getByLabelText('Cerrar'));

    await waitFor(() => expect(mockStop).toHaveBeenCalled());
    expect(mockClear).toHaveBeenCalled();
  });

  it('al detectar un EAN por cámara, detiene el escaneo y consulta obtenerProductoPorEAN', async () => {
    renderModal();
    await simularEscaneo();

    await waitFor(() => expect(mockStop).toHaveBeenCalled());
    expect(obtenerProductoPorEAN).toHaveBeenCalledWith('7790040000100');
    expect(await screen.findByText('¿Es este tu alimento?')).toBeInTheDocument();
  });

  it('si el modal se cierra mientras start() todavía está pendiente, igual detiene la cámara cuando termina de arrancar', async () => {
    // Reproduce el estado real de html5-qrcode: stop() rechaza si se llama
    // antes de que start() haya resuelto ("Cannot stop, scanner is not
    // running"). El primer stop() (disparado por el cierre del modal) cae en
    // esa ventana y falla; solo un segundo intento, después de que start()
    // resuelva, puede apagar la cámara de verdad.
    let resolveStart!: () => void;
    mockStart.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveStart = () => resolve(null);
        }),
    );
    mockStop
      .mockImplementationOnce(() => Promise.reject(new Error('Cannot stop, scanner is not running.')))
      .mockImplementationOnce(() => Promise.resolve(undefined));

    const { user, rerenderWithOpen } = renderModal();
    await waitFor(() => expect(mockStart).toHaveBeenCalled());

    // Igual que en producción: cerrar dispara handleClose (detenerCamara()
    // directo, que acá falla) y el padre baja `open` a false, lo que además
    // dispara el cleanup del efecto de escaneo.
    await user.click(screen.getByLabelText('Cerrar'));
    rerenderWithOpen(false);
    await waitFor(() => expect(mockStop).toHaveBeenCalledTimes(1));

    // Ahora start() resuelve "tarde": la cámara recién queda realmente viva acá.
    await act(async () => {
      resolveStart();
    });

    await waitFor(() => expect(mockStop).toHaveBeenCalledTimes(2));
  });
});

const PRODUCTO_SUPLEMENTO = {
  ...PRODUCTO_OK,
  nombre: 'Proteína Whey',
  esSuplemento: true,
};

describe('BarcodeScannerModal — rol deportista (hideNutrition)', () => {
  it('oculta kcal/macros, el botón de ampliar información y la aclaración de base nutricional', async () => {
    vi.mocked(obtenerProductoPorEAN).mockResolvedValue({ ...PRODUCTO_OK, porcionEtiqueta: '2 galletitas (30g)' });
    renderModal({ hideNutrition: true });
    await simularEscaneo();
    await screen.findByText('¿Es este tu alimento?');

    expect(screen.queryByText('450.0')).not.toBeInTheDocument();
    expect(screen.queryByText(/valores expresados cada 100g \/ 100ml/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /ampliar información/i })).not.toBeInTheDocument();
  });

  it('igual muestra la porción sugerida en el envoltorio (son gramos, no datos nutricionales)', async () => {
    vi.mocked(obtenerProductoPorEAN).mockResolvedValue({ ...PRODUCTO_OK, porcionEtiqueta: '2 galletitas (30g)' });
    renderModal({ hideNutrition: true });
    await simularEscaneo();

    expect(await screen.findByText(/porción sugerida en envoltorio: 2 galletitas \(30g\)/i)).toBeInTheDocument();
  });

  it('en el paso de porción, sigue mostrando los gramos de cada botón', async () => {
    const { user } = renderModal({ hideNutrition: true });
    await irAModo(user);
    await user.click(screen.getByRole('button', { name: 'Por Porción del Fabricante' }));

    expect(screen.getByRole('button', { name: /^1 porción/ })).toHaveTextContent('45 g');
  });
});

describe('BarcodeScannerModal — confirmación ampliada', () => {
  it('muestra los macros con 1 decimal y la aclaración de base nutricional', async () => {
    renderModal();
    await simularEscaneo();
    await screen.findByText('¿Es este tu alimento?');

    expect(screen.getByText('450.0')).toBeInTheDocument();
    expect(screen.getByText(/valores expresados cada 100g \/ 100ml/i)).toBeInTheDocument();
  });

  it('muestra la porción sugerida en el envoltorio cuando existe', async () => {
    vi.mocked(obtenerProductoPorEAN).mockResolvedValue({ ...PRODUCTO_OK, porcionEtiqueta: '2.5 galletitas (30g)' });
    renderModal();
    await simularEscaneo();

    expect(await screen.findByText(/porción sugerida en envoltorio: 2\.5 galletitas \(30g\)/i)).toBeInTheDocument();
  });

  it('no muestra la línea de porción sugerida cuando no hay etiqueta', async () => {
    renderModal();
    await simularEscaneo();
    await screen.findByText('¿Es este tu alimento?');

    expect(screen.queryByText(/porción sugerida en envoltorio/i)).not.toBeInTheDocument();
  });

  it('muestra el aviso de suplemento cuando el producto es un suplemento', async () => {
    vi.mocked(obtenerProductoPorEAN).mockResolvedValue(PRODUCTO_SUPLEMENTO);
    renderModal();
    await simularEscaneo();

    expect(await screen.findByText(/detectamos que es un suplemento/i)).toBeInTheDocument();
  });

  it('"Ampliar información" muestra Nutri-Score, NOVA y badges cuando hay datos', async () => {
    vi.mocked(obtenerProductoPorEAN).mockResolvedValue({
      ...PRODUCTO_OK,
      infoAmpliada: { nutriscore: 'b', novaGroup: 3, sinGluten: true, vegano: false, vegetariano: true },
    });
    const { user } = renderModal();
    await simularEscaneo();
    await screen.findByText('¿Es este tu alimento?');

    await user.click(screen.getByRole('button', { name: /ampliar información/i }));

    expect(screen.getByText('B')).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();
    expect(screen.getByText('Procesado')).toBeInTheDocument();
    expect(screen.getByText('Sin Gluten')).toBeInTheDocument();
    expect(screen.getByText('Vegetariano')).toBeInTheDocument();
    expect(screen.queryByText('Vegano')).not.toBeInTheDocument();
  });

  it('"Ampliar información" muestra el mensaje de fallback cuando no hay ningún dato', async () => {
    vi.mocked(obtenerProductoPorEAN).mockResolvedValue({
      ...PRODUCTO_OK,
      infoAmpliada: { nutriscore: null, novaGroup: null, sinGluten: false, vegano: false, vegetariano: false },
    });
    const { user } = renderModal();
    await simularEscaneo();
    await screen.findByText('¿Es este tu alimento?');

    await user.click(screen.getByRole('button', { name: /ampliar información/i }));

    expect(screen.getByText(/no tiene esta información para este producto/i)).toBeInTheDocument();
  });

  it('"Sí, es correcto" lleva a la pantalla de elegir modo de registro', async () => {
    const { user } = renderModal();
    await simularEscaneo();
    await user.click(await screen.findByRole('button', { name: 'Sí, es correcto' }));

    expect(await screen.findByText(/cómo deseas registrar tu ingesta/i)).toBeInTheDocument();
  });

  it('"← Volver" desde confirmar regresa al origen', async () => {
    const { user } = renderModal();
    await simularEscaneo();
    await screen.findByText('¿Es este tu alimento?');

    await user.click(screen.getByRole('button', { name: /volver/i }));

    expect(screen.getByText(/arrastrá una imagen|escanear con cámara/i)).toBeInTheDocument();
  });
});

async function irAModo(user: ReturnType<typeof userEvent.setup>) {
  await simularEscaneo();
  await user.click(await screen.findByRole('button', { name: 'Sí, es correcto' }));
}

describe('BarcodeScannerModal — stage paquete', () => {
  it('botones fijos calculan gramos desde pesoNetoTotal y están habilitados', async () => {
    vi.mocked(obtenerProductoPorEAN).mockResolvedValue({ ...PRODUCTO_OK, pesoNetoTotal: 150 });
    const { user } = renderModal();
    await irAModo(user);
    await user.click(screen.getByRole('button', { name: 'Por Paquete Completo' }));

    const entero = screen.getByRole('button', { name: /entero \(1 envase\)/i });
    expect(entero).toBeEnabled();
    expect(entero).toHaveTextContent('150 g');
    expect(screen.getByRole('button', { name: /mitad \(1\/2\)/i })).toHaveTextContent('75 g');
    expect(screen.getByRole('button', { name: /un cuarto \(1\/4\)/i })).toHaveTextContent('38 g');
    expect(screen.getByRole('button', { name: /un quinto \(1\/5\)/i })).toHaveTextContent('30 g');
  });

  it('botones fijos deshabilitados y nota visible cuando no hay pesoNetoTotal', async () => {
    vi.mocked(obtenerProductoPorEAN).mockResolvedValue({ ...PRODUCTO_OK, pesoNetoTotal: null });
    const { user } = renderModal();
    await irAModo(user);
    await user.click(screen.getByRole('button', { name: 'Por Paquete Completo' }));

    expect(screen.getByRole('button', { name: /entero \(1 envase\)/i })).toBeDisabled();
    expect(screen.getByText(/no pudimos leer el peso del envase/i)).toBeInTheDocument();
  });

  it('"Personalizar fracción/peso" permite ingresar gramos aunque no haya pesoNetoTotal', async () => {
    vi.mocked(obtenerProductoPorEAN).mockResolvedValue({ ...PRODUCTO_OK, pesoNetoTotal: null });
    const { user } = renderModal();
    await irAModo(user);
    await user.click(screen.getByRole('button', { name: 'Por Paquete Completo' }));

    await user.click(screen.getByRole('button', { name: /personalizar fracción\/peso/i }));
    await user.type(screen.getByLabelText(/gramos consumidos/i), '45');
    await user.click(screen.getByRole('button', { name: 'Guardar' }));

    await waitFor(() => expect(addScannedItemAction).toHaveBeenCalled());
    const formData = vi.mocked(addScannedItemAction).mock.calls[0][0] as FormData;
    expect(formData.get('cantidad')).toBe('45');
  });

  it('deshabilita un botón fijo cuyo gramaje supera el máximo permitido (2000g)', async () => {
    vi.mocked(obtenerProductoPorEAN).mockResolvedValue({ ...PRODUCTO_OK, pesoNetoTotal: 3000 });
    const { user } = renderModal();
    await irAModo(user);
    await user.click(screen.getByRole('button', { name: 'Por Paquete Completo' }));

    // Entero = 3000g (> 2000, deshabilitado); Mitad = 1500g (habilitado)
    expect(screen.getByRole('button', { name: /entero \(1 envase\)/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /mitad \(1\/2\)/i })).toBeEnabled();
  });

  it('"Guardar" de Personalizar fracción/peso está deshabilitado sin un valor válido o por encima del máximo', async () => {
    vi.mocked(obtenerProductoPorEAN).mockResolvedValue({ ...PRODUCTO_OK, pesoNetoTotal: null });
    const { user } = renderModal();
    await irAModo(user);
    await user.click(screen.getByRole('button', { name: 'Por Paquete Completo' }));
    await user.click(screen.getByRole('button', { name: /personalizar fracción\/peso/i }));

    expect(screen.getByRole('button', { name: 'Guardar' })).toBeDisabled();

    await user.type(screen.getByLabelText(/gramos consumidos/i), '2500');
    expect(screen.getByRole('button', { name: 'Guardar' })).toBeDisabled();

    await user.clear(screen.getByLabelText(/gramos consumidos/i));
    await user.type(screen.getByLabelText(/gramos consumidos/i), '45');
    expect(screen.getByRole('button', { name: 'Guardar' })).toBeEnabled();
  });

  it('envía tipo_ingesta=suplemento cuando el producto es un suplemento, incluso en otra comida', async () => {
    vi.mocked(obtenerProductoPorEAN).mockResolvedValue({ ...PRODUCTO_OK, esSuplemento: true, pesoNetoTotal: 100 });
    const { user } = renderModal();
    await irAModo(user);
    await user.click(screen.getByRole('button', { name: 'Por Paquete Completo' }));

    await user.click(screen.getByRole('button', { name: /entero \(1 envase\)/i }));

    await waitFor(() => expect(addScannedItemAction).toHaveBeenCalled());
    const formData = vi.mocked(addScannedItemAction).mock.calls[0][0] as FormData;
    expect(formData.get('tipo_ingesta')).toBe('suplemento');
  });

  it('"← Volver" desde paquete regresa a la pantalla de modo', async () => {
    const { user } = renderModal();
    await irAModo(user);
    await user.click(screen.getByRole('button', { name: 'Por Paquete Completo' }));

    await user.click(screen.getByRole('button', { name: /volver/i }));

    expect(screen.getByText(/cómo deseas registrar tu ingesta/i)).toBeInTheDocument();
  });
});

describe('BarcodeScannerModal — confirmación y porción', () => {
  it('"No, es otro" pasa a la pantalla de descarte sugiriendo otro método', async () => {
    const { user } = renderModal();
    await simularEscaneo();
    await screen.findByText('¿Es este tu alimento?');

    await user.click(screen.getByRole('button', { name: 'No, es otro' }));

    expect(
      await screen.findByText(/te sugerimos usar otro método de registro/i),
    ).toBeInTheDocument();
  });

  it('si el producto no se encuentra (o sin datos nutricionales), va directo a la pantalla de descarte', async () => {
    vi.mocked(obtenerProductoPorEAN).mockResolvedValue({ encontrado: false, ean: '0000000000000' });
    renderModal();
    await simularEscaneo();

    expect(
      await screen.findByText(/no pudimos encontrar datos nutricionales confiables/i),
    ).toBeInTheDocument();
  });

  it('"Escanear otro código" vuelve a la pantalla inicial', async () => {
    vi.mocked(obtenerProductoPorEAN).mockResolvedValue({ encontrado: false, ean: '0000000000000' });
    const { user } = renderModal();
    await simularEscaneo();
    await screen.findByText(/no pudimos encontrar datos nutricionales confiables/i);

    await user.click(screen.getByRole('button', { name: 'Escanear otro código' }));

    expect(screen.getByRole('button', { name: 'Escanear con cámara' })).toBeInTheDocument();
  });
});

describe('BarcodeScannerModal — stage porción', () => {
  it('muestra la aclaración de a qué equivale 1 porción (porcionEtiqueta)', async () => {
    vi.mocked(obtenerProductoPorEAN).mockResolvedValue({ ...PRODUCTO_OK, porcionEtiqueta: '2.5 galletitas (30g)' });
    const { user } = renderModal();
    await irAModo(user);
    await user.click(screen.getByRole('button', { name: 'Por Porción del Fabricante' }));

    expect(screen.getByText(/1 porción equivale a: 2\.5 galletitas \(30g\)/i)).toBeInTheDocument();
  });

  it('usa "{porcion} g" como fallback cuando no hay porcionEtiqueta', async () => {
    const { user } = renderModal(); // PRODUCTO_OK: porcion=45, sin porcionEtiqueta
    await irAModo(user);
    await user.click(screen.getByRole('button', { name: 'Por Porción del Fabricante' }));

    expect(screen.getByText(/1 porción equivale a: 45 g/i)).toBeInTheDocument();
  });

  it('los 4 botones fijos (1/2, 1, 2, 3) calculan gramos desde porcion', async () => {
    const { user } = renderModal(); // porcion = 45
    await irAModo(user);
    await user.click(screen.getByRole('button', { name: 'Por Porción del Fabricante' }));

    expect(screen.getByRole('button', { name: /1\/2 porción/i })).toHaveTextContent('23 g');
    expect(screen.getByRole('button', { name: /^1 porción/ })).toHaveTextContent('45 g');
    expect(screen.getByRole('button', { name: /2 porciones/i })).toHaveTextContent('90 g');
    expect(screen.getByRole('button', { name: /3 porciones/i })).toHaveTextContent('135 g');
  });

  it('al elegir un botón fijo, llama a addScannedItemAction con fecha/tipo_ingesta/ean/cantidad correctos', async () => {
    const { user } = renderModal();
    await irAModo(user);
    await user.click(screen.getByRole('button', { name: 'Por Porción del Fabricante' }));

    await user.click(screen.getByRole('button', { name: /^1 porción/ }));

    await waitFor(() => expect(addScannedItemAction).toHaveBeenCalled());
    const formData = vi.mocked(addScannedItemAction).mock.calls[0][0] as FormData;
    expect(formData.get('fecha')).toBe('2026-09-21');
    expect(formData.get('tipo_ingesta')).toBe('almuerzo');
    expect(formData.get('ean')).toBe('7790040000100');
    expect(formData.get('cantidad')).toBe('45');
  });

  it('"Personalizar porciones" calcula gramos = porciones × porcion', async () => {
    const { user } = renderModal(); // porcion = 45
    await irAModo(user);
    await user.click(screen.getByRole('button', { name: 'Por Porción del Fabricante' }));

    await user.click(screen.getByRole('button', { name: /personalizar porciones/i }));
    await user.type(screen.getByLabelText(/cantidad de porciones/i), '1.5');
    await user.click(screen.getByRole('button', { name: 'Guardar' }));

    await waitFor(() => expect(addScannedItemAction).toHaveBeenCalled());
    const formData = vi.mocked(addScannedItemAction).mock.calls[0][0] as FormData;
    expect(formData.get('cantidad')).toBe('68'); // round(1.5 * 45)
  });

  it('"Guardar" de Personalizar porciones está deshabilitado sin un valor válido', async () => {
    const { user } = renderModal();
    await irAModo(user);
    await user.click(screen.getByRole('button', { name: 'Por Porción del Fabricante' }));
    await user.click(screen.getByRole('button', { name: /personalizar porciones/i }));

    expect(screen.getByRole('button', { name: 'Guardar' })).toBeDisabled();
  });

  it('al elegir una porción, cierra el modal', async () => {
    const { user, onClose } = renderModal();
    await irAModo(user);
    await user.click(screen.getByRole('button', { name: 'Por Porción del Fabricante' }));

    await user.click(screen.getByRole('button', { name: /^1 porción/ }));

    expect(onClose).toHaveBeenCalled();
  });

  it('"← Volver" desde porción regresa a la pantalla de modo', async () => {
    const { user } = renderModal();
    await irAModo(user);
    await user.click(screen.getByRole('button', { name: 'Por Porción del Fabricante' }));

    await user.click(screen.getByRole('button', { name: /volver/i }));

    expect(screen.getByText(/cómo deseas registrar tu ingesta/i)).toBeInTheDocument();
  });
});
