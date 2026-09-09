import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import VajillaSelector from '@/app/alimentacion/VajillaSelector';
import { VAJILLA_TIPOS } from '@/lib/vajilla';

describe('VajillaSelector (NUT-158)', () => {
  it('renderiza las 4 opciones de vajilla', () => {
    render(<VajillaSelector value={null} onSelect={() => {}} />);
    expect(screen.getByText('Plato playo')).toBeInTheDocument();
    expect(screen.getByText('Plato de postre')).toBeInTheDocument();
    expect(screen.getByText('Plato hondo')).toBeInTheDocument();
    expect(screen.getByText('Otro')).toBeInTheDocument();
    expect(screen.getAllByRole('radio')).toHaveLength(4);
  });

  it('al hacer click en cada tarjeta llama onSelect con el tipo correcto', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(<VajillaSelector value={null} onSelect={onSelect} />);

    await user.click(screen.getByText('Plato playo'));
    await user.click(screen.getByText('Plato de postre'));
    await user.click(screen.getByText('Plato hondo'));
    await user.click(screen.getByText('Otro'));

    expect(onSelect.mock.calls.map((c) => c[0])).toEqual(VAJILLA_TIPOS);
  });

  it('marca como seleccionada la opción del prop value', () => {
    render(<VajillaSelector value="plato_hondo" onSelect={() => {}} />);
    const seleccionada = screen.getByRole('radio', { checked: true });
    expect(seleccionada).toHaveTextContent('Plato hondo');
  });
});
