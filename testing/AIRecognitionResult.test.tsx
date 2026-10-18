import { useState } from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import AIRecognitionResult from '@/app/alimentacion/AIRecognitionResult';
import {
  aplicarRespuesta,
  ajustarPeso,
  crearWorkingItems,
  deshacerPeso,
  type WorkingItem,
} from '@/lib/deteccionResultado';
import { DETECTION_MOCKUP, DETECTION_SIN_AMBIGUEDAD } from './fixtures/deteccionResponse';

/** Envoltorio con estado real (igual a como lo maneja AIRecognitionModal) para poder testear el ciclo completo. */
function Harness({
  initial,
  onGuardar = vi.fn(),
  onQuitarSpy,
  onAbrirCambiarSpy,
  onAbrirAgregarSpy,
  onRepetirSpy,
}: {
  initial: WorkingItem[];
  onGuardar?: () => void;
  onQuitarSpy?: (uiId: string) => void;
  onAbrirCambiarSpy?: (item: WorkingItem) => void;
  onAbrirAgregarSpy?: () => void;
  onRepetirSpy?: () => void;
}) {
  const [items, setItems] = useState(initial);

  return (
    <AIRecognitionResult
      photoUrl="blob:foto"
      vajillaChip="Plato playo · 26 cm"
      items={items}
      mealLabel="Desayuno"
      saving={false}
      saveError={null}
      saveSuccess={false}
      onRepetir={() => onRepetirSpy?.()}
      onResponder={(uiId, respuesta, custom) =>
        setItems((prev) => prev.map((i) => (i.uiId === uiId ? aplicarRespuesta(i, respuesta, custom) : i)))
      }
      onAjustarPeso={(uiId, grams) => setItems((prev) => prev.map((i) => (i.uiId === uiId ? ajustarPeso(i, grams) : i)))}
      onDeshacerPeso={(uiId) => setItems((prev) => prev.map((i) => (i.uiId === uiId ? deshacerPeso(i) : i)))}
      onQuitarItem={(uiId) => {
        onQuitarSpy?.(uiId);
        setItems((prev) => prev.filter((i) => i.uiId !== uiId));
      }}
      onAbrirCambiarAlimento={(item) => onAbrirCambiarSpy?.(item)}
      onAbrirAgregarAlimento={() => onAbrirAgregarSpy?.()}
      onGuardar={onGuardar}
      onListo={vi.fn()}
    />
  );
}

describe('AIRecognitionResult — estado "dudas"', () => {
  it('muestra el badge de dudas y el resaltado "¿Esto?" sobre el ítem con boundingBox', () => {
    render(<Harness initial={crearWorkingItems(DETECTION_MOCKUP)} />);
    expect(screen.getByText('1 duda')).toBeInTheDocument();
    expect(screen.getByText('¿Esto?')).toBeInTheDocument();
    expect(screen.getByText('¿Qué es el topping blanco?')).toBeInTheDocument();
  });

  it('sin boundingBox no se dibuja el resaltado', () => {
    const items = crearWorkingItems({
      ...DETECTION_MOCKUP,
      items: DETECTION_MOCKUP.items.map((i) => (i.id === 'item-topping' ? { ...i, boundingBox: null } : i)),
    });
    render(<Harness initial={items} />);
    expect(screen.queryByText('¿Esto?')).not.toBeInTheDocument();
  });

  it('"Guardar" está deshabilitado mientras haya dudas', () => {
    render(<Harness initial={crearWorkingItems(DETECTION_MOCKUP)} />);
    expect(screen.getByRole('button', { name: /Guardar en Desayuno/ })).toBeDisabled();
    expect(screen.getByText('Respondé u omití la duda para guardar')).toBeInTheDocument();
  });

  it('responder una pregunta identity reemplaza el nombre y avanza a la siguiente pregunta del mismo ítem', async () => {
    const user = userEvent.setup();
    render(<Harness initial={crearWorkingItems(DETECTION_MOCKUP)} />);

    await user.click(screen.getByRole('button', { name: 'Yogur griego' }));

    expect(screen.getByText('Yogur griego')).toBeInTheDocument();
    expect(screen.getByText('¿Es entero o light?')).toBeInTheDocument();
    expect(screen.getByText('1 duda')).toBeInTheDocument();
  });

  it('responder la última pregunta (attribute) agrega el atributo entre paréntesis y habilita Guardar', async () => {
    const user = userEvent.setup();
    render(<Harness initial={crearWorkingItems(DETECTION_MOCKUP)} />);

    await user.click(screen.getByRole('button', { name: 'Yogur griego' }));
    await user.click(screen.getByRole('button', { name: 'Light' }));

    expect(screen.getByText('Yogur griego (Light)')).toBeInTheDocument();
    expect(screen.getByText(/Sin dudas/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Guardar en Desayuno/ })).toBeEnabled();
  });

  it('"Otro…" permite una respuesta libre que también reemplaza el nombre (identity)', async () => {
    const user = userEvent.setup();
    render(<Harness initial={crearWorkingItems(DETECTION_MOCKUP)} />);

    await user.click(screen.getByRole('button', { name: 'Otro…' }));
    await user.type(screen.getByLabelText('Tu respuesta'), 'Dulce de leche');
    await user.click(screen.getByRole('button', { name: 'Responder' }));

    expect(screen.getByText('Dulce de leche')).toBeInTheDocument();
  });

  it('"No sé" deja el ítem como estaba y cuenta como resuelta (avanza sin cambiar el nombre)', async () => {
    const user = userEvent.setup();
    render(<Harness initial={crearWorkingItems(DETECTION_MOCKUP)} />);

    await user.click(screen.getByRole('button', { name: 'No sé, seguir sin responder' }));

    expect(screen.getByText('Topping blanco')).toBeInTheDocument();
    expect(screen.getByText('¿Es entero o light?')).toBeInTheDocument();
  });

  it('"Repetir" llama a onRepetir', async () => {
    const user = userEvent.setup();
    const onRepetirSpy = vi.fn();
    render(<Harness initial={crearWorkingItems(DETECTION_MOCKUP)} onRepetirSpy={onRepetirSpy} />);
    await user.click(screen.getByRole('button', { name: /Repetir/ }));
    expect(onRepetirSpy).toHaveBeenCalledTimes(1);
  });
});

