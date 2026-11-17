-- The next run number per track. An encore win takes a run number without a death, so after one
-- deaths + 1 is no longer the next run (it would collide with the win's row and lose the next run).
ALTER TABLE world ADD COLUMN IF NOT EXISTS next_run integer;
