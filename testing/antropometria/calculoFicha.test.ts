/**
 * Puente datos crudos → motor (lo que usan la ficha y el informe) y armado del paciente.
 * Paciente ficticia "Julieta": los valores ancla son los de la planilla de ejemplo.
 */
import { describe, expect, it } from 'vitest';
import { calcularMedicion, entradaDesdeMedicion, resumirMedicion } from '@/lib/researcher/antropometria/calculo';
import { armarPacienteDeportista, armarPacienteManual } from '@/lib/researcher/antropometria/datos';
import { motivoBloqueoNuevaMedicion } from '@/lib/researcher/antropometria/reglas';
import { rutaEditarMedicion, rutaFicha, rutaInforme, rutaNuevaMedicion } from '@/lib/researcher/antropometria/rutas';
import { MAX_MEDICIONES_POR_PACIENTE } from '@/types/antropometria';
import { MASA_OSEA_REFERENCIA_JULIETA, SERIES_JULIETA } from '../fixtures/antropometria';

const paciente = { fechaNacimiento: '2002-04-05', sexo: 'F' as const, masaOseaReferencia: MASA_OSEA_REFERENCIA_JULIETA };
const medicion = { fecha_medicion: '2026-10-24', series: SERIES_JULIETA, nivel_actividad: 'moderada' as const, deporte: 'voleibol' };

describe('calcularMedicion / resumirMedicion', () => {
  it('reproduce los valores ancla de la planilla (masa adiposa 17,64 kg, muscular 21,26 kg)', () => {
    const r = resumirMedicion(paciente, medicion)!;
    expect(r.masaAdiposaKg).toBeCloseTo(17.64, 2);
    expect(r.masaMuscularKg).toBeCloseTo(21.26, 2);
    expect(r.pesoKg).toBeCloseTo(53.05, 2);
  });

  it('un menor no se calcula: vuelve el motivo del motor, sin excepción', () => {
    const r = calcularMedicion({ ...paciente, fechaNacimiento: '2015-01-01' }, medicion);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.motivo).toMatch(/mayores de 18/);
    expect(resumirMedicion({ ...paciente, fechaNacimiento: '2015-01-01' }, medicion)).toBeNull();
  });

  it('con series incompletas (un borrador) no se calcula', () => {
    const { peso: _peso, ...sinPeso } = SERIES_JULIETA;
    void _peso;
    const r = calcularMedicion(paciente, { ...medicion, series: sinPeso });
    expect(r.ok).toBe(false);
  });

  it('sin sexo, sin nacimiento o sin nivel de actividad no arma la entrada', () => {
    expect(entradaDesdeMedicion({ ...paciente, sexo: null }, medicion)).toBeNull();
    expect(entradaDesdeMedicion({ ...paciente, fechaNacimiento: null }, medicion)).toBeNull();
    expect(entradaDesdeMedicion(paciente, { ...medicion, nivel_actividad: null })).toBeNull();
  });

  it('pasa la masa ósea de referencia del paciente al motor', () => {
    expect(entradaDesdeMedicion(paciente, medicion)?.masaOseaReferencia).toBe(MASA_OSEA_REFERENCIA_JULIETA);
  });
});

describe('armado del paciente', () => {
  const perfil = { user_id: 'u1', nombre: 'Lucía', apellido: 'Vega' };

  it('deportista: physical_data manda sobre el dato auxiliar', () => {
    const p = armarPacienteDeportista(
      perfil,
      { fecha_nacimiento: '2000-02-15', sexo: 'F' },
      { fecha_nacimiento: '1990-01-01', sexo: 'M', masa_osea_referencia: 6.2 },
    );
    expect(p).toMatchObject({ origen: 'deportista', id: 'u1', fechaNacimiento: '2000-02-15', sexo: 'F', masaOseaReferencia: 6.2 });
  });

  it('deportista sin physical_data: usa el auxiliar; sin nada, queda sin datos', () => {
    expect(armarPacienteDeportista(perfil, null, { fecha_nacimiento: '1999-03-01', sexo: 'M', masa_osea_referencia: null })).toMatchObject({
      fechaNacimiento: '1999-03-01',
      sexo: 'M',
      masaOseaReferencia: null,
    });
    expect(armarPacienteDeportista(perfil, null, null)).toMatchObject({ fechaNacimiento: null, sexo: null, masaOseaReferencia: null });
  });

  it('manual: copia los datos y la masa ósea de referencia', () => {
    const p = armarPacienteManual({
      id: 'm1',
      nombre: 'Julieta',
      apellido: 'Marchetti',
      fecha_nacimiento: '2002-04-05',
      sexo: 'F',
      masa_osea_referencia: 6.196,
      creado_por: 'inv',
      creado_en: '2026-10-24T00:00:00Z',
    });
    expect(p).toEqual({
      origen: 'manual',
      id: 'm1',
      nombre: 'Julieta',
      apellido: 'Marchetti',
      fechaNacimiento: '2002-04-05',
      sexo: 'F',
      masaOseaReferencia: 6.196,
    });
  });
});

describe('motivoBloqueoNuevaMedicion', () => {
  const HOY = new Date(2026, 9, 24);

  it('mayor con lugar → se puede', () => {
    expect(motivoBloqueoNuevaMedicion({ fechaNacimiento: '2002-04-05' }, 3, HOY)).toBeNull();
  });

  it('menor → mensaje claro', () => {
    expect(motivoBloqueoNuevaMedicion({ fechaNacimiento: '2015-01-01' }, 0, HOY)).toMatch(/mayores de 18/);
  });

  it('12 vigentes → bloqueado; 11 → no', () => {
    expect(motivoBloqueoNuevaMedicion({ fechaNacimiento: '2002-04-05' }, MAX_MEDICIONES_POR_PACIENTE, HOY)).toMatch(/12 mediciones/);
    expect(motivoBloqueoNuevaMedicion({ fechaNacimiento: '2002-04-05' }, MAX_MEDICIONES_POR_PACIENTE - 1, HOY)).toBeNull();
  });

  it('deportista sin fecha cargada → no se bloquea (el asistente se la pide)', () => {
    expect(motivoBloqueoNuevaMedicion({ fechaNacimiento: null }, 0, HOY)).toBeNull();
  });
});

describe('rutas', () => {
  it('arman las URLs de ficha, medición nueva, informe y edición', () => {
    expect(rutaFicha('manual', 'm1')).toBe('/antropometrias/manual/m1');
    expect(rutaNuevaMedicion('deportista', 'u1')).toBe('/antropometrias/deportista/u1/medicion/nueva');
    expect(rutaInforme('x9')).toBe('/antropometrias/medicion/x9');
    expect(rutaEditarMedicion('x9')).toBe('/antropometrias/medicion/x9/editar');
  });
});
