// app/api/profile/route.js
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth.js";
import { getSupabaseAdmin } from "@/lib/supabase.js";
import { decrypt, encrypt } from "@/lib/crypto.js";
import { isValidUrlStrict } from "@/lib/url-utils.js";
import { logEvent } from "@/lib/logsso";

// CRITICAL: Force dynamic rendering to prevent build-time evaluation
export const dynamic = 'force-dynamic';

const supabase = new Proxy({}, {
  get: (target, prop) => getSupabaseAdmin()[prop]
});

// Ensure database tables exist
async function ensureDatabaseTables() {
  try {
    // 1. Check if user_profiles exists
    const { error: profileCheckError } = await supabase
      .from("user_profiles")
      .select("id")
      .limit(1);

    if (profileCheckError && profileCheckError.message.includes('does not exist')) {
      console.log("user_profiles table missing, running total setup...");
      const setupResponse = await fetch(`${process.env.NEXTAUTH_URL || 'https://maily.cfd'}/api/database/setup`, {
        method: 'POST'
      });
      if (!setupResponse.ok) throw new Error("Setup failed");
    }

    // 2. Check for streak columns and user_activity table
    const { error: streakError } = await supabase
      .from("user_profiles")
      .select("streak_count")
      .limit(1);

    const { error: activityError } = await supabase
      .from("user_activity")
      .select("id")
      .limit(1);

    if (streakError || activityError) {
      console.log("Streak columns or user_activity table missing, migrating...");
      const migrationSQL = `
        ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS streak_count INTEGER DEFAULT 0;
        ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS last_activity_at TIMESTAMP WITH TIME ZONE;
        CREATE TABLE IF NOT EXISTS user_activity (
          id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
          user_id TEXT NOT NULL,
          activity_date DATE NOT NULL,
          count INTEGER DEFAULT 1,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
          UNIQUE(user_id, activity_date)
        );
        CREATE INDEX IF NOT EXISTS idx_user_activity_user_id ON user_activity(user_id);
        CREATE INDEX IF NOT EXISTS idx_user_activity_date ON user_activity(activity_date);
      `;
      try {
        await supabase.rpc('exec_sql', { sql: migrationSQL });
      } catch (e) {
        logEvent({ channel: "failures", event: "❌ API Error", description: String(e) });
        console.error("Migration SQL failed:", e);
      }
    }

    console.log("Database tables check completed");
  } catch (error) {
    logEvent({ channel: "failures", event: "❌ API Error", description: String(error) });
    console.error("Error checking database tables:", error);
  }
}

/**
 * Update user streak and activity log
 */
