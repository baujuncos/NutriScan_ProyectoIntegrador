// E2E contra Open Food Facts REAL (API pública de terceros que usa el escaneo de códigos de barras).
// Es un servicio externo sin SLA: el test reintenta una vez (config) y valida el CONTRATO que usa la app.
import { describe, expect, it } from 'vitest';
import { obtenerProductoPorEAN } from '@/lib/openFoodFacts';

describe('Open Food Facts real — contrato', () => {
  it('un producto conocido (Nutella 3017620422003) se encuentra con macros por 100 g', async () => {
    const p = await obtenerProductoPorEAN('3017620422003');
    expect(p.encontrado).toBe(true);
    if (!p.encontrado) return;
    expect(p.nombre.length).toBeGreaterThan(0);
    expect(p.nutrientes100g.kcal).toBeGreaterThan(400);
    expect(p.nutrientes100g.carbs).toBeGreaterThan(40);
    expect(p.porcion).toBeGreaterThan(0);
  });

  it('un EAN inexistente se informa como no encontrado (sin lanzar)', async () => {
    const p = await obtenerProductoPorEAN('0000000000000');
    expect(p).toEqual({ encontrado: false, ean: '0000000000000' });
  });
});
