<script lang="ts">
  import { onMount } from "svelte";
  import { browser } from "$app/environment";
  import { Sparkles } from "lucide-svelte";
  import { buildCoachingPayload, buildHistoryStats } from "$lib/utils/coaching";
  import type { MatchSummaryResponse } from "$lib/types";
  import type {
    LeagueEntry,
    MatchHistoryStats,
    TimelineCoachingSignals,
  } from "$lib/utils/coaching";

  const {
    match,
    history,
    recentMatches = [],
    playerPuuid,
    leagueEntry,
    learningObjectives = [],
  } = $props<{
    match: MatchSummaryResponse;
    history: MatchHistoryStats;
    recentMatches?: MatchSummaryResponse[];
    playerPuuid: string;
    leagueEntry: LeagueEntry | null;
    learningObjectives?: string[];
  }>();

  const inferredPlatform = $derived.by(() => {
    const prefix = match.matchId?.split("_")[0]?.toLowerCase();
    return prefix || "euw1";
  });

  let isLoading = $state(false);
  let coachingText = $state("");
  let error = $state<string | null>(null);
  let hasReviewed = $state(false);
  let aiConsent = $state<"granted" | "denied" | null>(null);

  const aiConsentStorageKey = "soloq:ai-consent-v1";
  const COACHING_TIMELINE_TIMEOUT_MS = 1800;

  const cache: Record<string, string> = {};
  const storageKey = $derived.by(
    () => `lol-coaching:${playerPuuid}:${match.matchId}`,
  );

  onMount(() => {
    const consentValue = localStorage.getItem(aiConsentStorageKey);
    if (consentValue === "granted" || consentValue === "denied") {
      aiConsent = consentValue;
    }

    const saved = localStorage.getItem(storageKey);
    if (saved) {
      coachingText = saved;
      cache[match.matchId] = saved;
      hasReviewed = true;
      if (aiConsent !== "granted") {
        return;
      }
    }

    if (aiConsent === "granted") {
      void reviewGame();
    }
  });

  function grantAiConsent() {
    aiConsent = "granted";
    localStorage.setItem(aiConsentStorageKey, "granted");
    void reviewGame();
  }

  function denyAiConsent() {
    aiConsent = "denied";
    localStorage.setItem(aiConsentStorageKey, "denied");
    coachingText = "";
    error = null;
  }

  const coachingLines = $derived.by(() => {
    if (!coachingText) return [];
    return coachingText
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
  });

  type BoldSegment = {
    text: string;
    bold: boolean;
  };

  function splitBoldSegments(text: string): BoldSegment[] {
    const segments: BoldSegment[] = [];
    const regex = /\*\*(.+?)\*\*/g;
    let lastIndex = 0;
    let match: RegExpExecArray | null;

    while ((match = regex.exec(text)) !== null) {
      const plainText = text.slice(lastIndex, match.index);
      if (plainText) {
        segments.push({ text: plainText, bold: false });
      }

      segments.push({ text: match[1], bold: true });
      lastIndex = match.index + match[0].length;
    }

    const trailingText = text.slice(lastIndex);
    if (trailingText) {
      segments.push({ text: trailingText, bold: false });
    }

    if (segments.length === 0) {
      segments.push({ text, bold: false });
    }

    return segments;
  }

  async function getTimelineSignalsForCoaching(): Promise<
    TimelineCoachingSignals | undefined
  > {
    if (!browser) return undefined;
    const matchTimeline = match.timelineInsights;
    const hasInMemorySignals =
      Array.isArray(matchTimeline?.deathTimestampsMinutes) &&
      Array.isArray(matchTimeline?.csDropAfterDeaths) &&
      Array.isArray(matchTimeline?.majorTeamfights);

    if (hasInMemorySignals) {
      return {
        csAt10:
          typeof match.stats.csAt10 === "number" ? match.stats.csAt10 : null,
        csAt20:
          typeof match.stats.csAt20 === "number" ? match.stats.csAt20 : null,
        deathTimestampsMinutes: matchTimeline?.deathTimestampsMinutes ?? [],
        csDropAfterDeaths: matchTimeline?.csDropAfterDeaths ?? [],
        biggestCsDropWindow: matchTimeline?.biggestCsDropWindow ?? null,
        majorTeamfights: matchTimeline?.majorTeamfights ?? [],
      };
    }

    const params = new URLSearchParams({
      matchId: match.matchId,
      puuid: playerPuuid,
      platform: inferredPlatform,
    });

    const res = await fetch(`/api/match?${params.toString()}`);
    if (!res.ok) {
      return undefined;
    }

    const payload = await res.json();
    const timeline = payload?.timeline ?? {};

    return {
      csAt10:
        typeof payload?.stats?.csAt10 === "number"
          ? payload.stats.csAt10
          : null,
      csAt20:
        typeof payload?.stats?.csAt20 === "number"
          ? payload.stats.csAt20
          : null,
      deathTimestampsMinutes: Array.isArray(timeline.deathTimestampsMinutes)
        ? timeline.deathTimestampsMinutes
        : [],
      csDropAfterDeaths: Array.isArray(timeline.csDropAfterDeaths)
        ? timeline.csDropAfterDeaths
        : [],
      biggestCsDropWindow: timeline.biggestCsDropWindow ?? null,
      majorTeamfights: Array.isArray(timeline.majorTeamfights)
        ? timeline.majorTeamfights
        : [],
    };
  }

  function platformFromMatchId(matchId: string): string {
    return matchId?.split("_")[0]?.toLowerCase() || inferredPlatform;
  }

  async function withTimeout<T>(
    promise: Promise<T>,
    timeoutMs: number,
  ): Promise<T | undefined> {
    let timeoutHandle: ReturnType<typeof setTimeout> | undefined;

    const timeoutPromise = new Promise<undefined>((resolve) => {
      timeoutHandle = setTimeout(() => resolve(undefined), timeoutMs);
    });

    try {
      return await Promise.race([promise, timeoutPromise]);
    } finally {
      if (timeoutHandle) {
        clearTimeout(timeoutHandle);
      }
    }
  }

  async function enrichRecentMatchesForPattern(
    sourceMatches: MatchSummaryResponse[],
  ): Promise<MatchSummaryResponse[]> {
    if (!browser) return sourceMatches;
    if (!sourceMatches.length) return [];

    const limited = sourceMatches.slice(0, 6);

    const enriched = await Promise.all(
      limited.map(async (entry) => {
        const hasTimeline =
          Array.isArray(entry.timelineInsights?.deathTimestampsMinutes) &&
          entry.timelineInsights!.deathTimestampsMinutes.length > 0;

        if (hasTimeline) {
          return entry;
        }

        try {
          const params = new URLSearchParams({
            matchId: entry.matchId,
            puuid: playerPuuid,
            platform: platformFromMatchId(entry.matchId),
          });

          const res = await fetch(`/api/match?${params.toString()}`);
          if (!res.ok) return entry;

          const payload = await res.json();
          const timeline = payload?.timeline;
          if (!timeline) return entry;

          return {
            ...entry,
            timelineInsights: {
              deathTimestampsMs: [],
              deathTimestampsMinutes: Array.isArray(
                timeline.deathTimestampsMinutes,
              )
                ? timeline.deathTimestampsMinutes
                : [],
              csDropAfterDeaths: Array.isArray(timeline.csDropAfterDeaths)
                ? timeline.csDropAfterDeaths
                : [],
              biggestCsDropWindow: timeline.biggestCsDropWindow ?? null,
              majorTeamfights: Array.isArray(timeline.majorTeamfights)
                ? timeline.majorTeamfights
                : [],
            },
          } satisfies MatchSummaryResponse;
        } catch {
          return entry;
        }
      }),
    );

    return enriched;
  }

  async function reviewGame() {
    if (hasReviewed && coachingText) return;
    if (aiConsent !== "granted") {
      error = null;
      return;
    }

    const matchId = match.matchId;
    if (cache[matchId]) {
      coachingText = cache[matchId];
      hasReviewed = true;
      return;
    }

    isLoading = true;
    error = null;
    coachingText = "";

    const reviewStartMs = performance.now();
    let firstChunkLogged = false;

    try {
      const timelineStartMs = performance.now();
      const timelineSignals = await withTimeout(
        getTimelineSignalsForCoaching(),
        COACHING_TIMELINE_TIMEOUT_MS,
      );
      const timelineElapsedMs = Math.round(performance.now() - timelineStartMs);
      const matchesForHistory =
        recentMatches.length > 0 ? recentMatches : [match];

      void enrichRecentMatchesForPattern(matchesForHistory).catch(() => {
        // Keep the coaching fast path unblocked if history enrichment is slow.
      });

      const payload = buildCoachingPayload(
        match,
        playerPuuid,
        matchesForHistory,
        leagueEntry,
        timelineSignals,
        learningObjectives,
      );

      const coachingFetchStartMs = performance.now();
      const res = await fetch("/api/coaching", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-AI-Consent": "granted",
        },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || "Coaching review failed");
      }

      const reader = res.body?.getReader();
      if (!reader) throw new Error("No streaming body from server");

      const decoder = new TextDecoder();
      let streamChunkCount = 0;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        if (!firstChunkLogged) {
          firstChunkLogged = true;
          console.info(
            `[COACHING][CLIENT_FIRST_CHUNK] ms=${Math.round(performance.now() - coachingFetchStartMs)} timelineMs=${timelineElapsedMs}`,
          );
        }

        streamChunkCount += 1;
        coachingText += decoder.decode(value, { stream: true });
      }

      // finalize trailing chunk
      coachingText += decoder.decode();
      cache[matchId] = coachingText;
      if (typeof window !== "undefined") {
        localStorage.setItem(storageKey, coachingText);
      }
      hasReviewed = true;

      console.info(
        `[COACHING][CLIENT_DONE] totalMs=${Math.round(performance.now() - reviewStartMs)} streamChunks=${streamChunkCount} timelineMs=${timelineElapsedMs}`,
      );
    } catch (err: any) {
      error = err?.message || "Failed to get coaching review";
    } finally {
      isLoading = false;
    }
  }
