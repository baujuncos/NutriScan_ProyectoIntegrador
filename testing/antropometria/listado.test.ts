import { describe, expect, it } from 'vitest';
import { armarListado, type FuentesListado } from '@/lib/researcher/antropometria/listado';

const HOY = new Date(2026, 9, 24);

const base: FuentesListado = {
  perfiles: [
    { user_id: 'd1', nombre: 'Lucía', apellido: 'Vega' },
    { user_id: 'd2', nombre: 'Tomás', apellido: 'Aguirre' },
  ],
  fisicos: [{ user_id: 'd1', fecha_nacimiento: '2000-02-15', sexo: 'F' }],
  auxiliares: [{ user_id: 'd2', fecha_nacimiento: '1999-03-01', sexo: 'M' }],
  manuales: [{ id: 'm1', nombre: 'Julieta', apellido: 'Marchetti', fecha_nacimiento: '2002-04-05', sexo: 'F' }],
  medicionesVigentes: [
    { user_id: 'd1', paciente_manual_id: null, fecha_medicion: '2026-08-10' },
    { user_id: 'd1', paciente_manual_id: null, fecha_medicion: '2026-10-01' },
    { user_id: null, paciente_manual_id: 'm1', fecha_medicion: '2026-10-24' },
  ],
};

describe('armarListado', () => {
  const listado = armarListado(base, HOY);

  it('une deportistas y manuales, ordenados por apellido', () => {
    expect(listado.map((p) => `${p.origen}:${p.apellido}`)).toEqual([
      'deportista:Aguirre',
      'manual:Marchetti',
      'deportista:Vega',
    ]);
  });

  it('cuenta las mediciones vigentes y toma la fecha más reciente', () => {
    const lucia = listado.find((p) => p.id === 'd1')!;
    expect(lucia.cantidadMediciones).toBe(2);
    expect(lucia.ultimaMedicion).toBe('2026-10-01');
    expect(listado.find((p) => p.id === 'm1')!.ultimaMedicion).toBe('2026-10-24');
  });

  it('sin mediciones → 0 y sin fecha', () => {
    const tomas = listado.find((p) => p.id === 'd2')!;
    expect(tomas.cantidadMediciones).toBe(0);
    expect(tomas.ultimaMedicion).toBeNull();
  });

  it('physical_data manda; el dato auxiliar solo rellena lo que falta', () => {
    const conAmbos = armarListado(
      { ...base, auxiliares: [{ user_id: 'd1', fecha_nacimiento: '1990-01-01', sexo: 'M' }] },
      HOY,
    ).find((p) => p.id === 'd1')!;
    expect(conAmbos.fechaNacimiento).toBe('2000-02-15');
    expect(conAmbos.sexo).toBe('F');

    const soloAuxiliar = listado.find((p) => p.id === 'd2')!;
    expect(soloAuxiliar.fechaNacimiento).toBe('1999-03-01');
    expect(soloAuxiliar.sexo).toBe('M');
    expect(soloAuxiliar.edad).toBe(27);
  });

  it('un deportista sin datos queda sin edad ni sexo', () => {
    const sinDatos = armarListado({ ...base, fisicos: [], auxiliares: [] }, HOY).find((p) => p.id === 'd1')!;
    expect(sinDatos.edad).toBeNull();
    expect(sinDatos.sexo).toBeNull();
  });
});
