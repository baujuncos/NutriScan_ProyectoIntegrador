import { describe, it, expect, beforeEach } from 'vitest';
import { guardarUltimaVajilla, leerUltimaVajilla } from '@/lib/vajillaPreferencia';

beforeEach(() => {
  window.localStorage.clear();
});

describe('vajillaPreferencia', () => {
  it('sin nada guardado, devuelve null', () => {
    expect(leerUltimaVajilla()).toBeNull();
  });

  it('guarda y relee tipo + diámetro', () => {
    guardarUltimaVajilla({ tipo: 'plato_hondo', diametroCm: 24 });
    expect(leerUltimaVajilla()).toEqual({ tipo: 'plato_hondo', diametroCm: 24 });
  });

  it('diametroCm null se preserva (caso "otro")', () => {
    guardarUltimaVajilla({ tipo: 'otro', diametroCm: null });
    expect(leerUltimaVajilla()).toEqual({ tipo: 'otro', diametroCm: null });
  });

  it('datos corruptos en localStorage no rompen, devuelven null', () => {
    window.localStorage.setItem('nutriscan:ultimaVajilla', '{not json');
    expect(leerUltimaVajilla()).toBeNull();

    window.localStorage.setItem('nutriscan:ultimaVajilla', JSON.stringify({ tipo: 'no_existe' }));
    expect(leerUltimaVajilla()).toBeNull();
  });
});