describe('AIRecognitionResult — estado "listo"', () => {
  it('badge "Sin dudas" y botón Guardar habilitado desde el arranque si no hay ambigüedad', () => {
    render(<Harness initial={crearWorkingItems(DETECTION_SIN_AMBIGUEDAD)} />);
    expect(screen.getByText(/Sin dudas/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Guardar en Desayuno/ })).toBeEnabled();
  });

  it('el stepper de peso ajusta de a 5g y "IA: X g" deshace al valor original', async () => {
    const user = userEvent.setup();
    render(<Harness initial={crearWorkingItems(DETECTION_SIN_AMBIGUEDAD)} />);

    // El primer ítem (Arroz blanco) está expandido por defecto.
    await user.click(screen.getByRole('button', { name: 'Sumar 5 gramos' }));
    expect(screen.getByLabelText('Peso de Arroz blanco')).toHaveValue(155);

    await user.click(screen.getByRole('button', { name: /IA: 150 g/ }));
    expect(screen.getByLabelText('Peso de Arroz blanco')).toHaveValue(150);
  });

  it('tocar un ítem colapsado lo expande (un solo ítem expandido a la vez)', async () => {
    const user = userEvent.setup();
    render(<Harness initial={crearWorkingItems(DETECTION_SIN_AMBIGUEDAD)} />);

    expect(screen.queryByLabelText('Peso de Pollo grillado')).not.toBeInTheDocument();
    await user.click(screen.getByText('Pollo grillado'));
    expect(screen.getByLabelText('Peso de Pollo grillado')).toBeInTheDocument();
    expect(screen.queryByLabelText('Peso de Arroz blanco')).not.toBeInTheDocument();
  });

  it('"Cambiar alimento" y "Quitar" llaman a los callbacks correspondientes', async () => {
    const user = userEvent.setup();
    const onAbrirCambiarSpy = vi.fn();
    const onQuitarSpy = vi.fn();
    render(
      <Harness
        initial={crearWorkingItems(DETECTION_SIN_AMBIGUEDAD)}
        onAbrirCambiarSpy={onAbrirCambiarSpy}
        onQuitarSpy={onQuitarSpy}
      />,
    );

    await user.click(screen.getByRole('button', { name: /Cambiar alimento/ }));
    expect(onAbrirCambiarSpy).toHaveBeenCalledTimes(1);
    expect(onAbrirCambiarSpy.mock.calls[0][0].uiId).toBe('item-arroz');

    await user.click(screen.getByRole('button', { name: /Quitar/ }));
    expect(onQuitarSpy).toHaveBeenCalledWith('item-arroz');
    expect(screen.queryByText('Arroz blanco')).not.toBeInTheDocument();
  });

  it('"+ Agregar alimento que falta" llama a onAbrirAgregarAlimento', async () => {
    const user = userEvent.setup();
    const onAbrirAgregarSpy = vi.fn();
    render(<Harness initial={crearWorkingItems(DETECTION_SIN_AMBIGUEDAD)} onAbrirAgregarSpy={onAbrirAgregarSpy} />);
    await user.click(screen.getByRole('button', { name: /Agregar alimento que falta/ }));
    expect(onAbrirAgregarSpy).toHaveBeenCalledTimes(1);
  });

  it('los totales (g y kcal) se recalculan al ajustar el peso de un ítem', async () => {
    const user = userEvent.setup();
    render(<Harness initial={crearWorkingItems(DETECTION_SIN_AMBIGUEDAD)} />);

    const totalAntes = screen.getByText(/Total · 330 g/);
    expect(totalAntes).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Sumar 5 gramos' }));
    expect(screen.getByText(/Total · 335 g/)).toBeInTheDocument();
  });

  it('un ítem respondido muestra "Vos respondiste" en vez de la categoría', async () => {
    const user = userEvent.setup();
    render(<Harness initial={crearWorkingItems(DETECTION_MOCKUP)} />);
    await user.click(screen.getByRole('button', { name: 'Yogur griego' }));
    await user.click(screen.getByRole('button', { name: 'Light' }));

    await user.click(screen.getByText('Waffle'));
    expect(screen.getByText('Vos respondiste')).toBeInTheDocument();
  });

  it('clickear "Guardar" llama a onGuardar', async () => {
    const user = userEvent.setup();
    const onGuardar = vi.fn();
    render(<Harness initial={crearWorkingItems(DETECTION_SIN_AMBIGUEDAD)} onGuardar={onGuardar} />);
    await user.click(screen.getByRole('button', { name: /Guardar en Desayuno/ }));
    expect(onGuardar).toHaveBeenCalledTimes(1);
  });
});

