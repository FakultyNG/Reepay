# SangaPay / Reepay Architecture

## Repository Boundary

The platform is split into three independently deployable repositories:

| Repository | Product | Deployment |
| --- | --- | --- |
| `sangapay-frontend` | Customer-facing SangaPay frontend | Vercel |
| `sangapay-backend` | SangaPay product backend | Render or another persistent backend host |
| `reepay` | Reusable payments/orchestration API | Render recommended |

This repository is `reepay`. It must not contain the SangaPay frontend or SangaPay backend application code.

## System Boundary

```text
SangaPay Frontend
  ↓ HTTPS
SangaPay Backend
  ↓ HTTPS + service credential
Reepay API
  ↓ provider adapters
KryptaPay / Wise / future payment providers
```

SangaPay must never call KryptaPay or Wise directly. SangaPay only calls Reepay for payment operations. Provider credentials, request formats, retries, webhook verification, and provider-specific error translation stay inside Reepay.

## Responsibilities

### SangaPay Frontend

- Lives in the `sangapay-frontend` repository.
- Remains deployed on Vercel.
- Calls only the SangaPay backend over HTTPS.
- Does not know Reepay, KryptaPay, or Wise credentials.

### SangaPay Backend

- Lives in the `sangapay-backend` repository.
- Owns SangaPay product authentication, sessions, customer profile context, OTP, dashboard views, beneficiaries, support flows, app notifications, and frontend-facing API contracts.
- Contains a Reepay client/service, typically under `src/reepay-client`.
- Calls Reepay with `REEPAY_BASE_URL` and `SANGAPAY_REEPAY_API_KEY`.
- Must not contain KryptaPay or Wise SDKs, API credentials, provider webhook handlers, request signing, or provider-specific payment rules.

Expected source boundary:

```text
src/
  auth/
  users/
  dashboard/
  wallet/
  deposits/
  payouts/
  transactions/
  beneficiaries/
  support/
  reepay-client/
  common/
```

### Reepay

- Lives in the `reepay` repository.
- Owns provider-neutral payment orchestration domains: payment customer references, wallets, deposits, FX, payouts, transactions, provider webhooks, and outbound payment webhooks.
- Exposes stable payment APIs to SangaPay and future internal products.
- Authenticates trusted service callers such as the SangaPay backend.
- Encapsulates provider adapters under `src/providers`.
- Encapsulates provider webhook handling under `src/webhooks`.
- Does not own SangaPay user authentication, passcodes, customer profiles, WhatsApp OTP, support tickets, or app notification read state.
- Treats the Reepay ledger as the authoritative customer balance for XAF, EUR, and USDC wallets.
- Uses KryptaPay for XAF funding and USDC wallet/payout rails.
- Uses Wise for EUR wallet payout rails.

Implemented source boundary:

```text
src/
  auth/
  wallets/
  deposits/
  fx/
  payouts/
  transactions/
  providers/
    kryptapay/
    wise/
  webhooks/
    kryptapay/
    sangapay/
  common/
  config/
```

### KryptaPay

- Current XAF Mobile Money, FX, and USDC provider used by Reepay.
- Integration code belongs only under:
  - `src/providers/kryptapay`
  - `src/webhooks/kryptapay`

### Wise

- Current EUR wallet payout provider used by Reepay.
- Integration code belongs only under:
  - `src/providers/wise`

## Foundation Stack

Reepay is a NestJS API service using PostgreSQL through Prisma, Redis through a dedicated Redis module, NestJS `HttpModule` for provider HTTP adapters, Swagger/OpenAPI at `/docs`, URI API versioning for future product APIs, security headers through Helmet, and global rate limiting through `@nestjs/throttler`.

The bootstrap layer configures:

- global validation with whitelist and transform enabled
- centralized exception responses with request IDs
- structured JSON logging
- request ID propagation through `X-Request-Id`
- health checks at `/health` and readiness checks at `/ready`

## Environment Configuration

Runtime configuration is loaded from environment variables and validated before the app starts:

