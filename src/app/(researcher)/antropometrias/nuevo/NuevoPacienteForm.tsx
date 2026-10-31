'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import Card from '@/components/researcher/Card';
import { CONTROL_CLASS } from '@/components/researcher/FilterBar';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import { EDAD_MINIMA } from '@/lib/antropometria';
import { edadEn, esMayorDeEdad, MENSAJE_MENOR_DE_EDAD } from '@/lib/researcher/antropometria/reglas';
import { crearPacienteManualAction, type PacienteDuplicado } from '../actions';

export default function NuevoPacienteForm() {
  const router = useRouter();
  const [pendiente, empezar] = useTransition();
  const [nombre, setNombre] = useState('');
  const [apellido, setApellido] = useState('');
  const [fechaNacimiento, setFechaNacimiento] = useState('');
  const [sexo, setSexo] = useState<'' | 'M' | 'F'>('');
  const [error, setError] = useState<string | null>(null);
  const [duplicado, setDuplicado] = useState<PacienteDuplicado | null>(null);

  const edad = fechaNacimiento ? edadEn(fechaNacimiento) : null;
  const esMenor = fechaNacimiento !== '' && edad !== null && !esMayorDeEdad(fechaNacimiento);

  function guardar(confirmarDuplicado: boolean) {
    setError(null);
    if (esMenor) {
      setError(MENSAJE_MENOR_DE_EDAD);
      return;
    }
    empezar(async () => {
      const r = await crearPacienteManualAction({ nombre, apellido, fechaNacimiento, sexo }, confirmarDuplicado);
      if ('ok' in r) {
        router.push(`/antropometrias/manual/${r.id}`);
      } else if ('duplicado' in r) {
        setDuplicado(r.duplicado);
      } else {
        setDuplicado(null);
        setError(r.error);
      }
    });
  }

  return (
    <Card className="max-w-xl p-6">
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          guardar(false);
        }}
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Input label="Nombre" value={nombre} onChange={(e) => { setNombre(e.target.value); setDuplicado(null); }} required maxLength={80} autoComplete="off" />
          <Input label="Apellido" value={apellido} onChange={(e) => { setApellido(e.target.value); setDuplicado(null); }} required maxLength={80} autoComplete="off" />
        </div>

        <Input
          label="Fecha de nacimiento"
          type="date"
          value={fechaNacimiento}
          onChange={(e) => { setFechaNacimiento(e.target.value); setDuplicado(null); }}
          required
          error={esMenor ? MENSAJE_MENOR_DE_EDAD : undefined}
        />
        {edad !== null && !esMenor && <p className="-mt-2 text-xs text-slate-600">Edad: {edad} años</p>}

        <div>
          <label htmlFor="sexo" className="mb-1 block text-sm font-medium text-gray-700">
            Sexo
          </label>
          <select
            id="sexo"
            value={sexo}
            onChange={(e) => { setSexo(e.target.value as '' | 'M' | 'F'); setDuplicado(null); }}
            required
            className={CONTROL_CLASS}
          >
            <option value="">Elegí una opción</option>
            <option value="F">Femenino</option>
            <option value="M">Masculino</option>
          </select>
          <p className="mt-1 text-xs text-slate-600">Define las fórmulas y tablas de referencia del informe. Solo se miden mayores de {EDAD_MINIMA} años.</p>
        </div>

        {duplicado && (
          <div role="alert" className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
            <p>
              Ya existe un paciente con el mismo nombre, apellido y fecha de nacimiento:{' '}
              <Link href={`/antropometrias/${duplicado.origen}/${duplicado.id}`} className="font-medium underline">
                {duplicado.apellido}, {duplicado.nombre}
              </Link>
              .
            </p>
            <Button type="button" variant="outline" size="sm" className="mt-2" loading={pendiente} onClick={() => guardar(true)}>
              Es otra persona, guardar igualmente
            </Button>
          </div>
        )}

        {error && (
          <p role="alert" className="text-sm text-red-700">
            {error}
          </p>
        )}

        <div className="flex flex-wrap gap-3 pt-2">
          <Button type="submit" loading={pendiente} disabled={esMenor}>
            Guardar y abrir ficha
          </Button>
          <Link
            href="/antropometrias"
            className="inline-flex items-center rounded-lg px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-gray-400"
          >
            Cancelar
          </Link>
        </div>
      </form>
    </Card>
  );
}
