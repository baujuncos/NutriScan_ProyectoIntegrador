/**
 * Guía de ayuda ("i"): abre a pedido, contenido propio por pantalla (y por pestaña),
 * se maneja con teclado, Esc cierra y el foco vuelve al botón. Los umbrales salen de
 * las constantes reales.
 */
import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('next/link', () => ({ default: ({ href, children, ...rest }: any) => <a href={href} {...rest}>{children}</a> }));

import HelpDrawer from '@/components/researcher/HelpDrawer';
import PageHeader from '@/components/researcher/PageHeader';
import SubTabs from '@/components/researcher/SubTabs';
import { HELP, type HelpId } from '@/components/researcher/helpContent';
import { UMBRAL_CONFIANZA_BAJA, UMBRAL_DIFERENCIA_PESO } from '@/lib/revisionIa';

const boton = () => screen.getByRole('button', { name: 'Ayuda sobre esta pantalla' });

describe('HelpDrawer', () => {
  it('está siempre disponible pero cerrado: no abre solo', () => {
    render(<HelpDrawer helpId="dashboard" />);
    expect(boton()).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('abre un panel con Qué es, Para qué sirve y Cómo se usa', async () => {
    render(<HelpDrawer helpId="deportistas" />);
    await userEvent.click(boton());
    const panel = within(screen.getByRole('dialog', { name: 'Deportistas' }));
    for (const t of ['Qué es', 'Para qué sirve', 'Cómo se usa']) expect(panel.getByRole('heading', { name: t })).toBeInTheDocument();
    expect(boton()).toHaveAttribute('aria-expanded', 'true');
  });

  it('muestra el glosario sólo en las pantallas que lo tienen', async () => {
    const { unmount } = render(<HelpDrawer helpId="validacion" />);
    await userEvent.click(boton());
    expect(screen.getByRole('heading', { name: 'Glosario' })).toBeInTheDocument();
    unmount();
    render(<HelpDrawer helpId="revision-metricas" />);
    await userEvent.click(boton());
    expect(screen.queryByRole('heading', { name: 'Glosario' })).not.toBeInTheDocument();
  });

  it('Esc lo cierra y el foco vuelve al botón', async () => {
    render(<HelpDrawer helpId="dashboard" />);
    await userEvent.click(boton());
    expect(screen.getByRole('button', { name: 'Cerrar ayuda' })).toHaveFocus(); // el foco entra al panel
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(boton()).toHaveFocus();
  });

  it('se abre con teclado (Enter) y se cierra con el botón Cerrar, devolviendo el foco', async () => {
    render(<HelpDrawer helpId="dashboard" />);
    boton().focus();
    await userEvent.keyboard('{Enter}');
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Cerrar ayuda' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(boton()).toHaveFocus();
  });

  it('el foco queda atrapado dentro del panel al tabular', async () => {
    render(<HelpDrawer helpId="dashboard" />);
    await userEvent.click(boton());
    await userEvent.tab();
    await userEvent.tab();
    expect(screen.getByRole('dialog')).toContainElement(document.activeElement as HTMLElement);
  });

  it('cada pantalla tiene contenido propio; Cola y Métricas son distintos', async () => {
    const ids = Object.keys(HELP) as HelpId[];
    expect(new Set(ids.map((i) => HELP[i].titulo)).size).toBe(ids.length);

    const { unmount } = render(<HelpDrawer helpId="revision-cola" />);
    await userEvent.click(boton());
    expect(screen.getByRole('dialog', { name: /Cola de revisión/ })).toBeInTheDocument();
    unmount();
    render(<HelpDrawer helpId="revision-metricas" />);
    await userEvent.click(boton());
    expect(screen.getByRole('dialog', { name: /Métricas/ })).toBeInTheDocument();
  });

  it('los umbrales de la Cola se leen de la configuración real, no están escritos a mano', async () => {
    render(<HelpDrawer helpId="revision-cola" />);
    await userEvent.click(boton());
    const confianza = `${Math.round(UMBRAL_CONFIANZA_BAJA * 100)} %`;
    const peso = `${Math.round(UMBRAL_DIFERENCIA_PESO * 100)} %`;
    expect(screen.getByText(new RegExp(`confianza menor a ${confianza}`))).toBeInTheDocument();
    expect(screen.getByText(new RegExp(`más de ${peso}`))).toBeInTheDocument();
  });

  it('ningún texto de ayuda menciona AFDAA', () => {
    expect(JSON.stringify(HELP)).not.toMatch(/AFDAA/i);
  });
});

describe('PageHeader y SubTabs', () => {
  it('el encabezado muestra título, subtítulo, el botón "i" junto al título y las acciones', () => {
    render(<PageHeader title="Deportistas" subtitle="Cohorte" helpId="deportistas" actions={<button>Acción</button>} />);
    expect(screen.getByRole('heading', { level: 1, name: 'Deportistas' })).toBeInTheDocument();
    expect(screen.getByText('Cohorte')).toBeInTheDocument();
    expect(boton()).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Acción' })).toBeInTheDocument();
  });

  it('SubTabs marca la pestaña activa y las demás son links', () => {
    render(<SubTabs tabs={[{ label: 'Cola de revisión', href: '/revision-ia' }, { label: 'Métricas', href: '/revision-ia/metricas' }]} activeHref="/revision-ia/metricas" />);
    expect(screen.getByRole('tab', { name: 'Métricas' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: 'Cola de revisión' })).toHaveAttribute('aria-selected', 'false');
    expect(screen.getByRole('tab', { name: 'Cola de revisión' })).toHaveAttribute('href', '/revision-ia');
  });
});
