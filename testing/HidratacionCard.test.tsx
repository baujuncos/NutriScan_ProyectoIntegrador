/**
 * HidratacionCard — contador de vasos de agua (1 vaso = 250 ml, meta 2500 ml).
 * Particiones de la carga manual: vacío / no numérico / <= 0 / 1…5000 (válido) / > 5000.
 * Valores límite: 0 (inválido), 1 (válido), 5000 (válido), 5001 (inválido). Edición del total: 0…10000 (se recorta a 10000).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const { updateMock } = vi.hoisted(() => ({ updateMock: vi.fn() }));
vi.mock('@/app/home/actions', () => ({ updateHidratacion: updateMock }));

import HidratacionCard from '@/app/home/HidratacionCard';

beforeEach(() => {
  // El servidor devuelve el nuevo total: acá lo calculamos a partir del delta y del valor inicial de cada test.
  let total = 0;
  updateMock.mockReset().mockImplementation(async (delta: number) => {
    total = Math.max(0, total + delta);
    return { ml: total };
  });
  (updateMock as unknown as { __set: (n: number) => void }).__set = (n) => {
    total = n;
  };
});
const partirDe = (ml: number) => (updateMock as unknown as { __set: (n: number) => void }).__set(ml);
/** Campo de edición del total (el otro spinbutton de la tarjeta es el de carga manual). */
const campoEditarTotal = () => document.querySelector<HTMLInputElement>('input[max="10000"]')!;
const botonMas = () => screen.getByRole('button', { name: '+' });
const botonMenos = () => screen.getByRole('button', { name: '−' });

describe('HidratacionCard — vasos', () => {
  it('muestra el total inicial en ml y en vasos', () => {
    render(<HidratacionCard initialMl={750} />);
    expect(screen.getByText(/750 ml · 3 vasos/)).toBeInTheDocument();
  });

  it.each([
    [0, '0 ml · 0 vasos'],
    [250, '250 ml · 1 vaso'],
    [375, '375 ml · 1 y 1/2 vasos'],
    [125, '125 ml · 1/2 vaso'],
    [1000, '1000 ml · 4 vasos'],
    [2500, '2500 ml · 10 vasos'],
    [333, '333 ml · 1 y 1/3 vasos'],
  ])('formato de %i ml → "%s"', (ml, texto) => {
    render(<HidratacionCard initialMl={ml} />);
    expect(screen.getByText(texto)).toBeInTheDocument();
  });

  it('"+" suma un vaso: actualización optimista y confirmación del servidor', async () => {
    partirDe(500);
    const user = userEvent.setup();
    render(<HidratacionCard initialMl={500} />);
    await user.click(botonMas());
    expect(updateMock).toHaveBeenCalledWith(250);
    await waitFor(() => expect(screen.getByText(/750 ml/)).toBeInTheDocument());
  });

  it('"−" resta un vaso y queda deshabilitado en 0', async () => {
    partirDe(250);
    const user = userEvent.setup();
    render(<HidratacionCard initialMl={250} />);
    await user.click(botonMenos());
    await waitFor(() => expect(screen.getByText(/^0 ml/)).toBeInTheDocument());
    expect(botonMenos()).toBeDisabled();
  });

  it('si el servidor responde con error se conserva el valor optimista local (no rompe)', async () => {
    updateMock.mockResolvedValue({ error: 'No autenticado' });
    const user = userEvent.setup();
    render(<HidratacionCard initialMl={0} />);
    await user.click(botonMas());
    await waitFor(() => expect(updateMock).toHaveBeenCalled());
    expect(screen.getByText(/^250 ml · 1 vaso$/)).toBeInTheDocument();
  });
});

