import { GOOGLE_MAPS_API_KEY } from './config.js';
import { animateDropdown } from './animations.js';
import { highlightClientName } from './clients.js';
import { logDebug } from './debug.js';
import { escapeHtml, showToast } from './utils.js';

const PLACE_PIN_ICON = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 21.2s7.2-6.8 7.2-12.4a7.2 7.2 0 1 0-14.4 0c0 5.6 7.2 12.4 7.2 12.4z"></path><circle cx="12" cy="8.8" r="2.4"></circle></svg>`;
const MIN_QUERY_LEN = 2;
const FETCH_DEBOUNCE_MS = 140;
const SUGGESTION_CACHE_TTL_MS = 5 * 60 * 1000;
const SUGGESTION_CACHE_MAX = 48;
const MAX_SUGGESTIONS = 8;
/** Greater Kampala — bias autocomplete/text search toward local POIs (SafeBoda-style). */
const KAMPALA_CENTER = { lat: 0.3476, lng: 32.5825 };
const KAMPALA_BIAS_RADIUS_M = 40000;
const GPS_BIAS_RADIUS_M = 15000;
/** Prefer named places within this distance of the GPS fix. */
const NEARBY_POI_RADIUS_M = 90;
const NEARBY_POI_MAX_M = 140;

let gmapsLoaded = false;
let gmapsLoading = false;

/** @type {Promise<Record<string, unknown>> | null} */
let placesLibPromise = null;

/** @type {{ lat: number, lng: number } | null} */
let placesSearchOrigin = null;

/** @type {Map<string, { at: number, predictions: unknown[] }>} */
const suggestionCache = new Map();

/** @type {Array<{ cleanup: () => void }>} */
const activeWidgets = [];
let wireGeneration = 0;

function getPlacesLibrary() {
  if (!placesLibPromise) {
    placesLibPromise = google.maps.importLibrary('places').catch((err) => {
      placesLibPromise = null;
      throw err;
    });
  }
  return placesLibPromise;
}

function prefetchPlacesLibrary() {
  if (window.google?.maps) void getPlacesLibrary();
}