async function updateStreak(userId) {
  try {
    const today = new Date().toISOString().split('T')[0];
    const now = new Date();

    // 1. Backfill activity if few records exist (ensure history is populated)
    const { count: activityCount } = await supabase
      .from("user_activity")
      .select("id", { count: 'exact', head: true })
      .eq("user_id", userId);

    if (activityCount === null || activityCount < 5) {
      console.log(`[Streak] Search for historical activity for ${userId}...`);

      // Get activity from emails
      const { data: emails } = await supabase
        .from("user_emails")
        .select("date")
        .eq("user_id", userId)
        .limit(2000);

      // Get activity from chats
      const { data: chats } = await supabase
        .from("agent_chat_history")
        .select("created_at")
        .eq("user_id", userId)
        .limit(1000);

      const combinedDates = [
        ...(emails || []).map(e => new Date(e.date).toISOString().split('T')[0]),
        ...(chats || []).map(c => new Date(c.created_at).toISOString().split('T')[0])
      ];

      if (combinedDates.length > 0) {
        const dateCounts = combinedDates.reduce((acc, date) => {
          acc[date] = (acc[date] || 0) + 1;
          return acc;
        }, {});

        const backfillData = Object.entries(dateCounts).map(([date, count]) => ({
          user_id: userId,
          activity_date: date,
          count: count
        }));

        // Use UPSERT for backfill to handle overlap
        for (let i = 0; i < backfillData.length; i += 100) {
          const chunk = backfillData.slice(i, i + 100);
          await supabase.from("user_activity").upsert(chunk, { onConflict: 'user_id,activity_date' });
        }
        console.log(`[Streak] Backfilled ${combinedDates.length} points for ${userId}`);
      }
    }

    // 2. Log activity for today (incrementing count)
    const { data: existingToday } = await supabase
      .from("user_activity")
      .select("count")
      .eq("user_id", userId)
      .eq("activity_date", today)
      .maybeSingle();

    if (existingToday) {
      await supabase.from("user_activity")
        .update({ count: (existingToday.count || 0) + 1 })
        .eq("user_id", userId)
        .eq("activity_date", today);
    } else {
      await supabase.from("user_activity").insert({
        user_id: userId,
        activity_date: today,
        count: 1
      });
    }

    // 3. Update Profile Streak
    const { data: profile } = await supabase
      .from("user_profiles")
      .select("streak_count, last_activity_at")
      .eq("user_id", userId)
      .maybeSingle();

    if (!profile) {
      // Create skeleton profile so streak exists
      await supabase.from("user_profiles").upsert({
        user_id: userId,
        email: userId,
        streak_count: 1,
        last_activity_at: now.toISOString(),
        updated_at: now.toISOString()
      }, { onConflict: 'user_id' });
      return 1;
    }

    const lastActivity = profile.last_activity_at ? new Date(profile.last_activity_at) : null;
    let newStreak = profile.streak_count || 0;

    if (!lastActivity) {
      newStreak = 1;
    } else {
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      const yesterdayStr = yesterday.toISOString().split('T')[0];
      const lastActivityStr = lastActivity.toISOString().split('T')[0];

      if (lastActivityStr === today) {
        if (newStreak === 0) newStreak = 1;
      } else if (lastActivityStr === yesterdayStr) {
        newStreak += 1;
      } else {
        newStreak = 1;
      }
    }

    await supabase.from("user_profiles").update({
      streak_count: newStreak,
      last_activity_at: now.toISOString(),
      updated_at: now.toISOString()
    }).eq("user_id", userId);

    return newStreak;
  } catch (error) {
    logEvent({ channel: "failures", event: "❌ API Error", description: String(error) });
    console.error("Error in updateStreak:", error);
    return 0;
  }
}

async function refreshAccessToken(row) {
  if (!row.encrypted_refresh_token) throw new Error("no_refresh_token");
  const refresh_token = decrypt(row.encrypted_refresh_token);
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      refresh_token,
      grant_type: "refresh_token",
    }),
  });
  const body = await r.json();
  if (body.error) throw new Error(JSON.stringify(body));
  const enc = encrypt(body.access_token);
  const expiry = body.expires_in ? new Date(Date.now() + body.expires_in * 1000).toISOString() : null;
  await supabase.from("user_tokens").update({
    encrypted_access_token: enc,
    access_token_expires_at: expiry,
    last_refreshed_at: new Date().toISOString(),
  }).eq("google_email", row.google_email);
  return body.access_token;
}

