import { NextRequest, NextResponse } from 'next/server';
import nodemailer from 'nodemailer';
import { createClient } from '@supabase/supabase-js';

// Configuración desde variables de entorno
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY!
);

// Configuración de Nodemailer para Gmail
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.GMAIL_USER,
    pass: process.env.GMAIL_PASS,
  },
});

// Previo a probar la funcionalidad se debe de corroborar una buena configuración
// de las variables de entorno y que la tabla profiles tenga datos con roles 'particular'
// o 'deportista_ucc' y que la tabla ingestas tenga registros con fechas correspondientes a hoy.

const FROM_EMAIL = process.env.GMAIL_USER || '';

// Comidas importantes
const MAIN_MEALS = ['desayuno', 'almuerzo', 'merienda', 'cena'];

export const runtime = 'nodejs'; // Para Vercel Edge Functions


export async function POST(req: NextRequest) {
  // Solo permitir ejecución por cron (POST)

  // Fecha de hoy (zona local Argentina)
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
//const fecha = today.toISOString().slice(0, 10);
  const fecha = new Date().toLocaleDateString("en-CA", { timeZone: "America/Argentina/Buenos_Aires" });

  // 1. Traer usuarios particulares y deportistas
  const { data: users, error: userError } = await supabase
    .from('profiles')
    .select('user_id, nombre, email, role')
    .in('role', ['particular', 'deportista_ucc']);

  if (userError) {
    console.log('User error:', userError);
    return NextResponse.json({ error: 'Error consultando usuarios', details: userError }, { status: 500 });
  }

  // 2. Traer ingestas de hoy para todos los usuarios
  const { data: ingestas, error: ingestasError } = await supabase
    .from('ingestas')
    .select('id_usuario, tipo')
    .eq('fecha', fecha);



  if (ingestasError) {
    return NextResponse.json({ error: 'Error consultando ingestas', details: ingestasError }, { status: 500 });
  }

  // 3. Armar recordatorios
  const reminders = users
    ?.map((user) => {
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
  <p>Hola ${nombre || ''},</p>
  <p>Este es un recordatorio para que registres tus comidas principales de hoy en NutriScan.</p>
  <p>Te falta cargar: ${faltantes.map(f => f.charAt(0).toUpperCase() + f.slice(1)).join(', ')}.</p>
  <p>Accedé a la app aquí: <a href="https://nutri-scan-mvp-aps.vercel.app/login">NutriScan</a></p>
  <p>Saludos,<br>Equipo NutriScan</p>
`;
      try {
        await transporter.sendMail({
          from: FROM_EMAIL,
          to: email,
          subject: 'Recordatorio diario de comidas',
          html,
        });
        return { email, status: 'sent' };
      } catch (e) {
        console.error('Error enviando mail:', e);
        return { email, status: 'error', error: e };
      }
    })
  );
  
  console.log('Fecha usada:', fecha);
  console.log('Usuarios:', users);
  console.log('Ingestas:', ingestas);
  console.log('Reminders:', reminders);

  return NextResponse.json({ sent: results.length, results });  
}

// Permite que Vercel Cron Jobs (GET) ejecute la misma lógica
export async function GET(req: NextRequest) {
  return POST(req);
}
