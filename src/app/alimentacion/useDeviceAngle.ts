'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { evaluarAngulo, type LecturaAngulo } from '@/lib/anguloDispositivo';

/**
 * NUT-163 / NUT-164 — Lectura en vivo de la inclinación del celular vía
 * `DeviceOrientationEvent`, con manejo de permisos y degradación segura.
 *
 * Compatibilidad (pendiente de QA en dispositivo real):
 *  - iOS Safari 13+: `DeviceOrientationEvent.requestPermission()` — requiere
 *    contexto seguro (HTTPS / localhost) y un gesto explícito del usuario.
 *  - Android Chrome / Firefox: listener directo `deviceorientation`, sin permiso,
 *    también sobre contexto seguro.
 *  - Desktop / sin giroscopio: la API puede existir pero no emitir eventos →
 *    se detecta por timeout y se degrada a `'sin-datos'`.
 *
 * En cualquier caso que no sea `android` / `ios-concedido`, `lectura.estado` es
 * `'desconocido'` y `dentroDeRango` es `true`: la captura de foto nunca se bloquea.
 */

export type SoporteAngulo =
  | 'android'
  | 'ios-permiso'
  | 'ios-concedido'
  | 'denegado'
  | 'no-soportado'
  | 'sin-datos';

type DOEConPermiso = {
  requestPermission?: () => Promise<'granted' | 'denied'>;
};

const LECTURA_DESCONOCIDA: LecturaAngulo = evaluarAngulo(null);
const THROTTLE_MS = 150;
const TIMEOUT_SIN_DATOS_MS = 2500;

function detectarSoporte(): SoporteAngulo {
  if (typeof window === 'undefined' || typeof window.DeviceOrientationEvent === 'undefined') {
    return 'no-soportado';
  }
  const DOE = window.DeviceOrientationEvent as unknown as DOEConPermiso;
  return typeof DOE.requestPermission === 'function' ? 'ios-permiso' : 'android';
}

export function useDeviceAngle(activo: boolean): {
  lectura: LecturaAngulo;
  soporte: SoporteAngulo;
  solicitarPermiso: () => void;
} {
  const [lectura, setLectura] = useState<LecturaAngulo>(LECTURA_DESCONOCIDA);
  const [soporte, setSoporte] = useState<SoporteAngulo>(detectarSoporte);
  const ultimoUpdateRef = useRef(0);
  const recibioDatoRef = useRef(false);
  const listeningRef = useRef(false);
  const timeoutRef = useRef<number | null>(null);

  const onOrientation = useCallback((e: DeviceOrientationEvent) => {
    if (e.beta == null || Number.isNaN(e.beta)) return;
    recibioDatoRef.current = true;
    const now = Date.now();
    if (now - ultimoUpdateRef.current < THROTTLE_MS) return;
    ultimoUpdateRef.current = now;
    setLectura(evaluarAngulo(e.beta));
  }, []);

  const startListening = useCallback(() => {
    if (listeningRef.current) return;
    listeningRef.current = true;
    window.addEventListener('deviceorientation', onOrientation);
  }, [onOrientation]);

  const stopListening = useCallback(() => {
    listeningRef.current = false;
    window.removeEventListener('deviceorientation', onOrientation);
  }, [onOrientation]);

  const armarTimeoutSinDatos = useCallback(() => {
    if (timeoutRef.current) window.clearTimeout(timeoutRef.current);
    timeoutRef.current = window.setTimeout(() => {
      if (!recibioDatoRef.current) {
        setSoporte((s) => (s === 'android' || s === 'ios-concedido' ? 'sin-datos' : s));
      }
    }, TIMEOUT_SIN_DATOS_MS);
  }, []);

  const solicitarPermiso = useCallback(() => {
    const DOE = (typeof window !== 'undefined' ? window.DeviceOrientationEvent : undefined) as
      | DOEConPermiso
      | undefined;
    if (!DOE || typeof DOE.requestPermission !== 'function') return;
    DOE.requestPermission()
      .then((res) => setSoporte(res === 'granted' ? 'ios-concedido' : 'denegado'))
      .catch(() => setSoporte('denegado'));
  }, []);

  useEffect(() => {
    if (!activo) return;

    // `soporte` sale del lazy init (`detectarSoporte`) o de `solicitarPermiso`.
    // El listener se engancha acá para Android y para iOS ya concedido; en iOS
    // pendiente de permiso, este effect vuelve a correr al cambiar `soporte`.
    recibioDatoRef.current = false;
    if (soporte === 'android' || soporte === 'ios-concedido') {
      startListening();
      armarTimeoutSinDatos();
    }

    return () => {
      if (timeoutRef.current) window.clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
      stopListening();
      setLectura(LECTURA_DESCONOCIDA);
    };
  }, [activo, soporte, startListening, stopListening, armarTimeoutSinDatos]);

  return { lectura, soporte, solicitarPermiso };
}
