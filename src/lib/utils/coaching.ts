import type { MatchSummaryResponse } from "$lib/types";

export type LeagueEntry = {
  tier: string;
  rank: string;
  lp: number;
};

export type MatchHistoryStats = {
  avgCsPerMin: number;
  avgVisionScore: number;
  avgKillParticipation: number;
  avgDeaths: number;
  winRate: number;
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
  history: MatchHistoryStats;
  context: {
    tier: string;
    rank: string;
    lp: number; 
    summonerName: string;
  };
};

export function buildHistoryStats(matches: MatchSummaryResponse[], puuid: string): MatchHistoryStats {
  if (!matches?.length) {
    return {
      avgCsPerMin: 0,
      avgVisionScore: 0,
      avgKillParticipation: 0,
      avgDeaths: 0,
      winRate: 0,
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

  const championCounts: Record<string, number> = {};
  const roleCounts: Record<string, number> = {};
  const formParts: string[] = [];

  for (const match of historyList) {
    const durationMin = match.durationSeconds > 0 ? match.durationSeconds / 60 : 1;
    const csPerMin = match.stats.cs / durationMin;

    totalCsPerMin += csPerMin;
    totalVision += match.stats.visionScore;
    totalDeaths += match.kda.deaths;

    if (match.teamKills > 0) {
      totalKP += ((match.kda.kills + match.kda.assists) / match.teamKills) * 100;
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

  const mostPlayedChampions = Object.entries(championCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([champ]) => champ);

  const primaryRole = Object.entries(roleCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || "UNKNOWN";

  return {
    avgCsPerMin: Math.round(avgCsPerMin * 100) / 100,
    avgVisionScore: Math.round(avgVisionScore * 100) / 100,
    avgKillParticipation: Math.round(avgKillParticipation * 100) / 100,
    avgDeaths: Math.round(avgDeaths * 100) / 100,
    winRate: Math.round(winRate * 10) / 10,
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
  const gameDurationMinutes = match.durationSeconds > 0 ? Math.round((match.durationSeconds / 60) * 10) / 10 : 0;
  const csPerMin = gameDurationMinutes > 0 ? Math.round((match.stats.cs / gameDurationMinutes) * 100) / 100 : 0;

  const killParticipation = match.teamKills > 0
    ? Math.round((((match.kda.kills + match.kda.assists) / match.teamKills) * 100) * 100) / 100
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
      wardsPlaced: 0,
      wardsDestroyed: 0,
      damageDealt: 0,
      damageShare: 0,
      damageTaken: 0,
      goldEarned: match.stats.gold,
      goldDiff15: null,
      killParticipation,
      objectivesStolen: 0,
      dragonKills: 0,
      baronKills: 0,
      firstBlood: false,
      gameDurationMinutes,
      gameMode: (match as any).gameMode || "UNKNOWN",
      items: [],
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
