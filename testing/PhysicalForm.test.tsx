/**
 * PhysicalForm — perfil físico del onboarding: calcula TMB/GET/macros y los guarda.
 * Valores límite del peso: 19,9 (rechaza) · 20 (acepta) · 300 (acepta) · 300,1 (rechaza).
 * Valores límite de la altura: 99 · 100 · 250 · 251. Selects obligatorios: sexo y factor de actividad.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createSupabaseFromMock } from './supabaseMock';
import { todayAR } from '@/lib/date';

const { getUserMock } = vi.hoisted(() => ({ getUserMock: vi.fn() }));
const db = createSupabaseFromMock();
vi.mock('@/lib/supabase/client', () => ({ createClient: () => ({ auth: { getUser: getUserMock }, from: db.from }) }));

import PhysicalForm from '@/components/profile/PhysicalForm';

const haceAnios = (n: number) => {
  const [y, m, d] = todayAR().split('-').map(Number);
  return new Date(Date.UTC(y - n, m - 1, d)).toISOString().slice(0, 10);
};

function llenar(over: Partial<Record<'peso' | 'altura' | 'fecha' | 'sexo' | 'actividad', string>> = {}) {
  const v = { peso: '70', altura: '175', fecha: haceAnios(30), sexo: 'M', actividad: '1.55', ...over };
  fireEvent.change(screen.getByLabelText('Peso (kg)'), { target: { value: v.peso } });
  fireEvent.change(screen.getByLabelText('Altura (cm)'), { target: { value: v.altura } });
  fireEvent.change(screen.getByLabelText('Fecha de Nacimiento'), { target: { value: v.fecha } });
  fireEvent.change(screen.getByLabelText('Sexo'), { target: { value: v.sexo } });
  fireEvent.change(screen.getByLabelText('Nivel de Actividad Física'), { target: { value: v.actividad } });
}
const enviar = () => fireEvent.click(screen.getByRole('button', { name: /Guardar y Continuar/ }));
const upsert = () => db.insertsLlamados().find((i) => i.tabla === 'physical_data')?.payload as Record<string, unknown> | undefined;

beforeEach(() => {
  db.reset();
  getUserMock.mockReset().mockResolvedValue({ data: { user: { id: 'u-1' } } });
});

describe('PhysicalForm — campos obligatorios', () => {
  it('con todo vacío muestra los 5 errores y no guarda', async () => {
    render(<PhysicalForm />);
    enviar();
    expect(await screen.findByText('Ingresa tu peso')).toBeInTheDocument();
    expect(screen.getByText('Ingresa tu altura')).toBeInTheDocument();
    expect(screen.getByText('La fecha de nacimiento es requerida')).toBeInTheDocument();
    expect(screen.getByText('Selecciona el sexo')).toBeInTheDocument();
    expect(screen.getByText('Selecciona un factor de actividad')).toBeInTheDocument();
    expect(db.tablasLlamadas()).toEqual([]);
  });
});

describe('PhysicalForm — valores límite', () => {
  it.each([
    ['19.9', 'Peso debe estar entre 20 y 300 kg'],
    ['300.1', 'Peso debe estar entre 20 y 300 kg'],
  ])('peso %s → rechaza', async (peso, mensaje) => {
    render(<PhysicalForm />);
    llenar({ peso });
    enviar();
    expect(await screen.findByText(mensaje)).toBeInTheDocument();
    expect(upsert()).toBeUndefined();
  });

  it.each([['20'], ['300']])('peso %s → acepta', async (peso) => {
    db.mockTable('physical_data', { data: null, error: null });
    db.mockTable('profiles', { data: null, error: null });
    const onSaved = vi.fn();
    render(<PhysicalForm onSaved={onSaved} />);
    llenar({ peso });
    enviar();
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(upsert()?.peso_kg).toBe(Number(peso));
  });

  it.each([['99'], ['251']])('altura %s → rechaza', async (altura) => {
    render(<PhysicalForm />);
    llenar({ altura });
    enviar();
    expect(await screen.findByText('Altura debe estar entre 100 y 250 cm')).toBeInTheDocument();
    expect(upsert()).toBeUndefined();
  });

  it.each([['100'], ['250']])('altura %s → acepta', async (altura) => {
    db.mockTable('physical_data', { data: null, error: null });
    db.mockTable('profiles', { data: null, error: null });
    const onSaved = vi.fn();
    render(<PhysicalForm onSaved={onSaved} />);
    llenar({ altura });
    enviar();
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
  });

  it('una fecha de nacimiento que haría menor de 10 años se rechaza con el mensaje del validador', async () => {
    render(<PhysicalForm />);
    llenar({ fecha: haceAnios(9) });
    enviar();
    expect(await screen.findByText('Debés tener al menos 10 años.')).toBeInTheDocument();
  });

  it('el selector de fecha limita entre el mínimo y hoy (mismo límite que el validador, DEF-019)', () => {
    render(<PhysicalForm />);
    const input = screen.getByLabelText('Fecha de Nacimiento');
    expect(input).toHaveAttribute('max', todayAR());
    expect(input.getAttribute('min')! < todayAR()).toBe(true);
  });
});

describe('PhysicalForm — guardado', () => {
  it('guarda el perfil con TMB/GET/macros calculados, marca el onboarding y avisa', async () => {
    db.mockTable('physical_data', { data: null, error: null });
    db.mockTable('profiles', { data: null, error: null });
    const onSaved = vi.fn();
    render(<PhysicalForm onSaved={onSaved} />);
    llenar();
    enviar();
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
    expect(upsert()).toMatchObject({ user_id: 'u-1', peso_kg: 70, altura_cm: 175, sexo: 'M', factor_actividad: 1.55 });
    expect(upsert()?.tmb).toBeGreaterThan(1500);
    expect(Number(upsert()?.get_kcal)).toBeGreaterThan(Number(upsert()?.tmb));
    expect(db.eqLlamados()).toContainEqual({ tabla: 'profiles', metodo: 'eq', args: ['user_id', 'u-1'] });
  });

  it('sin sesión muestra "Sesión expirada" y no guarda', async () => {
    getUserMock.mockResolvedValue({ data: { user: null } });
    render(<PhysicalForm />);
    llenar();
    enviar();
    expect(await screen.findByText('Sesión expirada. Iniciá sesión de nuevo.')).toBeInTheDocument();
    expect(upsert()).toBeUndefined();
  });

  it('si falla el guardado de los datos físicos lo informa y no marca el perfil', async () => {
    db.mockTable('physical_data', { data: null, error: { message: 'x' } });
    render(<PhysicalForm />);
    llenar();
    enviar();
    expect(await screen.findByText('Error al guardar el perfil físico. Intente nuevamente.')).toBeInTheDocument();
    expect(db.tablasLlamadas()).not.toContain('profiles');
  });

  it('si falla la marca de onboarding lo informa y no llama a onSaved', async () => {
    db.mockTable('physical_data', { data: null, error: null });
    db.mockTable('profiles', { data: null, error: { message: 'x' } });
    const onSaved = vi.fn();
    render(<PhysicalForm onSaved={onSaved} />);
    llenar();
    enviar();
    expect(await screen.findByText('Error al actualizar el perfil. Intente nuevamente.')).toBeInTheDocument();
    expect(onSaved).not.toHaveBeenCalled();
  });
});

describe('PhysicalForm — edición', () => {
  it('precarga los datos existentes y usa la etiqueta del botón recibida', () => {
    render(
      <PhysicalForm
        submitLabel="Actualizar"
        initialData={{ peso_kg: 65.5, altura_cm: 168, fecha_nacimiento: haceAnios(22), sexo: 'F', factor_actividad: 1.375 }}
      />,
    );
    expect(screen.getByLabelText('Peso (kg)')).toHaveValue(65.5);
    expect(screen.getByLabelText('Altura (cm)')).toHaveValue(168);
    expect(screen.getByLabelText('Sexo')).toHaveValue('F');
    expect(screen.getByLabelText('Nivel de Actividad Física')).toHaveValue('1.375');
    expect(screen.getByRole('button', { name: 'Actualizar' })).toBeInTheDocument();
  });

  it('el campo de peso bloquea la coma decimal (se usa punto)', () => {
    render(<PhysicalForm />);
    const peso = screen.getByLabelText('Peso (kg)');
    const evento = new KeyboardEvent('keydown', { key: ',', bubbles: true, cancelable: true });
    peso.dispatchEvent(evento);
    expect(evento.defaultPrevented).toBe(true);
  });
});
