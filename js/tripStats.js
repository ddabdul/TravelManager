export function collectTripStats(trip) {
  if (!trip) return { flights: 0, hotels: 0, passengers: [] };

  const flightCount = trip.records.length;
  const hotelCount = trip.hotels.length;

  const uniquePax = new Set();
  trip.records.forEach((r) => r.paxNames.forEach((name) => uniquePax.add(name)));

  return {
    flights: flightCount,
    hotels: hotelCount,
    passengerCount: uniquePax.size,
    passengers: Array.from(uniquePax).sort()
  };
}

export function renderTripDetails(trip, statsEl, paxEl, emptyEl) {
  const hasData = trip && (trip.records.length > 0 || trip.hotels.length > 0);

  if (!hasData) {
    statsEl.classList.add("hidden");
    paxEl.classList.add("hidden");
    emptyEl.classList.remove("hidden");
    return;
  }

  emptyEl.classList.add("hidden");
  statsEl.classList.remove("hidden");
  paxEl.classList.remove("hidden");

  const stats = collectTripStats(trip);

  statsEl.innerHTML = `
    <div class="stat-item">
      <div class="stat-label">Flights</div>
      <div class="stat-value">${stats.flights}</div>
    </div>
    <div class="stat-item">
      <div class="stat-label">Hotels</div>
      <div class="stat-value">${stats.hotels}</div>
    </div>
  `;

  paxEl.innerHTML = `
    <div style="font-size: 14px; font-weight: 600; margin-bottom: 8px;">
      Passengers (${stats.passengerCount})
    </div>
    <div style="display: flex; flex-wrap: wrap; gap: 8px;">
      ${stats.passengers.map((p) =>
        `<span class="badge">${p}</span>`
      ).join("")}
    </div>
  `;
}

function parseDateOnly(isoOrDateStr) {
  if (!isoOrDateStr) return null;
  const d = new Date(isoOrDateStr);
  return isNaN(d.getTime()) ? null : d;
}

function daysBetween(checkInStr, checkOutStr) {
  const inDate = parseDateOnly(checkInStr);
  const outDate = parseDateOnly(checkOutStr);
  if (!inDate || !outDate) return 0;

  inDate.setHours(0, 0, 0, 0);
  outDate.setHours(0, 0, 0, 0);

  const diffMs = outDate - inDate;
  const nights = Math.round(diffMs / (1000 * 60 * 60 * 24));
  return Math.max(0, nights);
}

function getTripDateRange(trip) {
  let min = null;
  let max = null;

  for (const rec of (trip.records || [])) {
    const depIso = rec.route?.departure?.scheduled;
    const dateStr = depIso || rec.flightDate || rec.createdAt;
    const d = parseDateOnly(dateStr);
    if (!d) continue;
    if (!min || d < min) min = d;
    if (!max || d > max) max = d;
  }

  for (const h of (trip.hotels || [])) {
    const d1 = parseDateOnly(h.checkInDate || h.createdAt);
    const d2 = parseDateOnly(h.checkOutDate || h.createdAt);
    const dates = [d1, d2].filter(Boolean);
    for (const d of dates) {
      if (!min || d < min) min = d;
      if (!max || d > max) max = d;
    }
  }

  return { start: min, end: max };
}

