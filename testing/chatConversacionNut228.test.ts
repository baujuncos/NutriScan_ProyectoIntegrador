// NUT-228 — La conversación del chat viaja con la confirmación solo cuando algún ítem entra a la
// cola de validación, con tope de tamaño (Zod + truncado seguro) y sin otros datos.
import { describe, expect, it } from 'vitest';
import { confirmRequestSchema, type ConfirmItem, type ConfirmRequest } from '@/lib/chat/confirmSchemas';
import {
  MAX_CONVERSATION_MESSAGES,
  MAX_CONVERSATION_MESSAGE_CHARS,
  MAX_CONVERSATION_TOTAL_CHARS,
  conversationSchema,
  sanitizeConversation,
} from '@/lib/chat/conversation';
import { buildConfirmPayload, isQueueable } from '@/lib/chat/confirmService';
import type { Per100 } from '@/lib/chat/sara2Catalog';
import type { FoodChatResult } from '@/lib/chatFood';
import { buildConfirmRequest } from '@/lib/chatFoodEdits';

const REQUEST_ID = '3f2b8c1e-7d4a-4e0b-9a55-0c1d2e3f4a5b';
const CONTEXT = { modelo: 'mock', promptVersion: 'mock', minDate: '2026-10-01', maxDate: '2026-10-08' };
const PER100: Map<number, Per100> = new Map([[375, { kcal: 92, proteinas: 1.2, grasas: 0.2, carbs: 20.4 }]]);

const empanada: ConfirmItem = {
  ingrediente: 'Empanada de carne', tipo: 'otro', unidad: 'g', origin: 'ai', macroSource: 'estimado_ia',
  idAlimento: null, confidence: 0.7, gramosIa: 240, gramosFinal: 240,
  macrosIa: { kcal: 600, proteinas_g: 25.2, carbs_g: 64.8, grasas_g: 26.4 },
};
const banana: ConfirmItem = {
  ingrediente: 'Banana', tipo: 'fruta', unidad: 'g', origin: 'ai', macroSource: 'sara2',
  idAlimento: 375, confidence: 0.9, gramosIa: 120, gramosFinal: 120,
  macrosIa: { kcal: 110.4, proteinas_g: 1.44, carbs_g: 24.48, grasas_g: 0.24 },
};
const agua: ConfirmItem = {
  ingrediente: 'Agua', tipo: 'bebida', unidad: 'ml', origin: 'ai', macroSource: 'estimado_ia',
  idAlimento: null, confidence: 0.9, gramosIa: 250, gramosFinal: 250,
  macrosIa: { kcal: 0, proteinas_g: 0, carbs_g: 0, grasas_g: 0 },
};
const manual: ConfirmItem = {
  ingrediente: 'Tarta casera', tipo: 'otro', unidad: 'g', origin: 'added_manually', macroSource: null,
  idAlimento: null, confidence: null, gramosIa: null, macrosIa: null, gramosFinal: 150,
};
const quitado: ConfirmItem = { ...empanada, ingrediente: 'Flan', origin: 'removed', gramosFinal: null };

const CONVERSACION = [
  { role: 'user' as const, content: 'Comí una empanada' },
  { role: 'assistant' as const, content: '¿De qué es?' },
  { role: 'user' as const, content: 'De carne' },
];

const request = (items: ConfirmItem[], extra: Partial<ConfirmRequest> = {}): ConfirmRequest => ({
  requestId: REQUEST_ID, fecha: '2026-10-08', tipoIngesta: 'almuerzo', items, ...extra,
});

describe('tipos de ítem del chat y cuáles entran a la cola (isQueueable)', () => {
  const payloadItem = (item: ConfirmItem) => buildConfirmPayload(request([item, banana]), PER100, CONTEXT).items[0];

  it('entra solo el estimado por la IA, sin catálogo, que va al diario y no fue quitado', () => {
    expect(isQueueable(payloadItem(empanada))).toBe(true);
    expect(isQueueable(payloadItem({ ...empanada, origin: 'edited', gramosFinal: 100 }))).toBe(true);
  });

  it('NO entran: match en SARA2, agua, agregados a mano ni quitados', () => {
    expect(isQueueable(payloadItem(banana))).toBe(false);
    expect(isQueueable(payloadItem(agua))).toBe(false);
    expect(isQueueable(payloadItem(manual))).toBe(false);
    expect(isQueueable(payloadItem(quitado))).toBe(false);
  });
});

describe('buildConfirmPayload — conversación', () => {
  it('sin conversación en el request, el payload no la trae (idéntico al anterior)', () => {
    const p = buildConfirmPayload(request([empanada]), PER100, CONTEXT);
    expect('conversacion' in p).toBe(false);
  });

  it('la incluye cuando hay un ítem encolable', () => {
    const p = buildConfirmPayload(request([empanada, banana], { conversacion: CONVERSACION }), PER100, CONTEXT);
    expect(p.conversacion).toEqual(CONVERSACION);
  });

  it('no la incluye si ningún ítem entra a la cola (SARA2, agua, a mano o quitado)', () => {
    for (const items of [[banana], [banana, agua], [banana, manual], [banana, quitado]]) {
      const p = buildConfirmPayload(request(items, { conversacion: CONVERSACION }), PER100, CONTEXT);
      expect('conversacion' in p, JSON.stringify(items.map((i) => i.ingrediente))).toBe(false);
    }
  });
});

