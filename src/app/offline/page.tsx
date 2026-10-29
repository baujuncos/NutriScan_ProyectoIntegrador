import Image from 'next/image';

export default function OfflinePage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 px-6 text-center">
      <Image src="/logo.png" alt="NutriScan" width={64} height={64} className="h-16 w-16 opacity-80" />
      <h1 className="text-xl font-semibold text-gray-900">Estás sin conexión</h1>
      <p className="max-w-sm text-sm text-gray-500">
        No pudimos conectarnos a internet. Revisá tu conexión e intentá de nuevo.
      </p>
      {/* <a> y no <Link>: sin conexión hace falta una recarga completa, no una navegación del lado del cliente. */}
      {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
      <a
        href="/"
        className="mt-2 rounded-full bg-blue-600 px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-blue-700"
      >
        Reintentar
      </a>
    </main>
  );
}
