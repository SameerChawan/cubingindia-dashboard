"""API routes for CubingIndia Dashboard (v6 - with XingleToy Price Lookup)."""
from flask import Blueprint, request, jsonify
from datetime import date, datetime
from collections import defaultdict
import json
import os
import urllib.request as _urllib
import db
from auth import login_required

api = Blueprint("api", __name__)


@api.before_request
@login_required
def before_all():
    """Protect all API routes."""
    pass

# ── Helpers ──────────────────────────────────────────────────

def ok(data=None, msg="ok"):
    return jsonify({"ok": True, "data": data, "msg": msg})

def fail(msg, code=400):
    return jsonify({"ok": False, "msg": msg}), code

def in_date_range(date_str, start_date, end_date):
    """Check if a date string (YYYY-MM-DD) falls within the range."""
    if not date_str:
        return True
    if start_date and date_str < start_date:
        return False
    if end_date and date_str > end_date:
        return False
    return True


def calc_product_landed(product, consignment, all_cons_products, cons_expenses):
    """Calculate proportional landed cost for a single product.

    Landed cost = unit_cost_usd × rate × markup_factor
    where markup_factor = 1 + (freight_usd + handling_inr/rate) / cogs_usd

    This distributes freight & handling proportionally to each product's value,
    not equally across units.
    """
    rate = float(consignment.get("usd_inr_rate", 84.0))
    cogs_usd = float(consignment.get("total_cogs_usd", 0))
    freight_usd = float(consignment.get("total_freight_usd", 0))
    handling_inr = sum(float(e.get("amount_inr", 0)) for e in cons_expenses)
    handling_usd = handling_inr / rate if rate else 0

    # Markup factor: how much extra beyond base COGS (freight + handling as % of COGS)
    markup_factor = 1.0
    if cogs_usd > 0:
        markup_factor = 1.0 + (freight_usd + handling_usd) / cogs_usd

    unit_usd = float(product.get("unit_cost_usd", 0))
    unit_landed_inr = unit_usd * rate * markup_factor

    return {
        "unit_landed_inr": round(unit_landed_inr, 2),
        "markup_factor": round(markup_factor, 4),
        "rate": rate,
    }


def get_consignment_landed(consignment, products, cons_expenses):
    """Calculate total landed cost for a consignment (all INR)."""
    rate = float(consignment.get("usd_inr_rate", 84.0))
    cogs_usd = float(consignment.get("total_cogs_usd", 0))
    freight_usd = float(consignment.get("total_freight_usd", 0))

    inr_cogs = cogs_usd * rate
    inr_freight = freight_usd * rate
    inr_handling = sum(float(e.get("amount_inr", 0)) for e in cons_expenses)

    total_landed_inr = inr_cogs + inr_freight + inr_handling
    total_qty = sum(int(p.get("quantity_imported", 0)) for p in products) or 1

    # Inventory value using proportional landed costs
    inv_value = 0
    for p in products:
        remaining = int(p.get("quantity_imported", 0)) - int(p.get("quantity_sold", 0))
        if remaining > 0:
            landed = calc_product_landed(p, consignment, products, cons_expenses)
            inv_value += remaining * landed["unit_landed_inr"]

    return {
        "cogs_usd": cogs_usd,
        "freight_usd": freight_usd,
        "usd_inr_rate": rate,
        "inr_cogs": round(inr_cogs, 2),
        "inr_freight": round(inr_freight, 2),
        "inr_handling": round(inr_handling, 2),
        "total_landed_inr": round(total_landed_inr, 2),
        "total_qty": total_qty,
        "inventory_value": round(inv_value, 2),
    }


# ============================================================
# CONSIGNMENTS
# ============================================================

@api.get("/api/consignments")
def list_consignments():
    rows = db.query("ci_consignments", order="invoice_date.desc,created_at.desc")
    # Attach reconciliation data to each
    for r in rows:
        products = db.query("ci_products", filters={"consignment_id": f"eq.{r['id']}"})
        exps = db.query("ci_consignment_expenses", filters={"consignment_id": f"eq.{r['id']}"})
        landed = get_consignment_landed(r, products, exps)
        r["_landed"] = landed
        r["_products"] = products
        r["_expenses"] = exps
        # Reconciliation: sum of (qty × unit_cost_usd) vs consignment total_cogs_usd
        products_cogs_sum = sum(
            float(p.get("unit_cost_usd", 0)) * int(p.get("quantity_imported", 0))
            for p in products
        )
        r["_recon_usd"] = round(products_cogs_sum, 2)
        r["_recon_diff"] = round(products_cogs_sum - float(r.get("total_cogs_usd", 0)), 2)
        r["_recon_ok"] = abs(r["_recon_diff"]) < 0.01
    return ok(rows)

@api.post("/api/consignments")
def create_consignment():
    d = request.get_json()
    if not d.get("name"):
        return fail("name is required")
    row = db.insert("ci_consignments", d)
    if row is None:
        return fail("insert failed", 500)
    return ok(row)

