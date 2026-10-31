/**
 * NUT-241/242/243 — Informe en pantalla con la paciente ficticia "Julieta" (valores ancla de la planilla).
 */
import { fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { calcularAntropometria, compararMediciones } from '@/lib/antropometria';
import { ENTRADA_JULIETA, SERIES_JULIETA } from './fixtures/antropometria';

import AccionesInforme from '@/app/(researcher)/antropometrias/medicion/[medicionId]/AccionesInforme';
import { fmtZ, GraficoPhantom, Somatocarta } from '@/app/(researcher)/antropometrias/medicion/[medicionId]/GraficosInforme';
import InformeParte1 from '@/app/(researcher)/antropometrias/medicion/[medicionId]/InformeParte1';
import InformeParte2 from '@/app/(researcher)/antropometrias/medicion/[medicionId]/InformeParte2';

const actual = calcularAntropometria(ENTRADA_JULIETA);
const anterior = calcularAntropometria({
  ...ENTRADA_JULIETA,
  fechaMedicion: '2026-09-20',
  series: { ...SERIES_JULIETA, peso: [54.1, 54.1] },
});

describe('InformeParte1', () => {
  it('muestra las masas ancla (adiposa 17,64 kg y muscular 21,26 kg) con coma decimal', () => {
    render(<InformeParte1 resultado={actual} comparacion={null} fechaAnterior={null} />);
    expect(within(screen.getByRole('row', { name: /Masa adiposa/ })).getByText('17,64')).toBeInTheDocument();
    expect(within(screen.getByRole('row', { name: /Masa muscular/ })).getByText('21,26')).toBeInTheDocument();
  });

  it('muestra el banner de calidad con el % de diferencia, como dato informativo', () => {
    render(<InformeParte1 resultado={actual} comparacion={null} fechaAnterior={null} />);
    const banner = screen.getByRole('note');
    expect(banner).toHaveTextContent('Control de calidad');
    expect(banner).toHaveTextContent(/diferencia de .* %/);
    expect(banner).toHaveTextContent('Es un dato informativo');
  });

  it('lista las 25 variables y el Z Phantom con signo; la talla no tiene Z', () => {
    render(<InformeParte1 resultado={actual} comparacion={null} fechaAnterior={null} />);
    const filaTalla = screen.getByRole('row', { name: /Talla corporal/ });
    expect(within(filaTalla).getAllByText('—').length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByRole('row', { name: /\((kg|cm|mm)\)/ })).toHaveLength(25);
  });

  it('sin medición anterior no hay columna de diferencias', () => {
    render(<InformeParte1 resultado={actual} comparacion={null} fechaAnterior={null} />);
    expect(screen.queryByRole('columnheader', { name: 'Δ' })).not.toBeInTheDocument();
    expect(screen.queryByRole('columnheader', { name: 'Δ kg' })).not.toBeInTheDocument();
  });

  it('con medición anterior compara actual − anterior y cita su fecha', () => {
    render(<InformeParte1 resultado={actual} comparacion={compararMediciones(actual, anterior)} fechaAnterior="2026-09-20" />);
    expect(screen.getByText(/medición del 20\/09\/2026/)).toBeInTheDocument();
    // peso 53,05 − 54,1 = −1,05
    expect(within(screen.getByRole('row', { name: /Peso bruto/ })).getByText('−1,05')).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Δ kg' })).toBeInTheDocument();
  });

  it('aclara la diferencia con la planilla en el Z del muslo medial', () => {
    render(<InformeParte1 resultado={actual} comparacion={null} fechaAnterior={null} />);
    expect(screen.getByText(/muslo medial usa el valor ajustado por talla/)).toBeInTheDocument();
  });
});

describe('InformeParte2', () => {
  it('muestra el somatotipo ancla 2,8 – 3,6 – 3,3 y el IMC 19,8', () => {
    render(<InformeParte2 resultado={actual} anterior={null} nivelActividad="moderada" />);
    expect(within(screen.getByText('Endomorfia').closest('div')!).getByText('2,8')).toBeInTheDocument();
    expect(within(screen.getByText('Mesomorfia').closest('div')!).getByText('3,6')).toBeInTheDocument();
    expect(within(screen.getByText('Ectomorfia').closest('div')!).getByText('3,3')).toBeInTheDocument();
    expect(within(screen.getByText('IMC').closest('div')!).getByText('19,8 kg/m²')).toBeInTheDocument();
  });

  it('compara con el deporte elegido (voleibol, valores por id exacto: 3,0 · 3,5 · 3,5)', () => {
    render(<InformeParte2 resultado={actual} anterior={null} nivelActividad="moderada" />);
    expect(screen.getByText('Comparación con el deporte')).toBeInTheDocument();
    expect(screen.getByText('3,0 · 3,5 · 3,5')).toBeInTheDocument();
  });

  it('sin deporte avisa que no hay comparación', () => {
    const sinDeporte = calcularAntropometria({ ...ENTRADA_JULIETA, deporte: null });
    render(<InformeParte2 resultado={sinDeporte} anterior={null} nivelActividad="moderada" />);
    expect(screen.queryByText('Comparación con el deporte')).not.toBeInTheDocument();
    expect(screen.getByText(/no incluye comparación/)).toBeInTheDocument();
  });

  it('gasto energético con peso ideal, metabolismo basal, factor y total', () => {
    render(<InformeParte2 resultado={actual} anterior={null} nivelActividad="moderada" />);
    expect(screen.getByText('Peso ideal', { selector: 'dt' })).toBeInTheDocument();
    expect(screen.getByText(/Metabolismo basal/)).toBeInTheDocument();
    expect(screen.getByText(/Factor de actividad \(Moderada\)/)).toBeInTheDocument();
    expect(screen.getByText('Gasto energético total')).toBeInTheDocument();
  });

  it('ICC con su nivel de riesgo e índices', () => {
    render(<InformeParte2 resultado={actual} anterior={null} nivelActividad="moderada" />);
    expect(screen.getByText(/ICC \(cintura\/cadera\)/)).toBeInTheDocument();
    expect(screen.getByText(/Superficie corporal$/)).toBeInTheDocument();
  });

  it('dibuja la somatocarta con la medición anterior cuando existe', () => {
    render(<InformeParte2 resultado={actual} anterior={anterior} nivelActividad="moderada" />);
    expect(screen.getByText('Medición anterior')).toBeInTheDocument();
    expect(screen.getByText('Medición actual')).toBeInTheDocument();
    expect(screen.getByText(/Referencia: /)).toBeInTheDocument();
  });

  it('un gráfico Phantom por grupo, accesibles por texto', () => {
    render(<InformeParte2 resultado={actual} anterior={null} nivelActividad="moderada" />);
    expect(screen.getByRole('img', { name: /Diámetros \(Z Phantom\).*Biacromial/ })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: /Perímetros \(Z Phantom\)/ })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: /Pliegues \(Z Phantom\).*Tríceps/ })).toBeInTheDocument();
  });
});

