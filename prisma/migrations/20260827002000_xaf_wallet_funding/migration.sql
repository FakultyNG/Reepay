-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "WalletCurrency" AS ENUM ('XAF', 'EUR', 'USDC');

-- CreateEnum
CREATE TYPE "WalletStatus" AS ENUM ('ACTIVE', 'FROZEN');

-- CreateEnum
CREATE TYPE "DepositStatus" AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED', 'CANCELLED', 'REFUNDED');

-- CreateEnum
CREATE TYPE "TransactionType" AS ENUM ('WALLET_FUNDING', 'WALLET_CONVERSION', 'WALLET_CONVERSION_REVERSAL', 'EUR_PAYOUT', 'USDC_PAYOUT', 'PAYOUT_REVERSAL');

-- CreateEnum
CREATE TYPE "TransactionStatus" AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED', 'REFUNDED');

-- CreateEnum
CREATE TYPE "PayoutStatus" AS ENUM ('QUOTED', 'PENDING', 'PROCESSING', 'COMPLETED', 'FAILED', 'CANCELLED', 'REFUNDED');

-- CreateEnum
CREATE TYPE "WalletConversionStatus" AS ENUM ('QUOTED', 'PENDING', 'PROCESSING', 'COMPLETED', 'FAILED', 'REFUNDED');

-- CreateEnum
CREATE TYPE "LedgerEntryType" AS ENUM ('CREDIT', 'DEBIT');

-- CreateEnum
CREATE TYPE "NotificationEventType" AS ENUM ('DEPOSIT_COMPLETED', 'DEPOSIT_FAILED', 'WALLET_CONVERSION_PROCESSING', 'WALLET_CONVERSION_COMPLETED', 'WALLET_CONVERSION_FAILED', 'PAYOUT_PROCESSING', 'PAYOUT_COMPLETED', 'PAYOUT_FAILED', 'PAYOUT_REFUNDED');

-- CreateEnum
CREATE TYPE "WebhookProcessingStatus" AS ENUM ('PENDING', 'PROCESSING', 'PROCESSED', 'FAILED', 'IGNORED');

-- CreateEnum
CREATE TYPE "OutboundWebhookDeliveryStatus" AS ENUM ('PENDING', 'DELIVERED', 'FAILED', 'DISABLED');

