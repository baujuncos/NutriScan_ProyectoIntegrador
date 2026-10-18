import {
  MealChatError,
  type MealChatErrorCode,
  type MealSaveResult,
  type MealSaveService,
} from './chatFood';

// NUT-191 — Guardado real: POST /api/chat/meal/confirm. La sesión viaja en las cookies.
// Se usa tanto con el chat real como con el mock (el mock también persiste de verdad).

const ENDPOINT = '/api/chat/meal/confirm';

const ERROR_MESSAGES: Partial<Record<MealChatErrorCode, { message: string; retryable: boolean }>> = {
  BAD_REQUEST: { message: 'No pudimos guardar este registro. Revisalo e intentá de nuevo.', retryable: false },
  UNAUTHORIZED: { message: 'Tu sesión venció. Volvé a iniciar sesión para guardar.', retryable: false },
  PERSISTENCE_ERROR: { message: 'No pudimos guardar el registro. Probá de nuevo.', retryable: true },
  NETWORK: { message: 'No pudimos conectarnos. Revisá tu conexión y reintentá.', retryable: true },
};

function saveError(code: MealChatErrorCode, message?: string): MealChatError {
  const base = ERROR_MESSAGES[code] ?? ERROR_MESSAGES.PERSISTENCE_ERROR!;
  return new MealChatError(code, message ?? base.message, base.retryable);
}

export const realMealSaveService: MealSaveService = {
  async save(request, signal) {
    let res: Response;
    try {
      res = await fetch(ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
        signal,
      });
    } catch (err) {
      if (signal?.aborted) throw err;
      throw saveError('NETWORK');
    }

    let body: unknown = null;
    try {
      body = await res.json();
    } catch {
      body = null;
    }

    if (!res.ok) {
      const error = (body as { error?: { code?: string; message?: string } } | null)?.error;
      const code: MealChatErrorCode =
        error?.code === 'BAD_REQUEST' || error?.code === 'UNAUTHORIZED' || error?.code === 'PERSISTENCE_ERROR'
          ? error.code
          : res.status === 401 ? 'UNAUTHORIZED' : res.status === 400 ? 'BAD_REQUEST' : 'PERSISTENCE_ERROR';
      // Los 400 traen un mensaje de validación en español, apto para mostrar tal cual.
      throw saveError(code, code === 'BAD_REQUEST' && typeof error?.message === 'string' ? error.message : undefined);
    }

    const data = body as Partial<MealSaveResult> | null;
    if (!data || data.ok !== true) throw saveError('PERSISTENCE_ERROR');
    return {
      ok: true,
      mlAgua: Number(data.mlAgua ?? 0),
      itemsDiario: Number(data.itemsDiario ?? 0),
      yaGuardado: data.yaGuardado === true,
    };
  },
};

export function getMealSaveService(): MealSaveService {
  return realMealSaveService;
}
