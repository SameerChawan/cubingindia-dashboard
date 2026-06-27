"""Test Supabase connection and basic CRUD for CubingIndia tables."""
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import db
from config import SUPABASE_URL, SUPABASE_KEY

def test():
    print(f"URL: {SUPABASE_URL[:30]}...")
    print(f"Key: {SUPABASE_KEY[:20]}...")
    print()

    tables = [
        "ci_consignments",
        "ci_products",
        "ci_consignment_expenses",
        "ci_sales",
        "ci_sale_items",
        "ci_expenses",
        "ci_revenue",
    ]

    for t in tables:
        try:
            rows = db.query(t, limit=1)
            print(f"  {t}: OK ({len(rows)} rows)")
        except Exception as e:
            print(f"  {t}: FAIL - {e}")

    print("\nDone. If all tables show OK, run: python app.py")

if __name__ == "__main__":
    test()
