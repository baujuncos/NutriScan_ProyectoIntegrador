/**
 * Gráficos del informe como SVG inline (sin librerías): se imprimen nítidos y no pesan.
 */
import { fmtConSigno, fmtFijo } from '@/lib/researcher/antropometria/formato';
import type { BarraPhantom } from '@/lib/researcher/antropometria/informe';

/** Z con signo explícito: "+0,52" / "−0,31". */
export function fmtZ(z: number | null | undefined): string {
  return fmtConSigno(z, 2);
}

const Z_MAX = 3;
const ANCHO_ETIQUETA = 150;
const ANCHO_AREA = 230;
const ALTO_FILA = 24;
const AZUL = '#2563eb';
const AMBAR = '#d97706';

/** Barras horizontales de Z Phantom por variable, con el 0 en el centro y eje de −3 a +3. */
export function GraficoPhantom({ titulo, barras }: { titulo: string; barras: BarraPhantom[] }) {
  const alto = barras.length * ALTO_FILA + 28;
  const ancho = ANCHO_ETIQUETA + ANCHO_AREA + 44;
  const cero = ANCHO_ETIQUETA + ANCHO_AREA / 2;
  const escala = ANCHO_AREA / 2 / Z_MAX;

  return (
    <figure className="break-inside-avoid">
      <figcaption className="mb-1 text-sm font-semibold text-slate-900">{titulo}</figcaption>
      <svg
        viewBox={`0 0 ${ancho} ${alto}`}
        role="img"
        aria-label={`${titulo}: ${barras.map((b) => `${b.etiqueta} ${fmtZ(b.z)}`).join(', ')}`}
        className="h-auto w-full max-w-xl"
      >
        {[-3, -2, -1, 0, 1, 2, 3].map((t) => (
          <g key={t}>
            <line x1={cero + t * escala} x2={cero + t * escala} y1={0} y2={alto - 18} stroke={t === 0 ? '#475569' : '#e2e8f0'} strokeWidth={t === 0 ? 1.5 : 1} />
            <text x={cero + t * escala} y={alto - 5} textAnchor="middle" fontSize={10} fill="#64748b">
              {t}
            </text>
          </g>
        ))}
        {barras.map((b, i) => {
          const zAcotado = Math.max(-Z_MAX, Math.min(Z_MAX, b.z));
          const largo = Math.abs(zAcotado) * escala;
          const y = i * ALTO_FILA + 4;
          return (
            <g key={b.clave}>
              <text x={ANCHO_ETIQUETA - 6} y={y + 12} textAnchor="end" fontSize={11} fill="#334155">
                {b.etiqueta}
              </text>
              <rect x={zAcotado >= 0 ? cero : cero - largo} y={y} width={Math.max(largo, 1)} height={16} rx={2} fill={b.z >= 0 ? AZUL : AMBAR} />
              <text x={ancho - 2} y={y + 12} textAnchor="end" fontSize={11} fontWeight={600} fill="#0f172a">
                {fmtZ(b.z)}
              </text>
            </g>
          );
        })}
      </svg>
    </figure>
  );
}

export interface PuntoSomatocarta {
  etiqueta: string;
  x: number;
  y: number;
  tipo: 'actual' | 'anterior' | 'deporte';
}

const X_MIN = -8;
const X_MAX = 8;
const Y_MIN = -10;
const Y_MAX = 16;
const LADO = 360;
const MARGEN = 28;

const px = (x: number) => MARGEN + ((Math.max(X_MIN, Math.min(X_MAX, x)) - X_MIN) / (X_MAX - X_MIN)) * (LADO - 2 * MARGEN);
const py = (y: number) => LADO - MARGEN - ((Math.max(Y_MIN, Math.min(Y_MAX, y)) - Y_MIN) / (Y_MAX - Y_MIN)) * (LADO - 2 * MARGEN);

/**
 * Somatocarta: eje X = ectomorfia − endomorfia, eje Y = 2 × mesomorfia − (endomorfia + ectomorfia).
 * Dibuja ejes, grilla y los puntos (actual, anterior y deporte). El contorno clásico de la carta no se dibuja.
 */
