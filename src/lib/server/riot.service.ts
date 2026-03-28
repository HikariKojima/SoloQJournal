/**
 * This file contains the Riot API service functions for fetching League of Legends data.
 * It resides in src/lib/server/ because it's server-side only code that handles API calls with private keys.
 * In SvelteKit, server-only code goes in lib/server/ to prevent client-side exposure.
 * Key concept: Use $env/static/private for secrets at build-time; handle regional routing for Riot's API structure.
 * Example: getFullProfile fetches summoner and recent matches in parallel for efficient SSR.
 */

import { RIOT_API_KEY } from "$env/static/private";
import type {
  MatchDetailsResponse,
  MatchSummaryResponse,
  SummonerResponse,
} from "$lib/types";

// Riot API base URLs
const PLATFORM_BASES: Record<string, string> = {
  na1: "https://na1.api.riotgames.com",
  br1: "https://br1.api.riotgames.com",
  eun1: "https://eun1.api.riotgames.com",
  euw1: "https://euw1.api.riotgames.com",
  jp1: "https://jp1.api.riotgames.com",
  kr: "https://kr.api.riotgames.com",
  la1: "https://la1.api.riotgames.com",
  la2: "https://la2.api.riotgames.com",
  oc1: "https://oc1.api.riotgames.com",
  tr1: "https://tr1.api.riotgames.com",
  ru: "https://ru.api.riotgames.com",
  ph2: "https://ph2.api.riotgames.com",
  sg2: "https://sg2.api.riotgames.com",
  th2: "https://th2.api.riotgames.com",
  tw2: "https://tw2.api.riotgames.com",
  vn2: "https://vn2.api.riotgames.com",
};

function getAccountBase(platform: string): string {
  const region = getRegionalBase(platform);
  return `${region}/riot/account/v1`;
}

const API_KEY = RIOT_API_KEY;

if (!API_KEY) {
  throw new Error("RIOT_API_KEY not set");
}

function getRegionalBase(platform: string): string {
  if (["na1", "br1", "la1", "la2", "oc1"].includes(platform)) {
    return "https://americas.api.riotgames.com";
  }
  if (["eun1", "euw1", "tr1", "ru"].includes(platform)) {
    return "https://europe.api.riotgames.com";
  }
  if (["jp1", "kr", "ph2", "sg2", "th2", "tw2", "vn2"].includes(platform)) {
    return "https://asia.api.riotgames.com";
  }
  return "https://europe.api.riotgames.com"; // default
}

const SOLO_DUO_QUEUE_ID = 420;
const INTERNAL_BATCH_SIZE = 20;
const CURRENT_SEASON_START_MS = Date.UTC(new Date().getUTCFullYear(), 0, 1);

export type MatchFilters = {
  champion?: string;
  opponentChampion?: string;
};

export type FilteredMatchesPage = {
  matches: MatchSummaryResponse[];
  nextOffset: number;
  hasMore: boolean;
};

async function riotFetch(url: string): Promise<any> {
  const res = await fetch(url, {
    headers: {
      "X-Riot-Token": API_KEY,
    },
  });
  if (!res.ok) {
    throw new Error(`Riot API error: ${res.status} ${res.statusText}`);
  }
  return res.json();
}

function normalizeChampionFilter(value?: string | null): string {
  return (value ?? "").trim().toLowerCase();
}

function matchesFilters(
  summary: MatchSummaryResponse,
  filters: MatchFilters,
): boolean {
  const champion = normalizeChampionFilter(filters.champion);
  if (champion && summary.champion.toLowerCase() !== champion) {
    return false;
  }

  const opponentChampion = normalizeChampionFilter(filters.opponentChampion);
  if (
    opponentChampion &&
    (summary.laneOpponent?.champion ?? "").toLowerCase() !== opponentChampion
  ) {
    return false;
  }

  return true;
}

