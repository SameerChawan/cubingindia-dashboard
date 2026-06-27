-- CubingIndia Dashboard - Migration Script (v3 → v4)
-- Run this in Supabase SQL Editor to add stock adjustments + charts support
-- WITHOUT losing existing data

-- ============================================================
-- 1. Create ci_stock_adjustments table (new - damaged/lost/returned)
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

CREATE INDEX IF NOT EXISTS idx_adjustments_product ON ci_stock_adjustments(product_id);
CREATE INDEX IF NOT EXISTS idx_adjustments_date ON ci_stock_adjustments(adjustment_date);
CREATE INDEX IF NOT EXISTS idx_adjustments_type ON ci_stock_adjustments(adjustment_type);

ALTER TABLE ci_stock_adjustments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all on ci_stock_adjustments" ON ci_stock_adjustments FOR ALL USING (true) WITH CHECK (true);

-- ============================================================
-- 2. Add quantity_adjusted to ci_products (tracks damaged/lost/returned)
-- ============================================================
ALTER TABLE ci_products ADD COLUMN IF NOT EXISTS quantity_adjusted INT NOT NULL DEFAULT 0;

-- Update quantity_remaining to include adjustments
ALTER TABLE ci_products DROP COLUMN IF EXISTS quantity_remaining;
ALTER TABLE ci_products ADD COLUMN quantity_remaining INT
    GENERATED ALWAYS AS (quantity_imported - quantity_sold - quantity_allocated - quantity_adjusted) STORED;

-- ============================================================
-- Done! Existing data is untouched.
-- ============================================================