</script>

<div class="coaching-panel-shell">
  {#if aiConsent !== "granted"}
    <div
      class="coaching-consent-box"
      role="region"
      aria-label="AI coaching consent"
    >
      <p>
        AI coaching sends selected match stats to the coaching provider. Please
        grant consent to generate coaching.
      </p>
      <div class="coaching-consent-actions">
        <button type="button" class="consent-primary" onclick={grantAiConsent}>
          Enable AI coaching
        </button>
        <button type="button" class="consent-secondary" onclick={denyAiConsent}>
          Keep coaching disabled
        </button>
        <a href="/privacy" class="consent-link">Privacy details</a>
      </div>
    </div>
  {/if}

  {#if isLoading}
    <div class="coaching-loading-row" aria-live="polite">
      <Sparkles size={15} />
      <span>Running AI coaching analysis...</span>
    </div>
  {/if}

  {#if error}
    <div class="coaching-error-box" role="alert">
      {error}
    </div>
  {/if}

  {#if coachingText}
    <div class="coaching-output coaching-prose" aria-live="polite">
      {#each coachingLines as line, index (index)}
        {#if line.startsWith("## ")}
          <h2>
            {#each splitBoldSegments(line
                .slice(3)
                .trim()) as segment, segmentIndex (segmentIndex)}
              {#if segment.bold}
                <strong>{segment.text}</strong>
              {:else}
                {segment.text}
              {/if}
            {/each}
          </h2>
        {:else if line.startsWith("### ")}
          <h3>
            {#each splitBoldSegments(line
                .slice(4)
                .trim()) as segment, segmentIndex (segmentIndex)}
              {#if segment.bold}
                <strong>{segment.text}</strong>
              {:else}
                {segment.text}
              {/if}
            {/each}
          </h3>
        {:else if line.startsWith("- ")}
          <p class="coaching-bullet">
            {#each splitBoldSegments(line
                .slice(2)
                .trim()) as segment, segmentIndex (segmentIndex)}
              {#if segment.bold}
                <strong>{segment.text}</strong>
              {:else}
                {segment.text}
              {/if}
            {/each}
          </p>
        {:else}
          <p>
            {#each splitBoldSegments(line) as segment, segmentIndex (segmentIndex)}
              {#if segment.bold}
                <strong>{segment.text}</strong>
              {:else}
                {segment.text}
              {/if}
            {/each}
          </p>
        {/if}
      {/each}
    </div>
  {/if}
</div>

<style>
  .coaching-panel-shell {
    margin-top: 0.2rem;
    width: 100%;
    max-width: none;
    border-radius: 14px;
    border: 1px solid rgba(124, 58, 237, 0.2);
    background: radial-gradient(
        circle at top right,
        rgba(124, 58, 237, 0.1),
        transparent 46%
      ),
      radial-gradient(
        circle at top left,
        rgba(59, 130, 246, 0.08),
        transparent 42%
      ),
      var(--card-bg);
    padding: 1.15rem 1.25rem;
    box-shadow: 0 16px 34px rgba(15, 23, 42, 0.08);
  }

  .coaching-loading-row {
    display: inline-flex;
    align-items: center;
    gap: 0.55rem;
    border-radius: 9999px;
    border: 1px solid rgba(124, 58, 237, 0.22);
    background-color: rgba(124, 58, 237, 0.08);
    padding: 0.36rem 0.72rem;
    font-size: 0.8rem;
    font-weight: 600;
    color: var(--text-primary);
    animation: coaching-pulse 1.2s ease-in-out infinite;
  }

  .coaching-consent-box {
    border-radius: 12px;
    border: 1px solid rgba(148, 163, 184, 0.38);
    background-color: rgba(139, 92, 246, 0.08);
    padding: 0.75rem 0.85rem;
    font-size: 0.8rem;
    line-height: 1.4;
    color: var(--text-primary);
  }

  .coaching-consent-actions {
    margin-top: 0.6rem;
    display: flex;
    flex-wrap: wrap;
    gap: 0.45rem;
  }

  .consent-primary,
  .consent-secondary {
    border-radius: 9999px;
    padding: 0.35rem 0.7rem;
    font-size: 0.78rem;
    font-weight: 600;
  }

  .consent-primary {
    border: 1px solid rgba(91, 33, 182, 0.95);
    background: var(--primary);
    color: var(--primary-foreground);
  }

  .consent-primary:hover {
    filter: brightness(1.05);
  }

  .consent-secondary {
    border: 1px solid rgba(148, 163, 184, 0.7);
    background: var(--card-bg);
    color: var(--text-primary);
  }

  .consent-link {
    align-self: center;
    color: var(--primary);
    text-decoration: underline;
    text-underline-offset: 2px;
    font-size: 0.78rem;
  }

  .coaching-error-box {
    margin-top: 0.65rem;
    border-radius: 10px;
    border: 1px solid rgba(248, 113, 113, 0.45);
    background-color: rgba(127, 29, 29, 0.34);
    padding: 0.55rem 0.7rem;
    font-size: 0.82rem;
    color: #b91c1c;
  }

  .coaching-output {
    margin-top: 0.68rem;
    border-radius: 12px;
    border: 1px solid rgba(99, 102, 241, 0.24);
    background: linear-gradient(
      180deg,
      rgba(25, 28, 42, 0.8),
      rgba(20, 24, 36, 0.95)
    );
    padding: 0.95rem 1rem;
    color: var(--text-primary);
    max-width: none;
  }

  @media (prefers-color-scheme: light) {
    .coaching-output {
      background: linear-gradient(
        180deg,
        rgba(255, 255, 255, 0.92),
        rgba(237, 233, 254, 0.68)
      );
    }
  }

  @keyframes coaching-pulse {
    0%,
    100% {
      box-shadow: 0 0 0 rgba(139, 92, 246, 0);
      transform: translateY(0);
    }
    50% {
      box-shadow: 0 0 0.8rem rgba(139, 92, 246, 0.28);
      transform: translateY(-1px);
    }
  }

  :global(.coaching-prose h2) {
    margin: 0.1rem 0 0.5rem;
    color: var(--primary);
    font-size: 0.98rem;
    letter-spacing: 0.01em;
  }

  :global(.coaching-prose h3) {
    margin: 0.75rem 0 0.4rem;
    color: #6d28d9;
    font-size: 0.88rem;
  }

  :global(.coaching-prose p) {
    margin: 0.35rem 0;
    font-size: 0.84rem;
    line-height: 1.45;
    color: var(--text-primary);
  }

  :global(.coaching-prose .coaching-bullet) {
    position: relative;
    margin: 0.3rem 0;
    padding-left: 0.9rem;
  }

  :global(.coaching-prose .coaching-bullet::before) {
    content: "";
    position: absolute;
    top: 0.53rem;
    left: 0.18rem;
    width: 0.32rem;
    height: 0.32rem;
    border-radius: 9999px;
    background-color: var(--primary);
  }

  :global(.coaching-prose strong) {
    color: #c4b5fd;
  }

  @media (prefers-color-scheme: light) {
    :global(.coaching-prose strong) {
      color: #0f172a;
    }
  }

  @media (max-width: 640px) {
    .coaching-panel-shell {
      padding: 0.88rem 0.82rem;
    }

    .coaching-loading-row {
      width: 100%;
      justify-content: center;
      font-size: 0.75rem;
    }

    .coaching-output {
      padding: 0.78rem 0.78rem;
      margin-top: 0.6rem;
    }

    :global(.coaching-prose h2) {
      font-size: 0.92rem;
    }

    :global(.coaching-prose h3) {
      font-size: 0.84rem;
    }

    :global(.coaching-prose p) {
      font-size: 0.8rem;
    }
  }
</style>
