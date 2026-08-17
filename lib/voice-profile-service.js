import { getSupabaseAdmin } from './supabase.js';
import { VoiceProfiler } from './voice-profiler.js';
import { DEFAULT_AI_MODELS } from './ai-constants.js';

// Voice profile analysis model - using the centralized model for consistency
const VOICE_ANALYSIS_MODEL = DEFAULT_AI_MODELS[0];
const VOICE_PROFILE_API_KEY = process.env.OPENROUTER_API_KEY3;

export class VoiceProfileService {
    constructor() {
        this.baseURL = 'https://openrouter.ai/api/v1';
        this.apiKey = (VOICE_PROFILE_API_KEY || process.env.OPENROUTER_API_KEY || '').trim();
    }

    get supabase() {
        return getSupabaseAdmin();
    }

    /**
     * Fetch user's sent emails for voice analysis
     * @param {Object} gmailService - Initialized Gmail service
     * @param {number} maxEmails - Maximum number of emails to fetch (default: 30)
     * @returns {Promise<Array>} Array of sent email objects
     */
    async fetchSentEmails(gmailService, maxEmails = 30, withinDays = null) {
        try {
            console.log('📧 Fetching sent emails for voice analysis...');

            // Query for sent emails, optionally constrained to a recent window
            // (e.g. the last 90 days) so the voice reflects how the user writes NOW.
            const query = withinDays ? `in:sent newer_than:${withinDays}d` : 'in:sent';
            const sentEmailsResponse = await gmailService.getEmails(
                maxEmails,
                query,
                null
            );

            if (!sentEmailsResponse?.messages || sentEmailsResponse.messages.length === 0) {
                console.log('⚠️ No sent emails found for voice analysis');
                return [];
            }

            // Fetch full details in PARALLEL — each email is its own Gmail
            // round-trip, so a sequential loop is the main latency cost. Mapping
            // with Promise.all overlaps the network waits (the service's own
            // rate-limiter still spaces the requests).
            const emailsToFetch = sentEmailsResponse.messages.slice(0, maxEmails);

            const settled = await Promise.allSettled(
                emailsToFetch.map(async (message) => {
                    const details = await gmailService.getEmailDetails(message.id);
                    const parsed = gmailService.parseEmailData(details);
                    const cleanBody = (parsed.body || '')
                        .replace(/<[^>]*>?/gm, '')
                        .replace(/\s+/g, ' ')
                        .trim();
                    if (cleanBody.length <= 30) return null; // too short to be useful
                    return {
                        id: message.id,
                        subject: parsed.subject,
                        to: parsed.to,
                        body: cleanBody.substring(0, 2000), // truncate for efficiency
                        date: parsed.date,
                        snippet: parsed.snippet,
                    };
                }),
            );

            const emailDetails = settled
                .filter((r) => r.status === 'fulfilled' && r.value)
                .map((r) => r.value);

            console.log(`✅ Fetched ${emailDetails.length} sent emails for analysis`);
            return emailDetails;
        } catch (error) {
            console.error('❌ Error fetching sent emails:', error);
            throw error;
        }
    }

