import type { MatchSummaryResponse } from "$lib/types";

export type LeagueEntry = {
  tier: string;
  rank: string;
  lp: number;
};

export type MatchHistoryStats = {
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
  history: MatchHistoryStats;
  context: {
    tier: string;
    rank: string;
    lp: number;
    summonerName: string;
  };
};

export function buildHistoryStats(
  matches: MatchSummaryResponse[],
  puuid: string,
): MatchHistoryStats {
  if (!matches?.length) {
    return {
      sampleSize: 0,
      avgCsPerMin: 0,
      avgVisionScore: 0,
      avgKillParticipation: 0,
      avgDeaths: 0,
      winRate: 0,
      belowAvgCsGames: 0,
      lowVisionGames: 0,
      lowKpGames: 0,
      highDeathGames: 0,
      mostPlayedChampions: [],
      primaryRole: "UNKNOWN",
      recentForm: "",
    };
  }

  const historyList = matches.slice(0, 10);
  let totalCsPerMin = 0;
  let totalVision = 0;
  let totalKP = 0;
  let totalDeaths = 0;
  let wins = 0;

  const csPerMinValues: number[] = [];
  const visionValues: number[] = [];
  const kpValues: number[] = [];
  const deathValues: number[] = [];

  const championCounts: Record<string, number> = {};
  const roleCounts: Record<string, number> = {};
  const formParts: string[] = [];

  for (const match of historyList) {
    const durationMin =
      match.durationSeconds > 0 ? match.durationSeconds / 60 : 1;
    const csPerMin = match.stats.cs / durationMin;
    csPerMinValues.push(csPerMin);
    visionValues.push(match.stats.visionScore);
    deathValues.push(match.kda.deaths);

    totalCsPerMin += csPerMin;
    totalVision += match.stats.visionScore;
    totalDeaths += match.kda.deaths;

    if (match.teamKills > 0) {
      const kp = ((match.kda.kills + match.kda.assists) / match.teamKills) * 100;
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
    const role = (match as any).role || "UNKNOWN";
    roleCounts[role] = (roleCounts[role] || 0) + 1;
  }

  const avgCsPerMin = totalCsPerMin / historyList.length;
  const avgVisionScore = totalVision / historyList.length;
  const avgKillParticipation = totalKP / historyList.length;
  const avgDeaths = totalDeaths / historyList.length;
  const winRate = (wins / historyList.length) * 100;

  const belowAvgCsGames = csPerMinValues.filter(
    (value) => value < avgCsPerMin - 0.5,
  ).length;
  const lowVisionGames = visionValues.filter(
    (value) => value < avgVisionScore - 5,
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

  return {
    sampleSize: historyList.length,
    avgCsPerMin: Math.round(avgCsPerMin * 100) / 100,
    avgVisionScore: Math.round(avgVisionScore * 100) / 100,
    avgKillParticipation: Math.round(avgKillParticipation * 100) / 100,
    avgDeaths: Math.round(avgDeaths * 100) / 100,
    winRate: Math.round(winRate * 10) / 10,
    belowAvgCsGames,
    lowVisionGames,
    lowKpGames,
    highDeathGames,
    mostPlayedChampions,
    primaryRole,
    recentForm: formParts.join(" "),
  };
}

export function buildCoachingPayload(
  match: MatchSummaryResponse,
  viewerPuuid: string,
  recentMatches: MatchSummaryResponse[],
  leagueEntry: LeagueEntry | null,
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

  const history = buildHistoryStats(recentMatches, viewerPuuid);

  const contextTier = leagueEntry?.tier ?? "UNRANKED";
  const contextRank = leagueEntry?.rank ?? "";
  const contextLp = leagueEntry?.lp ?? 0;

  const payload: CoachingPayload = {
    game: {
      champion: match.champion,
      role: (match as any).role || history.primaryRole || "UNKNOWN",
      win: match.result === "win",
      kills: match.kda.kills,
      deaths: match.kda.deaths,
      assists: match.kda.assists,
      csTotal: match.stats.cs,
      csPerMin,
      csVsOpponent,
      visionScore: match.stats.visionScore,
      wardsPlaced: null,
      wardsDestroyed: null,
      damageDealt:
        typeof (match as any).damageToChamps === "number"
          ? (match as any).damageToChamps
          : null,
      damageShare: null,
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
  };

  return payload;
}
