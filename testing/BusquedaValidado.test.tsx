import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import AlimentacionClient from '@/app/alimentacion/AlimentacionClient';
import type { AlimentoOption } from '@/app/alimentacion/actions';
import { searchAlimentosAction, getAlimentosRecientesAction } from '@/app/alimentacion/actions';

vi.mock('@/lib/date', () => ({ todayAR: () => '2026-10-20', daysAgoAR: () => '2026-10-13' }));
vi.mock('@/app/alimentacion/actions', () => ({
  searchAlimentosAction: vi.fn().mockResolvedValue([]),
  getAlimentosRecientesAction: vi.fn().mockResolvedValue([]),
  addItemAction: vi.fn(),
  addManualItemAction: vi.fn(),
  deleteItemAction: vi.fn(),
  updateItemAction: vi.fn(),
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));
vi.mock('@/app/alimentacion/AIRecognitionModal', () => ({ default: () => null }));
vi.mock('@/app/alimentacion/ChatFoodModal', () => ({ default: () => null }));
vi.mock('@/app/alimentacion/BarcodeScannerModal', () => ({ default: () => null }));

const base = { categoria: null, marca: null, denominacion: null };
const SARA2: AlimentoOption = { ...base, id_alimento: 1, nombre: 'Arroz blanco', fuente: 'SARA2' };
const ANMAT: AlimentoOption = { ...base, id_alimento: 1_000_001, nombre: 'Arroz con leche', fuente: 'ANMAT' };
const VALIDADO: AlimentoOption = { ...base, id_alimento: 2_000_001, nombre: 'Arroz casero', fuente: 'VALIDADO' };

const porNombre = (nombre: string) => (_: string, el: Element | null) => el?.textContent === nombre;

async function buscar(resultados: AlimentoOption[], hideNutrition = false) {
  vi.mocked(searchAlimentosAction).mockResolvedValue(resultados);
  const user = userEvent.setup();
  render(<AlimentacionClient ingesta={null} tipoIngesta="almuerzo" fecha="2026-10-20" hideNutrition={hideNutrition} />);
  await user.type(screen.getByRole('textbox'), 'arroz');
  await screen.findByText(porNombre(resultados[0].nombre), {}, { timeout: 1500 });
  return user;
}

describe('Buscador: alimentos VALIDADO (NUT-194)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getAlimentosRecientesAction).mockResolvedValue([]);
  });

  it('muestra el badge "VALIDADO" con su propio estilo (ni el azul de SARA2 ni el verde de ANMAT)', async () => {
    await buscar([VALIDADO]);
    const badge = screen.getByText('VALIDADO');
    expect(badge.className).toContain('bg-[#FEF3C7]');
    expect(badge.className).not.toContain('bg-[#EFF6FF]');
    expect(badge.className).not.toContain('bg-[#ECFDF3]');
  });

  it('el campo de búsqueda ya no dice que busca solo en SARA2 y ANMAT', async () => {
    render(<AlimentacionClient ingesta={null} tipoIngesta="almuerzo" fecha="2026-10-20" hideNutrition={false} />);
    await act(async () => {}); // deja terminar la carga de recientes (evita el aviso de act)
    expect(screen.getByPlaceholderText(/SARA2, ANMAT y validados/)).toBeInTheDocument();
  });

  it('el alimento VALIDADO elegido muestra su etiqueta en ámbar (no el azul de SARA2); SARA2 y ANMAT, como antes', async () => {
    for (const [a, clase] of [[VALIDADO, 'bg-amber-50'], [SARA2, 'bg-blue-50'], [ANMAT, 'bg-green-50']] as const) {
      const user = await buscar([a]);
      await user.click(screen.getByText(porNombre(a.nombre)));
      const etiquetas = screen.getAllByText(a.fuente).filter((el) => el.className.includes('inline-block'));
      expect(etiquetas).toHaveLength(1);
      expect(etiquetas[0].className).toContain(clase);
      document.body.innerHTML = '';
    }
  });

  it('los badges de SARA2 y ANMAT no cambian', async () => {
    await buscar([SARA2, ANMAT]);
    expect(screen.getByText('SARA2').className).toContain('bg-[#EFF6FF]');
    expect(screen.getByText('ANMAT').className).toContain('bg-[#ECFDF3]');
  });

  it('aparece el chip "Validados (n)" y filtra solo los validados', async () => {
    const user = await buscar([SARA2, VALIDADO, ANMAT]);
    const chip = screen.getByRole('button', { name: 'Validados (1)' });
    await user.click(chip);
    expect(screen.getByText(porNombre('Arroz casero'))).toBeInTheDocument();
    expect(screen.queryByText(porNombre('Arroz blanco'))).not.toBeInTheDocument();
    expect(screen.queryByText(porNombre('Arroz con leche'))).not.toBeInTheDocument();
  });

  it('sin alimentos validados en los resultados no aparece el chip (la barra queda como antes)', async () => {
    await buscar([SARA2, ANMAT]);
    expect(screen.queryByRole('button', { name: /Validados/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Todas (2)' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'SARA2 (1)' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'ANMAT (1)' })).toBeInTheDocument();
  });

  it('un deportista elige un VALIDADO (sin macros en el payload) y el selector de cantidad sigue funcionando, sin vista previa', async () => {
    const user = await buscar([VALIDADO], true);
    await user.click(screen.getByText(porNombre('Arroz casero')));
    // El selector de cantidad está: botones rápidos, stepper y botón de agregar.
    expect(screen.getByRole('button', { name: 'Sumar 10 gramos' })).toBeInTheDocument();
    // Sin kcal100 no hay vista previa nutricional ni aviso de "sin datos".
    expect(screen.queryByText('kcal')).not.toBeInTheDocument();
    expect(screen.queryByText(/sin datos nutricionales|no tiene valores/i)).not.toBeInTheDocument();
    // Puede cargar la cantidad y agregarlo: el cálculo del ítem lo hace el trigger en el servidor.
    await user.click(screen.getByRole('button', { name: '100 g' }));
    await user.click(screen.getByRole('button', { name: 'Sumar 10 gramos' }));
    expect(screen.getByText('110 g')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Agregar a/ })).toBeEnabled();
  });

  it('un particular que elige un VALIDADO con macros ve la vista previa de kcal', async () => {
    const conMacros: AlimentoOption = { ...VALIDADO, kcal_100g: 200, proteinas_100g: 8, grasas_100g: 6, carbs_100g: 28 };
    const user = await buscar([conMacros], false);
    await user.click(screen.getByText(porNombre('Arroz casero')));
    expect(screen.getByText('kcal')).toBeInTheDocument();
  });
});
