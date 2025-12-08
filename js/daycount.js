// =========================
// Day Count Helpers (per-passenger, per-country, per-month)
// =========================

import { getPassengerFlights } from "./flights.js";

export function getPassengerYears(trips, passengerName) {
  const years = new Set();
  for (const f of getPassengerFlights(trips, passengerName)) {
    years.add(f.date.getFullYear());
  }
  return Array.from(years).sort((a, b) => a - b);
}

export function calculateDaysByCountry(trips, passengerName, year) {
  const flights = getPassengerFlights(trips, passengerName);
  const yearStart = new Date(Date.UTC(year, 0, 1));
  const yearEnd = new Date(Date.UTC(year + 1, 0, 1));

  if (!flights.length) {
    return { countries: {}, years: [] };
  }

  // Determine country at year start by simulating all flights up to the year boundary.
  let currentCountry = flights[0].departureCountry || "Other";
  for (const f of flights) {
    if (f.date < yearStart) {
      // Move to arrival country if different.
      if (f.arrivalCountry) currentCountry = f.arrivalCountry;
    } else {
      break;
    }
  }

  let cursor = new Date(yearStart);
  const stays = [];
  for (const f of flights) {
    if (f.date < yearStart) continue;
    if (f.date >= yearEnd) break;

    // Close current stay up to flight departure
    stays.push({ country: currentCountry, start: new Date(cursor), end: new Date(f.date) });

    // Move to arrival country (if differs)
    if (f.arrivalCountry) currentCountry = f.arrivalCountry;
    cursor = new Date(f.date);
  }

  // Final stay to year end
  stays.push({ country: currentCountry, start: new Date(cursor), end: new Date(yearEnd) });

  // Aggregate days per country/month
  const countries = {};
  for (const stay of stays) {
    const country = stay.country || "Other";
    if (!countries[country]) {
      countries[country] = Array(12).fill(0);
    }
    let ptr = new Date(stay.start);
    while (ptr < stay.end) {
      const monthEnd = new Date(Date.UTC(ptr.getUTCFullYear(), ptr.getUTCMonth() + 1, 1));
      const sliceEnd = monthEnd < stay.end ? monthEnd : stay.end;
      const days = Math.ceil((sliceEnd - ptr) / (1000 * 60 * 60 * 24));
      countries[country][ptr.getUTCMonth()] += days;
      ptr = sliceEnd;
    }
  }

  return { countries, years: getPassengerYears(trips, passengerName) };
}
