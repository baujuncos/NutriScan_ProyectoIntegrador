/**
 * NUT-246/NUT-240 — Revisión del asistente: instrumentos (opcionales), investigador que midió y su error técnico.
 */
import { render, screen, waitFor, within } from '@testing-library/react';
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
import type { Instrumentos } from '@/lib/researcher/antropometria/instrumentos';
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

const SIN_INSTRUMENTOS: Instrumentos = { balanza: '', calibres: '', plicometro: '', cinta: '' };

const INICIAL_COMPLETA: InicialMedicion = {
  id: 'm1',
  estado: 'borrador',
  fechaMedicion: '2026-10-24',
  nivelActividad: 'moderada',
  deporte: 'voleibol',
  series: SERIES_JULIETA,
  medidoPor: 'inv-1',
  instrumentos: SIN_INSTRUMENTOS,
};

const INVESTIGADORES = [
  { id: 'inv-1', nombre: 'Lucía Ferreyra' },
  { id: 'inv-2', nombre: 'Martín Sosa' },
];
const MIS_INSTRUMENTOS: Instrumentos = { balanza: 'Tanita BC-601', calibres: '', plicometro: 'Harpenden', cinta: '' };
const ETM = { 'inv-1': { pliegues: 2.5, otras: 0.8, mediciones: 4 } };

function mostrar(props: Partial<React.ComponentProps<typeof MedicionWizard>> = {}) {
  return render(
    <MedicionWizard
      paciente={PACIENTE}
      otrasVigentes={[]}
      hoy="2026-10-30"
      inicial={null}
      investigadores={INVESTIGADORES}
      miId="inv-1"
      misInstrumentos={MIS_INSTRUMENTOS}
      etmPorInvestigador={ETM}
      {...props}
    />,
  );
}

const irARevision = () => userEvent.click(screen.getByRole('button', { name: /5\. Revisión/ }));
const guardarYGenerar = () => userEvent.click(screen.getByRole('button', { name: 'Guardar y generar informe' }));

beforeEach(() => {
  push.mockReset();
  guardarBorrador.mockReset().mockResolvedValue({ ok: true, id: 'nuevo-1' });
  finalizarMedicion.mockReset().mockResolvedValue({ ok: true, id: 'm1' });
});

describe('instrumentos y responsable', () => {
  it('en una medición nueva precarga "Mis instrumentos" y elige al usuario como quien midió', async () => {
    mostrar({ inicial: null });
    await irARevision();

    expect(screen.getByRole('heading', { name: 'Instrumentos y responsable' })).toBeInTheDocument();
    expect(screen.getByText('Todo opcional: aparece al pie del informe.')).toBeInTheDocument();
    expect(screen.getByLabelText('Balanza')).toHaveValue('Tanita BC-601');
    expect(screen.getByLabelText('Calibres y segmómetro')).toHaveValue('');
    expect(screen.getByLabelText('Plicómetro')).toHaveValue('Harpenden');
    expect(screen.getByLabelText('Cinta antropométrica')).toHaveValue('');
    expect(screen.getByLabelText('Balanza')).toHaveAttribute('placeholder', 'Modelo o marca');
    expect(screen.getByLabelText('Investigador que midió')).toHaveValue('inv-1');
    expect(within(screen.getByLabelText('Investigador que midió')).getAllByRole('option').map((o) => o.textContent)).toEqual([
      'Lucía Ferreyra',
      'Martín Sosa',
    ]);
  });

  it('una medición ya guardada muestra lo que se guardó (no vuelve a precargar) y su responsable', async () => {
    mostrar({
      inicial: { ...INICIAL_COMPLETA, medidoPor: 'inv-2', instrumentos: { ...SIN_INSTRUMENTOS, balanza: 'Seca 877' } },
    });
    await irARevision();
    expect(screen.getByLabelText('Balanza')).toHaveValue('Seca 877');
    expect(screen.getByLabelText('Plicómetro')).toHaveValue('');
    expect(screen.getByLabelText('Investigador que midió')).toHaveValue('inv-2');
  });

  it('cada campo admite hasta 120 caracteres', async () => {
    mostrar({ inicial: INICIAL_COMPLETA });
    await irARevision();
    expect(screen.getByLabelText('Balanza')).toHaveAttribute('maxlength', '120');
  });
});

