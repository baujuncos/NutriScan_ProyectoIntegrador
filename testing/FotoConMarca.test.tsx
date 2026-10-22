/**
 * NUT-149 — Marca del ítem sobre la foto: elipse alineada con la imagen, etiqueta, atenuado,
 * accesibilidad, y el aviso cuando no hay boundingBox.
 */
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import FotoConMarca from '@/app/(researcher)/revision-ia/FotoConMarca';

const CAJA = { x: 0.2, y: 0.4, width: 0.4, height: 0.2 };
const props = (over: Partial<React.ComponentProps<typeof FotoConMarca>> = {}) => ({
  src: 'https://x/foto.jpg',
  alt: 'Foto de la comida: Empanada',
  caja: CAJA,
  etiqueta: 'Empanada',
  onFallo: vi.fn().mockResolvedValue(null),
  ...over,
});
const cargar = () => fireEvent.load(screen.getByRole('img', { name: 'Foto de la comida: Empanada' }));

describe('FotoConMarca', () => {
  it('no dibuja la marca hasta que la foto cargó (hay un skeleton)', () => {
    const { container } = render(<FotoConMarca {...props()} />);
    expect(screen.queryByTestId('marca-foto')).not.toBeInTheDocument();
    expect(container.querySelector('.animate-pulse')).not.toBeNull();
  });

  it('dibuja una elipse inscripta en la caja sobre un SVG de viewBox 0 0 1 1 que cubre la imagen', () => {
    render(<FotoConMarca {...props()} />);
    cargar();
    const svg = screen.getByTestId('marca-foto');
    expect(svg).toHaveAttribute('viewBox', '0 0 1 1');
    expect(svg).toHaveAttribute('preserveAspectRatio', 'none');
    const elipses = [...svg.querySelectorAll('ellipse')].filter((e) => e.getAttribute('fill') === 'none');
    expect(elipses).toHaveLength(2); // contorno claro + borde de acento
    for (const e of elipses) {
      expect(Number(e.getAttribute('cx'))).toBeCloseTo(0.4);
      expect(Number(e.getAttribute('cy'))).toBeCloseTo(0.5);
      expect(Number(e.getAttribute('rx'))).toBeCloseTo(0.2);
      expect(Number(e.getAttribute('ry'))).toBeCloseTo(0.1);
    }
  });

  it('borde de 3 px de acento con un contorno claro por fuera, de grosor constante (non-scaling-stroke)', () => {
    render(<FotoConMarca {...props()} />);
    cargar();
    const [contorno, acento] = [...screen.getByTestId('marca-foto').querySelectorAll('ellipse[fill="none"]')];
    expect(acento).toHaveAttribute('stroke-width', '3');
    expect(Number(contorno.getAttribute('stroke-width'))).toBeGreaterThan(3);
    expect(contorno).toHaveAttribute('stroke', '#ffffff');
    expect(acento).toHaveAttribute('vector-effect', 'non-scaling-stroke');
  });

  it('el overlay está dentro del mismo contenedor que la imagen (se ajusta a su área renderizada, no al modal entero)', () => {
    render(<FotoConMarca {...props()} />);
    const img = screen.getByRole('img', { name: 'Foto de la comida: Empanada' });
    cargar();
    expect(img.parentElement).toContainElement(screen.getByTestId('marca-foto'));
    expect(img.parentElement!.className).toContain('inline-block');
    expect(img.parentElement!.className).toContain('relative');
    expect(img.className).toContain('max-h-[70vh]');
    expect(screen.getByTestId('marca-foto').getAttribute('class')).toContain('inset-0');
  });

  it('atenúa el resto de la foto con una máscara que deja libre la elipse', () => {
    render(<FotoConMarca {...props()} />);
    cargar();
    const svg = screen.getByTestId('marca-foto');
    const mascara = svg.querySelector('mask')!;
    expect(mascara.querySelector('rect')).toHaveAttribute('fill', 'white');
    expect(mascara.querySelector('ellipse')).toHaveAttribute('fill', 'black');
    const velo = [...svg.querySelectorAll('rect')].find((r) => r.getAttribute('mask'))!;
    expect(Number(velo.getAttribute('fill-opacity'))).toBeGreaterThan(0);
    expect(Number(velo.getAttribute('fill-opacity'))).toBeLessThan(0.6); // "levemente"
    expect(velo.getAttribute('mask')).toBe(`url(#${mascara.id})`);
  });

  it('la etiqueta con el nombre queda pegada a la elipse (arriba; abajo si el ítem toca el borde superior)', () => {
    const { rerender } = render(<FotoConMarca {...props()} />);
    cargar();
    expect(screen.getByTestId('etiqueta-marca')).toHaveTextContent('Empanada');
    expect(screen.getByTestId('etiqueta-marca').style.top).toBe('40%');
    expect(screen.getByTestId('etiqueta-marca').style.transform).toContain('-110%');

    rerender(<FotoConMarca {...props({ caja: { x: 0.2, y: 0.01, width: 0.4, height: 0.3 } })} />);
    expect(screen.getByTestId('etiqueta-marca').style.top).toBe('31%');
    expect(screen.getByTestId('etiqueta-marca').style.transform).not.toContain('-110%');
  });

  it('la marca es decorativa para lectores de pantalla; el texto de al lado dice qué ítem se evalúa', () => {
    render(<FotoConMarca {...props()} />);
    cargar();
    expect(screen.getByTestId('marca-foto')).toHaveAttribute('aria-hidden', 'true');
    expect(screen.getByTestId('etiqueta-marca')).toHaveAttribute('aria-hidden', 'true');
    expect(screen.getByText('Se evalúa: Empanada')).toBeInTheDocument();
  });

  it('sin boundingBox no dibuja nada y avisa con discreción', () => {
    render(<FotoConMarca {...props({ caja: null })} />);
    cargar();
    expect(screen.queryByTestId('marca-foto')).not.toBeInTheDocument();
    expect(screen.queryByTestId('etiqueta-marca')).not.toBeInTheDocument();
    expect(screen.getByText('Esta detección no tiene marca en la foto')).toBeInTheDocument();
    expect(screen.getByText('Se evalúa: Empanada')).toBeInTheDocument();
  });

  it('con caja no aparece el aviso de "sin marca"', () => {
    render(<FotoConMarca {...props()} />);
    expect(screen.queryByText('Esta detección no tiene marca en la foto')).not.toBeInTheDocument();
  });

  it('si la imagen falla pide una URL nueva; si no hay otra, muestra el fallback', async () => {
    const onFallo = vi.fn().mockResolvedValue(null);
    render(<FotoConMarca {...props({ onFallo })} />);
    fireEvent.error(screen.getByRole('img', { name: 'Foto de la comida: Empanada' }));
    await waitFor(() => expect(screen.getByText('No se pudo cargar la foto')).toBeInTheDocument());
    expect(onFallo).toHaveBeenCalledWith('https://x/foto.jpg');
    expect(screen.queryByTestId('marca-foto')).not.toBeInTheDocument();
  });

  it('sin URL muestra el fallback y la etiqueta de qué ítem se evalúa', () => {
    render(<FotoConMarca {...props({ src: null })} />);
    expect(screen.getByText('No se pudo cargar la foto')).toBeInTheDocument();
    expect(screen.getByText('Se evalúa: Empanada')).toBeInTheDocument();
  });
});
