<script lang="ts">
  import MatchCard from "$lib/components/MatchCard.svelte";
  import { profileStore } from "$lib/profile.svelte";
  import type { PageData } from "./$types";
  import type { ProfileData } from "$lib/types";
  import { buildHistoryStats } from "$lib/utils/coaching";
  import { Search } from "lucide-svelte";

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

  const regionOptions = [
    {
      value: "euw1",
      label: "EUW",
      gameNameExample: "Tarik",
      tagLineSuffix: "euw1",
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

  $effect(() => {
    if (data?.platform) selectedRegion = data.platform;
  });

  const gameNamePlaceholder = $derived.by(() => {
    const found = regionOptions.find((r) => r.value === selectedRegion);
    return found ? found.gameNameExample : "Tarik";
  });

  const tagLinePlaceholder = $derived.by(() => {
    const found = regionOptions.find((r) => r.value === selectedRegion);
    return found ? `#${found.tagLineSuffix}` : "#euw1";
  });

  async function handleSearch() {
    if (!gameName || !tagLine) return;
    if (!tagLine.startsWith("#")) {
      tagLineError = "Tag line must start with #";
      return;
    }
    tagLineError = "";
    loading = true;
    error = "";
    try {
      const trimmedGameName = gameName.trim();
      const normalizedTagLine = tagLine.trim();

      if (!trimmedGameName || !normalizedTagLine) {
        error = "Please enter both game name and tag line.";
        return;
      }

      // Strip the # from tagLine for the API request
      const cleanTagLine = normalizedTagLine.substring(1);
      const res = await fetch(
        `/api/summoner?gameName=${encodeURIComponent(trimmedGameName)}&tagLine=${encodeURIComponent(cleanTagLine)}&platform=${encodeURIComponent(selectedRegion)}`,
      );
      if (!res.ok) throw new Error(await res.text());
      const fetchedProfile: ProfileData | null = await res.json();
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

      // Store the search parameters for load more
      currentSearchGameName = trimmedGameName;
      currentSearchTagLine = cleanTagLine;
      // Clear the input fields after successful fetch
      gameName = "";
      tagLine = "";
      // Reset pagination state
      offset = 0;
      hasMore = true;
    } catch (err: any) {
      error = err.message;
    } finally {
      loading = false;
    }
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
    if (!currentProfile || isLoadingMore || !hasMore) return;

    isLoadingMore = true;
    try {
      const nextOffset = offset + 10;
      const res = await fetch(
        `/api/summoner?gameName=${encodeURIComponent(currentSearchGameName)}&tagLine=${encodeURIComponent(currentSearchTagLine)}&platform=${encodeURIComponent(selectedRegion)}&offset=${nextOffset}`,
      );
      if (!res.ok) throw new Error(await res.text());

      const response = await res.json();
      const newMatches = response.matches || [];

      // Append new matches to existing list
      if (currentProfile.matches) {
        currentProfile.matches = [...currentProfile.matches, ...newMatches];
      }

      // Update offset and check if there are more matches
      offset = nextOffset;
      if (newMatches.length < 10) {
        hasMore = false;
      }
    } catch (err: any) {
      console.error("Failed to load more matches:", err.message);
    } finally {
      isLoadingMore = false;
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

  let reflectionModalOpen = $state(false);
  let selectedMatch = $state<import("$lib/types").MatchSummaryResponse | null>(
    null,
  );
  let reflectionText = $state("");
  let reflectionError = $state("");
  let matchReflections = $state<Record<string, string>>({});
  let offset = $state(0);
  let isLoadingMore = $state(false);
  let hasMore = $state(true);
  let dismissed = $state(false);

  const currentProfileKey = $derived.by(() => {
    if (!currentProfile) return "";
    return `${currentProfile.summoner.puuid}`;
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

    return { csPerMin, goldPerMin, kpPercent, deathPercent };
  });

  function reflectionKey(matchId: string) {
    return `${currentProfileKey}:${matchId}`;
  }

  function openReflection(match: import("$lib/types").MatchSummaryResponse) {
    if (!currentProfile) return;
    selectedMatch = match;
    const key = reflectionKey(match.matchId);
    reflectionText = matchReflections[key] || "";
    reflectionError = "";
    reflectionModalOpen = true;
  }

  function closeReflection() {
    reflectionModalOpen = false;
    selectedMatch = null;
    reflectionText = "";
    reflectionError = "";
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

  $effect(() => {
    if (typeof window !== "undefined") {
      const stored = localStorage.getItem("lol-reflections");
      if (stored) {
        try {
          matchReflections = JSON.parse(stored);
        } catch (err) {
          console.error("Failed to parse stored reflections:", err);
        }
      }
    }
  });

  // Sync profileStore to localStorage
  $effect(() => {
    if (typeof window !== "undefined") {
      localStorage.setItem("lol-profiles", JSON.stringify(profileStore.list));
    }
  });
</script>

<div class="min-h-screen bg-gray-900 text-white flex">
  <!-- Sidebar -->
  <aside class="w-64 bg-gray-800 p-4">
    <h2 class="text-xl font-bold mb-4">Saved Profiles</h2>
    <ul class="space-y-2">
      {#each profileStore.list as profile, i}
        <li class="flex items-center gap-2">
          <button
            class="flex-1 text-left p-2 rounded hover:bg-gray-700 transition {i ===
            profileStore.activeIndex
              ? 'bg-gray-700'
              : ''}"
            onclick={() => {
              profileStore.setActive(i);
              loadProfile(profile);
            }}
          >
            {profile.gameName}{profile.tagLine}
          </button>
          <button
            type="button"
            class="px-2 py-1 text-xs bg-red-600 hover:bg-red-700 rounded"
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
  <main class="flex-1 p-6">
    <!-- Search -->
    <div class="mb-6">
      <!-- Region Select -->
      <div class="mb-4">
        <label for="platform" class="block text-sm font-medium mb-1"
          >Region</label
        >
        <select
          id="platform"
          bind:value={selectedRegion}
          class="w-40 p-2 bg-gray-800 border border-gray-600 rounded"
        >
          {#each regionOptions as region}
            <option value={region.value}>{region.label}</option>
          {/each}
        </select>
      </div>

      <!-- Game Name and Tag Line (connected) -->
      <div class="flex gap-2 items-end">
        <div class="flex-1">
          <label for="gameName" class="block text-sm font-medium mb-1"
            >Game Name</label
          >
          <input
            id="gameName"
            bind:value={gameName}
            class="w-full p-2 bg-gray-800 border border-gray-600 rounded"
            placeholder={gameNamePlaceholder}
          />
        </div>
        <div class="w-40">
          <label for="tagLine" class="block text-sm font-medium mb-1"
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
          onclick={handleSearch}
          disabled={loading}
          class="px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded flex items-center gap-2"
        >
          <Search size={16} />
          {loading ? "Searching..." : "Search"}
        </button>
      </div>

      {#if tagLineError}
        <p class="text-red-400 text-sm mt-2">{tagLineError}</p>
      {/if}
    </div>

    {#if error}
      <p class="text-red-400 mb-4">{error}</p>
    {/if}

    {#if currentProfile}
      <!-- Profile info -->
      <div class="mb-6 p-4 bg-gray-800 rounded">
        <div class="flex items-center gap-4">
          {#if currentProfile.summoner.profileIconId !== undefined && currentProfile.summoner.profileIconId !== null}
            <img
              src={`https://ddragon.leagueoflegends.com/cdn/14.24.1/img/profileicon/${currentProfile.summoner.profileIconId}.png`}
              alt={`${currentProfile.summoner.name} profile icon`}
              class="h-14 w-14 rounded-full border border-gray-600 object-cover"
              loading="lazy"
            />
          {/if}

          <div>
            <h1 class="text-2xl font-bold">{currentProfile.summoner.name}</h1>
            <p>Level: {currentProfile.summoner.level}</p>
            {#if winRate !== null}
              <p>Win Rate: {winRate}%</p>
            {/if}
          </div>
        </div>
      </div>

      {#if tiltState.isTilting && !dismissed}
        <div class="mb-4 bg-zinc-900 border-l-4 border-amber-500 p-3 rounded">
          <div class="flex items-center justify-between gap-3">
            <p class="text-sm text-amber-100">
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

      <!-- Matches -->
      <div class="grid gap-4">
        {#each currentProfile.matches as match (match.matchId)}
          <div class="relative">
            <MatchCard
              {match}
              history={computedHistory}
              playerPuuid={currentProfile.summoner.puuid}
              leagueEntry={null}
              onMatchSelect={openReflection}
            />
            {#if getReflection(match)}
              <span
                class="absolute top-2 right-2 px-2 py-1 text-xs bg-green-600 rounded"
              >
                Reflection saved
              </span>
            {/if}
          </div>
        {/each}
      </div>

      <!-- Load more button -->
      <div class="mt-6 flex justify-center">
        {#if hasMore}
          <button
            onclick={loadMore}
            disabled={isLoadingMore}
            class="px-6 py-2 bg-blue-600 hover:bg-blue-700 rounded disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isLoadingMore ? "Loading..." : "Load more"}
          </button>
        {:else}
          <p class="text-gray-400 text-center">All matches loaded</p>
        {/if}
      </div>

      {#if reflectionModalOpen && selectedMatch}
        <div
          class="fixed inset-0 bg-black/70 flex items-center justify-center z-50"
        >
          <div
            class="w-[min(95vw,700px)] bg-gray-900 border border-gray-700 rounded p-5 shadow-lg max-h-[90vh] overflow-y-auto"
          >
            <div class="flex justify-between items-center mb-3">
              <h2 class="text-xl font-bold">
                Journal reflection - {selectedMatch.champion}
              </h2>
            </div>

            <p class="text-sm text-gray-300 mb-3">
              Match: {selectedMatch.kda.kills}/{selectedMatch.kda
                .deaths}/{selectedMatch.kda.assists} • {selectedMatch.result.toUpperCase()}
            </p>

            <!-- Stats Dashboard Grid -->
            <div class="mb-4 p-4 bg-gray-800 rounded border border-gray-700">
              <h3 class="text-sm font-semibold mb-3">Performance Stats</h3>
              <div class="grid grid-cols-2 gap-3 mb-3">
                <!-- CS/Min -->
                <div class="bg-gray-700 p-3 rounded">
                  <p class="text-xs text-gray-400 mb-1">CS/Min</p>
                  <p
                    class="text-2xl font-bold {matchStats.csPerMin > 8
                      ? 'text-green-400'
                      : matchStats.csPerMin < 5
                        ? 'text-red-400'
                        : 'text-gray-300'}"
                  >
                    {matchStats.csPerMin.toFixed(2)}
                  </p>
                </div>

                <!-- Gold/Min -->
                <div class="bg-gray-700 p-3 rounded">
                  <p class="text-xs text-gray-400 mb-1">Gold/Min</p>
                  <p class="text-2xl font-bold text-yellow-400">
                    {matchStats.goldPerMin.toFixed(2)}
                  </p>
                </div>

                <!-- Kill Participation -->
                <div class="bg-gray-700 p-3 rounded">
                  <p class="text-xs text-gray-400 mb-1">Kill Participation</p>
                  <p
                    class="text-2xl font-bold {matchStats.kpPercent > 50
                      ? 'text-blue-400'
                      : 'text-gray-300'}"
                  >
                    {matchStats.kpPercent.toFixed(1)}%
                  </p>
                </div>

                <!-- Death Contribution -->
                <div class="bg-gray-700 p-3 rounded">
                  <p class="text-xs text-gray-400 mb-1">Death Contribution</p>
                  <p
                    class="text-2xl font-bold {matchStats.deathPercent > 50
                      ? 'text-red-500'
                      : 'text-gray-300'}"
                  >
                    {matchStats.deathPercent.toFixed(1)}%
                  </p>
                </div>
              </div>
            </div>

            <textarea
              bind:value={reflectionText}
              class="w-full h-32 p-2 mb-3 bg-gray-800 border border-gray-600 rounded resize-none"
              placeholder="Write your reflections about this match..."
            ></textarea>
            {#if reflectionError}
              <p class="text-red-400 mb-2">{reflectionError}</p>
            {/if}
            <div class="flex justify-end gap-2">
              <button
                class="px-3 py-2 bg-gray-700 hover:bg-gray-600 rounded"
                onclick={closeReflection}>Cancel</button
              >
              <button
                class="px-3 py-2 bg-blue-600 hover:bg-blue-700 rounded"
                onclick={saveReflection}>Save</button
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
