-- Reset script — WIPES the schema for a clean slate during development/testing.
-- Run via Supabase SQL Editor.
--
-- !!! WARNING: this DROPS the tables entirely (not just their rows). !!!
-- All data is permanently destroyed, and the tables no longer exist until
-- schema.sql is run again. This is intentional: TRUNCATE preserves the old
-- table structure and cannot apply a schema change (new/removed columns,
-- new constraints, etc). Data at this stage of the project is disposable
-- test data.
--
-- To apply a schema change to an existing dev database:
--   1. Run this file (reset.sql) to drop the tables.
--   2. Run schema.sql to recreate them in their current, target shape.

DROP TABLE IF EXISTS collector_runs;
DROP TABLE IF EXISTS content_items;
