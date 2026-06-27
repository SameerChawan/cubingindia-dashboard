-- CubingIndia Dashboard - Supabase Schema (v3 - with Stock Allocation + Auth)
-- Run this in Supabase SQL Editor

-- ============================================================
-- 0. USERS (Authentication)
-- ============================================================
CREATE TABLE IF NOT EXISTS ci_users (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    display_name TEXT,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- ============================================================
-- 1. CONSIGNMENTS (Import Batches - USD values)
-- ============================================================
CREATE TABLE IF NOT EXISTS ci_consignments (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    name TEXT NOT NULL,
    supplier TEXT,
    invoice_number TEXT,
    invoice_date DATE,
    total_cogs_usd NUMERIC(12,2) NOT NULL DEFAULT 0,
    total_freight_usd NUMERIC(12,2) NOT NULL DEFAULT 0,
    usd_inr_rate NUMERIC(10,4) NOT NULL DEFAULT 84.00,
    status TEXT DEFAULT 'active' CHECK (status IN ('active', 'closed')),
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- ============================================================
-- 2. PRODUCTS (Items within a consignment - unit cost in USD)
-- ============================================================
CREATE TABLE IF NOT EXISTS ci_products (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    consignment_id UUID NOT NULL REFERENCES ci_consignments(id) ON DELETE CASCADE,
    product_name TEXT NOT NULL,
    brand TEXT,
    category TEXT,
    variant TEXT,
    quantity_imported INT NOT NULL DEFAULT 0,
    unit_cost_usd NUMERIC(10,2) NOT NULL DEFAULT 0,
    quantity_sold INT NOT NULL DEFAULT 0,
    quantity_allocated INT NOT NULL DEFAULT 0,   -- units tagged for company/promotion
    quantity_adjusted INT NOT NULL DEFAULT 0,     -- units damaged/lost/returned
    quantity_remaining INT GENERATED ALWAYS AS (quantity_imported - quantity_sold - quantity_allocated - quantity_adjusted) STORED,
    status TEXT DEFAULT 'in_stock' CHECK (status IN ('in_stock', 'low_stock', 'sold_out', 'damaged')),
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- ============================================================
-- 3. STOCK ALLOCATIONS (Company use, promotion, etc.)
-- ============================================================
CREATE TABLE IF NOT EXISTS ci_stock_allocations (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    product_id UUID NOT NULL REFERENCES ci_products(id) ON DELETE CASCADE,
    allocation_type TEXT NOT NULL CHECK (allocation_type IN ('company_use', 'promotion', 'event', 'other')),
    quantity INT NOT NULL DEFAULT 1,
    allocation_date DATE,
    reason TEXT,
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- ============================================================
-- 4. CONSIGNMENT EXPENSES (Handling, customs, etc. in INR)
-- ============================================================
CREATE TABLE IF NOT EXISTS ci_consignment_expenses (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    consignment_id UUID NOT NULL REFERENCES ci_consignments(id) ON DELETE CASCADE,
    expense_type TEXT NOT NULL,
    amount_inr NUMERIC(10,2) NOT NULL DEFAULT 0,
    expense_date DATE,
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- ============================================================
-- 5. SALES (Transaction Header - in INR)
-- ============================================================
CREATE TABLE IF NOT EXISTS ci_sales (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    sale_date DATE NOT NULL,
    channel TEXT NOT NULL CHECK (channel IN ('shop', 'competition', 'exhibition', 'other')),
    customer_name TEXT,
    total_amount NUMERIC(10,2) NOT NULL DEFAULT 0,
    discount NUMERIC(10,2) DEFAULT 0,
    final_amount NUMERIC(10,2) NOT NULL DEFAULT 0,
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- ============================================================
-- 6. SALE ITEMS (Line items - COGS frozen in INR at sale time)
-- ============================================================
CREATE TABLE IF NOT EXISTS ci_sale_items (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    sale_id UUID NOT NULL REFERENCES ci_sales(id) ON DELETE CASCADE,
    product_id UUID NOT NULL REFERENCES ci_products(id),
    quantity INT NOT NULL DEFAULT 1,
    selling_price NUMERIC(10,2) NOT NULL,
    unit_cogs_inr NUMERIC(10,2) NOT NULL DEFAULT 0,
    unit_freight_inr NUMERIC(10,2) NOT NULL DEFAULT 0,
    unit_handling_inr NUMERIC(10,2) NOT NULL DEFAULT 0,
    line_total NUMERIC(10,2) GENERATED ALWAYS AS (quantity * selling_price) STORED,
    line_profit NUMERIC(10,2) GENERATED ALWAYS AS (
        quantity * (selling_price - unit_cogs_inr - unit_freight_inr - unit_handling_inr)
    ) STORED,
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- ============================================================
-- 7. EXPENSES (Operating expenses in INR)
-- ============================================================
CREATE TABLE IF NOT EXISTS ci_expenses (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    expense_date DATE NOT NULL,
    category TEXT NOT NULL,
    amount_inr NUMERIC(10,2) NOT NULL DEFAULT 0,
    related_sale_id UUID REFERENCES ci_sales(id),
    description TEXT,
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- ============================================================
-- 9. STOCK ADJUSTMENTS (Damaged, Lost, Returned, etc.)
-- ============================================================
CREATE TABLE IF NOT EXISTS ci_stock_adjustments (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    product_id UUID NOT NULL REFERENCES ci_products(id) ON DELETE CASCADE,
    adjustment_type TEXT NOT NULL CHECK (adjustment_type IN ('damaged', 'lost', 'returned', 'found', 'correction')),
    quantity INT NOT NULL DEFAULT 1,
    adjustment_date DATE NOT NULL DEFAULT CURRENT_DATE,
    reason TEXT,
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- ============================================================
-- 10. REVENUE (Competition/exhibition income in INR)
-- ============================================================
CREATE TABLE IF NOT EXISTS ci_revenue (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    revenue_date DATE NOT NULL,
    source TEXT NOT NULL,
    amount_inr NUMERIC(10,2) NOT NULL DEFAULT 0,
    description TEXT,
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- ============================================================
-- INDEXES
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_products_consignment ON ci_products(consignment_id);
CREATE INDEX IF NOT EXISTS idx_products_status ON ci_products(status);
CREATE INDEX IF NOT EXISTS idx_allocations_product ON ci_stock_allocations(product_id);
CREATE INDEX IF NOT EXISTS idx_expenses_consignment ON ci_consignment_expenses(consignment_id);
CREATE INDEX IF NOT EXISTS idx_sales_date ON ci_sales(sale_date);
CREATE INDEX IF NOT EXISTS idx_sales_channel ON ci_sales(channel);
CREATE INDEX IF NOT EXISTS idx_sale_items_sale ON ci_sale_items(sale_id);
CREATE INDEX IF NOT EXISTS idx_sale_items_product ON ci_sale_items(product_id);
CREATE INDEX IF NOT EXISTS idx_expenses_date ON ci_expenses(expense_date);
CREATE INDEX IF NOT EXISTS idx_expenses_category ON ci_expenses(category);
CREATE INDEX IF NOT EXISTS idx_revenue_date ON ci_revenue(revenue_date);
CREATE INDEX IF NOT EXISTS idx_adjustments_product ON ci_stock_adjustments(product_id);
CREATE INDEX IF NOT EXISTS idx_adjustments_date ON ci_stock_adjustments(adjustment_date);
CREATE INDEX IF NOT EXISTS idx_adjustments_type ON ci_stock_adjustments(adjustment_type);

-- ============================================================
-- RLS
-- ============================================================
ALTER TABLE ci_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE ci_consignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE ci_products ENABLE ROW LEVEL SECURITY;
ALTER TABLE ci_stock_allocations ENABLE ROW LEVEL SECURITY;
ALTER TABLE ci_stock_adjustments ENABLE ROW LEVEL SECURITY;
ALTER TABLE ci_consignment_expenses ENABLE ROW LEVEL SECURITY;
ALTER TABLE ci_sales ENABLE ROW LEVEL SECURITY;
ALTER TABLE ci_sale_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE ci_expenses ENABLE ROW LEVEL SECURITY;
ALTER TABLE ci_revenue ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all on ci_users" ON ci_users FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all on ci_consignments" ON ci_consignments FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all on ci_products" ON ci_products FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all on ci_stock_allocations" ON ci_stock_allocations FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all on ci_stock_adjustments" ON ci_stock_adjustments FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all on ci_consignment_expenses" ON ci_consignment_expenses FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all on ci_sales" ON ci_sales FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all on ci_sale_items" ON ci_sale_items FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all on ci_expenses" ON ci_expenses FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all on ci_revenue" ON ci_revenue FOR ALL USING (true) WITH CHECK (true);
