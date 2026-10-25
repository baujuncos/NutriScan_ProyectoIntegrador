/**
 * AcademicForm — datos académicos y deportivos de los deportistas UCC.
 * Selects dependientes: la carrera depende de la unidad académica y la posición del deporte.
 * Valores límite del año de ingreso: 1989 (rechaza) · 1990 (acepta) · año actual (acepta) · año actual + 1 (rechaza).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { createSupabaseFromMock } from './supabaseMock';

const { getUserMock } = vi.hoisted(() => ({ getUserMock: vi.fn() }));
const db = createSupabaseFromMock();
vi.mock('@/lib/supabase/client', () => ({ createClient: () => ({ auth: { getUser: getUserMock }, from: db.from }) }));

import AcademicForm from '@/components/profile/AcademicForm';

const ANIO_ACTUAL = new Date().getFullYear();
const opciones = (select: HTMLElement) => within(select).getAllByRole('option').map((o) => o.textContent);

function llenar(over: Partial<Record<'unidad' | 'carrera' | 'anio' | 'deporte' | 'posicion' | 'practicas' | 'horas' | 'competencias', string>> = {}) {
  const v = {
    unidad: 'Ingeniería', carrera: 'Ing. Informática', anio: '2022', deporte: 'hockey', posicion: 'Arquera',
    practicas: '3', horas: '1.5', competencias: 'Todas las semanas', ...over,
  };
  fireEvent.change(screen.getByLabelText('Unidad Académica'), { target: { value: v.unidad } });
  fireEvent.change(screen.getByLabelText('Carrera'), { target: { value: v.carrera } });
  fireEvent.change(screen.getByLabelText('Año de ingreso a la facultad'), { target: { value: v.anio } });
  fireEvent.change(screen.getByLabelText('Deporte'), { target: { value: v.deporte } });
  fireEvent.change(screen.getByLabelText('Posición en el equipo'), { target: { value: v.posicion } });
  fireEvent.change(screen.getByLabelText('Prácticas por semana'), { target: { value: v.practicas } });
  fireEvent.change(screen.getByLabelText('Horas por práctica'), { target: { value: v.horas } });
  fireEvent.change(screen.getByLabelText('Frecuencia de competencias'), { target: { value: v.competencias } });
}
// Se dispara el submit directo: con un click, la validación nativa del navegador (min/max del input)
// frena el envío antes de que corra la validación del código, que es la que se quiere probar.
const enviar = () => fireEvent.submit(screen.getByRole('button', { name: /Guardar y Continuar/ }).closest('form')!);
const guardado = () => db.insertsLlamados().find((i) => i.tabla === 'academic_data')?.payload as Record<string, unknown> | undefined;

beforeEach(() => {
  db.reset();
  getUserMock.mockReset().mockResolvedValue({ data: { user: { id: 'u-1' } } });
});

describe('AcademicForm — selects dependientes', () => {
  it('al inicio carrera y posición están deshabilitadas con un texto guía', () => {
    render(<AcademicForm />);
    expect(screen.getByLabelText('Carrera')).toBeDisabled();
    expect(screen.getByLabelText('Posición en el equipo')).toBeDisabled();
    expect(opciones(screen.getByLabelText('Carrera'))).toEqual(['Primero selecciona una unidad académica']);
    expect(opciones(screen.getByLabelText('Posición en el equipo'))).toEqual(['Primero selecciona un deporte']);
  });

  it('elegir una unidad habilita solo sus carreras', () => {
    render(<AcademicForm />);
    fireEvent.change(screen.getByLabelText('Unidad Académica'), { target: { value: 'Teología' } });
    expect(screen.getByLabelText('Carrera')).toBeEnabled();
    expect(opciones(screen.getByLabelText('Carrera'))).toEqual(['Selecciona tu carrera', 'Teología', 'Prof. en Teología', 'Bach. Eclesiástico']);
  });

  it('cambiar de unidad borra la carrera elegida', () => {
    render(<AcademicForm />);
    fireEvent.change(screen.getByLabelText('Unidad Académica'), { target: { value: 'Ingeniería' } });
    fireEvent.change(screen.getByLabelText('Carrera'), { target: { value: 'Ing. Civil' } });
    fireEvent.change(screen.getByLabelText('Unidad Académica'), { target: { value: 'Educación' } });
    expect(screen.getByLabelText('Carrera')).toHaveValue('');
  });

  it('las posiciones dependen del deporte y cambiar de deporte las reinicia', () => {
    render(<AcademicForm />);
    fireEvent.change(screen.getByLabelText('Deporte'), { target: { value: 'basquet' } });
    expect(opciones(screen.getByLabelText('Posición en el equipo'))).toContain('Pivot');
    fireEvent.change(screen.getByLabelText('Posición en el equipo'), { target: { value: 'Base' } });
    fireEvent.change(screen.getByLabelText('Deporte'), { target: { value: 'hockey' } });
    expect(screen.getByLabelText('Posición en el equipo')).toHaveValue('');
    expect(opciones(screen.getByLabelText('Posición en el equipo'))).toContain('Arquera');
    expect(opciones(screen.getByLabelText('Posición en el equipo'))).not.toContain('Pivot');
  });
});

describe('AcademicForm — validación', () => {
  it('con todo vacío muestra los 8 errores y no guarda', async () => {
    render(<AcademicForm />);
    enviar();
    for (const m of [
      'Selecciona tu unidad académica', 'Selecciona tu carrera', 'Selecciona el año', 'Selecciona un deporte',
      'Selecciona tu posición', 'Ingresa la frecuencia de prácticas', 'Ingresa las horas de práctica', 'Selecciona la frecuencia de competencias',
    ]) {
      expect(await screen.findByText(m)).toBeInTheDocument();
    }
    expect(db.tablasLlamadas()).toEqual([]);
  });

  it.each([['1989'], [String(ANIO_ACTUAL + 1)]])('año de ingreso %s → rechaza', async (anio) => {
    render(<AcademicForm />);
    llenar({ anio });
    enviar();
    expect(await screen.findByText(`Año inválido (entre 1990 y ${ANIO_ACTUAL})`)).toBeInTheDocument();
    expect(guardado()).toBeUndefined();
  });

  it.each([['1990'], [String(ANIO_ACTUAL)]])('año de ingreso %s → acepta', async (anio) => {
    db.mockTable('academic_data', { data: null, error: null });
    db.mockTable('profiles', { data: null, error: null });
    const onSaved = vi.fn();
    render(<AcademicForm onSaved={onSaved} />);
    llenar({ anio });
    enviar();
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(guardado()?.anio).toBe(Number(anio));
  });
});

describe('AcademicForm — guardado', () => {
  it('guarda los datos con los tipos correctos, marca el onboarding y avisa', async () => {
    db.mockTable('academic_data', { data: null, error: null });
    db.mockTable('profiles', { data: null, error: null });
    const onSaved = vi.fn();
    render(<AcademicForm onSaved={onSaved} />);
    llenar({ deporte: 'basquet', posicion: 'Pivot', practicas: '5', horas: '2.5' });
    enviar();
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
    expect(guardado()).toEqual({
      user_id: 'u-1', unidad_academica: 'Ingeniería', carrera: 'Ing. Informática', anio: 2022, deporte: 'basquet',
      posicion: 'Pivot', frecuencia_practicas_semana: 5, horas_practica: 2.5, frecuencia_competencias: 'Todas las semanas',
    });
    expect(db.eqLlamados()).toContainEqual({ tabla: 'profiles', metodo: 'eq', args: ['user_id', 'u-1'] });
  });

  it('sin sesión informa "Sesión expirada" y no guarda', async () => {
    getUserMock.mockResolvedValue({ data: { user: null } });
    render(<AcademicForm />);
    llenar();
    enviar();
    expect(await screen.findByText('Sesión expirada. Iniciá sesión de nuevo.')).toBeInTheDocument();
    expect(guardado()).toBeUndefined();
  });

  it('si falla el guardado académico lo informa y no marca el perfil', async () => {
    db.mockTable('academic_data', { data: null, error: { message: 'x' } });
    render(<AcademicForm />);
    llenar();
    enviar();
    expect(await screen.findByText('Error al guardar los datos académicos. Intente nuevamente.')).toBeInTheDocument();
    expect(db.tablasLlamadas()).not.toContain('profiles');
  });

  it('si falla la marca de onboarding lo informa y no llama a onSaved', async () => {
    db.mockTable('academic_data', { data: null, error: null });
    db.mockTable('profiles', { data: null, error: { message: 'x' } });
    const onSaved = vi.fn();
    render(<AcademicForm onSaved={onSaved} />);
    llenar();
    enviar();
    expect(await screen.findByText('Error al actualizar el perfil. Intente nuevamente.')).toBeInTheDocument();
    expect(onSaved).not.toHaveBeenCalled();
  });
});

describe('AcademicForm — edición', () => {
  it('precarga los datos existentes (incluida la carrera y la posición) y usa la etiqueta recibida', () => {
    render(
      <AcademicForm
        submitLabel="Actualizar"
        initialData={{
          unidad_academica: 'Ciencias de la Salud', carrera: 'Nutrición', anio: 2021, deporte: 'hockey', posicion: 'Defensa',
          frecuencia_practicas_semana: 4, horas_practica: 2, frecuencia_competencias: 'Cada dos semanas',
        }}
      />,
    );
    expect(screen.getByLabelText('Unidad Académica')).toHaveValue('Ciencias de la Salud');
    expect(screen.getByLabelText('Carrera')).toHaveValue('Nutrición');
    expect(screen.getByLabelText('Posición en el equipo')).toHaveValue('Defensa');
    expect(screen.getByLabelText('Prácticas por semana')).toHaveValue('4');
    expect(screen.getByRole('button', { name: 'Actualizar' })).toBeInTheDocument();
  });

  it('una unidad desconocida en los datos guardados deja la carrera deshabilitada (no revienta)', () => {
    render(<AcademicForm initialData={{ unidad_academica: 'Unidad que ya no existe', deporte: 'otro' }} />);
    expect(screen.getByLabelText('Carrera')).toBeDisabled();
    expect(screen.getByLabelText('Posición en el equipo')).toBeDisabled();
  });
});
