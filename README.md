# Radiance AI Reception

Local-first AI reception, CRM, booking, follow-up, human-attention, CSV import, outreach, and WhatsApp Cloud API readiness for Radiance Clinics, Bhubaneswar.

## Run locally

```bash
npm install
cp .env.example .env.local
npm run setup
npm run dev
```

Open [http://localhost:3000/testing/reception](http://localhost:3000/testing/reception) for the local-only receptionist test panel and [http://localhost:3000/inbox](http://localhost:3000/inbox) for reception. Local data stays in `data/radiance.db`.

## AI providers

Provider keys stay server-side. The model receives a minimal, redacted patient context without phone, WhatsApp ID, email, raw CSV data, or internal IDs. Model output is repaired once when necessary and must pass the strict `ReceptionDecision` schema. The server alone executes bookings, content selection, scoring, and handoffs.

```env
AI_PRIMARY_PROVIDER=deepseek
AI_PRIMARY_MODEL=deepseek-v4-flash
DEEPSEEK_API_KEY=

AI_FALLBACK_PROVIDER=gemini
AI_FALLBACK_MODEL=gemini-3.7-flash
GEMINI_API_KEY=

AI_ALLOW_FALLBACK=true
AI_FALLBACK_TO_MOCK=true
```

If a real provider is absent or fails, the safe deterministic mock keeps local development functional. Provider health, latency, errors, fallbacks, token usage, and estimated cost fields are stored for admin analytics.

## Shared message pipeline

Set `MESSAGE_CHANNEL=local`, `mock_meta`, or `whatsapp`. Local Patient Simulator, Mock Meta, and signed Cloud API webhooks normalize into the same pipeline:

```text
channel → normalized inbound → opt-out/media/safety → AI router
        → structured decision → server business rules → CRM/reply/task
```

WhatsApp business logic does not live in the webhook adapter. Media metadata is stored and sent to staff review; the AI does not diagnose images.

## CSV and outreach

- `/leads/import` provides upload, mapping, validation, preview, and import steps.
- CSV is limited to 2 MB, formula-like cells are escaped, Indian numbers are normalized, and duplicates can be skipped, safely updated, or merged.
- A phone number never implies consent. Only `CONFIRMED` records are automatically outreach-eligible.
- `/outreach` uses drafts, eligibility filtering, local test sends, manual start, a persistent rate-limited queue, and a final eligibility recheck.
- Live WhatsApp campaigns additionally require a template marked `APPROVED` by Meta.
- `STOP`, `UNSUBSCRIBE`, `REMOVE ME`, and equivalent explicit messages revoke consent and cancel pending outreach.

## Meta readiness

Local development does not require Meta. Configure these later:

```env
MESSAGE_CHANNEL=whatsapp
META_APP_ID=
META_APP_SECRET=
META_BUSINESS_ID=
WHATSAPP_WABA_ID=
WHATSAPP_PHONE_NUMBER_ID=
WHATSAPP_ACCESS_TOKEN=
WHATSAPP_VERIFY_TOKEN=
WHATSAPP_GRAPH_VERSION=v23.0
WHATSAPP_ENABLED=true
```

Use `/settings/meta` for safe configured/missing diagnostics. The webhook is `GET/POST /api/whatsapp/webhook`; POST requests require `X-Hub-Signature-256`, are idempotent, and process text, media metadata, interactive replies, and sent/delivered/read/failed events.

## Production deployment — Hostinger

Production runs one Next.js application at `https://crm.radianceclinics.com` using Node.js `>=22.13.0`, `npm run build`, and `npm run start`. API routes remain under the same hostname.

1. Create a new, empty Hostinger MySQL database; do not reuse a database with test CRM data.
2. Add the production environment values from `.env.example` in Hostinger. Use `DATABASE_PROVIDER=mysql`, a secure `DATABASE_URL`, `APP_URL=https://crm.radianceclinics.com`, and `MESSAGE_CHANNEL=whatsapp` only when ready for the controlled test.
3. Generate the dashboard PIN hash with `npm run auth:hash-pin -- YOUR_8_DIGIT_PIN`; generate long random `SESSION_SECRET` and `CRON_SECRET` values. Do not commit any of them.
4. Run `npm run db:mysql:migrate`, then `npm run db:production-check` in the Hostinger environment.
5. Configure consultation hours at `/settings/appointments`; the receptionist cannot offer slots before this is completed.
6. Run `npm run predeploy`. It stops on missing production configuration, placeholders, demo data, database problems, or failed checks.
7. Attach only `crm.radianceclinics.com`, verify HTTPS and `/api/health`, then configure the Meta webhook at `/api/whatsapp/webhook`.
8. Use `/settings/meta` to check the System User token, phone registration, HTTPS webhook, WABA subscription, and approved templates. Complete the controlled inbound/outreach test before setting `AUTO_MARKETING_ENABLED=true`.

Hostinger cron should call `POST /api/internal/process-jobs` on a sensible interval with `Authorization: Bearer $CRON_SECRET`. The endpoint processes reminders and scheduled work idempotently. It deliberately skips automatic outreach until `AUTO_MARKETING_ENABLED=true`.

### Backup and rollback

Use Hostinger's MySQL backup facility. Record the production database name, deployment revision, and the command used to migrate it (`npm run db:mysql:migrate`). Restore through Hostinger's MySQL restore flow if needed, then redeploy the last known-good Git revision. Do not restore local SQLite files into production.

## Validation and maintenance

```bash
npm run setup       # additive/idempotent schema setup; preserves current data
npm run db:reset:test # intentionally reset and reseed the test database
npm run db:mysql:migrate # production MySQL schema + approved knowledge only
npm run db:production-check # non-destructive MySQL readiness check
npm run lint
npm run typecheck
npm test
npm run test:conversation-quality
npm run predeploy   # production-only gate; intentionally fails on missing production inputs
npm run build
```

Important actions are written to append-only audit records. API keys and environment files are ignored by Git; SQLite database files are also excluded.
