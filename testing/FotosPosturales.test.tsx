/**
 * NUT-251/NUT-240 — Sección "Fotos posturales" de la revisión: tres espacios fijos, subir, cambiar y quitar.
 */
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { registrarFoto, quitarFoto, subir, borrarDelBucket } = vi.hoisted(() => ({
  registrarFoto: vi.fn(),
  quitarFoto: vi.fn(),
  subir: vi.fn(),
  borrarDelBucket: vi.fn(),
}));

vi.mock('@/app/(researcher)/antropometrias/actions', () => ({ registrarFotoAction: registrarFoto, quitarFotoAction: quitarFoto }));
vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({ storage: { from: (bucket: string) => ({ upload: (...a: unknown[]) => subir(bucket, ...a), remove: borrarDelBucket }) } }),
}));

import FotosPosturales from '@/app/(researcher)/antropometrias/FotosPosturales';
import { BUCKET_FOTOS_ANTROPOMETRIA, MAX_BYTES_FOTO, type FotoMedicion } from '@/lib/researcher/antropometria/fotos';

const FRENTE: FotoMedicion = { id: 'f1', posicion: 'frente', url: 'https://storage.test/firmada/frente.jpg?token=t' };
const ESPALDA: FotoMedicion = { id: 'f3', posicion: 'espalda', url: 'https://storage.test/firmada/espalda.jpg?token=t' };

const imagen = (nombre = 'foto.jpg', tipo = 'image/jpeg', bytes = 2048) => new File([new Uint8Array(bytes)], nombre, { type: tipo });

function mostrar(props: Partial<React.ComponentProps<typeof FotosPosturales>> = {}) {
  const onFotos = vi.fn();
  const vista = render(<FotosPosturales medicionId="m1" fotos={[]} onFotos={onFotos} {...props} />);
  return { onFotos, ...vista };
}

/** Elige un archivo sin pasar por el filtro `accept` del input (como un navegador que no lo respeta). */
const elegir = (posicion: string, archivo: File) =>
  fireEvent.change(screen.getByLabelText(`Archivo de la foto de ${posicion}`), { target: { files: [archivo] } });

beforeEach(() => {
  registrarFoto.mockReset();
  quitarFoto.mockReset();
  subir.mockReset().mockResolvedValue({ data: {}, error: null });
  borrarDelBucket.mockReset().mockResolvedValue({ data: [], error: null });
});