/** Remember GPS / last pin so autocomplete ranks nearby Kampala POIs first. */
export function setPlacesSearchOrigin(latLng) {
  const lat = Number(latLng?.lat);
  const lng = Number(latLng?.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
  placesSearchOrigin = { lat, lng };
}

function biasCenter() {
  return placesSearchOrigin || KAMPALA_CENTER;
}

function biasRadiusM() {
  return placesSearchOrigin ? GPS_BIAS_RADIUS_M : KAMPALA_BIAS_RADIUS_M;
}

function suggestionCacheKey(query, regionCodes) {
  const c = biasCenter();
  const cell = `${c.lat.toFixed(2)},${c.lng.toFixed(2)}`;
  return `${(regionCodes || []).join(',')}\0${cell}\0${query}`;
}

function toLatLngLiteral(loc) {
  if (!loc) return null;
  const lat = typeof loc.lat === 'function' ? loc.lat() : loc.lat;
  const lng = typeof loc.lng === 'function' ? loc.lng() : loc.lng;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return { lat, lng };
}

function haversineMeters(a, b) {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Ride-app style: "Business Name, Plot …, Road, Kampala". */
function formatPlaceLabel(place) {
  const name = (place?.displayName || '').trim();
  const addr = (place?.formattedAddress || '').trim();
  if (name && addr) {
    if (addr.toLowerCase().includes(name.toLowerCase())) return addr;
    return `${name}, ${addr}`;
  }
  return addr || name || '';
}

function getCachedSuggestions(key) {
  const hit = suggestionCache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at > SUGGESTION_CACHE_TTL_MS) {
    suggestionCache.delete(key);
    return null;
  }
  // LRU touch
  suggestionCache.delete(key);
  suggestionCache.set(key, hit);
  return hit.predictions;
}

function setCachedSuggestions(key, predictions) {
  if (suggestionCache.has(key)) suggestionCache.delete(key);
  suggestionCache.set(key, { at: Date.now(), predictions });
  while (suggestionCache.size > SUGGESTION_CACHE_MAX) {
    const oldest = suggestionCache.keys().next().value;
    suggestionCache.delete(oldest);
  }
}

export function loadGoogleMaps(cb) {
  if (gmapsLoaded && window.google?.maps) {
    prefetchPlacesLibrary();
    Promise.resolve().then(() => cb());
    return;
  }
  window.__venusGmapsQueue = window.__venusGmapsQueue || [];
  window.__venusGmapsQueue.push(cb);
  if (gmapsLoading) return;
  gmapsLoading = true;
  window.__venusGmapsReady = () => {
    gmapsLoaded = true;
    gmapsLoading = false;
    prefetchPlacesLibrary();
    const queue = window.__venusGmapsQueue || [];
    window.__venusGmapsQueue = [];
    queue.reduce(
      (chain, fn) => chain.then(() => Promise.resolve(fn())),
      Promise.resolve(),
    );
  };
  const script = document.createElement('script');
  script.src = `https://maps.googleapis.com/maps/api/js?key=${GOOGLE_MAPS_API_KEY}&loading=async&callback=__venusGmapsReady`;
  script.async = true;
  script.onerror = () => {
    gmapsLoading = false;
    logDebug('Google Maps script failed to load.');
    showToast('Could not load Google Maps — check the API key', true);
  };
  document.head.appendChild(script);
}

export function deliveryPlaceFieldMarkup({
  inputId,
  dropdownId,
  value = '',
  placeholder = '',
  icon = '',
}) {
  return `
    <div class="delivery-place-field">
      <div class="delivery-place-input-row">
        ${icon ? `<span class="di-icon">${icon}</span>` : ''}
        <input type="text" class="client-input" id="${inputId}" placeholder="${escapeHtml(placeholder)}" autocomplete="off" value="${escapeHtml(value)}" aria-autocomplete="list" aria-controls="${dropdownId}" aria-expanded="false" />
      </div>
      <div class="suggest-menu delivery-place-dropdown" id="${dropdownId}" role="listbox"></div>
    </div>`;
}

export function clearPlaceAutocompleteWidgets() {
  activeWidgets.forEach((widget) => widget.cleanup());
  activeWidgets.length = 0;
}

const GEOCODE_LOCATION_RANK = {
  ROOFTOP: 0,
  RANGE_INTERPOLATED: 1,
  GEOMETRIC_CENTER: 2,
  APPROXIMATE: 3,
};

const GEOCODE_TYPE_RANK = [
  'premise',
  'subpremise',
  'point_of_interest',
  'establishment',
  'street_address',
  'intersection',
  'route',
  'plus_code',
  'neighborhood',
  'sublocality_level_1',
  'sublocality',
  'locality',
];

function geocodeTypeRank(result) {
  const types = result?.types || [];
  let best = GEOCODE_TYPE_RANK.length;
  for (const type of types) {
    const idx = GEOCODE_TYPE_RANK.indexOf(type);
    if (idx !== -1 && idx < best) best = idx;
  }
  return best;
}

function pickBestGeocodeResult(results) {
  if (!results?.length) return null;
  let best = results[0];
  let bestLoc = GEOCODE_LOCATION_RANK[best.geometry?.location_type] ?? 9;
  let bestType = geocodeTypeRank(best);
  for (let i = 1; i < results.length; i++) {
    const result = results[i];
    const loc = GEOCODE_LOCATION_RANK[result.geometry?.location_type] ?? 9;
    if (loc > bestLoc) continue;
    const type = geocodeTypeRank(result);
    if (loc < bestLoc || type < bestType) {
      best = result;
      bestLoc = loc;
      bestType = type;
    }
  }
  return best;
}

function isCoarseGeocodeResult(result) {
  if (!result) return true;
  if (result.geometry?.location_type === 'APPROXIMATE') {
    const types = result.types || [];
    return !types.some((t) =>
      [
        'street_address',
        'premise',
        'subpremise',
        'point_of_interest',
        'establishment',
        'route',
        'intersection',
        'plus_code',
      ].includes(t),
    );
  }
  return false;
}

function plusCodeLabel(results) {
  const plus = results?.find((r) => (r.types || []).includes('plus_code'));
  return plus?.formatted_address || '';
}

function geocodeAddress(latLng) {
  return new Promise((resolve) => {
    try {
      new google.maps.Geocoder().geocode({ location: latLng }, (results, status) => {
        if (status !== 'OK' || !results?.length) {
          resolve({ label: '', results: [] });
          return;
        }
        const best = pickBestGeocodeResult(results);
        const plus = plusCodeLabel(results);
        if (isCoarseGeocodeResult(best) && plus) {
          resolve({ label: plus, results });
          return;
        }
        resolve({ label: best?.formatted_address || plus || '', results });
      });
    } catch {
      resolve({ label: '', results: [] });
    }
  });
}

/**
 * Closest named place near the pin — ride apps surface these over bare street numbers.
 */
async function findNearbyPoiLabel(latLng) {
  try {
    const { Place, SearchNearbyRankPreference } = await getPlacesLibrary();
    const center = { lat: Number(latLng.lat), lng: Number(latLng.lng) };
    const { places } = await Place.searchNearby({
      fields: ['displayName', 'formattedAddress', 'location', 'types'],
      locationRestriction: { center, radius: NEARBY_POI_RADIUS_M },
      maxResultCount: 5,
      rankPreference: SearchNearbyRankPreference.DISTANCE,
    });
    if (!places?.length) return '';

    let best = null;
    let bestDist = Infinity;
    for (const place of places) {
      const loc = toLatLngLiteral(place.location);
      if (!loc) continue;
      const dist = haversineMeters(center, loc);
      if (dist > NEARBY_POI_MAX_M) continue;
      const types = place.types || [];
      // Skip generic political/admin areas — we want hostels, shops, landmarks.
      if (
        types.includes('locality') ||
        types.includes('political') ||
        types.includes('administrative_area_level_1') ||
        types.includes('administrative_area_level_2') ||
        types.includes('country') ||
        types.includes('route')
      ) {
        continue;
      }
      if (dist < bestDist) {
        best = place;
        bestDist = dist;
      }
    }
    return best ? formatPlaceLabel(best) : '';
  } catch (err) {
    logDebug(`Nearby POI lookup failed: ${err?.message || err}`);
    return '';
  }
}

/**
 * Reverse-geocode coords → human label. Prefers nearby POI names (SafeBoda-like)
 * over bare street numbers when Google has a place within ~90m.
 */
export function reverseGeocodeLabel(latLng, cb) {
  setPlacesSearchOrigin(latLng);
  loadGoogleMaps(() => {
    const fallback = `${Number(latLng.lat).toFixed(5)}, ${Number(latLng.lng).toFixed(5)}`;
    void (async () => {
      try {
        const [{ label: streetLabel }, poiLabel] = await Promise.all([
          geocodeAddress(latLng),
          findNearbyPoiLabel(latLng),
        ]);
        cb(poiLabel || streetLabel || fallback);
      } catch (err) {
        logDebug(`Reverse geocode failed: ${err?.message || err}`);
        cb(fallback);
      }
    })();
  });
}

function resolveDeliveryInput(id) {
  const el = document.getElementById(id);
  if (!el || el.tagName !== 'INPUT') return null;
  return el;
}

function highlightFormattableText(formattable) {
  const text = formattable?.text || '';
  const matches = formattable?.matches || [];
  if (!text) return '';
  if (!matches.length) return escapeHtml(text);

  let needsSort = false;
  for (let i = 1; i < matches.length; i++) {
    if (matches[i].startOffset < matches[i - 1].startOffset) {
      needsSort = true;
      break;
    }
  }
  const ordered = needsSort
    ? [...matches].sort((a, b) => a.startOffset - b.startOffset)
    : matches;

  let html = '';
  let last = 0;
  for (const match of ordered) {
    html += escapeHtml(text.slice(last, match.startOffset));
    html += `<mark class="client-match">${escapeHtml(text.slice(match.startOffset, match.endOffset))}</mark>`;
    last = match.endOffset;
  }
  html += escapeHtml(text.slice(last));
  return html;
}

function wrapAutocompletePrediction(placePrediction) {
  return {
    kind: 'autocomplete',
    placePrediction,
    mainText: placePrediction.mainText,
    secondaryText: placePrediction.secondaryText,
    text: placePrediction.text,
  };
}

function wrapTextSearchPlace(place) {
  const name = (place.displayName || '').trim();
  const addr = (place.formattedAddress || '').trim();
  return {
    kind: 'place',
    place,
    mainText: { text: name || addr, matches: [] },
    secondaryText: name && addr ? { text: addr, matches: [] } : null,
    text: { toString: () => formatPlaceLabel(place) },
  };
}

function renderPredictionLabel(prediction, query) {
  if (prediction.mainText?.text) {
    const main = highlightFormattableText(prediction.mainText);
    const secondary = prediction.secondaryText?.text
      ? `<span class="delivery-place-row-secondary">${highlightFormattableText(prediction.secondaryText)}</span>`
      : '';
    return `${main}${secondary}`;
  }

  const full = prediction.text?.toString?.() || '';
  return highlightClientName(full, query);
}

async function searchPlacesByText(query, regionCodes) {
  const { Place } = await getPlacesLibrary();
  const center = biasCenter();
  const { places } = await Place.searchByText({
    textQuery: query,
    fields: ['displayName', 'formattedAddress', 'location'],
    locationBias: { center, radius: biasRadiusM() },
    region: regionCodes?.[0] || 'ug',
    maxResultCount: MAX_SUGGESTIONS,
  });
  return (places || []).map(wrapTextSearchPlace);
}

const BLUR_HIDE_MS = 140;

function attachPlaceAutocomplete(
  input,
  dropdown,
  { onSelect, onInput, onFocus, onActivate, regionCodes = ['ug'] },
) {
  let sessionToken = null;
  let debounceTimer = null;
  let hideTimer = null;
  let requestGen = 0;
  let selecting = false;
  let activeQuery = '';
  /** @type {unknown[]} */
  let visiblePredictions = [];

  const setExpanded = (open) => {
    input.setAttribute('aria-expanded', open ? 'true' : 'false');
  };

  const hide = () => {
    clearTimeout(hideTimer);
    hideTimer = null;
    animateDropdown(dropdown, false);
    setExpanded(false);
  };

  const hideSoon = () => {
    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => {
      if (!selecting) hide();
    }, BLUR_HIDE_MS);
  };

  const cancelHide = () => {
    clearTimeout(hideTimer);
    hideTimer = null;
  };

  const showResults = (html, { contentUpdate = false } = {}) => {
    dropdown.innerHTML = html;
    animateDropdown(dropdown, true, { contentUpdate });
    setExpanded(true);
  };

  const renderPredictions = (predictions, trimmed, { contentUpdate = false } = {}) => {
    visiblePredictions = predictions;
    if (!predictions.length) {
      showResults('<div class="suggest-empty delivery-place-empty">No matches</div>', { contentUpdate });
      return;
    }

    const html = predictions
      .map(
        (prediction, index) => `
        <button class="suggest-row delivery-place-row" type="button" role="option" data-prediction="${index}">
          <span class="delivery-place-row-icon" aria-hidden="true">${PLACE_PIN_ICON}</span>
          <span class="delivery-place-row-text">${renderPredictionLabel(prediction, trimmed)}</span>
        </button>`,
      )
      .join('');

    showResults(html, { contentUpdate });
  };

  const scheduleFetch = (query) => {
    clearTimeout(debounceTimer);
    const trimmed = query.trim();
    if (trimmed.length < MIN_QUERY_LEN) {
      void fetchSuggestions(query);
      return;
    }

    const cacheKey = suggestionCacheKey(trimmed.toLowerCase(), regionCodes);
    if (getCachedSuggestions(cacheKey)) {
      void fetchSuggestions(query);
      return;
    }

    const wasOpen = dropdown.classList.contains('open');
    if (!wasOpen) {
      showResults(`
        <div class="delivery-place-loading" role="status" aria-live="polite" aria-label="Searching locations">
          ${[0, 1, 2]
            .map(
              (i) => `
            <div class="delivery-place-loading-row" style="animation-delay:${i * 80}ms">
              <span class="delivery-place-loading-pin" aria-hidden="true"></span>
              <span class="delivery-place-loading-lines" aria-hidden="true">
                <span class="sk-line wide"></span>
                <span class="sk-line short"></span>
              </span>
            </div>`,
            )
            .join('')}
        </div>`);
    }

    debounceTimer = setTimeout(() => {
      void fetchSuggestions(query);
    }, FETCH_DEBOUNCE_MS);
  };

  const fetchSuggestions = async (query) => {
    const trimmed = query.trim();
    activeQuery = trimmed;

    if (trimmed.length < MIN_QUERY_LEN) {
      visiblePredictions = [];
      dropdown.innerHTML = '';
      hide();
      return;
    }

    const normalized = trimmed.toLowerCase();
    const cacheKey = suggestionCacheKey(normalized, regionCodes);
    const cached = getCachedSuggestions(cacheKey);
    if (cached) {
      renderPredictions(cached, trimmed, {
        contentUpdate: dropdown.classList.contains('open'),
      });
      return;
    }

    const reqId = ++requestGen;
    const wasOpen = dropdown.classList.contains('open');

    try {
      const { AutocompleteSessionToken, AutocompleteSuggestion } = await getPlacesLibrary();
      if (!sessionToken) sessionToken = new AutocompleteSessionToken();

      const center = biasCenter();
      const { suggestions } = await AutocompleteSuggestion.fetchAutocompleteSuggestions({
        input: trimmed,
        sessionToken,
        includedRegionCodes: regionCodes,
        region: regionCodes?.[0] || 'ug',
        language: 'en',
        locationBias: { center, radius: biasRadiusM() },
        origin: center,
      });
      if (reqId !== requestGen || activeQuery !== trimmed) return;

      let predictions = suggestions
        .map((suggestion) => suggestion.placePrediction)
        .filter(Boolean)
        .map(wrapAutocompletePrediction)
        .slice(0, MAX_SUGGESTIONS);

      // Autocomplete alone often misses Kampala POIs/hostel names SafeBoda shows.
      const wantsTextFallback =
        trimmed.length >= 3 &&
        (predictions.length < 3 || /\s/.test(trimmed));
      if (wantsTextFallback) {
        try {
          const textHits = await searchPlacesByText(trimmed, regionCodes);
          if (reqId !== requestGen || activeQuery !== trimmed) return;
          const seen = new Set(
            predictions.map((p) => (p.text?.toString?.() || '').toLowerCase()).filter(Boolean),
          );
          for (const hit of textHits) {
            const key = (hit.text?.toString?.() || '').toLowerCase();
            if (key && seen.has(key)) continue;
            if (key) seen.add(key);
            predictions.push(hit);
            if (predictions.length >= MAX_SUGGESTIONS) break;
          }
        } catch (textErr) {
          logDebug(`Place text search failed: ${textErr?.message || textErr}`);
        }
      }

      setCachedSuggestions(cacheKey, predictions);
      renderPredictions(predictions, trimmed, { contentUpdate: wasOpen });
    } catch (err) {
      if (reqId !== requestGen) return;
      logDebug(`Place suggestions failed: ${err?.message || err}`);
      // Last resort: text search only (still Kampala-biased).
      try {
        const textHits = await searchPlacesByText(trimmed, regionCodes);
        if (reqId !== requestGen || activeQuery !== trimmed) return;
        setCachedSuggestions(cacheKey, textHits);
        renderPredictions(textHits, trimmed, { contentUpdate: wasOpen });
      } catch {
        hide();
      }
    }
  };

  const selectPrediction = async (prediction) => {
    selecting = true;
    cancelHide();
    try {
      let place;
      if (prediction?.kind === 'place' && prediction.place) {
        place = prediction.place;
        if (!place.location || !place.formattedAddress) {
          await place.fetchFields({ fields: ['displayName', 'formattedAddress', 'location'] });
        }
      } else {
        const placePrediction = prediction?.placePrediction || prediction;
        place = placePrediction.toPlace();
        await place.fetchFields({ fields: ['displayName', 'formattedAddress', 'location'] });
      }

      const coords = toLatLngLiteral(place.location);
      if (!coords) return;
      const label =
        formatPlaceLabel(place) ||
        prediction?.text?.toString?.() ||
        '';
      input.value = label;
      sessionToken = null;
      setPlacesSearchOrigin(coords);
      hide();
      onSelect({
        lat: coords.lat,
        lng: coords.lng,
        label,
      });
    } catch (err) {
      logDebug(`Place select failed: ${err?.message || err}`);
    } finally {
      selecting = false;
    }
  };

  const onInputHandler = () => {
    onInput?.(input.value);
    scheduleFetch(input.value);
  };

  const onFocusHandler = () => {
    cancelHide();
    prefetchPlacesLibrary();
    onFocus?.();
    onActivate?.();
    if (input.value.trim().length >= MIN_QUERY_LEN) scheduleFetch(input.value);
  };

  const onBlurHandler = () => {
    if (!selecting) hideSoon();
  };

  const onKeyDown = (e) => {
    if (e.key !== 'Escape') return;
    e.preventDefault();
    hide();
    input.blur();
  };

  const preventRowBlur = (e) => {
    if (e.target.closest?.('.suggest-row, .delivery-place-row')) e.preventDefault();
  };

  const onDropdownClick = (e) => {
    const row = e.target.closest?.('.delivery-place-row');
    if (!row) return;
    const prediction = visiblePredictions[Number(row.dataset.prediction)];
    if (prediction) void selectPrediction(prediction);
  };

  input.addEventListener('input', onInputHandler);
  input.addEventListener('focus', onFocusHandler);
  input.addEventListener('blur', onBlurHandler);
  input.addEventListener('keydown', onKeyDown);
  dropdown.addEventListener('mousedown', preventRowBlur);
  dropdown.addEventListener('pointerdown', preventRowBlur);
  dropdown.addEventListener('click', onDropdownClick);

  return {
    cleanup: () => {
      clearTimeout(debounceTimer);
      clearTimeout(hideTimer);
      input.removeEventListener('input', onInputHandler);
      input.removeEventListener('focus', onFocusHandler);
      input.removeEventListener('blur', onBlurHandler);
      input.removeEventListener('keydown', onKeyDown);
      dropdown.removeEventListener('mousedown', preventRowBlur);
      dropdown.removeEventListener('pointerdown', preventRowBlur);
      dropdown.removeEventListener('click', onDropdownClick);
      visiblePredictions = [];
      dropdown.innerHTML = '';
      hide();
    },
  };
}

