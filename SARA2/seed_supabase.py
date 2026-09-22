import os
import csv
from dotenv import load_dotenv
from supabase import create_client, Client

# Cargar variables de entorno
load_dotenv(os.path.join(os.path.dirname(__file__), '..', '.env.local'))
SUPABASE_URL = os.getenv('NEXT_PUBLIC_SUPABASE_URL')
SUPABASE_KEY = os.getenv('NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY')

if not SUPABASE_URL or not SUPABASE_KEY:
    raise ValueError("Faltan variables de entorno: NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY")

# Crear cliente Supabase
supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)

# Ruta al CSV
csv_path = os.path.join(os.path.dirname(__file__), 'base_macros.csv')

# Leer el CSV e insertar en la tabla alimentos
with open(csv_path, 'r', encoding='utf-8') as file:
    reader = csv.DictReader(file, delimiter=',')  # Delimitador coma
    data = []
    for row in reader:
        # Mapear columnas del CSV a la tabla
        alimento = {
            'id_alimento': int(row['id_alimento']),
            'nombre': row['nombre'],
            'categoria': row['categoria'],
            'kcal_100g': float(row['kcal_100g']) if row['kcal_100g'] else None,
            'proteinas_100g': float(row['proteinas_100g']) if row['proteinas_100g'] else None,
            'grasas_100g': float(row['grasas_100g']) if row['grasas_100g'] else None,
            'carbs_100g': float(row['carbs_100g']) if row['carbs_100g'] else None,
        }
        data.append(alimento)

# Insertar en lotes para evitar límites
batch_size = 100
for i in range(0, len(data), batch_size):
    batch = data[i:i + batch_size]
    response = supabase.table('alimentos').upsert(batch).execute()
    print(f"Insertado lote {i//batch_size + 1}: {len(batch)} alimentos")

print("Seeding completado.")