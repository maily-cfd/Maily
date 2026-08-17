import "./dashboard.css";

export const metadata = {
  title: 'Boult | Maily',
  description: 'Chat with Boult, your AI email agent for email agentic performance.',
};

import { requirePaidSubscription } from '@/lib/access-gate';

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requirePaidSubscription();

  return (
    <div className="min-h-screen">
      {children}
    </div>
  );
}
