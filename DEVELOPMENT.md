# Development Guide

Welcome to the Maily development guide! This document will walk you through setting up the project locally so you can start contributing or building your own AI email assistant.

## Prerequisites

Before you begin, ensure you have the following installed on your machine:
- **Node.js** (v18 or higher)
- **npm**, **yarn**, **pnpm**, or **bun**
- A **Supabase** account (for your database and auth)
- An **OpenRouter** or **OpenAI/Anthropic** account (for the AI models)
- A **Resend** account (for sending transactional emails)

---

## 1. Local Setup

### Clone the Repository
```bash
git clone https://github.com/maily-cfd/Maily.git
cd Maily
```

### Install Dependencies
```bash
npm install
# or yarn / pnpm / bun
```

---

## 2. Environment Variables

Maily requires several environment variables to function correctly. 

1. Copy the example environment file:
   ```bash
   cp .env.example .env.local
   ```
2. Open `.env.local` and fill in the required variables:
   - **`SUPABASE_URL`** & **`SUPABASE_SERVICE_ROLE_KEY`**: Get these from your Supabase project dashboard under Project Settings > API.
   - **`OPENROUTER_API_KEY`**: Your LLM provider key.
   - **`RESEND_API_KEY`**: Your Resend API key for sending outgoing emails.
   - **`NEXT_PUBLIC_APP_URL`**: Set to `http://localhost:3000` for local development.

---

## 3. Database Initialization

Maily uses Supabase (PostgreSQL). We need to set up the core tables and schemas.

You can initialize your database by running the built-in script:
```bash
node scripts/init-db.js
```

Alternatively, you can manually copy the contents of `supabase-schema.sql` and `supabase/full_schema.sql` into the Supabase SQL Editor and execute them.

---

## 4. Running the App Locally

Start the Next.js development server:
```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

---

## 5. Simulating Background Agents (Cron Jobs)

Maily relies on background agents to process emails autonomously. In a production environment, these are triggered via cron jobs.

While developing locally, you can trigger these agents manually using `curl` or by visiting the endpoints in your browser:

**Trigger the main agent runner:**
```bash
curl -X POST http://localhost:3000/api/cron/run-agents
```

**Trigger the meeting lifecycle agent (for Cal.com scheduling):**
```bash
curl -X POST http://localhost:3000/api/cron/meeting-lifecycle
```

---

## 6. Project Structure

- `app/` - Next.js App Router pages and API routes.
  - `api/` - Backend endpoints, webhooks, and cron jobs.
  - `dashboard/` - The main authenticated UI for the app.
- `components/` - Reusable React components (UI, Modals, Layouts).
- `lib/` - Core logic, including Supabase clients, AI tools, and the Boult agent engine.
- `supabase/` - Database migrations and schema definitions.

Happy coding! If you run into issues, feel free to open an issue or ask in our community channels.
