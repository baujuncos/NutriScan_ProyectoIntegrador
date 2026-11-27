/**
 * Gráfico de líneas de la Evolución como SVG inline (sin librerías), en el mismo estilo que los del
 * informe. Todos comparten el eje de 12 meses: cada mes es una banda con su etiqueta centrada y el
 * punto de una medición cae dentro de la banda según el día (ver `posicionEnEje`).
 */
import { escalaEjeY, type EjeMeses, type SerieEvolucion } from '@/lib/researcher/antropometria/evolucion';
import { fmtFijo } from '@/lib/researcher/antropometria/formato';
import { fechaLegible } from '@/lib/researcher/antropometria/reglas';

const MARGEN_IZQ = 46;
const MARGEN_DER = 14;
const MARGEN_SUP = 18;
const MARGEN_INF = 40;
const ANCHO_MES = 42;
const ALTO = 240;

/** Color por serie: los mismos en la leyenda, la línea y los puntos. */
const COLORES: Record<string, string> = {
  peso: '#2563eb',
  suma6: '#d97706',
  adiposa: '#d97706',
  muscular: '#2563eb',
  osea: '#64748b',
  residual: '#16a34a',
  piel: '#9333ea',
};

interface Props {
  /** Identificador estable para los ids de accesibilidad. */
  id: string;
  titulo: string;
  unidad: 'kg' | 'mm';
  eje: EjeMeses;
  series: SerieEvolucion[];
}

export default function GraficoEvolucion({ id, titulo, unidad, eje, series }: Props) {
  const meses = eje.meses.length;
  const ancho = MARGEN_IZQ + meses * ANCHO_MES + MARGEN_DER;
  const escala = escalaEjeY(series.flatMap((s) => s.puntos.map((p) => p.valor)));
  const areaAlto = ALTO - MARGEN_SUP - MARGEN_INF;
  const px = (x: number) => MARGEN_IZQ + x * ANCHO_MES;
  const py = (v: number) => MARGEN_SUP + (1 - (v - escala.minimo) / (escala.maximo - escala.minimo)) * areaAlto;
  const unaSerie = series.length === 1;
  const mediciones = series[0]?.puntos ?? [];

  const resumen = series
    .map((s) => `${s.etiqueta}: ${s.puntos.map((p) => `Nº ${p.nro} ${fmtFijo(p.valor, s.decimales)}`).join(', ')}`)
    .join('. ');

  return (
    <figure className="min-w-0">
      <figcaption className="mb-1 text-sm font-semibold text-slate-900">
        {titulo} <span className="font-normal text-slate-600">({unidad})</span>
      </figcaption>
      <div className="overflow-x-auto">
        <svg
          viewBox={`0 0 ${ancho} ${ALTO}`}
          role="img"
          aria-labelledby={`${id}-titulo`}
          aria-describedby={`${id}-desc`}
          className="h-auto"
          style={{ width: '100%', minWidth: Math.round(ancho * 0.85) }}
        >
          <title id={`${id}-titulo`}>{`${titulo} (${unidad})`}</title>
          <desc id={`${id}-desc`}>{`Evolución mensual. ${resumen}`}</desc>

          {escala.ticks.map((t) => (
            <g key={t}>
              <line x1={MARGEN_IZQ} x2={ancho - MARGEN_DER} y1={py(t)} y2={py(t)} stroke="#e2e8f0" />
              <text x={MARGEN_IZQ - 6} y={py(t) + 3} textAnchor="end" fontSize={10} fill="#64748b">
                {fmtFijo(t, escala.decimales)}
              </text>
            </g>
          ))}
          <line x1={MARGEN_IZQ} x2={MARGEN_IZQ} y1={MARGEN_SUP} y2={ALTO - MARGEN_INF} stroke="#cbd5e1" />
          <line x1={MARGEN_IZQ} x2={ancho - MARGEN_DER} y1={ALTO - MARGEN_INF} y2={ALTO - MARGEN_INF} stroke="#94a3b8" />

          {eje.meses.map((m, i) => (
            <g key={`${m.anio}-${m.mes}`}>
              <line x1={px(i + 1)} x2={px(i + 1)} y1={ALTO - MARGEN_INF} y2={ALTO - MARGEN_INF + 4} stroke="#94a3b8" />
              <text x={px(i + 0.5)} y={ALTO - MARGEN_INF + 16} textAnchor="middle" fontSize={10} fill="#334155">
                {m.etiqueta}
              </text>
              {m.mostrarAnio && (
                <text x={px(i + 0.5)} y={ALTO - MARGEN_INF + 29} textAnchor="middle" fontSize={9} fontWeight={600} fill="#64748b">
                  {m.anio}
                </text>
              )}
            </g>
          ))}

          {series.map((s) => {
            const color = COLORES[s.clave];
            return (
              <g key={s.clave}>
                {s.puntos.length > 1 && (
                  <polyline
                    points={s.puntos.map((p) => `${px(p.x)},${py(p.valor)}`).join(' ')}
                    fill="none"
                    stroke={color}
                    strokeWidth={2}
                    strokeLinejoin="round"
                    strokeLinecap="round"
                  />
                )}
                {s.puntos.map((p) => (
                  <g key={p.nro}>
                    <circle cx={px(p.x)} cy={py(p.valor)} r={4} fill={color} stroke="#fff" strokeWidth={1.5} />
                    {unaSerie && (
                      <text x={px(p.x)} y={py(p.valor) - 9} textAnchor="middle" fontSize={10} fontWeight={600} fill="#0f172a">
                        {fmtFijo(p.valor, s.decimales)}
                      </text>
                    )}
                  </g>
                ))}
              </g>
            );
          })}
        </svg>
      </div>

      {!unaSerie && (
        <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-700">
          {series.map((s) => (
            <li key={s.clave} className="flex items-center gap-1.5">
              <span aria-hidden="true" className="inline-block h-0.5 w-4 rounded" style={{ backgroundColor: COLORES[s.clave] }} />
              {s.etiqueta}
            </li>
          ))}
        </ul>
      )}

      <table className="sr-only">
        <caption>{`${titulo}: valores de cada medición`}</caption>
        <thead>
          <tr>
            <th scope="col">Medición</th>
            <th scope="col">Fecha</th>
            {series.map((s) => (
              <th key={s.clave} scope="col">{`${s.etiqueta} (${s.unidad})`}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {mediciones.map((p, i) => (
            <tr key={p.nro}>
              <th scope="row">{`Nº ${p.nro}`}</th>
              <td>{fechaLegible(p.fecha)}</td>
              {series.map((s) => (
                <td key={s.clave}>{fmtFijo(s.puntos[i].valor, s.decimales)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}
