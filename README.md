# Radiance AI Reception

Local-first AI reception, CRM, booking, follow-up, human-attention, CSV import, outreach, and WhatsApp Cloud API readiness for Radiance Clinics, Bhubaneswar.

## Run locally

```bash
npm install
cp .env.example .env.local
npm run setup
npm run dev
```

Open [http://localhost:3000/demo/scenario](http://localhost:3000/demo/scenario) for the doctor demo, [http://localhost:3000/inbox](http://localhost:3000/inbox) for reception, and [http://localhost:3000/demo/patient](http://localhost:3000/demo/patient) for the patient view. `npm run dev` starts Next.js and the persistent scheduler/outreach worker. Local data stays in `data/radiance.db`.

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

Use `/settings/meta` for safe configured/missing diagnostics and `/demo/meta` for local inbound/media/status/template simulations. The webhook is `GET/POST /api/whatsapp/webhook`; POST requests require `X-Hub-Signature-256`, are idempotent, and process text, media metadata, interactive replies, and sent/delivered/read/failed events.

## Doctor demo

Use `/demo/scenario`. Its buttons execute real application actions for:

- live hair-transplant enquiry and explainable CRM scoring;
- old-lead re-engagement and call recommendation;
- human takeover and resume with context;
- real slot booking and reminder execution;
- no-show recovery;
- consent-aware CSV import.

The full scripted acceptance flow is also automated:

```bash
npm run test:demo
```

## Validation and maintenance

```bash
npm run setup       # additive/idempotent schema setup; preserves current data
npm run db:reset    # intentionally reset and reseed the demo database
npm run lint
npm run typecheck
npm test
npm run test:demo
npm run build
```

Important actions are written to append-only audit records. API keys and environment files are ignored by Git; SQLite database files are also excluded.
