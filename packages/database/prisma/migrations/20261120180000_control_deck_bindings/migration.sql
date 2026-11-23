-- Add ControlDeckBinding table for opaque host-bound Control Deck actions.
CREATE TABLE "ControlDeckBinding" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "householdId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "target" JSONB NOT NULL,
    "idempotent" BOOLEAN NOT NULL DEFAULT false,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ControlDeckBinding_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "Household" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "ControlDeckBinding_householdId_createdAt_idx" ON "ControlDeckBinding"("householdId", "createdAt");