/**
 * Wire pickup + drop-off Places autocompletes. Resolves inputs inside the Maps
 * callback so re-renders cannot leave widgets bound to detached nodes.
 */
export function wireDeliveryPlacesInputs(
  pickupId,
  pickupDropdownId,
  destId,
  destDropdownId,
  {
    onPickupSelect,
    onDestSelect,
    onPickupInput,
    onDestInput,
    onPickupFocus,
    onDestFocus,
    regionCodes = ['ug'],
  } = {},
) {
  if (!pickupId || !pickupDropdownId || !destId || !destDropdownId) return;
  const gen = ++wireGeneration;
  loadGoogleMaps(() => {
    if (gen !== wireGeneration) return;
    prefetchPlacesLibrary();
    clearPlaceAutocompleteWidgets();

    const pickupInput = resolveDeliveryInput(pickupId);
    const pickupDropdown = document.getElementById(pickupDropdownId);
    const destInput = resolveDeliveryInput(destId);
    const destDropdown = document.getElementById(destDropdownId);
    if (!pickupInput || !pickupDropdown || !destInput || !destDropdown) return;

    const closePickupSiblings = () => animateDropdown(destDropdown, false);
    const closeDestSiblings = () => animateDropdown(pickupDropdown, false);

    const pickupWidget = attachPlaceAutocomplete(pickupInput, pickupDropdown, {
      onSelect: onPickupSelect,
      onInput: onPickupInput,
      onFocus: onPickupFocus,
      onActivate: closePickupSiblings,
      regionCodes,
    });
    if (gen !== wireGeneration) {
      pickupWidget.cleanup();
      return;
    }
    activeWidgets.push(pickupWidget);

    const destWidget = attachPlaceAutocomplete(destInput, destDropdown, {
      onSelect: onDestSelect,
      onInput: onDestInput,
      onFocus: onDestFocus,
      onActivate: closeDestSiblings,
      regionCodes,
    });
    if (gen !== wireGeneration) {
      destWidget.cleanup();
      return;
    }
    activeWidgets.push(destWidget);
  });
}

export function setDeliveryFieldValue(id, value) {
  const el = document.getElementById(id);
  if (!el) return;
  el.value = value;
}
