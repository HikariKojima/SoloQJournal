<script lang="ts">
  import MatchCard from "$lib/components/MatchCard.svelte";
  import { profileStore } from "$lib/profile.svelte";
  import type { PageData } from "./$types";
  import type { ProfileData } from "$lib/types";
  import { Search, Save } from "lucide-svelte";

  let { data }: { data: PageData } = $props();

  let gameName = $state("");
  let tagLine = $state("");
  let selectedRegion = $state("euw1");
  let searchedProfile = $state<ProfileData>(null);
  let loading = $state(false);
  let error = $state("");
  let tagLineError = $state("");

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
      // Strip the # from tagLine for the API request
      const cleanTagLine = tagLine.substring(1);
      const res = await fetch(
        `/api/summoner?gameName=${encodeURIComponent(gameName)}&tagLine=${encodeURIComponent(cleanTagLine)}&platform=${encodeURIComponent(selectedRegion)}`,
      );
      if (!res.ok) throw new Error(await res.text());
      searchedProfile = await res.json();
    } catch (err: any) {
      error = err.message;
    } finally {
      loading = false;
    }
  }

  function saveProfile() {
    if (!searchedProfile) return;
    const profile = {
      gameName,
      tagLine,
      summoner: searchedProfile.summoner,
      matches: searchedProfile.matches,
      lastFetched: new Date().toISOString(),
    };
    profileStore.addProfile(profile);
  }

  const currentProfile = $derived(searchedProfile || data.profileData);

  const winRate = $derived.by(() => {
    if (!currentProfile?.matches.length) return null;
    const wins = currentProfile.matches.filter(
      (m) => m.result === "win",
    ).length;
    return Math.round((wins / currentProfile.matches.length) * 100);
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
        <li>
          <button
            class="w-full text-left p-2 rounded hover:bg-gray-700 {i ===
            profileStore.activeIndex
              ? 'bg-gray-700'
              : ''}"
            onclick={() => profileStore.setActive(i)}
          >
            {profile.gameName}#{profile.tagLine}
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
        {#if searchedProfile}
          <button
            onclick={saveProfile}
            class="px-4 py-2 bg-green-600 hover:bg-green-700 rounded flex items-center gap-2"
          >
            <Save size={16} />
            Save Profile
          </button>
        {/if}
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
        <h1 class="text-2xl font-bold">{currentProfile.summoner.name}</h1>
        <p>Level: {currentProfile.summoner.level}</p>
        {#if winRate !== null}
          <p>Win Rate: {winRate}%</p>
        {/if}
      </div>

      <!-- Matches -->
      <div class="grid gap-4">
        {#each currentProfile.matches as match}
          <MatchCard {match} />
        {/each}
      </div>
    {:else}
      <p class="text-gray-400">Search for a summoner to view their profile.</p>
    {/if}
  </main>
</div>