@api.put("/api/consignments/<cid>")
def update_consignment(cid):
    d = request.get_json()
    row = db.update("ci_consignments", d, {"id": f"eq.{cid}"})
    if row is None:
        return fail("update failed", 500)
    return ok(row)

@api.delete("/api/consignments/<cid>")
def delete_consignment(cid):
    db.delete("ci_consignment_expenses", {"consignment_id": f"eq.{cid}"})
    ok_del = db.delete("ci_consignments", {"id": f"eq.{cid}"})
    return ok() if ok_del else fail("delete failed", 500)


# ============================================================
# PRODUCTS
# ============================================================

@api.get("/api/products")
def list_products():
    consignment_id = request.args.get("consignment_id")
    status = request.args.get("status")
    filters = {}
    if consignment_id:
        filters["consignment_id"] = f"eq.{consignment_id}"
    if status:
        filters["status"] = f"eq.{status}"
    rows = db.query("ci_products", filters=filters, order="created_at.desc")
    return ok(rows)

@api.post("/api/products")
def create_product():
    d = request.get_json()
    if not d.get("consignment_id") or not d.get("product_name"):
        return fail("consignment_id and product_name required")
    # unit_cost_usd must be provided per product
    if "unit_cost_usd" not in d or d.get("unit_cost_usd") is None:
        return fail("unit_cost_usd is required (USD cost per unit from supplier invoice)")
    row = db.insert("ci_products", d)
    if row is None:
        return fail("insert failed", 500)
    return ok(row)

@api.put("/api/products/<pid>")
def update_product(pid):
    d = request.get_json()
    row = db.update("ci_products", d, {"id": f"eq.{pid}"})
    if row is None:
        return fail("update failed", 500)
    return ok(row)

@api.delete("/api/products/<pid>")
def delete_product(pid):
    ok_del = db.delete("ci_products", {"id": f"eq.{pid}"})
    return ok() if ok_del else fail("delete failed", 500)


# ============================================================
# CONSIGNMENT EXPENSES (INR)
# ============================================================

@api.get("/api/consignment-expenses")
def list_consignment_expenses():
    cid = request.args.get("consignment_id")
    filters = {}
    if cid:
        filters["consignment_id"] = f"eq.{cid}"
    rows = db.query("ci_consignment_expenses", filters=filters, order="expense_date.desc")
    return ok(rows)

@api.post("/api/consignment-expenses")
def create_consignment_expense():
    d = request.get_json()
    if not d.get("consignment_id") or not d.get("amount_inr"):
        return fail("consignment_id and amount_inr required")
    row = db.insert("ci_consignment_expenses", d)
    if row is None:
        return fail("insert failed", 500)
    return ok(row)

@api.delete("/api/consignment-expenses/<eid>")
def delete_consignment_expense(eid):
    ok_del = db.delete("ci_consignment_expenses", {"id": f"eq.{eid}"})
    return ok() if ok_del else fail("delete failed", 500)


# ============================================================
# SALES
# ============================================================

@api.get("/api/sales")
def list_sales():
    rows = db.query("ci_sales", order="sale_date.desc,created_at.desc")
    for r in rows:
        r["items"] = db.query("ci_sale_items", filters={"sale_id": f"eq.{r['id']}"})
    return ok(rows)

