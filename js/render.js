// =========================
// UI Rendering & DOM Manipulation
// =========================

import { 
  getAllPassengers, 
  getAllHotelNames, 
  buildTripEvents 
} from "./data.js";
import { 
  normalizePassengerNames, 
  formatFriendlyDate, 
  formatShortDate, 
  extractTime, 
  computeDurationMinutes, 
  formatDuration, 
  computeNights 
} from "./utils.js";

// -------------------------
// Helpers for trip start date (NEW)
// -------------------------
function parseDateOnly(isoOrDateStr) {
  if (!isoOrDateStr) return null;
  const d = new Date(isoOrDateStr); // handles YYYY-MM-DD or full ISO
  return isNaN(d.getTime()) ? null : d;
}

function getTripStartDate(trip) {
  if (!trip) return null;
  let min = null;

  // Flights
  for (const rec of (trip.records || [])) {
    const depIso = rec.route?.departure?.scheduled;
    const dateStr = depIso || rec.flightDate || rec.createdAt;
    const d = parseDateOnly(dateStr);
    if (!d) continue;
    if (!min || d < min) min = d;
  }

  // Hotels
  for (const h of (trip.hotels || [])) {
    const d1 = parseDateOnly(h.checkInDate || h.createdAt);
    const d2 = parseDateOnly(h.checkOutDate || h.createdAt);
    const dates = [d1, d2].filter(Boolean);
    for (const d of dates) {
      if (!min || d < min) min = d;
    }
  }

  return min;
}

// -------------------------
// Existing renders
// -------------------------

export function renderPassengerSelect(trips) {
  const select = document.getElementById("pax-existing");
  if (!select) return;
  const passengers = getAllPassengers(trips);

  select.innerHTML = "";

  if (passengers.length === 0) {
    const opt = document.createElement("option");
    opt.textContent = "No passengers saved yet";
    opt.disabled = true;
    select.appendChild(opt);
    select.disabled = true;
    return;
  }

  select.disabled = false;
  passengers.forEach((name) => {
    const opt = document.createElement("option");
    opt.value = name;
    opt.textContent = name;
    select.appendChild(opt);
  });
}

export function renderHotelSelect(trips) {
  const select = document.getElementById("hotel-existing");
  if (!select) return;

  const names = getAllHotelNames(trips);
  select.innerHTML = "";

  const optNew = document.createElement("option");
  optNew.value = "__new__";
  optNew.textContent = "New hotel";
  select.appendChild(optNew);

  names.forEach((name) => {
    const opt = document.createElement("option");
    opt.value = name;
    opt.textContent = name;
    select.appendChild(opt);
  });
  select.value = "__new__";
}

export function renderTripsJson(trips) {
  const savedEl = document.getElementById("saved-json");
  if (savedEl) savedEl.textContent = JSON.stringify(trips, null, 2);
}

export function renderTripSelect(trips, activeTripId) {
  const select = document.getElementById("trip-existing");
  select.innerHTML = "";

  const optNew = document.createElement("option");
  optNew.value = "__new__";
  optNew.textContent = "New trip";
  select.appendChild(optNew);

  trips.forEach((trip) => {
    const opt = document.createElement("option");
    opt.value = String(trip.id);

    const startDate = getTripStartDate(trip);
    const startLabel = startDate
      ? startDate.toLocaleDateString(undefined, { year: "numeric", month: "short" })
      : "";

    // Show name + (start month/year) instead of createdAt
    opt.textContent = startLabel ? `${trip.name} (${startLabel})` : trip.name;

    if (String(trip.id) === String(activeTripId)) {
      opt.selected = true;
    }
    select.appendChild(opt);
  });

  if (!activeTripId) {
    select.value = "__new__";
  }
}

