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

let gmapsLoaded = false;
let gmapsLoading = false;

/** @type {Promise<{ AutocompleteSessionToken: unknown, AutocompleteSuggestion: unknown }> | null} */
let placesLibPromise = null;

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

function suggestionCacheKey(query, regionCodes) {
  return `${(regionCodes || []).join(',')}\0${query}`;
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
  'street_address',
  'premise',
  'subpremise',
  'point_of_interest',
  'establishment',
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
      ['street_address', 'premise', 'subpremise', 'route', 'intersection', 'plus_code'].includes(t),
    );
  }
  return false;
}

function plusCodeLabel(results) {
  const plus = results?.find((r) => (r.types || []).includes('plus_code'));
  return plus?.formatted_address || '';
}

/**
 * Reverse-geocode coords → human label, preferring rooftop/street-level
 * results (and Plus Codes when Google only has a coarse area name).
 */
export function reverseGeocodeLabel(latLng, cb) {
  loadGoogleMaps(() => {
    const fallback = `${Number(latLng.lat).toFixed(5)}, ${Number(latLng.lng).toFixed(5)}`;
    try {
      new google.maps.Geocoder().geocode({ location: latLng }, (results, status) => {
        if (status !== 'OK' || !results?.length) {
          cb(fallback);
          return;
        }

        const best = pickBestGeocodeResult(results);
        const plus = plusCodeLabel(results);
        if (isCoarseGeocodeResult(best) && plus) {
          cb(plus);
          return;
        }
        cb(best?.formatted_address || plus || fallback);
      });
    } catch (err) {
      logDebug(`Reverse geocode failed: ${err?.message || err}`);
      cb(fallback);
    }
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
      showResults('<div class="suggest-empty delivery-place-empty">Searching…</div>');
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

      const { suggestions } = await AutocompleteSuggestion.fetchAutocompleteSuggestions({
        input: trimmed,
        sessionToken,
        includedRegionCodes: regionCodes,
      });
      if (reqId !== requestGen || activeQuery !== trimmed) return;

      const predictions = suggestions
        .map((suggestion) => suggestion.placePrediction)
        .filter(Boolean)
        .slice(0, 6);

      setCachedSuggestions(cacheKey, predictions);
      renderPredictions(predictions, trimmed, { contentUpdate: wasOpen });
    } catch (err) {
      if (reqId !== requestGen) return;
      logDebug(`Place suggestions failed: ${err?.message || err}`);
      hide();
    }
  };

  const selectPrediction = async (placePrediction) => {
    selecting = true;
    cancelHide();
    try {
      const place = placePrediction.toPlace();
      await place.fetchFields({ fields: ['displayName', 'formattedAddress', 'location'] });
      const loc = place.location;
      if (!loc) return;
      const label =
        place.formattedAddress || place.displayName || placePrediction.text?.toString?.() || '';
      input.value = label;
      sessionToken = null;
      hide();
      onSelect({
        lat: typeof loc.lat === 'function' ? loc.lat() : loc.lat,
        lng: typeof loc.lng === 'function' ? loc.lng() : loc.lng,
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
