/**
 * This file defines TypeScript types for the League of Legends SoloQ Journal application.
 * It centralizes all data structures used across the app, ensuring type safety and consistency.
 * In SvelteKit, types are often placed in lib/ for shared usage between client and server code.
 * Key concept: TypeScript interfaces help catch errors at compile time and provide IntelliSense in your editor.
 * Example: Using SummonerResponse ensures the summoner data from Riot API matches expected shape.
 */

export type SummonerResponse = {
  puuid: string;
  id: string;
  accountId: string;
  name: string;
  profileIconId: number;
  level: number;
};

export type TimelineCsDropAfterDeath = {
  deathMinute: number;
  preDeathCsPerMin: number | null;
  postDeathCsPerMin: number | null;
  dropPerMin: number | null;
};

export type TimelineMajorFight = {
  startMinute: number;
  endMinute: number;
  killEvents: number;
  mapZone: string;
  playerInvolved: boolean;
  playerTakedowns: number;
  playerDeaths: number;
};

export type MatchTimelineInsights = {
  deathTimestampsMs: number[];
  deathTimestampsMinutes: number[];
  csDropAfterDeaths: TimelineCsDropAfterDeath[];
  biggestCsDropWindow: {
    startMinute: number;
    endMinute: number;
    dropPerMin: number;
  } | null;
  majorTeamfights: TimelineMajorFight[];
};

export type MatchSummaryResponse = {
  matchId: string;
  champion: string;
  kda: {
    kills: number;
    deaths: number;
    assists: number;
    ratio: number | null;
  };
  result: "win" | "loss";
  durationSeconds: number;
  stats: {
    cs: number;
    gold: number;
    visionScore: number;
    csAt10?: number;
    csAt20?: number;
  };
  teamKills: number;
  teamDeaths: number;
  playerPosition?: string;
  playerRole?: string;
  allyJungler?: {
    champion: string;
    kills: number;
    deaths: number;
    assists: number;
    position: string;
  } | null;
  laneOpponent?: {
    champion: string;
    kills: number;
    deaths: number;
    assists: number;
    position: string;
  } | null;
  enemyJungler?: {
    champion: string;
    kills: number;
    deaths: number;
    assists: number;
    position: string;
  } | null;
  /** Total damage dealt to champions, for DPM calculations */
  damageToChamps?: number;
  /** Share of team champion damage, as percent */
  damageShare?: number;
  /** When the game ended, in milliseconds since epoch */
  playedAt?: number;
  /** Queue identifier (e.g., 420 Solo/Duo) */
  queueId?: number;
  items?: number[];
  summonerSpells?: {
    primary: number;
    secondary: number;
  };
  timelineInsights?: MatchTimelineInsights;
};

export type MatchDetailsResponse = {
  matchId: string;
  gameDurationSeconds: number;
  region: string;
  champion: string;
  kda: {
    kills: number;
    deaths: number;
    assists: number;
    ratio: number | null;
  };
  result: "win" | "loss";
  stats: {
    cs: number;
    gold: number;
    visionScore: number;
    csAt10?: number;
    csAt20?: number;
  };
  matchInfo: {
    queueId?: number;
    gameMode?: string;
  };
  timelineInsights?: MatchTimelineInsights;
};

export type AnalyzePayload = {
  champion: string;
  kda: {
    kills: number;
    deaths: number;
    assists: number;
  };
  cs: number;
  gold: number;
  visionScore: number;
  durationSeconds: number;
  result: "win" | "loss";
};

export type AiAnalysisResponse = {
  strengths: string[];
  mistakes: string[];
  tips: Array<{
    tip: string;
    reason: string;
    howTo: string;
  }>;
};

export type RankedSoloEntry = {
  tier: string;
  rank: string;
  lp: number;
  wins: number;
  losses: number;
};

// Additional types for the app
export type SavedProfile = {
  gameName: string;
  tagLine: string;
  region: string;
  summoner: SummonerResponse;
  matches: MatchSummaryResponse[];
  lastFetched: string;
  rankedSolo?: RankedSoloEntry | null;
};

export type ProfileData = {
  summoner: SummonerResponse;
  matches: MatchSummaryResponse[];
  rankedSolo?: RankedSoloEntry | null;
} | null;
