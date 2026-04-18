/**
 * This file contains the Riot API service functions for fetching League of Legends data.
 * It resides in src/lib/server/ because it's server-side only code that handles API calls with private keys.
 * In SvelteKit, server-only code goes in lib/server/ to prevent client-side exposure.
 * Key concept: Use $env/static/private for secrets at build-time; handle regional routing for Riot's API structure.
 * Example: getFullProfile fetches summoner and recent matches in parallel for efficient SSR.
 */

import { RIOT_API_KEY } from "$env/static/private";
import type {
  MatchTimelineInsights,
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

function getCached<T>(
  cache: Map<string, CacheEntry<T>>,
  key: string,
): T | null {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    cache.delete(key);
    return null;
  }
  return entry.data;
}

function setCached<T>(
  cache: Map<string, CacheEntry<T>>,
  key: string,
  data: T,
): void {
  cache.set(key, {
    data,
    expiresAt: Date.now() + CACHE_TTL_MS,
  });
}

// Riot API base URLs
const PLATFORM_BASES: Record<string, string> = {
  na1: "https://na1.api.riotgames.com",
  br1: "https://br1.api.riotgames.com",
  sa1: "https://sa1.api.riotgames.com",
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
  const region = getAccountRegionalBase(platform);
  return `${region}/riot/account/v1`;
}

const API_KEY = RIOT_API_KEY;

if (!API_KEY) {
  throw new Error("RIOT_API_KEY not set");
}

function getRegionalBase(platform: string): string {
  if (["na1", "br1", "la1", "la2", "sa1"].includes(platform)) {
    return "https://americas.api.riotgames.com";
  }
  if (["eun1", "euw1", "tr1", "ru"].includes(platform)) {
    return "https://europe.api.riotgames.com";
  }
  if (["jp1", "kr"].includes(platform)) {
    return "https://asia.api.riotgames.com";
  }
  if (["oc1", "ph2", "sg2", "th2", "tw2", "vn2"].includes(platform)) {
    return "https://sea.api.riotgames.com";
  }
  return "https://europe.api.riotgames.com"; // default
}

function getAccountRegionalBase(platform: string): string {
  // ACCOUNT-V1 supports americas, asia, and europe routing values.
  if (["na1", "br1", "la1", "la2", "sa1"].includes(platform)) {
    return "https://americas.api.riotgames.com";
  }
  if (["eun1", "euw1", "tr1", "ru"].includes(platform)) {
    return "https://europe.api.riotgames.com";
  }
  if (
    ["jp1", "kr", "oc1", "ph2", "sg2", "th2", "tw2", "vn2"].includes(platform)
  ) {
    return "https://asia.api.riotgames.com";
  }
  return "https://europe.api.riotgames.com";
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
  // Extract region identifier (americas, europe, asia, sea)
  if (regionalBase.includes("americas")) return "americas";
  if (regionalBase.includes("europe")) return "europe";
  if (regionalBase.includes("asia")) return "asia";
  if (regionalBase.includes("sea")) return "sea";
  return region;
}

function initializeBucketsForRegion(region: string): void {
  const limitKey = getRegionLimitKey(region);
  if (!rateLimitBuckets.has(limitKey)) {
    rateLimitBuckets.set(
      limitKey,
      new Map([
        [
          "perSecond",
          {
            tokens: RATE_LIMIT_CONFIG.PER_SECOND.tokens,
            lastRefillMs: Date.now(),
          },
        ],
        [
          "perTwoMin",
          {
            tokens: RATE_LIMIT_CONFIG.PER_TWO_MIN.tokens,
            lastRefillMs: Date.now(),
          },
        ],
      ]),
    );
  }
}