export function renderTripEvents(trip, containerEl, summaryEl, nameEl) {
  containerEl.innerHTML = "";

  if (!trip) {
    const empty = document.createElement("div");
    empty.className = "tiles-empty";
    empty.textContent = "Select an existing trip or enter a new trip name to see events here.";
    containerEl.appendChild(empty);
    if (summaryEl) summaryEl.textContent = "No trip selected";
    if (nameEl) nameEl.textContent = "";
    return;
  }

  const days = buildTripEvents(trip);

  // Summary stats (2nd line under Control Center) — NO trip name here
  if (summaryEl) {
    const totalFlightLegs = (trip.records || []).length;
    const totalHotels = (trip.hotels || []).length;

    if (!days.length) {
      summaryEl.textContent = "No events yet";
    } else {
      const parts = [];
      if (totalFlightLegs) parts.push(`${totalFlightLegs} flight${totalFlightLegs === 1 ? "" : "s"}`);
      if (totalHotels) parts.push(`${totalHotels} hotel${totalHotels === 1 ? "" : "s"}`);

      summaryEl.textContent = parts.join(" • ") || "No events yet";
    }
  }

  if (nameEl) nameEl.textContent = trip.name;

  if (!days.length) {
    const empty = document.createElement("div");
    empty.className = "tiles-empty";
    empty.textContent = "No events in this trip yet. Use “Add flight” or “Add hotel”.";
    containerEl.appendChild(empty);
    return;
  }

  // Render Days
  for (const day of days) {
    const mobileView = window.matchMedia && window.matchMedia("(max-width: 720px)").matches;
    const dateLabel = day.date ? formatFriendlyDate(day.date) : "Undated";
    const flightsCount = day.flights.reduce(
      (acc, fg) => acc + (Array.isArray(fg.records) ? fg.records.length : 0), 0
    );
    const hotelsCount = day.hotels.length;
    const headerIconClass = flightsCount > 0 ? "event-type-icon-flight" : "event-type-icon-hotel";
    const headerIconChar = flightsCount > 0 ? "✈︎" : "🛏"; 

    const badgeParts = [];
    if (flightsCount) badgeParts.push(`${flightsCount} flight${flightsCount === 1 ? "" : "s"}`);
    if (hotelsCount) badgeParts.push(`${hotelsCount} hotel${hotelsCount === 1 ? "" : "s"}`);
    const badgeText = badgeParts.join(" • ");

    const tile = document.createElement("div");
    tile.className = "flight-tile itinerary-tile";
    tile.innerHTML = `
      <div class="flight-tile-header">
        <div class="flight-tile-header-left">
          <span class="event-type-icon ${headerIconClass}">${headerIconChar}</span>
          <span class="flight-date">${dateLabel}</span>
        </div>
        <span class="flight-airline">${badgeText}</span>
      </div>
      <div class="itinerary-body"></div>
    `;

    const bodyEl = tile.querySelector(".itinerary-body");
    let segmentsHtml = "";

    // Render Flights
    for (const group of day.flights) {
      const legs = (group.records || []).slice();
      if (!legs.length) continue;

      legs.sort((a, b) => {
        const da = (a.route?.departure?.scheduled) || "";
        const db = (b.route?.departure?.scheduled) || "";
        return da.localeCompare(db);
      });

      const first = legs[0];
      const pnrDisplay = group.pnr || first.pnr || "—";

      const groupPaxNames = normalizePassengerNames(
        legs.flatMap((leg) => (Array.isArray(leg.paxNames) ? leg.paxNames : []))
      );
      const paxListHtml = groupPaxNames.length > 0
          ? groupPaxNames.map((name) => `<span class="passenger-name">${name}</span>`).join("")
          : '<span class="passenger-name">None saved</span>';

      for (let i = 0; i < legs.length; i++) {
        const leg = legs[i];
        const r = leg.route || {};
        const d = r.departure || {};
        const a = r.arrival || {};
        const airlineName = r.airline || "";
        const fn = (r.flightNumber || "").toString();
        const legLabel = i === 0 ? "Departure" : "Connecting flight";

        const depCity = mobileView
          ? (d.iata || d.icao || d.airport || "—")
          : (d.airport || d.iata || d.icao || "—");
        const depCode = d.iata || d.icao || "";
        const depTime = extractTime(d.scheduled);

        const arrCity = mobileView
          ? (a.iata || a.icao || a.airport || "—")
          : (a.airport || a.iata || a.icao || "—");
        const arrCode = a.iata || a.icao || "";
        const arrTime = extractTime(a.scheduled);

        const headerRight = [airlineName, fn].filter(Boolean).join(" ");

        segmentsHtml += `
          <div class="itinerary-segment segment-flight">
            <div class="segment-header-row">
              <span class="segment-label">${legLabel}</span>
              <span class="segment-flight-code">
                ${headerRight || "Flight"}${!mobileView && pnrDisplay && pnrDisplay !== "—" ? ` • PNR ${pnrDisplay}` : ""}
              </span>
            </div>
            <div class="segment-main-row">
              <div class="segment-side">
                <div class="segment-city">${depCity}</div>
                <div class="segment-code-time">
                  <span class="segment-code">${depCode}</span>
                  <span class="segment-time">${depTime || ""}</span>
                </div>
              </div>
                <div class="segment-arrow">
                  <span class="segment-icon segment-icon-flight" aria-hidden="true">✈︎</span>
                </div>
              <div class="segment-side segment-side-right">
                <div class="segment-city">${arrCity}</div>
                <div class="segment-code-time">
                  <span class="segment-code">${arrCode}</span>
                  <span class="segment-time">${arrTime || ""}</span>
                </div>
              </div>
            </div>
            <div class="segment-layover-text">Passengers: <span class="passenger-list">${paxListHtml}</span></div>
          </div>
        `;

        if (i < legs.length - 1) {
          const nextLeg = legs[i + 1];
          const nextDep = nextLeg.route?.departure || {};
          const layoverMins = computeDurationMinutes(a.scheduled, nextDep.scheduled);
          const layoverDuration = formatDuration(layoverMins) || "Layover";
          
          let layoverText = layoverDuration;
          if (a.airport || a.iata) {
            layoverText += ` in ${a.airport || a.iata}`;
          }

          segmentsHtml += `
            <div class="itinerary-segment segment-layover">
              <div class="segment-header-row"><span class="segment-label">Layover</span><span class="segment-icon">🕒</span></div>
              <div class="segment-layover-text">${layoverText}</div>
            </div>
          `;
        }
      }
    }

    // Render Hotels
    for (const hEvt of day.hotels) {
      const h = hEvt.hotel;
      const checkInShort = formatShortDate(h.checkInDate);
      const checkOutShort = formatShortDate(h.checkOutDate);
      const nights = computeNights(h.checkInDate, h.checkOutDate);
      const nightsLabel = nights != null ? `${nights} night${nights === 1 ? "" : "s"}` : "";
      const pax = h.paxCount || 1;
      const paymentText = h.paymentType === "prepaid" ? "Already paid" : "Pay at hotel";

      segmentsHtml += `
        <div class="itinerary-segment segment-hotel">
          <div class="segment-header-row"><span class="segment-label">Hotel</span><span class="segment-flight-code">${h.hotelName || "Unnamed"}</span></div>
          <div class="segment-main-row">
            <div class="segment-side">
              <div class="segment-city">Check-in</div>
              <div class="segment-code-time"><span class="segment-code">${checkInShort || ""}</span></div>
            </div>
            <div class="segment-arrow"><span class="segment-icon segment-icon-hotel" aria-hidden="true">🛏</span></div>
            <div class="segment-side segment-side-right">
              <div class="segment-city">Check-out</div>
              <div class="segment-code-time"><span class="segment-code">${checkOutShort || ""}</span><span class="segment-time">${nightsLabel}</span></div>
            </div>
          </div>
          <div class="segment-layover-text">
            <span class="sf-icon sf-icon-key" aria-hidden="true">🔑</span>
            <span>${pax} guest${pax === 1 ? "" : "s"} • ${paymentText}</span>
          </div>
        </div>
      `;
    }

    bodyEl.innerHTML = segmentsHtml;
    containerEl.appendChild(tile);
  }
}
