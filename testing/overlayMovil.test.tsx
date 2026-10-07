/**
 * iOS: al abrirse el teclado Safari desplaza la página y un elemento fixed en la
 * parte de arriba (la barra de búsqueda) queda fuera de la zona visible. Se
 * resuelve bloqueando el scroll del fondo y ajustando el overlay al área
 * realmente visible (`visualViewport`).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useBodyScrollLock, useEsMobile, useVisualViewportBox } from '@/lib/overlayMovil';

class FakeVisualViewport extends EventTarget {
  constructor(public height: number, public offsetTop: number) {
    super();
  }
}

function setVisualViewport(vv: FakeVisualViewport | undefined) {
  Object.defineProperty(window, 'visualViewport', { value: vv, configurable: true });
}

afterEach(() => {
  setVisualViewport(undefined);
  document.body.removeAttribute('style');
  vi.restoreAllMocks();
});

describe('useVisualViewportBox', () => {
  it('inactivo → null (no escucha nada)', () => {
    const vv = new FakeVisualViewport(500, 0);
    setVisualViewport(vv);
    const { result } = renderHook(() => useVisualViewportBox(false));
    expect(result.current).toBeNull();
  });

  it('sin API visualViewport → null (navegadores viejos / jsdom)', () => {
    setVisualViewport(undefined);
    const { result } = renderHook(() => useVisualViewportBox(true));
    expect(result.current).toBeNull();
  });

  it('activo → devuelve el alto y el offset del área visible y los actualiza al abrirse el teclado o al desplazarse', () => {
    const vv = new FakeVisualViewport(800, 0);
    setVisualViewport(vv);
    const { result } = renderHook(() => useVisualViewportBox(true));
    expect(result.current).toEqual({ top: 0, height: 800 });

    act(() => {
      vv.height = 480; // se abrió el teclado
      vv.dispatchEvent(new Event('resize'));
    });
    expect(result.current).toEqual({ top: 0, height: 480 });

    act(() => {
      vv.offsetTop = 120; // iOS desplazó el viewport visual
      vv.dispatchEvent(new Event('scroll'));
    });
    expect(result.current).toEqual({ top: 120, height: 480 });
  });

  it('al desactivarse deja de escuchar y vuelve a null', () => {
    const vv = new FakeVisualViewport(800, 0);
    setVisualViewport(vv);
    const remove = vi.spyOn(vv, 'removeEventListener');
    const { result, rerender } = renderHook(({ on }) => useVisualViewportBox(on), { initialProps: { on: true } });
    expect(result.current).not.toBeNull();
    rerender({ on: false });
    expect(result.current).toBeNull();
    expect(remove).toHaveBeenCalledWith('resize', expect.any(Function));
    expect(remove).toHaveBeenCalledWith('scroll', expect.any(Function));
  });
});

describe('useBodyScrollLock', () => {
  it('fija el body (único modo que bloquea el touch-scroll en iOS) y lo restaura al soltar', () => {
    const scrollTo = vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
    document.body.style.position = 'relative';
    const { rerender, unmount } = renderHook(({ on }) => useBodyScrollLock(on), { initialProps: { on: false } });
    expect(document.body.style.position).toBe('relative');

    rerender({ on: true });
    expect(document.body.style.position).toBe('fixed');
    expect(document.body.style.width).toBe('100%');
    expect(document.body.style.overflow).toBe('hidden');

    rerender({ on: false });
    expect(document.body.style.position).toBe('relative');
    expect(document.body.style.overflow).toBe('');
    expect(scrollTo).toHaveBeenCalled(); // vuelve a la posición de scroll previa

    rerender({ on: true });
    unmount(); // también se restaura al desmontar
    expect(document.body.style.position).toBe('relative');
  });
});

describe('useEsMobile', () => {
  it('sin matchMedia → false', () => {
    const original = window.matchMedia;
    // @ts-expect-error simulamos un entorno sin matchMedia
    window.matchMedia = undefined;
    const { result } = renderHook(() => useEsMobile());
    expect(result.current).toBe(false);
    window.matchMedia = original;
  });

  it('refleja la media query y reacciona a los cambios', () => {
    let cambiar: (m: boolean) => void = () => {};
    window.matchMedia = vi.fn().mockImplementation(() => {
      const target = new EventTarget() as EventTarget & { matches: boolean };
      target.matches = true;
      cambiar = (m) => {
        target.matches = m;
        target.dispatchEvent(new Event('change'));
      };
      return target;
    }) as unknown as typeof window.matchMedia;

    const { result } = renderHook(() => useEsMobile());
    expect(result.current).toBe(true);
    act(() => cambiar(false));
    expect(result.current).toBe(false);
  });
});
