/**
 * NUT-151 — Resumen descargable (.md) para mejorar el prompt: estadísticas, secciones, filtros,
 * casos, advertencias y que no filtre datos personales. Datos de prueba, sin I/O.
 */
import { describe, expect, it } from 'vitest';
import type { ItemMetrica } from '@/lib/metricasIa';
import {
  MIN_MUESTRA,
  calibracionConfianza,
  casosDestacados,
  confusionesNombre,
  construirResumenMd,
  lineaCaso,
  nombreArchivoResumen,
  resumenGeneral,
  sesgoPesoPorAlimento,
  sesgoPesoPorVajilla,
  valorFinal,
  type EntradaResumen,
} from '@/lib/resumenMetricasMd';
import { defaultsMetricas } from '@/lib/metricasIaQuery';
import { UMBRAL_CONFIANZA_BAJA, UMBRAL_DIFERENCIA_PESO } from '@/lib/revisionIa';

let n = 0;
const item = (over: Partial<ItemMetrica> = {}): ItemMetrica => ({
  alimento: 'Empanada',
  alimento_norm: 'empanada',
  confidence: 0.9,
  gramos_ia: 100,
  gramos_usuario: 100,
  motivos_revision: [],
  estado_revision: null,
  prompt_version: 'nut166-v1',
  created_at: `2026-10-${String(1 + (n++ % 25)).padStart(2, '0')}T12:00:00Z`,
  candidato_ejemplo: false,
  vajilla_tipo: 'plato_playo',
  vajilla_diametro_cm: 26,
  angulo_captura_grados: 35,
  alimento_usuario: 'Empanada',
  origen_usuario: 'ai',
  nutricionista_alimento: null,
  nutricionista_gramos: null,
  ...over,
});

const entrada = (items: ItemMetrica[], over: Partial<EntradaResumen> = {}): EntradaResumen => ({
  items,
  itemsTodasLasVersiones: items,
  noDetectados: [],
  params: { ...defaultsMetricas(), desde: '2026-10-01', hasta: '2026-10-31' },
  prompt: { version: 'nut166-v1', texto: 'Sos el módulo de reconocimiento visual de NutriScan.' },
  generadoEn: new Date('2026-10-22T15:00:00Z'),
  ...over,
});

describe('valorFinal', () => {
  it('si el investigador corrigió, su valor es la verdad; si no, lo que dejó el deportista', () => {
    const corregido = item({ estado_revision: 'corregido', nutricionista_alimento: 'Empanada de carne', nutricionista_gramos: 130, alimento_usuario: 'Empanada (pollo)', gramos_usuario: 110 });
    expect(valorFinal(corregido)).toEqual({ nombre: 'Empanada de carne', gramos: 130, fuente: 'investigador' });
    expect(valorFinal(item({ alimento_usuario: 'Empanada (pollo)', gramos_usuario: 110 }))).toEqual({ nombre: 'Empanada (pollo)', gramos: 110, fuente: 'deportista' });
  });

  it('un campo no corregido por el investigador cae al del deportista', () => {
    const soloPeso = item({ estado_revision: 'corregido', nutricionista_alimento: null, nutricionista_gramos: 150, alimento_usuario: 'Tarta', gramos_usuario: 110 });
    expect(valorFinal(soloPeso)).toEqual({ nombre: 'Tarta', gramos: 150, fuente: 'investigador' });
  });
});

describe('resumenGeneral', () => {
  it('calcula las tasas de nombre, peso, quitado, corrección total y confianza baja', () => {
    const g = resumenGeneral([
      item({ motivos_revision: ['cambio_alimento'] }),
      item({ motivos_revision: ['correccion_peso_grande'] }),
      item({ motivos_revision: ['item_quitado'], alimento_usuario: null, gramos_usuario: null }),
      item({ motivos_revision: ['confianza_baja'], confidence: 0.4 }),
    ]);
    expect(g).toMatchObject({ detecciones: 4, tasaNombre: 0.25, tasaPeso: 0.25, tasaQuitado: 0.25, tasaCorreccion: 0.75, tasaConfianzaBaja: 0.25 });
  });

  it('sin datos no rompe', () => {
    expect(resumenGeneral([])).toMatchObject({ detecciones: 0, tasaCorreccion: 0, confianzaPromedio: 0 });
  });
});

