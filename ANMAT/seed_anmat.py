"""
Importa anmat_unificado_100g.csv a public.alimentos.

Prerequisito: ejecutar primero SARA2/seed_supabase.py (ambos escriben
en la misma tabla; este script no toca filas de SARA2).

Uso:
    cd ANMAT
    SUPABASE_URL=<url> SUPABASE_SERVICE_ROLE_KEY=<key> python seed_anmat.py

ID offset: 1_000_000 + id_alimento_anmat para evitar colisiones con IDs de SARA2.

Calidad de datos: se imprimen advertencias para registros sospechosos pero
la carga continúa igualmente (revisar a mano después).
"""

import os
import csv
import re
from dotenv import load_dotenv
from supabase import create_client, Client

load_dotenv(os.path.join(os.path.dirname(__file__), '..', '.env.local'))

SUPABASE_URL = os.getenv('SUPABASE_URL')
SUPABASE_KEY = os.getenv('SUPABASE_SERVICE_ROLE_KEY')

if not SUPABASE_URL or not SUPABASE_KEY:
    raise ValueError("Faltan variables: SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY")

supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)

CSV_PATH = os.path.join(os.path.dirname(__file__), 'anmat_unificado_100g.csv')
ID_OFFSET = 1_000_000

# Heurística: "Nombre Apellido" (dos tokens, ambos capitalizados, sin dígitos)
_PERSON_RE = re.compile(r'^[A-ZÁÉÍÓÚÑÜ][a-záéíóúñü]{1,}\s[A-ZÁÉÍÓÚÑÜ][a-záéíóúñü]{1,}$')


def _warn(row_num: int, msg: str) -> None:
    print(f"  [WARN] fila {row_num}: {msg}")


def _parse_float(val: str):
    val = val.strip()
    return float(val) if val else None


data = []
warn_count = 0

with open(CSV_PATH, 'r', encoding='utf-8-sig') as f:
    reader = csv.DictReader(f)
    for i, row in enumerate(reader, start=2):  # fila 2 = primera de datos
        nombre = row['nombre'].strip()
        marca  = row['marca'].strip()

        if len(nombre) < 3:
            _warn(i, f"nombre muy corto: {nombre!r}")
            warn_count += 1
        if marca and _PERSON_RE.match(marca):
            _warn(i, f"marca parece nombre de persona: {marca!r}  (nombre={nombre!r})")
            warn_count += 1

        data.append({
            'id_alimento':    ID_OFFSET + int(row['id_alimento_anmat']),
            'nombre':         nombre,
            'categoria':      row['categoria'].strip() or None,
            'kcal_100g':      _parse_float(row['kcal_100g']),
            'proteinas_100g': _parse_float(row['proteinas_100g']),
            'grasas_100g':    _parse_float(row['grasas_100g']),
            'carbs_100g':     _parse_float(row['carbs_100g']),
            'fuente':         'ANMAT',
            'marca':          marca or None,
            'denominacion':   row['denominacion'].strip() or None,
        })

print(f"Leídos {len(data)} registros ANMAT ({warn_count} advertencias). Insertando...")

BATCH = 100
for i in range(0, len(data), BATCH):
    supabase.table('alimentos').insert(data[i:i + BATCH]).execute()
    if i % 5000 == 0 and i > 0:
        print(f"  {i}/{len(data)} insertados...")

print(f"Seeding ANMAT completado: {len(data)} registros en public.alimentos (fuente='ANMAT').")
