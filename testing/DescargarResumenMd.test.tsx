/**
 * NUT-151 — Botón "Descargar resumen (.md)": llama a la acción con los filtros actuales, descarga el
 * archivo, muestra el progreso y los errores.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const generar = vi.hoisted(() => vi.fn());
vi.mock('@/app/(researcher)/revision-ia/metricas/actions', () => ({ generarResumenMdAction: generar }));

import DescargarResumenMd from '@/app/(researcher)/revision-ia/metricas/DescargarResumenMd';
import { defaultsMetricas } from '@/lib/metricasIaQuery';

const params = { ...defaultsMetricas(), desde: '2026-10-01', hasta: '2026-10-15', vajilla: 'plato_hondo' as const, prompt: 'nut166-v2' };

let blobs: Blob[];
let descargas: Array<{ nombre: string; href: string }>;

beforeEach(() => {
  generar.mockReset();
  blobs = [];
  descargas = [];
  URL.createObjectURL = vi.fn((b: Blob) => {
    blobs.push(b);
    return 'blob:resumen';
  });
  URL.revokeObjectURL = vi.fn();
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
    descargas.push({ nombre: this.download, href: this.href });
  });
});
afterEach(() => vi.restoreAllMocks());

describe('DescargarResumenMd', () => {
  it('es un botón con texto claro', () => {
    render(<DescargarResumenMd params={params} />);
    expect(screen.getByRole('button', { name: /Descargar resumen \(\.md\)/ })).toBeInTheDocument();
  });

  it('pide el resumen con los filtros actuales y descarga el archivo .md', async () => {
    generar.mockResolvedValue({ ok: true, filename: 'nutriscan-resumen-calidad-2026-10-22.md', markdown: '# Resumen\n' });
    render(<DescargarResumenMd params={params} />);
    await userEvent.click(screen.getByRole('button', { name: /Descargar resumen/ }));

    await waitFor(() => expect(descargas).toHaveLength(1));
    expect(generar).toHaveBeenCalledWith({ desde: '2026-10-01', hasta: '2026-10-15', vajilla: 'plato_hondo', prompt: 'nut166-v2' });
    expect(descargas[0]).toEqual({ nombre: 'nutriscan-resumen-calidad-2026-10-22.md', href: 'blob:resumen' });
    expect(blobs[0].type).toContain('text/markdown');
    expect(await blobs[0].text()).toBe('# Resumen\n');
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:resumen'); // no deja el archivo en memoria
  });

  it('mientras genera, el botón queda bloqueado (no se descarga dos veces)', async () => {
    let resolver: (v: unknown) => void = () => undefined;
    generar.mockReturnValue(new Promise((r) => (resolver = r)));
    render(<DescargarResumenMd params={params} />);
    const boton = screen.getByRole('button', { name: /Descargar resumen/ });
    await userEvent.click(boton);
    expect(boton).toBeDisabled();
    await userEvent.click(boton);
    expect(generar).toHaveBeenCalledTimes(1);
    resolver({ ok: true, filename: 'a.md', markdown: 'x' });
    await waitFor(() => expect(boton).toBeEnabled());
  });

  it('si la acción devuelve un error lo muestra y no descarga nada', async () => {
    generar.mockResolvedValue({ error: 'Acceso denegado' });
    render(<DescargarResumenMd params={params} />);
    await userEvent.click(screen.getByRole('button', { name: /Descargar resumen/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Acceso denegado');
    expect(descargas).toHaveLength(0);
  });

  it('si la llamada falla muestra un mensaje y deja reintentar', async () => {
    generar.mockRejectedValueOnce(new Error('red'));
    render(<DescargarResumenMd params={params} />);
    await userEvent.click(screen.getByRole('button', { name: /Descargar resumen/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent('No se pudo generar el resumen');
    expect(screen.getByRole('button', { name: /Descargar resumen/ })).toBeEnabled();
  });
});
