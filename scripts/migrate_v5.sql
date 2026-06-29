-- CubingIndia Dashboard - Migration Script (v4 → v5)
-- Run this in Supabase SQL Editor to add XingleToy config storage
-- WITHOUT losing existing data

-- ============================================================
-- 1. Create ci_xingle_config table (single-row config store)
-- ============================================================
CREATE TABLE IF NOT EXISTS ci_xingle_config (
    id TEXT PRIMARY KEY DEFAULT 'default',
    config JSONB NOT NULL DEFAULT '{}',
    updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE ci_xingle_config ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all on ci_xingle_config" ON ci_xingle_config FOR ALL USING (true) WITH CHECK (true);

-- Insert default config row (empty token, default cost params)
INSERT INTO ci_xingle_config (id, config, updated_at)
VALUES (
    'default',
    '{
        "token": "",
        "usd_inr_rate": 84.0,
        "freight_pct": 8.0,
        "handling_inr_per_unit": 30.0,
        "customs_duty_pct": 10.0,
        "markup": 1.4
    }'::jsonb,
    now()
)
ON CONFLICT (id) DO NOTHING;

-- ============================================================
-- Done! Existing data is untouched.
-- ============================================================