@api.post("/api/sales")
def create_sale():
    d = request.get_json()
    if not d.get("items") or len(d["items"]) == 0:
        return fail("At least one item required")

    items = d.pop("items")

    if "total_amount" not in d:
        d["total_amount"] = sum(float(i.get("selling_price", 0)) * int(i.get("quantity", 1)) for i in items)
    if "final_amount" not in d:
        d["final_amount"] = float(d.get("total_amount", 0)) - float(d.get("discount", 0))

    sale = db.insert("ci_sales", d)
    if not sale:
        return fail(f"sale insert failed — check terminal for Supabase error details", 500)

    sale_id = sale[0]["id"]

    for item in items:
        pid = item.get("product_id")
        if not pid:
            return fail("product_id required in each item")

        prod = db.query("ci_products", filters={"id": f"eq.{pid}"})
        if not prod:
            return fail(f"product {pid} not found")
        p = prod[0]

        # Get consignment and compute proportional INR landed cost
        cons = db.query("ci_consignments", filters={"id": f"eq.{p['consignment_id']}"})
        if cons:
            c = cons[0]
            rate = float(c.get("usd_inr_rate", 84.0))
            cogs_usd = float(c.get("total_cogs_usd", 0))
            freight_usd = float(c.get("total_freight_usd", 0))
            exps = db.query("ci_consignment_expenses",
                            filters={"consignment_id": f"eq.{p['consignment_id']}"})
            handling_inr = sum(float(e.get("amount_inr", 0)) for e in exps)
            handling_usd = handling_inr / rate if rate else 0

            # Proportional markup: freight + handling distributed by product value
            markup = 1.0
            if cogs_usd > 0:
                markup = 1.0 + (freight_usd + handling_usd) / cogs_usd

            unit_usd = float(p.get("unit_cost_usd", 0))
            unit_cogs_inr = unit_usd * rate
            # Freight & handling are proportional to unit value
            unit_freight_inr = unit_usd * rate * (freight_usd / cogs_usd) if cogs_usd > 0 else 0
            unit_handling_inr = unit_usd * rate * (handling_usd / cogs_usd) if cogs_usd > 0 else 0
        else:
            unit_cogs_inr = float(p.get("unit_cost_usd", 0)) * 84.0
            unit_freight_inr = 0
            unit_handling_inr = 0

        sale_item = {
            "sale_id": sale_id,
            "product_id": pid,
            "quantity": int(item.get("quantity", 1)),
            "selling_price": float(item.get("selling_price", 0)),
            "unit_cogs_inr": round(unit_cogs_inr, 2),
            "unit_freight_inr": round(unit_freight_inr, 2),
            "unit_handling_inr": round(unit_handling_inr, 2),
            "notes": item.get("notes"),
        }
        db.insert("ci_sale_items", sale_item)

        # Update product quantity_sold
        new_sold = int(p.get("quantity_sold", 0)) + int(item.get("quantity", 1))
        new_status = "sold_out" if new_sold >= int(p.get("quantity_imported", 0)) else p.get("status", "in_stock")
        db.update("ci_products", {"quantity_sold": new_sold, "status": new_status}, {"id": f"eq.{pid}"})

    full = db.query("ci_sales", filters={"id": f"eq.{sale_id}"})
    if full:
        full[0]["items"] = db.query("ci_sale_items", filters={"sale_id": f"eq.{sale_id}"})
        return ok(full[0])
    return ok({"id": sale_id})

@api.delete("/api/sales/<sid>")
def delete_sale(sid):
    items = db.query("ci_sale_items", filters={"sale_id": f"eq.{sid}"})
    for item in items:
        prod = db.query("ci_products", filters={"id": f"eq.{item['product_id']}"})
        if prod:
            p = prod[0]
            new_sold = max(0, int(p.get("quantity_sold", 0)) - int(item.get("quantity", 1)))
            new_status = "in_stock" if new_sold < int(p.get("quantity_imported", 0)) else p.get("status", "in_stock")
            db.update("ci_products", {"quantity_sold": new_sold, "status": new_status},
                      {"id": f"eq.{item['product_id']}"})

    db.delete("ci_sale_items", {"sale_id": f"eq.{sid}"})
    ok_del = db.delete("ci_sales", {"id": f"eq.{sid}"})
    return ok() if ok_del else fail("delete failed", 500)


# ============================================================
# STOCK ALLOCATIONS (Company use, promotion, etc.)
# ============================================================

@api.get("/api/allocations")
def list_allocations():
    pid = request.args.get("product_id")
    filters = {}
    if pid:
        filters["product_id"] = f"eq.{pid}"
    rows = db.query("ci_stock_allocations", filters=filters, order="allocation_date.desc,created_at.desc")
    return ok(rows)

@api.post("/api/allocations")
def create_allocation():
    d = request.get_json()
    if not d.get("product_id") or not d.get("quantity"):
        return fail("product_id and quantity required")

    qty = int(d["quantity"])

    # Check product has enough sellable stock
    prod = db.query("ci_products", filters={"id": f"eq.{d['product_id']}"})
    if not prod:
        return fail("product not found")
    p = prod[0]
    sellable = int(p.get("quantity_imported", 0)) - int(p.get("quantity_sold", 0)) - int(p.get("quantity_allocated", 0))
    if qty > sellable:
        return fail(f"only {sellable} sellable units remaining")

    # Insert allocation
    row = db.insert("ci_stock_allocations", d)
    if row is None:
        return fail("insert failed", 500)

    # Update product's quantity_allocated
    new_allocated = int(p.get("quantity_allocated", 0)) + qty
    db.update("ci_products", {"quantity_allocated": new_allocated}, {"id": f"eq.{d['product_id']}"})

    return ok(row)

@api.delete("/api/allocations/<aid>")
def delete_allocation(aid):
    # Get allocation first to reverse the quantity
    allocs = db.query("ci_stock_allocations", filters={"id": f"eq.{aid}"})
    if allocs:
        a = allocs[0]
        prod = db.query("ci_products", filters={"id": f"eq.{a['product_id']}"})
        if prod:
            p = prod[0]
            new_allocated = max(0, int(p.get("quantity_allocated", 0)) - int(a.get("quantity", 1)))
            db.update("ci_products", {"quantity_allocated": new_allocated}, {"id": f"eq.{a['product_id']}"})
    ok_del = db.delete("ci_stock_allocations", {"id": f"eq.{aid}"})
    return ok() if ok_del else fail("delete failed", 500)