    /**
     * Analyze user's writing style using high-speed signal extraction + optional fuzzy LLM vibe
     * @param {Array} sentEmails - Array of sent email objects
     * @returns {Promise<Object>} Voice profile analysis
     */
    async analyzeVoiceProfile(sentEmails) {
        if (!sentEmails || sentEmails.length === 0) {
            console.log('⚠️ No emails to analyze for voice profile');
            return this.getDefaultVoiceProfile();
        }

        try {
            console.log('🔍 Extracting writing signals from', sentEmails.length, 'emails...');
            
            // 1. HARD SIGNAL EXTRACTION (Fast, Local)
            const bodies = sentEmails.map(e => e.body);
            const signals = VoiceProfiler.extractSignals(bodies);

            // 2. FUZZY VIBE ANALYSIS (Optional LLM call for Slang/Tone)
            let fuzzyVibe = { tone: 'professional', slang: 'none', personality: 'balanced' };
            try {
                console.log('🧠 Performing linguistic DNA extraction via LLM...');
                const emailSamples = sentEmails.slice(0, 15).map((email, index) => {
                    return `--- Sample ${index + 1} ---
Subject: ${email.subject}
Content: ${email.body.substring(0, 600)}
---`;
                }).join('\n\n');

                const messages = [
                    {
                        role: 'system',
                        content: `You are a forensic writing style analyst. Your job is to describe the "linguistic DNA" of this person's emails — not the CONTENT, but the STYLE.

Analyze: sentence length patterns, level of formality, use of contractions, emoji habits, greeting/sign-off patterns, punctuation quirks, vocabulary level, and structural tendencies.

Respond ONLY with a compact JSON object containing both a general analysis and a specific mapping to UI sliders (0-100) and habits:
{
  "tone": "casual/professional/formal/friendly/terse",
  "personality": "direct/warm/analytical/enthusiastic/reserved",
  "manual_settings": {
    "tone": {
      "formality": 50, // 0=Casual, 100=Formal
      "detail": 40,    // 0=Brief, 100=Detailed
      "warmth": 50,    // 0=Warm, 100=Direct
      "confidence": 30 // 0=Reserved, 100=Confident
    },
    "habits": ["Uses 'thanks' not 'thank you'", "Short subject lines", "Oxford commas"],
    "customInstructions": "A one-sentence summary of their core communication quirk."
  }
}

Do NOT describe email content. Describe ONLY how they write. Output valid JSON.`
                    },
                    {
                        role: 'user',
                        content: `Extract the linguistic DNA from these email samples:\n\n${emailSamples}`
                    }
                ];

                // Increased maxTokens to accommodate the larger JSON structure
                const response = await this.callOpenRouter(messages, { maxTokens: 400, temperature: 0.1 });
                if (response?.choices?.[0]?.message?.content) {
                    const content = response.choices[0].message.content.trim();
                    const parsed = JSON.parse(content.replace(/```json|```/g, '').replace(/<think(ing)?>[\s\S]*?<\/think(ing)?>/gi, '').trim());
                    fuzzyVibe = {
                        tone: parsed.tone || 'professional',
                        slang: parsed.slang || 'none',
                        personality: parsed.personality || 'balanced',
                        manual_settings: parsed.manual_settings || null
                    };
                }
            } catch (llmError) {
                console.warn('⚠️ Fuzzy LLM analysis failed, using signals only:', llmError.message);
            }

            // 3. MERGE INTO FINAL PROFILE
            const voiceProfile = {
                tone: {
                    primary: fuzzyVibe.tone,
                    warmth_level: signals.vibe.exclamatory ? 8 : 5,
                    description: fuzzyVibe.personality
                },
                greeting_patterns: {
                    preferred_greetings: signals.patterns.greetings,
                    uses_recipient_name: signals.patterns.greetings.some(g => g.includes(' ')),
                    greeting_warmth: signals.vibe.exclamatory ? 'warm' : 'neutral'
                },
                closing_patterns: {
                    preferred_closings: signals.patterns.signOffs,
                    signature_style: signals.replyLength === 'detailed' ? 'detailed' : 'minimal'
                },
                language_patterns: {
                    sentence_length: signals.avgSentenceLength > 15 ? 'long' : 'short',
                    avg_length: signals.avgSentenceLength,
                    uses_contractions: true,
                    uses_exclamations: signals.vibe.exclamatory,
                    uses_emojis: signals.emojis.frequency > 0.1,
                    top_emojis: signals.emojis.top,
                    common_phrases: signals.fillers,
                    style_flags: signals.vibe
                },
                structural_patterns: {
                    typical_email_length: signals.replyLength,
                    structure_preference: fuzzyVibe.personality.includes('direct') ? 'direct' : 'contextual'
                },
                personality_traits: {
                    enthusiastic: signals.vibe.exclamatory,
                    detail_oriented: signals.replyLength === 'detailed'
                },
                manual_settings: fuzzyVibe.manual_settings || {
                    tone: { formality: 50, detail: 40, warmth: 50, confidence: 30 },
                    habits: signals.patterns.greetings.length > 0 ? [`Uses "${signals.patterns.greetings[0]}"`] : [],
                    customInstructions: '',
                    activeProfile: 'work'
                },
                learning: {
                    autoImprove: true,
                    lastAnalysis: new Date().toISOString()
                },
                prompt_fragment: VoiceProfiler.generatePromptFragment(signals, fuzzyVibe),
                analyzed_at: new Date().toISOString(),
                email_count: sentEmails.length,
                status: 'complete'
            };

            console.log('✅ Lightweight voice profile created');
            return voiceProfile;
        } catch (error) {
            console.error('❌ Error analyzing voice profile:', error);
            return this.getDefaultVoiceProfile();
        }
    }

