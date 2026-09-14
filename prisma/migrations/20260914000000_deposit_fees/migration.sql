ALTER TABLE "Deposit"
  ADD COLUMN "creditedAmount" DECIMAL(19, 8),
  ADD COLUMN "providerFee" DECIMAL(19, 8),
  ADD COLUMN "reepayFee" DECIMAL(19, 8),
  ADD COLUMN "totalDebit" DECIMAL(19, 8);

UPDATE "Deposit"
SET
  "creditedAmount" = "amount",
  "providerFee" = 0,
  "reepayFee" = 0,
  "totalDebit" = "amount"
WHERE
  "creditedAmount" IS NULL
  OR "providerFee" IS NULL
  OR "reepayFee" IS NULL
  OR "totalDebit" IS NULL;

ALTER TABLE "Deposit"
  ALTER COLUMN "creditedAmount" SET NOT NULL,
  ALTER COLUMN "providerFee" SET NOT NULL,
  ALTER COLUMN "reepayFee" SET NOT NULL,
  ALTER COLUMN "totalDebit" SET NOT NULL;
