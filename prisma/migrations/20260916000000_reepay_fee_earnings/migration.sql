CREATE TYPE "ReepayAdminRole" AS ENUM ('OWNER');

CREATE TYPE "ReepayFeeSourceType" AS ENUM ('DEPOSIT', 'WALLET_CONVERSION', 'PAYOUT');

CREATE TYPE "ReepayFeeEarningStatus" AS ENUM ('REALIZED', 'REVERSED');

CREATE TABLE "ReepayAdminUser" (
  "id" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "role" "ReepayAdminRole" NOT NULL DEFAULT 'OWNER',
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "ReepayAdminUser_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ReepayFeeEarning" (
  "id" TEXT NOT NULL,
  "sourceType" "ReepayFeeSourceType" NOT NULL,
  "sourceId" TEXT NOT NULL,
  "amount" DECIMAL(19,8) NOT NULL,
  "currency" "WalletCurrency" NOT NULL,
  "status" "ReepayFeeEarningStatus" NOT NULL DEFAULT 'REALIZED',
  "realizedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "reversedAt" TIMESTAMP(3),
  "depositId" TEXT,
  "conversionId" TEXT,
  "payoutId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "ReepayFeeEarning_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ReepayAdminUser_email_key" ON "ReepayAdminUser"("email");
CREATE UNIQUE INDEX "ReepayFeeEarning_depositId_key" ON "ReepayFeeEarning"("depositId");
CREATE UNIQUE INDEX "ReepayFeeEarning_conversionId_key" ON "ReepayFeeEarning"("conversionId");
CREATE UNIQUE INDEX "ReepayFeeEarning_payoutId_key" ON "ReepayFeeEarning"("payoutId");
CREATE UNIQUE INDEX "ReepayFeeEarning_sourceType_sourceId_key" ON "ReepayFeeEarning"("sourceType", "sourceId");
CREATE INDEX "ReepayFeeEarning_currency_realizedAt_idx" ON "ReepayFeeEarning"("currency", "realizedAt");
CREATE INDEX "ReepayFeeEarning_sourceType_realizedAt_idx" ON "ReepayFeeEarning"("sourceType", "realizedAt");
CREATE INDEX "ReepayFeeEarning_status_realizedAt_idx" ON "ReepayFeeEarning"("status", "realizedAt");

ALTER TABLE "ReepayFeeEarning" ADD CONSTRAINT "ReepayFeeEarning_depositId_fkey" FOREIGN KEY ("depositId") REFERENCES "Deposit"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ReepayFeeEarning" ADD CONSTRAINT "ReepayFeeEarning_conversionId_fkey" FOREIGN KEY ("conversionId") REFERENCES "WalletConversion"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ReepayFeeEarning" ADD CONSTRAINT "ReepayFeeEarning_payoutId_fkey" FOREIGN KEY ("payoutId") REFERENCES "Payout"("id") ON DELETE SET NULL ON UPDATE CASCADE;

INSERT INTO "ReepayFeeEarning" (
  "id",
  "sourceType",
  "sourceId",
  "amount",
  "currency",
  "status",
  "realizedAt",
  "depositId",
  "createdAt"
)
SELECT
  'fee_deposit_' || "id",
  'DEPOSIT'::"ReepayFeeSourceType",
  "id",
  "reepayFee",
  "currency",
  'REALIZED'::"ReepayFeeEarningStatus",
  COALESCE("completedAt", "updatedAt", "createdAt"),
  "id",
  CURRENT_TIMESTAMP
FROM "Deposit"
WHERE "status" = 'COMPLETED' AND "reepayFee" > 0
ON CONFLICT ("sourceType", "sourceId") DO NOTHING;

INSERT INTO "ReepayFeeEarning" (
  "id",
  "sourceType",
  "sourceId",
  "amount",
  "currency",
  "status",
  "realizedAt",
  "conversionId",
  "createdAt"
)
SELECT
  'fee_conversion_' || "id",
  'WALLET_CONVERSION'::"ReepayFeeSourceType",
  "id",
  "reepayFee",
  "sourceCurrency",
  'REALIZED'::"ReepayFeeEarningStatus",
  COALESCE("completedAt", "updatedAt", "createdAt"),
  "id",
  CURRENT_TIMESTAMP
FROM "WalletConversion"
WHERE "status" = 'COMPLETED' AND "reepayFee" > 0
ON CONFLICT ("sourceType", "sourceId") DO NOTHING;

INSERT INTO "ReepayFeeEarning" (
  "id",
  "sourceType",
  "sourceId",
  "amount",
  "currency",
  "status",
  "realizedAt",
  "payoutId",
  "createdAt"
)
SELECT
  'fee_payout_' || "id",
  'PAYOUT'::"ReepayFeeSourceType",
  "id",
  "reepayFee",
  "sourceCurrency",
  'REALIZED'::"ReepayFeeEarningStatus",
  COALESCE("completedAt", "updatedAt", "createdAt"),
  "id",
  CURRENT_TIMESTAMP
FROM "Payout"
WHERE "status" = 'COMPLETED' AND "reepayFee" > 0
ON CONFLICT ("sourceType", "sourceId") DO NOTHING;
