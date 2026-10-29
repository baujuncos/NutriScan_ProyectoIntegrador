import { NextRequest, NextResponse } from 'next/server';
import nodemailer from 'nodemailer';
import { createClient } from '@supabase/supabase-js';
import { secretEquals } from '@/lib/secretEquals';

// Configuración desde variables de entorno. En Vercel esta ruta usa las
// variables server-only sin prefijo (SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY);
// se hace fallback a NEXT_PUBLIC_SUPABASE_URL porque en local sólo esa está
// definida en .env.local.
// Los clientes se crean recién DESPUÉS de autorizar la request (DEF-002): una
// request sin credenciales no toca ni la base ni el servidor de mail.
function createSupabase() {
  return createClient(
    (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL)!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
}

// Configuración de Nodemailer para Gmail
function createTransporter() {
  return nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: process.env.GMAIL_USER,
      pass: process.env.GMAIL_PASS,
    },
  });
}

// Previo a probar la funcionalidad se debe de corroborar una buena configuración
// de las variables de entorno y que la tabla profiles tenga datos con roles 'particular'
// o 'deportista_ucc' y que la tabla ingestas tenga registros con fechas correspondientes a hoy.

// Comidas importantes
const MAIN_MEALS = ['desayuno', 'almuerzo', 'merienda', 'cena'];

export const runtime = 'nodejs'; // Para Vercel Edge Functions

const HTML_ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
/** El nombre lo escribe el propio usuario al registrarse: se escapa antes de ir a un mail HTML. */
function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => HTML_ESCAPES[c]);
}

/**
 * Vercel Cron manda `Authorization: Bearer ${CRON_SECRET}` cuando la variable
 * CRON_SECRET existe en el proyecto. Sin la variable configurada se rechaza todo
 * (falla cerrado): es preferible no mandar recordatorios que dejar el endpoint abierto.
 */
function isAuthorized(req: NextRequest): boolean {
  const expected = process.env.CRON_SECRET?.trim();
  const header = req.headers.get('authorization') ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  return secretEquals(token, expected);
}

export async function POST(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: 'No autorizado.' }, { status: 401 });
  }

  const supabase = createSupabase();
  const transporter = createTransporter();
  const fromEmail = process.env.GMAIL_USER || '';

  // Fecha de hoy (zona local Argentina)
  const fecha = new Date().toLocaleDateString("en-CA", { timeZone: "America/Argentina/Buenos_Aires" });

  // 1. Traer usuarios particulares y deportistas
  const { data: users, error: userError } = await supabase
    .from('profiles')
    .select('user_id, nombre, email, role')
    .in('role', ['particular', 'deportista_ucc']);

  if (userError) {
    console.error('send-reminders: error consultando usuarios:', userError.message);
    return NextResponse.json({ error: 'Error consultando usuarios' }, { status: 500 });
  }

  // 2. Traer ingestas de hoy para todos los usuarios
  const { data: ingestas, error: ingestasError } = await supabase
    .from('ingestas')
    .select('id_usuario, tipo')
    .eq('fecha', fecha);

  if (ingestasError) {
    console.error('send-reminders: error consultando ingestas:', ingestasError.message);
    return NextResponse.json({ error: 'Error consultando ingestas' }, { status: 500 });
  }

  // 3. Armar recordatorios
  const reminders = (users ?? [])
    .map((user) => {
      const comidasHoy = ingestas
        ?.filter((i) => i.id_usuario === user.user_id)
        .map((i) => i.tipo);
      const faltantes = MAIN_MEALS.filter((m) => !comidasHoy?.includes(m));
      if (faltantes.length > 0 && user.email) {
        return {
          email: user.email,
          nombre: user.nombre,
          faltantes,
        };
      }
      return null;
    })
    .filter(Boolean) as { email: string; nombre: string; faltantes: string[] }[];

  // 4. Enviar mails en paralelo
  // Fijarse de colocar el link correcto de deployeo
  
  const results = await Promise.all(
    reminders.map(async ({ email, nombre, faltantes }) => {
      const html = `
  <p>Hola ${escapeHtml(nombre || '')},</p>
  <p>Este es un recordatorio para que registres tus comidas principales de hoy en NutriScan.</p>
  <p>Te falta cargar: ${faltantes.map(f => f.charAt(0).toUpperCase() + f.slice(1)).join(', ')}.</p>
  <p>Accedé a la app aquí: <a href="https://nutri-scan-mvp-aps.vercel.app/login">NutriScan</a></p>
  <p>Saludos,<br>Equipo NutriScan</p>
`;
      try {
        await transporter.sendMail({
          from: fromEmail,
          to: email,
          subject: 'Recordatorio diario de comidas',
          html,
        });
        return 'sent' as const;
      } catch (e) {
        // Sin el email del usuario en el log: son datos personales.
        console.error('send-reminders: error enviando un mail:', e instanceof Error ? e.message : e);
        return 'error' as const;
      }
    })
  );

  const sent = results.filter((r) => r === 'sent').length;
  console.log(`send-reminders: fecha ${fecha}, destinatarios ${results.length}, enviados ${sent}`);

  // Solo contadores: la respuesta no devuelve emails ni errores (DEF-002).
  return NextResponse.json({ sent, failed: results.length - sent });
}

// Permite que Vercel Cron Jobs (GET) ejecute la misma lógica
export async function GET(req: NextRequest) {
  return POST(req);
}