async function buildMatchSummary(
  region: string,
  puuid: string,
  matchId: string,
): Promise<MatchSummaryResponse | null> {
  const getPosition = (participant: any): string => {
    return (
      participant?.teamPosition ||
      participant?.individualPosition ||
      participant?.lane ||
      "UNKNOWN"
    );
  };

  const toContextParticipant = (participant: any) => {
    if (!participant) return null;
    return {
      champion: participant.championName,
      kills: participant.kills,
      deaths: participant.deaths,
      assists: participant.assists,
      position: getPosition(participant),
    };
  };

  const getTimelineCsAt = async (
    targetMatchId: string,
    participantId: number,
  ): Promise<{ csAt15?: number; csAt20?: number }> => {
    try {
      const regionalBase = getRegionalBase(region);
      const timelineUrl = `${regionalBase}/lol/match/v5/matches/${targetMatchId}/timeline`;
      const timeline = await riotFetch(timelineUrl);
      const frames = timeline?.info?.frames;
      if (!Array.isArray(frames) || frames.length === 0) {
        return {};
      }

      const readCsAtMinute = (minute: number): number | undefined => {
        const frame = frames[minute];
        if (!frame?.participantFrames) return undefined;

        const participantFrame =
          frame.participantFrames[String(participantId)] ??
          frame.participantFrames[participantId];
        if (!participantFrame) return undefined;

        const laneCs = Number(participantFrame.minionsKilled ?? 0);
        const jungleCs = Number(participantFrame.jungleMinionsKilled ?? 0);
        return laneCs + jungleCs;
      };

      return {
        csAt15: readCsAtMinute(15),
        csAt20: readCsAtMinute(20),
      };
    } catch (err) {
      console.error(`Failed to fetch timeline for match ${targetMatchId}:`, err);
      return {};
    }
  };

  const regionalBase = getRegionalBase(region);
  const url = `${regionalBase}/lol/match/v5/matches/${matchId}`;
  const data = await riotFetch(url);

  const participant = data.info.participants.find((p: any) => p.puuid === puuid);
  if (!participant) return null;

  const playerPosition = getPosition(participant);
  const teamId = participant.teamId;
  const teamParticipants = data.info.participants.filter(
    (p: any) => p.teamId === teamId,
  );
  const enemyParticipants = data.info.participants.filter(
    (p: any) => p.teamId !== teamId,
  );

  const allyJunglerParticipant =
    playerPosition === "JUNGLE"
      ? null
      : teamParticipants.find(
          (p: any) => p.puuid !== puuid && getPosition(p) === "JUNGLE",
        ) ?? null;
  const laneOpponentParticipant =
    enemyParticipants.find((p: any) => getPosition(p) === playerPosition) ??
    (playerPosition === "JUNGLE"
      ? enemyParticipants.find((p: any) => getPosition(p) === "JUNGLE")
      : null);
  const enemyJunglerParticipant =
    enemyParticipants.find((p: any) => getPosition(p) === "JUNGLE") ?? null;

  const teamKills = teamParticipants.reduce(
    (sum: number, p: any) => sum + p.kills,
    0,
  );
  const teamDeaths = teamParticipants.reduce(
    (sum: number, p: any) => sum + p.deaths,
    0,
  );

  const damageToChamps = participant.totalDamageDealtToChampions;
  const playedAt = data.info.gameEndTimestamp ?? data.info.gameStartTimestamp ?? null;

  const kda = {
    kills: participant.kills,
    deaths: participant.deaths,
    assists: participant.assists,
    ratio:
      participant.deaths > 0
        ? (participant.kills + participant.assists) / participant.deaths
        : null,
  };

  const timelineCs = await getTimelineCsAt(matchId, participant.participantId);

  return {
    matchId,
    champion: participant.championName,
    kda,
    result: participant.win ? "win" : "loss",
    durationSeconds: data.info.gameDuration,
    stats: {
      cs: participant.totalMinionsKilled + participant.neutralMinionsKilled,
      gold: participant.goldEarned,
      visionScore: participant.visionScore,
      csAt15: timelineCs.csAt15,
      csAt20: timelineCs.csAt20,
    },
    teamKills,
    teamDeaths,
    playerPosition,
    playerRole: participant.role || participant.lane || "UNKNOWN",
    allyJungler: toContextParticipant(allyJunglerParticipant),
    laneOpponent: toContextParticipant(laneOpponentParticipant),
    enemyJungler: toContextParticipant(enemyJunglerParticipant),
    damageToChamps,
    playedAt: typeof playedAt === "number" ? playedAt : undefined,
    queueId: data.info.queueId,
    items: [
      participant.item0,
      participant.item1,
      participant.item2,
      participant.item3,
      participant.item4,
      participant.item5,
      participant.item6,
    ].filter((id: number | null | undefined) => typeof id === "number" && id > 0),
    summonerSpells: {
      primary: participant.summoner1Id,
      secondary: participant.summoner2Id,
    },
  };
}

export async function getSummonerByRiotId(
  gameName: string,
  tagLine: string,
  platform: string = "euw1",
): Promise<{ puuid: string; gameName: string; tagLine: string }> {
  const accountBase = getAccountBase(platform);
  const url = `${accountBase}/accounts/by-riot-id/${encodeURIComponent(gameName)}/${encodeURIComponent(tagLine)}`;
  return riotFetch(url);
}

export async function getSummonerByPuuid(
  region: string,
  puuid: string,
): Promise<SummonerResponse> {
  const base = PLATFORM_BASES[region] || `https://${region}.api.riotgames.com`;
  const url = `${base}/lol/summoner/v4/summoners/by-puuid/${puuid}`;
  const data = await riotFetch(url);
  return {
    puuid: data.puuid,
    id: data.id,
    accountId: data.accountId,
    name: data.name,
    profileIconId: data.profileIconId,
    level: data.summonerLevel,
  };
}

