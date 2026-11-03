-- AlterTable
ALTER TABLE "Media" ADD COLUMN "bytes" INTEGER;
ALTER TABLE "Media" ADD COLUMN "height" INTEGER;
ALTER TABLE "Media" ADD COLUMN "sha256" TEXT;
ALTER TABLE "Media" ADD COLUMN "width" INTEGER;

-- CreateTable
CREATE TABLE "LayoutVersion" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "layoutId" TEXT NOT NULL,
    "config" JSONB NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "LayoutVersion_layoutId_fkey" FOREIGN KEY ("layoutId") REFERENCES "Layout" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PairingCode" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "householdId" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "expiresAt" DATETIME NOT NULL,
    "redeemedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PairingCode_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "Household" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "RequestLimit" (
    "key" TEXT NOT NULL PRIMARY KEY,
    "windowStart" DATETIME NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 1
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Layout" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "householdId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "key" TEXT,
    "draft" JSONB,
    "draftRevision" INTEGER NOT NULL DEFAULT 0,
    "publishedVersionId" TEXT,
    CONSTRAINT "Layout_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "Household" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Layout_publishedVersionId_fkey" FOREIGN KEY ("publishedVersionId") REFERENCES "LayoutVersion" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Layout" ("createdAt", "householdId", "id", "name") SELECT "createdAt", "householdId", "id", "name" FROM "Layout";
DROP TABLE "Layout";
ALTER TABLE "new_Layout" RENAME TO "Layout";
CREATE UNIQUE INDEX "Layout_key_key" ON "Layout"("key");
CREATE INDEX "Layout_householdId_idx" ON "Layout"("householdId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "LayoutVersion_layoutId_createdAt_idx" ON "LayoutVersion"("layoutId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "PairingCode_codeHash_key" ON "PairingCode"("codeHash");

-- CreateIndex
CREATE INDEX "PairingCode_expiresAt_idx" ON "PairingCode"("expiresAt");