// GET - Retrieve user profile
export async function GET(req) {
  try {
    // Check for legacy Gmail profile fetch
    let email = null;
    let forceRefresh = false;
    try {
      const url = new URL(req.url);
      email = url.searchParams.get("email");
      forceRefresh = url.searchParams.get("force_refresh") === "true";
    } catch (urlError) {
      logEvent({ channel: "failures", event: "❌ API Error", description: String(urlError) });
      console.error("Error parsing URL:", urlError);
      // Continue without email param
    }

    // AUTH FIRST — the legacy `?email=` branch below used to run BEFORE any
    // session check, so anyone could read any user's Gmail profile just by
    // guessing their address. Authenticate, then only ever act on the session's
    // own identity.
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    }

    if (!session.user.email) {
      console.error("Session user missing email:", session.user);
      return NextResponse.json({ error: "Invalid session: missing email" }, { status: 401 });
    }

    const sessionEmail = session.user.email;

    if (email) {
      // A caller may still pass ?email=, but only for their OWN address.
      if (email.toLowerCase() !== sessionEmail.toLowerCase()) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
      return await getGmailProfile(sessionEmail);
    }

    // Validate environment variables
    if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
      console.error("Missing Supabase environment variables");
      throw new Error("Server configuration error: Missing database credentials");
    }

    const user = { email: sessionEmail };

    // If force_refresh, clear existing activity to force full rebackfill
    if (forceRefresh) {
      console.log(`[Profile] Force refresh requested for ${user.email}`);
      await supabase.from("user_activity").delete().eq("user_id", user.email);
    }

    // Ensure database tables exist
    await ensureDatabaseTables();

    // Update streak for the authenticated user
    await updateStreak(user.email);

    // Fetch profile from database using email as user_id
    const { data: profile, error } = await supabase
      .from("user_profiles")
      .select("*")
      .eq("user_id", user.email)
      .maybeSingle();

    // Fetch activity log for the streak card (last 6 months)
    const sixMonthsAgo = new Date();
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);

    const { data: activityData } = await supabase
      .from("user_activity")
      .select("activity_date, count")
      .eq("user_id", user.email)
      .gte("activity_date", sixMonthsAgo.toISOString().split('T')[0])
      .order("activity_date", { ascending: true });

    if (profile) {
      profile.activity_history = activityData || [];
    }

    if (error && error.code !== 'PGRST116') {
      console.error("Supabase query error:", error);
      throw error;
    }

    if (!profile) {
      console.log("No existing profile found, attempting Gmail sync...");

      // Try to sync from Gmail first before creating fallback
      try {
        const syncResponse = await fetch(`${req.nextUrl.origin}/api/profile/sync`, {
          method: 'POST',
          headers: {
            'cookie': req.headers.get('cookie') || ''
          }
        });

        if (syncResponse.ok) {
          console.log("Gmail sync successful, fetching synced profile...");
          const syncedProfile = await syncResponse.json();
          return NextResponse.json(syncedProfile.profile);
        } else {
          console.log("Gmail sync failed, creating fallback profile");
        }
      } catch (syncError) {
        logEvent({ channel: "failures", event: "❌ API Error", description: String(syncError) });
        console.warn("Gmail sync failed (non-critical):", syncError);
      }

      // If no profile exists and Gmail sync failed, return basic info
      // Check if user has tokens (handle errors gracefully)
      let tokens = [];
      try {
        const { data: tokensData, error: tokensError } = await supabase
          .from("user_tokens")
          .select("google_email")
          .eq("google_email", user.email);
        if (!tokensError) {
          tokens = tokensData || [];
        } else {
          console.warn("Error fetching tokens (non-critical):", tokensError);
        }
      } catch (e) {
        logEvent({ channel: "failures", event: "❌ API Error", description: String(e) });
        console.warn("Exception fetching tokens (non-critical):", e);
      }

      let emailCount = 0;
      try {
        const { count, error: countError } = await supabase
          .from("user_emails")
          .select("*", { count: 'exact', head: true })
          .eq("user_id", user.email);
        if (!countError) {
          emailCount = count || 0;
        } else {
          console.warn("Error counting emails (non-critical):", countError);
        }
      } catch (e) {
        logEvent({ channel: "failures", event: "❌ API Error", description: String(e) });
        console.warn("Exception counting emails (non-critical):", e);
      }

      return NextResponse.json({
        user_id: user.email,
        email: user.email,
        name: session.user.name || null,
        username: null,
        picture: session.user.image || null,
        avatar_url: session.user.image || null,
        banner_url: null,
        bio: null,
        location: null,
        website: null,
        status: 'online',
        preferences: { theme: 'dark', language: 'en', notifications: true, email_frequency: 'daily', timezone: 'UTC' },
        birthdate: null,
        gender: null,
        work_status: null,
        interests: [],
        last_synced_at: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        // Enhanced data for Maily
        email_accounts_connected: tokens.length || 0,
        emails_processed: emailCount || 0,
        plan: profile?.preferences?.plan || 'No Active Plan',
        storage_used: `${Math.round(emailCount * 0.1)} MB`,
        last_email_activity: null
      });
    }

    // Fetch additional data for Maily
    // Query by google_email since tokens might be stored with email as user_id
    let tokens = [];
    try {
      const { data: tokensData, error: tokensError } = await supabase
        .from("user_tokens")
        .select("google_email")
        .eq("google_email", user.email);
      if (!tokensError) {
        tokens = tokensData || [];
      } else {
        console.warn("Error fetching tokens (non-critical):", tokensError);
      }
    } catch (e) {
      logEvent({ channel: "failures", event: "❌ API Error", description: String(e) });
      console.warn("Exception fetching tokens (non-critical):", e);
    }

    let emailCount = 0;
    try {
      const { count, error: countError } = await supabase
        .from("user_emails")
        .select("*", { count: 'exact', head: true })
        .eq("user_id", user.email);
      if (!countError) {
        emailCount = count || 0;
      } else {
        console.warn("Error counting emails (non-critical):", countError);
      }
    } catch (e) {
      logEvent({ channel: "failures", event: "❌ API Error", description: String(e) });
      console.warn("Exception counting emails (non-critical):", e);
    }

    let lastEmail = null;
    try {
      const { data: lastEmailData, error: lastEmailError } = await supabase
        .from("user_emails")
        .select("date")
        .eq("user_id", user.email)
        .order("date", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (!lastEmailError) {
        lastEmail = lastEmailData;
      } else {
        console.warn("Error fetching last email (non-critical):", lastEmailError);
      }
    } catch (e) {
      logEvent({ channel: "failures", event: "❌ API Error", description: String(e) });
      console.warn("Exception fetching last email (non-critical):", e);
    }

    const enhancedProfile = {
      ...profile,
      email_accounts_connected: tokens.length || 0,
      emails_processed: emailCount || 0,
      plan: profile?.preferences?.plan || 'No Active Plan',
      storage_used: `${Math.round(emailCount * 0.1)} MB`, // Rough estimate
      last_email_activity: lastEmail?.date || null,
      // Ensure defaults for new fields - always set them
      bio: profile.bio || null,
      location: profile.location || null, // Will be empty until user sets it
      website: profile.website || null,
      status: profile.status || 'online',
      banner_url: profile.banner_url || null,
      preferences: profile.preferences || { theme: 'dark', language: 'en', notifications: true, email_frequency: 'daily', timezone: 'UTC' },
      birthdate: profile.birthdate || null,
      gender: profile.gender || null,
      work_status: profile.work_status || null,
      interests: profile.interests || []
    };

    return NextResponse.json(enhancedProfile);
  } catch (err) {
    logEvent({ channel: "failures", event: "❌ API Error", description: String(err) });
    console.error("Profile GET error:", err);
    console.error("Error details:", {
      message: err.message,
      stack: err.stack,
      code: err.code,
      details: err.details
    });

    // Handle authentication errors
    if (err.message === "Authentication required" || err.message?.includes("Authentication")) {
      return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    }

    // Try to get session for fallback profile
    try {
      const session = await auth();
      if (session?.user?.email) {
        // Return a minimal fallback profile instead of error
        console.warn("Returning fallback profile due to error:", err.message);
        return NextResponse.json({
          user_id: session.user.email,
          email: session.user.email,
          name: session.user.name || null,
          picture: session.user.image || null,
          avatar_url: session.user.image || null,
          banner_url: null,
          bio: null,
          location: null,
          website: null,
          status: 'online',
          preferences: { theme: 'dark', language: 'en', notifications: true, email_frequency: 'daily', timezone: 'UTC' },
          birthdate: null,
          gender: null,
          work_status: null,
          interests: [],
          last_synced_at: null,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          email_accounts_connected: 0,
          emails_processed: 0,
          plan: profile?.preferences?.plan || 'No Active Plan',
          storage_used: '0 MB',
          last_email_activity: null
        });
      }
    } catch (fallbackError) {
      logEvent({ channel: "failures", event: "❌ API Error", description: String(fallbackError) });
      console.error("Error creating fallback profile:", fallbackError);
    }

    // If we can't create a fallback, return error
    return NextResponse.json({
      error: err.message || "Internal server error",
      details: process.env.NODE_ENV === 'development' ? String(err) : undefined
    }, { status: 500 });
  }
}