export function Somatocarta({ puntos }: { puntos: PuntoSomatocarta[] }) {
  return (
    <figure className="break-inside-avoid">
      <figcaption className="mb-1 text-sm font-semibold text-slate-900">Somatocarta</figcaption>
      <svg
        viewBox={`0 0 ${LADO} ${LADO}`}
        role="img"
        aria-label={`Somatocarta. ${puntos.map((p) => `${p.etiqueta}: X ${fmtFijo(p.x, 2)}, Y ${fmtFijo(p.y, 2)}`).join('. ')}`}
        className="h-auto w-full max-w-sm"
      >
        <rect x={MARGEN} y={MARGEN} width={LADO - 2 * MARGEN} height={LADO - 2 * MARGEN} fill="#f8fafc" stroke="#cbd5e1" />
        {[-8, -6, -4, -2, 0, 2, 4, 6, 8].map((t) => (
          <g key={`x${t}`}>
            <line x1={px(t)} x2={px(t)} y1={MARGEN} y2={LADO - MARGEN} stroke={t === 0 ? '#475569' : '#e2e8f0'} strokeWidth={t === 0 ? 1.5 : 1} />
            <text x={px(t)} y={LADO - MARGEN + 12} textAnchor="middle" fontSize={9} fill="#64748b">
              {t}
            </text>
          </g>
        ))}
        {[-10, -6, -2, 0, 2, 6, 10, 14].map((t) => (
          <g key={`y${t}`}>
            <line y1={py(t)} y2={py(t)} x1={MARGEN} x2={LADO - MARGEN} stroke={t === 0 ? '#475569' : '#e2e8f0'} strokeWidth={t === 0 ? 1.5 : 1} />
            <text x={MARGEN - 4} y={py(t) + 3} textAnchor="end" fontSize={9} fill="#64748b">
              {t}
            </text>
          </g>
        ))}
        <text x={LADO / 2} y={LADO - 4} textAnchor="middle" fontSize={10} fill="#334155">
          ← Endomorfia · X · Ectomorfia →
        </text>
        <text x={8} y={LADO / 2} fontSize={10} fill="#334155" transform={`rotate(-90 8 ${LADO / 2})`} textAnchor="middle">
          Mesomorfia · Y
        </text>
        {puntos.map((p) => {
          const cx = px(p.x);
          const cy = py(p.y);
          if (p.tipo === 'actual') return <circle key={p.etiqueta} cx={cx} cy={cy} r={7} fill={AZUL} stroke="#fff" strokeWidth={2} />;
          if (p.tipo === 'anterior') return <circle key={p.etiqueta} cx={cx} cy={cy} r={6} fill="#fff" stroke="#64748b" strokeWidth={2} />;
          return <rect key={p.etiqueta} x={cx - 6} y={cy - 6} width={12} height={12} fill="#16a34a" stroke="#fff" strokeWidth={2} transform={`rotate(45 ${cx} ${cy})`} />;
        })}
      </svg>
      <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-700">
        {puntos.map((p) => (
          <li key={p.etiqueta} className="flex items-center gap-1.5">
            <span
              aria-hidden="true"
              className={`inline-block h-3 w-3 ${p.tipo === 'actual' ? 'rounded-full bg-blue-600' : p.tipo === 'anterior' ? 'rounded-full border-2 border-slate-500 bg-white' : 'rotate-45 bg-green-600'}`}
            />
            {p.etiqueta}
          </li>
        ))}
      </ul>
    </figure>
  );
}

/** Barra del peso ideal con su rango (±10 %) y el peso medido marcado encima. */
export function BarraPesoIdeal({ minimo, maximo, ideal, medido }: { minimo: number; maximo: number; ideal: number; medido: number }) {
  const desde = Math.min(minimo, medido) - 5;
  const hasta = Math.max(maximo, medido) + 5;
  const pct = (v: number) => `${((v - desde) / (hasta - desde)) * 100}%`;
  return (
    <div
      role="img"
      aria-label={`Peso medido ${fmtFijo(medido, 1)} kg; peso ideal ${fmtFijo(ideal, 1)} kg, rango de ${fmtFijo(minimo, 1)} a ${fmtFijo(maximo, 1)} kg`}
      className="relative mt-6 h-3 w-full rounded-full bg-slate-200"
    >
      <div className="absolute inset-y-0 rounded-full bg-green-300" style={{ left: pct(minimo), width: `calc(${pct(maximo)} - ${pct(minimo)})` }} />
      <div className="absolute -top-5 -translate-x-1/2 text-xs font-semibold text-slate-900" style={{ left: pct(medido) }}>
        {fmtFijo(medido, 1)} kg
      </div>
      <div className="absolute -top-1 h-5 w-1 -translate-x-1/2 rounded bg-blue-700" style={{ left: pct(medido) }} />
    </div>
  );
}