export async function getMatchIds(
  region: string,
  puuid: string,
  start: number = 0,
  count: number = 10,
): Promise<string[]> {
  const regionalBase = getRegionalBase(region);
  const url = `${regionalBase}/lol/match/v5/matches/by-puuid/${puuid}/ids?start=${start}&count=${count}`;
  return riotFetch(url);
}

export async function getMatchDetails(
  region: string,
  matchId: string,
  puuid: string,
): Promise<MatchDetailsResponse> {
  const regionalBase = getRegionalBase(region);
  const url = `${regionalBase}/lol/match/v5/matches/${matchId}`;
  const data = await riotFetch(url);

  const participant = data.info.participants.find(
    (p: any) => p.puuid === puuid,
  );
  if (!participant) throw new Error("Participant not found");

  const kda = {
    kills: participant.kills,
    deaths: participant.deaths,
    assists: participant.assists,
    ratio:
      participant.deaths > 0
        ? (participant.kills + participant.assists) / participant.deaths
        : null,
  };

  return {
    matchId,
    gameDurationSeconds: data.info.gameDuration,
    region: data.info.platformId,
    champion: participant.championName,
    kda,
    result: participant.win ? "win" : "loss",
    stats: {
      cs: participant.totalMinionsKilled + participant.neutralMinionsKilled,
      gold: participant.goldEarned,
      visionScore: participant.visionScore,
    },
    matchInfo: {
      queueId: data.info.queueId,
      gameMode: data.info.gameMode,
    },
  };
}

export async function getMatchSummaries(
  region: string,
  puuid: string,
  start: number = 0,
  count: number = 10,
): Promise<MatchSummaryResponse[]> {
  const page = await getFilteredMatchPage(region, puuid, start, count, {});
  return page.matches;
}

export async function getFilteredMatchPage(
  region: string,
  puuid: string,
  start: number = 0,
  count: number = 10,
  filters: MatchFilters = {},
): Promise<FilteredMatchesPage> {
  const summaries: MatchSummaryResponse[] = [];
  let cursor = start;
  let exhausted = false;
  let reachedSeasonBoundary = false;

  while (!exhausted && !reachedSeasonBoundary && summaries.length < count) {
    const matchIds = await getMatchIds(region, puuid, cursor, INTERNAL_BATCH_SIZE);
    if (!matchIds.length) {
      exhausted = true;
      break;
    }

    cursor += matchIds.length;

    for (const matchId of matchIds) {
      try {
        const summary = await buildMatchSummary(region, puuid, matchId);
        if (!summary) {
          continue;
        }

        if ((summary.playedAt ?? 0) < CURRENT_SEASON_START_MS) {
          reachedSeasonBoundary = true;
          break;
        }

        if (summary.queueId !== SOLO_DUO_QUEUE_ID) {
          continue;
        }

        if (!matchesFilters(summary, filters)) {
          continue;
        }

        summaries.push(summary);
        if (summaries.length >= count) {
          break;
        }
      } catch (err) {
        console.error(`Failed to fetch match ${matchId}:`, err);
      }
    }

    if (matchIds.length < INTERNAL_BATCH_SIZE) {
      exhausted = true;
    }
  }

  return {
    matches: summaries,
    nextOffset: cursor,
    hasMore: !exhausted && !reachedSeasonBoundary,
  };
}

export async function getAllFilteredMatchesForSeason(
  region: string,
  puuid: string,
  filters: MatchFilters = {},
  maxMatches: number = 400,
): Promise<MatchSummaryResponse[]> {
  const allMatches: MatchSummaryResponse[] = [];
  let cursor = 0;
  let hasMore = true;

  while (hasMore && allMatches.length < maxMatches) {
    const page = await getFilteredMatchPage(region, puuid, cursor, 25, filters);
    allMatches.push(...page.matches);

    if (!page.hasMore || page.nextOffset <= cursor) {
      hasMore = false;
    } else {
      cursor = page.nextOffset;
    }
  }

  return allMatches.slice(0, maxMatches);
}

export async function getFullProfile(
  gameName: string,
  tagLine: string,
  platform: string = "euw1",
): Promise<{ summoner: SummonerResponse; matches: MatchSummaryResponse[] }> {
  const account = await getSummonerByRiotId(gameName, tagLine, platform);
  const region = platform;
  const summoner = await getSummonerByPuuid(region, account.puuid);
  const matches = await getMatchSummaries(region, account.puuid, 0, 10);
  return { summoner, matches };
}
