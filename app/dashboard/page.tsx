// @ts-ignore
import { auth } from '@/lib/auth';
import { redirect } from 'next/navigation';
import { DatabaseService } from '@/lib/supabase';

// Server-side component that handles authentication
export default async function DashboardPage() {
  // @ts-ignore
  const session = await auth();

  // If no session exists, redirect to home page
  if (!session) {
    redirect('/');
  }

  const userEmail = session.user?.email?.toLowerCase();

  // Auto-mark onboarding as complete for authenticated users and redirect to home-feed
  if (userEmail) {
    try {
      const db = new DatabaseService();
      const profile = await db.getUserProfile(userEmail);
      if (!profile?.onboarding_completed) {
        await db.supabase
          .from('user_profiles')
          .update({ onboarding_completed: true })
          .ilike('user_id', userEmail);
      }
    } catch (error) {
      console.error('Error in dashboard page:', error);
    }
  }

  // All authenticated users go directly to the main app
  redirect('/home-feed');
}
