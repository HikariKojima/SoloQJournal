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
  const matchIds = await getMatchIds(region, puuid, start, count);
  const summaries: MatchSummaryResponse[] = [];
  for (const matchId of matchIds) {
    try {
      const regionalBase = getRegionalBase(region);
      const url = `${regionalBase}/lol/match/v5/matches/${matchId}`;
      const data = await riotFetch(url);

      const participant = data.info.participants.find(
        (p: any) => p.puuid === puuid,
      );
      if (!participant) continue;

      // Calculate team statistics
      const teamId = participant.teamId;
      const teamParticipants = data.info.participants.filter(
        (p: any) => p.teamId === teamId,
      );
      const teamKills = teamParticipants.reduce(
        (sum: number, p: any) => sum + p.kills,
        0,
      );
      const teamDeaths = teamParticipants.reduce(
        (sum: number, p: any) => sum + p.deaths,
        0,
      );

      const kda = {
        kills: participant.kills,
        deaths: participant.deaths,
        assists: participant.assists,
        ratio:
          participant.deaths > 0
            ? (participant.kills + participant.assists) / participant.deaths
            : null,
      };

      summaries.push({
        matchId,
        champion: participant.championName,
        kda,
        result: participant.win ? "win" : "loss",
        durationSeconds: data.info.gameDuration,
        stats: {
          cs: participant.totalMinionsKilled + participant.neutralMinionsKilled,
          gold: participant.goldEarned,
          visionScore: participant.visionScore,
        },
        teamKills,
        teamDeaths,
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
      });
    } catch (err) {
      console.error(`Failed to fetch match ${matchId}:`, err);
    }
  }
  return summaries;
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
