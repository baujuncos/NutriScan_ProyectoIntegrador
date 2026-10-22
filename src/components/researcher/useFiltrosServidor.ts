'use client';

/**
 * Conecta un `FilterBar` con pantallas que filtran en el servidor (Validación,
 * Revisión de IA): cada cambio reescribe la querystring con `router.replace`, así
 * la URL con los filtros puestos se puede compartir o recargar. Siempre vuelve a la
 * página 1. Va dentro de una transición: la lista vieja queda en pantalla (sin
 * parpadeo) hasta que llega la nueva, `pending` dice si hay una en curso, y si se
 * cambian filtros rápido gana la última navegación.
 */
import { useRouter } from 'next/navigation';
import { useTransition } from 'react';

interface Opciones<P> {
  /** Ruta sin querystring, ej. '/validacion'. */
  path: string;
  /** Filtros actuales (ya normalizados desde la URL). */
  params: P;
  /** Filtros de por defecto (a donde lleva "Limpiar"). */
  defaults: P;
  /** Arma la querystring (con `?`, o vacía) aplicando los cambios sobre `params`. */
  build: (params: P, overrides: Partial<P>) => string;
}

export function useFiltrosServidor<P extends { page: number }>({ path, params, defaults, build }: Opciones<P>) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const ir = (query: string) => startTransition(() => router.replace(`${path}${query}`, { scroll: false }));

  return {
    pending,
    onChange: (id: string, value: string) => ir(build(params, { [id]: value, page: 1 } as unknown as Partial<P>)),
    onClear: () => ir(build(defaults, {})),
  };
}
