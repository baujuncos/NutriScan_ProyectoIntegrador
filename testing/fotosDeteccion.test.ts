/**
 * NUT-119 — Helper de fotos en Storage privado (storage mockeado).
 */
import { describe, expect, it, vi } from 'vitest';
import { BUCKET_FOTOS, borrarFoto, borrarFotosDeUsuario, subirFotoDeteccion, urlsFirmadas } from '@/lib/fotosDeteccion';
import { createSupabaseFromMock } from './supabaseMock';

describe('subirFotoDeteccion', () => {
  it('sube a {uid}/{uuid}.jpg como jpeg, sin upsert, y devuelve el path', async () => {
    const mock = createSupabaseFromMock();
    mock.mockStorage('upload', { data: { path: 'x' }, error: null });
    const path = await subirFotoDeteccion(mock, 'user-1', Buffer.from('jpg'));
    expect(path).toMatch(/^user-1\/[0-9a-f-]{36}\.jpg$/);
    const [llamada] = mock.storageLlamadas();
    expect(llamada.bucket).toBe(BUCKET_FOTOS);
    expect(llamada.metodo).toBe('upload');
    expect(llamada.args[0]).toBe(path);
    expect(llamada.args[2]).toEqual({ contentType: 'image/jpeg', upsert: false });
  });

  it('devuelve null (y loguea) si Storage responde error', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const mock = createSupabaseFromMock();
    mock.mockStorage('upload', { data: null, error: { message: 'boom' } });
    expect(await subirFotoDeteccion(mock, 'user-1', Buffer.from('jpg'))).toBeNull();
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it('devuelve null si lanza (no propaga)', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const roto = { storage: { from: () => ({ upload: () => Promise.reject(new Error('red')) }) } };
    expect(await subirFotoDeteccion(roto as never, 'user-1', Buffer.from('jpg'))).toBeNull();
    spy.mockRestore();
  });
});

describe('borrarFoto', () => {
  it('borra el path y no lanza aunque falle', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const mock = createSupabaseFromMock();
    mock.mockStorage('remove', { data: null, error: { message: 'boom' } });
    await expect(borrarFoto(mock, 'user-1/a.jpg')).resolves.toBeUndefined();
    expect(mock.storageLlamadas()[0]).toMatchObject({ bucket: BUCKET_FOTOS, metodo: 'remove', args: [['user-1/a.jpg']] });
    spy.mockRestore();
  });
});

describe('urlsFirmadas', () => {
  it('pide todas las URLs en una sola llamada de 300 s y devuelve un mapa path → url', async () => {
    const mock = createSupabaseFromMock();
    mock.mockStorage('createSignedUrls', {
      data: [
        { path: 'u/1.jpg', signedUrl: 'https://s/1', error: null },
        { path: 'u/2.jpg', signedUrl: null, error: 'no existe' },
      ],
      error: null,
    });
    const urls = await urlsFirmadas(mock, ['u/1.jpg', 'u/2.jpg']);
    expect(urls.get('u/1.jpg')).toBe('https://s/1');
    expect(urls.has('u/2.jpg')).toBe(false);
    expect(mock.storageLlamadas()).toHaveLength(1);
    expect(mock.storageLlamadas()[0].args).toEqual([['u/1.jpg', 'u/2.jpg'], 300]);
  });

  it('sin paths no llama a Storage; con error devuelve mapa vacío', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const mock = createSupabaseFromMock();
    expect((await urlsFirmadas(mock, [])).size).toBe(0);
    expect(mock.storageLlamadas()).toHaveLength(0);
    mock.mockStorage('createSignedUrls', { data: null, error: { message: 'boom' } });
    expect((await urlsFirmadas(mock, ['u/1.jpg'])).size).toBe(0);
    spy.mockRestore();
  });
});

describe('borrarFotosDeUsuario', () => {
  it('lista la carpeta del usuario y borra todos sus archivos hasta vaciarla', async () => {
    const mock = createSupabaseFromMock();
    mock.mockStorage('list', { data: [{ name: 'a.jpg' }, { name: 'b.jpg' }], error: null });
    mock.mockStorage('remove', { data: null, error: null });
    mock.mockStorage('list', { data: [{ name: 'c.jpg' }], error: null });
    mock.mockStorage('remove', { data: null, error: null });
    mock.mockStorage('list', { data: [], error: null });

    await borrarFotosDeUsuario(mock, 'user-1');

    const llamadas = mock.storageLlamadas();
    expect(llamadas.map((l) => l.metodo)).toEqual(['list', 'remove', 'list', 'remove', 'list']);
    expect(llamadas[0].args[0]).toBe('user-1');
    expect(llamadas[1].args).toEqual([['user-1/a.jpg', 'user-1/b.jpg']]);
    expect(llamadas[3].args).toEqual([['user-1/c.jpg']]);
  });

  it('sin fotos: solo lista', async () => {
    const mock = createSupabaseFromMock();
    mock.mockStorage('list', { data: [], error: null });
    await borrarFotosDeUsuario(mock, 'user-1');
    expect(mock.storageLlamadas().map((l) => l.metodo)).toEqual(['list']);
  });

  it('nunca lanza y no entra en loop infinito si el borrado falla', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const mock = createSupabaseFromMock();
    mock.mockStorage('list', { data: [{ name: 'a.jpg' }], error: null });
    mock.mockStorage('remove', { data: null, error: { message: 'boom' } });
    await expect(borrarFotosDeUsuario(mock, 'user-1')).resolves.toBeUndefined();
    expect(mock.storageLlamadas().map((l) => l.metodo)).toEqual(['list', 'remove']);

    const roto = { storage: { from: () => ({ list: () => Promise.reject(new Error('red')) }) } };
    await expect(borrarFotosDeUsuario(roto as never, 'user-1')).resolves.toBeUndefined();
    spy.mockRestore();
  });
});