describe('calibracionConfianza', () => {
  it('agrupa por tramo de confianza y calcula la tasa de corrección de cada uno', () => {
    const c = calibracionConfianza([
      item({ confidence: 0.3, motivos_revision: ['cambio_alimento'] }),
      item({ confidence: 0.5 }),
      item({ confidence: 0.8, motivos_revision: ['correccion_peso_grande'] }),
      item({ confidence: 0.95, motivos_revision: ['cambio_alimento'] }),
      item({ confidence: 0.99 }),
    ]);
    expect(c.map((f) => f.detecciones)).toEqual([2, 0, 1, 2]);
    expect(c[0].tasaCorreccion).toBe(0.5);
    expect(c[3].tasaCorreccion).toBe(0.5);
  });
});

describe('sesgo de peso', () => {
  const con = (final: number, over: Partial<ItemMetrica> = {}) => item({ gramos_usuario: final, ...over });

  it('error relativo con signo: positivo = la IA subestima; y % de casos en que subestima', () => {
    const s = sesgoPesoPorAlimento([con(150), con(150), con(120)]);
    expect(s).toHaveLength(1);
    expect(s[0].sesgoMedio).toBeCloseTo((0.5 + 0.5 + 0.2) / 3);
    expect(s[0].subestima).toBe(1);
    expect(s[0].errorAbsolutoMedio).toBeCloseTo(0.4);
  });

  it('sobreestimar da signo negativo', () => {
    expect(sesgoPesoPorAlimento([con(50), con(60), con(80)])[0].sesgoMedio).toBeLessThan(0);
  });

  it('ignora los quitados y los alimentos con menos de 3 detecciones con peso', () => {
    expect(sesgoPesoPorAlimento([con(150), con(150)])).toEqual([]);
    const s = sesgoPesoPorAlimento([con(150), con(150), con(150), item({ motivos_revision: ['item_quitado'], alimento_usuario: null, gramos_usuario: null })]);
    expect(s[0].detecciones).toBe(3);
  });

  it('usa el peso del investigador cuando corrigió', () => {
    const corregido = (g: number) => con(100, { estado_revision: 'corregido', nutricionista_gramos: g });
    expect(sesgoPesoPorAlimento([corregido(200), corregido(200), corregido(200)])[0].sesgoMedio).toBeCloseTo(1);
  });

  it('por vajilla, con el nombre legible', () => {
    const s = sesgoPesoPorVajilla([con(150), con(150, { vajilla_tipo: 'plato_hondo' }), con(80, { vajilla_tipo: 'plato_hondo' })]);
    expect(s.map((x) => x.clave).sort()).toEqual(['plato hondo', 'plato playo']);
  });
});

describe('confusionesNombre', () => {
  it('cuenta los pares "la IA dijo → era" más frecuentes, con la confianza promedio', () => {
    const c = confusionesNombre([
      item({ alimento: 'Crema chantilly', alimento_norm: 'crema chantilly', alimento_usuario: 'Yogur griego', motivos_revision: ['cambio_alimento'], confidence: 0.9 }),
      item({ alimento: 'Crema chantilly', alimento_norm: 'crema chantilly', alimento_usuario: 'Yogur griego', motivos_revision: ['cambio_alimento'], confidence: 0.8 }),
      item({ alimento: 'Pollo', alimento_norm: 'pollo', alimento_usuario: 'Pavo', motivos_revision: ['cambio_alimento'], confidence: 0.7 }),
      item({ motivos_revision: [] }),
    ]);
    expect(c[0]).toMatchObject({ ia: 'Crema chantilly', final: 'Yogur griego', veces: 2 });
    expect(c[0].confianzaPromedio).toBeCloseTo(0.85);
    expect(c).toHaveLength(2);
  });

  it('usa el nombre del investigador cuando corrigió', () => {
    const c = confusionesNombre([item({ alimento: 'Pollo', alimento_norm: 'pollo', alimento_usuario: 'Pavo', estado_revision: 'corregido', nutricionista_alimento: 'Pechuga de pollo', motivos_revision: ['cambio_alimento'] })]);
    expect(c[0].final).toBe('Pechuga de pollo');
  });
});