// PUT - Create or update user profile
export async function PUT(req) {
  try {
    console.log("PUT /api/profile - Starting profile update");
    const session = await auth();
    if (!session?.user) {
      console.log("PUT /api/profile - Authentication failed");
      return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    }
    const user = { email: session.user.email };
    console.log("PUT /api/profile - User authenticated:", user.email);

    // Ensure database tables exist
    await ensureDatabaseTables();

    const body = await req.json();
    console.log("PUT /api/profile - Request body:", JSON.stringify(body, null, 2));

    // Validate required fields
    const { name, avatar_url, bio, location, website, status, preferences, birthdate, gender, work_status, interests, banner_url, username } = body;

    // URL validation for website field
    if (website && website.trim() && !isValidUrlStrict(website.trim())) {
      return NextResponse.json({ error: "Invalid website URL format" }, { status: 400 });
    }

    // URL validation for banner_url (optional) - allow empty strings, null, or valid URLs
    const bannerUrlValue = banner_url !== undefined && banner_url !== null ? String(banner_url).trim() : '';
    if (bannerUrlValue && bannerUrlValue.length > 0) {
      // Check if it's a valid URL (either starts with https:// or is a Supabase storage URL)
      const isValidBanner = bannerUrlValue.startsWith('https://') || bannerUrlValue.startsWith('http://');
      if (!isValidBanner) {
        console.log("Invalid banner URL format:", bannerUrlValue);
        return NextResponse.json({ error: "Invalid banner image URL format" }, { status: 400 });
      }
    }

    // URL validation for avatar_url (optional) - allow empty strings, null, or valid URLs
    const avatarUrlValue = avatar_url !== undefined && avatar_url !== null ? String(avatar_url).trim() : '';
    if (avatarUrlValue && avatarUrlValue.length > 0) {
      const isValidAvatar = avatarUrlValue.startsWith('https://') || avatarUrlValue.startsWith('http://');
      if (!isValidAvatar) {
        console.log("Invalid avatar URL format:", avatarUrlValue);
        return NextResponse.json({ error: "Invalid avatar image URL format" }, { status: 400 });
      }
    }

    // Build profile data, only including defined values
    const profileData = {
      user_id: user.email, // Use email as user_id for consistency with tokens
      email: user.email,
      updated_at: new Date().toISOString()
    };

    // Only include fields that are provided (not undefined)
    if (name !== undefined) profileData.name = name;
    if (avatar_url !== undefined) profileData.avatar_url = avatar_url;
    if (banner_url !== undefined) profileData.banner_url = banner_url;
    if (bio !== undefined) profileData.bio = bio;
    if (location !== undefined) profileData.location = location;
    if (website !== undefined) profileData.website = website;
    if (status !== undefined) profileData.status = status || 'online';
    if (username !== undefined) profileData.username = username;
    if (preferences !== undefined) {
      profileData.preferences = {
        theme: 'dark',
        language: 'en',
        notifications: true,
        email_frequency: 'daily',
        timezone: 'UTC',
        ...preferences
      };
    }
    if (birthdate !== undefined) profileData.birthdate = birthdate;
    if (gender !== undefined) profileData.gender = gender;
    if (work_status !== undefined) profileData.work_status = work_status;
    if (interests !== undefined) profileData.interests = interests;

    // Only set last_synced_at if we're doing a full update
    profileData.last_synced_at = new Date().toISOString();

    console.log("PUT /api/profile - Profile data to save:", JSON.stringify(profileData, null, 2));

    // Check if profile exists
    console.log("PUT /api/profile - Checking if profile exists for user:", user.email);
    const { data: existingProfile, error: checkError } = await supabase
      .from("user_profiles")
      .select("id")
      .eq("user_id", user.email)
      .maybeSingle();

    if (checkError) {
      console.error("PUT /api/profile - Error checking existing profile:", checkError);
      throw checkError;
    }

    console.log("PUT /api/profile - Existing profile check result:", existingProfile);

    let result;
    if (existingProfile) {
      console.log("PUT /api/profile - Updating existing profile");
      // Update existing profile
      const { data, error } = await supabase
        .from("user_profiles")
        .update(profileData)
        .eq("user_id", user.email)
        .select()
        .single();

      if (error) {
        console.error("PUT /api/profile - Error updating profile:", error);
        console.error("Error details:", {
          message: error.message,
          code: error.code,
          details: error.details,
          hint: error.hint
        });
        throw error;
      }
      console.log("PUT /api/profile - Profile updated successfully:", data);
      result = data;
    } else {
      console.log("PUT /api/profile - Creating new profile");
      // Create new profile with defaults for required fields
      const createData = {
        ...profileData,
        name: profileData.name || null,
        avatar_url: profileData.avatar_url || null,
        banner_url: profileData.banner_url || null,
        bio: profileData.bio || null,
        location: profileData.location || null,
        website: profileData.website || 'https://example.com',
        status: profileData.status || 'online',
        preferences: profileData.preferences || { theme: 'dark', language: 'en', notifications: true, email_frequency: 'daily', timezone: 'UTC' },
        birthdate: profileData.birthdate || '1999-01-01',
        gender: profileData.gender || 'Not specified',
        work_status: profileData.work_status || 'Professional',
        interests: profileData.interests || ['Technology', 'Productivity', 'AI'],
        created_at: new Date().toISOString()
      };

      const { data, error } = await supabase
        .from("user_profiles")
        .insert(createData)
        .select()
        .single();

      if (error) {
        console.error("PUT /api/profile - Error creating profile:", error);
        console.error("Error details:", {
          message: error.message,
          code: error.code,
          details: error.details,
          hint: error.hint
        });
        throw error;
      }
      console.log("PUT /api/profile - Profile created successfully:", data);
      result = data;
    }

    console.log("PUT /api/profile - Returning result:", result);
    return NextResponse.json(result);
  } catch (err) {
    logEvent({ channel: "failures", event: "❌ API Error", description: String(err) });
    console.error("Profile PUT error:", err);
    console.error("Error details:", {
      message: err.message,
      stack: err.stack,
      code: err.code,
      details: err.details,
      hint: err.hint
    });

    if (err.message === "Authentication required" || err.message?.includes("Authentication")) {
      return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    }

    // Provide more specific error messages
    let errorMessage = "Failed to update profile";
    if (err.code === '23505') {
      errorMessage = "Profile already exists with this information";
    } else if (err.code === '23503') {
      errorMessage = "Invalid reference in profile data";
    } else if (err.code === '23502') {
      errorMessage = "Required field is missing";
    } else if (err.message) {
      errorMessage = err.message;
    }

    return NextResponse.json({
      error: errorMessage,
      details: process.env.NODE_ENV === 'development' ? {
        code: err.code,
        details: err.details,
        hint: err.hint
      } : undefined
    }, { status: 500 });
  }
}