```text
REEPAY_PORT
DATABASE_URL
REDIS_URL
REEPAY_API_KEY
REEPAY_ALLOWED_APPLICATION_IDS
SANGAPAY_WEBHOOK_ENABLED
SANGAPAY_WEBHOOK_URL
SANGAPAY_WEBHOOK_SECRET
SANGAPAY_WEBHOOK_MAX_ATTEMPTS
SANGAPAY_WEBHOOK_RETRY_BASE_DELAY_MS
REEPAY_FEE_TYPE=fixed|percentage
REEPAY_FEE_FIXED
REEPAY_FEE_PERCENT
REEPAY_FEE_PERCENT_CAP
REEPAY_FEE_CURRENCY=XAF
REEPAY_ENV=sandbox|production|test|development
REEPAY_RECONCILIATION_ENABLED
REEPAY_RECONCILIATION_INTERVAL_MS
REEPAY_RECONCILIATION_LOOKBACK_MINUTES
REEPAY_RECONCILIATION_BATCH_SIZE
KRYPTAPAY_BASE_URL
KRYPTAPAY_API_KEY
KRYPTAPAY_WEBHOOK_SECRET
WISE_BASE_URL
WISE_API_TOKEN
WISE_PROFILE_ID
WISE_EUR_BALANCE_ID
WISE_WEBHOOK_PUBLIC_KEY
WISE_EUR_FUNDING_IBAN
WISE_EUR_FUNDING_ACCOUNT_NAME
WISE_EUR_FUNDING_BANK_NAME
REEPAY_EUR_PAYOUT_FEE_FIXED
REEPAY_EUR_PAYOUT_FEE_PERCENT
REEPAY_EUR_PAYOUT_FEE_PERCENT_CAP
REEPAY_USDC_PAYOUT_FEE_FIXED
REEPAY_USDC_PAYOUT_FEE_PERCENT
REEPAY_USDC_PAYOUT_FEE_PERCENT_CAP
```

Reepay fee behavior is controlled by Reepay-owned fee variables only. Provider fees are not configured by Reepay environment variables; they come from KryptaPay or Wise quote/transaction responses when those providers expose them in the relevant flow. If a provider does not expose a separate pre-confirm fee quote for a flow, Reepay returns a zero provider fee at quote time rather than inventing one.

## Wallets And Conversions

SangaPay reads customer wallet balances from Reepay:

```text
GET /v1/wallet/balance?customerId=<sangapay-user-id>
GET /v1/wallet/xaf?customerId=<sangapay-user-id>
GET /v1/wallet/eur?customerId=<sangapay-user-id>
GET /v1/wallet/usdc?customerId=<sangapay-user-id>
```

For dashboard display, SangaPay can request:

```text
GET /v1/wallet/summary?customerId=<sangapay-user-id>
```

Reepay returns:

- actual XAF, EUR, and USDC ledger balances
- XAF -> USDC and XAF -> EUR quote equivalents for display
- quote timestamps and provider quote expiry for each equivalent

EUR and USDC are now real customer-held wallet balances in Reepay's ledger. Display equivalents remain display-only. SangaPay must not invent FX rates, and Reepay must not move funds merely to display an equivalent.

Wallet funding from XAF uses quote and confirm endpoints:

```text
POST /v1/wallet/eur/quote
POST /v1/wallet/eur/confirm
POST /v1/wallet/usdc/quote
POST /v1/wallet/usdc/confirm
POST /v1/payouts/usdc/confirm
```

`POST /v1/payouts/usdc/confirm` is a compatibility alias for confirming XAF -> USDC wallet funding. New SangaPay integrations should prefer `POST /v1/wallet/usdc/confirm`.

## Payout Flows

SangaPay presents a provider-neutral flow:

```text
Enter amount -> Enter recipient -> Quote -> Confirm
```

XAF-funded EUR wallet funding is available through:

```text
POST /v1/wallet/eur/quote
POST /v1/wallet/eur/confirm
POST /v1/payouts/eur/confirm
```