# ============================================================
# STOCK ADJUSTMENTS (Damaged, Lost, Returned, etc.)
# ============================================================

@api.get("/api/adjustments")
def list_adjustments():
    pid = request.args.get("product_id")
    filters = {}
    if pid:
        filters["product_id"] = f"eq.{pid}"
    rows = db.query("ci_stock_adjustments", filters=filters, order="adjustment_date.desc,created_at.desc")
    return ok(rows)

@api.post("/api/adjustments")
def create_adjustment():
    d = request.get_json()
    if not d.get("product_id") or not d.get("adjustment_type"):
        return fail("product_id and adjustment_type required")

    qty = int(d.get("quantity", 1))
    adj_type = d["adjustment_type"]

    # Get product to validate stock
    prod = db.query("ci_products", filters={"id": f"eq.{d['product_id']}"})
    if not prod:
        return fail("product not found")
    p = prod[0]

    # For negative adjustments (damaged/lost), check available stock
    if adj_type in ("damaged", "lost"):
        available = int(p.get("quantity_imported", 0)) - int(p.get("quantity_sold", 0)) - int(p.get("quantity_allocated", 0)) - int(p.get("quantity_adjusted", 0))
        if qty > available:
            return fail(f"only {available} units available for adjustment")

    # Insert adjustment
    row = db.insert("ci_stock_adjustments", d)
    if row is None:
        return fail("insert failed", 500)

    # Update product's quantity_adjusted
    if adj_type in ("damaged", "lost"):
        new_adjusted = int(p.get("quantity_adjusted", 0)) + qty
    elif adj_type in ("returned", "found"):
        new_adjusted = max(0, int(p.get("quantity_adjusted", 0)) - qty)
    else:  # correction - can be positive or negative
        new_adjusted = int(p.get("quantity_adjusted", 0)) + qty

    db.update("ci_products", {"quantity_adjusted": new_adjusted}, {"id": f"eq.{d['product_id']}"})

    return ok(row)

@api.delete("/api/adjustments/<aid>")
def delete_adjustment(aid):
    # Get adjustment first to reverse the quantity
    adjs = db.query("ci_stock_adjustments", filters={"id": f"eq.{aid}"})
    if adjs:
        a = adjs[0]
        prod = db.query("ci_products", filters={"id": f"eq.{a['product_id']}"})
        if prod:
            p = prod[0]
            adj_type = a.get("adjustment_type")
            qty = int(a.get("quantity", 1))

            if adj_type in ("damaged", "lost"):
                new_adjusted = max(0, int(p.get("quantity_adjusted", 0)) - qty)
            elif adj_type in ("returned", "found"):
                new_adjusted = int(p.get("quantity_adjusted", 0)) + qty
            else:  # correction
                new_adjusted = int(p.get("quantity_adjusted", 0)) - qty

            db.update("ci_products", {"quantity_adjusted": new_adjusted}, {"id": f"eq.{a['product_id']}"})

    ok_del = db.delete("ci_stock_adjustments", {"id": f"eq.{aid}"})
    return ok() if ok_del else fail("delete failed", 500)


# ============================================================
# EXPENSES (Operating - INR)
# ============================================================

@api.get("/api/expenses")
def list_expenses():
    rows = db.query("ci_expenses", order="expense_date.desc,created_at.desc")
    return ok(rows)

@api.post("/api/expenses")
def create_expense():
    d = request.get_json()
    if not d.get("amount_inr"):
        return fail("amount_inr required")
    row = db.insert("ci_expenses", d)
    if row is None:
        return fail("insert failed", 500)
    return ok(row)

@api.delete("/api/expenses/<eid>")
def delete_expense(eid):
    ok_del = db.delete("ci_expenses", {"id": f"eq.{eid}"})
    return ok() if ok_del else fail("delete failed", 500)


# ============================================================
# REVENUE (INR)
# ============================================================

@api.get("/api/revenue")
def list_revenue():
    rows = db.query("ci_revenue", order="revenue_date.desc,created_at.desc")
    return ok(rows)

@api.post("/api/revenue")
def create_revenue():
    d = request.get_json()
    if not d.get("amount_inr"):
        return fail("amount_inr required")
    row = db.insert("ci_revenue", d)
    if row is None:
        return fail("insert failed", 500)
    return ok(row)

@api.delete("/api/revenue/<rid>")
def delete_revenue(rid):
    ok_del = db.delete("ci_revenue", {"id": f"eq.{rid}"})
    return ok() if ok_del else fail("delete failed", 500)


# ============================================================
# DASHBOARD / ANALYTICS
# ============================================================

