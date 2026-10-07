/**
 * NUT-119 — Cobertura del propio mock de Supabase: rpc, storage y upsert.
 */
import { describe, expect, it } from 'vitest';
import { createSupabaseFromMock } from './supabaseMock';

describe('supabaseMock: rpc', () => {
  it('devuelve lo encolado (FIFO por función) y registra las llamadas', async () => {
    const mock = createSupabaseFromMock();
    mock.mockRpc('match_alimentos', { data: [{ idx: 1 }], error: null });
    mock.mockRpc('match_alimentos', { data: [], error: { message: 'boom' } });

    const a = await mock.rpc('match_alimentos', { p_nombres: ['x'] });
    const b = await mock.rpc('match_alimentos', { p_nombres: ['y'] });
    const c = await mock.rpc('otra', {});

    expect(a).toEqual({ data: [{ idx: 1 }], error: null });
    expect(b.error).toEqual({ message: 'boom' });
    expect(c).toEqual({ data: null, error: null });
    expect(mock.rpcLlamadas()).toEqual([
      { nombre: 'match_alimentos', args: { p_nombres: ['x'] } },
      { nombre: 'match_alimentos', args: { p_nombres: ['y'] } },
      { nombre: 'otra', args: {} },
    ]);
  });
});

describe('supabaseMock: storage', () => {
  it('devuelve lo encolado por método y registra bucket, método y args', async () => {
    const mock = createSupabaseFromMock();
    mock.mockStorage('upload', { data: { path: 'u/1.jpg' }, error: null });
    mock.mockStorage('createSignedUrls', { data: [{ path: 'u/1.jpg', signedUrl: 'https://s' }], error: null });

    const up = await mock.storage.from('detecciones-fotos').upload('u/1.jpg', new Uint8Array([1]), {
      contentType: 'image/jpeg',
    });
    const signed = await mock.storage.from('detecciones-fotos').createSignedUrls(['u/1.jpg'], 300);
    const rm = await mock.storage.from('detecciones-fotos').remove(['u/1.jpg']);

    expect(up.data).toEqual({ path: 'u/1.jpg' });
    expect(signed.data?.[0].signedUrl).toBe('https://s');
    expect(rm).toEqual({ data: null, error: null });
    expect(mock.storageLlamadas().map((l) => [l.bucket, l.metodo])).toEqual([
      ['detecciones-fotos', 'upload'],
      ['detecciones-fotos', 'createSignedUrls'],
      ['detecciones-fotos', 'remove'],
    ]);
    expect(mock.storageLlamadas()[1].args).toEqual([['u/1.jpg'], 300]);
  });
});

describe('supabaseMock: upsert', () => {
  it('se registra como insert y resuelve como thenable', async () => {
    const mock = createSupabaseFromMock();
    mock.mockTable('ingestas', { data: null, error: null });
    await (mock.from('ingestas') as any).upsert([{ fecha: '2026-10-07' }], { onConflict: 'id_usuario,fecha,tipo' });
    expect(mock.insertsLlamados()).toEqual([{ tabla: 'ingestas', payload: [{ fecha: '2026-10-07' }] }]);
  });

  it('reset limpia rpc y storage', async () => {
    const mock = createSupabaseFromMock();
    await mock.rpc('x', {});
    await mock.storage.from('b').remove(['p']);
    mock.reset();
    expect(mock.rpcLlamadas()).toEqual([]);
    expect(mock.storageLlamadas()).toEqual([]);
  });
});
