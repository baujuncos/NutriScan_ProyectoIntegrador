'use client';

import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { useState } from 'react';

export default function LogoutButton() {
  const router = useRouter();
  const supabase = createClient();
  const [loading, setLoading] = useState(false);

  const handleLogout = async () => {
    setLoading(true);
    await supabase.auth.signOut();
    router.push('/');
    router.refresh();
  };

  return (
    <button
      onClick={handleLogout}
      disabled={loading}
      className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-700 transition-colors disabled:opacity-50"
    >
      <svg width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 9V5.25A2.25 2.25 0 0 0 13.5 3h-6a2.25 2.25 0 0 0-2.25 2.25v13.5A2.25 2.25 0 0 0 7.5 21h6a2.25 2.25 0 0 0 2.25-2.25V15m3 0 3-3m0 0-3-3m3 3H9" />
      </svg>
      {loading ? 'Saliendo...' : 'Salir'}
    </button>
  );
}
