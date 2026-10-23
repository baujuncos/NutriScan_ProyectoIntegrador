# Smoke test — ✅ OK

Destino: `http://localhost:3100` · 2026-10-23T23:03:48.820Z

| Chequeo | Resultado | Detalle |
| --- | --- | --- |
| La página de login responde 200 y es NutriScan | ✅ | 219 ms |
| El manifiesto PWA es válido | ✅ | 76 ms |
| Una ruta protegida sin sesión redirige a /login (proxy activo) | ✅ | 307 → /login |
| API pública: /api/validate-investigator valida el cuerpo (400) | ✅ | 67 ms |
| API protegida: /api/chat/meal sin sesión responde 401 UNAUTHORIZED | ✅ | 211 ms |
| Seguridad (DEF-002): /api/send-reminders sin credenciales responde 401 | ✅ | 88 ms |
| Supabase Auth responde (/auth/v1/health) | ✅ | 1478 ms |
| Supabase REST: el catálogo de alimentos tiene datos | ✅ | 822 ms |

8/8 chequeos OK