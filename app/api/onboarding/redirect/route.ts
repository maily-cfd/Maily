import { NextResponse } from "next/server";
// @ts-ignore
import { auth } from "@/lib/auth";
import { DatabaseService } from "@/lib/supabase";
import { logEvent } from "@/lib/logsso";

export async function GET() {
  try {
    // @ts-ignore
    const session = await auth();
    if (!session?.user?.email) {
      return NextResponse.json({ redirectTo: "/auth/signin" });
    }

    const userEmail = session.user.email.toLowerCase();
    const db = new DatabaseService(true);
    const profile = await db.getUserProfile(userEmail);

    console.log(`🔍 Checking onboarding redirect for: ${userEmail}`);
    console.log(`👤 Profile: ${!!profile}, Completed: ${profile?.onboarding_completed}`);

    // If onboarding is explicitly completed — go straight to the app.
    if (profile?.onboarding_completed) {
      return NextResponse.json({ redirectTo: "/home-feed" });
    }

    // Not completed yet — auto-complete it so they get straight in next time.
    try {
      if (profile?.id) {
        await db.supabase
          .from('user_profiles')
          .update({ onboarding_completed: true })
          .eq('id', profile.id);
      } else if (profile?.user_id) {
        await db.supabase
          .from('user_profiles')
          .upsert({
            user_id: userEmail,
            email: userEmail,
            onboarding_completed: true,
            updated_at: new Date().toISOString()
          }, { onConflict: 'user_id' });
      }
    } catch (e) {
      console.error('Error auto-completing onboarding:', e);
    }

    // Send them to the onboarding flow if profile not yet set up,
    // or home-feed directly if profile exists.
    if (profile) {
      return NextResponse.json({ redirectTo: "/home-feed" });
    }

    return NextResponse.json({ redirectTo: "/onboarding" });
  } catch (error) {
    logEvent({ channel: "failures", event: "❌ API Error", description: String(error) });
    console.error("Error checking onboarding redirect:", error);
    return NextResponse.json({ redirectTo: "/onboarding" });
  }
}
