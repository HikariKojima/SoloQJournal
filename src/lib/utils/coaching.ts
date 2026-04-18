import type {
  MatchSummaryResponse,
  TimelineCsDropAfterDeath,
  TimelineMajorFight,
} from "$lib/types";

export type LeagueEntry = {
  tier: string;
  rank: string;
  lp: number;
};

export type MatchHistoryStats = {
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

export type TimelineCoachingSignals = {
  csAt10: number | null;
  csAt20: number | null;
  deathTimestampsMinutes: number[];
  csDropAfterDeaths: TimelineCsDropAfterDeath[];
  biggestCsDropWindow: {
    startMinute: number;
    endMinute: number;
    dropPerMin: number;
  } | null;
  majorTeamfights: TimelineMajorFight[];
};

export type CoachingPayload = {
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
    csDropAfterDeaths: TimelineCoachingSignals["csDropAfterDeaths"];
    biggestCsDropWindow: TimelineCoachingSignals["biggestCsDropWindow"];
    majorTeamfights: TimelineCoachingSignals["majorTeamfights"];
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
  history: MatchHistoryStats;
  context: {
    tier: string;
    rank: string;
    lp: number;
    summonerName: string;
  };
  learningObjectives?: string[];
};

export function buildHistoryStats(
  matches: MatchSummaryResponse[],
  puuid: string,
): MatchHistoryStats {
  if (!matches?.length) {
    return {
      sampleSize: 0,
      avgCsPerMin: 0,
      avgKillParticipation: 0,
      avgDeaths: 0,
      winRate: 0,
      belowAvgCsGames: 0,
      lowKpGames: 0,
      highDeathGames: 0,
      mostPlayedChampions: [],
      primaryRole: "UNKNOWN",
      recentForm: "",
      deathTimingSamples: 0,
      recurringFirstDeathWindow: null,
      recurringFirstDeathCount: 0,
      recurringFirstDeathRate: null,
    };
  }

  const historyList = matches.slice(0, 10);
  let totalCsPerMin = 0;
  let totalKP = 0;
  let totalDeaths = 0;
  let wins = 0;

  const csPerMinValues: number[] = [];
  const kpValues: number[] = [];
  const deathValues: number[] = [];

  const championCounts: Record<string, number> = {};
  const roleCounts: Record<string, number> = {};
  const formParts: string[] = [];
  const firstDeathWindowCounts: Record<string, number> = {};
  let deathTimingSamples = 0;

  for (const match of historyList) {
    const durationMin =
      match.durationSeconds > 0 ? match.durationSeconds / 60 : 1;
    const csPerMin = match.stats.cs / durationMin;
    csPerMinValues.push(csPerMin);
    deathValues.push(match.kda.deaths);

    totalCsPerMin += csPerMin;
    totalDeaths += match.kda.deaths;

    if (match.teamKills > 0) {
      const kp =
        ((match.kda.kills + match.kda.assists) / match.teamKills) * 100;
      totalKP += kp;
      kpValues.push(kp);
    } else {
      kpValues.push(0);
    }

    if (match.result === "win") {
      wins += 1;
      formParts.push("W");
    } else {
      formParts.push("L");
    }

    championCounts[match.champion] = (championCounts[match.champion] || 0) + 1;
    const role = match.playerPosition || match.playerRole || "UNKNOWN";
    roleCounts[role] = (roleCounts[role] || 0) + 1;

    const deathMinutes = match.timelineInsights?.deathTimestampsMinutes;
    if (Array.isArray(deathMinutes) && deathMinutes.length > 0) {
      const firstDeath = deathMinutes[0];
      if (Number.isFinite(firstDeath)) {
        deathTimingSamples += 1;
        const windowStart = Math.floor(firstDeath / 2) * 2;
        const windowEnd = windowStart + 2;
        const key = `${windowStart}-${windowEnd}`;
        firstDeathWindowCounts[key] = (firstDeathWindowCounts[key] || 0) + 1;
      }
    }
  }

  const avgCsPerMin = totalCsPerMin / historyList.length;
  const avgKillParticipation = totalKP / historyList.length;
  const avgDeaths = totalDeaths / historyList.length;
  const winRate = (wins / historyList.length) * 100;

  const belowAvgCsGames = csPerMinValues.filter(
    (value) => value < avgCsPerMin - 0.5,
  ).length;
  const lowKpGames = kpValues.filter(
    (value) => value < avgKillParticipation - 8,
  ).length;
  const highDeathGames = deathValues.filter(
    (value) => value > avgDeaths + 2,
  ).length;

  const mostPlayedChampions = Object.entries(championCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([champ]) => champ);

  const primaryRole =
    Object.entries(roleCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || "UNKNOWN";

  const topFirstDeathWindow = Object.entries(firstDeathWindowCounts).sort(
    (a, b) => b[1] - a[1],
  )[0];
  const recurringFirstDeathWindow =
    topFirstDeathWindow && topFirstDeathWindow[1] >= 2
      ? topFirstDeathWindow[0]
      : null;
  const recurringFirstDeathCount = recurringFirstDeathWindow
    ? topFirstDeathWindow?.[1] || 0
    : 0;
  const recurringFirstDeathRate =
    recurringFirstDeathCount > 0 && deathTimingSamples > 0
      ? Math.round((recurringFirstDeathCount / deathTimingSamples) * 1000) / 10
      : null;

  return {
    sampleSize: historyList.length,
    avgCsPerMin: Math.round(avgCsPerMin * 100) / 100,
    avgKillParticipation: Math.round(avgKillParticipation * 100) / 100,
    avgDeaths: Math.round(avgDeaths * 100) / 100,
    winRate: Math.round(winRate * 10) / 10,
    belowAvgCsGames,
    lowKpGames,
    highDeathGames,
    mostPlayedChampions,
    primaryRole,
    recentForm: formParts.join(" "),
    deathTimingSamples,
    recurringFirstDeathWindow,
    recurringFirstDeathCount,
    recurringFirstDeathRate,
  };
}

export function buildCoachingPayload(
  match: MatchSummaryResponse,
  viewerPuuid: string,
  recentMatches: MatchSummaryResponse[],
  leagueEntry: LeagueEntry | null,
  timelineSignals?: TimelineCoachingSignals,
  learningObjectives?: string[],
): CoachingPayload {
  const gameDurationMinutes =
    match.durationSeconds > 0
      ? Math.round((match.durationSeconds / 60) * 10) / 10
      : 0;
  const csPerMin =
    gameDurationMinutes > 0
      ? Math.round((match.stats.cs / gameDurationMinutes) * 100) / 100
      : 0;

  const killParticipation =
    match.teamKills > 0
      ? Math.round(
          ((match.kda.kills + match.kda.assists) / match.teamKills) * 100 * 100,
        ) / 100
      : 0;

  const csVsOpponent = null;

  const csAt10 =
    timelineSignals?.csAt10 ??
    (typeof match.stats.csAt10 === "number" ? match.stats.csAt10 : null);
  const csAt20 =
    timelineSignals?.csAt20 ??
    (typeof match.stats.csAt20 === "number" ? match.stats.csAt20 : null);

  const deathTimestampsMinutes = timelineSignals?.deathTimestampsMinutes ?? [];
  const csDropAfterDeaths = timelineSignals?.csDropAfterDeaths ?? [];
  const biggestCsDropWindow = timelineSignals?.biggestCsDropWindow ?? null;
  const majorTeamfights = timelineSignals?.majorTeamfights ?? [];

  const history = buildHistoryStats(recentMatches, viewerPuuid);

  const contextTier = leagueEntry?.tier ?? "UNRANKED";
  const contextRank = leagueEntry?.rank ?? "";
  const contextLp = leagueEntry?.lp ?? 0;

  const payload: CoachingPayload = {
    game: {
      champion: match.champion,
      role:
        match.playerPosition ||
        match.playerRole ||
        history.primaryRole ||
        "UNKNOWN",
      win: match.result === "win",
      kills: match.kda.kills,
      deaths: match.kda.deaths,
      assists: match.kda.assists,
      csTotal: match.stats.cs,
      csPerMin,
      csAt10,
      csAt20,
      csVsOpponent,
      deathTimestampsMinutes,
      csDropAfterDeaths,
      biggestCsDropWindow,
      majorTeamfights,
      damageDealt:
        typeof (match as any).damageToChamps === "number"
          ? (match as any).damageToChamps
          : null,
      damageShare:
        typeof (match as any).damageShare === "number"
          ? (match as any).damageShare
          : null,
      damageTaken: null,
      goldEarned: match.stats.gold,
      goldDiff15: null,
      killParticipation,
      objectivesStolen: null,
      dragonKills: null,
      baronKills: null,
      firstBlood: null,
      gameDurationMinutes,
      gameMode: (match as any).gameMode || "UNKNOWN",
      items:
        Array.isArray((match as any).items) && (match as any).items.length > 0
          ? (match as any).items
          : null,
    },
    history,
    context: {
      tier: contextTier,
      rank: contextRank,
      lp: contextLp,
      summonerName: (match as any).summonerName || "Unknown",
    },
    ...(learningObjectives?.length && { learningObjectives }),
  };

  return payload;
}
