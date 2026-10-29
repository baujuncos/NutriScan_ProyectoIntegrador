// E2E del flujo principal de la app DESPLEGADA con todas las integraciones reales:
//   login (Supabase Auth) → POST /api/chat/meal (Next → Gemini + catálogo SARA2 en Supabase)
//   → POST /api/chat/meal/confirm (Next → RPC transaccional en Supabase) → lectura del diario → limpieza.
// Usa el usuario de PRUEBA (E2E_USER_EMAIL / E2E_USER_PASSWORD) y borra lo que crea.
// Se saltea si faltan las credenciales. Consume 1 llamada de Gemini.
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { appHeaders, env, loginUsuarioDePrueba, rest, tieneUsuarioDePrueba } from './env';

const hoy = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' }).format(new Date());

describe.skipIf(!tieneUsuarioDePrueba)('Flujo E2E: registrar una comida con el chat de IA', () => {
  let token = '';
  let respuestaChat: {
    status: string;
    detectedIngredients: Array<Record<string, unknown>>;
    totalMacros: { kcal: number };
  };
  const requestId = randomUUID();

  beforeAll(async () => {
    ({ accessToken: token } = await loginUsuarioDePrueba());
  });

  afterAll(async () => {
    if (!token) return;
    // Limpieza: se borra la ingesta de "merienda" de hoy del usuario de prueba (los ítems caen en cascada
    // o se borran primero). Solo con el token del propio usuario → RLS impide tocar datos ajenos.
    const ingestas = await rest(`ingestas?select=id_ingesta&fecha=eq.${hoy}&tipo=eq.colacion`, { token });
    for (const { id_ingesta } of (ingestas.data as Array<{ id_ingesta: number }>) ?? []) {
      await rest(`items?id_ingesta=eq.${id_ingesta}`, { token, method: 'DELETE' });
      await rest(`ingestas?id_ingesta=eq.${id_ingesta}`, { token, method: 'DELETE' });
    }
  });

  it('1. sin token la API rechaza (401)', async () => {
    const res = await fetch(`${env.baseUrl}/api/chat/meal`, {
      method: 'POST',
      headers: appHeaders({ 'content-type': 'application/json' }),
      body: JSON.stringify({ messages: [{ role: 'user', content: 'una manzana' }] }),
    });
    expect(res.status).toBe(401);
  });

  it('2. con token, Gemini + SARA2 interpretan "una manzana de 150 g" (200)', async () => {
    const res = await fetch(`${env.baseUrl}/api/chat/meal`, {
      method: 'POST',
      headers: appHeaders({ 'content-type': 'application/json', authorization: `Bearer ${token}` }),
      body: JSON.stringify({ messages: [{ role: 'user', content: 'Comí una manzana de 150 g' }] }),
    });
    expect(res.status, await res.clone().text()).toBe(200);
    respuestaChat = await res.json();
    expect(['complete', 'needs_clarification']).toContain(respuestaChat.status);
    const manzana = respuestaChat.detectedIngredients.find((i) => String(i.ingredient).toLowerCase().includes('manzana'));
    expect(manzana, 'Gemini no detectó la manzana').toBeDefined();
    // Una manzana de 150 g tiene ~50–120 kcal: la cifra viene del catálogo o de la estimación acotada.
    expect(respuestaChat.totalMacros.kcal).toBeGreaterThan(40);
    expect(respuestaChat.totalMacros.kcal).toBeLessThan(150);
  });

  it('3. confirmar guarda en el diario real (200) y es idempotente con el mismo requestId', async () => {
    const manzana = respuestaChat.detectedIngredients.find((i) => String(i.ingredient).toLowerCase().includes('manzana'))!;
    const sara2 = manzana.sara2Match as { id_alimento: number } | null;
    const gramos = Number(manzana.estimatedWeightGrams);
    const item = {
      ingrediente: String(manzana.ingredient),
      tipo: manzana.type,
      unidad: manzana.unit,
      origin: 'ai',
      macroSource: manzana.macroSource,
      idAlimento: sara2?.id_alimento ?? null,
      confidence: manzana.confidence,
      gramosIa: gramos,
      macrosIa: { kcal: manzana.kcal, proteinas_g: manzana.proteinas_g, carbs_g: manzana.carbs_g, grasas_g: manzana.grasas_g },
      gramosFinal: gramos,
    };
    const confirmar = () =>
      fetch(`${env.baseUrl}/api/chat/meal/confirm`, {
        method: 'POST',
        headers: appHeaders({ 'content-type': 'application/json', authorization: `Bearer ${token}` }),
        body: JSON.stringify({ requestId, fecha: hoy, tipoIngesta: 'colacion', items: [item] }),
      });

    const primera = await confirmar();
    expect(primera.status, await primera.clone().text()).toBe(200);
    expect((await primera.json()).ok).toBe(true);

    const segunda = await confirmar();
    expect(segunda.status).toBe(200);
    expect((await segunda.json()).yaGuardado).toBe(true);
  });

  it('4. el ítem aparece en el diario del usuario (lectura directa a Supabase con RLS)', async () => {
    const r = await rest(`ingestas?select=id_ingesta,items(id_item,cantidad)&fecha=eq.${hoy}&tipo=eq.colacion`, { token });
    expect(r.status).toBe(200);
    const filas = r.data as Array<{ items: Array<{ id_item: number }> }>;
    expect(filas.length).toBe(1);
    expect(filas[0].items.length).toBe(1); // idempotente: no se duplicó
  });
});