`POST /v1/payouts/eur/confirm` is a compatibility alias for confirming XAF -> EUR wallet funding. Quote creation requests a KryptaPay XAF -> EUR quote with `side=credit_to`, calculates the XAF source amount, Reepay fee, and total XAF customer debit. Confirmation requires `Idempotency-Key`, verifies quote expiry, verifies XAF wallet balance, atomically debits the internal XAF ledger, then calls KryptaPay `POST /v1/payouts/` to move EUR to Reepay's configured Wise EUR receiving account.

The initial KryptaPay payout response is treated only as provider acceptance. Reepay keeps the internal payout in `processing` until KryptaPay webhook events are received and the payout is re-verified with KryptaPay `GET /v1/payouts/{id}`. Failed, cancelled, or refunded payouts create exactly one XAF wallet reversal through an internal ledger credit.

Live-wallet external payout routes are:

```text
POST /v1/payouts/eur/iban/quote
POST /v1/payouts/eur/iban/confirm
POST /v1/payouts/eur/wisetag/quote
POST /v1/payouts/eur/wisetag/confirm
POST /v1/payouts/usdc/address/quote
POST /v1/payouts/usdc/address/confirm
```

EUR payout confirmation debits the EUR wallet and submits a Wise transfer. USDC address payout confirmation debits the USDC wallet and submits a KryptaPay payout. Provider acceptance is not treated as recipient settlement.

## Request Flow

1. The SangaPay frontend calls the SangaPay backend over HTTPS using the current Vercel domain.
2. The SangaPay backend authenticates the customer and maps frontend requests into SangaPay product operations.
3. For payment operations, wallets, FX, payouts, deposits, or transactions, the SangaPay backend calls Reepay over HTTPS.
4. Reepay authorizes the SangaPay backend service credential, applies provider-neutral business rules, and selects the appropriate provider adapter.
5. Reepay calls KryptaPay, Wise, or a future payment provider through adapter interfaces.
6. Reepay normalizes provider responses before returning to SangaPay backend.
7. SangaPay backend returns a frontend-specific response to the SangaPay frontend.

## Webhook Flow

1. KryptaPay sends provider webhooks directly to Reepay at `POST /api/v1/webhooks/kryptapay`.
2. This endpoint is provider-facing only. SangaPay frontend and SangaPay backend must not call it.
3. Reepay verifies `X-KryptaPay-Signature`, `X-KryptaPay-Event`, and `X-KryptaPay-Event-Id` using HMAC SHA-256 over the raw HTTP request body before parsing JSON.
4. Reepay persists every accepted webhook in `WebhookLog` with provider, provider event ID, event type, received timestamp, signature validity, raw payload, and processing status.
5. `WebhookLog(provider, eventId)` is unique. Duplicate event IDs are acknowledged but not processed again, preventing duplicate wallet credits, wallet debits, wallet reversals, or transaction transitions.
6. Reepay translates provider events into internal provider-neutral transaction, payout, deposit, and payment notification event changes.
7. `PAYIN_RECEIVED` is credited only after provider status verification through KryptaPay GET payin status.
8. `PAYOUT_COMPLETED` and `PAYOUT_FAILED` are applied only after provider status verification through KryptaPay GET payout status.
9. Failed or refunded payouts perform exactly one XAF wallet reversal through the ledger.
10. After a real internal state transition, Reepay dispatches a provider-neutral outbound webhook to the SangaPay backend when `SANGAPAY_WEBHOOK_ENABLED=true`.
11. Reepay signs the exact outbound JSON body with HMAC SHA-256 using `SANGAPAY_WEBHOOK_SECRET` and sends:

```text
X-Reepay-Signature
X-Reepay-Event
X-Reepay-Event-Id
X-Reepay-Timestamp
X-Request-Id
```

