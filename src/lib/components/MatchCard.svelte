<script lang="ts">
  import type { MatchSummaryResponse } from "$lib/types";

  let { match, onMatchSelect }: { match: MatchSummaryResponse; onMatchSelect?: (match: MatchSummaryResponse) => void } = $props();

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
  <div class="flex justify-between items-center">
    <div>
      <h3 class="text-lg font-semibold">{match.champion}</h3>
      <p class="text-sm text-gray-300">
        {match.kda.kills}/{match.kda.deaths}/{match.kda.assists}
        {#if match.kda.ratio}
          ({match.kda.ratio.toFixed(2)} KDA)
        {/if}
      </p>
    </div>
    <div class="text-right">
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
