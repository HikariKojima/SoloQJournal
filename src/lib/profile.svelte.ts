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

  constructor() {
    // Load from localStorage on init
    if (typeof window !== "undefined") {
      const stored = localStorage.getItem("lol-profiles");
      if (stored) {
        try {
          this.list = JSON.parse(stored);
        } catch (err) {
          console.error("Failed to parse stored profiles:", err);
        }
      }
    }
  }

  addProfile(profile: SavedProfile) {
    this.list.push(profile);
    this.activeIndex = this.list.length - 1;
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