function refillBucket(
  bucket: RateLimitBucket,
  config: { tokens: number; windowMs: number },
): void {
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
      perSecBucket.tokens < 1
        ? RATE_LIMIT_CONFIG.PER_SECOND.windowMs /
            RATE_LIMIT_CONFIG.PER_SECOND.tokens
        : Infinity,
      perTwoMinBucket.tokens < 1
        ? RATE_LIMIT_CONFIG.PER_TWO_MIN.windowMs /
            RATE_LIMIT_CONFIG.PER_TWO_MIN.tokens
        : Infinity,
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
  maxRetries: number = 3,
): Promise<any> {
  const isProfileRequest =
    url.includes("/riot/account/v1/accounts/by-riot-id/") ||
    url.includes("/lol/summoner/v4/summoners/by-puuid/");

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
  else if (url.includes("sea")) region = "oc1";

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
        const retryAfterSeconds = retryAfter
          ? Number.parseInt(retryAfter, 10)
          : NaN;
        const waitTime =
          Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0
            ? retryAfterSeconds * 1000
            : 1100;

        if (isProfileRequest) {
          console.warn("[RIOT][PROFILE][RATE_LIMIT] 429 received", {
            attempt: attempt + 1,
            maxAttempts: maxRetries + 1,
            waitMs: waitTime,
            hasRetryAfter: Boolean(retryAfter),
            appLimit: res.headers.get("X-App-Rate-Limit"),
            appLimitCount: res.headers.get("X-App-Rate-Limit-Count"),
            methodLimit: res.headers.get("X-Method-Rate-Limit"),
            methodLimitCount: res.headers.get("X-Method-Rate-Limit-Count"),
          });
        }

        if (attempt < maxRetries) {
          await new Promise((resolve) => setTimeout(resolve, waitTime));
          if (isProfileRequest) {
            console.warn("[RIOT][PROFILE][RATE_LIMIT] Retrying after wait", {
              nextAttempt: attempt + 2,
            });
          }
          continue; // Retry
        } else {
          if (isProfileRequest) {
            console.error("[RIOT][PROFILE][RATE_LIMIT] Retries exhausted");
          }
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
  const timelineInsights = await getTimelineInsights(
    region,
    targetMatchId,
    participantId,
  );

  return {
    csAt10: timelineInsights.csAt10,
    csAt20: timelineInsights.csAt20,
  };
}

function roundTo(value: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function formatMinutesSeconds(decimalMinutes: number): string {
  const totalSeconds = Math.round(decimalMinutes * 60);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

function getMapZone(position?: { x?: number; y?: number }): string {
  const x = Number(position?.x ?? NaN);
  const y = Number(position?.y ?? NaN);
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    return "unknown";
  }

  // Simple map buckets to keep teamfight locations readable in coaching output.
  if (x < 4500 && y < 4500) return "blue base side";
  if (x > 11000 && y > 11000) return "red base side";
  if (x > 9000 && y < 7200) return "bot side river";
  if (x < 7200 && y > 9000) return "top side river";
  if (Math.abs(x - y) < 1500 && x > 4500 && x < 10500) return "mid lane/river";
  if (x < y) return "blue-side jungle";
  return "red-side jungle";
}

type ObjectiveEvent = {
  timestamp: number;
  type: "dragon" | "baron" | "grubs" | "herald";
  teamId: number; // 100 = blue, 200 = red
};

function extractObjectiveEvents(frames: any[]): ObjectiveEvent[] {
  const objectives: ObjectiveEvent[] = [];

  for (const frame of frames) {
    const events = Array.isArray(frame?.events) ? frame.events : [];
    for (const event of events) {
      if (event?.type === "DRAGON_KILL") {
        objectives.push({
          timestamp: Number(event?.timestamp),
          type: "dragon",
          teamId: Number(event?.killerTeamId ?? 0),
        });
      } else if (event?.type === "BARON_KILL") {
        objectives.push({
          timestamp: Number(event?.timestamp),
          type: "baron",
          teamId: Number(event?.killerTeamId ?? 0),
        });
      } else if (event?.type === "RIFT_HERALD_KILL") {
        objectives.push({
          timestamp: Number(event?.timestamp),
          type: "herald",
          teamId: Number(event?.killerTeamId ?? 0),
        });
      } else if (event?.type === "GRUBS_KILL") {
        objectives.push({
          timestamp: Number(event?.timestamp),
          type: "grubs",
          teamId: Number(event?.killerTeamId ?? 0),
        });
      }
    }
  }

  return objectives;
}

function computeObjectiveWindows(objectives: ObjectiveEvent[]): Array<{
  minute: number;
  type: "early" | "dragon" | "grubs" | "baron" | "herald";
}> {
  const windows: Array<{
    minute: number;
    type: "early" | "dragon" | "grubs" | "baron" | "herald";
  }> = [];

  // Fixed anchors (Season 16 timings)
  windows.push({ minute: 3, type: "early" });
  windows.push({ minute: 8, type: "grubs" });
  windows.push({ minute: 10, type: "herald" });
  windows.push({ minute: 20, type: "baron" });

  // Dragon spawns at 5:00, then every 5 minutes if secured
  let nextDragonMinute = 5;
  for (const obj of objectives) {
    if (obj.type === "dragon") {
      const dragonMinute = obj.timestamp / 60000;
      if (dragonMinute >= nextDragonMinute - 1) {
        // Within ~1 min of spawn window
        windows.push({ minute: dragonMinute, type: "dragon" });
        nextDragonMinute = dragonMinute + 5;
      }
    }
  }

  return windows.sort((a, b) => a.minute - b.minute);
}

function findNearestObjective(
  fightMinute: number,
  windows: Array<{
    minute: number;
    type: "early" | "dragon" | "grubs" | "baron" | "herald";
  }>,
): {
  objectiveType: "early" | "dragon" | "grubs" | "baron" | "herald";
  objectiveMinute: number;
} | null {
  const TOLERANCE = 1.5; // ±90 seconds

  let nearest = null;
  let nearestDistance = Infinity;

  for (const window of windows) {
    const distance = Math.abs(fightMinute - window.minute);
    if (distance <= TOLERANCE && distance < nearestDistance) {
      nearestDistance = distance;
      nearest = window;
    }
  }

  return nearest
    ? { objectiveType: nearest.type, objectiveMinute: nearest.minute }
    : null;
}

function buildMajorTeamfights(
  frames: any[],
  participantId: number,
): MatchTimelineInsights["majorTeamfights"] {
  type KillEvent = {
    timestamp: number;
    killerId: number;
    victimId: number;
    assistingParticipantIds: number[];
    position?: { x?: number; y?: number };
  };

  const killEvents: KillEvent[] = [];
  for (const frame of frames) {
    const events = Array.isArray(frame?.events) ? frame.events : [];
    for (const event of events) {
      if (event?.type !== "CHAMPION_KILL") continue;
      const timestamp = Number(event?.timestamp);
      if (!Number.isFinite(timestamp)) continue;

      killEvents.push({
        timestamp,
        killerId: Number(event?.killerId ?? 0),
        victimId: Number(event?.victimId ?? 0),
        assistingParticipantIds: Array.isArray(event?.assistingParticipantIds)
          ? event.assistingParticipantIds
              .map((id: unknown) => Number(id))
              .filter((id: number) => Number.isFinite(id))
          : [],
        position: event?.position,
      });
    }
  }

  if (!killEvents.length) {
    return [];
  }

  // Extract objective events and compute windows for tagging
  const objectives = extractObjectiveEvents(frames);
  const objectiveWindows = computeObjectiveWindows(objectives);

  killEvents.sort((a, b) => a.timestamp - b.timestamp);
  const clusters: KillEvent[][] = [];

  for (const event of killEvents) {
    const lastCluster = clusters[clusters.length - 1];
    if (!lastCluster) {
      clusters.push([event]);
      continue;
    }

    const previous = lastCluster[lastCluster.length - 1];
    const withinWindow = event.timestamp - previous.timestamp <= 20_000;
    if (withinWindow) {
      lastCluster.push(event);
    } else {
      clusters.push([event]);
    }
  }

  // Determine which team the player is on (1-5 = team A, 6-10 = team B)
  const playerTeamIsA = participantId <= 5;

  return clusters
    .filter((cluster) => cluster.length >= 3)
    .map((cluster) => {
      // Count unique champions per team to validate thresholds
      const teamAChampions = new Set<number>();
      const teamBChampions = new Set<number>();

      for (const event of cluster) {
        // Killer and victim always present
        if (event.killerId <= 5) {
          teamAChampions.add(event.killerId);
        } else {
          teamBChampions.add(event.killerId);
        }

        if (event.victimId <= 5) {
          teamAChampions.add(event.victimId);
        } else {
          teamBChampions.add(event.victimId);
        }

        // Assisters
        for (const assisterId of event.assistingParticipantIds) {
          if (assisterId <= 5) {
            teamAChampions.add(assisterId);
          } else {
            teamBChampions.add(assisterId);
          }
        }
      }

      // Require at least 3 participants from each team to treat this as a major fight.
      const playerTeam = playerTeamIsA ? teamAChampions : teamBChampions;
      const enemyTeam = playerTeamIsA ? teamBChampions : teamAChampions;

      if (playerTeam.size < 3 || enemyTeam.size < 3) {
        return null; // Filter out this cluster
      }

      const enemyKillEvents = cluster.filter((event) => {
        const victimOnTeamA = event.victimId <= 5;
        return playerTeamIsA ? !victimOnTeamA : victimOnTeamA;
      }).length;

      const firstTs = cluster[0].timestamp;
      const lastTs = cluster[cluster.length - 1].timestamp;

      const mapZoneVotes = new Map<string, number>();
      let playerTakedowns = 0;
      let playerDeaths = 0;
      let playerInvolved = false;

      for (const event of cluster) {
        const zone = getMapZone(event.position);
        mapZoneVotes.set(zone, (mapZoneVotes.get(zone) ?? 0) + 1);

        const assisted = event.assistingParticipantIds.includes(participantId);
        const killed = event.killerId === participantId;
        const died = event.victimId === participantId;

        if (killed || assisted || died) {
          playerInvolved = true;
        }
        if (killed || assisted) {
          playerTakedowns += 1;
        }
        if (died) {
          playerDeaths += 1;
        }
      }

      const mapZone =
        Array.from(mapZoneVotes.entries()).sort(
          (a, b) => b[1] - a[1],
        )[0]?.[0] ?? "unknown";

      const fightStartMinute = roundTo(firstTs / 60000, 1);
      const objectiveContext = findNearestObjective(
        fightStartMinute,
        objectiveWindows,
      );

      const result: MatchTimelineInsights["majorTeamfights"][number] = {
        startMinute: fightStartMinute,
        endMinute: roundTo(lastTs / 60000, 1),
        killEvents: enemyKillEvents,
        mapZone,
        playerInvolved,
        playerTakedowns,
        playerDeaths,
      };

      if (objectiveContext) {
        // Find which team secured the objective
        const playerTeamId = playerTeamIsA ? 100 : 200;
        let teamSecured = false;
        for (const obj of objectives) {
          const objMinute = roundTo(obj.timestamp / 60000, 1);
          if (Math.abs(objMinute - objectiveContext.objectiveMinute) < 0.1) {
            teamSecured = obj.teamId === playerTeamId;
            break;
          }
        }

        result.objectiveContext = {
          objectiveType: objectiveContext.objectiveType,
          objectiveMinute: objectiveContext.objectiveMinute,
          teamSecuredIt: teamSecured,
        };
      }

      return result;
    })
    .filter((fight) => fight !== null);
}

function buildCsDropAfterDeath(
  frames: any[],
  deathTimestampsMs: number[],
  participantId: number,
) {
  const lastMinute = Math.max(0, frames.length - 1);

  const readTotalCsAtMinute = (minute: number): number | null => {
    const frame = frames[minute];
    if (!frame?.participantFrames) return null;

    const participantFrame =
      frame.participantFrames[String(participantId)] ??
      frame.participantFrames[participantId];
    if (!participantFrame) return null;

    const laneCs = Number(participantFrame.minionsKilled ?? 0);
    const jungleCs = Number(participantFrame.jungleMinionsKilled ?? 0);
    return laneCs + jungleCs;
  };

  const readCsPerMinWindow = (
    startMinute: number,
    endMinute: number,
  ): number | null => {
    if (endMinute <= startMinute) return null;
    const startCs = readTotalCsAtMinute(startMinute);
    const endCs = readTotalCsAtMinute(endMinute);
    if (startCs === null || endCs === null) return null;
    return (endCs - startCs) / (endMinute - startMinute);
  };

  const orderedDeathTimestampsMs = [...deathTimestampsMs]
    .map((timestampMs) => Number(timestampMs))
    .filter((timestampMs) => Number.isFinite(timestampMs))
    .sort((a, b) => a - b);

  return orderedDeathTimestampsMs.map((timestampMs, index) => {
    const deathMinute = roundTo(timestampMs / 60000, 1);
    const anchorMinute = Math.max(
      0,
      Math.min(lastMinute, Math.floor(timestampMs / 60000)),
    );
    const nextDeathTimestampMs = orderedDeathTimestampsMs[index + 1] ?? null;

    const preStart = Math.max(0, anchorMinute - 3);
    const preEnd = anchorMinute;
    const estimatedRespawnMinute = Math.ceil((timestampMs + 45_000) / 60000);
    const postStart = Math.max(0, Math.min(lastMinute, estimatedRespawnMinute));
    let postEnd = Math.min(lastMinute, postStart + 3);

    if (typeof nextDeathTimestampMs === "number") {
      const nextDeathMinute = Math.floor(nextDeathTimestampMs / 60000);
      postEnd = Math.min(postEnd, Math.max(postStart, nextDeathMinute));
    }

    const hasAliveWindow = postEnd - postStart >= 1;

    const preDeathCsPerMin = readCsPerMinWindow(preStart, preEnd);
    const postDeathCsPerMin = hasAliveWindow
      ? readCsPerMinWindow(postStart, postEnd)
      : null;

    const dropPerMin =
      preDeathCsPerMin !== null && postDeathCsPerMin !== null
        ? roundTo(preDeathCsPerMin - postDeathCsPerMin, 2)
        : null;

    return {
      deathMinute,
      preDeathCsPerMin:
        preDeathCsPerMin === null ? null : roundTo(preDeathCsPerMin, 2),
      postDeathCsPerMin:
        postDeathCsPerMin === null ? null : roundTo(postDeathCsPerMin, 2),
      dropPerMin,
    };
  });
}

function getBiggestCsDropWindow(
  frames: any[],
  participantId: number,
): MatchTimelineInsights["biggestCsDropWindow"] {
  const lastMinute = Math.max(0, frames.length - 1);
  if (lastMinute < 6) {
    return null;
  }

  const readTotalCsAtMinute = (minute: number): number | null => {
    const frame = frames[minute];
    if (!frame?.participantFrames) return null;

    const participantFrame =
      frame.participantFrames[String(participantId)] ??
      frame.participantFrames[participantId];
    if (!participantFrame) return null;

    const laneCs = Number(participantFrame.minionsKilled ?? 0);
    const jungleCs = Number(participantFrame.jungleMinionsKilled ?? 0);
    return laneCs + jungleCs;
  };

  let biggestDrop: {
    startMinute: number;
    endMinute: number;
    dropPerMin: number;
  } | null = null;

  for (let minute = 3; minute <= lastMinute - 3; minute++) {
    const preStart = minute - 3;
    const preEnd = minute;
    const postStart = minute;
    const postEnd = minute + 3;

    const preStartCs = readTotalCsAtMinute(preStart);
    const preEndCs = readTotalCsAtMinute(preEnd);
    const postStartCs = readTotalCsAtMinute(postStart);
    const postEndCs = readTotalCsAtMinute(postEnd);

    if (
      preStartCs === null ||
      preEndCs === null ||
      postStartCs === null ||
      postEndCs === null
    ) {
      continue;
    }

    const preRate = (preEndCs - preStartCs) / (preEnd - preStart);
    const postRate = (postEndCs - postStartCs) / (postEnd - postStart);
    const drop = preRate - postRate;

    if (drop <= 0) {
      continue;
    }

    if (!biggestDrop || drop > biggestDrop.dropPerMin) {
      biggestDrop = {
        startMinute: minute,
        endMinute: postEnd,
        dropPerMin: roundTo(drop, 2),
      };
    }
  }

  return biggestDrop;
}

async function getTimelineInsights(
  region: string,
  targetMatchId: string,
  participantId: number,
): Promise<
  MatchTimelineInsights & {
    csAt10?: number;
    csAt20?: number;
  }
> {
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
      return {
        deathTimestampsMs: [],
        deathTimestampsMinutes: [],
        csDropAfterDeaths: [],
        biggestCsDropWindow: null,
        majorTeamfights: [],
      };
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

    const deathTimestampsMs: number[] = [];
    for (const frame of frames) {
      const events = Array.isArray(frame?.events) ? frame.events : [];
      for (const event of events) {
        if (event?.type !== "CHAMPION_KILL") continue;
        if (Number(event?.victimId) !== participantId) continue;
        const timestamp = Number(event?.timestamp);
        if (Number.isFinite(timestamp) && timestamp >= 0) {
          deathTimestampsMs.push(timestamp);
        }
      }
    }

    const timelineInsights = {
      csAt10: readCsAtMinute(10),
      csAt20: readCsAtMinute(20),
      deathTimestampsMs,
      deathTimestampsMinutes: deathTimestampsMs.map((timestampMs) =>
        roundTo(timestampMs / 60000, 1),
      ),
      csDropAfterDeaths: buildCsDropAfterDeath(
        frames,
        deathTimestampsMs,
        participantId,
      ),
      biggestCsDropWindow: getBiggestCsDropWindow(frames, participantId),
      majorTeamfights: buildMajorTeamfights(frames, participantId),
    };

    setCached(timelineCache, cacheKey, timelineInsights);
    return timelineInsights;
  } catch {
    return {
      deathTimestampsMs: [],
      deathTimestampsMinutes: [],
      csDropAfterDeaths: [],
      biggestCsDropWindow: null,
      majorTeamfights: [],
    };
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

  const participant = data.info.participants.find(
    (p: any) => p.puuid === puuid,
  );
  if (!participant) return null;

  const playerPosition = getPosition(participant);
  const teamId = participant.teamId;
  const teamParticipants = data.info.participants.filter(
    (p: any) => p.teamId === teamId,
  );
  const enemyParticipants = data.info.participants.filter(
    (p: any) => p.teamId !== teamId,
  );

  const playerPositionUpper = playerPosition.toUpperCase();
  const findTeammateByPositions = (...positions: string[]) =>
    teamParticipants.find((p: any) => {
      if (p.puuid === puuid) return false;
      const pos = getPosition(p).toUpperCase();
      return positions.includes(pos);
    }) ?? null;

  // Role-based ally shown next to the player portrait:
  // - JUNGLE -> MID
  // - BOTTOM -> SUPPORT/UTILITY
  // - SUPPORT/UTILITY -> BOTTOM
  // - default (TOP/MID/others) -> JUNGLE
  const allyJunglerParticipant =
    playerPositionUpper === "JUNGLE"
      ? findTeammateByPositions("MIDDLE", "MID")
      : playerPositionUpper === "BOTTOM" || playerPositionUpper === "BOT"
        ? findTeammateByPositions("UTILITY", "SUPPORT")
        : playerPositionUpper === "UTILITY" || playerPositionUpper === "SUPPORT"
          ? findTeammateByPositions("BOTTOM", "BOT")
          : findTeammateByPositions("JUNGLE");
  const laneOpponentParticipant =
    playerPositionUpper === "JUNGLE"
      ? (enemyParticipants.find((p: any) => {
          const pos = getPosition(p).toUpperCase();
          return pos === "MIDDLE" || pos === "MID";
        }) ?? null)
      : (enemyParticipants.find(
          (p: any) => getPosition(p) === playerPosition,
        ) ?? null);
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
  const teamDamageToChamps = teamParticipants.reduce(
    (sum: number, p: any) => sum + Number(p.totalDamageDealtToChampions ?? 0),
    0,
  );
  const damageShare =
    teamDamageToChamps > 0
      ? roundTo((damageToChamps / teamDamageToChamps) * 100, 2)
      : undefined;
  const playedAt =
    data.info.gameEndTimestamp ?? data.info.gameStartTimestamp ?? null;

  const kda = {
    kills: participant.kills,
    deaths: participant.deaths,
    assists: participant.assists,
    ratio:
      participant.deaths > 0
        ? (participant.kills + participant.assists) / participant.deaths
        : participant.kills + participant.assists,
  };

  // Only fetch timeline if explicitly requested (expensive operation)
  let timelineCs: { csAt10?: number; csAt20?: number } = {};
  if (includeTimeline) {
    timelineCs = await getTimelineCsAt(
      region,
      matchId,
      participant.participantId,
    );
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
    damageShare,
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
    ].filter(
      (id: number | null | undefined) => typeof id === "number" && id > 0,
    ),
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
        typeof soloEntry.leaguePoints === "number" ? soloEntry.leaguePoints : 0,
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
        : participant.kills + participant.assists,
  };

  let timelineCs: { csAt10?: number; csAt20?: number } = {};
  let timelineInsights: MatchDetailsResponse["timelineInsights"] = undefined;
  if (includeTimeline) {
    const fullInsights = await getTimelineInsights(
      region,
      matchId,
      participant.participantId,
    );
    timelineCs = {
      csAt10: fullInsights.csAt10,
      csAt20: fullInsights.csAt20,
    };
    timelineInsights = {
      deathTimestampsMs: fullInsights.deathTimestampsMs,
      deathTimestampsMinutes: fullInsights.deathTimestampsMinutes,
      csDropAfterDeaths: fullInsights.csDropAfterDeaths,
      biggestCsDropWindow: fullInsights.biggestCsDropWindow,
      majorTeamfights: fullInsights.majorTeamfights,
    };
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
    timelineInsights,
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
    const matchIds = await getMatchIds(
      region,
      puuid,
      cursor,
      effectiveBatchSize,
    );
    if (!matchIds.length) {
      exhausted = true;
      break;
    }

    cursor += matchIds.length;

    // Fetch all matches in parallel instead of sequentially
    const summaryPromises = matchIds.map((matchId) =>
      buildMatchSummary(region, puuid, matchId, false).catch(() => {
        return null;
      }),
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

  const rankedSolo = await getRankedSoloEntry(
    region,
    summoner.id,
    account.puuid,
  );
  return { summoner, matches, rankedSolo };
}