describe('error técnico de medición del investigador elegido', () => {
  it('muestra %ETM de pliegues y de las otras variables, solo lectura, con link a la tabla completa', async () => {
    mostrar({ inicial: INICIAL_COMPLETA });
    await irARevision();

    const bloque = screen.getByRole('group', { name: /Error técnico de medición de Lucía Ferreyra/ });
    expect(within(bloque).getByText('2,50 %')).toBeInTheDocument();
    expect(within(bloque).getByText('0,80 %')).toBeInTheDocument();
    expect(within(bloque).getByText(/Basado en 4 mediciones/)).toBeInTheDocument();
    expect(within(bloque).getByRole('link', { name: /Ver tabla completa/ })).toHaveAttribute(
      'href',
      '/antropometrias/configuracion?investigador=inv-1',
    );
    expect(within(bloque).queryByRole('textbox')).not.toBeInTheDocument();
  });

  it('cambia con el investigador elegido; sin mediciones vigentes lo explica en vez de mostrar números', async () => {
    mostrar({ inicial: INICIAL_COMPLETA });
    await irARevision();
    await userEvent.selectOptions(screen.getByLabelText('Investigador que midió'), 'inv-2');

    expect(screen.getByText('Todavía no hay mediciones vigentes de este investigador para calcularlo.')).toBeInTheDocument();
    expect(screen.queryByText(/% ETM pliegues/)).not.toBeInTheDocument();
  });

  it('con una sola medición lo dice en singular', async () => {
    mostrar({ inicial: INICIAL_COMPLETA, etmPorInvestigador: { 'inv-1': { pliegues: 1, otras: 0.5, mediciones: 1 } } });
    await irARevision();
    expect(screen.getByText(/Basado en 1 medición\./)).toBeInTheDocument();
  });
});

describe('guardado', () => {
  it('los instrumentos vacíos NO bloquean: se guarda igual y viajan vacíos', async () => {
    mostrar({ inicial: INICIAL_COMPLETA });
    await irARevision();
    expect(screen.getByRole('button', { name: 'Guardar y generar informe' })).toBeEnabled();

    await guardarYGenerar();

    await waitFor(() => expect(push).toHaveBeenCalledWith('/antropometrias/medicion/m1'));
    expect(finalizarMedicion).toHaveBeenCalledWith(expect.objectContaining({ medidoPor: 'inv-1', instrumentos: SIN_INSTRUMENTOS }));
  });

  it('sin investigadores en la lista igual se puede guardar (el campo es opcional)', async () => {
    mostrar({ inicial: INICIAL_COMPLETA, investigadores: [], etmPorInvestigador: {} });
    await irARevision();
    expect(screen.getByRole('button', { name: 'Guardar y generar informe' })).toBeEnabled();
  });

  it('se pueden editar o vaciar los instrumentos precargados y cambiar quién midió; viaja lo que se ve', async () => {
    mostrar({ inicial: { ...INICIAL_COMPLETA, instrumentos: MIS_INSTRUMENTOS } });
    await irARevision();

    await userEvent.clear(screen.getByLabelText('Balanza'));
    await userEvent.type(screen.getByLabelText('Cinta antropométrica'), 'Lufkin');
    await userEvent.selectOptions(screen.getByLabelText('Investigador que midió'), 'inv-2');
    await guardarYGenerar();

    await waitFor(() => expect(finalizarMedicion).toHaveBeenCalled());
    expect(finalizarMedicion).toHaveBeenCalledWith(
      expect.objectContaining({
        medidoPor: 'inv-2',
        instrumentos: { balanza: '', calibres: '', plicometro: 'Harpenden', cinta: 'Lufkin' },
      }),
    );
  });

  it('se autoguardan con el borrador', async () => {
    mostrar({ inicial: INICIAL_COMPLETA });
    await irARevision();
    await userEvent.type(screen.getByLabelText('Plicómetro'), 'Slim Guide');

    await waitFor(() => expect(guardarBorrador).toHaveBeenCalled(), { timeout: 4000 });
    expect(guardarBorrador).toHaveBeenLastCalledWith(
      expect.objectContaining({ medidoPor: 'inv-1', instrumentos: expect.objectContaining({ plicometro: 'Slim Guide' }) }),
    );
  });

  it('cambiar quién midió también dispara el autoguardado', async () => {
    mostrar({ inicial: INICIAL_COMPLETA });
    await irARevision();
    await userEvent.selectOptions(screen.getByLabelText('Investigador que midió'), 'inv-2');

    await waitFor(() => expect(guardarBorrador).toHaveBeenCalled(), { timeout: 4000 });
    expect(guardarBorrador).toHaveBeenLastCalledWith(expect.objectContaining({ medidoPor: 'inv-2' }));
  });
});
