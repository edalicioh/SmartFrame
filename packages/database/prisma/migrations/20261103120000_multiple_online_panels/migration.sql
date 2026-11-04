-- Keep existing drafts and published versions in place. Only associate devices
-- with their existing online layout; no credentials or media are changed.
ALTER TABLE "Device" ADD COLUMN "activePanelId" TEXT REFERENCES "Layout"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Device" ADD COLUMN "activePanelVersionId" TEXT REFERENCES "LayoutVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

UPDATE "Device"
SET "activePanelId" = (
      SELECT "id" FROM "Layout"
      WHERE "key" = 'online:' || "Device"."id" AND "householdId" = "Device"."householdId"
    ),
    "activePanelVersionId" = (
      SELECT "publishedVersionId" FROM "Layout"
      WHERE "key" = 'online:' || "Device"."id" AND "householdId" = "Device"."householdId"
    );
