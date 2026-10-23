'use client';

import { useState } from 'react';
import AthletesTable, { type AthleteRow } from '@/components/researcher/AthletesTable';
import ExportPanel from './ExportPanel';
import PageHeader from '@/components/researcher/PageHeader';
import AthleteDetailModal from '@/components/researcher/AthleteDetailModal';

interface Props {
  athletes: AthleteRow[];
}

export default function DeportistasClient({ athletes }: Props) {
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [modalAthlete, setModalAthlete] = useState<AthleteRow | null>(null);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Deportistas"
        subtitle="Cohorte de deportistas UCC registrados"
        helpId="deportistas"
        actions={<ExportPanel selectedIds={selectedIds} />}
      />

      <AthletesTable
        athletes={athletes}
        onSelectionChange={setSelectedIds}
        onRowClick={setModalAthlete}
      />

      <AthleteDetailModal
        athlete={modalAthlete}
        onClose={() => setModalAthlete(null)}
      />
    </div>
  );
}
