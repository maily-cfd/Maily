<div align="center">
  <img src="public/logo-maily.png" alt="Maily Logo" width="120" />
  <h1>Maily</h1>
  <p><strong>The open-source, AI-powered email client designed for solo founders and professionals.</strong></p>
</div>

Maily is a blazingly fast, privacy-first email assistant that seamlessly integrates with Google Workspace to handle triage, scheduling, and drafting so you can focus on the work that actually matters.

## ✨ Key Features

- **Autonomous Email Agents**: Smart background workers that summarize long threads, categorize incoming mail, and draft replies using context from your past communications.
- **Smart Scheduling via Cal.com**: Maily connects to your calendar to find the best available times and autonomously proposes them to external parties.
- **Voice Interactions**: Speak directly to your inbox assistant to quickly clear through emails or command the AI to draft responses.
- **Premium Interface**: Built with beautiful, fluid micro-interactions using Framer Motion and custom WebGL shaders for a delightful daily experience.
- **Data Privacy**: Complete focus on secure data handling. We use zero-knowledge principles and your emails are never used to train global AI models.

## 🛠️ Tech Stack

- **Framework**: Next.js (App Router)
- **Styling**: Tailwind CSS & Framer Motion
- **Database & Auth**: Supabase (PostgreSQL)
- **Email Sending**: Resend
- **Integrations**: Composio (for Gmail & Calendar APIs)
- **AI Models**: OpenRouter / Anthropic / OpenAI
- **Billing**: Polar.sh

## 🚀 Getting Started

### 1. Clone & Install
```bash
git clone https://github.com/maily-cfd/Maily.git
cd Maily
npm install
# or yarn install / pnpm install
```

### 2. Environment Setup
Copy the example environment file and fill in your keys:
```bash
cp .env.example .env.local
```
You will need API keys for **Supabase**, **Resend**, and your preferred **LLM provider** (like OpenRouter).

### 3. Database Initialization
Run the initialization script or execute the SQL schema in your Supabase SQL editor:
```bash
node scripts/init-db.js
```

### 4. Run the Development Server
```bash
npm run dev
```
Open [http://localhost:3000](http://localhost:3000) to view your local Maily instance.

## 🤖 Automating the Agents

Maily uses background agents that operate asynchronously. To ensure these run on a schedule, configure a cron job or use Vercel Cron to ping the following endpoints:
- `POST /api/cron/run-agents`
- `POST /api/cron/meeting-lifecycle`

## 💬 Community & Support

Maily is completely open source and community-driven. 
- **GitHub**: [Star the repo and contribute!](https://github.com/maily-cfd/Maily)
- **X (Twitter)**: Follow us at [@Mailycfd](https://x.com/Mailycfd)
- **Support**: Reach out to us at [support.maily@gmail.com](mailto:support.maily@gmail.com)

---

**Maily Team** — Built for the future of productivity.
