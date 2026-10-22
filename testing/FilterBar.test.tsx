/**
 * Barra de filtros estándar del panel: sin botón "Filtrar", selects al cambiar,
 * texto con debounce, fechas incompletas o invertidas sin consultar y descarte de
 * respuestas viejas.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import FilterBar, { type FilterField } from '@/components/researcher/FilterBar';

const CAMPOS: FilterField[] = [
  { type: 'search', id: 'q', label: 'Buscar por alimento', value: '', placeholder: 'Ej: empanada' },
  {
    type: 'select',
    id: 'motivo',
    label: 'Motivo',
    value: 'todos',
    options: [
      { value: 'todos', label: 'Todos' },
      { value: 'item_quitado', label: 'Ítem quitado' },
    ],
  },
  { type: 'date', id: 'desde', label: 'Desde', value: '2026-10-01', max: '2026-10-15', invalidMessage: 'Desde no puede ser posterior a Hasta.' },
  { type: 'date', id: 'hasta', label: 'Hasta', value: '2026-10-15', min: '2026-10-01' },
];

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('FilterBar', () => {
  it('no tiene botón "Filtrar"', () => {
    render(<FilterBar fields={CAMPOS} onChange={vi.fn()} />);
    expect(screen.queryByRole('button', { name: /filtrar/i })).not.toBeInTheDocument();
    expect(screen.getByRole('search', { name: 'Filtros' })).toBeInTheDocument();
  });

  it('un select se aplica apenas cambia, con su id y valor', () => {
    const onChange = vi.fn();
    render(<FilterBar fields={CAMPOS} onChange={onChange} />);
    fireEvent.change(screen.getByLabelText('Motivo'), { target: { value: 'item_quitado' } });
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith('motivo', 'item_quitado');
  });

  it('el texto espera ~300 ms y manda sólo el último valor', () => {
    const onChange = vi.fn();
    render(<FilterBar fields={CAMPOS} onChange={onChange} />);
    const q = screen.getByLabelText('Buscar por alimento');
    fireEvent.change(q, { target: { value: 'em' } });
    fireEvent.change(q, { target: { value: 'emp' } });
    act(() => void vi.advanceTimersByTime(299));
    expect(onChange).not.toHaveBeenCalled();
    act(() => void vi.advanceTimersByTime(1));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith('q', 'emp');
  });

  it('con debounceMs=0 (listas que filtran en memoria) el texto se aplica al instante', () => {
    const onChange = vi.fn();
    render(<FilterBar fields={CAMPOS} onChange={onChange} debounceMs={0} />);
    fireEvent.change(screen.getByLabelText('Buscar por alimento'), { target: { value: 'a' } });
    expect(onChange).toHaveBeenCalledWith('q', 'a');
  });

  it('descarta respuestas viejas: sólo la última petición apaga el indicador de carga', async () => {
    const resolvers: Array<() => void> = [];
    const onChange = vi.fn(() => new Promise<void>((r) => resolvers.push(r)));
    render(<FilterBar fields={CAMPOS} onChange={onChange} />);
    const motivo = screen.getByLabelText('Motivo');

    fireEvent.change(motivo, { target: { value: 'item_quitado' } });
    fireEvent.change(motivo, { target: { value: 'todos' } });
    expect(screen.getByRole('status')).toHaveTextContent('Actualizando resultados');

    await act(async () => resolvers[0]()); // la primera (vieja) termina tarde
    expect(screen.getByRole('status')).toHaveTextContent('Actualizando resultados');

    await act(async () => resolvers[1]());
    expect(screen.getByRole('status')).toBeEmptyDOMElement();
  });

  it('una fecha a medio escribir no dispara la consulta', () => {
    const onChange = vi.fn();
    render(<FilterBar fields={CAMPOS} onChange={onChange} />);
    const desde = screen.getByLabelText('Desde');
    Object.defineProperty(desde, 'validity', { value: { badInput: true }, configurable: true });
    fireEvent.change(desde, { target: { value: '' } });
    expect(onChange).not.toHaveBeenCalled();
  });

  it('Desde posterior a Hasta no se aplica y avisa', () => {
    const onChange = vi.fn();
    render(<FilterBar fields={CAMPOS} onChange={onChange} />);
    fireEvent.change(screen.getByLabelText('Desde'), { target: { value: '2026-10-20' } });
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByText('Desde no puede ser posterior a Hasta.')).toBeInTheDocument();
    expect(screen.getByLabelText('Desde')).toHaveAttribute('aria-invalid', 'true');
  });

  it('una fecha válida se aplica (y limpia el aviso); vaciarla también', () => {
    const onChange = vi.fn();
    render(<FilterBar fields={CAMPOS} onChange={onChange} />);
    fireEvent.change(screen.getByLabelText('Desde'), { target: { value: '2026-10-20' } });
    fireEvent.change(screen.getByLabelText('Desde'), { target: { value: '2026-10-05' } });
    expect(onChange).toHaveBeenCalledWith('desde', '2026-10-05');
    expect(screen.queryByText('Desde no puede ser posterior a Hasta.')).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Desde'), { target: { value: '' } });
    expect(onChange).toHaveBeenLastCalledWith('desde', '');
  });

  it('"Limpiar" sólo aparece si hay filtros activos y llama a onClear', () => {
    const onClear = vi.fn();
    const { rerender } = render(<FilterBar fields={CAMPOS} onChange={vi.fn()} onClear={onClear} canClear={false} />);
    expect(screen.queryByRole('button', { name: 'Limpiar' })).not.toBeInTheDocument();
    rerender(<FilterBar fields={CAMPOS} onChange={vi.fn()} onClear={onClear} canClear />);
    fireEvent.click(screen.getByRole('button', { name: 'Limpiar' }));
    expect(onClear).toHaveBeenCalledTimes(1);
  });

  it('refleja cambios que vienen de afuera, pero no pisa lo que el usuario sigue escribiendo', () => {
    const onChange = vi.fn();
    const { rerender } = render(<FilterBar fields={CAMPOS} onChange={onChange} />);
    const q = screen.getByLabelText('Buscar por alimento');

    fireEvent.change(q, { target: { value: 'ab' } });
    act(() => void vi.advanceTimersByTime(300)); // emitido: 'ab'
    fireEvent.change(q, { target: { value: 'abc' } }); // sigue escribiendo
    rerender(<FilterBar fields={[{ ...CAMPOS[0], value: 'ab' } as FilterField, ...CAMPOS.slice(1)]} onChange={onChange} />); // llega el eco de 'ab'
    expect(q).toHaveValue('abc');

    rerender(<FilterBar fields={[{ ...CAMPOS[0], value: '' } as FilterField, ...CAMPOS.slice(1)]} onChange={onChange} />); // "Limpiar" desde afuera
    expect(q).toHaveValue('');
  });

  it('todos los controles tienen etiqueta visible asociada', () => {
    render(<FilterBar fields={CAMPOS} onChange={vi.fn()} />);
    for (const l of ['Buscar por alimento', 'Motivo', 'Desde', 'Hasta']) expect(screen.getByLabelText(l)).toBeInTheDocument();
  });
});