describe('AIRecognitionResult — confirmación de guardado', () => {
  it('no muestra kcal ni macros en ningún estado (D13: números del mock ocultos para todos los roles)', () => {
    render(<Harness initial={crearWorkingItems(DETECTION_SIN_AMBIGUEDAD)} />);
    expect(screen.queryByText(/kcal/i)).not.toBeInTheDocument();
    expect(screen.queryByText('Proteínas')).not.toBeInTheDocument();
    expect(screen.queryByText('Carbohidratos')).not.toBeInTheDocument();
    expect(screen.queryByText('Grasas')).not.toBeInTheDocument();
  });

  it('con saveSuccess=true muestra la confirmación y "Listo" cierra', async () => {
    const user = userEvent.setup();
    const onListo = vi.fn();
    render(
      <AIRecognitionResult
        photoUrl="blob:foto"
        vajillaChip="Plato playo · 26 cm"
        items={crearWorkingItems(DETECTION_SIN_AMBIGUEDAD)}
        mealLabel="Desayuno"
        saving={false}
        saveError={null}
        saveSuccess
        onRepetir={vi.fn()}
        onResponder={vi.fn()}
        onAjustarPeso={vi.fn()}
        onDeshacerPeso={vi.fn()}
        onQuitarItem={vi.fn()}
        onAbrirCambiarAlimento={vi.fn()}
        onAbrirAgregarAlimento={vi.fn()}
        onGuardar={vi.fn()}
        onListo={onListo}
      />,
    );
    expect(screen.getByText('Guardado en Desayuno')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Listo' }));
    expect(onListo).toHaveBeenCalledTimes(1);
  });

  it('con saveError muestra el mensaje sin perder los ítems', () => {
    render(
      <AIRecognitionResult
        photoUrl="blob:foto"
        vajillaChip="Plato playo · 26 cm"
        items={crearWorkingItems(DETECTION_SIN_AMBIGUEDAD)}
        mealLabel="Desayuno"
        saving={false}
        saveError="No pudimos guardar los cambios. Probá de nuevo."
        saveSuccess={false}
        onRepetir={vi.fn()}
        onResponder={vi.fn()}
        onAjustarPeso={vi.fn()}
        onDeshacerPeso={vi.fn()}
        onQuitarItem={vi.fn()}
        onAbrirCambiarAlimento={vi.fn()}
        onAbrirAgregarAlimento={vi.fn()}
        onGuardar={vi.fn()}
        onListo={vi.fn()}
      />,
    );
    expect(screen.getByText('No pudimos guardar los cambios. Probá de nuevo.')).toBeInTheDocument();
    expect(screen.getByText('Arroz blanco')).toBeInTheDocument();
  });
});