describe('FotosPosturales', () => {
  it('muestra los tres espacios fijos, que es opcional y cuántas hay cargadas', () => {
    mostrar({ fotos: [FRENTE, ESPALDA] });

    const seccion = screen.getByRole('region', { name: 'Fotos posturales' });
    expect(seccion).toHaveTextContent('Opcional · hasta 3 por medición · 2 de 3 cargadas');
    const espacios = within(seccion).getAllByRole('listitem');
    expect(espacios.map((e) => e.querySelector('p')?.textContent)).toEqual(['Frente', 'Lateral', 'Espalda']);
    expect(within(espacios[1]).getByText('Sin foto')).toBeInTheDocument();
    expect(within(espacios[0]).getByRole('img', { name: 'Foto postural: frente' })).toHaveAttribute('src', FRENTE.url);
  });

  it('el input pide imagen y abre la cámara trasera en el celular', () => {
    mostrar();
    const entrada = screen.getByLabelText('Archivo de la foto de frente');
    expect(entrada).toHaveAttribute('type', 'file');
    expect(entrada).toHaveAttribute('accept', 'image/*');
    expect(entrada).toHaveAttribute('capture', 'environment');
  });

  it('sin id de medición (borrador sin guardar) los espacios están deshabilitados y lo explica', () => {
    mostrar({ medicionId: null });

    expect(screen.getByText('Se habilitan cuando se guarda el borrador.')).toBeInTheDocument();
    for (const posicion of ['frente', 'lateral', 'espalda']) {
      expect(screen.getByRole('button', { name: `Subir foto de ${posicion}` })).toBeDisabled();
      expect(screen.getByLabelText(`Archivo de la foto de ${posicion}`)).toBeDisabled();
    }
  });

  it('con id no muestra el aviso de borrador y los botones están activos', () => {
    mostrar();
    expect(screen.queryByText(/Se habilitan cuando se guarda el borrador/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Subir foto de lateral' })).toBeEnabled();
  });

  it('"Quitar" aparece solo donde hay foto, llama a la acción y actualiza la lista', async () => {
    quitarFoto.mockResolvedValue({ ok: true, fotos: [ESPALDA] });
    const { onFotos } = mostrar({ fotos: [FRENTE, ESPALDA] });

    expect(screen.getAllByRole('button', { name: /^Quitar foto/ })).toHaveLength(2);
    expect(screen.queryByRole('button', { name: 'Quitar foto de lateral' })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Quitar foto de frente' }));

    expect(quitarFoto).toHaveBeenCalledWith('m1', 'frente');
    await waitFor(() => expect(onFotos).toHaveBeenCalledWith([ESPALDA]));
  });

  it('si no se puede quitar muestra el error y no cambia la lista', async () => {
    quitarFoto.mockResolvedValue({ error: 'No se pudo quitar la foto. Probá de nuevo.' });
    const { onFotos } = mostrar({ fotos: [FRENTE] });

    await userEvent.click(screen.getByRole('button', { name: 'Quitar foto de frente' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('No se pudo quitar la foto');
    expect(onFotos).not.toHaveBeenCalled();
  });

  it('sube la foto (comprimida) al bucket privado, en la carpeta de la medición, y la registra', async () => {
    registrarFoto.mockImplementation(async (_id: string, posicion: string, path: string) => ({
      ok: true,
      fotos: [{ id: 'f9', posicion, url: `https://storage.test/firmada/${path}` }],
    }));
    const { onFotos } = mostrar();

    elegir('lateral', imagen('IMG_1.jpg'));

    await waitFor(() => expect(onFotos).toHaveBeenCalledTimes(1));
    const [bucket, path, archivo, opciones] = subir.mock.calls[0];
    expect(bucket).toBe(BUCKET_FOTOS_ANTROPOMETRIA);
    expect(path).toMatch(/^m1\/lateral-[0-9a-f-]{36}\.jpg$/);
    expect(archivo).toBeInstanceOf(Blob);
    expect(opciones).toEqual({ contentType: 'image/jpeg', upsert: false });
    expect(registrarFoto).toHaveBeenCalledWith('m1', 'lateral', path);
    expect(onFotos.mock.calls[0][0]).toEqual([{ id: 'f9', posicion: 'lateral', url: expect.stringContaining(path) }]);
    expect(screen.getByText(/Subida: 2 KB \(comprimida\)/)).toBeInTheDocument();
  });

  it('una foto ya cargada se cambia desde el mismo espacio', async () => {
    registrarFoto.mockResolvedValue({ ok: true, fotos: [FRENTE] });
    mostrar({ fotos: [FRENTE] });

    expect(screen.getByRole('button', { name: 'Cambiar foto de frente' })).toHaveTextContent('Cambiar foto');
    elegir('frente', imagen());

    await waitFor(() => expect(registrarFoto).toHaveBeenCalledWith('m1', 'frente', expect.stringMatching(/^m1\/frente-/)));
  });

  it('si el servidor no registra la foto, muestra el error y borra el archivo que se había subido', async () => {
    registrarFoto.mockResolvedValue({ error: 'No se encontró la foto subida. Probá de nuevo.' });
    const { onFotos } = mostrar();

    elegir('frente', imagen());

    expect(await screen.findByRole('alert')).toHaveTextContent('No se encontró la foto subida');
    expect(onFotos).not.toHaveBeenCalled();
    expect(borrarDelBucket).toHaveBeenCalledWith([subir.mock.calls[0][1]]);
  });

  it('si la subida falla muestra el error y no registra nada', async () => {
    subir.mockResolvedValue({ data: null, error: { message: 'rls' } });
    mostrar();

    elegir('espalda', imagen());

    expect(await screen.findByRole('alert')).toHaveTextContent('No se pudo subir la foto');
    expect(registrarFoto).not.toHaveBeenCalled();
  });

  it('rechaza lo que no es imagen y lo que sigue pesando más de 3 MB después de comprimir, sin subir', async () => {
    mostrar();

    elegir('frente', imagen('informe.pdf', 'application/pdf'));
    expect(await screen.findByRole('alert')).toHaveTextContent('Elegí una imagen');

    elegir('frente', imagen('enorme.jpg', 'image/jpeg', MAX_BYTES_FOTO + 1)); // en jsdom no hay canvas: no se comprime
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('3 MB'));

    expect(subir).not.toHaveBeenCalled();
    expect(registrarFoto).not.toHaveBeenCalled();
  });

  it('mientras sube un espacio, los demás quedan bloqueados', async () => {
    let terminar: (v: unknown) => void = () => undefined;
    registrarFoto.mockReturnValue(new Promise((r) => (terminar = r)));
    mostrar({ fotos: [ESPALDA] });

    elegir('frente', imagen());

    await waitFor(() => expect(screen.getByRole('button', { name: 'Subir foto de lateral' })).toBeDisabled());
    expect(screen.getByRole('button', { name: 'Quitar foto de espalda' })).toBeDisabled();

    terminar({ ok: true, fotos: [FRENTE, ESPALDA] });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Subir foto de lateral' })).toBeEnabled());
  });
});
