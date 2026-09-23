-- SDK 0.11.5 marks ctx.promise() with resonate:scope=global.
-- The pinned upstream SQL does not count that tag as external, so its
-- task.suspend path rejects a valid durable wait with status 422.
-- The SDK fix adds resonate:external=true (resonate-sdk-ts@a3a3ccf);
-- remove this migration after upgrading to a published version with that fix.
ALTER TABLE resonate.promises DROP COLUMN external;
ALTER TABLE resonate.promises ADD COLUMN external boolean NOT NULL GENERATED ALWAYS AS (
  COALESCE(tags->>'resonate:scope', '') = 'global'
  OR tags->>'resonate:target' IS NOT NULL
  OR COALESCE(tags->>'resonate:timer', '') = 'true'
  OR COALESCE(tags->>'resonate:external', '') = 'true'
) STORED;
