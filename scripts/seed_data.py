"""Seed data for CubingIndia Dashboard (v3 - with auth setup).

Usage:
    py scripts/seed_data.py
"""
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import db
import auth

def seed():
    # 0. Create admin user if none exists
    existing = db.query("ci_users", limit=1)
    if not existing:
        result = auth.create_user("admin", "cubing123", "Sameer")
        if result:
            print("Admin user created: admin / cubing123")
        else:
            print("Failed to create admin user")

    # 1. Consignment (USD + rate)
    consignment = db.insert("ci_consignments", {
        "name": "Jan 2026 MoYu Import",
        "supplier": "MoYu Official",
        "invoice_number": "INV-2026-001",
        "invoice_date": "2026-01-15",
        "total_cogs_usd": 600.00,
        "total_freight_usd": 95.00,
        "usd_inr_rate": 84.50,
    })
    if not consignment:
        print("Failed to create consignment.")
        return
    cid = consignment[0]["id"]
    print(f"Consignment: {cid}")

    # 2. Handling expenses (INR)
    db.insert("ci_consignment_expenses", {
        "consignment_id": cid, "expense_type": "customs_duty", "amount_inr": 5000, "expense_date": "2026-01-18"
    })
    db.insert("ci_consignment_expenses", {
        "consignment_id": cid, "expense_type": "handling_fee", "amount_inr": 2000, "expense_date": "2026-01-18"
    })
    print("Handling expenses: INR 7,000")

    # 3. Products (unit_cost_usd from invoice, sum = $600)
    prods = [
        {"product_name": "MoYu RS3M 2024", "brand": "MoYu", "category": "3x3",
         "variant": "Magnetic Stickerless", "quantity_imported": 50, "unit_cost_usd": 4.00},
        {"product_name": "MoYu WeiLong WRM V10", "brand": "MoYu", "category": "3x3",
         "variant": "Magnetic", "quantity_imported": 20, "unit_cost_usd": 10.00},
        {"product_name": "MoYu AoSu 4x4", "brand": "MoYu", "category": "4x4",
         "variant": "Magnetic Stickerless", "quantity_imported": 15, "unit_cost_usd": 13.33},
    ]
    pids = []
    for p in prods:
        p["consignment_id"] = cid
        r = db.insert("ci_products", p)
        if r:
            pids.append(r[0]["id"])
    print(f"{len(prods)} products added")

    # 4. Allocate 2 RS3M for company use
    if pids:
        db.insert("ci_stock_allocations", {
            "product_id": pids[0],
            "allocation_type": "company_use",
            "quantity": 2,
            "allocation_date": "2026-01-20",
            "reason": "Demo units for office",
        })
        db.update("ci_products", {"quantity_allocated": 2}, {"id": f"eq.{pids[0]}"})
        print("Allocated 2 RS3M for company use")

    # 5. Sale
    if pids:
        sale = db.insert("ci_sales", {
            "sale_date": "2026-02-10", "channel": "shop", "customer_name": "Rahul", "discount": 50
        })
        if sale:
            sid = sale[0]["id"]
            unit_cogs_inr = 4.00 * 84.50
            unit_freight_inr = (95.0 * 84.50) / 85
            unit_handling_inr = 7000 / 85
            db.insert("ci_sale_items", {
                "sale_id": sid, "product_id": pids[0], "quantity": 2,
                "selling_price": 500,
                "unit_cogs_inr": round(unit_cogs_inr, 2),
                "unit_freight_inr": round(unit_freight_inr, 2),
                "unit_handling_inr": round(unit_handling_inr, 2),
            })
            db.update("ci_products", {"quantity_sold": 2}, {"id": f"eq.{pids[0]}"})
            db.update("ci_sales", {"total_amount": 1000, "final_amount": 950}, {"id": f"eq.{sid}"})
            print("Sale recorded: 2x RS3M @ INR 500")

    # 6. Postage expense
    db.insert("ci_expenses", {
        "expense_date": "2026-02-10", "category": "postage", "amount_inr": 150,
        "description": "Courier to Rahul"
    })

    # 7. Competition revenue
    db.insert("ci_revenue", {
        "revenue_date": "2026-02-20", "source": "competition_entry",
        "amount_inr": 15000, "description": "CubingIndia Open 2026"
    })
    print("Sample expenses + revenue added")
    print("\nDone! Login: admin / cubing123 | Dashboard: http://127.0.0.1:5050")


if __name__ == "__main__":
    seed()
