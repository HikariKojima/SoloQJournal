<script lang="ts">
  import { onMount, tick } from "svelte";
  import MatchCard from "$lib/components/MatchCard.svelte";
  import { profileStore } from "$lib/profile.svelte";
  import type { PageData } from "./$types";
  import type { MatchSummaryResponse, ProfileData } from "$lib/types";
  import { buildHistoryStats } from "$lib/utils/coaching";
  import {
    championIcon,
    profileIcon,
    setDdragonVersion,
  } from "$lib/utils/ddragon";
  import { Search, ChevronDown, Menu, X } from "lucide-svelte";

  let { data }: { data: PageData } = $props();

  let gameName = $state("");
  let tagLine = $state("");
  let selectedRegion = $state("euw1");
  let searchedProfile = $state<ProfileData>(null);
  let loading = $state(false);
  let error = $state("");
  let tagLineError = $state("");
  let currentSearchGameName = $state("");
  let currentSearchTagLine = $state("");
  
  // All matches loaded for filter options (lazy loaded in background)
  let allSeasonMatches = $state<MatchSummaryResponse[]>([]);
  let isLoadingFilters = $state(false);

  const regionOptions = [
    {
      value: "euw1",
      label: "EUW",
      gameNameExample: "Takir",
      tagLineSuffix: "euw1",
    },
    {
      value: "eun1",
      label: "EUNE",
      gameNameExample: "Wunder",
      tagLineSuffix: "eun1",
    },
    {
      value: "na1",
      label: "NA",
      gameNameExample: "Doublelift",
      tagLineSuffix: "na1",
    },
    {
      value: "kr",
      label: "KR",
      gameNameExample: "Hide on bush",
      tagLineSuffix: "kr1",
    },
    {
      value: "jp1",
      label: "JP",
      gameNameExample: "Faker",
      tagLineSuffix: "jp1",
    },
    {
      value: "br1",
      label: "BR",
      gameNameExample: "SofM",
      tagLineSuffix: "br1",
    },
    {
      value: "oc1",
      label: "OCE",
      gameNameExample: "Swiffer",
      tagLineSuffix: "oc1",
    },
    {
      value: "ru",
      label: "RU",
      gameNameExample: "Diamondprox",
      tagLineSuffix: "ru1",
    },
    {
      value: "tr1",
      label: "TR",
      gameNameExample: "Zorozero",
      tagLineSuffix: "tr1",
    },
    {
      value: "la1",
      label: "LAN",
      gameNameExample: "Doinb",
      tagLineSuffix: "la1",
    },
    {
      value: "la2",
      label: "LAS",
      gameNameExample: "Doinb",
      tagLineSuffix: "la2",
    },
    {
      value: "sa1",
      label: "SA",
      gameNameExample: "Sneaky",
      tagLineSuffix: "sa1",
    },
  ];

  const PAGE_LIMIT = 12;

  $effect(() => {
    if (data?.platform) selectedRegion = data.platform;
  });

  $effect(() => {
    if (data?.ddragonVersion) {
      setDdragonVersion(data.ddragonVersion);
    }
  });

  const gameNamePlaceholder = $derived.by(() => {
    const found = regionOptions.find((r) => r.value === selectedRegion);
    return found ? found.gameNameExample : "Takir";
  });

  const tagLinePlaceholder = $derived.by(() => {
    const found = regionOptions.find((r) => r.value === selectedRegion);
    return found ? `#${found.tagLineSuffix}` : "#euw1";
  });

  function normalizeTagLineInput(value: string): string | null {
    const trimmed = value.trim();
    if (!trimmed) return null;

    const withoutHash = trimmed.replace(/^#+/, "").trim();
    if (!withoutHash) return null;

    return `#${withoutHash}`;
  }

  function createSummonerApiUrl(options?: {
    offset?: number;
    all?: boolean;
    limit?: number;
    champion?: string | null;
    opponentChampion?: string | null;
  }): string {
    const params = new URLSearchParams({
      gameName: currentSearchGameName,
      tagLine: currentSearchTagLine,
      platform: selectedRegion,
      offset: String(options?.offset ?? 0),
      limit: String(options?.limit ?? PAGE_LIMIT),
    });

    if (options?.all) params.set("all", "true");
    if (options?.champion) params.set("champion", options.champion);
    if (options?.opponentChampion) {
      params.set("opponentChampion", options.opponentChampion);
    }

    return `/api/summoner?${params.toString()}`;
  }

  /**
   * Load all matches for the season in the background to populate filters
   * This happens silently after the initial search completes
   */
  async function loadAllMatchesForFilters() {
    if (!currentSearchGameName || !currentSearchTagLine) return;
    // Avoid duplicate background fetches for the same profile
    if (isLoadingFilters || allSeasonMatches.length > 0) return;
    
    isLoadingFilters = true;
    try {
      // Start this a little after the main profile/matches fetch so we
      // don't burst the free Riot API key immediately.
      await new Promise((resolve) => setTimeout(resolve, 3000));

      const res = await fetch(
        createSummonerApiUrl({
          all: true,
          // Fetch up to 150 matches for comprehensive filter options
          // while staying under Riot's rate limits.
          limit: 150,
        }),
      );
      if (!res.ok) throw new Error(await res.text());
      const response = await res.json();
      allSeasonMatches = response.matches || [];
      debugLog(`Filters loaded: ${allSeasonMatches.length} matches fetched`);
    } catch (err: any) {
      console.error("Failed to load filters data:", err.message);
      // Silent fail - filters will just show available loaded matches
    } finally {
      isLoadingFilters = false;
    }
  }

  async function handleSearch() {
    loading = true;
    error = "";
    searchedProfile = null;
    allSeasonMatches = [];
    nextOffset = 0;
    hasMore = true;
    selectedChampion = null;
    selectedOpponentChampion = null;
    try {
      const trimmedGameName = gameName.trim();
      const normalizedTagLine = normalizeTagLineInput(tagLine);

      if (!trimmedGameName || !normalizedTagLine) {
        error = "Please enter both game name and tag line.";
        tagLineError = normalizedTagLine
          ? ""
          : "Please enter a valid tag line.";
        return;
      }

      tagLineError = "";
      tagLine = normalizedTagLine;

      // Strip the # from tagLine for the API request
      const cleanTagLine = normalizedTagLine.substring(1);
      // Store the search parameters used for subsequent pagination/filter requests
      currentSearchGameName = trimmedGameName;
      currentSearchTagLine = cleanTagLine;

      const res = await fetch(
        createSummonerApiUrl({
          offset: 0,
          limit: PAGE_LIMIT,
        }),
      );
      if (!res.ok) throw new Error(await res.text());
      const fetchedProfile:
        | (NonNullable<ProfileData> & {
            nextOffset?: number;
            hasMore?: boolean;
          })
        | null = await res.json();
      if (!fetchedProfile) {
        throw new Error("Profile response was empty.");
      }
      searchedProfile = fetchedProfile;

      profileStore.addProfile({
        gameName: trimmedGameName,
        tagLine: normalizedTagLine,
        region: selectedRegion,
        summoner: fetchedProfile.summoner,
        matches: fetchedProfile.matches,
        lastFetched: new Date().toISOString(),
      });

      // Clear the input fields after successful fetch
      gameName = "";
      tagLine = "";
      // Reset pagination state
      nextOffset = fetchedProfile.nextOffset ?? 0;
      hasMore = fetchedProfile.hasMore ?? false;
      selectedChampion = null;
      selectedOpponentChampion = null;

      // Background load all matches for comprehensive filter options (no await - fire and forget)
      void loadAllMatchesForFilters();
    } catch (err: any) {
      error = err.message;
    } finally {
      loading = false;
    }
  }

  function handleSearchSubmit(event: SubmitEvent) {
    event.preventDefault();
    void handleSearch();
  }

  async function loadProfile(
    profile: ProfileData & {
      region?: string;
      gameName: string;
      tagLine: string;
    },
  ) {
    // Set the region, game name, and tag line from the profile
    // Fallback to current selectedRegion if profile doesn't have region (for old saved profiles)
    selectedRegion = profile.region || selectedRegion || "euw1";
    gameName = profile.gameName;
    tagLine = profile.tagLine;

    // Trigger the search with the loaded profile data
    await handleSearch();
  }

  async function loadMore() {
    debugLog(
      `loadMore called | hasMore=${String(hasMore)} | isLoadingMore=${String(isLoadingMore)} | nextOffset=${String(nextOffset)}`,
    );

    if (!currentProfile || isLoadingMore || !hasMore) {
      debugLog("loadMore aborted due to guard condition");
      return;
    }

    isLoadingMore = true;
    try {
      debugLog(`fetch start with offset=${String(nextOffset)}`);
      const res = await fetch(
        createSummonerApiUrl({
          offset: nextOffset,
          limit: PAGE_LIMIT,
        }),
      );
      if (!res.ok) throw new Error(await res.text());

      const response = await res.json();
      const newMatches = response.matches || [];
      debugLog(
        `fetch success | newMatches=${String(newMatches.length)} | response.nextOffset=${String(response.nextOffset)} | response.hasMore=${String(response.hasMore)}`,
      );

      // Append new matches to existing list
      if (currentProfile.matches) {
        currentProfile.matches = [...currentProfile.matches, ...newMatches];
      }

      nextOffset = response.nextOffset ?? nextOffset + PAGE_LIMIT;
      hasMore = response.hasMore ?? newMatches.length >= PAGE_LIMIT;
      debugLog(
        `state updated | totalMatches=${String(currentProfile.matches?.length ?? 0)} | nextOffset=${String(nextOffset)} | hasMore=${String(hasMore)}`,
      );
    } catch (err: any) {
      console.error("Failed to load more matches:", err.message);
      debugLog(`fetch error | ${err.message}`);
    } finally {
      isLoadingMore = false;
      debugLog("loadMore finished");
    }
  }

  const currentProfile = $derived(searchedProfile || data.profileData);

  const computedHistory = $derived.by(() => {
    if (!currentProfile?.matches?.length) {
      return buildHistoryStats([], "");
    }
    return buildHistoryStats(
      currentProfile.matches,
      currentProfile.summoner.puuid,
    );
  });

  const winRate = $derived.by(() => {
    if (!currentProfile?.matches.length) return null;
    const wins = currentProfile.matches.filter(
      (m) => m.result === "win",
    ).length;
    return Math.round((wins / currentProfile.matches.length) * 100);
  });

  let selectedChampion = $state<string | null>(null);
  let selectedOpponentChampion = $state<string | null>(null);
  let isChampionFilterOpen = $state(false);
  let isOpponentFilterOpen = $state(false);
  let championFilterDropdownEl = $state<HTMLElement | null>(null);
  let opponentFilterDropdownEl = $state<HTMLElement | null>(null);
  let nextOffset = $state(0);

  const championFilterOptions = $derived.by(() => {
    // Use all season matches for comprehensive filters, fall back to visible matches
    const matchesForFilter = allSeasonMatches.length > 0 ? allSeasonMatches : (currentProfile?.matches ?? []);
    const matches = matchesForFilter as Array<any>;
    if (!matches.length) return [];

    const counts = new Map<string, number>();
    for (const match of matches) {
      const champion = match?.champion;
      if (!champion) continue;
      counts.set(champion, (counts.get(champion) ?? 0) + 1);
    }

    return Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([champion]) => ({ champion }));
  });

  function buildChampionFacet(
    selector: (match: MatchSummaryResponse) => string | undefined,
  ) {
    // Use all season matches for comprehensive filters, fall back to visible matches
    const matchesForFilter = allSeasonMatches.length > 0 ? allSeasonMatches : (currentProfile?.matches ?? []);
    const matches = matchesForFilter as MatchSummaryResponse[];
    if (!matches.length)
      return [] as Array<{ champion: string }>;

    const counts = new Map<string, number>();
    for (const match of matches) {
      const champion = selector(match);
      if (!champion) continue;
      counts.set(champion, (counts.get(champion) ?? 0) + 1);
    }

    return Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([champion]) => ({ champion }));
  }

  const opponentChampionOptions = $derived.by(() =>
    buildChampionFacet((match) => match.laneOpponent?.champion),
  );

  const hasActiveMatchFilters = $derived.by(() => {
    return Boolean(selectedChampion || selectedOpponentChampion);
  });

  const filteredMatchDays = $derived.by(() => {
    const sourceMatches = (currentProfile?.matches ??
      []) as MatchSummaryResponse[];

    if (!sourceMatches.length) return [];

    const filteredMatches = sourceMatches.filter((match) => {
      if (selectedChampion && match.champion !== selectedChampion) {
        return false;
      }
      if (
        selectedOpponentChampion &&
        match.laneOpponent?.champion !== selectedOpponentChampion
      ) {
        return false;
      }

      return true;
    });

    if (!filteredMatches.length) return [];

    const byDay = new Map<
      string,
      {
        dateKey: string;
        timestamp: number;
        matches: MatchSummaryResponse[];
        wins: number;
        losses: number;
      }
    >();

    for (const match of filteredMatches) {
      const rawPlayed = match?.playedAt ?? null;
      const playedAt =
        typeof rawPlayed === "number" && rawPlayed > 0 ? rawPlayed : null;
      const date = playedAt ? new Date(playedAt) : null;
      const dateKey = date
        ? `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`
        : "unknown";

      let group = byDay.get(dateKey);
      if (!group) {
        group = {
          dateKey,
          timestamp: date ? date.getTime() : 0,
          matches: [],
          wins: 0,
          losses: 0,
        };
        byDay.set(dateKey, group);
      }

      group.matches.push(match);
      if (match.result === "win") {
        group.wins += 1;
      } else if (match.result === "loss") {
        group.losses += 1;
      }
    }

    return Array.from(byDay.values())
      .sort((a, b) => b.timestamp - a.timestamp)
      .map((group) => {
        let dateLabel = "UNKNOWN DATE";
        if (group.dateKey !== "unknown" && group.timestamp) {
          const d = new Date(group.timestamp);
          const day = d.getDate();
          const month = d
            .toLocaleString(undefined, { month: "short" })
            .toUpperCase();
          dateLabel = `${day} ${month}`;
        }

        return {
          dateKey: group.dateKey,
          dateLabel,
          matches: group.matches,
          wins: group.wins,
          losses: group.losses,
        };
      });
  });

  let reflectionModalOpen = $state(false);
  let selectedMatch = $state<import("$lib/types").MatchSummaryResponse | null>(
    null,
  );
  let reflectionText = $state("");
  let reflectionError = $state("");
  let matchReflections = $state<Record<string, string>>({});
  let learningObjectiveDropdownEl = $state<HTMLElement | null>(null);
  let learningObjectiveInputEl = $state<HTMLInputElement | null>(null);
  let isLearningObjectiveOpen = $state(false);
  let learningObjectives = $state<string[]>([]);
  let learningObjectiveInput = $state("");
  let isAddingObjective = $state(false);
  let selectedObjective = $state<string>("");
  let emotionalState = $state<string>("");
  let emotionalStateScore = $state(3);
  let objectiveExecution = $state("");
  let wentWell = $state("");
  let wentBad = $state("");
  let emotionalReflection = $state("");
  let reflectionSaved = $state(false);
  let isLoadingTimelineStats = $state(false);
  let tiltAlertDismissed = $state(false);
  let isLoadingMore = $state(false);
  let hasMore = $state(true);
  let dismissed = $state(false);
  let sentinelElement = $state<HTMLElement | null>(null);
  let debugInfiniteScroll = $state(true);
  let debugEvents = $state<string[]>([]);
  let isMobileProfilesOpen = $state(false);

  function debugLog(message: string) {
    if (!debugInfiniteScroll) return;
    const stamp = new Date().toLocaleTimeString();
    debugEvents = [`${stamp} - ${message}`, ...debugEvents].slice(0, 20);
  }

  function openMobileProfiles() {
    isMobileProfilesOpen = true;
  }

  function closeMobileProfiles() {
    isMobileProfilesOpen = false;
  }

  function handleGlobalKeydown(event: KeyboardEvent) {
    if (event.key === "Escape" && isMobileProfilesOpen) {
      closeMobileProfiles();
    }
  }

  const currentProfileKey = $derived.by(() => {
    if (!currentProfile) return "";
    return `${currentProfile.summoner.puuid}`;
  });

  // Reset full-season filter cache whenever the active profile changes
  $effect(() => {
    allSeasonMatches = [];
    isLoadingFilters = false;
  });

  const tiltState = $derived.by(() => {
    const matches = (currentProfile?.matches ?? []) as Array<any>;
    const viewerPuuid = currentProfile?.summoner?.puuid;
    if (!matches.length || !viewerPuuid) {
      return { streakLength: 0, isTilting: false };
    }

    const now = Date.now();
    const oneDayMs = 24 * 60 * 60 * 1000;
    let streakLength = 0;

    for (const match of matches) {
      const participant = match?.info?.participants?.find(
        (p: any) => p.puuid === viewerPuuid,
      );
      const didWin =
        typeof participant?.win === "boolean"
          ? participant.win
          : match?.result === "win";

      const playedAt =
        match?.playedAt ??
        match?.info?.gameEndTimestamp ??
        match?.info?.gameStartTimestamp ??
        match?.gameEndTimestamp ??
        match?.gameStartTimestamp ??
        null;

      if (!playedAt || now - playedAt > oneDayMs) {
        break;
      }

      if (didWin) {
        break;
      }

      streakLength += 1;
    }

    return {
      streakLength,
      isTilting: streakLength >= 3,
    };
  });

  $effect(() => {
    const puuid = currentProfile?.summoner?.puuid;
    if (puuid) {
      dismissed = false;
    }
  });

  // Stats calculations for reflection modal
  const matchStats = $derived.by(() => {
    if (!selectedMatch) {
      return {
        csPerMin: 0,
        goldPerMin: 0,
        kpPercent: 0,
        deathPercent: 0,
        csAt10: null as number | null,
        csAt20: null as number | null,
      };
    }

    const durationMinutes = selectedMatch.durationSeconds / 60;
    const csPerMin =
      durationMinutes > 0
        ? Math.round((selectedMatch.stats.cs / durationMinutes) * 100) / 100
        : 0;
    const goldPerMin =
      durationMinutes > 0
        ? Math.round((selectedMatch.stats.gold / durationMinutes) * 100) / 100
        : 0;

    // Kill Participation: (kills + assists) / teamKills * 100
    const kpPercent =
      selectedMatch.teamKills > 0
        ? Math.round(
            ((selectedMatch.kda.kills + selectedMatch.kda.assists) /
              selectedMatch.teamKills) *
              100 *
              100,
          ) / 100
        : 0;

    // Death Contribution: deaths / teamDeaths * 100
    const deathPercent =
      selectedMatch.teamDeaths > 0
        ? Math.round(
            (selectedMatch.kda.deaths / selectedMatch.teamDeaths) * 100 * 100,
          ) / 100
        : 0;

    return {
      csPerMin,
      goldPerMin,
      kpPercent,
      deathPercent,
      csAt10:
        typeof selectedMatch.stats.csAt10 === "number"
          ? selectedMatch.stats.csAt10
          : null,
      csAt20:
        typeof selectedMatch.stats.csAt20 === "number"
          ? selectedMatch.stats.csAt20
          : null,
    };
  });

  function reflectionKey(matchId: string) {
    return `${currentProfileKey}:${matchId}`;
  }

  function reflectionFieldKey(matchId: string, field: string): string {
    return `${currentProfileKey}:${matchId}:${field}`;
  }

  function resolveObjectiveSelection(preferred?: string | null): string {
    if (preferred && learningObjectives.includes(preferred)) {
      return preferred;
    }

    return learningObjectives.at(-1) ?? "";
  }

  async function openReflection(
    match: import("$lib/types").MatchSummaryResponse,
  ) {
    if (!currentProfile) return;
    selectedMatch = match;
    const key = reflectionKey(match.matchId);
    reflectionText = matchReflections[key] || "";
    reflectionError = "";
    reflectionModalOpen = true;
    tiltAlertDismissed = false;

    // Load reflection fields from localStorage
    if (typeof window !== "undefined") {
      emotionalState =
        localStorage.getItem(reflectionFieldKey(match.matchId, "emotion")) ||
        "";
      objectiveExecution =
        localStorage.getItem(
          reflectionFieldKey(match.matchId, "objectiveExecution"),
        ) || "";
      wentWell =
        localStorage.getItem(reflectionFieldKey(match.matchId, "wentWell")) ||
        "";
      wentBad =
        localStorage.getItem(reflectionFieldKey(match.matchId, "wentBad")) ||
        "";
      emotionalReflection =
        localStorage.getItem(
          reflectionFieldKey(match.matchId, "emotionalReflection"),
        ) || "";
      emotionalStateScore = emotionToScore(emotionalState);
      const storedObjective = localStorage.getItem("currentLearningObjective");
      selectedObjective = resolveObjectiveSelection(storedObjective);
      if (selectedObjective) {
        localStorage.setItem("currentLearningObjective", selectedObjective);
      } else {
        localStorage.removeItem("currentLearningObjective");
      }
    }

    if (
      typeof match.stats.csAt10 === "number" &&
      typeof match.stats.csAt20 === "number"
    ) {
      return;
    }

    isLoadingTimelineStats = true;
    try {
      const params = new URLSearchParams({
        matchId: match.matchId,
        puuid: currentProfile.summoner.puuid,
        platform: selectedRegion,
      });

      const res = await fetch(`/api/match?${params.toString()}`);
      if (!res.ok) {
        throw new Error(await res.text());
      }

      const payload = await res.json();
      const csAt10 =
        typeof payload?.stats?.csAt10 === "number"
          ? payload.stats.csAt10
          : undefined;
      const csAt20 =
        typeof payload?.stats?.csAt20 === "number"
          ? payload.stats.csAt20
          : undefined;

      // Update selected match in modal state
      if (selectedMatch?.matchId === match.matchId) {
        selectedMatch = {
          ...selectedMatch,
          stats: {
            ...selectedMatch.stats,
            csAt10,
            csAt20,
          },
        };
      }

      // Keep the list data in sync to avoid repeated requests for the same match.
      if (currentProfile.matches?.length) {
        currentProfile.matches = currentProfile.matches.map((entry) =>
          entry.matchId === match.matchId
            ? {
                ...entry,
                stats: {
                  ...entry.stats,
                  csAt10,
                  csAt20,
                },
              }
            : entry,
        );
      }
    } catch (err) {
      console.error("Failed to fetch timeline CS stats:", err);
    } finally {
      isLoadingTimelineStats = false;
    }
  }

  function closeReflection() {
    reflectionModalOpen = false;
    selectedMatch = null;
    reflectionText = "";
    reflectionError = "";
    emotionalState = "";
    emotionalStateScore = 3;
    objectiveExecution = "";
    wentWell = "";
    wentBad = "";
    emotionalReflection = "";
    reflectionSaved = false;
    isLearningObjectiveOpen = false;
    isAddingObjective = false;
  }

  function addLearningObjective() {
    const trimmed = learningObjectiveInput.trim();
    if (!trimmed) return;

    const existing = learningObjectives.find(
      (objective) => objective.toLowerCase() === trimmed.toLowerCase(),
    );

    const nextObjectives = existing
      ? learningObjectives
      : [...learningObjectives, trimmed];

    learningObjectives = nextObjectives;

    const nextSelectedObjective = existing ?? trimmed;

    localStorage.setItem("learningObjectives", JSON.stringify(nextObjectives));
    selectedObjective = nextSelectedObjective;
    localStorage.setItem("currentLearningObjective", nextSelectedObjective);
    learningObjectiveInput = "";
    isAddingObjective = false;
    isLearningObjectiveOpen = false;
  }

  function deleteLearningObjective(index: number) {
    const removedObjective = learningObjectives[index];
    const nextObjectives = learningObjectives.filter((_, i) => i !== index);
    learningObjectives = nextObjectives;
    localStorage.setItem("learningObjectives", JSON.stringify(nextObjectives));
    if (selectedObjective === removedObjective) {
      selectedObjective = nextObjectives.at(-1) ?? "";
      if (selectedObjective) {
        localStorage.setItem("currentLearningObjective", selectedObjective);
      } else {
        localStorage.removeItem("currentLearningObjective");
      }
    }
  }

  async function updateObjective(value: string) {
    if (value === "__add__") {
      selectedObjective = resolveObjectiveSelection(selectedObjective);
      isLearningObjectiveOpen = false;
      isAddingObjective = true;
      learningObjectiveInput = "";
      await tick();
      learningObjectiveInputEl?.focus();
      return;
    }

    isAddingObjective = false;
    selectedObjective = value;
    if (value) {
      localStorage.setItem("currentLearningObjective", value);
    } else {
      localStorage.removeItem("currentLearningObjective");
    }
  }

  function toggleLearningObjectiveDropdown() {
    if (isAddingObjective) {
      isAddingObjective = false;
      learningObjectiveInput = "";
    }

    isLearningObjectiveOpen = !isLearningObjectiveOpen;
    if (!isLearningObjectiveOpen) {
      isAddingObjective = false;
      learningObjectiveInput = "";
    }
  }

  function handleLearningObjectiveInputKeydown(event: KeyboardEvent) {
    if (event.key !== "Enter") return;
    event.preventDefault();
    addLearningObjective();
  }

  function updateEmotionalState(value: string) {
    emotionalState = value;
    emotionalStateScore = emotionToScore(value);
    if (selectedMatch) {
      localStorage.setItem(
        reflectionFieldKey(selectedMatch.matchId, "emotion"),
        value,
      );
    }
  }

  const emotionScale = [
    { score: 1, value: "😤 Tilted", label: "Tilted" },
    { score: 2, value: "😴 Tired", label: "Tired" },
    { score: 3, value: "😐 Neutral", label: "Neutral" },
    { score: 4, value: "🙂 Good", label: "Good" },
    { score: 5, value: "😎 Confident", label: "Confident" },
  ] as const;

  function emotionToScore(value: string): number {
    return emotionScale.find((entry) => entry.value === value)?.score ?? 3;
  }

  function scoreToEmotion(score: number): string {
    return emotionScale.find((entry) => entry.score === score)?.value ?? "😐 Neutral";
  }

  function updateEmotionalStateFromSlider(score: number) {
    emotionalStateScore = score;
    updateEmotionalState(scoreToEmotion(score));
  }

  function autoSaveReflectionField(field: string, value: string) {
    if (!selectedMatch) return;
    localStorage.setItem(
      reflectionFieldKey(selectedMatch.matchId, field),
      value,
    );
    reflectionSaved = true;
    setTimeout(() => {
      reflectionSaved = false;
    }, 1500);
  }

  function saveReflection() {
    if (!currentProfile || !selectedMatch) return;
    const text = reflectionText.trim();
    if (!text) {
      reflectionError = "Please write something before saving.";
      return;
    }

    const key = reflectionKey(selectedMatch.matchId);
    matchReflections = {
      ...matchReflections,
      [key]: text,
    };

    localStorage.setItem("lol-reflections", JSON.stringify(matchReflections));
    reflectionModalOpen = false;
  }

  function getReflection(match: import("$lib/types").MatchSummaryResponse) {
    if (!currentProfile) return "";
    return matchReflections[reflectionKey(match.matchId)] || "";
  }

  onMount(() => {
    if (typeof window !== "undefined") {
      const stored = localStorage.getItem("lol-reflections");
      if (stored) {
        try {
          matchReflections = JSON.parse(stored);
        } catch (err) {
          console.error("Failed to parse stored reflections:", err);
        }
      }
      const objectives = localStorage.getItem("learningObjectives");
      if (objectives) {
        try {
          learningObjectives = JSON.parse(objectives);
          const storedObjective = localStorage.getItem(
            "currentLearningObjective",
          );
          selectedObjective = resolveObjectiveSelection(storedObjective);
        } catch (err) {
          console.error("Failed to parse learning objectives:", err);
        }
      }
    }
  });

  // Keep the infinite-scroll observer in a reactive effect so it re-attaches
  // whenever the sentinel element is created (for example after a new search).
  $effect(() => {
    if (typeof window === "undefined" || !sentinelElement) {
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        const isIntersecting = Boolean(entries[0]?.isIntersecting);
        debugLog(
          `observer event | intersecting=${String(isIntersecting)} | hasMore=${String(hasMore)} | isLoadingMore=${String(isLoadingMore)}`,
        );
        if (isIntersecting && hasMore && !isLoadingMore) {
          void loadMore();
        }
      },
      {
        rootMargin: "900px",
        threshold: 0,
      },
    );

    observer.observe(sentinelElement);

    return () => {
      observer.disconnect();
    };
  });

  // Sync profileStore to localStorage
  $effect(() => {
    if (typeof window !== "undefined") {
      localStorage.setItem("lol-profiles", JSON.stringify(profileStore.list));
    }
  });

  $effect(() => {
    if (typeof document === "undefined") {
      return;
    }

    const modalClass = "modal-open";

    if (reflectionModalOpen) {
      document.body.classList.add(modalClass);
    } else {
      document.body.classList.remove(modalClass);
    }

    return () => {
      document.body.classList.remove(modalClass);
    };
  });

  function toggleChampionFilter() {
    isChampionFilterOpen = !isChampionFilterOpen;
  }

  function selectChampion(champion: string | null) {
    selectedChampion = champion;
    isChampionFilterOpen = false;
  }

  function toggleOpponentFilter() {
    isOpponentFilterOpen = !isOpponentFilterOpen;
  }

  function selectOpponentChampion(champion: string | null) {
    selectedOpponentChampion = champion;
    isOpponentFilterOpen = false;
  }

  function handleChampionFilterOutsideClick(event: MouseEvent) {
    const target = event.target as Node | null;

    if (isChampionFilterOpen && championFilterDropdownEl && target) {
      if (!championFilterDropdownEl.contains(target)) {
        isChampionFilterOpen = false;
      }
    }

    if (isOpponentFilterOpen && opponentFilterDropdownEl && target) {
      if (!opponentFilterDropdownEl.contains(target)) {
        isOpponentFilterOpen = false;
      }
    }

    if (
      (isLearningObjectiveOpen || isAddingObjective) &&
      learningObjectiveDropdownEl &&
      target
    ) {
      if (!learningObjectiveDropdownEl.contains(target)) {
        isLearningObjectiveOpen = false;
        isAddingObjective = false;
        learningObjectiveInput = "";
      }
    }
  }
