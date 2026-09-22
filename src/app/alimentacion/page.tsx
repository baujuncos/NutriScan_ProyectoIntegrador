import Image from 'next/image';
import { redirect } from 'next/navigation';
import LogoutButton from '@/components/auth/LogoutButton';
import BottomNav from '@/components/BottomNav';
import AthleteSidebar from '@/components/AthleteSidebar';
import { getRoleLabel, shouldHideNutritionInfo } from '@/lib/roles';
import { createClient } from '@/lib/supabase/server';
import { INGESTA_TIPOS, isValidDateInput, type IngestaTipo } from '@/lib/nutrition';
import { todayAR } from '@/lib/date';
import AlimentacionView from './AlimentacionView';

export const dynamic = 'force-dynamic';

type ItemRow = {
  id_item: number;
  id_alimento: number | null;
  nombre_manual: string | null;
  tipo_item: string;
  cantidad: number | string;
  kcal: number | string;
  proteinas_g: number | string;
  grasas_g: number | string;
  carbs_g: number | string;
  alimentos: { nombre: string; categoria: string | null } | Array<{ nombre: string; categoria: string | null }> | null;
};

type IngestaRow = {
  id_ingesta: number;
  tipo: IngestaTipo;
  fecha: string;
  kcal_total: number | string;
  proteinas_total_g: number | string;
  grasas_total_g: number | string;
  carbs_total_g: number | string;
  items: ItemRow[] | null;
};

export default async function AlimentacionPage({
  searchParams,
}: {
  searchParams: Promise<{ fecha?: string; tipo?: string }>;
}) {
  const params = await searchParams;
  const today = todayAR();
  const fecha = params.fecha && isValidDateInput(params.fecha) ? params.fecha : today;
  const selectedTipo = (
    params.tipo && INGESTA_TIPOS.includes(params.tipo as IngestaTipo) ? params.tipo : 'desayuno'
  ) as IngestaTipo;

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const { data: profile } = await supabase
    .from('profiles')
    .select('nombre, apellido, role')
    .eq('user_id', user.id)
    .single();

  if (!profile) redirect('/login');
  if (profile.role === 'investigador' || profile.role === 'administrador') redirect('/dashboard');

  const hideNutrition = shouldHideNutritionInfo(profile.role);

  const { data: ingestasData } = await supabase
    .from('ingestas')
    .select(`
      id_ingesta, tipo, fecha,
      kcal_total, proteinas_total_g, grasas_total_g, carbs_total_g,
      items(id_item, id_alimento, nombre_manual, tipo_item, cantidad, kcal, proteinas_g, grasas_g, carbs_g,
        alimentos(nombre, categoria))
    `)
    .eq('id_usuario', user.id)
    .eq('fecha', fecha);

  const ingestas = (ingestasData ?? []) as IngestaRow[];

  return (
    <>
      <AthleteSidebar nombre={profile.nombre} apellido={profile.apellido ?? ''} roleLabel={getRoleLabel(profile.role)} />

      <div key="alimentacion" className="min-h-screen bg-slate-50 pb-24 lg:pb-0 lg:pl-64 overflow-x-hidden animate-page-in">

        {/* Mobile-only header */}
        <header className="lg:hidden bg-white px-4 py-4 flex items-center justify-between border-b border-gray-100">
          <div className="flex items-center gap-2.5">
            <Image src="/logo.png" alt="Logo NutriScan" width={32} height={32} className="w-8 h-8" />
            <Image src="/tituloNutriScanNEGRO.png" alt="NutriScan" width={120} height={24} className="h-6 w-auto" />
          </div>
          <LogoutButton />
        </header>

        {/* Desktop page title */}
        <div className="hidden lg:block px-8 py-6">
          <h1 className="text-3xl font-bold text-gray-900">Registro de Comidas</h1>
        </div>

        {/* Centered content */}
        <div className="w-full max-w-4xl mx-auto px-4 lg:px-6 py-4">

          <AlimentacionView
            ingestas={ingestas}
            fecha={fecha}
            initialTipo={selectedTipo}
            hideNutrition={hideNutrition}
          />

        </div>

        <BottomNav />
      </div>
    </>
  );
}
