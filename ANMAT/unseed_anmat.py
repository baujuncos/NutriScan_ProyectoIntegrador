"""
Revierte seed_anmat.py: borra de public.alimentos todas las filas con fuente='ANMAT'.
No toca filas de SARA2.

Uso:
    cd ANMAT
    python unseed_anmat.py
"""

import os
from dotenv import load_dotenv
from supabase import create_client

load_dotenv(os.path.join(os.path.dirname(__file__), '..', '.env.local'))

SUPABASE_URL = os.getenv('NEXT_PUBLIC_SUPABASE_URL')
SUPABASE_KEY = os.getenv('NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY')

if not SUPABASE_URL or not SUPABASE_KEY:
    raise ValueError("Faltan variables: NEXT_PUBLIC_SUPABASE_URL o NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY")

supabase = create_client(SUPABASE_URL, SUPABASE_KEY)

res = supabase.table('alimentos').delete().eq('fuente', 'ANMAT').execute()
print(f"Eliminados {len(res.data)} registros ANMAT de public.alimentos.")
