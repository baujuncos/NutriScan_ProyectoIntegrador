/**
 * NUT-119 — Los grises de texto de los componentes compartidos cumplen AA (≥ 4,5:1).
 * jsdom no evalúa contraste: se fijan las clases (gray-500 ≈ 4,8:1, gray-600 ≈ 7:1; gray-400 era 2,5:1).
 */
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import Input from '@/components/ui/Input';
import Modal from '@/components/ui/Modal';

describe('contraste de componentes compartidos', () => {
  it('el placeholder de Input usa gray-500, no gray-400', () => {
    render(<Input aria-label="Buscar" placeholder="Buscar alimento" />);
    const clases = screen.getByPlaceholderText('Buscar alimento').className;
    expect(clases).toContain('placeholder-gray-500');
    expect(clases).not.toContain('placeholder-gray-400');
  });

  it('los botones Volver y Cerrar de Modal usan gray-600, no gray-400', () => {
    render(
      <Modal open onClose={vi.fn()} onBack={vi.fn()} title="Título">
        contenido
      </Modal>,
    );
    for (const nombre of ['Volver', 'Cerrar']) {
      const clases = screen.getByRole('button', { name: nombre }).className;
      expect(clases).toContain('text-gray-600');
      expect(clases).not.toContain('text-gray-400');
    }
  });
});