// PATCH - Partial profile update
export async function PATCH(req) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    }

    if (!session.user.email) {
      console.error("Session user missing email:", session.user);
      return NextResponse.json({ error: "Invalid session: missing email" }, { status: 401 });
    }

    const user = { email: session.user.email };

    // Ensure database tables exist
    await ensureDatabaseTables();

    const body = await req.json();

    console.log("PATCH request body:", body);

    // URL validation for website field
    if (body.website && body.website.trim() && !isValidUrlStrict(body.website.trim())) {
      return NextResponse.json({ error: "Invalid website URL format" }, { status: 400 });
    }

    // Build update object with only provided fields
    const updateData = {
      updated_at: new Date().toISOString()
      // Note: last_synced_at column may not exist in current schema, so we'll skip it for now
    };

    // Map frontend field names to database column names
    const fieldMapping = {
      name: 'name',
      avatar_url: 'avatar_url',
      banner_url: 'banner_url',
      bio: 'bio',
      location: 'location',
      website: 'website',
      status: 'status',
      preferences: 'preferences',
      birthdate: 'birthdate',
      gender: 'gender',
      work_status: 'work_status',
      interests: 'interests',
      username: 'username'
    };

    // Only include fields that exist in the database schema and are provided
    Object.keys(fieldMapping).forEach(field => {
      if (body[field] !== undefined && body[field] !== null) {
        updateData[fieldMapping[field]] = body[field];
      }
    });

    console.log("Update data:", updateData);

    // First check if profile exists
    const { data: existingProfile, error: checkError } = await supabase
      .from("user_profiles")
      .select("id")
      .eq("user_id", user.email)
      .maybeSingle();

    if (checkError && checkError.code !== 'PGRST116') {
      console.error("PATCH - Error checking existing profile:", checkError);
      throw checkError;
    }

    console.log("Existing profile check:", existingProfile);

    if (!existingProfile) {
      console.log("No existing profile found, creating new one");
      // Create new profile if it doesn't exist
      const createData = {
        user_id: user.email,
        email: user.email,
        name: null,
        avatar_url: null,
        banner_url: null,
        bio: null,
        location: null,
        website: 'https://example.com',
        status: 'online',
        preferences: { theme: 'dark', language: 'en', notifications: true, email_frequency: 'daily', timezone: 'UTC' },
        birthdate: '1999-01-01',
        gender: 'Not specified',
        work_status: 'Professional',
        interests: ['Technology', 'Productivity', 'AI'],
        ...updateData
      };

      const { data, error } = await supabase
        .from("user_profiles")
        .insert(createData)
        .select()
        .single();

      if (error) {
        console.error("Profile create error:", error);
        console.error("Error details:", {
          message: error.message,
          code: error.code,
          details: error.details,
          hint: error.hint
        });

        let errorMessage = "Failed to create profile";
        if (error.code === '23505') {
          errorMessage = "Profile already exists with this information";
        } else if (error.code === '23503') {
          errorMessage = "Invalid reference in profile data";
        } else if (error.code === '23502') {
          errorMessage = "Required field is missing";
        } else if (error.message) {
          errorMessage = error.message;
        }

        return NextResponse.json({
          error: errorMessage,
          details: process.env.NODE_ENV === 'development' ? {
            code: error.code,
            details: error.details,
            hint: error.hint
          } : undefined
        }, { status: 500 });
      }

      console.log("Profile created successfully:", data);
      return NextResponse.json(data);
    }

    // Update existing profile
    const { data, error } = await supabase
      .from("user_profiles")
      .update(updateData)
      .eq("user_id", user.email)
      .select()
      .single();

    if (error) {
      console.error("Profile patch error:", error);
      console.error("Error details:", {
        message: error.message,
        code: error.code,
        details: error.details,
        hint: error.hint
      });

      let errorMessage = "Failed to update profile";
      if (error.code === '23505') {
        errorMessage = "Profile already exists with this information";
      } else if (error.code === '23503') {
        errorMessage = "Invalid reference in profile data";
      } else if (error.code === '23502') {
        errorMessage = "Required field is missing";
      } else if (error.message) {
        errorMessage = error.message;
      }

      return NextResponse.json({
        error: errorMessage,
        details: process.env.NODE_ENV === 'development' ? {
          code: error.code,
          details: error.details,
          hint: error.hint
        } : undefined
      }, { status: 500 });
    }

    console.log("Profile updated successfully:", data);
    return NextResponse.json(data);
  } catch (err) {
    logEvent({ channel: "failures", event: "❌ API Error", description: String(err) });
    console.error("Profile PATCH error:", err);
    console.error("Error details:", {
      message: err.message,
      stack: err.stack,
      code: err.code,
      details: err.details,
      hint: err.hint
    });

    if (err.message === "Authentication required" || err.message?.includes("Authentication")) {
      return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    }

    let errorMessage = err.message || "Failed to update profile";
    return NextResponse.json({
      error: errorMessage,
      details: process.env.NODE_ENV === 'development' ? String(err) : undefined
    }, { status: 500 });
  }
}

