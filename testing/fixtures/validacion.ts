import type { OcurrenciaDetalle, PendienteFila } from '@/app/(researcher)/validacion/actions';

export const PENDIENTE: PendienteFila = {
  id_pendiente: 5,
  nombre_original: 'Flan casero',
  nombre_normalizado: 'flan casero',
  categoria_ia: 'postre',
  gemini_kcal_100g: 150,
  gemini_proteinas_100g: 3,
  gemini_grasas_100g: 5,
  gemini_carbs_100g: 23,
  gemini_modelo: 'gemini-x',
  nombre_final: null,
  categoria_final: null,
  final_kcal_100g: null,
  final_proteinas_100g: null,
  final_grasas_100g: null,
  final_carbs_100g: null,
  id_alimento_vinculado: null,
  estado: 'pendiente',
  observaciones: null,
  resuelto_at: null,
  created_at: '2026-10-05T12:00:00Z',
  ocurrencias: 2,
  ultima_ocurrencia: '2026-10-06T12:00:00Z',
};

export const OCURRENCIA: OcurrenciaDetalle = {
  idGuardadoItem: 1,
  fecha: '2026-10-06T12:00:00Z',
  deportista: 'Ana Pérez',
  nombreIa: 'Postre blanco',
  nombreFinal: 'Flan casero',
  gramosIa: 100,
  gramosFinal: 120,
  respuestas: [{ question: '¿Qué es el postre?', answer: 'Flan' }],
  bbox: { x: 0.1, y: 0.2, width: 0.3, height: 0.4 },
  fotoUrl: 'https://signed.example/1.jpg',
};
