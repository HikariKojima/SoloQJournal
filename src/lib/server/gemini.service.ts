import { GoogleGenAI } from "@google/genai";
import { GEMINI_API_KEY } from "$env/static/private";
import type { TimelineMajorFight, TimelineCsDropAfterDeath } from "$lib/types";

if (!GEMINI_API_KEY) {
  throw new Error("GEMINI_API_KEY not set");
}

const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });

const SYSTEM_PROMPT =
  "You are a League of Legends performance coach. Analyze using only provided data. Direct execution review grounded in numbers and timestamps.\n\nKEY RULES:\n- Every point = 2+ numbers from THIS GAME.\n- One-off vs habit: use history patterns (>=40% = recurring).\n- Prioritize: CS trends > deaths timing > teamfight involvement > objectives.\n- Objective misses = advisory (e.g. \"fights to review at 14:06\"), not blame.\n- Locations: 'dragon', 'baron', 'top/bot side river'. NOT 'dragon side river' or 'baron side river'.\n- No vision score, wards, or end-game gold talk.\n- CS drops >=1.0/min major; <0.6 = noise.\n- Rank: Iron-Gold simpler; Plat a bit more precise.  emerald+ the most detail \n- Max 350 words. No filler.\n\nOUTPUT (exact headers, strict order):\n## Learning objective\nDid you execute? Show numbers.\n## Analytical questions\nCS, teamfights, damage. Include: \"Fights to review:\" + 1-3 times.\n## What went wrong\n2-3 bullets, 2+ numbers each. Frame objectives as opportunities.\n## Your biggest habit to fix\n1 habit + why (vs history) + impact.\n## What you did well\n1-2 bullets, metric-backed.\n## One thing to focus on next game\n1 drill: Trigger->Action->Timing->Metric. Dragon/Baron: \"1:30 before spawn\" (never 1:00).";

const COACHING_MODELS = [
  "gemini-2.5-flash",
  "gemini-3-flash-preview",
  "gemini-2.5-flash-lite",
  "gemini-3.1-flash-lite-preview",
];

const TRANSIENT_STATUS_CODES = new Set([429, 500, 502, 503, 504]);
const MODEL_ATTEMPTS_PER_MODEL = 1;
const BASE_BACKOFF_MS = 500;

function formatElapsedMs(startMs: number): string {
  return `${Math.round(performance.now() - startMs)}ms`;
}

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
    csDropAfterDeaths: TimelineCsDropAfterDeath[];
    majorTeamfights: TimelineMajorFight[];
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
    deathTimingSamples: number;
    recurringFirstDeathWindow: string | null;
    recurringFirstDeathCount: number;
    recurringFirstDeathRate: number | null;
  };
  context: {
    tier: string;
    rank: string;
    lp: number;
    summonerName: string;
  };
  learningObjectives?: string[];
}