describe('casosDestacados y lineaCaso', () => {
  it('separa los marcados como "Ejemplo para la IA" de los demás y no los repite', () => {
    const marcado = item({ candidato_ejemplo: true, motivos_revision: ['cambio_alimento'], confidence: 0.95 });
    const peso = item({ motivos_revision: ['correccion_peso_grande'], gramos_usuario: 300, confidence: 0.5 });
    const confiado = item({ motivos_revision: ['cambio_alimento'], confidence: 0.92 });
    const c = casosDestacados([marcado, peso, confiado]);
    expect(c.ejemplos).toEqual([marcado]);
    expect(c.mayoresErroresDePeso).toEqual([peso]);
    expect(c.confiadosYEquivocados).toEqual([confiado]);
  });

  it('describe IA → Deportista → Equipo, con el contexto de captura', () => {
    const l = lineaCaso(item({ alimento: 'Empanada', gramos_ia: 110, confidence: 0.54, alimento_usuario: 'Empanada (pollo)', gramos_usuario: 160, estado_revision: 'corregido', nutricionista_alimento: 'Empanada de pollo', nutricionista_gramos: 150, motivos_revision: ['correccion_peso_grande'] }));
    expect(l).toContain('**IA:** Empanada · 110 g · confianza 54 %');
    expect(l).toContain('**Deportista:** Empanada (pollo) · 160 g');
    expect(l).toContain('**Equipo:** Empanada de pollo · 150 g');
    expect(l).toContain('plato playo de 26 cm, ángulo 35°');
    expect(l).toContain('correccion_peso_grande');
  });

  it('un ítem quitado se describe como tal', () => {
    expect(lineaCaso(item({ motivos_revision: ['item_quitado'], alimento_usuario: null, gramos_usuario: null }))).toContain('lo quitó (no estaba en el plato)');
  });
});

