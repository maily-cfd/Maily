/**
 * Briefing preferences — how the user wants their daily "Worth your time"
 * recommendations shaped. Stored under `user_profiles.preferences.briefing` (the
 * same JSON column the rest of the app uses), so there's no new table.
 *
 * Single source of truth for the shape + validation + read/write, shared by:
 *   - GET/POST  /api/home-feed/briefing-prefs   (the Customize Briefing modal)
 *   - POST      /api/home-feed/recommendations   (applies them to the LLM prompt)
 */

export type BriefingFocus = 'balanced' | 'connections' | 'productivity';
export type BriefingTone = 'direct' | 'warm' | 'detailed';

export interface BriefingApps {
  gmail: boolean;
  calendar: boolean;
  calcom: boolean;
  notion: boolean;
  slack: boolean;
}

export interface BriefingPrefs {
  /** What to lean toward when ranking the moves. */
  focus: BriefingFocus;
  /** How the titles/summaries should read. */
  tone: BriefingTone;
  /** Which connected apps to draw signals from. */
  apps: BriefingApps;
  /** How many recommendations to show (2–4). */
  maxRecommendations: number;
  /** Free-text standing instruction ("always surface revenue first", etc.). */
  customInstructions: string;
}

export const DEFAULT_BRIEFING_PREFS: BriefingPrefs = {
  focus: 'balanced',
  tone: 'warm',
  apps: { gmail: true, calendar: true, calcom: true, notion: true, slack: true },
  maxRecommendations: 3,
  customInstructions: '',
};

const FOCI: BriefingFocus[] = ['balanced', 'connections', 'productivity'];
const TONES: BriefingTone[] = ['direct', 'warm', 'detailed'];

/** Validate + fill any partial/untrusted object into a complete BriefingPrefs. */
export function coerceBriefingPrefs(raw: any): BriefingPrefs {
  const d = DEFAULT_BRIEFING_PREFS;
  const r = raw && typeof raw === 'object' ? raw : {};
  const a = r.apps && typeof r.apps === 'object' ? r.apps : {};
  const max = Number(r.maxRecommendations);
  return {
    focus: FOCI.includes(r.focus) ? r.focus : d.focus,
    tone: TONES.includes(r.tone) ? r.tone : d.tone,
    apps: {
      gmail: a.gmail !== false,
      calendar: a.calendar !== false,
      calcom: a.calcom !== false,
      notion: a.notion !== false,
      slack: a.slack !== false,
    },
    maxRecommendations: [2, 3, 4].includes(max) ? max : d.maxRecommendations,
    customInstructions: typeof r.customInstructions === 'string' ? r.customInstructions.trim().slice(0, 500) : '',
  };
}

/** Read the user's briefing prefs (defaults on any miss/error). */
export async function getBriefingPrefs(userId: string): Promise<BriefingPrefs> {
  try {
    // @ts-ignore — JS module
    const { getSupabaseAdmin } = await import('../supabase.js');
    const supabase = getSupabaseAdmin();
    const { data } = await supabase
      .from('user_profiles')
      .select('preferences')
      .ilike('user_id', userId.toLowerCase())
      .maybeSingle();
    return coerceBriefingPrefs((data?.preferences as any)?.briefing);
  } catch {
    return DEFAULT_BRIEFING_PREFS;
  }
}

/** Persist briefing prefs, merging into the existing preferences JSON. */
export async function saveBriefingPrefs(userId: string, incoming: BriefingPrefs): Promise<void> {
  // @ts-ignore — JS module
  const { getSupabaseAdmin } = await import('../supabase.js');
  const supabase = getSupabaseAdmin();
  const uid = userId.toLowerCase();
  const { data: existing } = await supabase
    .from('user_profiles')
    .select('preferences')
    .ilike('user_id', uid)
    .maybeSingle();
  const existingPrefs = (existing?.preferences as Record<string, unknown>) || {};
  const updatedPrefs = { ...existingPrefs, briefing: incoming };
  if (existing) {
    await supabase.from('user_profiles').update({ preferences: updatedPrefs }).ilike('user_id', uid);
  } else {
    await supabase.from('user_profiles').insert({ user_id: uid, preferences: updatedPrefs });
  }
}
