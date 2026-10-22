/**
 * NUT-149 — Modal de revisión: dos columnas, comparativa IA / Deportista / Investigador y el
 * formulario "Tu corrección" (mantener o ingresar nombre y peso por separado, ítem quitado,
 * guardado, errores y autocompletado del catálogo).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('@/app/(researcher)/revision-ia/actions', () => ({
  confirmarRevisionAction: vi.fn().mockResolvedValue({ ok: true }),
  corregirRevisionAction: vi.fn().mockResolvedValue({ ok: true }),
  marcarCandidatoAction: vi.fn().mockResolvedValue({ ok: true }),
}));
vi.mock('@/app/alimentacion/actions', () => ({ searchAlimentosAction: vi.fn().mockResolvedValue([]) }));

import RevisionIaDetalle from '@/app/(researcher)/revision-ia/RevisionIaDetalle';
import { confirmarRevisionAction, corregirRevisionAction, marcarCandidatoAction, type RevisionFila } from '@/app/(researcher)/revision-ia/actions';
import { searchAlimentosAction } from '@/app/alimentacion/actions';

const FILA: RevisionFila = {
  id_deteccion_item: 7,
  id_deteccion: 1,
  item_uuid: 'u',
  alimento_ia: 'Empanada',
  gramos_ia: 100,
  confidence: 0.54,
  motivos_revision: ['confianza_baja', 'correccion_peso_grande'],
  item_quitado: false,
  estado_revision: 'pendiente',
  revisado_por: null,
  revisado_en: null,
  nutricionista_alimento: null,
  nutricionista_gramos: null,
  candidato_ejemplo: false,
  created_at: '2026-10-18T12:00:00Z',
  id_usuario: 'u1',
  imagen_path: 'a/b.jpg',
  vajilla_tipo: 'plato_playo',
  vajilla_diametro_cm: 26,
  angulo_captura_grados: 34,
  angulo_aproximado: false,
  alimento_usuario: 'Empanada (pollo)',
  gramos_usuario: 110,
  origen_usuario: 'answered',
  bbox_x: 0.2,
  bbox_y: 0.4,
  bbox_width: 0.4,
  bbox_height: 0.2,
};
const QUITADA: RevisionFila = { ...FILA, id_deteccion_item: 8, alimento_ia: 'Pan rallado', gramos_ia: 15, motivos_revision: ['item_quitado'], item_quitado: true, alimento_usuario: null, gramos_usuario: null, origen_usuario: null };

const onClose = vi.fn();
const onCambio = vi.fn();

function abrir(fila: RevisionFila = FILA) {
  return render(<RevisionIaDetalle fila={fila} fotoUrl="https://x/foto.jpg" onFotoFallo={async () => null} onClose={onClose} onCambio={onCambio} />);
}
const dialogo = () => within(screen.getByRole('dialog'));
const guardar = () => dialogo().getByRole('button', { name: 'Guardar corrección' });

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(searchAlimentosAction).mockResolvedValue([]);
});
afterEach(() => vi.useRealTimers());

describe('RevisionIaDetalle — estructura', () => {
  it('es un modal con la foto marcada y los datos, con pie Cancelar / Confirmar sin cambios / Guardar corrección', () => {
    abrir();
    expect(screen.getByRole('dialog', { name: 'Revisar predicción' })).toBeInTheDocument();
    expect(dialogo().getByRole('img', { name: 'Foto de la comida: Empanada' })).toBeInTheDocument();
    expect(dialogo().getByText('Se evalúa: Empanada')).toBeInTheDocument();
    for (const b of ['Cancelar', 'Confirmar sin cambios', 'Guardar corrección']) expect(dialogo().getByRole('button', { name: b })).toBeInTheDocument();
  });

  it('dos columnas desde 768 px y una por debajo', () => {
    abrir();
    expect(screen.getByRole('dialog').querySelector('.md\\:grid-cols-2')).not.toBeNull();
    expect(screen.getByRole('dialog').querySelector('.grid')).not.toBeNull();
  });

  it('muestra motivos, confianza y la comparativa IA / Deportista / Investigador (investigador vacío hasta revisar)', () => {
    abrir();
    expect(dialogo().getByText('Confianza baja')).toBeInTheDocument();
    expect(dialogo().getByText('Corrección de peso')).toBeInTheDocument();
    expect(dialogo().getByText('Confianza de la IA: 54%')).toBeInTheDocument();
    const tabla = dialogo().getByRole('table');
    for (const c of ['IA', 'Deportista (final)', 'Investigador']) expect(within(tabla).getByRole('columnheader', { name: c })).toBeInTheDocument();
    expect(within(tabla).getByText('Empanada (pollo)')).toBeInTheDocument();
    expect(within(tabla).getAllByText('Sin revisar')).toHaveLength(2); // nombre y peso
  });
});

describe('RevisionIaDetalle — Tu corrección', () => {
  it('por defecto "Mantener" en alimento y peso, con el valor del deportista, y se puede guardar', () => {
    abrir();
    const alimento = dialogo().getByRole('radiogroup', { name: 'Alimento' });
    const peso = dialogo().getByRole('radiogroup', { name: 'Peso' });
    expect(within(alimento).getByRole('radio', { name: /Mantener: Empanada \(pollo\)/ })).toBeChecked();
    expect(within(peso).getByRole('radio', { name: /Mantener: 110 g/ })).toBeChecked();
    expect(dialogo().queryByLabelText('Peso (g)')).not.toBeInTheDocument();
    expect(guardar()).toBeEnabled();
  });

  it('mantener nombre + mantener peso guarda los valores del deportista', async () => {
    abrir();
    await userEvent.click(guardar());
    await waitFor(() => expect(corregirRevisionAction).toHaveBeenCalledWith({ id: 7, alimento: 'Empanada (pollo)', gramos: 110 }));
  });

  it('mantener nombre + ingresar peso: la diferencia se ve en vivo contra la IA y contra el deportista', async () => {
    abrir();
    await userEvent.click(within(dialogo().getByRole('radiogroup', { name: 'Peso' })).getByRole('radio', { name: 'Ingresar otro' }));
    await userEvent.type(dialogo().getByLabelText('Peso (g)'), '150');
    expect(dialogo().getByText(/Contra la IA \(100 g\)/).textContent).toContain('+50 g (+50 %)');
    expect(dialogo().getByText(/Contra el deportista \(110 g\)/).textContent).toContain('+40 g (+36 %)');
    await userEvent.click(guardar());
    await waitFor(() => expect(corregirRevisionAction).toHaveBeenCalledWith({ id: 7, alimento: 'Empanada (pollo)', gramos: 150 }));
  });

  it('ingresar nombre + mantener peso: guarda el nombre nuevo normalizado y el peso del deportista', async () => {
    abrir();
    await userEvent.click(within(dialogo().getByRole('radiogroup', { name: 'Alimento' })).getByRole('radio', { name: 'Ingresar otro' }));
    await userEvent.type(dialogo().getByRole('combobox', { name: 'Nombre del alimento' }), '  Empanada   de carne ');
    await userEvent.click(guardar());
    await waitFor(() => expect(corregirRevisionAction).toHaveBeenCalledWith({ id: 7, alimento: 'Empanada de carne', gramos: 110 }));
  });

  it('ingresar nombre + ingresar peso: guarda los dos nuevos', async () => {
    abrir();
    await userEvent.click(within(dialogo().getByRole('radiogroup', { name: 'Alimento' })).getByRole('radio', { name: 'Ingresar otro' }));
    await userEvent.click(within(dialogo().getByRole('radiogroup', { name: 'Peso' })).getByRole('radio', { name: 'Ingresar otro' }));
    await userEvent.type(dialogo().getByRole('combobox', { name: 'Nombre del alimento' }), 'Tarta');
    await userEvent.type(dialogo().getByLabelText('Peso (g)'), '200');
    await userEvent.click(guardar());
    await waitFor(() => expect(corregirRevisionAction).toHaveBeenCalledWith({ id: 7, alimento: 'Tarta', gramos: 200 }));
  });

  it('"Guardar corrección" queda deshabilitado mientras el formulario no es válido, y muestra por qué', async () => {
    abrir();
    await userEvent.click(within(dialogo().getByRole('radiogroup', { name: 'Peso' })).getByRole('radio', { name: 'Ingresar otro' }));
    expect(guardar()).toBeDisabled(); // peso vacío
    await userEvent.type(dialogo().getByLabelText('Peso (g)'), '0');
    expect(guardar()).toBeDisabled();
    expect(dialogo().getByText('Ingresá un peso mayor a 0 g.')).toBeInTheDocument();
    await userEvent.clear(dialogo().getByLabelText('Peso (g)'));
    await userEvent.type(dialogo().getByLabelText('Peso (g)'), '99999');
    expect(guardar()).toBeDisabled();
    expect(dialogo().getByText(/El peso máximo es/)).toBeInTheDocument();
    await userEvent.clear(dialogo().getByLabelText('Peso (g)'));
    await userEvent.type(dialogo().getByLabelText('Peso (g)'), '120');
    expect(guardar()).toBeEnabled();
  });

  it('un nombre muy corto en "Ingresar otro" también bloquea el guardado', async () => {
    abrir();
    await userEvent.click(within(dialogo().getByRole('radiogroup', { name: 'Alimento' })).getByRole('radio', { name: 'Ingresar otro' }));
    await userEvent.type(dialogo().getByRole('combobox', { name: 'Nombre del alimento' }), 'a');
    expect(guardar()).toBeDisabled();
    expect(dialogo().getByText(/al menos 2 letras/)).toBeInTheDocument();
  });
});

describe('RevisionIaDetalle — ítem quitado por el deportista', () => {
  it('no ofrece mantener nombre ni peso: pregunta si estaba en el plato (por defecto, mantener quitado)', () => {
    abrir(QUITADA);
    expect(dialogo().queryByRole('radiogroup', { name: 'Alimento' })).not.toBeInTheDocument();
    expect(dialogo().queryByRole('radiogroup', { name: 'Peso' })).not.toBeInTheDocument();
    expect(dialogo().getByRole('radio', { name: 'No estaba: mantener quitado' })).toBeChecked();
    expect(dialogo().getByRole('radio', { name: 'Estaba en el plato: restaurar' })).not.toBeChecked();
    expect(dialogo().getByText('Lo quitó')).toBeInTheDocument();
  });

  it('"mantener quitado" equivale a Confirmar (no hay valores del investigador que guardar)', async () => {
    abrir(QUITADA);
    await userEvent.click(guardar());
    await waitFor(() => expect(confirmarRevisionAction).toHaveBeenCalledWith(8));
    expect(corregirRevisionAction).not.toHaveBeenCalled();
  });

  it('"restaurar" pide nombre y peso, y guarda ambos', async () => {
    abrir(QUITADA);
    await userEvent.click(dialogo().getByRole('radio', { name: 'Estaba en el plato: restaurar' }));
    expect(guardar()).toBeDisabled();
    await userEvent.type(dialogo().getByRole('combobox', { name: 'Nombre del alimento' }), 'Pan rallado');
    expect(guardar()).toBeDisabled(); // falta el peso
    await userEvent.type(dialogo().getByLabelText('Peso (g)'), '12');
    expect(dialogo().getByText(/Contra la IA \(15 g\)/).textContent).toContain('−3 g (−20 %)');
    expect(dialogo().queryByText(/Contra el deportista/)).not.toBeInTheDocument();
    await userEvent.click(guardar());
    await waitFor(() => expect(corregirRevisionAction).toHaveBeenCalledWith({ id: 8, alimento: 'Pan rallado', gramos: 12 }));
  });
});

describe('RevisionIaDetalle — guardado', () => {
  it('bloquea los botones mientras guarda y cierra el modal sólo si salió bien', async () => {
    let resolver: (v: { ok: true }) => void = () => undefined;
    vi.mocked(corregirRevisionAction).mockReturnValueOnce(new Promise((r) => (resolver = r)));
    abrir();
    await userEvent.click(guardar());
    expect(guardar()).toBeDisabled();
    expect(dialogo().getByRole('button', { name: 'Confirmar sin cambios' })).toBeDisabled();
    expect(onClose).not.toHaveBeenCalled();
    await act(async () => resolver({ ok: true }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onCambio).toHaveBeenCalledTimes(1);
  });

  it('si falla muestra el error, no cierra y deja volver a intentar', async () => {
    vi.mocked(corregirRevisionAction).mockResolvedValueOnce({ error: 'Este ítem ya fue revisado por otra persona' });
    abrir();
    await userEvent.click(guardar());
    expect(await dialogo().findByRole('alert')).toHaveTextContent('ya fue revisado');
    expect(onClose).not.toHaveBeenCalled();
    expect(onCambio).not.toHaveBeenCalled();
    expect(guardar()).toBeEnabled();
  });

  it('"Confirmar sin cambios" es el atajo del Confirmar de la tarjeta y "Cancelar" cierra sin guardar', async () => {
    abrir();
    await userEvent.click(dialogo().getByRole('button', { name: 'Confirmar sin cambios' }));
    await waitFor(() => expect(confirmarRevisionAction).toHaveBeenCalledWith(7));
    expect(onClose).toHaveBeenCalled();

    onClose.mockClear();
    await userEvent.click(dialogo().getByRole('button', { name: 'Cancelar' }));
    expect(onClose).toHaveBeenCalled();
    expect(corregirRevisionAction).not.toHaveBeenCalled();
  });

  it('"Ejemplo para la IA" es independiente: no confirma ni corrige', async () => {
    abrir();
    const casilla = dialogo().getByRole('checkbox', { name: 'Ejemplo para la IA' });
    expect(casilla).not.toBeChecked();
    await userEvent.click(casilla);
    await waitFor(() => expect(marcarCandidatoAction).toHaveBeenCalledWith(7, true));
    expect(confirmarRevisionAction).not.toHaveBeenCalled();
    expect(corregirRevisionAction).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    expect(dialogo().getByRole('checkbox', { name: 'Ejemplo para la IA' })).toBeChecked();
  });
});

describe('AlimentoAutocomplete (nombre a ingresar)', () => {
  async function conCampo() {
    abrir();
    await userEvent.click(within(dialogo().getByRole('radiogroup', { name: 'Alimento' })).getByRole('radio', { name: 'Ingresar otro' }));
    return dialogo().getByRole('combobox', { name: 'Nombre del alimento' });
  }

  it('busca en el catálogo con debounce de 300 ms y elegir una opción pone el nombre exacto del catálogo', async () => {
    vi.mocked(searchAlimentosAction).mockResolvedValue([
      { id_alimento: 1, nombre: 'Empanada de carne', categoria: null, fuente: 'SARA2', marca: null, denominacion: null },
      { id_alimento: 2, nombre: 'Empanada de pollo', categoria: null, fuente: 'ANMAT', marca: null, denominacion: null },
    ]);
    const campo = await conCampo();
    vi.useFakeTimers();
    fireEvent.change(campo, { target: { value: 'empan' } });
    act(() => void vi.advanceTimersByTime(299));
    expect(searchAlimentosAction).not.toHaveBeenCalled();
    await act(async () => void vi.advanceTimersByTime(1));
    vi.useRealTimers();
    expect(searchAlimentosAction).toHaveBeenCalledWith('empan', '');
    const opcion = await screen.findByRole('option', { name: /Empanada de carne/ });
    fireEvent.mouseDown(opcion);
    expect(campo).toHaveValue('Empanada de carne');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    await userEvent.click(guardar());
    await waitFor(() => expect(corregirRevisionAction).toHaveBeenCalledWith({ id: 7, alimento: 'Empanada de carne', gramos: 110 }));
  });

  it('un nombre que no está en el catálogo se puede escribir igual (texto libre)', async () => {
    const campo = await conCampo();
    await userEvent.type(campo, 'Matambre a la pizza');
    await userEvent.click(guardar());
    await waitFor(() => expect(corregirRevisionAction).toHaveBeenCalledWith({ id: 7, alimento: 'Matambre a la pizza', gramos: 110 }));
  });

  it('se maneja con teclado (flechas + Enter) y Esc cierra la lista sin cerrar el modal', async () => {
    vi.mocked(searchAlimentosAction).mockResolvedValue([
      { id_alimento: 1, nombre: 'Pan lactal', categoria: null, fuente: 'SARA2', marca: null, denominacion: null },
      { id_alimento: 2, nombre: 'Pan de salvado', categoria: null, fuente: 'SARA2', marca: null, denominacion: null },
    ]);
    const campo = await conCampo();
    await userEvent.type(campo, 'pan');
    await screen.findByRole('listbox');
    await userEvent.keyboard('{ArrowDown}{ArrowDown}{Enter}');
    expect(campo).toHaveValue('Pan de salvado');

    await userEvent.type(campo, '{Backspace}');
    await screen.findByRole('listbox');
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled(); // Esc sólo cerró la lista
  });
});