function formatMinutesSeconds(decimalMinutes: number): string {
  const totalSeconds = Math.round(decimalMinutes * 60);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

export async function* streamCoachingReview(
  payload: CoachingPayload,
): AsyncGenerator<string, void, unknown> {
  const reviewStartMs = performance.now();
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
          return `${formatMinutesSeconds(drop.deathMinute)}: pre ${pre} -> post ${post} (drop ${delta})`;
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
            `${formatMinutesSeconds(drop.deathMinute)} (drop ${drop.dropPerMin?.toFixed(2)})`,
        )
        .join(", ")
    : "None";

  const majorTeamfightsText = payload.game.majorTeamfights.length
    ? payload.game.majorTeamfights
        .map((fight) => {
          const involvement = fight.playerInvolved
            ? "player joined"
            : "player did not join";
          const objectiveLabel = fight.objectiveContext
            ? ` [${fight.objectiveContext.objectiveType} ${fight.objectiveContext.teamSecuredIt ? "secured" : "denied"}]`
            : "";
          return `${formatMinutesSeconds(fight.startMinute)}-${formatMinutesSeconds(fight.endMinute)} ${fight.mapZone} (${fight.killEvents} kills, ${involvement}, player takedowns ${fight.playerTakedowns}, player deaths ${fight.playerDeaths})${objectiveLabel}`;
        })
        .join(" | ")
    : "N/A";

  const objectiveReviewFights = payload.game.majorTeamfights.filter(
    (fight) => !fight.playerInvolved && !!fight.objectiveContext,
  );

  const objectiveReviewFightsText = objectiveReviewFights.length
    ? objectiveReviewFights
        .slice(0, 4)
        .map((fight) => {
          const context = fight.objectiveContext;
          if (!context) return "";

          return `${formatMinutesSeconds(fight.startMinute)} (${context.objectiveType}, ${context.teamSecuredIt ? "team secured" : "team denied"}, ${fight.killEvents} kills)`;
        })
        .filter(Boolean)
        .join(", ")
    : "N/A";

  const biggestCsDropWindowText = payload.game.biggestCsDropWindow
    ? `${formatMinutesSeconds(payload.game.biggestCsDropWindow.startMinute)}-${formatMinutesSeconds(payload.game.biggestCsDropWindow.endMinute)} (drop ${payload.game.biggestCsDropWindow.dropPerMin.toFixed(2)} cs/min)`
    : "N/A";

  const dataConfidenceReason = `${sampleSize} historical games + ${availableGameMetrics}/${totalTrackedGameMetrics} key game metrics available`;

  const learningObjectivesText = payload.learningObjectives?.length
    ? `\n\n=== MY LEARNING OBJECTIVES ===\n${payload.learningObjectives.map((obj, i) => `${i + 1}. ${obj}`).join("\n")}`
    : "";

  const userMessage = `${payload.context.summonerName} | ${payload.context.tier} ${payload.context.rank}\n${payload.game.champion} (${payload.game.role}) | ${payload.game.win ? "WIN" : "LOSS"} ${payload.game.gameDurationMinutes}m\n\nGAME:\nKDA: ${payload.game.kills}/${payload.game.deaths}/${payload.game.assists}\nCS: ${payload.game.csTotal} (${payload.game.csPerMin}/min)${payload.game.csVsOpponent !== null ? ` | ${payload.game.csVsOpponent > 0 ? "+" : ""}${payload.game.csVsOpponent} vs opp` : ""}\n@10/20: ${toValue(payload.game.csAt10)}/${toValue(payload.game.csAt20)}\nDeaths: ${payload.game.deathTimestampsMinutes.length ? payload.game.deathTimestampsMinutes.map((m) => formatMinutesSeconds(m)).join(", ") : "N/A"}\nCS drops: ${majorCsDropsText}\nTeamfights: ${majorTeamfightsText}\nGaps: ${objectiveReviewFightsText}\nDamage: ${toValue(payload.game.damageDealt)} (${toPercent(payload.game.damageShare)} team)\nKP: ${payload.game.killParticipation}%${payload.game.goldDiff15 !== null ? `\n@15 gold: ${payload.game.goldDiff15 > 0 ? "+" : ""}${payload.game.goldDiff15}` : ""}\nObj: ${toValue(payload.game.dragonKills)}D/${toValue(payload.game.baronKills)}B\n\nHISTORY (${payload.history.sampleSize}g):\nCS avg: ${payload.history.avgCsPerMin} (Δ${payload.game.csPerMin - payload.history.avgCsPerMin > 0 ? "+" : ""}${(payload.game.csPerMin - payload.history.avgCsPerMin).toFixed(1)})\nKP: ${payload.history.avgKillParticipation}% | Deaths: ${payload.history.avgDeaths}\nPatterns: ${payload.history.belowAvgCsGames}/${payload.history.sampleSize} low CS | ${payload.history.highDeathGames}/${payload.history.sampleSize} high deaths${payload.history.recurringFirstDeathWindow ? `\nFirst death: ${payload.history.recurringFirstDeathWindow} (${toPercent(payload.history.recurringFirstDeathRate)})` : ""}\nWR: ${payload.history.winRate}% | Form: ${payload.history.recentForm}${learningObjectivesText}\n\nConfidence: ${dataConfidence}`;

  let stream: AsyncGenerator<{ text?: string }> | null = null;
  let lastError: unknown;
  let selectedModel: string | null = null;

  for (const model of COACHING_MODELS) {
    for (let attempt = 1; attempt <= MODEL_ATTEMPTS_PER_MODEL; attempt++) {
      const attemptStartMs = performance.now();
      try {
        stream = await ai.models.generateContentStream({
          model,
          contents: userMessage,
          config: {
            systemInstruction: SYSTEM_PROMPT,
          },
        });
        selectedModel = model;
        console.info(
          `[COACHING][MODEL_OK] model=${model} attempt=${attempt} elapsed=${formatElapsedMs(attemptStartMs)}`,
        );
        break;
      } catch (err: any) {
        lastError = err;
        const status = extractErrorStatus(err);
        const isNotFound = status === 404;
        const isTransient = isTransientProviderError(err);
        const hasMoreAttempts = attempt < MODEL_ATTEMPTS_PER_MODEL;

        console.warn(
          `[COACHING][MODEL_FAIL] model=${model} attempt=${attempt} status=${status ?? "unknown"} transient=${isTransient} elapsed=${formatElapsedMs(attemptStartMs)}`,
        );

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
    console.error(
      `[COACHING][ALL_MODELS_FAILED] elapsed=${formatElapsedMs(reviewStartMs)}`,
    );
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

  console.info(
    `[COACHING][STREAM_START] model=${selectedModel ?? "unknown"} elapsed=${formatElapsedMs(reviewStartMs)}`,
  );

  let chunkCount = 0;

  for await (const chunk of stream) {
    if (chunk.text) {
      chunkCount += 1;
      yield chunk.text;
    }
  }

  console.info(
    `[COACHING][STREAM_DONE] model=${selectedModel ?? "unknown"} chunks=${chunkCount} elapsed=${formatElapsedMs(reviewStartMs)}`,
  );
}
