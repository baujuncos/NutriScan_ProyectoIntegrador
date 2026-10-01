'use client';

import { useEffect, useState } from 'react';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import PhysicalForm, { PhysicalInitialData } from '@/components/profile/PhysicalForm';
import OnboardingProgress from '@/components/onboarding/OnboardingProgress';
import Button from '@/components/ui/Button';

export default function PerfilFisicoPage() {
  const router = useRouter();
  const supabase = createClient();
  const [initial, setInitial] = useState<PhysicalInitialData | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        router.push('/login');
        return;
      }
      const { data } = await supabase
        .from('physical_data')
        .select('peso_kg, altura_cm, fecha_nacimiento, sexo, factor_actividad')
        .eq('user_id', user.id)
        .maybeSingle();
      if (!cancelled) {
        setInitial(data ?? null);
        setLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [router, supabase]);

  const handleSaved = async () => {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      router.push('/login');
      return;
    }
    const { data: profile } = await supabase
      .from('profiles')
      .select('role')
      .eq('user_id', user.id)
      .single();
    if (profile?.role === 'deportista_ucc') {
      router.push('/perfil-academico');
    } else {
      router.push('/home');
    }
    router.refresh();
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white px-4 py-4 flex items-center border-b border-gray-100">
        <div className="flex items-center gap-2.5">
          <Image src="/logo.png" alt="Logo NutriScan" width={32} height={32} className="w-8 h-8 text-white" />
          <Image src="/tituloNutriScanNEGRO.png" alt="NutriScan" width={120} height={24} className="h-6 w-auto" />
        </div>
      </header>

      <main className="flex flex-col items-center justify-center px-4 py-10 min-h-[calc(100vh-64px)]">
        <div className="w-full max-w-lg rounded-2xl bg-white p-8 shadow-sm border border-gray-100">
          <div className="mb-6">
            <OnboardingProgress step={1} />
            <h2 className="text-2xl font-bold text-gray-900">Perfil Físico</h2>
            <p className="mt-1 text-sm text-gray-500">
              Esta información nos permite calcular tus requerimientos nutricionales personalizados.
            </p>
          </div>

          {loaded ? (
            <>
              <PhysicalForm initialData={initial} onSaved={handleSaved} />
              <Button
                type="button"
                variant="ghost"
                size="md"
                className="w-full mt-2"
                onClick={() => router.push('/elegir-uso?volver=1')}
              >
                Volver a la fase anterior
              </Button>
            </>
          ) : (
            <p className="text-sm text-gray-500">Cargando…</p>
          )}
        </div>
      </main>
    </div>
  );
}
