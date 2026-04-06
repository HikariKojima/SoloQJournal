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
  RankedSoloEntry,
  SummonerResponse,
} from "$lib/types";

// ===== CACHING LAYER =====
type CacheEntry<T> = {
  data: T;
  expiresAt: number;
};

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const apiCache = new Map<string, CacheEntry<any>>();
const timelineCache = new Map<string, CacheEntry<any>>();

function getCacheKey(...parts: string[]): string {
  return parts.join("::");
}

function getCached<T>(cache: Map<string, CacheEntry<T>>, key: string): T | null {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    cache.delete(key);
    return null;
  }
  return entry.data;
}

function setCached<T>(cache: Map<string, CacheEntry<T>>, key: string, data: T): void {
  cache.set(key, {
    data,
    expiresAt: Date.now() + CACHE_TTL_MS,
  });
}

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
const INTERNAL_BATCH_SIZE = 10;
const CURRENT_SEASON_START_MS = Date.UTC(new Date().getUTCFullYear(), 0, 1);

// ===== RATE LIMITING (Personal/Dev Key: 20 req/1s, 100 req/2m per region) =====
type RateLimitBucket = {
  tokens: number;
  lastRefillMs: number;
};

const RATE_LIMIT_CONFIG = {
  PER_SECOND: { tokens: 20, windowMs: 1000 },
  PER_TWO_MIN: { tokens: 100, windowMs: 120 * 1000 },
};

const rateLimitBuckets = new Map<string, Map<string, RateLimitBucket>>();

function getRegionLimitKey(region: string): string {
  const regionalBase = getRegionalBase(region);
  // Extract region identifier (americas, europe, asia)
  if (regionalBase.includes("americas")) return "americas";
  if (regionalBase.includes("europe")) return "europe";
  if (regionalBase.includes("asia")) return "asia";
  return region;
}

function initializeBucketsForRegion(region: string): void {
  const limitKey = getRegionLimitKey(region);
  if (!rateLimitBuckets.has(limitKey)) {
    rateLimitBuckets.set(
      limitKey,
      new Map([
        ["perSecond", { tokens: RATE_LIMIT_CONFIG.PER_SECOND.tokens, lastRefillMs: Date.now() }],
        ["perTwoMin", { tokens: RATE_LIMIT_CONFIG.PER_TWO_MIN.tokens, lastRefillMs: Date.now() }],
      ]),
    );
  }
}

function refillBucket(bucket: RateLimitBucket, config: { tokens: number; windowMs: number }): void {
  const now = Date.now();
  const elapsed = now - bucket.lastRefillMs;
  const refillAmount = (elapsed / config.windowMs) * config.tokens;
  bucket.tokens = Math.min(config.tokens, bucket.tokens + refillAmount);
  bucket.lastRefillMs = now;
}

async function waitForRateLimit(region: string): Promise<void> {
  initializeBucketsForRegion(region);
  const limitKey = getRegionLimitKey(region);
  const buckets = rateLimitBuckets.get(limitKey)!;

  // Check both rate limits
  const perSecBucket = buckets.get("perSecond")!;
  const perTwoMinBucket = buckets.get("perTwoMin")!;

  refillBucket(perSecBucket, RATE_LIMIT_CONFIG.PER_SECOND);
  refillBucket(perTwoMinBucket, RATE_LIMIT_CONFIG.PER_TWO_MIN);

  // Wait until both buckets have tokens available
  let waitMs = 0;
  while (perSecBucket.tokens < 1 || perTwoMinBucket.tokens < 1) {
    waitMs = Math.min(
      perSecBucket.tokens < 1 ? RATE_LIMIT_CONFIG.PER_SECOND.windowMs / RATE_LIMIT_CONFIG.PER_SECOND.tokens : Infinity,
      perTwoMinBucket.tokens < 1 ? RATE_LIMIT_CONFIG.PER_TWO_MIN.windowMs / RATE_LIMIT_CONFIG.PER_TWO_MIN.tokens : Infinity,
    );

    if (waitMs > 0 && isFinite(waitMs)) {
      await new Promise((resolve) => setTimeout(resolve, waitMs));
    }

    refillBucket(perSecBucket, RATE_LIMIT_CONFIG.PER_SECOND);
    refillBucket(perTwoMinBucket, RATE_LIMIT_CONFIG.PER_TWO_MIN);
  }

  // Consume tokens
  perSecBucket.tokens -= 1;
  perTwoMinBucket.tokens -= 1;
}