@api.get("/api/dashboard/summary")
def dashboard_summary():
    # Date range filter (optional — defaults to All Time)
    start_date = request.args.get("start_date")
    end_date = request.args.get("end_date")

    consignments = db.query("ci_consignments")
    products = db.query("ci_products")
    sales = db.query("ci_sales")
    sale_items = db.query("ci_sale_items")
    expenses = db.query("ci_expenses")
    revenue = db.query("ci_revenue")
    cons_expenses = db.query("ci_consignment_expenses")
    adjustments = db.query("ci_stock_adjustments")

    # Filter sales, expenses, revenue by date range
    filtered_sales = [s for s in sales if in_date_range(s.get("sale_date"), start_date, end_date)]
    filtered_expenses = [e for e in expenses if in_date_range(e.get("expense_date"), start_date, end_date)]
    filtered_revenue = [r for r in revenue if in_date_range(r.get("revenue_date"), start_date, end_date)]

    # Sale items belonging to filtered sales
    filtered_sale_ids = {s["id"] for s in filtered_sales}
    filtered_sale_items = [si for si in sale_items if si.get("sale_id") in filtered_sale_ids]

    # ── Inventory Summary ── (always full — not date-filtered)
    total_imported = sum(int(p.get("quantity_imported", 0)) for p in products)
    total_sold = sum(int(p.get("quantity_sold", 0)) for p in products)
    total_allocated = sum(int(p.get("quantity_allocated", 0)) for p in products)
    total_adjusted = sum(int(p.get("quantity_adjusted", 0)) for p in products)
    total_remaining = total_imported - total_sold - total_allocated - total_adjusted

    # Inventory value (remaining × proportional unit_landed_inr per product)
    inventory_value = 0
    for p in products:
        remaining = int(p.get("quantity_imported", 0)) - int(p.get("quantity_sold", 0)) - int(p.get("quantity_allocated", 0)) - int(p.get("quantity_adjusted", 0))
        if remaining > 0:
            cons = [c for c in consignments if c["id"] == p.get("consignment_id")]
            if cons:
                c = cons[0]
                c_products = [pp for pp in products if pp.get("consignment_id") == c["id"]]
                c_exps = [e for e in cons_expenses if e.get("consignment_id") == c["id"]]
                landed = calc_product_landed(p, c, c_products, c_exps)
                unit_landed = landed["unit_landed_inr"]
            else:
                unit_landed = float(p.get("unit_cost_usd", 0)) * 84.0
            inventory_value += remaining * unit_landed

    # ── P&L (Amortized) — using filtered data ──
    total_sales_revenue = sum(float(s.get("final_amount", 0)) for s in filtered_sales)

    total_cogs = sum(
        float(si.get("unit_cogs_inr", 0)) * int(si.get("quantity", 0))
        for si in filtered_sale_items
    )
    total_freight_cost = sum(
        float(si.get("unit_freight_inr", 0)) * int(si.get("quantity", 0))
        for si in filtered_sale_items
    )
    total_handling_cost = sum(
        float(si.get("unit_handling_inr", 0)) * int(si.get("quantity", 0))
        for si in filtered_sale_items
    )
    total_landed_cogs = total_cogs + total_freight_cost + total_handling_cost

    gross_profit = total_sales_revenue - total_landed_cogs

    total_operating_expenses = sum(float(e.get("amount_inr", 0)) for e in filtered_expenses)
    total_other_revenue = sum(float(r.get("amount_inr", 0)) for r in filtered_revenue)

    net_profit = gross_profit - total_operating_expenses + total_other_revenue

    # ── Per-consignment breakdown ── (using filtered sale items)
    consignment_pl = []
    for c in consignments:
        c_products = [p for p in products if p.get("consignment_id") == c["id"]]
        c_total_qty = sum(int(p.get("quantity_imported", 0)) for p in c_products)
        c_sold_qty = sum(int(p.get("quantity_sold", 0)) for p in c_products)
        c_remaining = c_total_qty - c_sold_qty - sum(int(p.get("quantity_allocated", 0)) for p in c_products) - sum(int(p.get("quantity_adjusted", 0)) for p in c_products)

        rate = float(c.get("usd_inr_rate", 84.0))
        c_cogs_usd = float(c.get("total_cogs_usd", 0))
        c_freight_usd = float(c.get("total_freight_usd", 0))
        inr_cogs = c_cogs_usd * rate
        inr_freight = c_freight_usd * rate
        c_handling = sum(float(e.get("amount_inr", 0))
                        for e in cons_expenses if e.get("consignment_id") == c["id"])
        c_exps = [e for e in cons_expenses if e.get("consignment_id") == c["id"]]
        total_landed = inr_cogs + inr_freight + c_handling

        # Inventory value using proportional landed costs
        c_inv_value = 0
        for p in c_products:
            pr = int(p.get("quantity_imported", 0)) - int(p.get("quantity_sold", 0))
            if pr > 0:
                landed = calc_product_landed(p, c, c_products, c_exps)
                c_inv_value += pr * landed["unit_landed_inr"]

        # Reconciliation
        products_cogs_sum_usd = sum(
            float(p.get("unit_cost_usd", 0)) * int(p.get("quantity_imported", 0))
            for p in c_products
        )

        c_sale_items = [si for si in filtered_sale_items
                        if si.get("product_id") in [p["id"] for p in c_products]]
        c_revenue = sum(float(si.get("selling_price", 0)) * int(si.get("quantity", 0))
                        for si in c_sale_items)
        c_cogs_sold = sum(float(si.get("unit_cogs_inr", 0)) * int(si.get("quantity", 0))
                          for si in c_sale_items)
        c_freight_sold = sum(float(si.get("unit_freight_inr", 0)) * int(si.get("quantity", 0))
                             for si in c_sale_items)
        c_handling_sold = sum(float(si.get("unit_handling_inr", 0)) * int(si.get("quantity", 0))
                               for si in c_sale_items)
        c_profit = c_revenue - c_cogs_sold - c_freight_sold - c_handling_sold

        consignment_pl.append({
            "id": c["id"],
            "name": c.get("name"),
            "invoice_date": c.get("invoice_date"),
            "usd_inr_rate": rate,
            "total_cogs_usd": c_cogs_usd,
            "total_freight_usd": c_freight_usd,
            "total_landed_inr": round(total_landed, 2),
            "handling_inr": round(c_handling, 2),
            "total_qty": c_total_qty,
            "sold_qty": c_sold_qty,
            "remaining_qty": c_remaining,
            "inventory_value": round(c_inv_value, 2),
            "revenue": round(c_revenue, 2),
            "cogs": round(c_cogs_sold + c_freight_sold + c_handling_sold, 2),
            "profit": round(c_profit, 2),
            "margin_pct": round((c_profit / c_revenue * 100) if c_revenue > 0 else 0, 1),
            "recon_products_usd": round(products_cogs_sum_usd, 2),
            "recon_consignment_usd": c_cogs_usd,
            "recon_diff_usd": round(products_cogs_sum_usd - c_cogs_usd, 2),
            "recon_ok": abs(products_cogs_sum_usd - c_cogs_usd) < 0.01,
        })

    recent_sales = sorted(filtered_sales, key=lambda s: s.get("sale_date", ""), reverse=True)[:5]

    # ── Revenue Breakdown by Source (filtered) ──
    sales_by_channel = {}
    for s in filtered_sales:
        ch = s.get("channel", "other")
        sales_by_channel[ch] = sales_by_channel.get(ch, 0) + float(s.get("final_amount", 0))

    revenue_by_source = {}
    for r in filtered_revenue:
        src = r.get("source", "other")
        revenue_by_source[src] = revenue_by_source.get(src, 0) + float(r.get("amount_inr", 0))

    # ── Adjustment Summary (full — not date-filtered) ──
    adjustments_by_type = {}
    for a in adjustments:
        at = a.get("adjustment_type", "other")
        adjustments_by_type[at] = adjustments_by_type.get(at, 0) + int(a.get("quantity", 0))

    # ── Sales Trend (grouped by week or month) ──
    if filtered_sales:
        # Determine grouping: if range > 90 days use monthly, else weekly
        if start_date and end_date:
            d1 = datetime.strptime(start_date, "%Y-%m-%d")
            d2 = datetime.strptime(end_date, "%Y-%m-%d")
            span_days = (d2 - d1).days
        else:
            span_days = 365  # default to monthly for all-time

        trend_group = "month" if span_days > 90 else "week"

        # Build a lookup: sale_id -> sale_date
        sale_date_map = {s["id"]: s.get("sale_date", "") for s in filtered_sales}

        # Group by period
        trend_data = defaultdict(lambda: {"revenue": 0, "cogs": 0, "profit": 0})
        for si in filtered_sale_items:
            sid = si.get("sale_id")
            sdate = sale_date_map.get(sid, "")
            if not sdate:
                continue
            dt = datetime.strptime(sdate, "%Y-%m-%d")
            if trend_group == "month":
                key = dt.strftime("%Y-%m")
            else:
                # ISO week: YYYY-Www
                key = f"{dt.isocalendar()[0]}-W{dt.isocalendar()[1]:02d}"

            qty = int(si.get("quantity", 0))
            rev = float(si.get("selling_price", 0)) * qty
            cogs_val = (float(si.get("unit_cogs_inr", 0)) + float(si.get("unit_freight_inr", 0)) + float(si.get("unit_handling_inr", 0))) * qty
            trend_data[key]["revenue"] += rev
            trend_data[key]["cogs"] += cogs_val
            trend_data[key]["profit"] += (rev - cogs_val)

        # Sort by period key
        sales_trend = [
            {"period": k, "revenue": round(v["revenue"], 2), "cogs": round(v["cogs"], 2), "profit": round(v["profit"], 2)}
            for k, v in sorted(trend_data.items())
        ]
    else:
        sales_trend = []

    return ok({
        "inventory": {
            "total_imported": total_imported,
            "total_sold": total_sold,
            "total_allocated": total_allocated,
            "total_adjusted": total_adjusted,
            "total_remaining": total_remaining,
            "inventory_value": round(inventory_value, 2),
        },
        "pnl": {
            "sales_revenue": round(total_sales_revenue, 2),
            "total_cogs": round(total_landed_cogs, 2),
            "gross_profit": round(gross_profit, 2),
            "gross_margin_pct": round((gross_profit / total_sales_revenue * 100) if total_sales_revenue > 0 else 0, 1),
            "operating_expenses": round(total_operating_expenses, 2),
            "other_revenue": round(total_other_revenue, 2),
            "net_profit": round(net_profit, 2),
            "net_margin_pct": round((net_profit / total_sales_revenue * 100) if total_sales_revenue > 0 else 0, 1),
        },
        "consignment_pl": consignment_pl,
        "recent_sales": recent_sales,
        "consignment_count": len(consignments),
        "product_count": len(products),
        "revenue_breakdown": {
            "sales_by_channel": {k: round(v, 2) for k, v in sales_by_channel.items()},
            "revenue_by_source": {k: round(v, 2) for k, v in revenue_by_source.items()},
            "total_sales": round(sum(sales_by_channel.values()), 2),
            "total_other_revenue": round(sum(revenue_by_source.values()), 2),
        },
        "adjustments_summary": adjustments_by_type,
        "sales_trend": sales_trend,
    })


