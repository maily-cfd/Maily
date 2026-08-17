# Deployment Guide

This guide explains how to deploy Maily to production using **Vercel** for the frontend/API and **Supabase** for the database.

---

## 1. Database Deployment (Supabase)

1. Go to [Supabase](https://supabase.com) and create a new project.
2. Navigate to the **SQL Editor** in your Supabase dashboard.
3. Open the `supabase/full_schema.sql` file from your project and copy its contents.
   > **Note:** Ensure you have also run the core tables from `supabase-schema.sql` if they aren't already included in your database.
4. Paste the SQL into the editor and click **Run** to generate all necessary tables, indexes, and policies.
5. Go to **Project Settings > API** and copy your `Project URL` and `Service Role Key`. You will need these for Vercel.

---

## 2. Frontend & API Deployment (Vercel)

Vercel is the recommended hosting platform for Next.js applications.

### Connect Your Repository
1. Push your code to a GitHub repository.
2. Go to [Vercel](https://vercel.com) and click **Add New > Project**.
3. Import your Maily GitHub repository.

### Configure Environment Variables
Before deploying, you must add your production environment variables in the Vercel dashboard.

Ensure the following critical variables are set:
- `SUPABASE_URL`: Your Supabase Project URL.
- `SUPABASE_SERVICE_ROLE_KEY`: Your Supabase Service Role Key.
- `NEXT_PUBLIC_APP_URL`: Your production domain (e.g., `https://maily.cfd`).
- `RESEND_API_KEY`: Your Resend API key.
- `RESEND_FROM_EMAIL`: Your verified sender domain (e.g., `support@maily.cfd`).
- `OPENROUTER_API_KEY` (or other LLM key): Your API key for the AI models.

Click **Deploy** and wait for Vercel to build your application.

---

## 3. Configuring Cron Jobs (Vercel Cron)

Maily relies heavily on background agents to categorize emails, draft responses, and manage meetings. These agents must be triggered periodically.

Vercel makes this easy with `vercel.json` configurations.

### Verify `vercel.json`
Your repository should include a `vercel.json` file at the root with the following configuration:

```json
{
  "crons": [
    {
      "path": "/api/cron/run-agents",
      "schedule": "* * * * *"
    },
    {
      "path": "/api/cron/meeting-lifecycle",
      "schedule": "*/5 * * * *"
    }
  ]
}
```

### Secure Your Cron Jobs
To prevent unauthorized users from triggering your cron jobs and exhausting your LLM credits, you MUST secure the cron endpoints using a `CRON_SECRET`.

1. Generate a random secure string (e.g., `openssl rand -hex 32`).
2. Add this string as `CRON_SECRET` in your Vercel Environment Variables.
3. Vercel will automatically attach this secret via the `Authorization` header when it triggers the cron jobs, and your API routes will verify it.

---

## 4. Post-Deployment Checks

1. Visit your production URL (`https://maily.cfd`) to ensure the site loads correctly and the WebGL background renders.
2. Try logging in or creating an account to verify Supabase authentication.
3. Check the **Logs** in your Vercel dashboard to ensure the `/api/cron/run-agents` endpoint is successfully executing every minute without throwing 401 Unauthorized errors.

Your Maily instance is now live in production!
