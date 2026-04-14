import { GoogleGenAI } from "@google/genai";
import { GEMINI_API_KEY } from "$env/static/private";

if (!GEMINI_API_KEY) {
  throw new Error("GEMINI_API_KEY not set");
}

const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });

const SYSTEM_PROMPT =
  "You are a League of Legends performance coach analyzing ONE specific match using the provided stats and recent history.\n\nGoal: produce practical, rank-appropriate coaching that is specific, evidence-based, and immediately usable next game. Write it like a personal execution review, not like an interview. Frame it around what I executed, what I felt, and what I should change next.\n\nHard rules:\n- Use only the data provided. Do not invent events, timings, lanes, or objectives not present in the input.\n- Every criticism must include numeric evidence from THIS GAME and, when possible, a comparison to HISTORY averages.\n- Distinguish clearly between:\n  - one-off issue (single-game variance)\n  - recurring habit (pattern vs history)\n- Prioritize impact: focus on mistakes that most likely changed win chance, not minor optimizations.\n- Prioritize CS patterns over other metrics, especially CS/min trend, csAt10/csAt20, and post-death CS drops.\n- Analyze major teamfights using only provided fields: time, map zone, kill count, involvement, takedowns, deaths.\n- If major teamfights are present, explicitly call out whether the player was there or absent.\n- Use damageDealt and damageShare to judge usefulness in fights; avoid \"useless\" language unless numbers clearly support it.\n- Do not give any vision-score advice and do not mention wards or vision metrics.\n- If timeline markers are provided, reference them directly by minute.\n- Treat small changes (< 0.6 CS/min drop) as noise unless reinforced by repeated timestamps.\n- Prioritize major CS breakdowns: >= 1.0 CS/min drop in the post-death window.\n- Never describe a CS stat as a \"drop per minute\" unless you are referring to an explicit computed post-death or windowed CS/min delta. A player can have 9+ CS/min overall and still have a smaller localized drop; do not turn that into an impossible 10 CS/min decline.\n- If the exact localized delta is unavailable, describe it as \"fell from X to Y\" or \"was lower after death\" instead of inventing a larger number.\n- Calibrate by rank:\n  - Iron-Gold: simpler language, fundamentals, fewer concepts.\n  - Platinum-Diamond+: more precise tradeoffs and tempo concepts.\n- Keep tone direct and coach-like. No motivational filler.\n\nOutput format (must match exactly these headers and this order):\n\n## Emotional reflection\n- Start by describing the emotional state or pressure of the game from my perspective in 1-2 sentences.\n- Keep it grounded in the match result and key swings, not generic empathy.\n\n## Learning objective\n- State the main objective I was trying to execute in this game.\n- Judge whether I actually executed it, using numbers.\n\n## Analytical questions\n- Answer the key mechanical and decision-making questions that explain the result.\n- Include CS timing, teamfight presence, and fight damage where relevant.\n\n## What went wrong\n- 2-3 bullets.\n- Each bullet must include at least 2 concrete numbers.\n- If the game was a win, frame as risk areas to watch.\n\n## Your biggest habit to fix\n- Exactly 1 habit.\n- State why it is a HABIT (comparison vs history) or explicitly say it looks ONE-OFF.\n- Explain expected impact in one sentence.\n\n## What you did well\n- 1-2 bullets.\n- Must be specific and metric-backed.\n\n## One thing to focus on next game\n- Exactly one drill.\n- Format: Trigger -> Action -> Timing -> Success metric.\n- Must be measurable in the next game.\n\nConstraints:\n- Maximum 350 words total.\n- No generic advice without numeric context and a concrete trigger.\n- Do not talk about end-of-game gold totals as a coaching point. Only mention gold when tied to pre-death or timing context.\n- Do not mention item prices.";

const COACHING_MODELS = [
  "gemini-3.1-flash-lite-preview",
  "gemini-3-flash-preview",
  "gemini-2.5-flash-lite",
  "gemini-2.5-flash",
];

const TRANSIENT_STATUS_CODES = new Set([429, 500, 502, 503, 504]);
const MODEL_ATTEMPTS_PER_MODEL = 2;
const BASE_BACKOFF_MS = 500;

