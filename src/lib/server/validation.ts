import type { CoachingPayload } from "$lib/server/gemini.service";

const VALID_PLATFORMS = new Set([
  "na1",
  "br1",
  "eun1",
  "euw1",
  "jp1",
  "kr",
  "la1",
  "la2",
  "oc1",
  "tr1",
  "ru",
  "ph2",
  "sg2",
  "th2",
  "tw2",
  "vn2",
  "sa1",
]);

function hasControlChars(value: string): boolean {
  return /[\u0000-\u001F\u007F]/.test(value);
}

export function validatePlatform(
  rawPlatform: string | null,
  fallback = "euw1",
) {
  const platform = (rawPlatform ?? fallback).trim().toLowerCase();
  if (!VALID_PLATFORMS.has(platform)) {
    return {
      ok: false as const,
      error: "Invalid platform value.",
    };
  }

  return {
    ok: true as const,
    value: platform,
  };
}

export function validateGameName(rawGameName: string | null) {
  const gameName = (rawGameName ?? "").trim();
  if (!gameName) {
    return { ok: false as const, error: "Missing gameName query parameter" };
  }
  if (gameName.length > 32 || hasControlChars(gameName)) {
    return { ok: false as const, error: "Invalid gameName format" };
  }

  return { ok: true as const, value: gameName };
}

export function validateTagLine(rawTagLine: string | null) {
  const tagLine = (rawTagLine ?? "").trim().replace(/^#/, "");
  if (!tagLine) {
    return { ok: false as const, error: "Missing tagLine query parameter" };
  }

  if (!/^[A-Za-z0-9]{2,10}$/.test(tagLine)) {
    return { ok: false as const, error: "Invalid tagLine format" };
  }

  return { ok: true as const, value: tagLine };
}

export function validatePuuid(rawPuuid: string | null) {
  const puuid = (rawPuuid ?? "").trim();
  if (!puuid) {
    return { ok: false as const, error: "Missing puuid query parameter" };
  }

  if (puuid.length < 40 || puuid.length > 128 || hasControlChars(puuid)) {
    return { ok: false as const, error: "Invalid puuid format" };
  }

  return { ok: true as const, value: puuid };
}

export function validateSummonerId(rawSummonerId: string | null) {
  const summonerId = (rawSummonerId ?? "").trim();
  if (!summonerId) {
    return { ok: false as const, error: "Missing summonerId query parameter" };
  }

  if (
    summonerId.length < 20 ||
    summonerId.length > 120 ||
    hasControlChars(summonerId)
  ) {
    return { ok: false as const, error: "Invalid summonerId format" };
  }

  return { ok: true as const, value: summonerId };
}

export function validateMatchId(rawMatchId: string | null) {
  const matchId = (rawMatchId ?? "").trim().toUpperCase();
  if (!matchId) {
    return { ok: false as const, error: "Missing matchId query parameter" };
  }

  if (!/^[A-Z0-9_]{8,40}$/.test(matchId)) {
    return { ok: false as const, error: "Invalid matchId format" };
  }

  return { ok: true as const, value: matchId };
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}

function isBoolean(value: unknown): value is boolean {
  return typeof value === "boolean";
}

function toNullableNumber(value: unknown): number | null {
  return isFiniteNumber(value) ? value : null;
}

function toNullableBoolean(value: unknown): boolean | null {
  return isBoolean(value) ? value : null;
}

function toNumberArray(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is number => isFiniteNumber(item));
}

type ObjectiveType = "early" | "dragon" | "grubs" | "baron" | "herald";

function isObjectiveType(value: unknown): value is ObjectiveType {
  return (
    value === "early" ||
    value === "dragon" ||
    value === "grubs" ||
    value === "baron" ||
    value === "herald"
  );
}

