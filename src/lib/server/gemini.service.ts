import { GoogleGenAI } from "@google/genai";
import { GEMINI_API_KEY } from "$env/static/private";

if (!GEMINI_API_KEY) {
  throw new Error("GEMINI_API_KEY not set");
}

const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });

const SYSTEM_PROMPT = `You are a League of Legends coach reviewing a specific game for a player.
Your job is to give concrete, data-driven feedback — not generic tips.

Rules:
- Reference the actual numbers in your feedback. Never give advice that would
  apply to any game regardless of the stats.
- Compare single-game numbers against their historical averages to distinguish
  recurring issues from one-off mistakes.
- Calibrate language and depth to their rank tier. Gold players need different
  advice than Diamond players.
- Structure your response in exactly this format (use these exact markdown headers):

## What went wrong
(2-3 specific mistakes backed by numbers. If they won, this is "what to watch")

## Your biggest habit to fix
(ONE recurring pattern from their history — the single highest-leverage thing)

## What you did well
(1-2 genuine positives — must be specific, not "good KDA")

## One thing to focus on next game
(A single, actionable drill or mindset. Not "ward more" — something like
"Place a ward in the river bush at 3:45 before the first dragon spawns")

Keep the total response under 350 words. Be direct. Do not use filler phrases
like "Great job!" or "Keep it up!". Write like a coach, not a cheerleader.
`;

const COACHING_MODELS = [
  "gemini-3-flash-preview",
  "gemini-2.5-flash",
  "gemini-2.5-flash-preview-05-14",
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
    wardsPlaced: number;
    wardsDestroyed: number;
    damageDealt: number;
    damageShare: number;
    damageTaken: number;
    goldEarned: number;
    goldDiff15: number | null;
    killParticipation: number;
    objectivesStolen: number;
    dragonKills: number;
    baronKills: number;
    firstBlood: boolean;
    gameDurationMinutes: number;
    gameMode: string;
    items: number[];
  };
  history: {
    avgCsPerMin: number;
    avgVisionScore: number;
    avgKillParticipation: number;
    avgDeaths: number;
    winRate: number;
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

export async function* streamCoachingReview(payload: CoachingPayload): AsyncGenerator<string, void, unknown> {
  const userMessage = `Player: ${payload.context.summonerName} | ${payload.context.tier} ${payload.context.rank} (${payload.context.lp} LP)\nChampion: ${payload.game.champion} (${payload.game.role}) | ${payload.game.win ? "WIN" : "LOSS"} in ${payload.game.gameDurationMinutes}m\n\n=== THIS GAME ===\nKDA: ${payload.game.kills}/${payload.game.deaths}/${payload.game.assists}\nCS: ${payload.game.csTotal} total (${payload.game.csPerMin}/min)${payload.game.csVsOpponent !== null ? ` | ${payload.game.csVsOpponent > 0 ? "+" : ""}${payload.game.csVsOpponent} vs lane opponent` : ""}\nVision: ${payload.game.visionScore} score | ${payload.game.wardsPlaced} placed | ${payload.game.wardsDestroyed} destroyed\nDamage: ${payload.game.damageDealt} dealt (${payload.game.damageShare}% of team) | ${payload.game.damageTaken} taken\nKill participation: ${payload.game.killParticipation}%\nGold: ${payload.game.goldEarned}${payload.game.goldDiff15 !== null ? ` | Gold diff @15: ${payload.game.goldDiff15 > 0 ? "+" : ""}${payload.game.goldDiff15}` : ""}\nObjectives: ${payload.game.dragonKills} dragons | ${payload.game.baronKills} barons | ${payload.game.objectivesStolen} stolen\nFirst blood: ${payload.game.firstBlood ? "Yes" : "No"}\n\n=== LAST 10 GAMES AVERAGES ===\nCS/min avg: ${payload.history.avgCsPerMin} (this game: ${payload.game.csPerMin}) ${payload.game.csPerMin < payload.history.avgCsPerMin - 0.5 ? "⚠ below average" : payload.game.csPerMin > payload.history.avgCsPerMin + 0.5 ? "✓ above average" : "≈ normal"}\nVision avg: ${payload.history.avgVisionScore} (this game: ${payload.game.visionScore}) ${payload.game.visionScore < payload.history.avgVisionScore - 5 ? "⚠ below average" : ""}\nKP avg: ${payload.history.avgKillParticipation}% (this game: ${payload.game.killParticipation}%)\nDeaths avg: ${payload.history.avgDeaths} (this game: ${payload.game.deaths}) ${payload.game.deaths > payload.history.avgDeaths + 2 ? "⚠ significantly more than usual" : ""}\nWin rate: ${payload.history.winRate}% | Form: ${payload.history.recentForm}\nMost played: ${payload.history.mostPlayedChampions.join(", ")}\nPrimary role: ${payload.history.primaryRole}\n\nGive a coaching review following the exact format specified.`;

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
    throw lastError ?? new Error("No supported Gemini model found for streaming");
  }

  for await (const chunk of stream) {
    if (chunk.text) {
      yield chunk.text;
    }
  }
}
