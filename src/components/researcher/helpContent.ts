/**
 * Contenido de la guía de ayuda ("i") de cada pantalla del panel de investigador.
 * Está acá, aparte de los componentes, para poder editar los textos sin tocar UI.
 * Cada pantalla se indexa por `HelpId`; las pantallas con sub-pestañas tienen un
 * contenido por pestaña. Los umbrales se leen de las constantes reales (los
 * mismos que usan el cálculo y la pantalla), nunca se escriben a mano.
 */
import { UMBRAL_CONFIANZA_ALTA, UMBRAL_TASA_CORRECCION_ALTA } from '@/lib/metricasIa';
import { UMBRAL_CONFIANZA_BAJA, UMBRAL_DIFERENCIA_PESO } from '@/lib/revisionIa';

export type HelpId = 'dashboard' | 'deportistas' | 'validacion' | 'revision-cola' | 'revision-metricas';

export interface HelpSeccion {
  titulo: string;
  /** Párrafos de texto. */
  texto?: string[];
  /** Lista con viñetas. */
  lista?: string[];
  /** Lista numerada (pasos). */
  pasos?: string[];
}

export interface HelpContent {
  titulo: string;
  secciones: HelpSeccion[];
  glosario?: Array<{ termino: string; definicion: string }>;
}

/** "Ejemplo para la IA" (en la base, `candidato_ejemplo`): mismo nombre y mismo texto en la guía, en la tarjeta y en el modal. */
export const EJEMPLO_IA_TITULO = 'Ejemplo para la IA';
export const EJEMPLO_IA_AYUDA =
  'Marcá un caso cuando sea un error claro y típico de la IA, fácil de explicar (por ejemplo, una empanada de pollo que tomó por una de carne). Marcarlo no cambia nada por sí solo: deja el caso señalado para que más adelante el equipo elija algunos y los sume como ejemplos en las instrucciones que recibe la IA.';

/** 0,6 → "60 %". */
const porcentaje = (x: number) => `${Math.round(x * 100)} %`;

const CUMPLIMIENTO = {
  termino: 'Cumplimiento',
  definicion:
    'De las 4 comidas principales (desayuno, almuerzo, merienda y cena), el porcentaje que el deportista registró en la semana actual, sobre las que ya debería haber cargado hasta hoy. La semana va de lunes a hoy.',
};