describe('gráficos', () => {
  it('fmtZ: signo explícito, decimales fijos y guion para vacíos', () => {
    expect(fmtZ(0.523)).toBe('+0,52');
    expect(fmtZ(-0.314)).toBe('−0,31');
    expect(fmtZ(1)).toBe('+1,00');
    expect(fmtZ(0)).toBe('0,00');
    expect(fmtZ(-0.001)).toBe('0,00');
    expect(fmtZ(null)).toBe('—');
    expect(fmtZ(Number.NaN)).toBe('—');
  });

  it('un Z fuera de escala no rompe el gráfico (se acota a ±3 pero se informa el valor real)', () => {
    render(<GraficoPhantom titulo="Prueba" barras={[{ clave: 'peso', etiqueta: 'Peso bruto', z: 7.5 }]} />);
    expect(screen.getByRole('img', { name: /Peso bruto \+7,50/ })).toBeInTheDocument();
  });

  it('la somatocarta acepta puntos fuera del rango sin lanzar', () => {
    render(<Somatocarta puntos={[{ etiqueta: 'Extremo', x: 99, y: -99, tipo: 'actual' }]} />);
    expect(screen.getByRole('img', { name: /Extremo: X 99,/ })).toBeInTheDocument();
  });
});

describe('AccionesInforme — exportar PDF', () => {
  afterEach(() => vi.restoreAllMocks());

  it('pone paciente + fecha como título mientras imprime y lo restaura después', () => {
    const imprimir = vi.spyOn(window, 'print').mockImplementation(() => {
      expect(document.title).toBe('Marchetti_Julieta_2026-10-24');
    });
    document.title = 'NutriScan';
    render(<AccionesInforme nombreArchivo="Marchetti_Julieta_2026-10-24" hrefEditar="/antropometrias/medicion/x/editar" />);

    fireEvent.click(screen.getByRole('button', { name: 'Exportar PDF' }));

    expect(imprimir).toHaveBeenCalledTimes(1);
    fireEvent(window, new Event('afterprint'));
    expect(document.title).toBe('NutriScan');
  });

  it('enlaza a la edición de la medición', () => {
    render(<AccionesInforme nombreArchivo="x" hrefEditar="/antropometrias/medicion/x/editar" />);
    expect(screen.getByRole('link', { name: 'Editar' })).toHaveAttribute('href', '/antropometrias/medicion/x/editar');
  });
});