export type MatchFilters = {
  champion?: string;
  opponentChampion?: string;
};

export type FilteredMatchesPage = {
  matches: MatchSummaryResponse[];
  nextOffset: number;
  hasMore: boolean;
};

async function riotFetch(
  url: string,
  useCache: boolean = true,
  maxRetries: number = 1,
): Promise<any> {
  // Check cache first (skip for mutations)
  if (useCache) {
    const cached = getCached(apiCache, url);
    if (cached) {
      return cached;
    }
  }

  // Extract region from URL for rate limiting
  let region = "euw1"; // default
  if (url.includes("americas")) region = "na1";
  else if (url.includes("europe")) region = "euw1";
  else if (url.includes("asia")) region = "kr";

  // Wait for rate limit clearance before attempting request
  await waitForRateLimit(region);

  let lastError: Error | null = null;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const res = await fetch(url, {
        headers: {
          "X-Riot-Token": API_KEY,
        },
      });

      if (res.status === 429) {
        // Rate limited - check Retry-After header
        const retryAfter = res.headers.get("Retry-After");
        const waitTime = retryAfter ? parseInt(retryAfter, 10) * 1000 : 1000;

        if (attempt < maxRetries) {
          await new Promise((resolve) => setTimeout(resolve, waitTime));
          continue; // Retry
        } else {
          throw new Error("Riot API rate limit exceeded (429).");
        }
      }

      if (!res.ok) {
        throw new Error(`Riot API error: ${res.status} ${res.statusText}`);
      }

      const data = await res.json();

      // Cache successful responses
      if (useCache) {
        setCached(apiCache, url, data);
      }

      return data;
    } catch (err) {
      lastError = err as Error;
      // If it's the last retry, throw; otherwise continue
      if (attempt < maxRetries) {
        continue;
      }
    }
  }

  throw lastError || new Error("Riot API request failed");
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

async function getTimelineCsAt(
  region: string,
  targetMatchId: string,
  participantId: number,
): Promise<{ csAt10?: number; csAt20?: number }> {
  try {
    // Check timeline cache first
    const cacheKey = getCacheKey(
      "timeline",
      region,
      targetMatchId,
      String(participantId),
    );
    const cached = getCached(timelineCache, cacheKey);
    if (cached) return cached;

    const regionalBase = getRegionalBase(region);
    const timelineUrl = `${regionalBase}/lol/match/v5/matches/${targetMatchId}/timeline`;
    const timeline = await riotFetch(timelineUrl, false); // Don't use API cache for timeline
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

    const timelineCs = {
      csAt10: readCsAtMinute(10),
      csAt20: readCsAtMinute(20),
    };

    setCached(timelineCache, cacheKey, timelineCs);
    return timelineCs;
  } catch {
    return {};
  }
}

async function buildMatchSummary(
  region: string,
  puuid: string,
  matchId: string,
  includeTimeline: boolean = false,
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

  const regionalBase = getRegionalBase(region);
  const url = `${regionalBase}/lol/match/v5/matches/${matchId}`;
  const data = await riotFetch(url, true);

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

  // Only fetch timeline if explicitly requested (expensive operation)
  let timelineCs: { csAt10?: number; csAt20?: number } = {};
  if (includeTimeline) {
    timelineCs = await getTimelineCsAt(region, matchId, participant.participantId);
  }

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
      csAt10: timelineCs.csAt10,
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
  return riotFetch(url, true);
}

export async function getSummonerByPuuid(
  region: string,
  puuid: string,
): Promise<SummonerResponse> {
  const base = PLATFORM_BASES[region] || `https://${region}.api.riotgames.com`;
  const url = `${base}/lol/summoner/v4/summoners/by-puuid/${puuid}`;
  const data = await riotFetch(url, true);
  return {
    puuid: data.puuid,
    id: data.id,
    accountId: data.accountId,
    name: data.name,
    profileIconId: data.profileIconId,
    level: data.summonerLevel,
  };
}

