<script lang="ts">
  import { Sparkles } from "lucide-svelte";
  import { marked } from "marked";
  import { buildCoachingPayload } from "$lib/utils/coaching";
  import type { MatchSummaryResponse } from "$lib/types";
  import type { LeagueEntry, MatchHistoryStats } from "$lib/utils/coaching";

  const { match, history, playerPuuid, leagueEntry } = $props<{
    match: MatchSummaryResponse;
    history: MatchHistoryStats;
    playerPuuid: string;
    leagueEntry: LeagueEntry | null;
  }>();

  let isLoading = $state(false);
  let coachingText = $state("");
  let error = $state<string | null>(null);
  let hasReviewed = $state(false);

  const cache: Record<string, string> = {};
  const storageKey = $derived.by(
    () => `lol-coaching:${playerPuuid}:${match.matchId}`,
  );

  $effect(() => {
    if (typeof window === "undefined") return;
    const saved = localStorage.getItem(storageKey);
    if (saved) {
      coachingText = saved;
      cache[match.matchId] = saved;
      hasReviewed = true;
    }
  });

  async function reviewGame() {
    if (hasReviewed && coachingText) return;

    const matchId = match.matchId;
    if (cache[matchId]) {
      coachingText = cache[matchId];
      hasReviewed = true;
      return;
    }

    isLoading = true;
    error = null;
    coachingText = "";

    try {
      const payload = buildCoachingPayload(
        match,
        playerPuuid,
        [match],
        leagueEntry,
      );
      payload.history = history;

      const res = await fetch("/api/coaching", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || "Coaching review failed");
      }

      const reader = res.body?.getReader();
      if (!reader) throw new Error("No streaming body from server");

      const decoder = new TextDecoder();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        coachingText += decoder.decode(value, { stream: true });
      }

      // finalize trailing chunk
      coachingText += decoder.decode();
      cache[matchId] = coachingText;
      if (typeof window !== "undefined") {
        localStorage.setItem(storageKey, coachingText);
      }
      hasReviewed = true;
    } catch (err: any) {
      error = err?.message || "Failed to get coaching review";
    } finally {
      isLoading = false;
    }
  }
</script>

<div class="my-4 rounded-xl border border-amber-500 bg-zinc-900 p-4 text-white">
  {#if !hasReviewed}
    <button
      class="flex items-center gap-2 rounded-lg bg-zinc-950 px-4 py-2 text-sm font-semibold text-amber-200 hover:bg-zinc-800"
      onclick={reviewGame}
      disabled={isLoading}
    >
      <Sparkles class="h-5 w-5 text-amber-300" />
      Review this game
    </button>
  {/if}

  {#if isLoading}
    <div class="mt-3 animate-pulse text-amber-300">Analyzing...</div>
  {/if}

  {#if error}
    <div class="mt-3 rounded-md bg-red-900 p-2 text-sm text-red-100">
      {error}
    </div>
  {/if}

  {#if coachingText}
    <div class="prose prose-invert mt-3 max-w-none text-white coaching-prose">
      {@html marked(coachingText)}
    </div>
  {/if}
</div>

<style>
  :global(.coaching-prose h2) {
    color: #f59e0b;
  }
  :global(.coaching-prose h3) {
    color: #fbbf24;
  }
</style>
