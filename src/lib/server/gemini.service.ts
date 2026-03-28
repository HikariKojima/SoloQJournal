import { GoogleGenAI } from "@google/genai";
import { GEMINI_API_KEY } from "$env/static/private";

if (!GEMINI_API_KEY) {
  throw new Error("GEMINI_API_KEY not set");
}

const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });

const SYSTEM_PROMPT =
  "You are a League of Legends performance coach analyzing ONE specific match using the provided stats and recent history.\n\nGoal: produce practical, rank-appropriate coaching that is specific, evidence-based, and immediately usable next game.\n\nHard rules:\n- Use only the data provided. Do not invent events, timings, lanes, or objectives not present in the input.\n- Every criticism must include numeric evidence from THIS GAME and, when possible, a comparison to HISTORY averages.\n- Distinguish clearly between:\n  - one-off issue (single-game variance)\n  - recurring habit (pattern vs history)\n- Prioritize impact: focus on mistakes that most likely changed win chance, not minor optimizations.\n- Calibrate by rank:\n  - Iron-Gold: simpler language, fundamentals, fewer concepts.\n  - Platinum-Diamond+: more precise tradeoffs and tempo concepts.\n- Keep tone direct and coach-like. No motivational filler.\n\nOutput format (must match exactly these headers):\n\n## What went wrong\n- 2-3 bullets.\n- Each bullet must include at least 2 concrete numbers.\n- If the game was a win, frame as risk areas to watch.\n\n## Your biggest habit to fix\n- Exactly 1 habit.\n- State why it is a HABIT (comparison vs history) or explicitly say it looks ONE-OFF.\n- Explain expected impact in one sentence.\n\n## What you did well\n- 1-2 bullets.\n- Must be specific and metric-backed.\n\n## One thing to focus on next game\n- Exactly one drill.\n- Format: Trigger -> Action -> Timing -> Success metric.\n- Must be measurable in the next game.\n\nConstraints:\n- Maximum 350 words total.\n- No generic advice like 'ward more' or 'play safer' without numeric context and a concrete trigger.";

const COACHING_MODELS = [
  "gemini-3.1-flash-lite-preview",
  "gemini-3-flash-preview",
  "gemini-2.5-flash-lite",
  "gemini-2.5-flash",
];

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
    csVsOpponent: number | null;
    visionScore: number;
    wardsPlaced: number | null;
    wardsDestroyed: number | null;
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
    avgVisionScore: number;
    avgKillParticipation: number;
    avgDeaths: number;
    winRate: number;
    belowAvgCsGames: number;
    lowVisionGames: number;
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
    payload.game.visionScore,
    payload.game.killParticipation,
    payload.game.goldEarned,
    payload.game.damageDealt,
    payload.game.damageShare,
    payload.game.damageTaken,
    payload.game.csVsOpponent,
    payload.game.goldDiff15,
    payload.game.wardsPlaced,
    payload.game.wardsDestroyed,
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

  const dataConfidenceReason = `${sampleSize} historical games + ${availableGameMetrics}/${totalTrackedGameMetrics} key game metrics available`;

  const userMessage = `Player: ${payload.context.summonerName} | ${payload.context.tier} ${payload.context.rank} (${payload.context.lp} LP)\nChampion: ${payload.game.champion} (${payload.game.role}) | ${payload.game.win ? "WIN" : "LOSS"} in ${payload.game.gameDurationMinutes}m\n\n=== THIS GAME ===\nKDA: ${payload.game.kills}/${payload.game.deaths}/${payload.game.assists}\nCS: ${payload.game.csTotal} total (${payload.game.csPerMin}/min)${payload.game.csVsOpponent !== null ? ` | ${payload.game.csVsOpponent > 0 ? "+" : ""}${payload.game.csVsOpponent} vs lane opponent` : ""}\nVision: ${payload.game.visionScore} score | ${toValue(payload.game.wardsPlaced)} placed | ${toValue(payload.game.wardsDestroyed)} destroyed\nDamage: ${toValue(payload.game.damageDealt)} dealt (${toPercent(payload.game.damageShare)} of team) | ${toValue(payload.game.damageTaken)} taken\nKill participation: ${payload.game.killParticipation}%\nGold: ${payload.game.goldEarned}${payload.game.goldDiff15 !== null ? ` | Gold diff @15: ${payload.game.goldDiff15 > 0 ? "+" : ""}${payload.game.goldDiff15}` : ""}\nObjectives: ${toValue(payload.game.dragonKills)} dragons | ${toValue(payload.game.baronKills)} barons | ${toValue(payload.game.objectivesStolen)} stolen\nFirst blood: ${payload.game.firstBlood === null ? "N/A" : payload.game.firstBlood ? "Yes" : "No"}\nItems: ${payload.game.items?.length ? payload.game.items.join(", ") : "N/A"}\n\n=== LAST 10 GAMES AVERAGES ===\nSample size: ${payload.history.sampleSize} games\nCS/min avg: ${payload.history.avgCsPerMin} (this game: ${payload.game.csPerMin}) ${payload.game.csPerMin < payload.history.avgCsPerMin - 0.5 ? "⚠ below average" : payload.game.csPerMin > payload.history.avgCsPerMin + 0.5 ? "✓ above average" : "≈ normal"}\nVision avg: ${payload.history.avgVisionScore} (this game: ${payload.game.visionScore}) ${payload.game.visionScore < payload.history.avgVisionScore - 5 ? "⚠ below average" : ""}\nKP avg: ${payload.history.avgKillParticipation}% (this game: ${payload.game.killParticipation}%)\nDeaths avg: ${payload.history.avgDeaths} (this game: ${payload.game.deaths}) ${payload.game.deaths > payload.history.avgDeaths + 2 ? "⚠ significantly more than usual" : ""}\nPattern counters over last ${payload.history.sampleSize}:\n- CS below own average by >0.5: ${payload.history.belowAvgCsGames}/${payload.history.sampleSize}\n- Vision below own average by >5: ${payload.history.lowVisionGames}/${payload.history.sampleSize}\n- KP below own average by >8: ${payload.history.lowKpGames}/${payload.history.sampleSize}\n- Deaths above own average by >2: ${payload.history.highDeathGames}/${payload.history.sampleSize}\nWin rate: ${payload.history.winRate}% | Form: ${payload.history.recentForm}\nMost played: ${payload.history.mostPlayedChampions.join(", ")}\nPrimary role: ${payload.history.primaryRole}\n\nData confidence: ${dataConfidence} (${dataConfidenceReason})\n\nMissing-data rule: treat any metric shown as N/A as unavailable and do not criticize or infer from it.\nOne-off vs pattern rule: use the pattern counters. Usually classify as recurring when >= 4 games out of 10 (or >= 40% of sample if sample < 10).\nConfidence rule: if Data confidence is LOW, use more cautious language and avoid strong causal claims.\n\nGive a coaching review following the exact format specified.`;

  let stream: AsyncGenerator<{ text?: string }> | null = null;
  let lastError: unknown;

  for (const model of COACHING_MODELS) {
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
      if (err?.status !== 404) {
        throw err;
      }
    }
  }

  if (!stream) {
    throw (
      lastError ?? new Error("No supported Gemini model found for streaming")
    );
  }

  for await (const chunk of stream) {
    if (chunk.text) {
      yield chunk.text;
    }
  }
}
