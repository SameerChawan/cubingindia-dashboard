import os
from pathlib import Path
from dotenv import load_dotenv

# Load .env from project directory or parent directory
_project = Path(__file__).resolve().parent
_parent = _project.parent
load_dotenv(_project / ".env")
load_dotenv(_parent / ".env")

SUPABASE_URL = os.getenv("SUPABASE_URL", "").rstrip("/")
SUPABASE_KEY = os.getenv("SUPABASE_KEY", "")
CI_TABLE_PREFIX = "ci_"  # All CubingIndia tables prefixed with ci_