</script>

<svelte:window
  on:click={handleChampionFilterOutsideClick}
  on:keydown={handleGlobalKeydown}
/>

<div class="min-h-screen match-page lg:flex">
  {#if isMobileProfilesOpen}
    <button
      type="button"
      aria-label="Close saved profiles"
      class="fixed inset-0 z-40 bg-black/60 lg:hidden"
      onclick={closeMobileProfiles}
    ></button>
  {/if}

  <!-- Sidebar -->
  <aside
    class={`match-sidebar fixed inset-y-0 left-0 z-50 w-[85vw] max-w-xs overflow-y-auto p-4 transform transition-transform duration-300 lg:static lg:z-auto lg:block lg:w-64 lg:max-w-none lg:translate-x-0 ${isMobileProfilesOpen ? "translate-x-0" : "-translate-x-full"}`}
    aria-label="Saved profiles"
  >
    <div class="mb-3 flex items-center justify-between lg:mb-4">
      <h2 class="text-xl font-bold">Saved Profiles</h2>
      <button
        type="button"
        class="inline-flex items-center justify-center rounded p-1.5 text-gray-300 hover:bg-gray-700 lg:hidden"
        aria-label="Close saved profiles"
        onclick={closeMobileProfiles}
      >
        <X size={18} />
      </button>
    </div>
    <ul class="space-y-2">
      {#each profileStore.list as profile, i (`${profile.gameName.toLowerCase().trim()}|${profile.tagLine.toLowerCase().trim()}|${profile.region.toLowerCase().trim()}`)}
        <li class="flex items-start gap-2">
          <button
            class="flex-1 text-left p-2 rounded cursor-pointer hover:bg-gray-700 transition {i ===
            profileStore.activeIndex
              ? 'bg-gray-700'
              : ''}"
            onclick={() => {
              profileStore.setActive(i);
              closeMobileProfiles();
              loadProfile(profile);
            }}
          >
            <span class="break-all">{profile.gameName}{profile.tagLine}</span>
            <span class="ml-2 text-xs sm:text-sm text-gray-400 uppercase">{profile.region}</span>
          </button>
          <button
            type="button"
            class="px-2 py-1 text-base bg-red-600 hover:bg-red-700 rounded cursor-pointer"
            aria-label={`Delete saved profile ${profile.gameName}${profile.tagLine}`}
            onclick={(event) => {
              event.stopPropagation();
              profileStore.removeProfile(i);
            }}
          >
            Delete
          </button>
        </li>
      {/each}
    </ul>
  </aside>

  <!-- Main content -->
  <main class="flex-1 p-3 sm:p-4 lg:p-6">
    <div class="mb-3 lg:hidden">
      <button
        type="button"
        class="inline-flex items-center gap-2 rounded border border-gray-600 bg-gray-900 px-3 py-2 text-sm font-medium text-gray-100 hover:bg-gray-800"
        onclick={openMobileProfiles}
      >
        <Menu size={16} />
        Saved Profiles
      </button>
    </div>

    <!-- Search -->
    <div class="mb-6">
      <!-- Region Select -->
      <div class="mb-4">
        <label for="platform" class="block text-base font-medium mb-1"
          >Region</label
        >
        <select
          id="platform"
          bind:value={selectedRegion}
          class="w-full sm:w-40 p-2 bg-gray-800 border border-gray-600 rounded"
        >
          {#each regionOptions as region (region.value)}
            <option value={region.value}>{region.label}</option>
          {/each}
        </select>
      </div>

      <!-- Game Name and Tag Line (connected) -->
      <form
        class="flex flex-col sm:flex-row gap-3 sm:gap-2 items-stretch sm:items-end"
        onsubmit={handleSearchSubmit}
      >
        <div class="w-full flex-1">
          <label for="gameName" class="block text-base font-medium mb-1"
            >Game Name</label
          >
          <input
            id="gameName"
            bind:value={gameName}
            class="w-full p-2 bg-gray-800 border border-gray-600 rounded"
            placeholder={gameNamePlaceholder}
          />
        </div>
        <div class="w-full sm:w-40">
          <label for="tagLine" class="block text-base font-medium mb-1"
            >Tag Line</label
          >
          <input
            id="tagLine"
            bind:value={tagLine}
            class="w-full p-2 bg-gray-800 border border-gray-600 rounded {tagLineError
              ? 'border-red-500'
              : ''}"
            placeholder={tagLinePlaceholder}
          />
        </div>
        <button
          type="submit"
          disabled={loading}
          class="w-full sm:w-auto px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded flex items-center justify-center gap-2"
        >
          <Search size={16} />
          {loading ? "Searching..." : "Search"}
        </button>
      </form>

      {#if tagLineError}
        <p class="text-red-400 text-base mt-2">{tagLineError}</p>
      {/if}
    </div>

    {#if error}
      <p class="text-red-400 mb-4">{error}</p>
    {/if}

    {#if loading}
      <div class="mb-6 p-4 match-profile-card animate-pulse">
        <div class="flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-4">
          <div class="h-14 w-14 rounded-full bg-gray-700/60"></div>
          <div class="flex-1 space-y-2">
            <div class="h-6 w-40 sm:w-56 rounded bg-gray-700/60"></div>
            <div class="h-4 w-28 rounded bg-gray-700/50"></div>
            <div class="h-4 w-36 rounded bg-gray-700/40"></div>
          </div>
        </div>
      </div>

      <div class="match-days">
        {#each Array(3) as _, dayIndex (`search-loader-day-${dayIndex}`)}
          <section>
            <div class="match-day-header animate-pulse">
              <div class="h-4 w-20 rounded bg-gray-700/55"></div>
              <div class="match-day-badges">
                <div class="h-6 w-12 rounded-full bg-gray-700/45"></div>
                <div class="h-6 w-12 rounded-full bg-gray-700/35"></div>
              </div>
            </div>

            <div class="match-day-list">
              {#each Array(2) as __, cardIndex (`search-loader-card-${dayIndex}-${cardIndex}`)}
                <div class="match-card match-card--win animate-pulse" aria-hidden="true">
                  <div class="match-card__left">
                    <div class="match-card__pair">
                      <div class="match-card__icon-column">
                        <div class="match-card__champion-circle match-card__champion-circle--player bg-gray-700/60"></div>
                      </div>
                      <div class="match-card__icon-column">
                        <div class="match-card__champion-circle match-card__champion-circle--jungler bg-gray-700/45"></div>
                      </div>
                    </div>

                    <div class="match-card__spells">
                      <div class="match-card__spell-icon bg-gray-700/50"></div>
                      <div class="match-card__spell-icon bg-gray-700/35"></div>
                    </div>

                    <div class="match-card__body">
                      <div class="match-card__title-row">
                        <div class="h-4 w-24 rounded bg-gray-700/55"></div>
                        <div class="h-3 w-44 rounded bg-gray-700/35"></div>
                      </div>
                      <div class="match-card__items">
                        {#each Array(7) as ___, itemIndex (`search-loader-item-${dayIndex}-${cardIndex}-${itemIndex}`)}
                          <div class="match-card__item-slot bg-gray-700/40"></div>
                        {/each}
                      </div>
                    </div>
                  </div>

                  <div class="match-card__center">
                    <div class="h-6 w-20 rounded bg-gray-700/50"></div>
                    <div class="h-4 w-16 rounded bg-gray-700/35 mt-2"></div>
                  </div>

                  <div class="match-card__right">
                    <div class="h-5 w-14 rounded-full bg-gray-700/45"></div>
                    <div class="h-4 w-20 rounded bg-gray-700/30"></div>
                    <div class="h-4 w-16 rounded bg-gray-700/30"></div>
                  </div>
                </div>
              {/each}
            </div>
          </section>
        {/each}
      </div>
    {:else if currentProfile}
      <!-- Profile info -->
      <div class="mb-6 p-4 match-profile-card">
        <div class="flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-4">
          {#if currentProfile.summoner.profileIconId !== undefined && currentProfile.summoner.profileIconId !== null}
            <img
              src={profileIcon(currentProfile.summoner.profileIconId)}
              alt={`${currentProfile.summoner.name} profile icon`}
              class="h-14 w-14 rounded-full border border-gray-600 object-cover"
              loading="lazy"
            />
          {/if}

          <div class="text-center sm:text-left">
            <h1 class="text-xl sm:text-2xl font-bold wrap-break-words">{currentProfile.summoner.name}</h1>
            <p>Level: {currentProfile.summoner.level}</p>
            {#if winRate !== null}
              <p>Win Rate: {winRate}%</p>
            {/if}
          </div>
        </div>
      </div>

      {#if tiltState.isTilting && !dismissed}
        <div class="mb-4 match-tilt-banner p-3 rounded">
          <div class="flex items-center justify-between gap-3">
            <p class="text-base match-tilt-banner-text">
              {tiltState.streakLength}-game losing streak. Consider taking a
              break.
            </p>
            <button
              type="button"
              class="text-amber-200 hover:text-amber-100"
              onclick={() => {
                dismissed = true;
              }}
              aria-label="Dismiss tilt banner"
            >
              ×
            </button>
          </div>
        </div>
      {/if}

      <!-- Filters -->
      <div class="match-filter-bar">
        <div>
          <p class="match-filter-label">Match history</p>
          <p class="match-filter-help">
            Filter games by champion and matchup (current season Solo/Duo only)
          </p>
        </div>
        <div class="flex w-full flex-col sm:flex-row sm:flex-wrap gap-3">
          <div
            class="match-filter-dropdown"
            bind:this={championFilterDropdownEl}
          >
            <button
              type="button"
              class="match-filter-trigger"
              onclick={toggleChampionFilter}
            >
              <div class="match-filter-trigger-main">
                {#if selectedChampion}
                  <img
                    src={championIcon(selectedChampion.replaceAll(" ", ""))}
                    alt={selectedChampion}
                    width="24"
                    height="24"
                    loading="lazy"
                  />
                  <span>{selectedChampion}</span>
                {:else}
                  <span>All champions</span>
                {/if}
              </div>
              <ChevronDown class="match-filter-trigger-chevron" />
            </button>

            {#if isChampionFilterOpen}
              <div class="match-filter-menu">
                <button
                  type="button"
                  class={`match-filter-option ${selectedChampion ? "" : "match-filter-option--active"}`}
                  onclick={() => selectChampion(null)}
                >
                  <div class="match-filter-option-main">
                    <span class="match-filter-option-pill">All</span>
                    <span>All champions</span>
                  </div>
                </button>

                {#each championFilterOptions as option (option.champion)}
                  <button
                    type="button"
                    class={`match-filter-option ${selectedChampion === option.champion ? "match-filter-option--active" : ""}`}
                    onclick={() => selectChampion(option.champion)}
                  >
                    <div class="match-filter-option-main">
                      <img
                        src={championIcon(option.champion.replaceAll(" ", ""))}
                        alt={option.champion}
                        width="24"
                        height="24"
                        loading="lazy"
                      />
                      <span>{option.champion}</span>
                    </div>
                  </button>
                {/each}
              </div>
            {/if}
          </div>

          <div
            class="match-filter-dropdown"
            bind:this={opponentFilterDropdownEl}
          >
            <button
              type="button"
              class="match-filter-trigger"
              onclick={toggleOpponentFilter}
            >
              <div class="match-filter-trigger-main">
                {#if selectedOpponentChampion}
                  <img
                    src={championIcon(
                      selectedOpponentChampion.replaceAll(" ", ""),
                    )}
                    alt={selectedOpponentChampion}
                    width="24"
                    height="24"
                    loading="lazy"
                  />
                  <span>{selectedOpponentChampion}</span>
                {:else}
                  <span>Any lane opponent</span>
                {/if}
              </div>
              <ChevronDown class="match-filter-trigger-chevron" />
            </button>

            {#if isOpponentFilterOpen}
              <div class="match-filter-menu">
                <button
                  type="button"
                  class={`match-filter-option ${selectedOpponentChampion ? "" : "match-filter-option--active"}`}
                  onclick={() => selectOpponentChampion(null)}
                >
                  <div class="match-filter-option-main">
                    <span class="match-filter-option-pill">Any</span>
                    <span>Any lane opponent</span>
                  </div>
                </button>

                {#each opponentChampionOptions as option (option.champion)}
                  <button
                    type="button"
                    class={`match-filter-option ${selectedOpponentChampion === option.champion ? "match-filter-option--active" : ""}`}
                    onclick={() => selectOpponentChampion(option.champion)}
                  >
                    <div class="match-filter-option-main">
                      <img
                        src={championIcon(option.champion.replaceAll(" ", ""))}
                        alt={option.champion}
                        width="24"
                        height="24"
                        loading="lazy"
                      />
                      <span>{option.champion}</span>
                    </div>
                  </button>
                {/each}
              </div>
            {/if}
          </div>
        </div>
      </div>

      <!-- Matches -->
      <div class="match-days">
        {#each filteredMatchDays as day (day.dateKey)}
          <section>
            <div class="match-day-header">
              <span class="match-day-date">{day.dateLabel}</span>
              <div class="match-day-badges">
                <span class="match-day-badge match-day-badge--wins">
                  {day.wins}W
                </span>
                <span class="match-day-badge match-day-badge--losses">
                  {day.losses}L
                </span>
              </div>
            </div>

            <div class="match-day-list">
              {#each day.matches as match (match.matchId)}
                <MatchCard
                  {match}
                  history={computedHistory}
                  playerPuuid={currentProfile.summoner.puuid}
                  leagueEntry={null}
                  hasReflection={!!getReflection(match)}
                  onMatchSelect={openReflection}
                />
              {/each}
            </div>
          </section>
        {/each}
      </div>

      <!-- Infinite scroll sentinel - invisible element that triggers loading when visible -->
      <!-- The Intersection Observer watches this element to detect when user scrolls near bottom -->
      <div bind:this={sentinelElement} class="mt-8"></div>

      <!-- Loading indicator for infinite scroll -->
      {#if isLoadingMore}
        <div class="mt-6 flex justify-center items-center gap-3">
          <!-- Spinning loader animation -->
          <div
            class="w-5 h-5 border-2 border-blue-600 border-t-transparent rounded-full animate-spin"
          ></div>
          <p class="text-gray-400">Loading more matches...</p>
        </div>
      {/if}

      <!-- Message when all matches are loaded -->
      {#if !hasMore && currentProfile.matches && currentProfile.matches.length > 0}
        <div class="mt-6 text-center">
          <p class="text-gray-400">All matches loaded</p>
        </div>
      {/if}

      <!-- Info message about filters -->
      {#if hasActiveMatchFilters && hasMore}
        <div class="mt-4 text-center">
          <p class="text-gray-300 text-sm">
            Filters apply to loaded matches. Scroll down to load more and refine
            results.
          </p>
        </div>
      {/if}

      {#if debugInfiniteScroll}
        <div class="mt-6 p-3 rounded border border-amber-500/40 bg-black/35 text-amber-100 text-xs">
          <div class="flex items-center justify-between gap-3 mb-2">
            <p class="font-semibold">Infinite Scroll Debug</p>
            <button
              type="button"
              class="px-2 py-1 rounded bg-amber-500/20 hover:bg-amber-500/30"
              onclick={() => {
                debugEvents = [];
              }}
            >
              Clear
            </button>
          </div>

          <div class="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-2 mb-3">
            <p>hasMore: <strong>{String(hasMore)}</strong></p>
            <p>isLoadingMore: <strong>{String(isLoadingMore)}</strong></p>
            <p>nextOffset: <strong>{nextOffset}</strong></p>
            <p>matches: <strong>{currentProfile.matches?.length ?? 0}</strong></p>
            <p>sentinel: <strong>{sentinelElement ? "attached" : "missing"}</strong></p>
            <p>filtersActive: <strong>{String(hasActiveMatchFilters)}</strong></p>
          </div>

          <div class="max-h-44 overflow-y-auto space-y-1 border-t border-amber-500/20 pt-2">
            {#if !debugEvents.length}
              <p class="text-amber-200/70">No events yet. Scroll down to trigger observer.</p>
            {:else}
              {#each debugEvents as eventLine, index (`${eventLine}-${index}`)}
                <p class="font-mono">{eventLine}</p>
              {/each}
            {/if}
          </div>
        </div>
      {/if}

      {#if reflectionModalOpen && selectedMatch}
        <div
          class="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-2 sm:p-4"
          role="button"
          tabindex="0"
          aria-label="Close journal modal"
          onclick={(event) => {
            if (event.target !== event.currentTarget) {
              return;
            }
            closeReflection();
          }}
          onkeydown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              closeReflection();
            }
          }}
        >
          <div
            class="journal-modal relative w-[min(96vw,750px)] bg-gray-900 border border-gray-700 rounded p-4 sm:p-6 shadow-lg max-h-[92vh] sm:max-h-[90vh] overflow-y-auto text-sm sm:text-base leading-relaxed"
          >
            <!-- Header with result color coding -->
            <div class="mb-4 flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <h2 class="text-xl font-bold mb-1">
                  Journal
                </h2>
                <p class="text-base text-gray-400">
                  Match: {selectedMatch.kda.kills}/{selectedMatch.kda
                    .deaths}/{selectedMatch.kda.assists} •
                  <span
                    class="font-bold {selectedMatch.result === 'win'
                      ? 'text-purple-400'
                      : 'text-pink-400'}"
                  >
                    {selectedMatch.result.toUpperCase()}
                  </span>
                </p>
              </div>
              <button
                onclick={closeReflection}
                class="text-gray-400 hover:text-gray-200 text-xl font-bold"
              >
                ×
              </button>
            </div>

            <!-- Tilt Break Alert -->
            {#if tiltState.isTilting && emotionalState === "😤 Tilted" && !tiltAlertDismissed}
              <div
                class="mb-4 p-3 rounded-lg border border-pink-600 bg-black/30"
                style="background-color: rgba(190,24,93,0.12); border: 1px solid #be185d;"
              >
                <div class="flex justify-between items-start">
                  <div class="flex gap-2">
                    <span class="text-pink-400 text-lg">⚠</span>
                    <p class="text-pink-400 text-base leading-relaxed">
                      You've lost 3 in a row and you're feeling tilted.
                      Seriously consider closing the client and taking a break.
                      Come back when you're reset.
                    </p>
                  </div>
                  <button
                    onclick={() => (tiltAlertDismissed = true)}
                    class="text-pink-400 hover:text-pink-300 font-bold ml-2 shrink-0"
                  >
                    ×
                  </button>
                </div>
              </div>
            {/if}

            <!-- Stats Dashboard Grid -->
            <div class="mb-4 p-4 bg-gray-800 rounded border border-gray-700">
              <h3 class="text-base font-semibold mb-3">Performance Stats</h3>
              <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <!-- CS/Min -->
                <div class="bg-gray-700 p-2.5 sm:p-3 rounded">
                  <p class="text-base text-gray-400 mb-1">CS/Min</p>
                  <p
                    class="text-xl sm:text-2xl font-bold {matchStats.csPerMin > 8
                      ? 'text-green-400'
                      : matchStats.csPerMin > 6
                        ? 'text-lime-400'
                        : matchStats.csPerMin > 4
                          ? 'text-yellow-400'
                          : 'text-red-400'}"
                  >
                    {matchStats.csPerMin.toFixed(2)}
                  </p>
                </div>

                <!-- Gold/Min -->
                <div class="bg-gray-700 p-2.5 sm:p-3 rounded">
                  <p class="text-base text-gray-400 mb-1">Gold/Min</p>
                  <p
                    class="text-xl sm:text-2xl font-bold {matchStats.goldPerMin > 550
                      ? 'text-green-400'
                      : matchStats.goldPerMin > 450
                        ? 'text-lime-400'
                        : matchStats.goldPerMin > 350
                          ? 'text-yellow-400'
                          : 'text-red-400'}"
                  >
                    {matchStats.goldPerMin.toFixed(2)}
                  </p>
                </div>

                <!-- Kill Participation -->
                <div class="bg-gray-700 p-2.5 sm:p-3 rounded">
                  <p class="text-base text-gray-400 mb-1">Kill Participation</p>
                  <p
                    class="text-xl sm:text-2xl font-bold {matchStats.kpPercent > 60
                      ? 'text-green-400'
                      : matchStats.kpPercent > 45
                        ? 'text-lime-400'
                        : matchStats.kpPercent > 30
                          ? 'text-yellow-400'
                          : 'text-red-400'}"
                  >
                    {matchStats.kpPercent.toFixed(1)}%
                  </p>
                </div>

                <!-- Death Contribution -->
                <div class="bg-gray-700 p-2.5 sm:p-3 rounded">
                  <p class="text-base text-gray-400 mb-1">Death Contribution</p>
                  <p
                    class="text-xl sm:text-2xl font-bold {matchStats.deathPercent < 20
                      ? 'text-green-400'
                      : matchStats.deathPercent < 35
                        ? 'text-lime-400'
                        : matchStats.deathPercent < 50
                          ? 'text-yellow-400'
                          : 'text-red-500'}"
                  >
                    {matchStats.deathPercent.toFixed(1)}%
                  </p>
                </div>

                <!-- CS at 10 -->
                <div class="bg-gray-700 p-2.5 sm:p-3 rounded">
                  <p class="text-base text-gray-400 mb-1">CS at 10</p>
                  <p
                    class="text-xl sm:text-2xl font-bold {matchStats.csAt10 === null
                      ? 'text-gray-500'
                      : matchStats.csAt10 >= 80
                        ? 'text-green-400'
                        : matchStats.csAt10 >= 65
                          ? 'text-lime-400'
                          : matchStats.csAt10 >= 50
                            ? 'text-yellow-400'
                            : 'text-red-400'}"
                  >
                    {isLoadingTimelineStats && matchStats.csAt10 === null
                      ? "..."
                      : matchStats.csAt10 === null
                      ? "-"
                      : matchStats.csAt10.toFixed(0)}
                  </p>
                </div>

                <!-- CS at 20 -->
                <div class="bg-gray-700 p-2.5 sm:p-3 rounded">
                  <p class="text-base text-gray-400 mb-1">CS at 20</p>
                  <p
                    class="text-xl sm:text-2xl font-bold {matchStats.csAt20 === null
                      ? 'text-gray-500'
                      : matchStats.csAt20 >= 165
                        ? 'text-green-400'
                        : matchStats.csAt20 >= 135
                          ? 'text-lime-400'
                          : matchStats.csAt20 >= 105
                            ? 'text-yellow-400'
                            : 'text-red-400'}"
                  >
                    {isLoadingTimelineStats && matchStats.csAt20 === null
                      ? "..."
                      : matchStats.csAt20 === null
                      ? "-"
                      : matchStats.csAt20.toFixed(0)}
                  </p>
                </div>
              </div>
            </div>

            <!-- Learning Objective Dropdown (Persistent) -->
            <div class="mb-4">
              <label
                for="learning-objective"
                class="block text-base font-semibold text-gray-300 mb-2"
                >Current Learning Objective</label
              >
              <div class="relative" bind:this={learningObjectiveDropdownEl}>
                <button
                  id="learning-objective"
                  type="button"
                  class="w-full px-3 py-2 bg-gray-900 border border-gray-600 rounded text-gray-300 text-base cursor-pointer hover:border-purple-500 focus:border-purple-500 focus:outline-none focus-visible:ring-1 focus-visible:ring-purple-500 flex items-center justify-between select-none"
                  style="background-color: #131620; border: 1px solid #252b3d; color: #e5e7eb;"
                  onclick={toggleLearningObjectiveDropdown}
                >
                  <span class={selectedObjective ? "" : "text-gray-400"}
                    >{selectedObjective || "Select an objective..."}</span
                  >
                  <ChevronDown
                    size={18}
                    class={`transition-transform ${
                      isLearningObjectiveOpen ? "rotate-180" : ""
                    }`}
                  />
                </button>

                {#if isLearningObjectiveOpen}
                  <div
                    class="absolute left-0 right-0 mt-1 z-20 rounded border border-gray-700 bg-gray-900 shadow-lg"
                    style="background-color: #131620; border: 1px solid #252b3d;"
                  >
                    <button
                      type="button"
                      class="w-full text-left px-3 py-2 text-base text-gray-300 hover:bg-gray-800 cursor-pointer select-none focus:outline-none focus:bg-gray-800 focus:text-purple-400"
                      onclick={() => {
                        updateObjective("");
                        isLearningObjectiveOpen = false;
                      }}
                    >
                      Select an objective...
                    </button>

                    {#each learningObjectives as objective, index (objective + "-" + index)}
                      <div class="flex items-center border-t border-gray-800">
                        <button
                          type="button"
                          class="flex-1 text-left px-3 py-2 text-base hover:bg-gray-800 cursor-pointer select-none focus:outline-none focus:bg-gray-800 {selectedObjective ===
                          objective
                            ? 'text-white'
                            : 'text-gray-300'}"
                          onclick={() => {
                            updateObjective(objective);
                            isLearningObjectiveOpen = false;
                          }}
                        >
                          {objective}
                        </button>
                        <button
                          type="button"
                          class="px-3 py-2 text-gray-400 hover:text-red-400 text-xl leading-none cursor-pointer"
                          aria-label={`Delete objective ${objective}`}
                          onclick={(event) => {
                            event.stopPropagation();
                            deleteLearningObjective(index);
                          }}
                        >
                          ×
                        </button>
                      </div>
                    {/each}

                    <div class="border-t border-gray-800">
                      <button
                        type="button"
                        class="w-full text-left px-3 py-2 text-base text-purple-400 hover:bg-gray-800 cursor-pointer select-none focus:outline-none focus:bg-gray-800 focus:text-purple-300"
                        onclick={(event) => {
                          event.stopPropagation();
                          updateObjective("__add__");
                        }}
                      >
                        Add new learning objective
                      </button>
                    </div>
                  </div>
                {/if}

                {#if isAddingObjective}
                  <div
                    class="mt-1 rounded border border-gray-700 bg-gray-900 shadow-lg"
                    style="background-color: #131620; border: 1px solid #252b3d;"
                  >
                    <div class="p-2 flex gap-2">
                      <input
                        type="text"
                        bind:this={learningObjectiveInputEl}
                        bind:value={learningObjectiveInput}
                        onkeydown={handleLearningObjectiveInputKeydown}
                        placeholder="Enter new objective..."
                        class="flex-1 px-3 py-2 bg-gray-800 border border-gray-600 rounded text-base text-gray-300 focus:border-purple-500 focus:outline-none focus-visible:ring-1 focus-visible:ring-purple-500"
                        style="background-color: #0c0e14; border: 1px solid #252b3d;"
                      />
                      <button
                        type="button"
                        onclick={addLearningObjective}
                        class="px-3 py-2 bg-purple-600 hover:bg-purple-700 rounded text-base font-semibold text-white cursor-pointer select-none"
                      >
                        Save
                      </button>
                      <button
                        type="button"
                        onclick={() => {
                          isAddingObjective = false;
                          learningObjectiveInput = "";
                        }}
                        class="px-3 py-2 bg-gray-700 hover:bg-gray-600 rounded text-base text-gray-200 cursor-pointer select-none"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                {/if}
              </div>
            </div>

            <!-- Objective Execution -->
            <div class="mb-4">
              <label
                for="objective-execution"
                class="block text-base font-semibold text-gray-300 mb-2"
                >Do you believe you executed on the objective?</label
              >
              <textarea
                id="objective-execution"
                bind:value={objectiveExecution}
                onblur={() =>
                  autoSaveReflectionField(
                    "objectiveExecution",
                    objectiveExecution,
                  )}
                class="w-full px-3 py-2 h-20 bg-gray-800 border border-gray-600 rounded text-base text-gray-300 resize-vertical"
                style="background-color: #0c0e14; border: 1px solid #252b3d; color: #e5e7eb; font-family: 'DM Sans', sans-serif; font-size: 16px;"
                placeholder="Your thoughts..."
              ></textarea>
            </div>

            <!-- Emotional State Slider (Per Match) -->
            <div class="mb-4">
              <label
                for="emotional-state-slider"
                class="block text-base font-semibold text-gray-300 mb-2"
                >How do you feel? ({emotionalState || scoreToEmotion(emotionalStateScore)})</label
              >
              <input
                id="emotional-state-slider"
                type="range"
                min="1"
                max="5"
                step="1"
                value={emotionalStateScore}
                oninput={(e) =>
                  updateEmotionalStateFromSlider(
                    Number((e.target as HTMLInputElement).value),
                  )}
                class="w-full accent-purple-500"
              />
              <div class="mt-2 grid grid-cols-5 gap-2 text-center text-sm text-gray-400">
                {#each emotionScale as emotion (emotion.score)}
                  <button
                    type="button"
                    class={`rounded px-2 py-1 border transition ${emotion.score === emotionalStateScore ? "border-purple-500 bg-purple-500/10 text-purple-300" : "border-gray-700 hover:border-gray-500"}`}
                    onclick={() => updateEmotionalStateFromSlider(emotion.score)}
                  >
                    <span>{emotion.score}. {emotion.value}</span>
                  </button>
                {/each}
              </div>
            </div>

            <!-- Reflection Questions -->
            <div class="space-y-3 mb-4">
              <!-- What went well -->
              <div>
                <label
                  for="went-well"
                  class="block text-base font-semibold text-gray-300 mb-2"
                  >What did you do well?</label
                >
                <textarea
                  id="went-well"
                  bind:value={wentWell}
                  onblur={() => autoSaveReflectionField("wentWell", wentWell)}
                  class="w-full px-3 py-2 h-20 bg-gray-800 border border-gray-600 rounded text-base text-gray-300 resize-vertical"
                  style="background-color: #0c0e14; border: 1px solid #252b3d; color: #e5e7eb; font-family: 'DM Sans', sans-serif; font-size: 16px;"
                  placeholder="Your thoughts..."
                ></textarea>
              </div>

              <!-- What could be better -->
              <div>
                <label
                  for="went-bad"
                  class="block text-base font-semibold text-gray-300 mb-2"
                  >What could you have done better?</label
                >
                <textarea
                  id="went-bad"
                  bind:value={wentBad}
                  onblur={() => autoSaveReflectionField("wentBad", wentBad)}
                  class="w-full px-3 py-2 h-20 bg-gray-800 border border-gray-600 rounded text-base text-gray-300 resize-vertical"
                  style="background-color: #0c0e14; border: 1px solid #252b3d; color: #e5e7eb; font-family: 'DM Sans', sans-serif; font-size: 16px;"
                  placeholder="Your thoughts..."
                ></textarea>
              </div>

              <!-- Emotional Reflection -->
              <div>
                <label
                  for="emotional-reflection"
                  class="block text-base font-semibold text-gray-300 mb-2"
                  >Emotional reflection — based on how you felt, why do you
                  think you played that way?</label
                >
                <textarea
                  id="emotional-reflection"
                  bind:value={emotionalReflection}
                  onblur={() =>
                    autoSaveReflectionField(
                      "emotionalReflection",
                      emotionalReflection,
                    )}
                  class="w-full px-3 py-2 h-20 bg-gray-800 border border-gray-600 rounded text-base text-gray-300 resize-vertical"
                  style="background-color: #0c0e14; border: 1px solid #252b3d; color: #e5e7eb; font-family: 'DM Sans', sans-serif; font-size: 16px;"
                  placeholder="Your thoughts..."
                ></textarea>
              </div>
            </div>

            <!-- Auto-save indicator -->
            {#if reflectionSaved}
              <div
                class="pointer-events-none absolute bottom-4 right-4 rounded-md border border-purple-500/50 bg-black/75 px-3 py-1.5 text-sm text-purple-300 shadow-lg animate-pulse"
                role="status"
                aria-live="polite"
              >
                Saved ✓
              </div>
            {/if}

            <!-- Modal Footer -->
            <div class="flex justify-end gap-2">
              <button
                class="px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded text-base font-semibold"
                onclick={closeReflection}>Close</button
              >
            </div>
          </div>
        </div>
      {/if}
    {:else}
      <p class="text-gray-400">Search for a summoner to view their profile.</p>
    {/if}
  </main>
</div>
