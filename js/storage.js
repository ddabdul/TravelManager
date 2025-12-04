// =========================
// Storage Handling
// =========================

import { STORAGE_KEY } from "./config.js";

export function loadTrips() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.map((t) => ({
      ...t,
      records: Array.isArray(t.records) ? t.records : [],
      hotels: Array.isArray(t.hotels) ? t.hotels : []
    }));
  } catch (e) {
    console.error("Failed to parse stored trips", e);
    return [];
  }
}

export function saveTrips(trips) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(trips, null, 2));
}