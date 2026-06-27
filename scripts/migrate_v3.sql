-- CubingIndia Dashboard - Migration Script (v2 → v3)
-- Run this in Supabase SQL Editor to add stock allocation + auth
-- WITHOUT losing existing data

-- ============================================================
-- 1. Create ci_users table (new - authentication)
-- ============================================================
CREATE TABLE IF NOT EXISTS ci_users (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    display_name TEXT,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- ============================================================
-- 2. Add quantity_allocated to ci_products
-- ============================================================
ALTER TABLE ci_products ADD COLUMN IF NOT EXISTS quantity_allocated INT NOT NULL DEFAULT 0;

-- Recompute quantity_remaining to include allocated
-- First drop the old generated column
ALTER TABLE ci_products DROP COLUMN IF EXISTS quantity_remaining;
-- Then add the new one that subtracts allocated
ALTER TABLE ci_products ADD COLUMN quantity_remaining INT
    GENERATED ALWAYS AS (quantity_imported - quantity_sold - quantity_allocated) STORED;

-- ============================================================
-- 3. Create ci_stock_allocations table (new)
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

CREATE INDEX IF NOT EXISTS idx_allocations_product ON ci_stock_allocations(product_id);

ALTER TABLE ci_stock_allocations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all on ci_stock_allocations" ON ci_stock_allocations FOR ALL USING (true) WITH CHECK (true);

ALTER TABLE ci_users ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all on ci_users" ON ci_users FOR ALL USING (true) WITH CHECK (true);

-- ============================================================
-- Done! Existing data is untouched.
-- ============================================================
