'use client';

import { useState, useEffect } from 'react';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { esEmailUCC, extractNombreApellido } from '@/lib/roles';
import Button from '@/components/ui/Button';
import AnimatedError from '@/components/ui/AnimatedError';

type Usage = 'deportista_ucc' | 'particular';

export default function ElegirUsoPage() {
  const router = useRouter();
  const supabase = createClient();

  const [selectedUsage, setSelectedUsage] = useState<Usage | null>(null);
  const [serverError, setServerError] = useState('');
  const [loading, setLoading] = useState(false);
  const [checkingAuth, setCheckingAuth] = useState(true);
  // true cuando el usuario volvió acá desde una fase posterior (?volver=1) y
  // ya existe una fila en `profiles` — el submit actualiza el rol en vez de
  // insertar una fila nueva (que chocaría con el unique de user_id).
  const [perfilExistente, setPerfilExistente] = useState(false);

  useEffect(() => {
    const checkUser = async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        router.replace('/login');
        return;
      }

      // Esta pantalla es solo para usuarios @ucc.edu.ar, con o sin perfil previo.
      if (!esEmailUCC(user.email)) {
        router.replace('/perfil-fisico');
        return;
      }

      const volviendo = new URLSearchParams(window.location.search).get('volver') === '1';

      // If the user already has a profile (e.g. they re-visit this page), redirect accordingly
      const { data: profile } = await supabase
        .from('profiles')
        .select('role, physical_completed')
        .eq('user_id', user.id)
        .maybeSingle();

      if (profile) {
        if (!volviendo) {
          router.replace(profile.physical_completed ? '/home' : '/perfil-fisico');
          return;
        }
        // "Volver a la fase anterior" desde perfil-fisico: dejamos elegir de
        // nuevo, precargado con la elección actual, sin tocar el resto del
        // perfil (physical_completed, etc. quedan como estaban).
        setPerfilExistente(true);
        if (profile.role === 'deportista_ucc' || profile.role === 'particular') {
          setSelectedUsage(profile.role);
        }
        setCheckingAuth(false);
        return;
      }

      setCheckingAuth(false);
    };

    checkUser();
  // supabase and router are stable references created outside the effect
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleVolver = async () => {
    await supabase.auth.signOut();
    router.push('/login');
    router.refresh();
  };

  const handleSubmit = async () => {
    if (!selectedUsage) return;
    setLoading(true);
    setServerError('');

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      router.replace('/login');
      return;
    }

    const { error } = perfilExistente
      ? await supabase.from('profiles').update({ role: selectedUsage }).eq('user_id', user.id)
      : await supabase.from('profiles').insert({
          user_id: user.id,
          ...extractNombreApellido(user.user_metadata as Record<string, unknown>),
          email: user.email ?? '',
          role: selectedUsage,
          physical_completed: false,
          academic_completed: false,
          psychological_completed: false,
        });

    if (error) {
      setServerError('Error al guardar tu selección. Intenta nuevamente.');
      setLoading(false);
      return;
    }

    router.push('/perfil-fisico');
    router.refresh();
  };

  if (checkingAuth) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-gray-50">
        <p className="text-gray-400 text-sm">Cargando...</p>
      </main>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Top bar */}
      <header className="bg-white px-4 py-4 flex items-center border-b border-gray-100">
        <div className="flex items-center gap-2.5">
          <Image src="/logo.png" alt="Logo NutriScan" width={32} height={32} className="w-8 h-8 text-white" />
          <Image src="/tituloNutriScanNEGRO.png" alt="NutriScan" width={120} height={24} className="h-6 w-auto" />
        </div>
      </header>

      <main className="flex flex-col items-center justify-center px-4 py-12 min-h-[calc(100vh-64px)]">
      <div className="w-full max-w-md rounded-2xl bg-white p-8 shadow-sm border border-gray-100">
        <div className="mb-6 text-center">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-blue-50">
            <span className="text-2xl">🎓</span>
          </div>
          <h2 className="text-2xl font-bold text-gray-900">¿Cómo vas a usar NutriScan?</h2>
          <p className="mt-2 text-sm text-gray-500">
            Esta selección determina las funcionalidades disponibles para tu cuenta.
          </p>
        </div>

        <div className="flex flex-col gap-3 mb-6">
          <button
            type="button"
            onClick={() => setSelectedUsage('deportista_ucc')}
            className={`rounded-xl border-2 p-4 text-left transition-all ${
              selectedUsage === 'deportista_ucc'
                ? 'border-blue-600 bg-blue-50'
                : 'border-gray-200 hover:border-gray-300'
            }`}
          >
            <div className="flex items-start gap-3">
              <span className="text-2xl">🏅</span>
              <div>
                <p className="font-semibold text-gray-900">
                  Intervenciones interdisciplinarias en atletas universitarios
                </p>
                <p className="mt-1 text-sm text-gray-500">
                  Acceso completo al perfil deportivo y encuesta psicológica.
                </p>
              </div>
            </div>
          </button>

          <button
            type="button"
            onClick={() => setSelectedUsage('particular')}
            className={`rounded-xl border-2 p-4 text-left transition-all ${
              selectedUsage === 'particular'
                ? 'border-blue-600 bg-blue-50'
                : 'border-gray-200 hover:border-gray-300'
            }`}
          >
            <div className="flex items-start gap-3">
              <span className="text-2xl">👤</span>
              <div>
                <p className="font-semibold text-gray-900">Uso particular</p>
                <p className="mt-1 text-sm text-gray-500">
                  Seguimiento nutricional personal básico.
                </p>
              </div>
            </div>
          </button>
        </div>

        <AnimatedError message={serverError} className="mb-4" />

        <Button
          type="button"
          size="lg"
          className="w-full"
          disabled={!selectedUsage}
          loading={loading}
          onClick={handleSubmit}
        >
          Continuar
        </Button>

        <Button type="button" variant="ghost" size="md" className="w-full mt-2" onClick={handleVolver}>
          Volver
        </Button>
      </div>
      </main>
    </div>
  );
}
