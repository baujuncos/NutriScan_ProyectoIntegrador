/** Formato de error compartido entre los endpoints de detección/guardado. */
import { NextResponse } from 'next/server';

export function errorResponse(status: number, error: string, message: string, field?: string) {
  return NextResponse.json({ error, message, ...(field ? { field } : {}) }, { status });
}