export const HELP: Record<HelpId, HelpContent> = {
  dashboard: {
    titulo: 'Dashboard',
    secciones: [
      {
        titulo: 'Qué es',
        texto: [
          'Un resumen de la cohorte de deportistas UCC registrados en NutriScan: cuántos son, cómo se reparten por deporte y sexo, y cuánto vienen cargando sus comidas esta semana.',
        ],
      },
      {
        titulo: 'Para qué sirve',
        texto: [
          'Para tener una mirada general de la cohorte y ver rápido si la carga de datos viene floja, antes de entrar al detalle de cada deportista.',
        ],
      },
      {
        titulo: 'Cómo se usa',
        lista: [
          'Las tarjetas de arriba muestran los totales: deportistas registrados, básquet y hockey, cumplimiento promedio y femenino y masculino.',
          '"Distribución por deporte" muestra cuántos deportistas hay de cada deporte.',
          '"Cumplimiento de carga de datos" compara el cumplimiento promedio por deporte y por sexo.',
          '"Top 5" ordena a los deportistas que más cumplieron esta semana.',
          'Para ver a una persona en detalle, andá a Deportistas.',
        ],
      },
    ],
    glosario: [CUMPLIMIENTO],
  },

  deportistas: {
    titulo: 'Deportistas',
    secciones: [
      {
        titulo: 'Qué es',
        texto: [
          'La lista de todos los deportistas UCC registrados, con su deporte, carrera, año de ingreso y cumplimiento de carga de esta semana.',
        ],
      },
      {
        titulo: 'Para qué sirve',
        texto: ['Para encontrar a un deportista, ver su ficha completa y descargar un informe en Excel de las personas que elijas.'],
      },
      {
        titulo: 'Cómo se usa',
        pasos: [
          'Buscá por nombre, apellido o email, o filtrá por unidad académica, carrera, año de ingreso o deporte. "Limpiar" saca todos los filtros.',
          'Tocá una fila o "Ver detalle" para abrir la ficha: datos académicos y físicos, valoración psicológica, comidas de la semana e histórico reciente.',
          'Marcá las casillas de quienes quieras incluir (la de arriba selecciona a todos los que se ven con los filtros) y tocá "Descargar informe" para bajar el Excel.',
        ],
      },
    ],
    glosario: [CUMPLIMIENTO],
  },

  validacion: {
    titulo: 'Validación de alimentos',
    secciones: [
      {
        titulo: 'Qué es',
        texto: [
          'La cola de alimentos que los deportistas registraron y que no estaban en el catálogo. Cada uno puede estar Pendiente, Validado o Descartado.',
        ],
      },
      {
        titulo: 'Para qué sirve',
        texto: [
          'Para que el equipo revise los valores nutricionales de esos alimentos y deje un dato confiable. Al validar uno, los registros de los deportistas que lo cargaron se actualizan con esos valores.',
        ],
      },
      {
        titulo: 'Cómo se usa',
        pasos: [
          'Filtrá por estado (arranca en Pendientes) o buscá por nombre, y ordená por fecha o por cantidad de ocurrencias.',
          'Tocá "Revisar" para abrir el alimento.',
          'Revisá el nombre y elegí de dónde salen los valores por 100 g: IA (la estimación de Gemini), Del catálogo (combinando alimentos del catálogo) o A mano (cargando vos los cuatro valores).',
          'Guardá un borrador, o tocá Validar o Descartar. Validar y descartar piden una confirmación.',
        ],
      },
    ],
    glosario: [
      { termino: 'Ocurrencias', definicion: 'Cuántas veces los deportistas registraron ese alimento.' },
      { termino: 'Por 100 g', definicion: 'Los valores nutricionales (kcal, proteínas, carbohidratos y grasas) se cargan siempre cada 100 gramos del alimento.' },
    ],
  },

  'revision-cola': {
    titulo: 'Revisión de IA · Cola de revisión',
    secciones: [
      {
        titulo: 'Qué es',
        texto: [
          'Acá están las detecciones de la IA que conviene revisar a mano. Cada tarjeta es un alimento de una foto que sacó un deportista, con lo que dijo la IA y lo que dejó el deportista al confirmar.',
        ],
      },
      {
        titulo: 'Por qué aparece un ítem (puede tener más de un motivo)',
        lista: [
          `Confianza baja: la IA no estaba segura (confianza menor a ${porcentaje(UMBRAL_CONFIANZA_BAJA)}).`,
          'Cambio de alimento: el deportista reemplazó el alimento que detectó la IA.',
          `Corrección de peso: el deportista cambió el peso en más de ${porcentaje(UMBRAL_DIFERENCIA_PESO)}.`,
          'Ítem quitado: la IA detectó algo que no estaba en el plato y el deportista lo quitó. Es el caso más grave.',
        ],
      },
      {
        titulo: 'Cómo se usa',
        pasos: [
          'Mirá la foto: el círculo marca qué alimento se está evaluando.',
          'Si lo que dejó el deportista es correcto, tocá Confirmar.',
          'Si no, tocá Corregir: para el alimento y para el peso elegí entre mantener lo del deportista o ingresar el valor que creés correcto. Si el deportista quitó el ítem, elegís si estaba en el plato (restaurar) o no (mantener quitado).',
          `Si el caso es un buen ejemplo de error de la IA, marcalo como ${EJEMPLO_IA_TITULO} (el control con la estrella; el ícono "?" explica qué significa).`,
          'Con el filtro Estado podés ver lo ya revisado y cómo quedó cada corrección (lo que dijo la IA, lo que dejó el deportista y lo que corrigió el equipo). Si hace falta corregir de nuevo, tocá Reabrir.',
        ],
      },
      {
        titulo: 'Para qué sirve',
        texto: [
          'Lo que confirmás o corregís queda como dato validado por el equipo de nutrición y alimenta las Métricas. Así se ve dónde se equivoca la IA y qué conviene mejorar.',
        ],
      },
    ],
    glosario: [
      {
        termino: EJEMPLO_IA_TITULO,
        definicion: EJEMPLO_IA_AYUDA,
      },
    ],
  },

  'revision-metricas': {
    titulo: 'Revisión de IA · Métricas',
    secciones: [
      {
        titulo: 'Qué es',
        texto: ['Un resumen de cuánto y cómo se corrigen las detecciones de la IA, para decidir dónde conviene mejorar.'],
      },
      {
        titulo: 'Cómo leerlo',
        lista: [
          'Alimentos más corregidos: por alimento, el % de veces que se cambió el nombre (la IA no lo reconoció bien), el % de veces que se cambió el peso (la IA estimó mal la cantidad) y el % de veces que se quitó. Son problemas distintos.',
          `Confianza vs. corrección: cada punto es un alimento. La zona roja marca los alimentos donde la IA estaba segura (confianza de ${porcentaje(UMBRAL_CONFIANZA_ALTA)} o más) y se equivocó igual (corregidos en ${porcentaje(UMBRAL_TASA_CORRECCION_ALTA)} o más de las veces).`,
          'Evolución por versión de prompt: compara el error de peso entre versiones de las instrucciones de la IA, para saber si un cambio realmente ayudó.',
          'Alimentos no detectados: los que los deportistas tuvieron que agregar a mano porque la IA no los vio.',
        ],
      },
      {
        titulo: 'Cómo se usa',
        texto: [
          'Filtrá por fechas, vajilla o versión de prompt. Empezá por el ranking para ver qué alimentos fallan más y por qué (nombre o peso). Con pocas detecciones los porcentajes no son confiables: mirá siempre la columna Detecciones.',
        ],
      },
      {
        titulo: 'Para qué sirve',
        texto: [
          'Para decidir qué hacer: qué alimentos necesitan más ejemplos en las instrucciones de la IA, o si alguno tiene un error sistemático (por ejemplo, estima siempre de menos) que convenga compensar.',
        ],
      },
    ],
  },
};