    /**
     * Get default voice profile when analysis is not possible
     */
    getDefaultVoiceProfile() {
        return {
            tone: {
                primary: 'professional',
                warmth_level: 6,
                assertiveness: 5,
                description: 'Professional and balanced tone'
            },
            greeting_patterns: {
                preferred_greetings: ['Hi', 'Hello'],
                uses_recipient_name: true,
                greeting_warmth: 'warm'
            },
            closing_patterns: {
                preferred_closings: ['Best regards', 'Best'],
                includes_name: true,
                includes_title: false,
                signature_style: 'standard'
            },
            language_patterns: {
                sentence_length: 'medium',
                vocabulary_complexity: 'moderate',
                uses_contractions: true,
                uses_exclamations: false,
                uses_emojis: false,
                common_phrases: [],
                transition_words: ['however', 'also', 'additionally']
            },
            structural_patterns: {
                paragraph_length: 'medium',
                uses_bullet_points: false,
                typical_email_length: 'moderate',
                structure_preference: 'direct'
            },
            personality_traits: {
                enthusiastic: false,
                detail_oriented: true,
                action_focused: true,
                relationship_building: true,
                empathetic: true
            },
            sample_phrases: [],
            analyzed_at: null,
            email_count: 0,
            status: 'default'
        };
    }

    /**
     * Save voice profile to database
     * @param {string} userId - User's email/ID
     * @param {Object} voiceProfile - Voice profile data
     */
    async saveVoiceProfile(userId, voiceProfile) {
        try {
            const normalizedUserId = userId.toLowerCase().trim();

            const { error } = await this.supabase
                .from('user_voice_profiles')
                .upsert({
                    user_id: normalizedUserId,
                    voice_profile: voiceProfile,
                    updated_at: new Date().toISOString()
                }, {
                    onConflict: 'user_id'
                });

            if (error) {
                console.error('❌ Error saving voice profile:', error);
                throw error;
            }

            console.log('✅ Voice profile saved for user:', normalizedUserId);
            return true;
        } catch (error) {
            console.error('❌ Failed to save voice profile:', error);
            throw error;
        }
    }

    /**
     * Incrementally update voice profile with a new email body
     * @param {string} userId - User ID
     * @param {string} emailBody - Body of newly sent email
     */
    async addToProfile(userId, emailBody) {
        try {
            const profile = await this.getVoiceProfile(userId);
            if (!profile) return;

            console.log('📈 Updating voice profile incrementally...');
            const newSignals = VoiceProfiler.extractSignals([emailBody]);
            
            // Moderate blend (EMA - Exponential Moving Average style)
            if (profile.language_patterns?.avg_length) {
                profile.language_patterns.avg_length = Math.round((profile.language_patterns.avg_length * 0.8) + (newSignals.avgSentenceLength * 0.2));
            }
            
            // Add unique emojis to the top list
            if (newSignals.emojis.top.length > 0) {
                const currentEmojis = profile.language_patterns?.top_emojis || [];
                profile.language_patterns.top_emojis = [...new Set([...newSignals.emojis.top, ...currentEmojis])].slice(0, 10);
            }

            profile.email_count = (profile.email_count || 0) + 1;
            profile.analyzed_at = new Date().toISOString();
            
            // Re-generate the prompt fragment to include new learnings
            const fuzzyVibe = { 
                tone: profile.tone?.primary || 'professional', 
                slang: profile.language_patterns?.common_phrases?.[0] || 'none',
                personality: profile.tone?.description || 'balanced'
            };
            profile.prompt_fragment = VoiceProfiler.generatePromptFragment(newSignals, fuzzyVibe);

            await this.saveVoiceProfile(userId, profile);
        } catch (e) {
            console.warn('⚠️ Incremental update failed:', e.message);
        }
    }

    /**
     * Get voice profile from database
     * @param {string} userId - User's email/ID
     * @returns {Promise<Object|null>} Voice profile or null
     */
    async getVoiceProfile(userId) {
        try {
            const normalizedUserId = userId.toLowerCase().trim();

            const { data, error } = await this.supabase
                .from('user_voice_profiles')
                .select('voice_profile, updated_at')
                .eq('user_id', normalizedUserId)
                .single();

            if (error) {
                if (error.code === 'PGRST116') {
                    // No profile found
                    return null;
                }
                console.error('❌ Error fetching voice profile:', error);
                return null;
            }

            return data?.voice_profile || null;
        } catch (error) {
            console.error('❌ Failed to get voice profile:', error);
            return null;
        }
    }

