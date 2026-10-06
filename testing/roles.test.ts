import { describe, it, expect } from 'vitest';
import {
  getRoleLabel,
  determineRoleFromEmail,
  extractNombreApellido,
  esAltaInvestigador,
  esEmailUCC,
} from '@/lib/roles';

// ─────────────────────────────────────────────────────────────────────────────
// getRoleLabel — etiqueta en español para cada rol del sistema
// ─────────────────────────────────────────────────────────────────────────────
describe('getRoleLabel', () => {
  it('devuelve etiqueta para deportista_ucc', () => {
    expect(getRoleLabel('deportista_ucc')).toBe('Deportista UCC');
  });

  it('devuelve etiqueta para particular', () => {
    expect(getRoleLabel('particular')).toBe('Usuario Particular');
  });

  it('devuelve el rol sin transformar si no está mapeado', () => {
    expect(getRoleLabel('investigador')).toBe('investigador');
    expect(getRoleLabel('administrador')).toBe('administrador');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// determineRoleFromEmail — asigna rol según dominio del email
//   @ucc.edu.ar → deportista_ucc  |  cualquier otro → particular
// ─────────────────────────────────────────────────────────────────────────────
describe('determineRoleFromEmail', () => {
  it('asigna deportista_ucc a emails de ucc.edu.ar', () => {
    expect(determineRoleFromEmail('alumno@ucc.edu.ar')).toBe('deportista_ucc');
  });

  it('asigna particular a emails de otros dominios', () => {
    expect(determineRoleFromEmail('usuario@gmail.com')).toBe('particular');
    expect(determineRoleFromEmail('persona@hotmail.com')).toBe('particular');
    expect(determineRoleFromEmail('user@yahoo.com.ar')).toBe('particular');
  });

  it('es insensible a mayúsculas en el dominio', () => {
    expect(determineRoleFromEmail('alumno@UCC.EDU.AR')).toBe('deportista_ucc');
    expect(determineRoleFromEmail('alumno@Ucc.Edu.Ar')).toBe('deportista_ucc');
  });

  it('no confunde un dominio que contiene ucc con el dominio oficial', () => {
    expect(determineRoleFromEmail('user@migucc.edu.ar')).toBe('particular');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// extractNombreApellido — extrae nombre y apellido desde metadatos de Supabase
//   Soporta registro por email (nombre/apellido separados)
//   y Google OAuth (full_name como string único)
// ─────────────────────────────────────────────────────────────────────────────
describe('extractNombreApellido', () => {
  it('extrae nombre y apellido desde registro por email', () => {
    const result = extractNombreApellido({ nombre: 'María', apellido: 'González' });
    expect(result.nombre).toBe('María');
    expect(result.apellido).toBe('González');
  });

  it('extrae nombre y apellido desde full_name (Google OAuth)', () => {
    const result = extractNombreApellido({ full_name: 'Carlos Rodríguez' });
    expect(result.nombre).toBe('Carlos');
    expect(result.apellido).toBe('Rodríguez');
  });

  it('maneja full_name con apellido compuesto', () => {
    const result = extractNombreApellido({ full_name: 'Ana María De La Torre' });
    expect(result.nombre).toBe('Ana');
    expect(result.apellido).toBe('María De La Torre');
  });

  it('devuelve strings vacíos cuando no hay metadatos', () => {
    const result = extractNombreApellido({});
    expect(result.nombre).toBe('');
    expect(result.apellido).toBe('');
  });

  it('prioriza nombre/apellido separados por sobre full_name', () => {
    const result = extractNombreApellido({
      nombre: 'Laura',
      apellido: 'Martínez',
      full_name: 'Nombre Incorrecto',
    });
    expect(result.nombre).toBe('Laura');
    expect(result.apellido).toBe('Martínez');
  });
});

describe('esAltaInvestigador', () => {
  it('alta por email: user_metadata.role investigador', () => {
    expect(esAltaInvestigador({ metaRole: 'investigador' })).toBe(true);
  });

  it('alta con Google: cookie igual al código válido', () => {
    expect(esAltaInvestigador({ metaRole: undefined, cookieToken: 'abc', validCode: 'abc' })).toBe(true);
  });

  it('cookie distinta, ausente o sin código configurado → no es investigador', () => {
    expect(esAltaInvestigador({ metaRole: undefined, cookieToken: 'x', validCode: 'abc' })).toBe(false);
    expect(esAltaInvestigador({ metaRole: undefined, validCode: 'abc' })).toBe(false);
    expect(esAltaInvestigador({ metaRole: undefined, cookieToken: undefined, validCode: undefined })).toBe(false);
    expect(esAltaInvestigador({ metaRole: undefined, cookieToken: '', validCode: '' })).toBe(false);
  });
});

describe('esEmailUCC', () => {
  it('solo @ucc.edu.ar', () => {
    expect(esEmailUCC('a@UCC.edu.ar')).toBe(true);
    expect(esEmailUCC('a@gmail.com')).toBe(false);
    expect(esEmailUCC(undefined)).toBe(false);
  });
});
