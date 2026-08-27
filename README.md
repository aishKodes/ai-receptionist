# Radiance AI Reception

Local, working AI reception, CRM, appointment and follow-up demo for Radiance Clinics, Bhubaneswar.

## Quick Start

```bash
npm install
cp .env.example .env.local
npm run setup
npm run dev
```

Open:

- http://localhost:3000/inbox
- http://localhost:3000/demo/patient
- http://localhost:3000/demo/control

`npm run dev` starts the Next.js app and persistent follow-up worker together. The SQLite database is stored at `data/radiance.db`.

## Add AI

No key is required. With the default `AI_PROVIDER=auto`, the app uses the first configured provider and otherwise uses the fully functional deterministic demo AI.

### OpenAI

```env
AI_PROVIDER=openai
OPENAI_API_KEY=...
AI_MODEL=gpt-5.6-terra
```

### Gemini

```env
AI_PROVIDER=gemini
GEMINI_API_KEY=...
AI_MODEL=gemini-2.5-flash
```

### DeepSeek

```env
AI_PROVIDER=deepseek
DEEPSEEK_API_KEY=...
AI_MODEL=deepseek-chat
```

Only one key is needed. Restart `npm run dev` after editing `.env.local`. Provider requests are server-side, validated with Zod, time-limited, and fall back to the demo AI when enabled.

## Doctor Demo

1. Open `/inbox` and `/demo/patient` side by side.
2. In the patient simulator, send: `Hi, I'm 29 and my hair has become very thin from the front for almost 3 years. I'm thinking about hair transplant.`
3. Show the inbox identify Hair Transplant, age 29, concern, duration, hot score, CRM events and relevant content.
4. Send: `How much does it cost?` Show the safe assessment-based answer with no invented price.
5. Send: `Can I come tomorrow evening?` Show 5:00 PM, 5:30 PM and 6:00 PM from the real slot inventory.
6. Send: `5:30 works` Show the confirmed appointment, CRM stage and scheduled reminders.
7. Wait 45 seconds for the first compressed demo reminder, or use **Trigger Reminder Now** in Demo Control.
8. In the inbox click **Take Over**, send a human reception message, then click **Return to AI**.
9. Send `Thank you` from the patient simulator to show that AI resumes with appointment context.

## Reset Demo

Use **RESET PRIMARY DEMO** at `/demo/control`, or run:

```bash
npm run db:reset
```

This restores the seeded CRM, fresh Rahul conversation, content library, slots and automation settings.

## Commands

```bash
npm run setup       # idempotent schema + seed setup
npm run db:seed     # reset and reseed
npm run db:reset    # reset the primary demo
npm run dev         # web + follow-up worker
npm run lint
npm run typecheck
npm test
npm run build
npm start
```

## Optional WhatsApp Cloud API

The local simulator does not require WhatsApp. To prepare the official connector, fill these values in `.env.local`:

```env
WHATSAPP_ENABLED=true
WHATSAPP_ACCESS_TOKEN=...
WHATSAPP_PHONE_NUMBER_ID=...
WHATSAPP_BUSINESS_ACCOUNT_ID=...
WHATSAPP_VERIFY_TOKEN=...
WHATSAPP_API_VERSION=v23.0
PUBLIC_WEBHOOK_BASE_URL=https://your-public-url.example
```

Webhook endpoints:

- `GET/POST /api/whatsapp/webhook`
- `POST /api/whatsapp/send`

Meta requires a public HTTPS webhook. If `cloudflared` is installed, expose it only when you explicitly choose to:

```bash
cloudflared tunnel --url http://localhost:3000
```

Then configure the generated HTTPS URL plus `/api/whatsapp/webhook` in Meta. The Cloud API token, phone number ID, business account ID, verify token and approved Meta configuration are still required for a real connection.
