CREATE TABLE "DevicePanelAccess" (
    "deviceId" TEXT NOT NULL,
    "panelId" TEXT NOT NULL,
    "versionId" TEXT NOT NULL,
    PRIMARY KEY ("deviceId", "panelId"),
    FOREIGN KEY ("deviceId") REFERENCES "Device" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    FOREIGN KEY ("panelId") REFERENCES "Layout" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    FOREIGN KEY ("versionId") REFERENCES "LayoutVersion" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "DevicePanelAccess_panelId_idx" ON "DevicePanelAccess"("panelId");
CREATE INDEX "DevicePanelAccess_versionId_idx" ON "DevicePanelAccess"("versionId");
INSERT INTO "DevicePanelAccess" ("deviceId", "panelId", "versionId")
SELECT d."id", l."id", v."id" FROM "Device" d
JOIN "Layout" l ON l."id" = d."activePanelId" AND l."householdId" = d."householdId"
JOIN "LayoutVersion" v ON v."id" = d."activePanelVersionId" AND v."layoutId" = l."id"
WHERE d."revokedAt" IS NULL;
