-- CreateTable
CREATE TABLE "WidgetSnapshot" (
    "key" TEXT NOT NULL PRIMARY KEY,
    "payload" JSONB NOT NULL,
    "updatedAt" DATETIME NOT NULL,
    "expiresAt" DATETIME NOT NULL,
    "failedAt" DATETIME
);