@api.get("/api/dashboard/inventory")
def inventory_detail():
    products = db.query("ci_products")
    consignments = db.query("ci_consignments")
    cons_expenses = db.query("ci_consignment_expenses")
    adjustments = db.query("ci_stock_adjustments")

    result = []
    for p in products:
        cons = [c for c in consignments if c["id"] == p.get("consignment_id")]
        consignment_name = cons[0].get("name", "Unknown") if cons else "Unknown"

        remaining = int(p.get("quantity_imported", 0)) - int(p.get("quantity_sold", 0)) - int(p.get("quantity_allocated", 0)) - int(p.get("quantity_adjusted", 0))
        if cons:
            c = cons[0]
            c_products = [pp for pp in products if pp.get("consignment_id") == c["id"]]
            c_exps = [e for e in cons_expenses if e.get("consignment_id") == c["id"]]
            landed = calc_product_landed(p, c, c_products, c_exps)
            unit_landed_inr = landed["unit_landed_inr"]
            unit_landed_usd = float(p.get("unit_cost_usd", 0))
        else:
            unit_landed_inr = float(p.get("unit_cost_usd", 0)) * 84.0
            unit_landed_usd = float(p.get("unit_cost_usd", 0))

        # Get adjustments for this product
        product_adjustments = [a for a in adjustments if a.get("product_id") == p["id"]]
        total_damaged = sum(int(a.get("quantity", 0)) for a in product_adjustments if a.get("adjustment_type") == "damaged")
        total_lost = sum(int(a.get("quantity", 0)) for a in product_adjustments if a.get("adjustment_type") == "lost")
        total_returned = sum(int(a.get("quantity", 0)) for a in product_adjustments if a.get("adjustment_type") == "returned")

        result.append({
            "id": p["id"],
            "consignment_name": consignment_name,
            "product_name": p.get("product_name"),
            "brand": p.get("brand"),
            "category": p.get("category"),
            "variant": p.get("variant"),
            "quantity_imported": int(p.get("quantity_imported", 0)),
            "quantity_sold": int(p.get("quantity_sold", 0)),
            "quantity_allocated": int(p.get("quantity_allocated", 0)),
            "quantity_adjusted": int(p.get("quantity_adjusted", 0)),
            "quantity_remaining": remaining,
            "sellable": remaining,
            "unit_cost_usd": round(unit_landed_usd, 2),
            "unit_landed_inr": round(unit_landed_inr, 2),
            "inventory_value_inr": round(remaining * unit_landed_inr, 2),
            "line_value_usd": round(float(p.get("unit_cost_usd", 0)) * int(p.get("quantity_imported", 0)), 2),
            "status": p.get("status"),
            "adjustments": {
                "damaged": total_damaged,
                "lost": total_lost,
                "returned": total_returned,
            },
        })

    return ok(result)


