import PageHeader from '@/components/researcher/PageHeader';
import NuevoPacienteForm from './NuevoPacienteForm';

export default function NuevoPacientePage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Agregar paciente"
        subtitle="Para personas que no usan la app. Después de guardar vas a poder cargar su primera medición."
        helpId="antropometrias"
      />
      <NuevoPacienteForm />
    </div>
  );
}
