import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SERIES_JULIETA } from './fixtures/antropometria';

const { push, guardarBorrador, finalizarMedicion } = vi.hoisted(() => ({
  push: vi.fn(),
  guardarBorrador: vi.fn(),
  finalizarMedicion: vi.fn(),
}));

vi.mock('next/navigation', () => ({ useRouter: () => ({ push }), usePathname: () => '/antropometrias' }));
vi.mock('@/app/(researcher)/antropometrias/actions', () => ({
  guardarBorradorAction: guardarBorrador,
  finalizarMedicionAction: finalizarMedicion,
}));

import MedicionWizard, { type InicialMedicion } from '@/app/(researcher)/antropometrias/MedicionWizard';
import type { PacienteAntropometria } from '@/types/antropometria';

const PACIENTE: PacienteAntropometria = {
  origen: 'manual',
  id: 'p1',
  nombre: 'Julieta',
  apellido: 'Marchetti',
  fechaNacimiento: '2002-04-05',
  sexo: 'F',
  masaOseaReferencia: null,
};

const INICIAL_COMPLETA: InicialMedicion = {
  id: 'm1',
  estado: 'borrador',
  fechaMedicion: '2026-10-24',
  nivelActividad: 'moderada',
  deporte: 'voleibol',
  series: SERIES_JULIETA,
};

function mostrar(props: Partial<React.ComponentProps<typeof MedicionWizard>> = {}) {
  return render(<MedicionWizard paciente={PACIENTE} otrasVigentes={[]} hoy="2026-10-30" inicial={null} {...props} />);
}

const irARevision = () => userEvent.click(screen.getByRole('button', { name: /5\. Revisión/ }));

beforeEach(() => {
  push.mockReset();
  guardarBorrador.mockReset().mockResolvedValue({ ok: true, id: 'nuevo-1' });
  finalizarMedicion.mockReset().mockResolvedValue({ ok: true, id: 'm1' });
});