# ============================================================
# XINGLETOY PRICE LOOKUP (config stored in Supabase)
# ============================================================

DEFAULT_XINGLE_CONFIG = {
    "token": "",
    "usd_inr_rate": 84.0,
    "freight_pct": 8.0,
    "handling_inr_per_unit": 30.0,
    "customs_duty_pct": 10.0,
    "markup": 1.4,
}


def _load_xingle_config():
    rows = db.query("ci_xingle_config", filters={"id": "eq.default"})
    if rows:
        cfg = rows[0].get("config", {})
        if isinstance(cfg, str):
            cfg = json.loads(cfg)
        return {**DEFAULT_XINGLE_CONFIG, **cfg}
    return dict(DEFAULT_XINGLE_CONFIG)


def _save_xingle_config(cfg):
    db.update(
        "ci_xingle_config",
        {"config": cfg, "updated_at": datetime.utcnow().isoformat() + "Z"},
        {"id": "eq.default"},
    )


@api.get("/api/xingle/config")
def get_xingle_config():
    cfg = _load_xingle_config()
    masked = cfg.get("token", "")
    if len(masked) > 10:
        masked = masked[:6] + "..." + masked[-4:]
    elif masked:
        masked = "***set***"
    else:
        masked = ""
    return ok({
        "token_set": bool(cfg.get("token")),
        "token_masked": masked,
        "usd_inr_rate": cfg.get("usd_inr_rate", 84.0),
        "freight_pct": cfg.get("freight_pct", 8.0),
        "handling_inr_per_unit": cfg.get("handling_inr_per_unit", 30.0),
        "customs_duty_pct": cfg.get("customs_duty_pct", 10.0),
        "markup": cfg.get("markup", 1.4),
    })