describe('conversationSchema / confirmRequestSchema — topes', () => {
  it('acepta solo {role, content} con roles user/assistant', () => {
    expect(conversationSchema.safeParse(CONVERSACION).success).toBe(true);
    expect(conversationSchema.safeParse([{ role: 'system', content: 'x' }]).success).toBe(false);
  });

  it('rechaza demasiados mensajes, mensajes largos y un total excesivo', () => {
    const muchos = Array.from({ length: MAX_CONVERSATION_MESSAGES + 1 }, () => ({ role: 'user' as const, content: 'a' }));
    expect(conversationSchema.safeParse(muchos).success).toBe(false);
    expect(conversationSchema.safeParse([{ role: 'user', content: 'a'.repeat(MAX_CONVERSATION_MESSAGE_CHARS + 1) }]).success).toBe(false);
    const total = Array.from({ length: MAX_CONVERSATION_MESSAGES }, () => ({
      role: 'user' as const,
      content: 'a'.repeat(MAX_CONVERSATION_MESSAGE_CHARS),
    }));
    expect(total.length * MAX_CONVERSATION_MESSAGE_CHARS).toBeGreaterThan(MAX_CONVERSATION_TOTAL_CHARS);
    expect(conversationSchema.safeParse(total).success).toBe(false);
  });

  it('el request la acepta como opcional y descarta claves extra de los mensajes', () => {
    expect(confirmRequestSchema.safeParse(request([empanada])).success).toBe(true);
    const r = confirmRequestSchema.safeParse(
      request([empanada], { conversacion: [{ role: 'user', content: 'hola', timestamp: 'x', id: '1' } as never] }),
    );
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.conversacion).toEqual([{ role: 'user', content: 'hola' }]);
  });
});

describe('sanitizeConversation — truncado seguro', () => {
  it('deja solo role y content', () => {
    const out = sanitizeConversation([{ role: 'user', content: 'hola', id: '1', timestamp: 'x' } as never]);
    expect(out).toEqual([{ role: 'user', content: 'hola' }]);
  });

  it('conserva los últimos mensajes y respeta el máximo', () => {
    const msgs = Array.from({ length: 30 }, (_, i) => ({ role: 'user', content: `m${i}` }));
    const out = sanitizeConversation(msgs)!;
    expect(out).toHaveLength(MAX_CONVERSATION_MESSAGES);
    expect(out[out.length - 1].content).toBe('m29');
  });

  it('recorta sin partir un emoji y respeta el total', () => {
    const emoji = '😀'.repeat(MAX_CONVERSATION_MESSAGE_CHARS); // 2 unidades UTF-16 cada uno
    const out = sanitizeConversation([{ role: 'user', content: emoji }])!;
    expect(out[0].content.length).toBeLessThanOrEqual(MAX_CONVERSATION_MESSAGE_CHARS);
    expect(out[0].content.endsWith('😀')).toBe(true);
    const grande = Array.from({ length: 20 }, () => ({ role: 'assistant', content: 'a'.repeat(MAX_CONVERSATION_MESSAGE_CHARS) }));
    const total = sanitizeConversation(grande)!.reduce((n, m) => n + m.content.length, 0);
    expect(total).toBeLessThanOrEqual(MAX_CONVERSATION_TOTAL_CHARS);
    expect(conversationSchema.safeParse(sanitizeConversation(grande)).success).toBe(true);
  });

  it('ignora roles inválidos y devuelve null si no queda nada', () => {
    expect(sanitizeConversation([{ role: 'system', content: 'x' }])).toBeNull();
    expect(sanitizeConversation([])).toBeNull();
  });
});

describe('buildConfirmRequest (cliente) — conversación', () => {
  const result: FoodChatResult = {
    alimentos: [
      { alimento: 'Empanada de carne', cantidad: '240 g', gramos: 240, unidad: 'g', tipo: 'otro', idAlimento: null,
        confidence: 0.7, macroSource: 'estimado_ia', macros: { kcal: 600, proteinas_g: 25.2, carbs_g: 64.8, grasas_g: 26.4 } },
    ],
    totalMacros: { kcal: 600, proteinas_g: 25.2, carbs_g: 64.8, grasas_g: 26.4 },
  };
  const solo = { requestId: REQUEST_ID, fecha: '2026-10-08', tipoIngesta: 'cena' as const };

  it('sin conversación en el contexto, el request es el de siempre', () => {
    expect('conversacion' in buildConfirmRequest(result, {}, solo)).toBe(false);
  });

  it('la manda sanitizada cuando hay un ítem estimado por la IA y cumple el schema del servidor', () => {
    const req = buildConfirmRequest(result, {}, {
      ...solo,
      conversacion: [{ role: 'user', content: 'una empanada', id: '9' } as never],
    });
    expect(req.conversacion).toEqual([{ role: 'user', content: 'una empanada' }]);
    expect(confirmRequestSchema.safeParse(req).success).toBe(true);
  });

  it('no la manda si todos los ítems son de catálogo', () => {
    const sara2: FoodChatResult = {
      ...result,
      alimentos: [{ ...result.alimentos[0], macroSource: 'sara2', idAlimento: 375 }],
    };
    const req = buildConfirmRequest(sara2, {}, { ...solo, conversacion: [{ role: 'user', content: 'x' }] });
    expect('conversacion' in req).toBe(false);
  });
});