-- CreateTable
CREATE TABLE "Customer" (
    "id" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Customer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Wallet" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "currency" "WalletCurrency" NOT NULL,
    "balance" DECIMAL(19,8) NOT NULL DEFAULT 0,
    "status" "WalletStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Wallet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Deposit" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "walletId" TEXT,
    "amount" DECIMAL(19,8) NOT NULL,
    "currency" "WalletCurrency" NOT NULL,
    "network" TEXT NOT NULL,
    "phoneNumber" TEXT NOT NULL,
    "status" "DepositStatus" NOT NULL DEFAULT 'PENDING',
    "merchantReference" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "providerReference" TEXT NOT NULL,
    "providerTransactionId" TEXT,
    "checkoutUrl" TEXT,
    "checkoutToken" TEXT,
    "failureReason" TEXT,
    "idempotencyKey" TEXT,
    "providerRequestId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "Deposit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Transaction" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "depositId" TEXT,
    "payoutId" TEXT,
    "conversionId" TEXT,
    "type" "TransactionType" NOT NULL,
    "status" "TransactionStatus" NOT NULL,
    "amount" DECIMAL(19,8) NOT NULL,
    "currency" "WalletCurrency" NOT NULL,
    "provider" TEXT,
    "providerReference" TEXT,
    "providerTransactionId" TEXT,
    "merchantReference" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Transaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LedgerEntry" (
    "id" TEXT NOT NULL,
    "walletId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "depositId" TEXT,
    "conversionId" TEXT,
    "transactionId" TEXT,
    "type" "LedgerEntryType" NOT NULL,
    "amount" DECIMAL(19,8) NOT NULL,
    "currency" "WalletCurrency" NOT NULL,
    "balanceAfter" DECIMAL(19,8) NOT NULL,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LedgerEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WalletConversionQuote" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "sourceCurrency" "WalletCurrency" NOT NULL,
    "destinationCurrency" "WalletCurrency" NOT NULL,
    "sourceAmount" DECIMAL(19,8) NOT NULL,
    "destinationAmount" DECIMAL(19,8) NOT NULL,
    "providerFee" DECIMAL(19,8) NOT NULL,
    "reepayFee" DECIMAL(19,8) NOT NULL,
    "totalDebit" DECIMAL(19,8) NOT NULL,
    "rate" DECIMAL(19,8) NOT NULL,
    "provider" TEXT NOT NULL,
    "providerQuoteReference" TEXT,
    "providerQuoteExpiresAt" TIMESTAMP(3) NOT NULL,
    "quotedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "merchantReference" TEXT NOT NULL,
    "idempotencyKey" TEXT,
    "confirmedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WalletConversionQuote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WalletConversion" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "sourceWalletId" TEXT NOT NULL,
    "destinationWalletId" TEXT,
    "quoteId" TEXT NOT NULL,
    "sourceCurrency" "WalletCurrency" NOT NULL,
    "destinationCurrency" "WalletCurrency" NOT NULL,
    "sourceAmount" DECIMAL(19,8) NOT NULL,
    "destinationAmount" DECIMAL(19,8) NOT NULL,
    "providerFee" DECIMAL(19,8) NOT NULL,
    "reepayFee" DECIMAL(19,8) NOT NULL,
    "totalDebit" DECIMAL(19,8) NOT NULL,
    "status" "WalletConversionStatus" NOT NULL DEFAULT 'PENDING',
    "provider" TEXT NOT NULL,
    "providerReference" TEXT,
    "providerTransactionId" TEXT,
    "merchantReference" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "failureReason" TEXT,
    "reversedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "WalletConversion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PayoutQuote" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "sourceCurrency" "WalletCurrency" NOT NULL,
    "destinationCurrency" TEXT NOT NULL,
    "destinationAmount" DECIMAL(19,8) NOT NULL,
    "sourceAmount" DECIMAL(19,8) NOT NULL,
    "providerFee" DECIMAL(19,8) NOT NULL,
    "reepayFee" DECIMAL(19,8) NOT NULL,
    "totalDebit" DECIMAL(19,8) NOT NULL,
    "rate" DECIMAL(19,8) NOT NULL,
    "providerQuoteExpiresAt" TIMESTAMP(3) NOT NULL,
    "quotedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'kryptapay',
    "destinationType" TEXT NOT NULL DEFAULT 'iban',
    "recipientIban" TEXT,
    "recipientName" TEXT,
    "recipientBankName" TEXT,
    "recipientAddress" TEXT,
    "recipientWiseTag" TEXT,
    "merchantReference" TEXT NOT NULL,
    "idempotencyKey" TEXT,
    "confirmedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PayoutQuote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Payout" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "walletId" TEXT NOT NULL,
    "quoteId" TEXT NOT NULL,
    "amount" DECIMAL(19,8) NOT NULL,
    "currency" TEXT NOT NULL,
    "sourceAmount" DECIMAL(19,8) NOT NULL,
    "providerFee" DECIMAL(19,8) NOT NULL,
    "reepayFee" DECIMAL(19,8) NOT NULL,
    "totalDebit" DECIMAL(19,8) NOT NULL,
    "status" "PayoutStatus" NOT NULL DEFAULT 'PENDING',
    "merchantReference" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "providerReference" TEXT,
    "providerTransactionId" TEXT,
    "sourceCurrency" "WalletCurrency" NOT NULL DEFAULT 'XAF',
    "destinationType" TEXT NOT NULL DEFAULT 'iban',
    "recipientIban" TEXT,
    "recipientName" TEXT,
    "recipientBankName" TEXT,
    "recipientAddress" TEXT,
    "recipientWiseTag" TEXT,
    "failureReason" TEXT,
    "reversedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "Payout_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WebhookLog" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "signatureValid" BOOLEAN NOT NULL,
    "rawPayload" TEXT NOT NULL,
    "processingStatus" "WebhookProcessingStatus" NOT NULL DEFAULT 'PENDING',
    "providerReference" TEXT,
    "providerRequestId" TEXT,
    "errorMessage" TEXT,
    "processedAt" TIMESTAMP(3),

    CONSTRAINT "WebhookLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OutboundWebhookDelivery" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "endpointUrl" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "signature" TEXT NOT NULL,
    "status" "OutboundWebhookDeliveryStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastStatusCode" INTEGER,
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deliveredAt" TIMESTAMP(3),

    CONSTRAINT "OutboundWebhookDelivery_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotificationEvent" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "type" "NotificationEventType" NOT NULL,
    "payload" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dispatchedAt" TIMESTAMP(3),

    CONSTRAINT "NotificationEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Customer_externalId_key" ON "Customer"("externalId");

-- CreateIndex
CREATE INDEX "Wallet_currency_idx" ON "Wallet"("currency");

-- CreateIndex
CREATE UNIQUE INDEX "Wallet_customerId_currency_key" ON "Wallet"("customerId", "currency");

-- CreateIndex
CREATE UNIQUE INDEX "Deposit_merchantReference_key" ON "Deposit"("merchantReference");

-- CreateIndex
CREATE UNIQUE INDEX "Deposit_providerReference_key" ON "Deposit"("providerReference");

-- CreateIndex
CREATE UNIQUE INDEX "Deposit_idempotencyKey_key" ON "Deposit"("idempotencyKey");

-- CreateIndex
CREATE INDEX "Deposit_customerId_status_idx" ON "Deposit"("customerId", "status");

-- CreateIndex
CREATE INDEX "Deposit_provider_providerReference_idx" ON "Deposit"("provider", "providerReference");

-- CreateIndex
CREATE UNIQUE INDEX "Transaction_depositId_key" ON "Transaction"("depositId");

-- CreateIndex
CREATE UNIQUE INDEX "Transaction_merchantReference_key" ON "Transaction"("merchantReference");

-- CreateIndex
CREATE INDEX "Transaction_customerId_createdAt_idx" ON "Transaction"("customerId", "createdAt");

-- CreateIndex
CREATE INDEX "Transaction_payoutId_idx" ON "Transaction"("payoutId");

-- CreateIndex
CREATE INDEX "Transaction_conversionId_idx" ON "Transaction"("conversionId");

-- CreateIndex
CREATE INDEX "Transaction_provider_providerReference_idx" ON "Transaction"("provider", "providerReference");

-- CreateIndex
CREATE INDEX "LedgerEntry_walletId_createdAt_idx" ON "LedgerEntry"("walletId", "createdAt");

-- CreateIndex
CREATE INDEX "LedgerEntry_customerId_createdAt_idx" ON "LedgerEntry"("customerId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "WalletConversionQuote_merchantReference_key" ON "WalletConversionQuote"("merchantReference");

-- CreateIndex
CREATE UNIQUE INDEX "WalletConversionQuote_idempotencyKey_key" ON "WalletConversionQuote"("idempotencyKey");

-- CreateIndex
CREATE INDEX "WalletConversionQuote_customerId_createdAt_idx" ON "WalletConversionQuote"("customerId", "createdAt");

-- CreateIndex
CREATE INDEX "WalletConversionQuote_expiresAt_idx" ON "WalletConversionQuote"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "WalletConversion_quoteId_key" ON "WalletConversion"("quoteId");

-- CreateIndex
CREATE UNIQUE INDEX "WalletConversion_providerReference_key" ON "WalletConversion"("providerReference");

-- CreateIndex
CREATE UNIQUE INDEX "WalletConversion_merchantReference_key" ON "WalletConversion"("merchantReference");

-- CreateIndex
CREATE UNIQUE INDEX "WalletConversion_idempotencyKey_key" ON "WalletConversion"("idempotencyKey");

-- CreateIndex
CREATE INDEX "WalletConversion_customerId_status_idx" ON "WalletConversion"("customerId", "status");

-- CreateIndex
CREATE INDEX "WalletConversion_provider_providerReference_idx" ON "WalletConversion"("provider", "providerReference");

-- CreateIndex
CREATE UNIQUE INDEX "PayoutQuote_merchantReference_key" ON "PayoutQuote"("merchantReference");

-- CreateIndex
CREATE UNIQUE INDEX "PayoutQuote_idempotencyKey_key" ON "PayoutQuote"("idempotencyKey");

-- CreateIndex
CREATE INDEX "PayoutQuote_customerId_createdAt_idx" ON "PayoutQuote"("customerId", "createdAt");

-- CreateIndex
CREATE INDEX "PayoutQuote_expiresAt_idx" ON "PayoutQuote"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "Payout_quoteId_key" ON "Payout"("quoteId");

-- CreateIndex
CREATE UNIQUE INDEX "Payout_merchantReference_key" ON "Payout"("merchantReference");

-- CreateIndex
CREATE UNIQUE INDEX "Payout_idempotencyKey_key" ON "Payout"("idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "Payout_providerReference_key" ON "Payout"("providerReference");

-- CreateIndex
CREATE INDEX "Payout_customerId_status_idx" ON "Payout"("customerId", "status");

-- CreateIndex
CREATE INDEX "Payout_provider_providerReference_idx" ON "Payout"("provider", "providerReference");

-- CreateIndex
CREATE INDEX "WebhookLog_provider_eventType_idx" ON "WebhookLog"("provider", "eventType");

-- CreateIndex
CREATE INDEX "WebhookLog_processingStatus_receivedAt_idx" ON "WebhookLog"("processingStatus", "receivedAt");

-- CreateIndex
CREATE UNIQUE INDEX "WebhookLog_provider_eventId_key" ON "WebhookLog"("provider", "eventId");

-- CreateIndex
CREATE UNIQUE INDEX "OutboundWebhookDelivery_eventId_key" ON "OutboundWebhookDelivery"("eventId");

-- CreateIndex
CREATE INDEX "OutboundWebhookDelivery_status_createdAt_idx" ON "OutboundWebhookDelivery"("status", "createdAt");

-- CreateIndex
CREATE INDEX "OutboundWebhookDelivery_eventType_idx" ON "OutboundWebhookDelivery"("eventType");

-- CreateIndex
CREATE INDEX "NotificationEvent_customerId_createdAt_idx" ON "NotificationEvent"("customerId", "createdAt");

-- AddForeignKey
ALTER TABLE "Wallet" ADD CONSTRAINT "Wallet_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Deposit" ADD CONSTRAINT "Deposit_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Deposit" ADD CONSTRAINT "Deposit_walletId_fkey" FOREIGN KEY ("walletId") REFERENCES "Wallet"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_depositId_fkey" FOREIGN KEY ("depositId") REFERENCES "Deposit"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_payoutId_fkey" FOREIGN KEY ("payoutId") REFERENCES "Payout"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_conversionId_fkey" FOREIGN KEY ("conversionId") REFERENCES "WalletConversion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LedgerEntry" ADD CONSTRAINT "LedgerEntry_walletId_fkey" FOREIGN KEY ("walletId") REFERENCES "Wallet"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LedgerEntry" ADD CONSTRAINT "LedgerEntry_depositId_fkey" FOREIGN KEY ("depositId") REFERENCES "Deposit"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LedgerEntry" ADD CONSTRAINT "LedgerEntry_conversionId_fkey" FOREIGN KEY ("conversionId") REFERENCES "WalletConversion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LedgerEntry" ADD CONSTRAINT "LedgerEntry_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "Transaction"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WalletConversionQuote" ADD CONSTRAINT "WalletConversionQuote_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WalletConversion" ADD CONSTRAINT "WalletConversion_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WalletConversion" ADD CONSTRAINT "WalletConversion_sourceWalletId_fkey" FOREIGN KEY ("sourceWalletId") REFERENCES "Wallet"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WalletConversion" ADD CONSTRAINT "WalletConversion_destinationWalletId_fkey" FOREIGN KEY ("destinationWalletId") REFERENCES "Wallet"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WalletConversion" ADD CONSTRAINT "WalletConversion_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "WalletConversionQuote"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayoutQuote" ADD CONSTRAINT "PayoutQuote_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payout" ADD CONSTRAINT "Payout_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payout" ADD CONSTRAINT "Payout_walletId_fkey" FOREIGN KEY ("walletId") REFERENCES "Wallet"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payout" ADD CONSTRAINT "Payout_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "PayoutQuote"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

