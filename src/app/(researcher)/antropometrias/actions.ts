'use server';

/**
 * Acciones de Antropometrías (NUT-235). Toda acción arranca con
 * `clienteInvestigador()`; además de ese chequeo, la base aplica RLS
 * (supabase/021_antropometria_nut247.sql).
 */

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { parseDateLocal } from '@/lib/dates';
import { clienteInvestigador } from '@/lib/researcher/clienteInvestigador';
import { cargarListado } from '@/lib/researcher/antropometria/listado';
import { buscarDuplicado, edadEn, esMayorDeEdad, MENSAJE_MENOR_DE_EDAD } from '@/lib/researcher/antropometria/reglas';

export type ResultadoError = { error: string };
export type PacienteDuplicado = { id: string; origen: 'deportista' | 'manual'; nombre: string; apellido: string };

const EDAD_MAXIMA = 100;

const pacienteManualSchema = z.object({
  nombre: z.string().trim().min(1, 'Ingresá el nombre.').max(80, 'El nombre es demasiado largo.'),
  apellido: z.string().trim().min(1, 'Ingresá el apellido.').max(80, 'El apellido es demasiado largo.'),
  fechaNacimiento: z
    .string()
    .refine((v) => parseDateLocal(v) !== null, 'Ingresá una fecha de nacimiento válida.'),
  sexo: z.enum(['M', 'F'], { message: 'Elegí el sexo.' }),
});

export type PacienteManualInput = z.input<typeof pacienteManualSchema>;

/**
 * Alta de un paciente manual. Rechaza menores. Si ya hay alguien con el mismo
 * nombre, apellido y fecha de nacimiento devuelve `duplicado` SIN guardar: la UI
 * avisa y vuelve a llamar con `confirmarDuplicado = true` (el aviso no bloquea).
 */
export async function crearPacienteManualAction(
  input: unknown,
  confirmarDuplicado = false,
): Promise<{ ok: true; id: string } | ResultadoError | { duplicado: PacienteDuplicado }> {
  const auth = await clienteInvestigador();
  if ('error' in auth) return auth;

  const parsed = pacienteManualSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Datos inválidos.' };
  const { nombre, apellido, fechaNacimiento, sexo } = parsed.data;

  if (!esMayorDeEdad(fechaNacimiento)) return { error: MENSAJE_MENOR_DE_EDAD };
  if ((edadEn(fechaNacimiento) ?? 0) > EDAD_MAXIMA) return { error: 'Revisá la fecha de nacimiento.' };

  if (!confirmarDuplicado) {
    const existente = buscarDuplicado({ nombre, apellido, fechaNacimiento }, await cargarListado(auth.supabase));
    if (existente) {
      return { duplicado: { id: existente.id, origen: existente.origen, nombre: existente.nombre, apellido: existente.apellido } };
    }
  }

  // `creado_por` lo completa la base con auth.uid() (default) y la policy lo exige.
  const { data, error } = await auth.supabase
    .from('antropometria_pacientes_manuales')
    .insert({ nombre, apellido, fecha_nacimiento: fechaNacimiento, sexo })
    .select('id')
    .single();
  if (error || !data) return { error: 'No se pudo guardar el paciente. Probá de nuevo.' };

  revalidatePath('/antropometrias');
  return { ok: true, id: (data as { id: string }).id };
}