export function validateCoachingPayload(
  rawPayload: unknown,
): { ok: true; value: CoachingPayload } | { ok: false; error: string } {
  if (!isObjectRecord(rawPayload)) {
    return { ok: false, error: "Invalid coaching payload." };
  }

  const game = rawPayload.game;
  const history = rawPayload.history;
  const context = rawPayload.context;

  if (
    !isObjectRecord(game) ||
    !isObjectRecord(history) ||
    !isObjectRecord(context)
  ) {
    return { ok: false, error: "Invalid coaching payload structure." };
  }

  const requiredGameFields = [
    ["champion", isString(game.champion)],
    ["role", isString(game.role)],
    ["win", isBoolean(game.win)],
    ["kills", isFiniteNumber(game.kills)],
    ["deaths", isFiniteNumber(game.deaths)],
    ["assists", isFiniteNumber(game.assists)],
    ["csTotal", isFiniteNumber(game.csTotal)],
    ["csPerMin", isFiniteNumber(game.csPerMin)],
    ["goldEarned", isFiniteNumber(game.goldEarned)],
    ["killParticipation", isFiniteNumber(game.killParticipation)],
    ["gameDurationMinutes", isFiniteNumber(game.gameDurationMinutes)],
    ["gameMode", isString(game.gameMode)],
  ] as const;

  const invalidRequiredGameField = requiredGameFields.find(
    ([, valid]) => !valid,
  );
  if (invalidRequiredGameField) {
    return {
      ok: false,
      error: `Invalid coaching payload game.${invalidRequiredGameField[0]}.`,
    };
  }

  const requiredHistoryFields = [
    ["sampleSize", isFiniteNumber(history.sampleSize)],
    ["avgCsPerMin", isFiniteNumber(history.avgCsPerMin)],
    ["avgKillParticipation", isFiniteNumber(history.avgKillParticipation)],
    ["avgDeaths", isFiniteNumber(history.avgDeaths)],
    ["winRate", isFiniteNumber(history.winRate)],
    ["belowAvgCsGames", isFiniteNumber(history.belowAvgCsGames)],
    ["lowKpGames", isFiniteNumber(history.lowKpGames)],
    ["highDeathGames", isFiniteNumber(history.highDeathGames)],
    ["primaryRole", isString(history.primaryRole)],
    ["recentForm", isString(history.recentForm)],
    ["deathTimingSamples", isFiniteNumber(history.deathTimingSamples)],
    [
      "recurringFirstDeathCount",
      isFiniteNumber(history.recurringFirstDeathCount),
    ],
  ] as const;

  const invalidRequiredHistoryField = requiredHistoryFields.find(
    ([, valid]) => !valid,
  );
  if (invalidRequiredHistoryField) {
    return {
      ok: false,
      error: `Invalid coaching payload history.${invalidRequiredHistoryField[0]}.`,
    };
  }

  if (
    !isString(context.tier) ||
    !isString(context.rank) ||
    !isFiniteNumber(context.lp) ||
    !isString(context.summonerName)
  ) {
    return { ok: false, error: "Invalid coaching payload context fields." };
  }

  const rawCsDropAfterDeaths = Array.isArray(game.csDropAfterDeaths)
    ? game.csDropAfterDeaths
    : [];

  const csDropAfterDeaths = rawCsDropAfterDeaths
    .filter((item): item is Record<string, unknown> => isObjectRecord(item))
    .map((item) => ({
      deathMinute: isFiniteNumber(item.deathMinute) ? item.deathMinute : 0,
      preDeathCsPerMin: toNullableNumber(item.preDeathCsPerMin),
      postDeathCsPerMin: toNullableNumber(item.postDeathCsPerMin),
      dropPerMin: toNullableNumber(item.dropPerMin),
    }));

  const rawMajorTeamfights = Array.isArray(game.majorTeamfights)
    ? game.majorTeamfights
    : [];

  const majorTeamfights = rawMajorTeamfights
    .filter((item): item is Record<string, unknown> => isObjectRecord(item))
    .map((item) => {
      const objectiveContext = isObjectRecord(item.objectiveContext)
        ? {
            objectiveType: isObjectiveType(item.objectiveContext.objectiveType)
              ? item.objectiveContext.objectiveType
              : "early",
            objectiveMinute: isFiniteNumber(
              item.objectiveContext.objectiveMinute,
            )
              ? item.objectiveContext.objectiveMinute
              : 0,
            teamSecuredIt: Boolean(item.objectiveContext.teamSecuredIt),
          }
        : undefined;

      return {
        startMinute: isFiniteNumber(item.startMinute) ? item.startMinute : 0,
        endMinute: isFiniteNumber(item.endMinute) ? item.endMinute : 0,
        killEvents: isFiniteNumber(item.killEvents) ? item.killEvents : 0,
        mapZone: isString(item.mapZone) ? item.mapZone : "unknown",
        playerInvolved: Boolean(item.playerInvolved),
        playerTakedowns: isFiniteNumber(item.playerTakedowns)
          ? item.playerTakedowns
          : 0,
        playerDeaths: isFiniteNumber(item.playerDeaths) ? item.playerDeaths : 0,
        ...(objectiveContext ? { objectiveContext } : {}),
      };
    });

  const champion = game.champion as string;
  const role = game.role as string;
  const win = game.win as boolean;
  const kills = game.kills as number;
  const deaths = game.deaths as number;
  const assists = game.assists as number;
  const csTotal = game.csTotal as number;
  const csPerMin = game.csPerMin as number;
  const goldEarned = game.goldEarned as number;
  const killParticipation = game.killParticipation as number;
  const gameDurationMinutes = game.gameDurationMinutes as number;
  const gameMode = game.gameMode as string;

  const sampleSize = history.sampleSize as number;
  const avgCsPerMin = history.avgCsPerMin as number;
  const avgKillParticipation = history.avgKillParticipation as number;
  const avgDeaths = history.avgDeaths as number;
  const winRate = history.winRate as number;
  const belowAvgCsGames = history.belowAvgCsGames as number;
  const lowKpGames = history.lowKpGames as number;
  const highDeathGames = history.highDeathGames as number;
  const primaryRole = history.primaryRole as string;
  const recentForm = history.recentForm as string;
  const deathTimingSamples = history.deathTimingSamples as number;
  const recurringFirstDeathCount = history.recurringFirstDeathCount as number;

  const tier = context.tier as string;
  const rank = context.rank as string;
  const lp = context.lp as number;
  const summonerName = context.summonerName as string;

  const normalizedPayload: CoachingPayload = {
    game: {
      champion,
      role,
      win,
      kills,
      deaths,
      assists,
      csTotal,
      csPerMin,
      csAt10: toNullableNumber(game.csAt10),
      csAt20: toNullableNumber(game.csAt20),
      csVsOpponent: toNullableNumber(game.csVsOpponent),
      deathTimestampsMinutes: toNumberArray(game.deathTimestampsMinutes),
      csDropAfterDeaths,
      majorTeamfights,
      biggestCsDropWindow: isObjectRecord(game.biggestCsDropWindow)
        ? {
            startMinute: isFiniteNumber(game.biggestCsDropWindow.startMinute)
              ? game.biggestCsDropWindow.startMinute
              : 0,
            endMinute: isFiniteNumber(game.biggestCsDropWindow.endMinute)
              ? game.biggestCsDropWindow.endMinute
              : 0,
            dropPerMin: isFiniteNumber(game.biggestCsDropWindow.dropPerMin)
              ? game.biggestCsDropWindow.dropPerMin
              : 0,
          }
        : null,
      damageDealt: toNullableNumber(game.damageDealt),
      damageShare: toNullableNumber(game.damageShare),
      damageTaken: toNullableNumber(game.damageTaken),
      goldEarned,
      goldDiff15: toNullableNumber(game.goldDiff15),
      killParticipation,
      objectivesStolen: toNullableNumber(game.objectivesStolen),
      dragonKills: toNullableNumber(game.dragonKills),
      baronKills: toNullableNumber(game.baronKills),
      firstBlood: toNullableBoolean(game.firstBlood),
      gameDurationMinutes,
      gameMode,
      items: Array.isArray(game.items)
        ? game.items.filter((item): item is number => isFiniteNumber(item))
        : null,
    },
    history: {
      sampleSize,
      avgCsPerMin,
      avgKillParticipation,
      avgDeaths,
      winRate,
      belowAvgCsGames,
      lowKpGames,
      highDeathGames,
      mostPlayedChampions: Array.isArray(history.mostPlayedChampions)
        ? history.mostPlayedChampions.filter((item): item is string =>
            isString(item),
          )
        : [],
      primaryRole,
      recentForm,
      deathTimingSamples,
      recurringFirstDeathWindow: isString(history.recurringFirstDeathWindow)
        ? history.recurringFirstDeathWindow
        : null,
      recurringFirstDeathCount,
      recurringFirstDeathRate: toNullableNumber(
        history.recurringFirstDeathRate,
      ),
    },
    context: {
      tier,
      rank,
      lp,
      summonerName,
    },
    learningObjectives: Array.isArray(rawPayload.learningObjectives)
      ? rawPayload.learningObjectives.filter((item): item is string =>
          isString(item),
        )
      : undefined,
  };

  return { ok: true, value: normalizedPayload };
}
