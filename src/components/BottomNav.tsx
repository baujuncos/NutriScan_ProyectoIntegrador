'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

function HomeIcon({ active }: { active: boolean }) {
  return (
    <svg width="22" height="22" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={active ? 2.2 : 1.7}>
      <path strokeLinecap="round" strokeLinejoin="round" d="m3 12 2-2m0 0 7-7 7 7M5 10v10a1 1 0 0 0 1 1h3m10-11 2 2m-2-2v10a1 1 0 0 1-1 1h-3m-6 0a1 1 0 0 0 1-1v-4a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v4a1 1 0 0 0 1 1m-6 0h6" />
    </svg>
  );
}

function ComidasIcon({ active }: { active: boolean }) {
  return (
    <svg width="22" height="22" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={active ? 2.2 : 1.7} strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 2v7c0 1.1.9 2 2 2h4a2 2 0 0 0 2-2V2" />
      <path d="M7 2v20" />
      <path d="M21 15V2a5 5 0 0 0-5 5v6c0 1.1.9 2 2 2h3v0" />
      <path d="M21 15v7" />
    </svg>
  );
}

function PerfilIcon({ active }: { active: boolean }) {
  return (
    <svg width="22" height="22" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={active ? 2.2 : 1.7}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0ZM4.501 20.118a7.5 7.5 0 0 1 14.998 0A17.933 17.933 0 0 1 12 21.75c-2.676 0-5.216-.584-7.499-1.632Z" />
    </svg>
  );
}

export default function BottomNav() {
  const pathname = usePathname();
  const isHome = pathname === '/home';
  const isComidas = pathname.startsWith('/alimentacion');
  const isPerfil = pathname === '/perfil';

  return (
    <nav
      className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-100 z-50 lg:hidden"
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      <div className="flex items-stretch h-[72px]">
        <Link
          href="/home"
          className={`flex-1 flex flex-col items-center justify-center gap-0.5 py-2 transition-colors ${isHome ? 'text-[#C2410C]' : 'text-gray-400'}`}
        >
          <HomeIcon active={isHome} />
          <span className="text-xs font-medium">Inicio</span>
        </Link>
        <Link
          href="/alimentacion"
          className={`flex-1 flex flex-col items-center justify-center gap-0.5 py-2 transition-colors ${isComidas ? 'text-[#C2410C]' : 'text-gray-400'}`}
        >
          <ComidasIcon active={isComidas} />
          <span className="text-xs font-medium">Comidas</span>
        </Link>
        <Link
          href="/perfil"
          className={`flex-1 flex flex-col items-center justify-center gap-0.5 py-2 transition-colors ${isPerfil ? 'text-[#C2410C]' : 'text-gray-400'}`}
        >
          <PerfilIcon active={isPerfil} />
          <span className="text-xs font-medium">Perfil</span>
        </Link>
      </div>
    </nav>
  );
}
