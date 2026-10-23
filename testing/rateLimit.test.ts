/**
 * checkRateLimit — ventana deslizante de 10 requests por 60 s por clave.
 * Valores límite: request 9, 10 (última permitida) y 11 (primera rechazada); borde de la ventana en 59 999 / 60 000 ms.
 */
import { describe, expect, it } from 'vitest';
import { RATE_LIMIT_MAX_REQUESTS, RATE_LIMIT_WINDOW_MS, checkRateLimit } from '@/lib/chat/rateLimit';

let seq = 0;
const nuevoUsuario = () => `rl-user-${++seq}`;

describe('checkRateLimit', () => {
  it('permite hasta el máximo y rechaza la siguiente', () => {
    // Arrange
    const u = nuevoUsuario();
    // Act
    const resultados = Array.from({ length: RATE_LIMIT_MAX_REQUESTS + 1 }, () => checkRateLimit(u, 1_000));
    // Assert
    expect(resultados.slice(0, RATE_LIMIT_MAX_REQUESTS).every(Boolean)).toBe(true);
    expect(resultados[RATE_LIMIT_MAX_REQUESTS]).toBe(false);
  });

  it('un rechazo no cuenta como intento: tras vencer la ventana vuelve a permitir', () => {
    const u = nuevoUsuario();
    for (let i = 0; i < RATE_LIMIT_MAX_REQUESTS; i++) checkRateLimit(u, 0);
    expect(checkRateLimit(u, 10)).toBe(false);
    expect(checkRateLimit(u, 20)).toBe(false);
    expect(checkRateLimit(u, RATE_LIMIT_WINDOW_MS)).toBe(true);
  });

  it('valor límite: a 59 999 ms de la primera request sigue bloqueado; a 60 000 ms ya no', () => {
    const u = nuevoUsuario();
    for (let i = 0; i < RATE_LIMIT_MAX_REQUESTS; i++) checkRateLimit(u, 0);
    expect(checkRateLimit(u, RATE_LIMIT_WINDOW_MS - 1)).toBe(false);
    expect(checkRateLimit(u, RATE_LIMIT_WINDOW_MS)).toBe(true);
  });

  it('la ventana es deslizante: las requests viejas liberan lugar de a una', () => {
    const u = nuevoUsuario();
    for (let i = 0; i < RATE_LIMIT_MAX_REQUESTS; i++) checkRateLimit(u, i * 1_000); // t = 0..9 s
    expect(checkRateLimit(u, 30_000)).toBe(false);
    expect(checkRateLimit(u, 60_000)).toBe(true); // venció la de t=0
    expect(checkRateLimit(u, 60_500)).toBe(false); // la de t=1 s todavía no
    expect(checkRateLimit(u, 61_000)).toBe(true);
  });

  it('cada clave tiene su propio contador', () => {
    const a = nuevoUsuario();
    const b = nuevoUsuario();
    for (let i = 0; i < RATE_LIMIT_MAX_REQUESTS; i++) checkRateLimit(a, 0);
    expect(checkRateLimit(a, 1)).toBe(false);
    expect(checkRateLimit(b, 1)).toBe(true);
  });

  it('limpia las claves vencidas cuando el mapa crece mucho (no crece sin tope)', () => {
    for (let i = 0; i < 5_001; i++) checkRateLimit(`bulk-${seq}-${i}`, 0);
    const reciente = nuevoUsuario();
    // La request llega mucho después: dispara la limpieza y sigue funcionando.
    expect(checkRateLimit(reciente, 10 * RATE_LIMIT_WINDOW_MS)).toBe(true);
    expect(checkRateLimit(`bulk-${seq}-0`, 10 * RATE_LIMIT_WINDOW_MS)).toBe(true);
  });
});