    /**
     * Check if voice profile needs refresh
     * @param {string} userId - User's email/ID
     * @param {number} maxAgeDays - Maximum age in days before refresh (default: 7)
     */
    async needsRefresh(userId, maxAgeDays = 7) {
        try {
            const normalizedUserId = userId.toLowerCase().trim();

            const { data, error } = await this.supabase
                .from('user_voice_profiles')
                .select('updated_at')
                .eq('user_id', normalizedUserId)
                .single();

            if (error || !data) {
                return true; // Needs refresh if not found
            }

            const updatedAt = new Date(data.updated_at);
            const maxAgeMs = maxAgeDays * 24 * 60 * 60 * 1000;
            const needsUpdate = (Date.now() - updatedAt.getTime()) > maxAgeMs;

            return needsUpdate;
        } catch (error) {
            return true;
        }
    }

    /**
     * Generate voice-cloned prompt instructions based on profile
     * @param {Object} voiceProfile - User's voice profile
     * @returns {string} Prompt instructions for voice cloning
     */
    generateVoicePrompt(voiceProfile) {
        if (!voiceProfile || voiceProfile.status === 'default') {
            return '';
        }

        // 1. Use high-fidelity prompt fragment if available
        if (voiceProfile.prompt_fragment) {
            return `
**VOICE CLONING INSTRUCTIONS - CRITICAL**
You MUST write in the user's exact voice and style. Follow these patterns precisely:
${voiceProfile.prompt_fragment}

CRITICAL: The email MUST sound like the user wrote it themselves. Match their exact cadence.
            `.trim();
        }

        // 2. Fallback to legacy structure mapping
        const { tone, greeting_patterns, closing_patterns, language_patterns, structural_patterns, personality_traits, sample_phrases } = voiceProfile;

        let prompt = `
**VOICE CLONING INSTRUCTIONS - CRITICAL**
You MUST write in the user's exact voice and style. Follow these patterns precisely:

**TONE**:
- Primary style: ${tone?.primary || 'professional'}
- Warmth level: ${tone?.warmth_level || 6}/10
- Assertiveness: ${tone?.assertiveness || 5}/10
${tone?.description ? `- Description: ${tone.description}` : ''}

**GREETINGS**:
- Use these greetings: ${greeting_patterns?.preferred_greetings?.join(', ') || 'Hi, Hello'}
- ${greeting_patterns?.uses_recipient_name ? 'Include recipient\'s first name' : 'Greeting only, no name'}
- Warmth style: ${greeting_patterns?.greeting_warmth || 'warm'}

**CLOSINGS**:
- Use these sign-offs: ${closing_patterns?.preferred_closings?.join(', ') || 'Best regards'}
- ${closing_patterns?.includes_name ? 'Include user\'s name' : 'Sign-off only'}
- Signature style: ${closing_patterns?.signature_style || 'standard'}

**LANGUAGE STYLE**:
- Sentence length: ${language_patterns?.sentence_length || 'medium'}
- Vocabulary: ${language_patterns?.vocabulary_complexity || 'moderate'}
- ${language_patterns?.uses_contractions ? 'Use contractions (don\'t, can\'t, I\'m)' : 'Avoid contractions'}
- ${language_patterns?.uses_exclamations ? 'Can use exclamation marks for emphasis' : 'Avoid exclamation marks'}
- ${language_patterns?.uses_emojis ? 'Can include appropriate emojis' : 'No emojis'}
${language_patterns?.common_phrases?.length > 0 ? `- Incorporate these phrases naturally: ${language_patterns.common_phrases.join(', ')}` : ''}

**STRUCTURE**:
- Email length: ${structural_patterns?.typical_email_length || 'moderate'}
- Paragraph style: ${structural_patterns?.paragraph_length || 'medium'}
- Approach: ${structural_patterns?.structure_preference || 'direct'}
${structural_patterns?.uses_bullet_points ? '- Can use bullet points for lists' : '- Avoid bullet points, use prose'}

**PERSONALITY**:
${personality_traits?.enthusiastic ? '- Show genuine enthusiasm and positivity' : '- Maintain composed, measured tone'}
${personality_traits?.detail_oriented ? '- Include relevant details and specifics' : '- Keep it high-level'}
${personality_traits?.action_focused ? '- Include clear next steps or action items' : ''}
${personality_traits?.relationship_building ? '- Build rapport with personal touches' : ''}
${personality_traits?.empathetic ? '- Show understanding and empathy when appropriate' : ''}

${sample_phrases?.length > 0 ? `**CHARACTERISTIC PHRASES TO USE**:
${sample_phrases.map(p => `"${p}"`).join(', ')}` : ''}

CRITICAL: The email MUST sound like the user wrote it themselves. Match their exact patterns.
`;

        return prompt;
    }