describe('MedicionWizard — carga', () => {
  it('muestra los 5 pasos y arranca en datos básicos con las 3 variables básicas', () => {
    mostrar();
    for (const t of [/1\. Datos básicos/, /2\. Diámetros/, /3\. Perímetros/, /4\. Pliegues/, /5\. Revisión/]) {
      expect(screen.getByRole('button', { name: t })).toBeInTheDocument();
    }
    expect(screen.getByLabelText('Fecha de medición')).toHaveValue('2026-10-30');
    expect(screen.getByLabelText('Peso bruto, serie 1')).toBeInTheDocument();
    expect(screen.getByLabelText('Talla sentado, serie 3')).toBeInTheDocument();
  });

  it('los inputs usan teclado numérico decimal', () => {
    mostrar();
    expect(screen.getByLabelText('Peso bruto, serie 1')).toHaveAttribute('inputmode', 'decimal');
  });

  it('calcula mediana, desvío y % de error en vivo con coma decimal (informativo)', async () => {
    mostrar();
    expect(screen.getAllByText(/Faltan series/).length).toBeGreaterThan(0);
    await userEvent.type(screen.getByLabelText('Peso bruto, serie 1'), '53,1');
    await userEvent.type(screen.getByLabelText('Peso bruto, serie 2'), '53');
    expect(screen.getByText(/Mediana 53,05 · Desvío 0,07 · Error 0,1 %/)).toBeInTheDocument();
  });

  it('Enter pasa al campo siguiente', async () => {
    mostrar();
    await userEvent.type(screen.getByLabelText('Peso bruto, serie 1'), '53{Enter}');
    expect(screen.getByLabelText('Peso bruto, serie 2')).toHaveFocus();
  });

  it('un error de medición alto NO bloquea: solo informa', async () => {
    mostrar();
    await userEvent.type(screen.getByLabelText('Peso bruto, serie 1'), '50');
    await userEvent.type(screen.getByLabelText('Peso bruto, serie 2'), '60');
    expect(screen.getByText(/Error 12,9 %/)).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('avisa (sin bloquear) si ya hay una medición vigente en el mismo mes', () => {
    mostrar({ otrasVigentes: [{ id: 'x', fecha_medicion: '2026-10-03' }] });
    expect(screen.getByText(/Ya hay una medición de este mes \(03\/10\/2026\)/)).toBeInTheDocument();
  });
});

describe('MedicionWizard — menores', () => {
  it('a la fecha de medición es menor: mensaje claro y no se puede guardar', async () => {
    mostrar({ paciente: { ...PACIENTE, fechaNacimiento: '2015-01-01' }, inicial: INICIAL_COMPLETA });
    expect(screen.getByRole('alert')).toHaveTextContent(/mayores de 18/);
    await irARevision();
    expect(screen.getByRole('button', { name: 'Guardar y generar informe' })).toBeDisabled();
  });
});

describe('MedicionWizard — revisión y guardado', () => {
  it('con 24 de 25 variables el botón queda deshabilitado y lista lo que falta', async () => {
    const { pliegue_triceps: _omitida, ...incompletas } = SERIES_JULIETA;
    void _omitida;
    mostrar({ inicial: { ...INICIAL_COMPLETA, series: incompletas } });
    await irARevision();
    expect(screen.getByText(/Revisión: 24 de 25 variables/)).toBeInTheDocument();
    expect(screen.getByText(/Faltan: Tríceps/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Guardar y generar informe' })).toBeDisabled();
  });

  it('"Editar" de un grupo vuelve a ese paso', async () => {
    mostrar({ inicial: INICIAL_COMPLETA });
    await irARevision();
    const filaPliegues = screen.getByText('Pliegues', { selector: 'span' }).closest('li')!;
    await userEvent.click(filaPliegues.querySelector('button')!);
    expect(screen.getByLabelText('Tríceps, serie 1')).toBeInTheDocument();
  });

  it('con las 25 completas se habilita y genera el informe', async () => {
    mostrar({ inicial: INICIAL_COMPLETA });
    await irARevision();
    expect(screen.getByText(/Revisión: 25 de 25 variables/)).toBeInTheDocument();
    const boton = screen.getByRole('button', { name: 'Guardar y generar informe' });
    expect(boton).toBeEnabled();

    await userEvent.click(boton);

    await waitFor(() => expect(push).toHaveBeenCalledWith('/antropometrias/medicion/m1'));
    expect(finalizarMedicion).toHaveBeenCalledWith(
      expect.objectContaining({
        medicionId: 'm1',
        origen: 'manual',
        pacienteId: 'p1',
        fechaMedicion: '2026-10-24',
        nivelActividad: 'moderada',
        deporte: 'voleibol',
        series: expect.objectContaining({ peso: [53.1, 53, null] }),
      }),
    );
  });

  it('si el servidor rechaza, muestra el error y no navega', async () => {
    finalizarMedicion.mockResolvedValue({ error: 'Este paciente ya tiene 12 mediciones.' });
    mostrar({ inicial: INICIAL_COMPLETA });
    await irARevision();
    await userEvent.click(screen.getByRole('button', { name: 'Guardar y generar informe' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('12 mediciones');
    expect(push).not.toHaveBeenCalled();
  });

  it('sin nivel de actividad no se puede generar', async () => {
    mostrar({ inicial: { ...INICIAL_COMPLETA, nivelActividad: null } });
    await irARevision();
    expect(screen.getByRole('button', { name: 'Guardar y generar informe' })).toBeDisabled();
    expect(screen.getByText(/completá en "Datos básicos"/)).toBeInTheDocument();
  });

  it('al editar una medición ya generada el botón dice "Guardar cambios" y no hay autoguardado', async () => {
    mostrar({ inicial: { ...INICIAL_COMPLETA, estado: 'vigente' } });
    expect(screen.getByText(/Estás editando una medición ya generada/)).toBeInTheDocument();
    await irARevision();
    expect(screen.getByRole('button', { name: 'Guardar cambios' })).toBeEnabled();
    expect(guardarBorrador).not.toHaveBeenCalled();
  });
});

describe('MedicionWizard — deportista sin datos', () => {
  it('pide el sexo y la fecha de nacimiento, y el deporte espera al sexo', async () => {
    mostrar({ paciente: { ...PACIENTE, origen: 'deportista', sexo: null, fechaNacimiento: null } });
    expect(screen.getByLabelText('Sexo')).toBeInTheDocument();
    expect(screen.getByLabelText('Fecha de nacimiento')).toBeInTheDocument();
    expect(screen.getByLabelText(/Deporte/)).toBeDisabled();
    await userEvent.selectOptions(screen.getByLabelText('Sexo'), 'F');
    expect(screen.getByLabelText(/Deporte/)).toBeEnabled();
  });

  it('un deportista con datos completos no ve esos campos', () => {
    mostrar({ paciente: { ...PACIENTE, origen: 'deportista' } });
    expect(screen.queryByLabelText('Sexo')).not.toBeInTheDocument();
  });
});

describe('MedicionWizard — autoguardado', () => {
  it('guarda un borrador solo, después de escribir (con debounce)', async () => {
    mostrar();
    expect(guardarBorrador).not.toHaveBeenCalled();
    await userEvent.type(screen.getByLabelText('Peso bruto, serie 1'), '53');

    await waitFor(() => expect(guardarBorrador).toHaveBeenCalledTimes(1), { timeout: 4000 });
    expect(guardarBorrador).toHaveBeenCalledWith(
      expect.objectContaining({ medicionId: null, origen: 'manual', series: { peso: [53, null, null] } }),
    );
    expect(await screen.findByText('Borrador guardado')).toBeInTheDocument();
  });

  it('las siguientes grabaciones reutilizan el id del borrador creado', async () => {
    mostrar();
    await userEvent.type(screen.getByLabelText('Peso bruto, serie 1'), '53');
    await waitFor(() => expect(guardarBorrador).toHaveBeenCalledTimes(1), { timeout: 4000 });
    await screen.findByText('Borrador guardado');

    await userEvent.type(screen.getByLabelText('Peso bruto, serie 2'), '54');
    await waitFor(() => expect(guardarBorrador).toHaveBeenCalledTimes(2), { timeout: 4000 });
    expect(guardarBorrador).toHaveBeenLastCalledWith(expect.objectContaining({ medicionId: 'nuevo-1' }));
  });
});
