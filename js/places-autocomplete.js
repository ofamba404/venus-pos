import { GOOGLE_MAPS_API_KEY } from './config.js';
import { animateDropdown } from './animations.js';
import { highlightClientName } from './clients.js';
import { logDebug } from './debug.js';
import { escapeHtml, showToast } from './utils.js';

const PLACE_PIN_ICON = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 21.2s7.2-6.8 7.2-12.4a7.2 7.2 0 1 0-14.4 0c0 5.6 7.2 12.4 7.2 12.4z"></path><circle cx="12" cy="8.8" r="2.4"></circle></svg>`;
const MIN_QUERY_LEN = 2;
const FETCH_DEBOUNCE_MS = 320;

let gmapsLoaded = false;
let gmapsLoading = false;

/** @type {Array<{ cleanup: () => void }>} */
const activeWidgets = [];
let wireGeneration = 0;

export function loadGoogleMaps(cb) {
  if (gmapsLoaded && window.google?.maps) {
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
}) {
  return `
    <div class="delivery-place-field">
      <input type="text" class="client-input" id="${inputId}" placeholder="${escapeHtml(placeholder)}" autocomplete="off" value="${escapeHtml(value)}" />
      <div class="delivery-place-dropdown" id="${dropdownId}" role="listbox"></div>
    </div>`;
}

export function clearPlaceAutocompleteWidgets() {
  activeWidgets.forEach((widget) => widget.cleanup());
  activeWidgets.length = 0;
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

  const sorted = [...matches].sort((a, b) => a.startOffset - b.startOffset);
  let html = '';
  let last = 0;
  for (const match of sorted) {
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

function attachPlaceAutocomplete(
  input,
  dropdown,
  { onSelect, onInput, onFocus, onActivate, regionCodes = ['ug'] },
) {
  let sessionToken = null;
  let debounceTimer = null;
  let requestGen = 0;
  let selecting = false;
  let activeQuery = '';

  const hide = () => animateDropdown(dropdown, false);

  const showResults = (html, { contentUpdate = false } = {}) => {
    dropdown.innerHTML = html;
    animateDropdown(dropdown, true, { contentUpdate });
  };

  const scheduleFetch = (query) => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      void fetchSuggestions(query);
    }, FETCH_DEBOUNCE_MS);
  };

  const fetchSuggestions = async (query) => {
    const trimmed = query.trim();
    activeQuery = trimmed;

    if (trimmed.length < MIN_QUERY_LEN) {
      dropdown.innerHTML = '';
      hide();
      return;
    }

    const reqId = ++requestGen;
    const wasOpen = dropdown.classList.contains('open');

    try {
      const { AutocompleteSessionToken, AutocompleteSuggestion } =
        await google.maps.importLibrary('places');
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

      if (!predictions.length) {
        showResults('<div class="delivery-place-empty">No matches</div>', { contentUpdate: wasOpen });
        return;
      }

      const html = predictions
        .map(
          (prediction, index) => `
        <button class="delivery-place-row" type="button" data-prediction="${index}">
          <span class="delivery-place-row-icon" aria-hidden="true">${PLACE_PIN_ICON}</span>
          <span class="delivery-place-row-text">${renderPredictionLabel(prediction, trimmed)}</span>
        </button>`,
        )
        .join('');

      showResults(html, { contentUpdate: wasOpen });

      dropdown.querySelectorAll('.delivery-place-row').forEach((row) => {
        row.addEventListener('mousedown', (e) => e.preventDefault());
        row.addEventListener('click', () => {
          const index = Number(row.dataset.prediction);
          const prediction = predictions[index];
          if (prediction) void selectPrediction(prediction);
        });
      });
    } catch (err) {
      if (reqId !== requestGen) return;
      logDebug(`Place suggestions failed: ${err?.message || err}`);
      hide();
    }
  };

  const selectPrediction = async (placePrediction) => {
    selecting = true;
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
    onFocus?.();
    onActivate?.();
    if (input.value.trim().length >= MIN_QUERY_LEN) scheduleFetch(input.value);
  };

  const onBlurHandler = () => {
    if (!selecting) hide();
  };

  input.addEventListener('input', onInputHandler);
  input.addEventListener('focus', onFocusHandler);
  input.addEventListener('blur', onBlurHandler);

  return {
    cleanup: () => {
      clearTimeout(debounceTimer);
      input.removeEventListener('input', onInputHandler);
      input.removeEventListener('focus', onFocusHandler);
      input.removeEventListener('blur', onBlurHandler);
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
