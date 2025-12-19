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
  if (isoOrDateStr instanceof Date) {
    return isNaN(isoOrDateStr.getTime()) ? null : isoOrDateStr;
  }

  const s = String(isoOrDateStr);

  // Treat YYYY-MM-DD as a local date to avoid UTC offset surprises.
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) {
    const year = Number(m[1]);
    const month = Number(m[2]) - 1;
    const day = Number(m[3]);
    const dLocal = new Date(year, month, day);
    return isNaN(dLocal.getTime()) ? null : dLocal;
  }

  const d = new Date(s); // handles full ISO
  return isNaN(d.getTime()) ? null : d;
}

function getTodayStartLocal(now = new Date()) {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  return d;
}

function hasTimeComponent(isoString) {
  if (!isoString || typeof isoString !== "string") return false;
  return /T\d{2}:\d{2}/.test(isoString);
}

function isPastFlightLeg(leg, now, todayStart) {
  if (!leg || typeof leg !== "object") return false;

  const depIso = leg.route?.departure?.scheduled;
  if (depIso) {
    const depDate = parseDateOnly(depIso);
    if (!depDate) return false;
    const cutoff = hasTimeComponent(depIso) ? now : todayStart;
    return depDate < cutoff;
  }

  if (leg.flightDate) {
    const d = parseDateOnly(leg.flightDate);
    return d ? d < todayStart : false;
  }

  return false;
}

function isPastHotel(hotel, todayStart) {
  if (!hotel || typeof hotel !== "object") return false;

  // Consider the hotel "past" only once the check-out day is before today.
  if (hotel.checkOutDate) {
    const d = parseDateOnly(hotel.checkOutDate);
    return d ? d < todayStart : false;
  }

  if (hotel.checkInDate) {
    const d = parseDateOnly(hotel.checkInDate);
    return d ? d < todayStart : false;
  }

  return false;
}

function tripHasAnyEvents(trip) {
  return (trip?.records || []).length > 0 || (trip?.hotels || []).length > 0;
}

function tripHasUpcomingEvents(trip, now, todayStart) {
  const hasUpcomingFlight = (trip?.records || []).some((leg) => !isPastFlightLeg(leg, now, todayStart));
  const hasUpcomingHotel = (trip?.hotels || []).some((h) => !isPastHotel(h, todayStart));
  return hasUpcomingFlight || hasUpcomingHotel;
}