    /**
     * Call OpenRouter API
     */
    async callOpenRouter(messages, options = {}) {
        if (!this.apiKey) {
            throw new Error('OpenRouter API key not configured');
        }

        console.log('🔄 Calling OpenRouter for voice analysis...');

        const response = await fetch(`${this.baseURL}/chat/completions`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${this.apiKey}`,
                'HTTP-Referer': process.env.HOST || 'https://maily.cfd',
                'X-Title': 'Maily Voice Profile'
            },
            body: JSON.stringify({
                model: VOICE_ANALYSIS_MODEL,
                messages,
                temperature: options.temperature || 0.3,
                max_tokens: options.maxTokens || 2000
            })
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.error('❌ OpenRouter API error:', response.status, errorText);
            throw new Error(`OpenRouter API error: ${response.status}`);
        }

        return await response.json();
    }

    /**
     * Build a prompt fragment from manual settings (Method 1: sliders + habits + instructions)
     * @param {Object} manualSettings - The user's manual voice profile settings
     * @param {Object} existingProfile - The full existing profile (for merging with analyzed data)
     * @returns {string} Prompt fragment string
     */
    buildManualPromptFragment(manualSettings, existingProfile = {}) {
        const tone = manualSettings?.tone || {};
        const habits = manualSettings?.habits || [];
        const customInstructions = manualSettings?.customInstructions || '';

        // Map slider values (0-100) to IMPERATIVE directives — not passive labels.
        // A label like "detailed and thorough" gets ignored when the topic feels
        // simple; a direct instruction with an explicit length floor does not.
        const f = tone.formality ?? 50;
        const d = tone.detail ?? 40;
        const w = tone.warmth ?? 50;
        const c = tone.confidence ?? 30;

        const formalityDirective = f > 70
            ? 'FORMAL — proper salutation, no slang, avoid contractions, polished and professional throughout.'
            : f > 40
            ? 'SEMI-FORMAL — professional but approachable; contractions are fine.'
            : 'CASUAL — relaxed and conversational; use contractions and everyday phrasing, no stiffness.';

        // The detail slider drives LENGTH. This is the rule users most often feel
        // is ignored, so high detail carries an explicit minimum + what to include.
        const detailDirective = d > 70
            ? 'DETAILED AND THOROUGH — this overrides any instinct to be brief. Do NOT send a one- or two-line reply. Write at least 4–6 full sentences across 2–3 short paragraphs: acknowledge the message, give the relevant context and your reasoning, address the specifics, and close with a clear next step or forward-looking line. Elaborate like someone who takes the time to write a complete, considered reply. A terse answer is WRONG here even when the topic looks simple.'
            : d > 40
            ? 'BALANCED length — cover the point plus a sentence or two of useful context. Not a bare one-liner, but no padding.'
            : 'BRIEF — one or two short sentences, straight to the point, no elaboration.';

        const warmthDirective = w > 70
            ? 'DIRECT and matter-of-fact — lead with the point, minimal pleasantries.'
            : w > 40
            ? 'BALANCED warmth — friendly but efficient.'
            : 'WARM and friendly — open with genuine warmth; personable, considerate phrasing.';

        const confidenceDirective = c > 70
            ? 'CONFIDENT and assertive — state things plainly, own the decision, no hedging ("I think maybe", "if that\'s okay").'
            : c > 40
            ? 'BALANCED — assured but not pushy.'
            : 'RESERVED and measured — softer, considerate, lightly tentative phrasing.';

        let fragment = `User Voice Profile — these are the user's EXPLICIT tone settings. Apply EVERY one of them to the reply, even when the topic feels like it only needs a quick answer. They override your default brevity:
- Formality (${f}/100): ${formalityDirective}
- Detail / length (${d}/100): ${detailDirective}
- Warmth↔Directness (${w}/100): ${warmthDirective}
- Confidence (${c}/100): ${confidenceDirective}`;

        if (habits.length > 0) {
            fragment += `\n- Writing habits: ${habits.join(', ')}`;
        }

        // Structured directives — the user's own-words corrections ("never use
        // emojis", "less robotic"). Rendered as a numbered, highest-priority block.
        const directives = Array.isArray(manualSettings?.directives) ? manualSettings.directives : [];
        const directiveLines = directives
            .map((d) => (typeof d === 'string' ? d : d?.text))
            .map((s) => (s || '').trim())
            .filter(Boolean);
        // Back-compat: a legacy single customInstructions blob counts as one directive.
        if (!directiveLines.length && customInstructions.trim()) directiveLines.push(customInstructions.trim());

        if (directiveLines.length) {
            fragment += `\n\n[CRITICAL DIRECTIVES — the user stated these in their own words about how they write. Follow EVERY one strictly; they are the absolute highest-priority rules, no exceptions]:\n${directiveLines.map((t, i) => `${i + 1}. ${t}`).join('\n')}`;
        }

        // Explicit emoji policy. When the user has said "no emojis", make it an
        // absolute, highest-priority rule (the draft path also strips emojis as a
        // final guarantee — see stripEmojisIfBanned) so one can never slip in.
        if (manualSettings?.allowEmoji === false) {
            fragment += `\n\n[ABSOLUTE RULE]: Never use emojis or emoticons anywhere in the reply. Not one.`;
        }

        // Merge with existing analyzed patterns if available
        if (existingProfile?.greeting_patterns?.preferred_greetings?.length > 0) {
            fragment += `\n- Greeting patterns: ${existingProfile.greeting_patterns.preferred_greetings.join(' or ')}`;
        }
        if (existingProfile?.closing_patterns?.preferred_closings?.length > 0) {
            fragment += `\n- Sign-off patterns: ${existingProfile.closing_patterns.preferred_closings.join(' or ')}`;
        }
        if (existingProfile?.language_patterns?.top_emojis?.length > 0) {
            fragment += `\n- Emoji usage: ${existingProfile.language_patterns.top_emojis.join(' ')}`;
        }

        return fragment.trim();
    }

    /**
     * Generate a live preview reply based on manual settings (for the modal's LIVE PREVIEW)
     * @param {Object} manualSettings - The user's manual voice profile settings
     * @param {string} sampleEmail - The sample email prompt to reply to
     * @returns {Promise<string>} Preview reply text
     */
    async generatePreviewReply(manualSettings, sampleEmail) {
        const promptFragment = this.buildManualPromptFragment(manualSettings);

        // The preview length must TRACK the detail slider — otherwise adjusting
        // "Brief↔Detailed" appears to do nothing in the live preview.
        const detail = manualSettings?.tone?.detail ?? 40;
        const lengthGuide = detail > 70
            ? 'Write a COMPLETE reply (4–6 sentences across 2–3 short paragraphs) that fully demonstrates the detailed style.'
            : detail > 40
            ? 'Write a balanced reply (2–3 sentences).'
            : 'Write a brief reply (1–2 sentences).';
        const maxTokens = detail > 70 ? 320 : detail > 40 ? 160 : 90;

        const messages = [
            {
                role: 'system',
                content: `You are generating a sample email reply to demonstrate a user's writing style.
${promptFragment}

${lengthGuide} Match the voice profile EXACTLY — especially the detail/length setting.
Do NOT add subject lines, greetings, or sign-offs unless the habits specifically mention them.
Output ONLY the reply text, nothing else.`
            },
            {
                role: 'user',
                content: `Sample email to reply to: "${sampleEmail}"\n\nWrite the reply now.`
            }
        ];

        try {
            const response = await this.callOpenRouter(messages, { maxTokens, temperature: 0.4 });
            const content = response?.choices?.[0]?.message?.content?.trim();
            if (content) {
                // Strip any thinking tags or tool tags
                return content
                    .replace(/<think(ing)?>[\\s\\S]*?<\/think(ing)?>/gi, '')
                    .replace(/<\/?[a-z_]+_call>/gi, '')
                    .replace(/<\/?[a-z_]+_value>/gi, '')
                    .replace(/<email>|<\/email>/gi, '')
                    .trim();
            }
        } catch (e) {
            console.warn('Preview generation failed:', e.message);
        }

        // Fallback based on settings
        const tone = manualSettings?.tone || {};
        if (tone.formality > 60) {
            return 'Friday is suitable. I will update the calendar invitation accordingly.';
        }
        return 'Friday works for me! I\'ll move it on the calendar.';
    }

    /**
     * Learn from user edits to AI drafts (Method 3: Continuous Learning)
     * Compare the original AI draft with the user's final version and extract corrections.
     * @param {string} userId - User's email/ID
     * @param {string} aiDraft - The original AI-generated draft
     * @param {string} userFinal - The version the user actually sent
     */
    async learnFromDiff(userId, aiDraft, userFinal) {
        try {
            if (!aiDraft || !userFinal) return;
            if (!userId) return;

            // Skip if the user didn't change anything meaningful
            const cleanAI = aiDraft.replace(/<[^>]*>?/gm, '').trim().toLowerCase();
            const cleanUser = userFinal.replace(/<[^>]*>?/gm, '').trim().toLowerCase();
            
            if (cleanAI === cleanUser) {
                console.log('📝 Voice learning: No edits detected, skipping.');
                return;
            }

            // Calculate edit distance ratio - only learn from meaningful edits
            const similarity = this.calculateSimilarity(cleanAI, cleanUser);
            if (similarity > 0.95) {
                console.log('📝 Voice learning: Minor edits only, skipping.');
                return;
            }

            console.log(`📝 Voice learning: ${Math.round((1 - similarity) * 100)}% changed — extracting corrections...`);

            const profile = await this.getVoiceProfile(userId);
            if (!profile) return;

            // Collect learnings
            const learnings = profile.learned_corrections || [];
            learnings.push({
                timestamp: new Date().toISOString(),
                editDistance: Math.round((1 - similarity) * 100),
                aiSnippet: cleanAI.substring(0, 200),
                userSnippet: cleanUser.substring(0, 200),
            });

            // Keep only the last 50 corrections
            profile.learned_corrections = learnings.slice(-50);
            profile.learning_count = (profile.learning_count || 0) + 1;

            // Update patterns based on the user's sent text (use existing addToProfile logic)
            const { VoiceProfiler } = await import('./voice-profiler.js');
            const newSignals = VoiceProfiler.extractSignals([cleanUser]);

            // EMA blend patterns
            if (newSignals && profile.language_patterns?.avg_length) {
                profile.language_patterns.avg_length = Math.round(
                    (profile.language_patterns.avg_length * 0.85) + (newSignals.avgSentenceLength * 0.15)
                );
            }

            // Rebuild prompt fragment
            if (profile.manual_settings) {
                profile.prompt_fragment = this.buildManualPromptFragment(profile.manual_settings, profile);
            }

            profile.updated_at = new Date().toISOString();
            await this.saveVoiceProfile(userId, profile);
            console.log(`✅ Voice learning: Profile updated (${profile.learning_count} total corrections)`);
        } catch (e) {
            console.warn('⚠️ Voice learning failed (non-fatal):', e.message);
        }
    }

    /**
     * Simple similarity ratio between two strings
     */
    calculateSimilarity(a, b) {
        if (!a || !b) return 0;
        const maxLen = Math.max(a.length, b.length);
        if (maxLen === 0) return 1;
        
        // Use character-level comparison for speed
        let matches = 0;
        const minLen = Math.min(a.length, b.length);
        for (let i = 0; i < minLen; i++) {
            if (a[i] === b[i]) matches++;
        }
        return matches / maxLen;
    }
}

// Final-guarantee emoji strip for drafts when the user's voice bans emojis. Backs
// the prompt-level [ABSOLUTE RULE] so an emoji can never slip into a reply.
const EMOJI_RE = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE00}-\u{FE0F}\u{1F1E6}-\u{1F1FF}\u{200D}\u{2764}]/gu;
export function stripEmojisIfBanned(text, voiceProfile) {
  if (!text || voiceProfile?.manual_settings?.allowEmoji !== false) return text;
  return String(text).replace(EMOJI_RE, '').replace(/[ \t]{2,}/g, ' ').replace(/ +\n/g, '\n').trim();
}

// Export singleton instance
export const voiceProfileService = new VoiceProfileService();

