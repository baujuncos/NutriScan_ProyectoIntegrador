import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import AlimentacionView from '@/app/alimentacion/AlimentacionView';
import { shouldHideNutritionInfo } from '@/lib/roles';
import { ocultarMacros } from '@/lib/ocultarMacros';

vi.mock('@/lib/date', () => ({
  todayAR: () => '2026-10-20',
  daysAgoAR: () => '2026-10-13',
  estaEnRangoEditable: () => true,
}));
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

const catalogo = {
  id_item: 1, id_alimento: 10, nombre_manual: null, tipo_item: 'solido', cantidad: 100,
  kcal: 130, proteinas_g: 2.7, grasas_g: 0.3, carbs_g: 28, alimentos: { nombre: 'Arroz blanco', categoria: null },
};
const manual = (origen: string | null, nombre = 'Tarta casera') => ({
  id_item: 2, id_alimento: null, nombre_manual: nombre, tipo_item: 'solido', cantidad: 150,
  kcal: 0, proteinas_g: 0, grasas_g: 0, carbs_g: 0, alimentos: null, origen_macros: origen,
});

function ingesta(items: unknown[], kcalTotal = 130) {
  return {
    id_ingesta: 1, tipo: 'almuerzo' as const, fecha: '2026-10-20',
    kcal_total: kcalTotal, proteinas_total_g: 2.7, grasas_total_g: 0.3, carbs_total_g: 28,
    items: items as never,
  };
}

function montar(items: unknown[], hideNutrition = false) {
  return render(
    <AlimentacionView ingestas={[ingesta(items)]} fecha="2026-10-20" initialTipo="almuerzo" hideNutrition={hideNutrition} />,
  );
}

describe('"no disponible" en ítems manuales pendientes o descartados (NUT-192)', () => {
  it('un ítem manual pendiente muestra "no disponibles" en vez de 0 kcal / P 0 / C 0 / G 0', () => {
    montar([catalogo, manual('pendiente')]);

    expect(screen.getByText('Tarta casera')).toBeInTheDocument();
    expect(screen.getByText('Calorías y macros no disponibles')).toBeInTheDocument();
    // El 0 almacenado no se muestra como dato: solo queda la fila del arroz con sus valores.
    expect(screen.queryAllByText(/^0 kcal$/)).toHaveLength(0);
    expect(screen.getAllByText('130 kcal').length).toBeGreaterThan(0);
  });

  it('un ítem descartado también figura como no disponible (nunca 0)', () => {
    montar([manual('descartado')]);
    expect(screen.getByText('Calorías y macros no disponibles')).toBeInTheDocument();
  });

  it('el banner aclara que el total no incluye los ítems sin datos', () => {
    montar([catalogo, manual('pendiente')]);
    expect(screen.getByText(/No incluye 1 ítem con kcal no disponibles/)).toBeInTheDocument();
    expect(screen.getByText(/No incluye 1 ítem con macros no disponibles/)).toBeInTheDocument();
  });

  it('plural cuando son varios', () => {
    montar([manual('pendiente', 'A'), { ...manual('descartado', 'B'), id_item: 3 }]);
    expect(screen.getByText(/No incluye 2 ítems con kcal no disponibles/)).toBeInTheDocument();
  });

  it('un ítem manual ya validado muestra sus valores como cualquier otro', () => {
    montar([{ ...manual('validado'), kcal: 320, proteinas_g: 9, grasas_g: 12, carbs_g: 40 }], false);
    expect(screen.queryByText('Calorías y macros no disponibles')).not.toBeInTheDocument();
    expect(screen.getAllByText('320 kcal').length).toBeGreaterThan(0);
  });

  it('un ítem manual legado (origen_macros null) se ve exactamente como antes', () => {
    montar([manual(null)]);
    expect(screen.queryByText('Calorías y macros no disponibles')).not.toBeInTheDocument();
    expect(screen.getByText('0 kcal')).toBeInTheDocument();
  });

  it('sin ítems sin datos no aparece ningún aviso', () => {
    montar([catalogo]);
    expect(screen.queryByText(/no disponibles/)).not.toBeInTheDocument();
  });

  it('a un deportista (hideNutrition) no le aparece nada nutricional, tampoco el aviso', () => {
    montar([catalogo, manual('pendiente')], true);
    expect(screen.getByText('Tarta casera')).toBeInTheDocument();
    expect(screen.queryByText(/no disponibles/)).not.toBeInTheDocument();
    expect(screen.queryByText(/kcal/)).not.toBeInTheDocument();
  });

  describe('estudio a ciegas: deportista_ucc (NUT-192)', () => {
    // Mismo cálculo que alimentacion/page.tsx: hideNutrition sale del rol y los números se ocultan antes de serializar.
    function montarComo(role: string, items: unknown[]) {
      const hide = shouldHideNutritionInfo(role);
      const ingestas = ocultarMacros([ingesta(items, 130)], hide);
      return render(<AlimentacionView ingestas={ingestas} fecha="2026-10-20" initialTipo="almuerzo" hideNutrition={hide} />);
    }

    it('el rol deportista_ucc oculta el aviso, la leyenda del ítem y la nota del total (pendiente y descartado)', () => {
      montarComo('deportista_ucc', [catalogo, manual('pendiente'), { ...manual('descartado', 'Otra'), id_item: 3 }]);
      expect(screen.getByText('Tarta casera')).toBeInTheDocument();
      expect(screen.queryByText(/no disponibles/)).not.toBeInTheDocument();
      expect(screen.queryByText(/No incluye/)).not.toBeInTheDocument();
      expect(screen.queryByText(/kcal/)).not.toBeInTheDocument();
    });

    it('el rol particular sí ve la leyenda, la nota del total y el aviso del banner', () => {
      montarComo('particular', [catalogo, manual('pendiente')]);
      expect(screen.getByText('Calorías y macros no disponibles')).toBeInTheDocument();
      expect(screen.getByText(/No incluye 1 ítem con macros no disponibles/)).toBeInTheDocument();
      expect(screen.getByText(/No incluye 1 ítem con kcal no disponibles/)).toBeInTheDocument();
    });

    it('un ítem VALIDADO no muestra números a un deportista', () => {
      montarComo('deportista_ucc', [{ ...manual('validado'), kcal: 320, proteinas_g: 9, grasas_g: 12, carbs_g: 40 }]);
      expect(screen.queryByText(/320/)).not.toBeInTheDocument();
      expect(screen.queryByText(/kcal/)).not.toBeInTheDocument();
    });
  });
});
