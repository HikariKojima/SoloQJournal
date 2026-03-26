<script lang="ts">
  import { Sparkles, ChevronDown } from "lucide-svelte";
  import { slide } from "svelte/transition";
  import CoachingPanel from "$lib/components/CoachingPanel.svelte";
  import type { MatchSummaryResponse } from "$lib/types";
  import type { LeagueEntry, MatchHistoryStats } from "$lib/utils/coaching";
  import { championIcon } from "$lib/utils/ddragon";

  let {
    match,
    history,
    playerPuuid,
    leagueEntry,
    onMatchSelect,
  }: {
    match: MatchSummaryResponse;
    history: MatchHistoryStats;
    playerPuuid: string;
    leagueEntry: LeagueEntry | null;
    onMatchSelect?: (match: MatchSummaryResponse) => void;
  } = $props();

  let showCoaching = $state(false);
  let championImageFailed = $state(false);

  const csPerMin = $derived.by(() => {
    if (match.durationSeconds === 0) return 0;
    return (
      Math.round((match.stats.cs / (match.durationSeconds / 60)) * 10) / 10
    );
  });

  const borderColor = $derived(
    match.result === "win" ? "border-l-blue-500" : "border-l-red-500",
  );
</script>

<div
  role="button"
  tabindex="0"
  class="cursor-pointer bg-gray-800 border-l-4 {borderColor} p-4 rounded shadow hover:scale-105 transition-transform"
  onclick={() => onMatchSelect?.(match)}
  onkeydown={(event: KeyboardEvent) => {
    if (event.key === "Enter" || event.key === " ") {
      onMatchSelect?.(match);
      event.preventDefault();
    }
  }}
>
  <div class="flex justify-between items-center gap-4">
    <div class="flex items-center gap-3">
      {#if championImageFailed}
        <div
          class="flex items-center justify-center text-sm font-semibold bg-gray-700 text-gray-100 ring-2 {match.result ===
          'win'
            ? 'ring-blue-500'
            : 'ring-red-500'}"
          style="width: 56px; height: 56px; border-radius: 50%;"
        >
          {match.champion.slice(0, 2).toUpperCase()}
        </div>
      {:else}
        <img
          src={championIcon(match.champion.replaceAll(" ", ""))}
          alt={match.champion}
          width="56"
          height="56"
          class="ring-2 {match.result === 'win'
            ? 'ring-blue-500'
            : 'ring-red-500'}"
          style="width: 56px; height: 56px; border-radius: 50%; object-fit: cover;"
          onerror={() => {
            championImageFailed = true;
          }}
        />
      {/if}
      <div>
        <h3 class="text-lg font-semibold">{match.champion}</h3>
        <p class="text-sm text-gray-300">
          {match.kda.kills}/{match.kda.deaths}/{match.kda.assists}
          {#if match.kda.ratio}
            ({match.kda.ratio.toFixed(2)} KDA)
          {/if}
        </p>
      </div>
    </div>
    <div class="text-right flex items-center gap-3">
      <button
        type="button"
        class="inline-flex items-center gap-2 rounded-md border border-amber-500 bg-zinc-900 px-3 py-1.5 text-xs font-semibold text-amber-200 hover:bg-zinc-800"
        onclick={(event) => {
          event.stopPropagation();
          showCoaching = !showCoaching;
        }}
      >
        <Sparkles class="h-4 w-4" />
        AI Coach
        <ChevronDown
          class={`h-4 w-4 transition-transform ${showCoaching ? "rotate-180" : ""}`}
        />
      </button>

      <div>
        <p class="text-sm">CS/min: {csPerMin}</p>
        <p class="text-sm">
          Duration: {Math.floor(match.durationSeconds / 60)}:{(
            match.durationSeconds % 60
          )
            .toString()
            .padStart(2, "0")}
        </p>
      </div>
    </div>
  </div>

  {#if showCoaching}
    <button
      type="button"
      class="mt-4"
      transition:slide={{ duration: 150 }}
      onclick={(event) => event.stopPropagation()}
    >
      <CoachingPanel {match} {history} {playerPuuid} {leagueEntry} />
    </button>
  {/if}
</div>
