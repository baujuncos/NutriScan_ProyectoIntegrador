'use client';

import { ESCORZO_OBLICUO } from '@/lib/anguloDispositivo';
import { getVajillaInfo, VAJILLA_TIPOS, type VajillaTipo } from '@/lib/vajilla';

const ACCENT = '#a855f7';

/**
 * Silueta calibrada según las dimensiones estándar del tipo de vajilla.
 * - `variant="card"`: ícono para la tarjeta del selector.
 * - `variant="overlay"`: marco guía para superponer sobre la cámara / la foto.
 *   `alerta` recolorea la elipse a ámbar cuando el ángulo del celular está fuera
 *   de rango (NUT-163) — mismo overlay, sin componente de feedback aparte.
 */
export function VajillaGuia({
  tipo,
  variant = 'card',
  alerta = false,
  className = '',
}: {
  tipo: VajillaTipo;
  variant?: 'card' | 'overlay';
  alerta?: boolean;
  className?: string;
}) {
  const info = getVajillaInfo(tipo);

  if (variant === 'overlay') {
    // Elipse (no círculo): guía para encuadrar en ÁNGULO, no cenital. Si la foto
    // se saca desde arriba se pierde el relieve (p. ej. una montaña de puré).
    const cx = 50;
    const cy = 47;
    const rx = 44 * info.siluetaDiametroRelativo;
    const ry = rx * ESCORZO_OBLICUO; // escorzo de una vista oblicua (~35° sobre la mesa)
    // profundidad de pared visible: mínima en plato playo, marcada en plato hondo
    const wall = 3.2 * info.siluetaProfundidadRelativa;
    const trazo = alerta ? '#f59e0b' : '#ffffff';
    return (
      <svg viewBox="0 0 100 100" preserveAspectRatio="xMidYMid meet" className={className} aria-hidden="true">
        {wall > 4 && (
          <path
            d={`M ${cx - rx} ${cy} A ${rx} ${ry} 0 0 0 ${cx + rx} ${cy}
                L ${cx + rx} ${cy + wall} A ${rx} ${ry} 0 0 1 ${cx - rx} ${cy + wall} Z`}
            fill={trazo}
            opacity="0.12"
          />
        )}
        <ellipse cx={cx} cy={cy + 0.6} rx={rx + 0.6} ry={ry + 0.6} fill="none" stroke="rgba(0,0,0,0.4)" strokeWidth="1" />
        <ellipse cx={cx} cy={cy} rx={rx} ry={ry} fill="none" stroke={trazo} strokeWidth="1.6" strokeDasharray="4 3" />
        {wall > 4 && (
          <ellipse cx={cx} cy={cy + wall} rx={rx} ry={ry} fill="none" stroke={trazo} strokeWidth="1.2" strokeDasharray="2 3" opacity="0.6" />
        )}
      </svg>
    );
  }

  if (tipo === 'otro') {
    return (
      <svg viewBox="0 0 64 64" className={className} aria-hidden="true">
        <circle cx="32" cy="32" r="20" fill="none" stroke="currentColor" strokeWidth="3" strokeDasharray="4 4" />
        <text x="32" y="41" textAnchor="middle" fontSize="24" fontWeight="700" fill="currentColor">
          ?
        </text>
      </svg>
    );
  }

  const rx = 26 * info.siluetaDiametroRelativo;
  const ry = rx * 0.42;
  const depth = 4 * info.siluetaProfundidadRelativa;
  const cy = 30;

  return (
    <svg viewBox="0 0 64 64" className={className} aria-hidden="true">
      {/* pared / profundidad del plato */}
      <path
        d={`M ${32 - rx} ${cy}
            A ${rx} ${ry} 0 0 0 ${32 + rx} ${cy}
            L ${32 + rx * 0.9} ${cy + depth}
            A ${rx * 0.9} ${ry * 0.9} 0 0 1 ${32 - rx * 0.9} ${cy + depth}
            Z`}
        fill="currentColor"
        opacity="0.18"
      />
      {/* borde superior (vista desde arriba) */}
      <ellipse cx="32" cy={cy} rx={rx} ry={ry} fill="none" stroke="currentColor" strokeWidth="3" />
      <ellipse cx="32" cy={cy} rx={rx * 0.66} ry={ry * 0.66} fill="none" stroke="currentColor" strokeWidth="1.5" opacity="0.5" />
    </svg>
  );
}

/**
 * NUT-158 — Selector de tipo de vajilla con guía visual calibrada por tipo.
 * Paso previo a la captura de foto en el flujo de reconocimiento por IA.
 */
export default function VajillaSelector({
  value,
  onSelect,
}: {
  value: VajillaTipo | null;
  onSelect: (tipo: VajillaTipo) => void;
}) {
  return (
    <div role="radiogroup" aria-label="Tipo de vajilla" className="grid grid-cols-2 gap-3">
      {VAJILLA_TIPOS.map((tipo) => {
        const info = getVajillaInfo(tipo);
        const selected = value === tipo;
        return (
          <button
            key={tipo}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => onSelect(tipo)}
            className={`flex flex-col items-center gap-2 rounded-2xl border p-3 text-center transition-colors focus:outline-none focus-visible:ring-2 ${
              selected ? 'border-transparent' : 'border-gray-200 hover:border-gray-300'
            }`}
            style={{
              backgroundColor: selected ? `${ACCENT}14` : '#fff',
              boxShadow: selected ? `0 0 0 2px ${ACCENT}` : undefined,
              ['--tw-ring-color' as string]: `${ACCENT}66`,
            }}
          >
            <span style={{ color: selected ? ACCENT : '#cbd5e1' }}>
              <VajillaGuia tipo={tipo} className="h-14 w-14" />
            </span>
            <span className="text-sm font-semibold text-gray-900">{info.label}</span>
            <span className="text-[11px] leading-tight text-gray-400">{info.descripcion}</span>
          </button>
        );
      })}
    </div>
  );
}