function isTripAllPast(trip, now, todayStart) {
  return tripHasAnyEvents(trip) && !tripHasUpcomingEvents(trip, now, todayStart);
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

export function renderTripSelect(trips, activeTripId, options = {}) {
  const select = document.getElementById("trip-existing");
  select.innerHTML = "";

  const optNew = document.createElement("option");
  optNew.value = "__new__";
  optNew.textContent = "New trip";
  select.appendChild(optNew);

  const showPastTrips = Boolean(options.showPastTrips);
  const now = new Date();
  const todayStart = getTodayStartLocal(now);

  const visibleTrips = (trips || []).filter((trip) => {
    if (!trip) return false;
    if (showPastTrips) return true;
    if (String(trip.id) === String(activeTripId)) return true;
    if (!tripHasAnyEvents(trip)) return true;
    return tripHasUpcomingEvents(trip, now, todayStart);
  });

  visibleTrips.forEach((trip) => {
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

export function renderTripEvents(trip, containerEl, summaryEl, nameEl, options = {}) {
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
  const now = new Date();
  const todayStart = getTodayStartLocal(now);
  let showAllItems = Boolean(options.showAllItems);
  if (!showAllItems && isTripAllPast(trip, now, todayStart)) {
    showAllItems = true;
  }

  // Summary stats (2nd line under Control Center) — NO trip name here
  if (summaryEl) {
    const hasAnyEvents = (trip.records || []).length > 0 || (trip.hotels || []).length > 0;
    const totalFlightLegs = showAllItems
      ? (trip.records || []).length
      : (trip.records || []).filter((leg) => !isPastFlightLeg(leg, now, todayStart)).length;
    const totalHotels = showAllItems
      ? (trip.hotels || []).length
      : (trip.hotels || []).filter((h) => !isPastHotel(h, todayStart)).length;

    if (!hasAnyEvents) {
      summaryEl.textContent = "No events yet";
    } else {
      const parts = [];
      if (totalFlightLegs) parts.push(`${totalFlightLegs} flight${totalFlightLegs === 1 ? "" : "s"}`);
      if (totalHotels) parts.push(`${totalHotels} hotel${totalHotels === 1 ? "" : "s"}`);
      if (!parts.length && hasAnyEvents) parts.push(showAllItems ? "No events yet" : "No upcoming events");

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
  let renderedAnyTile = false;
  for (const day of days) {
    const mobileView =
      (window.matchMedia && window.matchMedia("(max-width: 720px)").matches) ||
      window.innerWidth <= 720;
    const dateLabel = day.date ? formatFriendlyDate(day.date) : "Undated";
    const flightsCount = day.flights.reduce((acc, fg) => {
      const records = Array.isArray(fg.records) ? fg.records : [];
      return acc + (showAllItems ? records.length : records.filter((leg) => !isPastFlightLeg(leg, now, todayStart)).length);
    }, 0);
    const hotelsCount = day.hotels.reduce((acc, hEvt) => {
      const h = hEvt?.hotel;
      return acc + ((showAllItems || !isPastHotel(h, todayStart)) ? 1 : 0);
    }, 0);

    if (!flightsCount && !hotelsCount) continue;
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
      const legs = showAllItems
        ? (group.records || []).slice()
        : (group.records || []).filter((leg) => !isPastFlightLeg(leg, now, todayStart));
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
        const depCodeDisplay = mobileView ? "" : depCode;
        const depLabel = mobileView ? (depCode || depCity) : depCity;
        const depTime = extractTime(d.scheduled);

        const arrCity = mobileView
          ? (a.iata || a.icao || a.airport || "—")
          : (a.airport || a.iata || a.icao || "—");
        const arrCode = a.iata || a.icao || "";
        const arrCodeDisplay = mobileView ? "" : arrCode;
        const arrLabel = mobileView ? (arrCode || arrCity) : arrCity;
        const arrTime = extractTime(a.scheduled);

        const headerRight = [airlineName, fn].filter(Boolean).join(" ");

        segmentsHtml += `
          <div class="itinerary-segment segment-flight">
            <div class="segment-header-row">
              <span class="segment-label">${legLabel}</span>
              <span class="segment-flight-code">
                ${headerRight || "Flight"}${!mobileView && pnrDisplay && pnrDisplay !== "—" ? ` <span class="pnr-text">• PNR ${pnrDisplay}</span>` : ""}
              </span>
              <button class="edit-chip" data-type="flight" data-id="${leg.id}" aria-label="Edit flight">Edit</button>
              <button class="delete-chip" data-type="flight" data-id="${leg.id}" aria-label="Delete flight">🗑</button>
            </div>
            <div class="segment-main-row">
              <div class="segment-side">
                <div class="segment-city">${depLabel}</div>
                <div class="segment-code-time">
                  <span class="segment-code">${depCodeDisplay}</span>
                  <span class="segment-time">${depTime || ""}</span>
                </div>
              </div>
                <div class="segment-arrow">
                  <span class="segment-icon segment-icon-flight" aria-hidden="true">✈︎</span>
                </div>
              <div class="segment-side segment-side-right">
                <div class="segment-city">${arrLabel}</div>
                <div class="segment-code-time">
                  <span class="segment-code">${arrCodeDisplay}</span>
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
      if (!showAllItems && isPastHotel(h, todayStart)) continue;
      const checkInShort = formatShortDate(h.checkInDate);
      const checkOutShort = formatShortDate(h.checkOutDate);
      const nights = computeNights(h.checkInDate, h.checkOutDate);
      const nightsLabel = nights != null ? `${nights} night${nights === 1 ? "" : "s"}` : "";
      const pax = h.paxCount || 1;
      const paymentText = h.paymentType === "prepaid" ? "Already paid" : "Pay at hotel";
      const copyIdLabel = "Copy ID";
      const copyIdValue = h.id ? String(h.id).trim() : "";
      const copyIdBtn = copyIdValue
        ? `<button class="copy-chip edit-chip" data-value="${copyIdValue}" data-label="${copyIdLabel}" aria-label="Copy confirmation number">${copyIdLabel}</button>`
        : "";

      segmentsHtml += `
        <div class="itinerary-segment segment-hotel">
          <div class="segment-header-row">
            <span class="segment-label">Hotel</span>
            <span class="segment-flight-code">${h.hotelName || "Unnamed"}</span>
            ${copyIdBtn}
            <button class="delete-chip" data-type="hotel" data-id="${h.id}" aria-label="Delete hotel">🗑</button>
          </div>
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
    renderedAnyTile = true;
  }

  if (!renderedAnyTile) {
    const empty = document.createElement("div");
    empty.className = "tiles-empty";
    empty.textContent = showAllItems
      ? "No events in this trip yet."
      : "No upcoming events in this trip. Past flights and hotels are hidden.";
    containerEl.appendChild(empty);
  }
}