function extractErrorStatus(err: unknown): number | null {
  if (!err || typeof err !== "object") return null;

  const directStatus = Number((err as any).status);
  if (Number.isFinite(directStatus)) {
    return directStatus;
  }

  const message = String((err as any).message ?? "");
  const statusMatch = message.match(/"status"\s*:\s*"(\w+)"/i);
  if (statusMatch?.[1] === "UNAVAILABLE") {
    return 503;
  }

  const codeMatch = message.match(/"code"\s*:\s*(\d{3})/);
  if (codeMatch?.[1]) {
    const parsed = Number(codeMatch[1]);
    if (Number.isFinite(parsed)) return parsed;
  }

  return null;
}

function isTransientProviderError(err: unknown): boolean {
  const status = extractErrorStatus(err);
  return status !== null && TRANSIENT_STATUS_CODES.has(status);
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface CoachingPayload {
  game: {
    champion: string;
    role: string;
    win: boolean;
    kills: number;
    deaths: number;
    assists: number;
    csTotal: number;
    csPerMin: number;
    csAt10: number | null;
    csAt20: number | null;
    csVsOpponent: number | null;
    deathTimestampsMinutes: number[];
    csDropAfterDeaths: Array<{
      deathMinute: number;
      preDeathCsPerMin: number | null;
      postDeathCsPerMin: number | null;
      dropPerMin: number | null;
    }>;
    majorTeamfights: Array<{
      startMinute: number;
      endMinute: number;
      killEvents: number;
      mapZone: string;
      playerInvolved: boolean;
      playerTakedowns: number;
      playerDeaths: number;
    }>;
    biggestCsDropWindow: {
      startMinute: number;
      endMinute: number;
      dropPerMin: number;
    } | null;
    damageDealt: number | null;
    damageShare: number | null;
    damageTaken: number | null;
    goldEarned: number;
    goldDiff15: number | null;
    killParticipation: number;
    objectivesStolen: number | null;
    dragonKills: number | null;
    baronKills: number | null;
    firstBlood: boolean | null;
    gameDurationMinutes: number;
    gameMode: string;
    items: number[] | null;
  };
  history: {
    sampleSize: number;
    avgCsPerMin: number;
    avgKillParticipation: number;
    avgDeaths: number;
    winRate: number;
    belowAvgCsGames: number;
    lowKpGames: number;
    highDeathGames: number;
    mostPlayedChampions: string[];
    primaryRole: string;
    recentForm: string;
  };
  context: {
    tier: string;
    rank: string;
    lp: number;
    summonerName: string;
  };
  learningObjectives?: string[];
}

export async function* streamCoachingReview(
  payload: CoachingPayload,
): AsyncGenerator<string, void, unknown> {
  const toValue = (value: number | null | undefined): string => {
    return typeof value === "number" ? String(value) : "N/A";
  };

  const toPercent = (value: number | null | undefined): string => {
    return typeof value === "number" ? `${value}%` : "N/A";
  };

  const isAvailable = (value: unknown): boolean => {
    if (typeof value === "number") {
      return Number.isFinite(value);
    }
    return typeof value === "boolean";
  };

  const trackedGameMetrics: Array<unknown> = [
    payload.game.csPerMin,
    payload.game.csAt10,
    payload.game.csAt20,
    payload.game.killParticipation,
    payload.game.goldEarned,
    payload.game.damageDealt,
    payload.game.damageShare,
    payload.game.damageTaken,
    payload.game.csVsOpponent,
    payload.game.goldDiff15,
    payload.game.deathTimestampsMinutes.length,
    payload.game.csDropAfterDeaths.length,
    payload.game.dragonKills,
    payload.game.baronKills,
    payload.game.objectivesStolen,
    payload.game.firstBlood,
  ];

  const availableGameMetrics = trackedGameMetrics.filter(isAvailable).length;
  const totalTrackedGameMetrics = trackedGameMetrics.length;
  const sampleSize = payload.history.sampleSize;

  let dataConfidence: "HIGH" | "MEDIUM" | "LOW" = "LOW";
  if (sampleSize >= 10 && availableGameMetrics >= 9) {
    dataConfidence = "HIGH";
  } else if (sampleSize >= 6 && availableGameMetrics >= 6) {
    dataConfidence = "MEDIUM";
  }

  const csDropAfterDeathsText = payload.game.csDropAfterDeaths.length
    ? payload.game.csDropAfterDeaths
        .map((drop) => {
          const pre =
            typeof drop.preDeathCsPerMin === "number"
              ? drop.preDeathCsPerMin.toFixed(2)
              : "N/A";
          const post =
            typeof drop.postDeathCsPerMin === "number"
              ? drop.postDeathCsPerMin.toFixed(2)
              : "N/A";
          const delta =
            typeof drop.dropPerMin === "number"
              ? drop.dropPerMin.toFixed(2)
              : "N/A";
          return `${drop.deathMinute.toFixed(1)}m: pre ${pre} -> post ${post} (drop ${delta})`;
        })
        .join(" | ")
    : "N/A";

  const majorCsDrops = payload.game.csDropAfterDeaths.filter(
    (drop) => typeof drop.dropPerMin === "number" && drop.dropPerMin >= 1,
  );

  const majorCsDropsText = majorCsDrops.length
    ? majorCsDrops
        .map(
          (drop) =>
            `${drop.deathMinute.toFixed(1)}m (drop ${drop.dropPerMin?.toFixed(2)})`,
        )
        .join(", ")
    : "None";

  const majorTeamfightsText = payload.game.majorTeamfights.length
    ? payload.game.majorTeamfights
        .map((fight) => {
          const involvement = fight.playerInvolved ? "present" : "absent";
          return `${fight.startMinute.toFixed(1)}-${fight.endMinute.toFixed(1)}m ${fight.mapZone} (${fight.killEvents} kills, ${involvement}, takedowns ${fight.playerTakedowns}, deaths ${fight.playerDeaths})`;
        })
        .join(" | ")
    : "N/A";

  const biggestCsDropWindowText = payload.game.biggestCsDropWindow
    ? `${payload.game.biggestCsDropWindow.startMinute}m-${payload.game.biggestCsDropWindow.endMinute}m (drop ${payload.game.biggestCsDropWindow.dropPerMin.toFixed(2)} cs/min)`
    : "N/A";

  const dataConfidenceReason = `${sampleSize} historical games + ${availableGameMetrics}/${totalTrackedGameMetrics} key game metrics available`;

  const learningObjectivesText = payload.learningObjectives?.length
    ? `\n\n=== MY LEARNING OBJECTIVES ===\n${payload.learningObjectives.map((obj, i) => `${i + 1}. ${obj}`).join("\n")}`
    : "";

  const userMessage = `Player: ${payload.context.summonerName} | ${payload.context.tier} ${payload.context.rank} (${payload.context.lp} LP)\nChampion: ${payload.game.champion} (${payload.game.role}) | ${payload.game.win ? "WIN" : "LOSS"} in ${payload.game.gameDurationMinutes}m\n\n=== THIS GAME ===\nKDA: ${payload.game.kills}/${payload.game.deaths}/${payload.game.assists}\nCS: ${payload.game.csTotal} total (${payload.game.csPerMin}/min)${payload.game.csVsOpponent !== null ? ` | ${payload.game.csVsOpponent > 0 ? "+" : ""}${payload.game.csVsOpponent} vs lane opponent` : ""}\nCS checkpoints: 10m ${toValue(payload.game.csAt10)} | 20m ${toValue(payload.game.csAt20)}\nDeath minutes: ${payload.game.deathTimestampsMinutes.length ? payload.game.deathTimestampsMinutes.map((minute) => minute.toFixed(1)).join(", ") : "N/A"}\nCS drop after deaths: ${csDropAfterDeathsText}\nMajor CS drops (>=1.0/min): ${majorCsDropsText}\nBiggest CS drop window: ${biggestCsDropWindowText}\nMajor teamfights: ${majorTeamfightsText}\nDamage: ${toValue(payload.game.damageDealt)} dealt (${toPercent(payload.game.damageShare)} of team) | ${toValue(payload.game.damageTaken)} taken\nKill participation: ${payload.game.killParticipation}%\nGold: ${payload.game.goldEarned}${payload.game.goldDiff15 !== null ? ` | Gold diff @15: ${payload.game.goldDiff15 > 0 ? "+" : ""}${payload.game.goldDiff15}` : ""}\nObjectives: ${toValue(payload.game.dragonKills)} dragons | ${toValue(payload.game.baronKills)} barons | ${toValue(payload.game.objectivesStolen)} stolen\nFirst blood: ${payload.game.firstBlood === null ? "N/A" : payload.game.firstBlood ? "Yes" : "No"}\nItems: ${payload.game.items?.length ? payload.game.items.join(", ") : "N/A"}\n\n=== LAST 10 GAMES AVERAGES ===\nSample size: ${payload.history.sampleSize} games\nCS/min avg: ${payload.history.avgCsPerMin} (this game: ${payload.game.csPerMin}) ${payload.game.csPerMin < payload.history.avgCsPerMin - 0.5 ? "below average" : payload.game.csPerMin > payload.history.avgCsPerMin + 0.5 ? "above average" : "normal"}\nKP avg: ${payload.history.avgKillParticipation}% (this game: ${payload.game.killParticipation}%)\nDeaths avg: ${payload.history.avgDeaths} (this game: ${payload.game.deaths}) ${payload.game.deaths > payload.history.avgDeaths + 2 ? "significantly more than usual" : ""}\nPattern counters over last ${payload.history.sampleSize}:\n- CS below own average by >0.5: ${payload.history.belowAvgCsGames}/${payload.history.sampleSize}\n- KP below own average by >8: ${payload.history.lowKpGames}/${payload.history.sampleSize}\n- Deaths above own average by >2: ${payload.history.highDeathGames}/${payload.history.sampleSize}\nWin rate: ${payload.history.winRate}% | Form: ${payload.history.recentForm}\nMost played: ${payload.history.mostPlayedChampions.join(", ")}\nPrimary role: ${payload.history.primaryRole}${learningObjectivesText}\n\nData confidence: ${dataConfidence} (${dataConfidenceReason})\n\nMissing-data rule: treat any metric shown as N/A as unavailable and do not criticize or infer from it.\nOne-off vs pattern rule: use the pattern counters. Usually classify as recurring when >= 4 games out of 10 (or >= 40% of sample if sample < 10).\nConfidence rule: if Data confidence is LOW, use more cautious language and avoid strong causal claims.\n\nGive a coaching review following the exact format specified.`;

  let stream: AsyncGenerator<{ text?: string }> | null = null;
  let lastError: unknown;

  for (const model of COACHING_MODELS) {
    for (let attempt = 1; attempt <= MODEL_ATTEMPTS_PER_MODEL; attempt++) {
      try {
        stream = await ai.models.generateContentStream({
          model,
          contents: userMessage,
          config: {
            systemInstruction: SYSTEM_PROMPT,
          },
        });
        break;
      } catch (err: any) {
        lastError = err;
        const status = extractErrorStatus(err);
        const isNotFound = status === 404;
        const isTransient = isTransientProviderError(err);
        const hasMoreAttempts = attempt < MODEL_ATTEMPTS_PER_MODEL;

        if (isTransient && hasMoreAttempts) {
          const backoffMs = BASE_BACKOFF_MS * attempt;
          await wait(backoffMs);
          continue;
        }

        if (isNotFound || isTransient) {
          break;
        }

        throw err;
      }
    }

    if (stream) {
      break;
    }
  }

  if (!stream) {
    const status = extractErrorStatus(lastError);

    if (status === 503 || status === 429) {
      const overloadedError = new Error(
        "Coaching service is temporarily busy. Please retry in a moment.",
      ) as Error & { status?: number };
      overloadedError.status = status;
      throw overloadedError;
    }

    throw lastError ?? new Error("No supported Gemini model found for streaming");
  }

  for await (const chunk of stream) {
    if (chunk.text) {
      yield chunk.text;
    }
  }
}
