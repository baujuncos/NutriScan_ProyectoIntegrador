import { describe, it, expect } from 'vitest';
import { useState } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import CantidadSelector from '@/app/alimentacion/CantidadSelector';

function Wrapper({ initial = '50', mostrarAvisoSinValores = false }: { initial?: string; mostrarAvisoSinValores?: boolean }) {
  const [value, setValue] = useState(initial);
  return (
    <form>
      <CantidadSelector
        name="cantidad"
        accentColor="#16a34a"
        maxCantidad={2000}
        value={value}
        onChange={setValue}
        mostrarAvisoSinValores={mostrarAvisoSinValores}
      />
    </form>
  );
}

describe('CantidadSelector', () => {
  it('clickear un botón rápido actualiza el input oculto "cantidad"', async () => {
    const user = userEvent.setup();
    render(<Wrapper />);
    await user.click(screen.getByRole('button', { name: '100 g' }));
    expect(screen.getByDisplayValue('100')).toBeInTheDocument();
  });

  it('el stepper suma y resta 1 gramo, con piso en 1 y techo en maxCantidad', async () => {
    const user = userEvent.setup();
    render(<Wrapper initial="2000" />);
    await user.click(screen.getByRole('button', { name: 'Sumar 1 gramo' }));
    expect(screen.getByDisplayValue('2000')).toBeInTheDocument(); // techo: no pasa de maxCantidad

    render(<Wrapper initial="1" />);
    await user.click(screen.getAllByRole('button', { name: 'Restar 1 gramo' })[1]);
    expect(screen.getByDisplayValue('1')).toBeInTheDocument(); // piso: no baja de 1
  });

  it('el stepper suma/resta desde un valor intermedio', async () => {
    const user = userEvent.setup();
    render(<Wrapper initial="50" />);
    await user.click(screen.getByRole('button', { name: 'Sumar 1 gramo' }));
    expect(screen.getByDisplayValue('51')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Restar 1 gramo' }));
    await user.click(screen.getByRole('button', { name: 'Restar 1 gramo' }));
    expect(screen.getByDisplayValue('49')).toBeInTheDocument();
  });

  it('"Personalizar" revela un input libre que sigue sincronizado con el valor', async () => {
    const user = userEvent.setup();
    render(<Wrapper initial="50" />);
    await user.click(screen.getByRole('button', { name: 'Personalizar' }));
    const libre = screen.getByPlaceholderText('Cantidad en gramos');
    expect(libre).toHaveValue(50);
    await user.clear(libre);
    await user.type(libre, '73');
    expect(libre).toHaveValue(73);
  });

  it('muestra el aviso de "sin valores nutricionales" solo cuando mostrarAvisoSinValores es true', () => {
    const { rerender } = render(<Wrapper mostrarAvisoSinValores={false} />);
    expect(screen.queryByText(/no tiene valores nutricionales/i)).not.toBeInTheDocument();

    rerender(<Wrapper mostrarAvisoSinValores />);
    expect(screen.getByText(/no tiene valores nutricionales/i)).toBeInTheDocument();
  });
});