// Legacy Gmail profile fetch function
async function getGmailProfile(email) {
  const { data: row } = await supabase.from("user_tokens").select("*").eq("google_email", email).maybeSingle();
  if (!row) return NextResponse.json({ error: "no_tokens" }, { status: 404 });

  let access = null;
  try {
    if (row.encrypted_access_token) access = decrypt(row.encrypted_access_token);
  } catch (e) {
    logEvent({ channel: "failures", event: "❌ API Error", description: String(e) });
    access = null;
  }

  // try fetch; on 401 try refresh once
  const profileFetch = async (token) => {
    const { googleFetch } = await import('@/lib/boult/tools/http-tokens');
    const r = await googleFetch(email, 'gmail', "https://www.googleapis.com/gmail/v1/users/me/profile", {
      headers: { Authorization: `Bearer ${token}` },
    });
    const text = await r.text();
    return { ok: r.ok, status: r.status, text };
  };

  if (access) {
    const res = await profileFetch(access);
    if (res.ok) return NextResponse.json(JSON.parse(res.text));
    if (res.status === 401) {
      // attempt refresh
      try {
        const newToken = await refreshAccessToken(row);
        const retry = await profileFetch(newToken);
        if (retry.ok) return NextResponse.json(JSON.parse(retry.text));
        return NextResponse.json({ error: retry.text }, { status: retry.status });
      } catch (err) {
        logEvent({ channel: "failures", event: "❌ API Error", description: String(err) });
        return NextResponse.json({ error: String(err) }, { status: 401 });
      }
    }
    return NextResponse.json({ error: res.text }, { status: res.status });
  }

  // no access token: try refresh
  try {
    const newToken = await refreshAccessToken(row);
    const retry = await profileFetch(newToken);
    if (retry.ok) return NextResponse.json(JSON.parse(retry.text));
    return NextResponse.json({ error: retry.text }, { status: retry.status });
  } catch (err) {
    logEvent({ channel: "failures", event: "❌ API Error", description: String(err) });
    return NextResponse.json({ error: String(err) }, { status: 401 });
  }
}


