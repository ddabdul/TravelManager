// =========================
// Pure Utility Functions
// =========================

export function normalizePassengerNames(names) {
  const map = new Map();
  for (const raw of names) {
    if (!raw || typeof raw !== "string") continue;
    const cleaned = raw.trim().replace(/\s+/g, " ");
    if (!cleaned) continue;
    const key = cleaned.toLowerCase();
    if (!map.has(key)) {
      map.set(key, cleaned);
    }
  }
  return Array.from(map.values());
}

export function normalizeFlightNumber(flightNumber) {
  if (!flightNumber || typeof flightNumber !== "string") return "";
  return flightNumber.replace(/\s+/g, "").toUpperCase();
}

// IATA designator validation
export function isValidFlightNumber(str) {
  if (!str) return false;
  const trimmed = str.trim().toUpperCase();
  return /^[A-Z][A-Z0-9]{1,2}\s?\d{1,4}$/.test(trimmed);
}

// Date & Time Helpers
export function adjustIsoDateKeepingTime(isoString, newDateStr) {
  if (!isoString || !newDateStr) return isoString;
  const match = isoString.match(/T(.+)/);
  if (!match) return isoString;
  return `${newDateStr}T${match[1]}`;
}

export function formatFriendlyDate(dateStr) {
  if (!dateStr) return "";
  const d = new Date(dateStr + "T00:00:00");
  if (Number.isNaN(d.getTime())) return dateStr;
  return d.toLocaleDateString(undefined, {
    weekday: "short",
    year: "numeric",
    month: "short",
    day: "numeric"
  });
}

export function formatShortDate(dateStr) {
  if (!dateStr) return "";
  const d = new Date(dateStr + "T00:00:00");
  if (Number.isNaN(d.getTime())) return dateStr;
  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric"
  });
}

export function extractTime(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export function computeDurationMinutes(depIso, arrIso) {
  const d1 = new Date(depIso);
  const d2 = new Date(arrIso);
  if (Number.isNaN(d1.getTime()) || Number.isNaN(d2.getTime())) return null;
  const diffMs = d2.getTime() - d1.getTime();
  return Math.round(diffMs / 60000);
}

export function formatDuration(mins) {
  if (mins == null || !Number.isFinite(mins) || mins <= 0) return "";
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h && m) return `${h}h ${m}m`;
  if (h) return `${h}h`;
  return `${m}m`;
}

export function computeNights(checkIn, checkOut) {
  if (!checkIn || !checkOut) return null;
  const d1 = new Date(checkIn + "T00:00:00");
  const d2 = new Date(checkOut + "T00:00:00");
  if (Number.isNaN(d1.getTime()) || Number.isNaN(d2.getTime())) return null;
  const diffMs = d2.getTime() - d1.getTime();
  return Math.round(diffMs / (24 * 60 * 60 * 1000));
}

export function generateHotelId() {
  return (
    "H-" +
    Date.now().toString(36).toUpperCase() +
    "-" +
    Math.random().toString(36).substring(2, 6).toUpperCase()
  );
}

export function cloneRouteWithDate(route, flightDate) {
  if (!route) return null;
  const cloned = JSON.parse(JSON.stringify(route));
  if (cloned.departure && cloned.departure.scheduled && flightDate) {
    cloned.departure.scheduled = adjustIsoDateKeepingTime(
      cloned.departure.scheduled,
      flightDate
    );
  }
  if (cloned.arrival && cloned.arrival.scheduled && flightDate) {
    cloned.arrival.scheduled = adjustIsoDateKeepingTime(
      cloned.arrival.scheduled,
      flightDate
    );
  }
  return cloned;
}