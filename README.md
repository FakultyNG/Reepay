# Reepay API

Reusable payments and orchestration API for SangaPay.

Reepay is deployed independently from SangaPay frontend and SangaPay backend. It exposes provider-neutral payment APIs and owns KryptaPay and Wise integration details.

## Development

```bash
pnpm install
pnpm dev
```

## Verification

```bash
pnpm build
pnpm lint
pnpm test
```

## Provider Webhooks

Register provider callbacks against the deployed Reepay API, not SangaPay:

- KryptaPay: `https://<reepay-domain>/api/v1/webhooks/kryptapay`
- Wise transfer update events: `https://<reepay-domain>/api/v1/webhooks/wise`

Reepay then sends provider-neutral outbound events to SangaPay through `SANGAPAY_WEBHOOK_URL` when `SANGAPAY_WEBHOOK_ENABLED=true`.

## Secret Configuration

Put API keys and webhook secrets in Render environment variables or a local `.env` file. Do not put them in source control or chat.

Required provider values for the current EUR/USDC flows:

- `KRYPTAPAY_API_KEY`
- `KRYPTAPAY_WEBHOOK_SECRET`
- `WISE_API_TOKEN`
- `WISE_PROFILE_ID`
- `WISE_EUR_BALANCE_ID`
- `WISE_WEBHOOK_PUBLIC_KEY`
- `WISE_EUR_FUNDING_IBAN`
- `WISE_EUR_FUNDING_ACCOUNT_NAME`
- `WISE_EUR_FUNDING_BANK_NAME`

## Reliability

Reepay runs a scheduled internal reconciliation pass when `REEPAY_RECONCILIATION_ENABLED=true`. It checks recent non-terminal deposits, payouts, and EUR wallet funding conversions against provider status APIs, and retries failed outbound SangaPay webhook deliveries.

Public Reepay API responses use:

```json
{
  "data": {},
  "meta": {
    "requestId": "..."
  }
}
```

Errors use:

```json
{
  "error": {
    "code": "...",
    "message": "...",
    "requestId": "..."
  },
  "meta": {
    "timestamp": "..."
  }
}
```

Health checks and provider webhook acknowledgements intentionally keep their plain response shape.

## Fees

`REEPAY_FEE_TYPE` accepts `fixed` or `percentage`. Percentage fees are calculated from the customer transaction amount, not from provider fees.

Percentage caps are configurable:

- `REEPAY_FEE_PERCENT_CAP` caps the global XAF fee percentage.
- `REEPAY_EUR_PAYOUT_FEE_PERCENT_CAP` caps EUR wallet payout percentage fees and defaults to `10`.
- `REEPAY_USDC_PAYOUT_FEE_PERCENT_CAP` caps USDC wallet payout percentage fees when set.