// DELETE - Permanently delete account and all data
export async function DELETE(req) {
  try {
    const session = await auth();
    if (!session?.user?.email) {
      return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    }

    const userId = session.user.email;
    console.log(`🧨 DELETE ACCOUNT REQUEST: ${userId}`);

    // All relevant tables to wipe
    const tables = [
      'agent_chat_history',
      'search_history',
      'saved_searches',
      'unsubscribed_emails',
      'search_index',
      'search_performance',
      'notes',
      'user_emails',
      'user_tokens',
      'user_profiles'
    ];

    for (const table of tables) {
      try {
        const { error } = await supabase
          .from(table)
          .delete()
          .eq('user_id', userId);

        if (error) {
          // Fallback for user_tokens which might use google_email
          if (table === 'user_tokens') {
            await supabase.from(table).delete().eq('google_email', userId);
          } else {
            console.warn(`⚠️ Warning: Deletion for ${table} failed or returned error:`, error.message);
          }
        }
      } catch (err) {
        logEvent({ channel: "failures", event: "❌ API Error", description: String(err) });
        console.warn(`⚠️ Warning: Exception deleting from ${table}:`, err.message);
      }
    }

    console.log(`✅ ACCOUNT PERMANENTLY DELETED: ${userId}`);
    return NextResponse.json({ success: true, message: "Account and all associated data have been permanently deleted." });

  } catch (error) {
    logEvent({ channel: "failures", event: "❌ API Error", description: String(error) });
    console.error("💥 ERROR DURING ACCOUNT DELETION:", error);
    return NextResponse.json({ error: "Failed to permanently delete account data." }, { status: 500 });
  }
}
