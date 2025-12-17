// Event binding helpers extracted from main.js.
// Kept dependency-injected to avoid coupling modules and to preserve behavior.

export function setupEventListeners(ctx) {
  const {
    els,
    apiState,
    switchScreen,
    getTopbarMenuOpen,
    setTopbarMenuOpen,
    setStatusText,
    setConfigUploadVisibility,
    daycountState,
    mapState,
    upcomingState,
    getTrips,
    setTrips,
    getActiveTripId,
    setActiveTripId,
    getShowPastTrips,
    setShowPastTrips,
    renderDaycountView,
    renderMapScreen,
    renderMapFlights,
    syncMapActionButtons,
    setMapFullscreen,
    renderUpcomingScreen,
    startEditFlight,
    saveTrips,
    renderAll,
    updateTripNewFieldVisibility,
    updateAddFlightState,
    updateAddHotelState,
    resetFlightOverlayState,
    validateFlightFormState,
    validateHotelFormState,
    getCurrentTrip,
    findCachedRoute,
    fetchRoute,
    showImportedRouteForReview,
    extractTime,
    normalizePassengerNames,
    normalizeFlightNumber,
    generateHotelId,
    getPassengerYears,
    renderTripEvents,
    renderAllTripsDetails,
    getManualRouteMode,
    setManualRouteMode,
    getEditingFlightId,
    syncAllTripsToggle
  } = ctx;
  if (!els) return;

  const safeGetTrips = typeof getTrips === "function" ? getTrips : () => [];
  const safeGetTopbarOpen = typeof getTopbarMenuOpen === "function" ? getTopbarMenuOpen : () => false;

  // Screen tabs (desktop) and bottom nav (mobile)
  document.querySelectorAll(".tab-btn, .nav-btn").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      const targetScreen = e.currentTarget.dataset.screen;
      if (typeof switchScreen === "function") switchScreen(targetScreen);
    });
  });

  // Header hamburger menu
  if (els["topbar-menu-btn"] && els["topbar-menu-panel"] && typeof setTopbarMenuOpen === "function") {
    els["topbar-menu-btn"].addEventListener("click", (e) => {
      e.stopPropagation();
      setTopbarMenuOpen(!safeGetTopbarOpen());
    });
    els["topbar-menu-panel"].addEventListener("click", (e) => {
      if (e.target.closest(".menu-item")) setTopbarMenuOpen(false);
    });
    document.addEventListener("click", (e) => {
      if (!safeGetTopbarOpen()) return;
      const panel = els["topbar-menu-panel"];
      const btn = els["topbar-menu-btn"];
      if (!panel || !btn) return;
      if (panel.contains(e.target) || btn.contains(e.target)) return;
      setTopbarMenuOpen(false);
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && safeGetTopbarOpen()) setTopbarMenuOpen(false);
    });
  }

  // Config upload (manual API key)
  if (els["config-upload-btn"] && els["config-upload-file"] && apiState && typeof setStatusText === "function") {
    els["config-upload-btn"].addEventListener("click", (e) => {
      e.stopPropagation();
      els["config-upload-file"].click();
    });
    els["config-upload-file"].addEventListener("change", async (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      try {
        const text = await file.text();
        const json = JSON.parse(text);
        const key = ((json && (json.AVIATIONSTACK_API_KEY || json.apiKey)) || "").trim();
        if (!key) {
          alert("No API key found in file.");
          return;
        }
        localStorage.setItem("apiKeyOverride", key);
        apiState.key = key;
        setStatusText("api-key-status", "API key loaded from upload.");
        if (typeof setConfigUploadVisibility === "function") setConfigUploadVisibility(false);
      } catch (err) {
        console.error(err);
        alert("Could not read config.json");
      } finally {
        e.target.value = "";
      }
    });
  }

  // Daycount selectors
  if (els["daycount-passenger"] && daycountState && typeof renderDaycountView === "function" && typeof getPassengerYears === "function") {
    els["daycount-passenger"].addEventListener("change", (e) => {
      daycountState.passenger = e.target.value;
      const years = getPassengerYears(safeGetTrips(), daycountState.passenger);
      if (years.length) daycountState.year = years[0];
      renderDaycountView();
    });
  }
  if (els["daycount-year-list"] && daycountState && typeof renderDaycountView === "function") {
    els["daycount-year-list"].addEventListener("click", (e) => {
      const btn = e.target.closest(".chip-button");
      if (!btn) return;
      const year = Number(btn.dataset.year);
      if (!isNaN(year)) {
        daycountState.year = year;
        renderDaycountView();
      }
    });
  }

  // Map selectors
  if (els["map-passenger"] && mapState && typeof renderMapScreen === "function") {
    els["map-passenger"].addEventListener("change", (e) => {
      const val = e.target.value;
      mapState.passenger = val === "__all__" ? null : val;
      renderMapScreen();
    });
  }
  if (els["map-route"] && mapState && typeof renderMapScreen === "function") {
    els["map-route"].addEventListener("change", (e) => {
      const val = e.target.value;
      mapState.routeKey = val === "__all__" ? null : val;
      renderMapScreen();
    });
  }
  if (els["map-badges-btn"] && mapState && typeof renderMapFlights === "function" && typeof syncMapActionButtons === "function") {
    els["map-badges-btn"].addEventListener("click", () => {
      mapState.showBadges = !mapState.showBadges;
      renderMapFlights();
      syncMapActionButtons();
    });
  }
  if (els["map-fullscreen-btn"] && mapState && typeof setMapFullscreen === "function") {
    els["map-fullscreen-btn"].addEventListener("click", () => {
      setMapFullscreen(!mapState.fullscreen);
    });
  }
  if (els["map-year-list"] && mapState && typeof renderMapScreen === "function") {
    els["map-year-list"].addEventListener("click", (e) => {
      const btn = e.target.closest(".chip-button");
      if (!btn) return;
      const year = Number(btn.dataset.year);
      if (!isNaN(year)) {
        mapState.year = year;
        renderMapScreen();
      }
    });
  }

  if (els["upcoming-passenger"] && upcomingState && typeof renderUpcomingScreen === "function") {
    els["upcoming-passenger"].addEventListener("change", () => {
      upcomingState.passenger = els["upcoming-passenger"].value || "";
      renderUpcomingScreen();
    });
  }

  // Delete flight/hotel from timeline
  if (els["trip-events-list"] && typeof startEditFlight === "function" && typeof getActiveTripId === "function") {
    els["trip-events-list"].addEventListener("click", (e) => {
      const editBtn = e.target.closest(".edit-chip");
      if (editBtn) {
        const id = editBtn.dataset.id;
        const trip = safeGetTrips().find((t) => String(t.id) === String(getActiveTripId()));
        const record = trip?.records?.find((r) => String(r.id) === String(id));
        if (record) startEditFlight(record);
        return;
      }

      const btn = e.target.closest(".delete-chip");
      if (!btn) return;
      const type = btn.dataset.type;
      const id = btn.dataset.id;
      if (!type || !id) return;
      if (!confirm(`Delete this ${type}?`)) return;

      const trip = safeGetTrips().find((t) => String(t.id) === String(getActiveTripId()));
      if (!trip) return;

      if (type === "flight") {
        trip.records = (trip.records || []).filter((r) => String(r.id) !== String(id));
      } else if (type === "hotel") {
        trip.hotels = (trip.hotels || []).filter((h) => String(h.id) !== String(id));
      }

      if (typeof saveTrips === "function") saveTrips(safeGetTrips());
      if (typeof renderAll === "function") renderAll();
    });
  }

  // Mobile toggle All Trips Statistics
  if (els["toggle-alltrips-btn"] && typeof syncAllTripsToggle === "function") {
    els["toggle-alltrips-btn"].addEventListener("click", () => {
      const card = document.querySelector(".card-trip-details");
      if (!card) return;
      card.classList.toggle("is-expanded");
      syncAllTripsToggle();
    });
  }

  // Trip list toggle (show past)
  if (els["trip-show-past"] && typeof setShowPastTrips === "function" && typeof renderAll === "function") {
    els["trip-show-past"].addEventListener("change", () => {
      setShowPastTrips(Boolean(els["trip-show-past"].checked));
      localStorage.setItem("showPastTrips", getShowPastTrips?.() ? "1" : "0");
      renderAll();
    });
  }

  // Trip selection
  if (els["trip-existing"] && typeof setActiveTripId === "function") {
    els["trip-existing"].addEventListener("change", () => {
      const val = els["trip-existing"].value;
      if (val && val !== "__new__") {
        setActiveTripId(val);
        if (els["trip-new-name"]) els["trip-new-name"].value = "";
      } else {
        setActiveTripId(null);
      }
      if (typeof updateTripNewFieldVisibility === "function") updateTripNewFieldVisibility();
      if (typeof renderAll === "function") renderAll();
      if (typeof updateAddFlightState === "function") updateAddFlightState();
      if (typeof updateAddHotelState === "function") updateAddHotelState();
    });
  }

  if (els["trip-new-name"] && els["trip-existing"] && typeof setActiveTripId === "function") {
    els["trip-new-name"].addEventListener("input", () => {
      if (els["trip-existing"].value !== "__new__") {
        els["trip-existing"].value = "__new__";
        setActiveTripId(null);
        if (typeof updateTripNewFieldVisibility === "function") updateTripNewFieldVisibility();

        if (typeof renderTripEvents === "function") {
          renderTripEvents(
            null,
            els["trip-events-list"],
            els["trip-events-summary"],
            null,
            { showAllItems: getShowPastTrips?.() }
          );
        }

        if (typeof renderAllTripsDetails === "function") {
          renderAllTripsDetails(
            safeGetTrips(),
            els["trip-stats-container"],
            els["trip-pax-container"],
            els["trip-details-empty"]
          );
        }
      }
      if (typeof updateAddFlightState === "function") updateAddFlightState();
      if (typeof updateAddHotelState === "function") updateAddHotelState();
    });
  }

  // UI Overlays
  if (els["add-flight-btn"] && els["flight-overlay"] && typeof resetFlightOverlayState === "function" && typeof validateFlightFormState === "function") {
    els["add-flight-btn"].addEventListener("click", () => {
      resetFlightOverlayState();
      els["flight-overlay"].classList.remove("hidden");
      validateFlightFormState();
    });
  }

  if (els["close-flight-overlay"] && els["flight-overlay"] && typeof resetFlightOverlayState === "function") {
    els["close-flight-overlay"].addEventListener("click", () => {
      resetFlightOverlayState();
      els["flight-overlay"].classList.add("hidden");
    });
  }
  if (els["cancel-flight-btn"] && els["flight-overlay"] && typeof resetFlightOverlayState === "function") {
    els["cancel-flight-btn"].addEventListener("click", () => {
      resetFlightOverlayState();
      els["flight-overlay"].classList.add("hidden");
    });
  }

  if (els["add-hotel-btn"] && els["hotel-overlay"] && typeof validateHotelFormState === "function") {
    els["add-hotel-btn"].addEventListener("click", () => {
      els["hotel-overlay"].classList.remove("hidden");
      validateHotelFormState();
    });
  }

  if (els["close-hotel-overlay"] && els["hotel-overlay"]) {
    els["close-hotel-overlay"].addEventListener("click", () => els["hotel-overlay"].classList.add("hidden"));
  }
  if (els["cancel-hotel-btn"] && els["hotel-overlay"]) {
    els["cancel-hotel-btn"].addEventListener("click", () => els["hotel-overlay"].classList.add("hidden"));
  }

  // Form Validations
  if (typeof validateFlightFormState === "function") {
    ["flight-number", "flight-date", "pax-new", "manual-airline", "manual-dep-airport", "manual-arr-airport"]
      .forEach((id) => els[id]?.addEventListener("input", validateFlightFormState));
    els["pax-existing"]?.addEventListener("change", validateFlightFormState);
  }

  if (typeof validateHotelFormState === "function") {
    ["hotel-existing", "hotel-name", "hotel-pax", "hotel-id"]
      .forEach((id) => els[id]?.addEventListener("input", validateHotelFormState));
    ["hotel-checkin", "hotel-checkout"].forEach((id) => els[id]?.addEventListener("change", validateHotelFormState));
  }

  // Flight Submit
  if (
    els["flight-form"] &&
    typeof getEditingFlightId === "function" &&
    typeof getManualRouteMode === "function" &&
    typeof getCurrentTrip === "function" &&
    typeof normalizePassengerNames === "function" &&
    typeof normalizeFlightNumber === "function"
  ) {
    els["flight-form"].addEventListener("submit", async (e) => {
      e.preventDefault();
      if (els.flightSubmitBtn?.disabled) return;

      const editingId = getEditingFlightId();
      const flightNumberRaw = els["flight-number"]?.value?.trim?.() || "";
      const flightDate = els["flight-date"]?.value || "";
      const pnrRaw = els["pnr"]?.value?.trim?.() || "";

      const selectedPax = Array.from(els["pax-existing"]?.selectedOptions || []).map((o) => o.value);
      const newPax = (els["pax-new"]?.value || "").split(",").map((s) => s.trim()).filter(Boolean);
      const paxNames = normalizePassengerNames([...selectedPax, ...newPax]);

      const currentTrip = getCurrentTrip();
      const existingRecord = editingId
        ? currentTrip.records.find((r) => String(r.id) === String(editingId))
        : null;

      if (!getManualRouteMode() && !editingId) {
        if (typeof fetchRoute !== "function" || typeof showImportedRouteForReview !== "function" || typeof findCachedRoute !== "function") {
          alert("Route lookup is not available.");
          return;
        }
        try {
          let baseRoute = null;
          const cached = findCachedRoute(safeGetTrips(), flightNumberRaw, flightDate);
          if (cached && confirm("Found saved route. Use it?")) {
            baseRoute = cached;
          } else {
            if (els["output"]) els["output"].textContent = "Fetching...";
            baseRoute = await fetchRoute(flightNumberRaw);
          }
          showImportedRouteForReview(baseRoute, flightDate);
        } catch (err) {
          if (confirm(`API Error: ${err.message}. Enter manually?`)) {
            if (typeof setManualRouteMode === "function") setManualRouteMode(true);
            els["manual-route-section"]?.classList.remove("hidden");
            if (typeof validateFlightFormState === "function") validateFlightFormState();
            return;
          }
          return;
        }
        return;
      }

      const existingRoute = existingRecord?.route || {};
      const depTimeVal =
        els["manual-dep-time"]?.value ||
        (typeof extractTime === "function" ? extractTime(existingRoute.departure?.scheduled) : "") ||
        "00:00";
      const arrTimeVal =
        els["manual-arr-time"]?.value ||
        (typeof extractTime === "function" ? extractTime(existingRoute.arrival?.scheduled) : "") ||
        "00:00";

      const route = {
        flightNumber: normalizeFlightNumber((els["manual-flight-number"]?.value || flightNumberRaw) ?? ""),
        airline: (els["manual-airline"]?.value || "").trim(),
        departure: {
          airport: (els["manual-dep-airport"]?.value || "").trim() || existingRoute.departure?.airport || "",
          iata: ((els["manual-dep-iata"]?.value || existingRoute.departure?.iata || existingRoute.departure?.icao || "") ?? "")
            .trim()
            .toUpperCase(),
          scheduled: `${flightDate}T${depTimeVal}:00`
        },
        arrival: {
          airport: (els["manual-arr-airport"]?.value || "").trim() || existingRoute.arrival?.airport || "",
          iata: ((els["manual-arr-iata"]?.value || existingRoute.arrival?.iata || existingRoute.arrival?.icao || "") ?? "")
            .trim()
            .toUpperCase(),
          scheduled: `${flightDate}T${arrTimeVal}:00`
        }
      };

      if (editingId) {
        const idx = currentTrip.records.findIndex((r) => String(r.id) === String(editingId));
        if (idx !== -1) {
          const existing = currentTrip.records[idx];
          currentTrip.records[idx] = {
            ...existing,
            flightDate,
            pnr: pnrRaw ? pnrRaw.toUpperCase() : null,
            paxNames,
            route
          };
        }
      } else {
        currentTrip.records.push({
          id: Date.now(),
          createdAt: new Date().toISOString(),
          flightDate,
          pnr: pnrRaw ? pnrRaw.toUpperCase() : null,
          paxNames,
          route
        });
      }

      if (typeof saveTrips === "function") saveTrips(safeGetTrips());
      if (typeof renderAll === "function") renderAll();
      if (typeof resetFlightOverlayState === "function") resetFlightOverlayState();
      els["flight-overlay"]?.classList.add("hidden");
    });
  }

  // Hotel Submit
  if (els["hotel-form"] && typeof getCurrentTrip === "function") {
    els["hotel-form"].addEventListener("submit", (e) => {
      e.preventDefault();
      if (els.hotelSubmitBtn?.disabled) return;

      const currentTrip = getCurrentTrip();
      let hotelName = (els["hotel-name"]?.value || "").trim();
      if (!hotelName && els["hotel-existing"]?.value && els["hotel-existing"].value !== "__new__") {
        hotelName = els["hotel-existing"].value;
      }

      currentTrip.hotels.push({
        id: (els["hotel-id"]?.value || "").trim() || (typeof generateHotelId === "function" ? generateHotelId() : String(Date.now())),
        createdAt: new Date().toISOString(),
        hotelName,
        checkInDate: els["hotel-checkin"]?.value || "",
        checkOutDate: els["hotel-checkout"]?.value || "",
        paxCount: Number(els["hotel-pax"]?.value || 0),
        paymentType: els["hotel-payment"]?.value || "prepaid"
      });

      if (typeof saveTrips === "function") saveTrips(safeGetTrips());
      if (typeof renderAll === "function") renderAll();
      els["hotel-overlay"]?.classList.add("hidden");
      els["hotel-form"]?.reset();
    });
  }

  // Export/Import
  if (els["download-json"]) {
    els["download-json"].addEventListener("click", () => {
      const blob = new Blob([JSON.stringify(safeGetTrips(), null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "trips.json";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    });
  }

  if (els["import-json"] && els["import-json-file"]) {
    els["import-json"].addEventListener("click", () => {
      const input = els["import-json-file"];
      if (input) input.value = ""; // allow re-selecting the same file after clear/import
      input?.click();
    });

    if (typeof setTrips === "function" && typeof setActiveTripId === "function") {
      els["import-json-file"].addEventListener("change", (e) => {
        const fileInput = e.target;
        const file = fileInput.files?.[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (evt) => {
          try {
            const parsed = JSON.parse(evt.target.result);
            if (Array.isArray(parsed)) {
              setTrips(parsed);
              if (typeof saveTrips === "function") saveTrips(safeGetTrips());
              setActiveTripId(safeGetTrips()[0]?.id || null);
              if (typeof renderAll === "function") renderAll();
              alert("Imported!");
            }
          } catch (err) {
            alert("Invalid JSON");
          }
          fileInput.value = ""; // reset so the same file can be chosen again
        };
        reader.readAsText(file);
      });
    }
  }

  if (els["clear-json"] && typeof setTrips === "function" && typeof setActiveTripId === "function") {
    els["clear-json"].addEventListener("click", () => {
      if (confirm("Delete all data?")) {
        setTrips([]);
        setActiveTripId(null);
        if (typeof saveTrips === "function") saveTrips(safeGetTrips());
        if (typeof renderAll === "function") renderAll();
      }
    });
  }
}
