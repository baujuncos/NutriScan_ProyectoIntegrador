import type { ResultadoAntropometria } from '@/lib/antropometria';
import { FACTORES_ACTIVIDAD } from '@/lib/antropometria/datos/actividad';
import { fmtFijo } from '@/lib/researcher/antropometria/formato';
import { barrasPhantom, ETIQUETA_RIESGO } from '@/lib/researcher/antropometria/informe';
import type { NivelActividad } from '@/lib/antropometria';
import { BarraPesoIdeal, GraficoPhantom, Somatocarta, type PuntoSomatocarta } from './GraficosInforme';

interface Props {
  resultado: ResultadoAntropometria;
  /** Resultado de la medición anterior (para dibujarla en la somatocarta); null si no hay. */
  anterior: ResultadoAntropometria | null;
  nivelActividad: NivelActividad;
}

const FILA = 'flex items-baseline justify-between gap-4 border-b border-slate-100 py-1.5 text-sm last:border-0';

function Dato({ etiqueta, valor }: { etiqueta: string; valor: string }) {
  return (
    <div className={FILA}>
      <dt className="text-slate-600">{etiqueta}</dt>
      <dd className="text-right font-medium tabular-nums text-slate-900">{valor}</dd>
    </div>
  );
}

/** Parte 2: Phantom, somatotipo y somatocarta, comparación con el deporte, energía, peso ideal e índices. */
export default function InformeParte2({ resultado, anterior, nivelActividad }: Props) {
  const barras = barrasPhantom(resultado);
  const { somatotipo, comparacionDeporte: deporte, energia, indices, edad } = resultado;
  const peso = resultado.calidad.pesoBrutoKg;

  const puntos: PuntoSomatocarta[] = [{ etiqueta: 'Medición actual', x: somatotipo.x, y: somatotipo.y, tipo: 'actual' }];
  if (anterior) puntos.push({ etiqueta: 'Medición anterior', x: anterior.somatotipo.x, y: anterior.somatotipo.y, tipo: 'anterior' });
  if (deporte) puntos.push({ etiqueta: `Referencia: ${deporte.nombre}`, x: deporte.x, y: deporte.y, tipo: 'deporte' });

  const distancia = deporte ? Math.hypot(somatotipo.x - deporte.x, somatotipo.y - deporte.y) : null;
  const rango = `${fmtFijo(energia.rangoPesoIdeal.minimo, 1)} a ${fmtFijo(energia.rangoPesoIdeal.maximo, 1)} kg`;

  return (
    <section aria-labelledby="parte-2" className="space-y-8">
      <h2 id="parte-2" className="text-lg font-bold text-slate-900">
        Parte 2 · Gráficos, somatotipo y gasto energético
      </h2>

      <div className="grid gap-6 lg:grid-cols-2 print:grid-cols-2">
        <GraficoPhantom titulo="Diámetros (Z Phantom)" barras={barras.diametros} />
        <GraficoPhantom titulo="Perímetros (Z Phantom)" barras={barras.perimetros} />
        <GraficoPhantom titulo="Pliegues (Z Phantom)" barras={barras.pliegues} />
        <GraficoPhantom titulo="Peso y talla sentado (Z Phantom)" barras={barras.basicas} />
      </div>

      <div className="grid gap-6 lg:grid-cols-2 print:grid-cols-2">
        <div className="break-inside-avoid space-y-3">
          <h3 className="text-sm font-semibold text-slate-900">Somatotipo (Heath-Carter)</h3>
          <dl>
            <Dato etiqueta="Endomorfia" valor={fmtFijo(somatotipo.endomorfia, 1)} />
            <Dato etiqueta="Mesomorfia" valor={fmtFijo(somatotipo.mesomorfia, 1)} />
            <Dato etiqueta="Ectomorfia" valor={fmtFijo(somatotipo.ectomorfia, 1)} />
            <Dato etiqueta="Somatocarta X · Y" valor={`${fmtFijo(somatotipo.x, 2)} · ${fmtFijo(somatotipo.y, 2)}`} />
          </dl>
          {deporte ? (
            <div>
              <h4 className="text-sm font-semibold text-slate-900">Comparación con el deporte</h4>
              <dl>
                <Dato etiqueta="Deporte de referencia" valor={deporte.nombre} />
                <Dato
                  etiqueta="Endo · Meso · Ecto de referencia"
                  valor={`${fmtFijo(deporte.endomorfia, 1)} · ${fmtFijo(deporte.mesomorfia, 1)} · ${fmtFijo(deporte.ectomorfia, 1)}`}
                />
                <Dato etiqueta="Distancia en la somatocarta" valor={fmtFijo(distancia ?? NaN, 2)} />
              </dl>
            </div>
          ) : (
            <p className="text-xs text-slate-600">No se eligió un deporte: el informe no incluye comparación.</p>
          )}
        </div>
        <Somatocarta puntos={puntos} />
      </div>

      <div className="grid gap-6 lg:grid-cols-2 print:grid-cols-2">
        <div className="break-inside-avoid space-y-1">
          <h3 className="text-sm font-semibold text-slate-900">Gasto energético</h3>
          <dl>
            <Dato etiqueta="Peso ideal" valor={`${fmtFijo(energia.pesoIdeal, 1)} kg`} />
            <Dato etiqueta="Diferencia con el peso ideal" valor={`${fmtFijo(energia.diferenciaConIdeal, 1)} kg`} />
            <Dato etiqueta="Ajuste por sobrepeso (25 %)" valor={`${fmtFijo(energia.ajusteSobrepeso, 1)} kg`} />
            <Dato etiqueta="Peso para el cálculo" valor={`${fmtFijo(energia.pesoUsadoEnMetabolismo, 1)} kg`} />
            <Dato etiqueta="Metabolismo basal (Harris-Benedict)" valor={`${fmtFijo(energia.metabolismoBasal, 0)} kcal/día`} />
            <Dato etiqueta={`Factor de actividad (${FACTORES_ACTIVIDAD[nivelActividad].categoria})`} valor={fmtFijo(energia.factorActividad, 1)} />
            <Dato etiqueta="Gasto energético total" valor={`${fmtFijo(energia.gastoEnergeticoTotal, 0)} kcal/día`} />
          </dl>
        </div>

        <div className="break-inside-avoid space-y-1">
          <h3 className="text-sm font-semibold text-slate-900">Peso ideal</h3>
          <p className="text-xs text-slate-600">Rango saludable: {rango} (peso ideal ± 10 %).</p>
          <BarraPesoIdeal minimo={energia.rangoPesoIdeal.minimo} maximo={energia.rangoPesoIdeal.maximo} ideal={energia.pesoIdeal} medido={peso} />
        </div>
      </div>

      <div className="break-inside-avoid">
        <h3 className="mb-1 text-sm font-semibold text-slate-900">Índices</h3>
        <dl className="grid gap-x-8 sm:grid-cols-2 print:grid-cols-2">
          <Dato etiqueta="IMC" valor={`${fmtFijo(indices.imc, 1)} kg/m²`} />
          <Dato
            etiqueta={`ICC (cintura/cadera) · riesgo${indices.riesgoIcc.bandaExtrapolada ? ' (banda más cercana)' : ''}`}
            valor={`${fmtFijo(indices.icc, 2)} · ${ETIQUETA_RIESGO[indices.riesgoIcc.nivel]}`}
          />
          <Dato etiqueta="Suma de 6 pliegues" valor={`${fmtFijo(indices.sumaSeisPliegues, 1)} mm`} />
          <Dato etiqueta="Índice músculo/óseo" valor={fmtFijo(indices.indiceMusculoOseo, 2)} />
          <Dato etiqueta="Índice adiposo/muscular" valor={fmtFijo(indices.indiceAdiposoMuscular, 2)} />
          <Dato etiqueta="Talla sentado / talla" valor={fmtFijo(indices.tallaSentadoTalla, 3)} />
          <Dato etiqueta="Superficie corporal" valor={`${fmtFijo(indices.superficieCorporal, 2)} m²`} />
          <Dato etiqueta="Superficie corporal / peso" valor={`${fmtFijo(indices.superficieCorporalPorPeso, 1)} cm²/kg`} />
        </dl>
        <p className="mt-2 text-xs text-slate-600">Edad a la medición: {edad.anios} años.</p>
      </div>
    </section>
  );
}
