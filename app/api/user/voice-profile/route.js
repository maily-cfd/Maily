import { auth } from '@/lib/auth';
import { getSupabaseAdmin, DatabaseService } from '@/lib/supabase';
import { voiceProfileService } from '@/lib/voice-profile-service';
import { GmailService } from '@/lib/gmail';
import { decrypt } from '@/lib/crypto';
import { logEvent } from "@/lib/logsso";

// Building the voice profile fetches sent mail + runs LLM analysis, which can
// take a while on a busy mailbox. Give it room so it doesn't get killed at the
// platform default.
export const maxDuration = 60;

export async function GET() {
    try {
        const session = await auth();
        if (!session?.user?.email) {
            return Response.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const adminDb = getSupabaseAdmin();
        const { data: profile, error } = await adminDb
            .from('user_voice_profiles')
            .select('*')
            .eq('user_id', session.user.email)
            .single();

        if (error && error.code !== 'PGRST116') {
            console.error('Error fetching voice profile:', error);
            throw error;
        }

        return Response.json({ profile: profile || null });
    } catch (error) {
    logEvent({ channel: "failures", event: "❌ API Error", description: String(error) });
        return Response.json({ error: 'Internal Server Error', details: error.message }, { status: 500 });
    }
}

/**
 * POST — Run email analysis (Method 2) to bootstrap/refresh the profile
 */
export async function POST() {
    try {
        const session = await auth();
        if (!session?.user?.email) {
            return Response.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const userId = session.user.email;
        
        // 1. Get tokens for Gmail access
        let accessToken = session?.accessToken;
        let refreshToken = session?.refreshToken;

        if (!accessToken || !refreshToken) {
            const db = new DatabaseService();
            const userTokens = await db.getUserTokens(userId);
            if (userTokens?.encrypted_access_token) {
                accessToken = decrypt(userTokens.encrypted_access_token);
                refreshToken = userTokens.encrypted_refresh_token ? decrypt(userTokens.encrypted_refresh_token) : null;
            }
        }

        if (!accessToken) {
            return Response.json({ error: 'Gmail not connected' }, { status: 403 });
        }

        // 2. Run analysis — prefer the user's last 90 days of sent mail so the
        //    voice reflects how they write now; fall back to all-time if a
        //    low-volume sender has fewer than 3 in that window.
        // Keep the sample tight: every email is a separate Gmail round-trip, and
        // the analysis only needs ~25 to capture a voice (the LLM reads up to 15).
        const gmailService = new GmailService(accessToken, refreshToken);
        let sentEmails = await voiceProfileService.fetchSentEmails(gmailService, 25, 90);
        if (sentEmails.length < 3) {
            sentEmails = await voiceProfileService.fetchSentEmails(gmailService, 25);
        }

        if (sentEmails.length < 3) {
            return Response.json({ error: 'Not enough sent emails to analyze (minimum 3 required)' }, { status: 400 });
        }

        const profile = await voiceProfileService.analyzeVoiceProfile(sentEmails);

        // 3. Generate ONE real sample reply in the user's own voice for the
        //    "This is how you sound" preview — best-effort, never blocks save.
        try {
            const sample = await voiceProfileService.generatePreviewReply(
                profile.manual_settings,
                'Hi — could you send over the latest version of the doc when you get a chance? Hoping to review before our call tomorrow.'
            );
            if (sample && sample.trim()) profile.sample_reply = sample.trim();
        } catch (e) {
        logEvent({ channel: "failures", event: "❌ API Error", description: String(e) });
            console.warn('⚠️ Voice sample generation failed (non-fatal):', e.message);
        }

        // Record provenance so the user can see Gmail scan in their "Learning from"
        // list, preserving any manual-import sources already attached.
        const priorSources = (await voiceProfileService.getVoiceProfile(userId))?.sources;
        profile.sources = [
            ...(Array.isArray(priorSources) ? priorSources.filter((s) => s.type !== 'gmail_scan') : []),
            { type: 'gmail_scan', count: sentEmails.length, added_at: new Date().toISOString() },
        ].slice(-10);

        await voiceProfileService.saveVoiceProfile(userId, profile);

        return Response.json({ success: true, profile });
    } catch (error) {
    logEvent({ channel: "failures", event: "❌ API Error", description: String(error) });
        console.error('Error re-analyzing voice profile:', error);
        return Response.json({ error: 'Internal Server Error', details: error.message }, { status: 500 });
    }
}

/**
 * PUT — Save manual profile settings (Method 1: tone sliders, habits, custom instructions)
 */
export async function PUT(request) {
    try {
        const session = await auth();
        if (!session?.user?.email) {
            return Response.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const userId = session.user.email;
        const body = await request.json();
        const { tone, habits, customInstructions, learning, activeProfile } = body;

        // Fetch existing profile or create new one
        const existing = await voiceProfileService.getVoiceProfile(userId);
        const profile = existing || voiceProfileService.getDefaultVoiceProfile();

        // Merge manual settings into profile — v2 schema. Preserve any structured
        // directives the user added via the conversational refiner (PATCH); a tone
        // slider save must not wipe "never use emojis".
        profile.manual_settings = {
            tone: {
                formality: tone?.formality ?? 50,     // 0=Casual, 100=Formal
                detail: tone?.detail ?? 40,           // 0=Brief, 100=Detailed
                warmth: tone?.warmth ?? 50,           // 0=Warm, 100=Direct
                confidence: tone?.confidence ?? 30,   // 0=Reserved, 100=Confident
            },
            habits: Array.isArray(habits) ? habits : [],
            customInstructions: typeof customInstructions === 'string' ? customInstructions : '',
            directives: Array.isArray(existing?.manual_settings?.directives) ? existing.manual_settings.directives : [],
            allowEmoji: existing?.manual_settings?.allowEmoji,
            activeProfile: activeProfile || 'work',
        };

        // Learning preferences
        profile.learning = {
            autoImprove: learning?.autoImprove ?? true,
            lastAnalysis: profile.learning?.lastAnalysis || null,
        };

        // Rebuild prompt fragment to incorporate manual settings
        profile.prompt_fragment = voiceProfileService.buildManualPromptFragment(profile.manual_settings, profile);

        profile.status = profile.status === 'default' ? 'manual' : profile.status;
        profile.updated_at = new Date().toISOString();

        await voiceProfileService.saveVoiceProfile(userId, profile);

        return Response.json({ success: true, profile });
    } catch (error) {
    logEvent({ channel: "failures", event: "❌ API Error", description: String(error) });
        console.error('Error saving manual voice profile:', error);
        return Response.json({ error: 'Internal Server Error', details: error.message }, { status: 500 });
    }
}

// Light heuristic fallback so attributes still shift even if the LLM is down.
function heuristicAttributes(raw) {
    const t = raw.toLowerCase();
    const a = {};
    if (/no emoji|without emoji|never.*emoji|drop.*emoji|hate emoji/.test(t)) a.allowEmoji = false;
    if (/\bemoji\b/.test(t) && /(use|add|more|love)/.test(t)) a.allowEmoji = true;
    if (/short|brief|concise|to the point|less wordy|tighter/.test(t)) a.detail = 15;
    if (/long|detailed|thorough|more detail|elaborate/.test(t)) a.detail = 80;
    if (/blunt|direct|to the point|no fluff|matter.of.fact/.test(t)) a.warmth = 85;
    if (/warm|friendly|kinder|softer|less harsh/.test(t)) a.warmth = 20;
    if (/casual|relaxed|less formal|less robotic|less stiff|human/.test(t)) a.formality = 25;
    if (/formal|professional|polished/.test(t)) a.formality = 80;
    if (/confident|assertive|own it/.test(t)) a.confidence = 85;
    if (/reserved|tentative|humble/.test(t)) a.confidence = 20;
    return a;
}

/**
 * Interpret conversational feedback into (a) 1-3 crisp imperative voice rules and
 * (b) structured attribute targets (formality/detail/warmth/confidence 0-100 +
 * allowEmoji). One LLM call; falls back to the raw instruction + a keyword
 * heuristic so refinement always does *something* even if the model is down.
 */
async function interpretVoiceInstruction(instruction) {
    const key = process.env.OPENROUTER_API_KEY || process.env.OPENROUTER_API_KEY2;
    const raw = String(instruction).trim();
    const fallback = { rules: [raw], attributes: heuristicAttributes(raw) };
    if (!key) return fallback;
    try {
        const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
            method: 'POST',
            headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', 'HTTP-Referer': 'https://maily.dev' },
            body: JSON.stringify({
                // nemotron-3-super-120b:free REMOVED 2026-07-19 (user report: not working —
                // was returning empty 200s even before that). gemma-4-26b confirmed to support
                // response_format json_object (verified via OpenRouter's live /api/v1/models).
                model: 'google/gemma-4-26b-a4b-it:free',
                max_tokens: 300,
                temperature: 0.1,
                response_format: { type: 'json_object' },
                messages: [
                    {
                        role: 'system',
                        content: 'You convert a user\'s feedback about how their writing should sound into structured voice settings. ' +
                            'Output ONLY JSON: {"rules": string[], "attributes": {"formality"?: 0-100, "detail"?: 0-100, "warmth"?: 0-100, "confidence"?: 0-100, "allowEmoji"?: boolean}}. ' +
                            'rules = 1-3 short imperative style rules (max ~10 words each). ' +
                            'attributes = ONLY the dimensions the feedback clearly implies (omit the rest). Scales: formality 0=casual..100=formal; detail 0=brief..100=detailed; warmth 0=warm/friendly..100=direct/blunt; confidence 0=reserved..100=assertive. ' +
                            'Example: "no emojis, less robotic, shorter and blunter" -> {"rules":["Never use emojis.","Keep it short.","Be blunt and direct."],"attributes":{"allowEmoji":false,"formality":25,"detail":15,"warmth":85}}',
                    },
                    { role: 'user', content: raw },
                ],
            }),
            signal: AbortSignal.timeout(9000),
        });
        if (!res.ok) return fallback;
        const json = await res.json();
        let text = json.choices?.[0]?.message?.content || '';
        text = text.replace(/<\/?(?:thinking|thought|reasoning)[^>]*>/gi, '').trim();
        const parsed = JSON.parse(text);
        const rules = Array.isArray(parsed.rules)
            ? parsed.rules.map((r) => String(r || '').trim()).filter((r) => r.length >= 3 && r.length <= 140).slice(0, 3)
            : [];
        const attrs = {};
        const a = parsed.attributes || {};
        for (const k of ['formality', 'detail', 'warmth', 'confidence']) {
            if (typeof a[k] === 'number') attrs[k] = Math.max(0, Math.min(100, Math.round(a[k])));
        }
        if (typeof a.allowEmoji === 'boolean') attrs.allowEmoji = a.allowEmoji;
        return {
            rules: rules.length ? rules : [raw],
            attributes: Object.keys(attrs).length ? attrs : heuristicAttributes(raw),
        };
    } catch {
    logEvent({ channel: "failures", event: "❌ API Error", description: "Unknown error" });
        return fallback;
    }
}

/**
 * PATCH — Conversational refinement. The user types natural-language feedback
 * ("this doesn't sound like me, I never use emojis, it's too robotic"); we distill
 * it into structured directives and add them. They ride into every draft as
 * highest-priority [CRITICAL DIRECTIVES] (see buildManualPromptFragment).
 */
export async function PATCH(request) {
    try {
        const session = await auth();
        if (!session?.user?.email) {
            return Response.json({ error: 'Unauthorized' }, { status: 401 });
        }
        const userId = session.user.email;
        const { instruction } = await request.json();
        if (!instruction || !String(instruction).trim()) {
            return Response.json({ error: 'instruction is required' }, { status: 400 });
        }

        const existing = await voiceProfileService.getVoiceProfile(userId) || voiceProfileService.getDefaultVoiceProfile();
        const ms = existing.manual_settings || {};
        const directives = Array.isArray(ms.directives) ? [...ms.directives] : [];

        const { rules, attributes } = await interpretVoiceInstruction(instruction);
        const now = new Date().toISOString();
        for (const text of rules) {
            // Skip near-duplicates (case-insensitive).
            if (directives.some((d) => (d?.text || '').toLowerCase() === text.toLowerCase())) continue;
            directives.push({ id: `dir_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`, text, created_at: now, origin: 'distilled' });
        }
        // Keep the list bounded (most recent 30).
        const trimmed = directives.slice(-30);

        // Merge inferred attribute targets onto the existing tone sliders so the
        // structured controls visibly move to match the plain-English instruction.
        const prevTone = ms.tone || { formality: 50, detail: 40, warmth: 50, confidence: 30 };
        const tone = {
            formality: typeof attributes.formality === 'number' ? attributes.formality : prevTone.formality,
            detail: typeof attributes.detail === 'number' ? attributes.detail : prevTone.detail,
            warmth: typeof attributes.warmth === 'number' ? attributes.warmth : prevTone.warmth,
            confidence: typeof attributes.confidence === 'number' ? attributes.confidence : prevTone.confidence,
        };

        existing.manual_settings = {
            tone,
            habits: Array.isArray(ms.habits) ? ms.habits : [],
            customInstructions: ms.customInstructions || '',
            directives: trimmed,
            // Persisted emoji policy — buildManualPromptFragment hard-bans emojis when false.
            allowEmoji: typeof attributes.allowEmoji === 'boolean' ? attributes.allowEmoji : ms.allowEmoji,
            activeProfile: ms.activeProfile || 'work',
        };
        existing.prompt_fragment = voiceProfileService.buildManualPromptFragment(existing.manual_settings, existing);
        existing.status = existing.status === 'default' ? 'manual' : existing.status;
        existing.updated_at = now;

        await voiceProfileService.saveVoiceProfile(userId, existing);
        return Response.json({ success: true, directives: trimmed, added: rules, attributes, profile: existing });
    } catch (error) {
    logEvent({ channel: "failures", event: "❌ API Error", description: String(error) });
        console.error('Error refining voice profile:', error);
        return Response.json({ error: 'Internal Server Error', details: error.message }, { status: 500 });
    }
}

/**
 * DELETE — remove a single voice directive by id.
 */
export async function DELETE(request) {
    try {
        const session = await auth();
        if (!session?.user?.email) {
            return Response.json({ error: 'Unauthorized' }, { status: 401 });
        }
        const userId = session.user.email;
        const { directiveId } = await request.json();
        if (!directiveId) return Response.json({ error: 'directiveId is required' }, { status: 400 });

        const existing = await voiceProfileService.getVoiceProfile(userId);
        if (!existing?.manual_settings) return Response.json({ success: true, directives: [] });
        const ms = existing.manual_settings;
        ms.directives = (Array.isArray(ms.directives) ? ms.directives : []).filter((d) => d?.id !== directiveId);
        existing.manual_settings = ms;
        existing.prompt_fragment = voiceProfileService.buildManualPromptFragment(ms, existing);
        existing.updated_at = new Date().toISOString();

        await voiceProfileService.saveVoiceProfile(userId, existing);
        return Response.json({ success: true, directives: ms.directives });
    } catch (error) {
    logEvent({ channel: "failures", event: "❌ API Error", description: String(error) });
        console.error('Error deleting voice directive:', error);
        return Response.json({ error: 'Internal Server Error', details: error.message }, { status: 500 });
    }
}
