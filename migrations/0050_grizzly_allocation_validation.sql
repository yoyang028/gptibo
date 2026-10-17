-- Supplier identity can be saved before validation finishes. A crash in that
-- interval must require review rather than delivering an unchecked number.
ALTER TABLE grizzly_activations ADD COLUMN verified INTEGER NOT NULL DEFAULT 0 CHECK(verified IN (0,1));
UPDATE grizzly_activations SET verified=1 WHERE state IN ('waiting','received','cancelled') AND cost_usd IS NOT NULL;
