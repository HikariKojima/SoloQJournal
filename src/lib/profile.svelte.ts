/**
 * This file defines a class-based Rune store for managing saved League of Legends profiles.
 * It uses the .svelte.ts extension to enable Svelte 5 runes ($state, $derived, $effect) outside of components.
 * In SvelteKit, stores in lib/ can be imported anywhere; this one handles persistence and active profile state.
 * Key concept: Runes provide reactive state without Svelte components; $effect runs side effects like localStorage sync.
 * Example: profileStore.active gives the current profile; changes to list auto-save to localStorage.
 */

import type { SavedProfile } from "$lib/types";

class ProfileStore {
  list = $state<SavedProfile[]>([]);
  activeIndex = $state<number>(0);

  active = $derived(this.list[this.activeIndex] || null);

  private normalizeProfilePart(value: string | null | undefined): string {
    return value?.trim().toLowerCase() ?? "";
  }

  private getProfileIdentity(profile: Pick<SavedProfile, "gameName" | "tagLine" | "region">): string {
    const gameName = this.normalizeProfilePart(profile.gameName);
    const tagLine = this.normalizeProfilePart(profile.tagLine);
    const region = this.normalizeProfilePart(profile.region) || "euw1";
    return `${gameName}|${tagLine}|${region}`;
  }

  private isValidSavedProfile(value: unknown): value is SavedProfile {
    if (!value || typeof value !== "object") return false;

    const candidate = value as Partial<SavedProfile>;
    return (
      typeof candidate.gameName === "string" &&
      typeof candidate.tagLine === "string" &&
      typeof candidate.region === "string" &&
      typeof candidate.lastFetched === "string" &&
      Array.isArray(candidate.matches) &&
      typeof candidate.summoner === "object" &&
      candidate.summoner !== null
    );
  }

  constructor() {
    // Load from localStorage on init
    if (typeof window !== "undefined") {
      const stored = localStorage.getItem("lol-profiles");
      if (stored) {
        try {
          const parsed = JSON.parse(stored);
          const entries = Array.isArray(parsed) ? parsed : [];
          const dedupedByIdentity = new Map<string, SavedProfile>();

          for (const entry of entries) {
            if (!this.isValidSavedProfile(entry)) {
              continue;
            }

            const identity = this.getProfileIdentity(entry);
            const existing = dedupedByIdentity.get(identity);

            if (!existing) {
              dedupedByIdentity.set(identity, entry);
              continue;
            }

            const existingTimestamp = Date.parse(existing.lastFetched);
            const candidateTimestamp = Date.parse(entry.lastFetched);
            const shouldReplace =
              Number.isFinite(candidateTimestamp) &&
              (!Number.isFinite(existingTimestamp) ||
                candidateTimestamp >= existingTimestamp);

            if (shouldReplace) {
              dedupedByIdentity.set(identity, entry);
            }
          }

          this.list = Array.from(dedupedByIdentity.values());
          this.activeIndex = Math.min(
            this.activeIndex,
            Math.max(0, this.list.length - 1),
          );
          // Persist cleaned data so migration runs once for legacy duplicates.
          localStorage.setItem("lol-profiles", JSON.stringify(this.list));
        } catch (err) {
          console.error("Failed to parse stored profiles:", err);
        }
      }
    }
  }

  addProfile(profile: SavedProfile) {
    const identity = this.getProfileIdentity(profile);
    const existingIndex = this.list.findIndex(
      (p) => this.getProfileIdentity(p) === identity,
    );

    if (existingIndex !== -1) {
      // Update existing profile with new data and set as active
      this.list[existingIndex] = profile;
      this.activeIndex = existingIndex;
    } else {
      this.list.push(profile);
      this.activeIndex = this.list.length - 1;
    }
  }

  setActive(index: number) {
    if (index >= 0 && index < this.list.length) {
      this.activeIndex = index;
    }
  }

  removeProfile(index: number) {
    if (index >= 0 && index < this.list.length) {
      this.list.splice(index, 1);
      if (this.activeIndex >= this.list.length) {
        this.activeIndex = Math.max(0, this.list.length - 1);
      }
    }
  }
}

export const profileStore = new ProfileStore();