describe('construirResumenMd', () => {
  const items = [
    item({ alimento: 'Yogur griego', alimento_norm: 'yogur griego', alimento_usuario: 'Yogur griego', motivos_revision: ['cambio_alimento'], confidence: 0.9 }),
    item({ alimento: 'Yogur griego', alimento_norm: 'yogur griego', motivos_revision: ['cambio_alimento'], confidence: 0.88 }),
    item({ alimento: 'Arroz', alimento_norm: 'arroz', gramos_usuario: 160, motivos_revision: ['correccion_peso_grande'] }),
    item({ alimento: 'Pan rallado', alimento_norm: 'pan rallado', motivos_revision: ['item_quitado', 'confianza_baja'], confidence: 0.3, alimento_usuario: null, gramos_usuario: null }),
    item({ candidato_ejemplo: true, motivos_revision: ['cambio_alimento'], alimento_usuario: 'Empanada de carne', confidence: 0.93 }),
  ];
  const md = construirResumenMd(entrada(items, { noDetectados: [{ alimento: 'Puré de papa', alimento_norm: 'pure de papa', prompt_version: 'nut166-v1' }, { alimento: 'Puré de papa', alimento_norm: 'pure de papa', prompt_version: 'nut166-v1' }] }));

  it('tiene todas las secciones, en orden', () => {
    const titulos = [...md.matchAll(/^## (\d+)\. /gm)].map((m) => Number(m[1]));
    expect(titulos).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
    expect(md.startsWith('# NutriScan — Resumen de calidad')).toBe(true);
  });

  it('muestra los filtros y el recuento', () => {
    expect(md).toContain('**Período:** 2026-10-01 a 2026-10-31');
    expect(md).toContain('**Vajilla:** todas');
    expect(md).toContain('**Versión del prompt:** todas');
    expect(md).toContain('**Detecciones evaluadas:** 5');
  });

  it('incluye el prompt actual con su versión, en un bloque de código', () => {
    expect(md).toContain('versión `nut166-v1`');
    expect(md).toContain('```text\nSos el módulo de reconocimiento visual de NutriScan.\n```');
  });

  it('las definiciones usan los umbrales reales, no números escritos a mano', () => {
    expect(md).toContain(`más de ${Math.round(UMBRAL_DIFERENCIA_PESO * 100)} %`);
    expect(md).toContain(`menor a ${Math.round(UMBRAL_CONFIANZA_BAJA * 100)} %`);
  });

  it('el ranking separa nombre, peso y quitado, y marca las muestras chicas', () => {
    expect(md).toContain('| Alimento | Detecciones | % cambio de nombre | % corrección de peso | % quitado | % con alguna corrección |');
    expect(md).toMatch(/\| Yogur griego ⚠️ \| 2 \| 100 % \| 0 % \| 0 % \| 100 % \|/);
    expect(MIN_MUESTRA).toBeGreaterThan(1);
  });

  it('lista las confusiones, los falsos positivos y los no detectados por separado', () => {
    expect(md).toContain('| La IA detectó | Era en realidad | Veces | Confianza promedio |');
    expect(md).toContain('| Pan rallado ⚠️ | 1 | 100 % |');
    expect(md).toContain('| Puré de papa | 2 |');
  });

  it('los marcados como "Ejemplo para la IA" van en su propia sección', () => {
    const idx = md.indexOf('### 10.1');
    const sig = md.indexOf('### 10.2');
    expect(md.slice(idx, sig)).toContain('Empanada de carne');
  });

  it('cierra con la tarea sugerida y las restricciones para la IA', () => {
    const fin = md.slice(md.indexOf('## 11.'));
    expect(fin).toContain('Diagnóstico');
    expect(fin).toContain('Cambios concretos al prompt');
    expect(fin).toContain('few-shot');
    expect(fin).toContain('única referencia de escala es la vajilla');
    expect(fin).toContain('no debe estimar valores nutricionales');
  });

  it('avisa que no hay peso real medido (los errores de peso son una señal, no la verdad)', () => {
    expect(md).toContain('No hay peso real medido con balanza');
  });

  it('no incluye datos personales: ni usuarios, ni investigadores, ni fotos ni URLs', () => {
    expect(md).not.toMatch(/id_usuario|user_id|imagen_path|revisado_por|revisor|https?:\/\/|\.jpg|@ucc/i);
  });

  it('con una versión de prompt filtrada compara igual contra todas las versiones en la evolución', () => {
    const v1 = item({ prompt_version: 'nut166-v1', gramos_usuario: 150, created_at: '2026-10-01T10:00:00Z' });
    const v2 = item({ prompt_version: 'nut166-v2', gramos_usuario: 110, created_at: '2026-10-15T10:00:00Z' });
    const salida = construirResumenMd(entrada([v2], { itemsTodasLasVersiones: [v1, v2], params: { ...defaultsMetricas(), prompt: 'nut166-v2' } }));
    expect(salida).toContain('**Versión del prompt:** nut166-v2');
    expect(salida).toContain('| nut166-v1 |');
    expect(salida).toContain('| nut166-v2 |');
    expect(salida).toMatch(/Mejoró: 40 puntos de error de peso entre `nut166-v1` y `nut166-v2`/);
  });

  it('con una sola versión dice que todavía no hay comparación', () => {
    expect(md).toContain('Hay una sola versión con datos de peso');
  });

  it('sin datos no rompe y lo dice en cada sección', () => {
    const vacio = construirResumenMd(entrada([], { itemsTodasLasVersiones: [] }));
    expect(vacio).toContain('No hay detecciones evaluadas en el período');
    expect(vacio).toContain('Ningún alimento agregado a mano en el período');
    expect(vacio).toContain('_Ninguno en el período._');
    expect(vacio).toContain('## 11.');
  });

  it('avisa cuando los datos quedaron truncados', () => {
    expect(construirResumenMd(entrada(items, { truncado: true }))).toContain('los números son parciales');
    expect(md).not.toContain('los números son parciales');
  });

  it('escapa los "|" de los nombres para no romper las tablas', () => {
    const salida = construirResumenMd(entrada([item({ alimento: 'Arroz | con pollo', alimento_norm: 'arroz con pollo', motivos_revision: ['cambio_alimento'] })]));
    expect(salida).toContain('Arroz \\| con pollo');
  });
});

describe('nombreArchivoResumen', () => {
  it('es nutriscan-resumen-calidad-AAAA-MM-DD.md con la fecha de Argentina', () => {
    expect(nombreArchivoResumen(new Date('2026-10-22T15:00:00Z'))).toBe('nutriscan-resumen-calidad-2026-10-22.md');
    // 01:00 UTC del 23 todavía es 22 en Argentina (UTC-3)
    expect(nombreArchivoResumen(new Date('2026-10-23T01:00:00Z'))).toBe('nutriscan-resumen-calidad-2026-10-22.md');
  });
});