describe('HidratacionCard — carga manual', () => {
  async function cargar(valor: string) {
    const user = userEvent.setup();
    render(<HidratacionCard initialMl={0} />);
    await user.type(screen.getByPlaceholderText('Ingresar ml exactos'), valor);
    await user.click(screen.getByRole('button', { name: 'Agregar' }));
    return user;
  }

  it.each([['0'], ['-5']])('%s → "Ingresá un número mayor a 0"', async (valor) => {
    await cargar(valor);
    expect(await screen.findByText('Ingresá un número mayor a 0')).toBeInTheDocument();
    expect(updateMock).not.toHaveBeenCalled();
  });

  it('valor límite: 5001 → "Máximo 5000 ml"', async () => {
    await cargar('5001');
    expect(await screen.findByText('Máximo 5000 ml')).toBeInTheDocument();
    expect(updateMock).not.toHaveBeenCalled();
  });

  it.each([['1'], ['5000']])('valor límite: %s ml es válido', async (valor) => {
    await cargar(valor);
    await waitFor(() => expect(updateMock).toHaveBeenCalledWith(Number(valor)));
    expect(screen.queryByText(/Máximo|Ingresá/)).not.toBeInTheDocument();
  });

  it('el botón Agregar está deshabilitado con el campo vacío y Enter también agrega', async () => {
    const user = userEvent.setup();
    render(<HidratacionCard initialMl={0} />);
    expect(screen.getByRole('button', { name: 'Agregar' })).toBeDisabled();
    await user.type(screen.getByPlaceholderText('Ingresar ml exactos'), '300{Enter}');
    await waitFor(() => expect(updateMock).toHaveBeenCalledWith(300));
  });

  it('el error desaparece al volver a escribir', async () => {
    const user = await cargar('0');
    await screen.findByText('Ingresá un número mayor a 0');
    await user.type(screen.getByPlaceholderText('Ingresar ml exactos'), '5');
    expect(screen.queryByText('Ingresá un número mayor a 0')).not.toBeInTheDocument();
  });
});

describe('HidratacionCard — editar el total', () => {
  async function editar(inicial: number, nuevo: string, tecla: '{Enter}' | 'click' = '{Enter}') {
    partirDe(inicial);
    const user = userEvent.setup();
    render(<HidratacionCard initialMl={inicial} />);
    await user.click(screen.getByTitle('Editar total'));
    const input = campoEditarTotal();
    await user.clear(input);
    await user.type(input, tecla === '{Enter}' ? `${nuevo}{Enter}` : nuevo);
    if (tecla === 'click') await user.click(input.parentElement!.querySelectorAll('button')[0]);
    return user;
  }

  it('cambiar el total envía la DIFERENCIA al servidor', async () => {
    await editar(500, '1200');
    await waitFor(() => expect(updateMock).toHaveBeenCalledWith(700));
  });

  it('bajar el total envía una diferencia negativa', async () => {
    await editar(1000, '400');
    await waitFor(() => expect(updateMock).toHaveBeenCalledWith(-600));
  });

  it('valor límite: un total mayor a 10000 se recorta a 10000', async () => {
    await editar(0, '12000');
    await waitFor(() => expect(updateMock).toHaveBeenCalledWith(10_000));
  });

  it('el mismo total no llama al servidor', async () => {
    await editar(500, '500');
    expect(updateMock).not.toHaveBeenCalled();
  });

  it('un total negativo se ignora', async () => {
    await editar(500, '-3');
    expect(updateMock).not.toHaveBeenCalled();
  });

  it('confirmar con el botón ✓ también aplica el cambio', async () => {
    await editar(0, '250', 'click');
    await waitFor(() => expect(updateMock).toHaveBeenCalledWith(250));
  });

  it('Escape y el botón ✕ cancelan la edición sin cambios', async () => {
    const user = userEvent.setup();
    render(<HidratacionCard initialMl={500} />);
    await user.click(screen.getByTitle('Editar total'));
    await user.type(campoEditarTotal(), '{Escape}');
    expect(document.querySelector('input[max="10000"]')).toBeNull();
    await user.click(screen.getByTitle('Editar total'));
    await user.click(campoEditarTotal().parentElement!.querySelectorAll('button')[1]);
    expect(document.querySelector('input[max="10000"]')).toBeNull();
    expect(updateMock).not.toHaveBeenCalled();
  });

  it('mientras se edita, los botones +/− y la carga manual están deshabilitados', async () => {
    const user = userEvent.setup();
    render(<HidratacionCard initialMl={500} />);
    await user.click(screen.getByTitle('Editar total'));
    expect(botonMas()).toBeDisabled();
    expect(botonMenos()).toBeDisabled();
    expect(screen.getByPlaceholderText('Ingresar ml exactos')).toBeDisabled();
  });
});