export async function getRankedSoloEntry(
  region: string,
  summonerId: string,
  puuid?: string,
): Promise<RankedSoloEntry | null> {
  const normalizedSummonerId = summonerId?.trim() ?? "";
  const normalizedPuuid = puuid?.trim() ?? "";
  if (!normalizedSummonerId && !normalizedPuuid) return null;

  const base = PLATFORM_BASES[region] || `https://${region}.api.riotgames.com`;

  const parseSoloEntry = (data: unknown): RankedSoloEntry | null => {
    if (!Array.isArray(data)) return null;

    // Riot docs: queueType for Solo/Duo is RANKED_SOLO_5x5.
    const soloEntry = data.find(
      (entry: any) => entry?.queueType === "RANKED_SOLO_5x5",
    );

    if (!soloEntry) return null;

    return {
      tier: String(soloEntry.tier ?? "UNRANKED").toUpperCase(),
      rank: String(soloEntry.rank ?? "").toUpperCase(),
      lp:
        typeof soloEntry.leaguePoints === "number"
          ? soloEntry.leaguePoints
          : 0,
      wins: typeof soloEntry.wins === "number" ? soloEntry.wins : 0,
      losses: typeof soloEntry.losses === "number" ? soloEntry.losses : 0,
    };
  };

  const tryRankLookup = async (
    source: "by-summoner" | "by-puuid",
    idValue: string,
  ): Promise<RankedSoloEntry | null> => {
    const url =
      source === "by-summoner"
        ? `${base}/lol/league/v4/entries/by-summoner/${encodeURIComponent(idValue)}`
        : `${base}/lol/league/v4/entries/by-puuid/${encodeURIComponent(idValue)}`;

    try {
      const rawData = await riotFetch(url, true);
      return parseSoloEntry(rawData);
    } catch (err: any) {
      return null;
    }
  };

  try {
    if (normalizedSummonerId) {
      const bySummonerResult = await tryRankLookup(
        "by-summoner",
        normalizedSummonerId,
      );
      if (bySummonerResult) return bySummonerResult;
    }

    if (normalizedPuuid) {
      const byPuuidResult = await tryRankLookup("by-puuid", normalizedPuuid);
      if (byPuuidResult) return byPuuidResult;
    }

    return null;
  } catch (err) {
    return null;
  }
}

export async function getMatchIds(
  region: string,
  puuid: string,
  start: number = 0,
  count: number = 10,
): Promise<string[]> {
  const regionalBase = getRegionalBase(region);
  const url = `${regionalBase}/lol/match/v5/matches/by-puuid/${puuid}/ids?start=${start}&count=${count}`;
  return riotFetch(url, true);
}

export async function getMatchDetails(
  region: string,
  matchId: string,
  puuid: string,
  includeTimeline: boolean = false,
): Promise<MatchDetailsResponse> {
  const regionalBase = getRegionalBase(region);
  const url = `${regionalBase}/lol/match/v5/matches/${matchId}`;
  const data = await riotFetch(url, true);

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

  let timelineCs: { csAt10?: number; csAt20?: number } = {};
  if (includeTimeline) {
    timelineCs = await getTimelineCsAt(region, matchId, participant.participantId);
  }

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
      csAt10: timelineCs.csAt10,
      csAt20: timelineCs.csAt20,
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
  const effectiveBatchSize = Math.max(1, Math.min(INTERNAL_BATCH_SIZE, count));

  while (!exhausted && !reachedSeasonBoundary && summaries.length < count) {
    const matchIds = await getMatchIds(region, puuid, cursor, effectiveBatchSize);
    if (!matchIds.length) {
      exhausted = true;
      break;
    }

    cursor += matchIds.length;

    // Fetch all matches in parallel instead of sequentially
    const summaryPromises = matchIds.map((matchId) =>
      buildMatchSummary(region, puuid, matchId, false).catch(() => {
        return null;
      })
    );

    const batchSummaries = await Promise.all(summaryPromises);

    for (const summary of batchSummaries) {
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
    }

    if (matchIds.length < effectiveBatchSize) {
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
  let isFirstPage = true;

  while (hasMore && allMatches.length < maxMatches) {
    // Add small delay between pages to avoid overwhelming rate limit during enrichment scan
    if (!isFirstPage) {
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    isFirstPage = false;

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
  options?: {
    includeRankedSolo?: boolean;
  },
): Promise<{
  summoner: SummonerResponse;
  matches: MatchSummaryResponse[];
  rankedSolo?: RankedSoloEntry | null;
}> {
  const includeRankedSolo = options?.includeRankedSolo ?? false;
  const account = await getSummonerByRiotId(gameName, tagLine, platform);
  const region = platform;
  const summoner = await getSummonerByPuuid(region, account.puuid);

  const matches = await getMatchSummaries(region, account.puuid, 0, 10);

  if (!includeRankedSolo) {
    return { summoner, matches };
  }

  const rankedSolo = await getRankedSoloEntry(region, summoner.id, account.puuid);
  return { summoner, matches, rankedSolo };
}