12. SangaPay backend verifies the signature over the raw request body before parsing JSON, stores the Reepay event ID for idempotency, and updates its product-facing state.
13. Outbound deliveries are recorded in `OutboundWebhookDelivery`. SangaPay delivery failures are captured for operations but do not roll back a successful Reepay ledger or provider settlement transition.

Current outbound event names are provider-neutral:

- `deposit.completed`
- `deposit.failed`
- `payout.processing`
- `payout.completed`
- `payout.failed`
- `payout.refunded`
- `wallet.conversion.processing`
- `wallet.conversion.completed`
- `wallet.conversion.failed`

## Authentication Between SangaPay Backend and Reepay

SangaPay backend authenticates to Reepay with a server-to-server credential sent over HTTPS. The stable public API uses:

```text
X-Reepay-Api-Key: <server-to-server credential>
X-Reepay-Application-Id: sangapay-backend
```

Reepay validates the API key against `REEPAY_API_KEY` and validates the application identity against `REEPAY_ALLOWED_APPLICATION_IDS`. These are backend-only credentials. They must never be shipped to the SangaPay frontend. In production, keys must be stored in the deployment provider's secret manager and rotated without code changes.

This can later evolve to mTLS, OAuth client credentials, signed JWT assertions, or short-lived service tokens without changing SangaPay's rule that it only calls Reepay.

## Stable Public API

The stable Reepay public API is provider-neutral and intended for SangaPay backend consumption only:

- Wallet: `GET /v1/wallet/xaf`, `GET /v1/wallet/eur`, `GET /v1/wallet/usdc`, `GET /v1/wallet/balance`, `GET /v1/wallet/summary`, `GET /v1/wallet/funding-instructions`, `GET /v1/wallet/recent-transactions`, `POST /v1/wallet/eur/quote`, `POST /v1/wallet/eur/confirm`, `POST /v1/wallet/usdc/quote`, `POST /v1/wallet/usdc/confirm`
- Deposits: `POST /v1/deposits/xaf`, `GET /v1/deposits/:id`, `POST /v1/deposits/:id/verify`
- FX: `POST /v1/fx/quote`, `POST /v1/fx/quote/xaf-eur`, `POST /v1/fx/quote/xaf-usdc`, `POST /v1/fx/quote/xaf-eur/payout`
- Payouts: `POST /v1/payouts/eur/recipient/validate`, `POST /v1/payouts/eur/quote`, `POST /v1/payouts/eur/confirm`, `POST /v1/payouts/eur/iban/quote`, `POST /v1/payouts/eur/iban/confirm`, `POST /v1/payouts/eur/wisetag/quote`, `POST /v1/payouts/eur/wisetag/confirm`, `POST /v1/payouts/usdc/confirm`, `POST /v1/payouts/usdc/address/quote`, `POST /v1/payouts/usdc/address/confirm`, `GET /v1/payouts/:id`
- Transactions: `GET /v1/transactions`, `GET /v1/transactions/:id`

Public responses must not expose KryptaPay API keys, KryptaPay webhook secrets, Wise API tokens, provider raw payloads, or internal provider IDs. Provider references remain stored internally for reconciliation and support workflows.

## Deployment Boundaries

- `sangapay-frontend`: Vercel.
- `sangapay-backend`: independently deployable persistent backend, such as Render.
- `reepay`: independently deployable persistent API service. Render is recommended because Reepay receives provider webhooks and runs as a long-lived backend service.
- Domains are configured with environment variables. Do not hardcode Vercel or Render domains in application code.

## Provider Substitution Strategy

Reepay owns payment provider selection through adapter interfaces. To replace KryptaPay or Wise:

1. Add a new provider adapter under `src/providers/<provider>`.
2. Add provider webhook handling under `src/webhooks/<provider>` if needed.
3. Map provider-specific request, response, status, and error shapes into Reepay's internal provider-neutral contracts.
4. Switch provider selection through Reepay configuration or routing rules.
5. Keep SangaPay backend and frontend unchanged unless a provider-neutral Reepay product capability changes.

This preserves SangaPay as a product backend and Reepay as the reusable orchestration layer.
