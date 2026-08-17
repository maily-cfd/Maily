/**
 * The Mission Compiler (super-agent Part 1.1).
 *
 * Turns a user's plain-English agent description ("keep my inbox at zero and
 * never miss a VC follow-up") into a structured, persistent Mission with
 * MEASURABLE success criteria. Compiled ONCE at agent creation, stored on
 * boult_agents.mission, and read by every run — so the agent is accountable to
 * outcomes, not to a fixed list of steps.
 *
 * Robust on free models: a compile failure falls back to a minimal-but-valid
 * mission derived from the objective, so creation never breaks.
 */
import { callLLM, getText } from '../engine';

export interface Mission {
  objective: string;            // the natural-language goal, cleaned up
  successCriteria: string[];    // 3-6 concrete, checkable outcomes
  standingConstraints: string[]; // hard rules ("never email before 9am")
}

/** Minimal valid mission from raw text — the always-safe fallback. */
export function fallbackMission(objective: string): Mission {
  const o = (objective || '').trim();
  return {
    objective: o,
    successCriteria: o ? [`The stated goal is genuinely advanced: ${o.slice(0, 160)}`] : ['Advance the stated goal'],
    standingConstraints: [],
  };
}

/**
 * Compile a mission. `context` may include the user model + standing
 * instructions so constraints are captured up front.
 */
export async function compileMission(
  objective: string,
  context: { userModel?: string; instructions?: string; agentName?: string } = {},
): Promise<Mission> {
  const o = (objective || '').trim();
  if (!o) return fallbackMission(o);

  try {
    const res = await callLLM(
      [
        {
          role: 'system',
          content:
            'You compile a background AI agent\'s plain-English mission into a structured objective for a senior executive assistant. ' +
            'Return ONLY valid JSON, no prose, exactly: ' +
            '{ "objective": string, "successCriteria": string[], "standingConstraints": string[] }. ' +
            'objective: the goal restated crisply in second person ("Keep the inbox triaged and..."). ' +
            'successCriteria: 3-6 CONCRETE, checkable outcomes that mean the mission was actually done this run ' +
            '(e.g. "Every email from the last 24h is triaged", "Meeting requests get a reply proposing real open times", ' +
            '"No VC thread goes >2 days without a response"). Outcomes, not steps. ' +
            'standingConstraints: hard rules drawn from the user context (e.g. "Never propose meetings before 10am", ' +
            '"Always draft, never auto-send to new contacts"). [] if none. ' +
            'Be specific to THIS mission. Do not invent constraints the user did not imply.',
        },
        {
          role: 'user',
          content:
            (context.agentName ? `Agent name: ${context.agentName}\n` : '') +
            `Mission: ${o}\n` +
            (context.userModel ? `\nUser context:\n${context.userModel.slice(0, 800)}\n` : '') +
            (context.instructions ? `\nStanding instructions:\n${context.instructions.slice(0, 600)}\n` : '') +
            '\nCompile the mission as JSON.',
        },
      ],
      [],
      { maxTokens: 500, temperature: 0.2 },
    );
    const raw = getText(res.content).trim();
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) return fallbackMission(o);
    const parsed = JSON.parse(match[0]);
    const objectiveOut = typeof parsed.objective === 'string' && parsed.objective.trim() ? parsed.objective.trim() : o;
    const criteria = Array.isArray(parsed.successCriteria)
      ? parsed.successCriteria.filter((s: any) => typeof s === 'string' && s.trim()).map((s: string) => s.trim()).slice(0, 6)
      : [];
    const constraints = Array.isArray(parsed.standingConstraints)
      ? parsed.standingConstraints.filter((s: any) => typeof s === 'string' && s.trim()).map((s: string) => s.trim()).slice(0, 8)
      : [];
    if (!criteria.length) return { ...fallbackMission(o), objective: objectiveOut };
    return { objective: objectiveOut, successCriteria: criteria, standingConstraints: constraints };
  } catch {
    return fallbackMission(o);
  }
}

/** Render a mission as the accountability block injected into every run. */
export function renderMission(mission: Mission | null | undefined): string {
  if (!mission || !mission.objective) return '';
  const L: string[] = [`MISSION (you are accountable to the outcome, not a fixed list of steps):`, mission.objective];
  if (mission.successCriteria?.length) {
    L.push('', 'This run is only a success if these are genuinely true by the end:');
    for (const c of mission.successCriteria) L.push(`- ${c}`);
  }
  if (mission.standingConstraints?.length) {
    L.push('', 'Standing constraints — never violate:');
    for (const c of mission.standingConstraints) L.push(`- ${c}`);
  }
  return L.join('\n');
}
