This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Profile Sync Setup

To ensure account information remains accurate and up-to-date, set up a cron job to run the profile sync script periodically.

### Using Cron

Add the following to your crontab (e.g., `crontab -e`):

```
0 */6 * * * cd /path/to/maily && node scripts/sync-profiles.js
```

This runs the sync every 6 hours.

### Using Vercel Cron (if deployed on Vercel)

If deployed on Vercel, you can use Vercel Cron to call the `/api/admin/sync-profiles` endpoint.

Add a cron job in Vercel dashboard: `0 */6 * * *` to POST to `https://your-domain.com/api/admin/sync-profiles`.

### Manual Sync

Users can manually sync their profiles from the Profile Settings page.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