function collectAllTripsStats(allTrips) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const totalTrips = allTrips.length;

  let totalFlights = 0;
  let totalHotelNights = 0;

  let pastTrips = 0, upcomingTrips = 0;
  let pastFlights = 0, upcomingFlights = 0;
  let pastHotelNights = 0, upcomingHotelNights = 0;

  const paxTotals = new Map();

  for (const trip of allTrips) {
    if (!trip) continue;

    const { end } = getTripDateRange(trip);
    const isPastTrip = end && end < today;

    if (isPastTrip) pastTrips++;
    else upcomingTrips++;

    for (const rec of (trip.records || [])) {
      totalFlights++;

      const depIso = rec.route?.departure?.scheduled;
      const d = parseDateOnly(depIso || rec.flightDate || rec.createdAt);
      const isPastFlight = d && d < today;

      if (isPastFlight) pastFlights++;
      else upcomingFlights++;

      const paxNames = Array.isArray(rec.paxNames) ? rec.paxNames : [];
      for (const rawName of paxNames) {
        const name = String(rawName || "").trim();
        if (!name) continue;

        if (!paxTotals.has(name)) {
          paxTotals.set(name, {
            flights: 0,
            pastFlights: 0,
            upcomingFlights: 0,
            trips: new Set()
          });
        }
        const p = paxTotals.get(name);
        p.flights++;
        if (isPastFlight) p.pastFlights++;
        else p.upcomingFlights++;
        p.trips.add(trip.id);
      }
    }

    for (const h of (trip.hotels || [])) {
      const nights = daysBetween(h.checkInDate, h.checkOutDate);
      totalHotelNights += nights;

      const d = parseDateOnly(h.checkInDate || h.createdAt);
      const isPastHotel = d && d < today;

      if (isPastHotel) pastHotelNights += nights;
      else upcomingHotelNights += nights;
    }
  }

  const paxList = Array.from(paxTotals.entries())
    .map(([name, v]) => ({
      name,
      flights: v.flights,
      pastFlights: v.pastFlights,
      upcomingFlights: v.upcomingFlights,
      tripCount: v.trips.size
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  return {
    totalTrips,
    totalFlights,
    totalHotelNights,

    pastTrips,
    upcomingTrips,
    pastFlights,
    upcomingFlights,
    pastHotelNights,
    upcomingHotelNights,

    paxList
  };
}

export function renderAllTripsDetails(allTrips, statsEl, paxEl, emptyEl) {
  const hasData =
    Array.isArray(allTrips) &&
    allTrips.some((t) => (t?.records?.length || 0) > 0 || (t?.hotels?.length || 0) > 0);

  if (!hasData) {
    statsEl.classList.add("hidden");
    paxEl.classList.add("hidden");
    emptyEl.classList.remove("hidden");
    return;
  }

  emptyEl.classList.add("hidden");
  statsEl.classList.remove("hidden");
  paxEl.classList.remove("hidden");

  const s = collectAllTripsStats(allTrips);

  const statCards = [
    { label: "Trips", total: s.totalTrips, past: s.pastTrips, upcoming: s.upcomingTrips },
    { label: "Flights", total: s.totalFlights, past: s.pastFlights, upcoming: s.upcomingFlights },
    { label: "Hotel Nights", total: s.totalHotelNights, past: s.pastHotelNights, upcoming: s.upcomingHotelNights }
  ];

  statsEl.innerHTML = `
    <div style="display: grid; grid-template-columns: 1fr; gap: 8px;">
      ${statCards.map((card) => `
        <div class="secondary-card" style="padding: 10px 12px;">
          <div style="display:flex; justify-content:space-between; align-items:center;">
            <div style="font-weight:600;">${card.label}</div>
            <div style="font-size:18px; font-weight:700;">${card.total}</div>
          </div>
          <div style="margin-top:6px; font-size:12px; color:var(--text-secondary);">
            Past: ${card.past} &nbsp;•&nbsp; Upcoming: ${card.upcoming}
          </div>
        </div>
      `).join("")}
    </div>
  `;

  if (!s.paxList.length) {
    paxEl.innerHTML = `<div class="tiles-empty">No passengers recorded yet.</div>`;
    return;
  }

  paxEl.innerHTML = `
    <div style="font-size: 14px; font-weight: 600; margin: 10px 0 8px;">
      Passengers (${s.paxList.length})
    </div>
    <div style="display: grid; grid-template-columns: 1fr; gap: 8px;">
      ${s.paxList.map((p) => `
        <div class="secondary-card" style="padding: 10px 12px;">
          <div style="display:flex; justify-content:space-between; align-items:center;">
            <div style="font-weight:600;">${p.name}</div>
            <div class="tag-soft">${p.tripCount} trip${p.tripCount === 1 ? "" : "s"}</div>
          </div>
          <div style="margin-top:6px; font-size:12px; color:var(--text-secondary);">
            Flights: <b>${p.flights}</b>
            &nbsp;•&nbsp; Past: ${p.pastFlights}
            &nbsp;•&nbsp; Upcoming: ${p.upcomingFlights}
          </div>
        </div>
      `).join("")}
    </div>
  `;
}