@api.post("/api/xingle/config")
def update_xingle_config():
    d = request.get_json()
    cfg = _load_xingle_config()
    if "token" in d:
        cfg["token"] = d["token"].strip()
    if "usd_inr_rate" in d:
        cfg["usd_inr_rate"] = float(d["usd_inr_rate"])
    if "freight_pct" in d:
        cfg["freight_pct"] = float(d["freight_pct"])
    if "handling_inr_per_unit" in d:
        cfg["handling_inr_per_unit"] = float(d["handling_inr_per_unit"])
    if "customs_duty_pct" in d:
        cfg["customs_duty_pct"] = float(d["customs_duty_pct"])
    if "markup" in d:
        cfg["markup"] = float(d["markup"])
    _save_xingle_config(cfg)
    return ok({"msg": "Config saved"})


@api.post("/api/xingle/search")
def xingle_search():
    d = request.get_json()
    keyword = d.get("keyword", "").strip()
    if not keyword:
        return fail("keyword required")

    cfg = _load_xingle_config()
    token = cfg.get("token", "")
    if not token:
        return fail("XingleToy API token not configured. Go to Settings tab and set your Bearer token.", 400)

    xingle_body = json.dumps({
        "keyword": keyword,
        "page": 1,
        "recPerPage": 50,
    }).encode("utf-8")

    xingle_headers = {
        "Authorization": f"Bearer {token}",
        "x-lang-type": "en",
        "x-price-type": "USD",
        "accept": "application/json",
        "Content-Type": "application/json",
    }

    req = _urllib.Request(
        "https://mallapi.xingletoy.com/api/items/search",
        data=xingle_body,
        headers=xingle_headers,
        method="POST",
    )

    try:
        with _urllib.urlopen(req, timeout=15) as resp:
            result = json.loads(resp.read().decode("utf-8"))
    except _urllib.HTTPError as e:
        body = e.read().decode("utf-8", errors="replace")
        if e.code == 401:
            return fail("XingleToy API token expired or invalid. Update your Bearer token in Settings.", 401)
        return fail(f"XingleToy API error ({e.code}): {body[:200]}", e.code)
    except Exception as e:
        return fail(f"Failed to reach XingleToy API: {str(e)}", 502)

    items = result.get("data", [])
    pager = result.get("pager", {})

    rate = cfg["usd_inr_rate"]
    freight_pct = cfg["freight_pct"]
    handling_inr = cfg["handling_inr_per_unit"]
    customs_pct = cfg["customs_duty_pct"]

    enriched = []
    for item in items:
        base_usd = float(item.get("price", 0))
        base_inr = base_usd * rate
        freight_inr = base_inr * (freight_pct / 100)
        customs_inr = base_inr * (customs_pct / 100)
        landed_inr = base_inr + freight_inr + customs_inr + handling_inr

        enriched.append({
            "id": item.get("id", ""),
            "name": item.get("name", ""),
            "types": item.get("types", []),
            "base_usd": round(base_usd, 2),
            "base_inr": round(base_inr, 2),
            "freight_inr": round(freight_inr, 2),
            "customs_inr": round(customs_inr, 2),
            "handling_inr": round(handling_inr, 2),
            "landed_inr": round(landed_inr, 2),
            "discount_pct": item.get("discountPercent", 0),
            "moq": item.get("moq", 1),
            "thumbnail": item.get("thumbnail", ""),
            "tags": [t.get("name", "") for t in item.get("tags", [])],
            "hot": item.get("hot", False),
            "newest": item.get("newest", False),
        })

    return ok({
        "items": enriched,
        "total": pager.get("recTotal", len(enriched)),
        "page": pager.get("page", 1),
        "config": {
            "usd_inr_rate": rate,
            "freight_pct": freight_pct,
            "handling_inr_per_unit": handling_inr,
            "customs_duty_pct": customs_pct,
        },
    })
