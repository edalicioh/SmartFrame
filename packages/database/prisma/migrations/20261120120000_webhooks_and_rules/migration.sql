-- Add inbound webhook keys, device notifications and remote page/refresh directives.
ALTER TABLE "Device" ADD COLUMN "targetPageId" TEXT;
ALTER TABLE "Device" ADD COLUMN "targetPageNonce" TEXT;
ALTER TABLE "Device" ADD COLUMN "targetPageDuration" INTEGER;
ALTER TABLE "Device" ADD COLUMN "targetPageExpiresAt" DATETIME;
ALTER TABLE "Device" ADD COLUMN "refreshRequestedAt" DATETIME;

CREATE TABLE "WebhookKey" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "householdId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "keyHash" TEXT NOT NULL,
    "keyPrefix" TEXT NOT NULL,
    "permissions" TEXT NOT NULL DEFAULT 'push,notify,goto,refresh',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" DATETIME,
    "revokedAt" DATETIME,
    CONSTRAINT "WebhookKey_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "Household" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "WebhookKey_keyHash_key" ON "WebhookKey"("keyHash");
CREATE INDEX "WebhookKey_householdId_revokedAt_idx" ON "WebhookKey"("householdId", "revokedAt");

CREATE TABLE "DeviceNotification" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "householdId" TEXT NOT NULL,
    "deviceId" TEXT,
    "title" TEXT,
    "message" TEXT NOT NULL,
    "severity" TEXT NOT NULL DEFAULT 'info',
    "durationSeconds" INTEGER NOT NULL DEFAULT 8,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" DATETIME NOT NULL,
    "dismissedAt" DATETIME,
    CONSTRAINT "DeviceNotification_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "Household" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "DeviceNotification_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "Device" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "DeviceNotification_householdId_expiresAt_idx" ON "DeviceNotification"("householdId", "expiresAt");
CREATE INDEX "DeviceNotification_deviceId_expiresAt_idx" ON "DeviceNotification"("deviceId", "expiresAt");
