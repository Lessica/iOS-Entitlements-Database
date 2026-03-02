const DATA_BASE = './data';
const V2_BASE = `${DATA_BASE}/v2`;
const THEME_STORAGE_KEY = 'entitlements-theme';
let themeToggleInitialized = false;

function resolvedTheme() {
  const stored = localStorage.getItem(THEME_STORAGE_KEY);
  if (stored === 'light' || stored === 'dark') {
    return stored;
  }
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
}

function toggleTheme(current) {
  return current === 'dark' ? 'light' : 'dark';
}

function buttonLabel(theme) {
  return theme === 'dark' ? '☀️ Light' : '🌙 Dark';
}

export function initThemeToggle() {
  if (themeToggleInitialized) {
    return;
  }
  themeToggleInitialized = true;

  const initialTheme = resolvedTheme();
  applyTheme(initialTheme);

  let button = document.getElementById('theme-toggle');
  if (!button) {
    button = document.createElement('button');
    button.id = 'theme-toggle';
    button.className = 'theme-toggle';
    button.type = 'button';
    document.body.appendChild(button);
  }

  button.textContent = buttonLabel(initialTheme);
  button.setAttribute('aria-label', 'Toggle light and dark theme');

  button.addEventListener('click', () => {
    const current = document.documentElement.getAttribute('data-theme') || resolvedTheme();
    const next = toggleTheme(current);
    applyTheme(next);
    localStorage.setItem(THEME_STORAGE_KEY, next);
    button.textContent = buttonLabel(next);
  });
}

async function fetchJson(name) {
  const response = await fetch(`${DATA_BASE}/${name}`);
  if (!response.ok) {
    throw new Error(`Failed to load ${name}: ${response.status}`);
  }
  return await response.json();
}

async function fetchJsonOptional(url) {
  const response = await fetch(url);
  if (response.status === 404) {
    return null;
  }
  if (!response.ok) {
    throw new Error(`Failed to load ${url}: ${response.status}`);
  }
  return await response.json();
}

function queryParam(name) {
  return new URLSearchParams(window.location.search).get(name) ?? '';
}

function currentVersionParam() {
  return queryParam('version').trim();
}

function withVersionParam(href, versionId = currentVersionParam()) {
  if (!href || !versionId) {
    return href;
  }

  try {
    const url = new URL(href, window.location.href);
    if (url.origin !== window.location.origin) {
      return href;
    }
    url.searchParams.set('version', versionId);
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return href;
  }
}

function refreshVersionLinks(versionId = currentVersionParam()) {
  if (!versionId) {
    return;
  }

  const anchors = document.querySelectorAll('a[href]');
  for (const anchor of anchors) {
    const rawHref = anchor.getAttribute('href') ?? '';
    if (!rawHref || rawHref.startsWith('#') || rawHref.startsWith('mailto:') || rawHref.startsWith('tel:')) {
      continue;
    }

    const updatedHref = withVersionParam(rawHref, versionId);
    anchor.setAttribute('href', updatedHref);
  }
}

function runWithStableViewport(updateFn, anchorEl = null) {
  const scrollX = window.scrollX;
  const scrollY = window.scrollY;
  const anchorTop = anchorEl?.getBoundingClientRect().top ?? null;

  updateFn();

  requestAnimationFrame(() => {
    if (anchorEl && anchorTop !== null) {
      const nextTop = anchorEl.getBoundingClientRect().top;
      const delta = nextTop - anchorTop;
      window.scrollBy(0, delta);
      return;
    }

    window.scrollTo(scrollX, scrollY);
  });
}

function formatCount(value) {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return 'unknown';
  }
  return new Intl.NumberFormat('en-US').format(value);
}

function formatGeneratedAt(isoText) {
  if (!isoText) {
    return 'unknown';
  }

  const date = new Date(isoText);
  if (Number.isNaN(date.getTime())) {
    return String(isoText);
  }

  return date.toISOString().replace('T', ' ').replace('.000Z', ' UTC').replace('Z', ' UTC');
}

function sanitizeFilePart(text) {
  return String(text).replace(/[^a-zA-Z0-9._-]+/g, '_').replace(/^_+|_+$/g, '') || 'entitlements';
}

function plistDownloadFilename(path, versionId) {
  const baseName = path.split('/').filter(Boolean).pop() || 'entitlements';
  const safeName = sanitizeFilePart(baseName);
  const safeVersion = sanitizeFilePart(versionId || 'current');
  return `${safeName}__${safeVersion}.plist`;
}

function buildRootPlistText(data) {
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
    '<plist version="1.0">',
    plistFragment(data, 1),
    '</plist>',
    '',
  ].join('\n');
}

function triggerTextDownload(text, filename, mimeType) {
  const blob = new Blob([text], { type: mimeType });
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = objectUrl;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(objectUrl), 0);
}

function setQueryParam(name, value) {
  const url = new URL(window.location.href);
  url.searchParams.set(name, value);
  window.history.replaceState({}, '', url);
}

function renderNoData(summaryEl, listEl, message) {
  summaryEl.textContent = message;
  summaryEl.hidden = !message;
  listEl.innerHTML = '';
  syncResultsVisibility(listEl);
}

function renderLoading(summaryEl, listEl) {
  summaryEl.textContent = 'Loading…';
  summaryEl.hidden = false;
  listEl.innerHTML = '';
  syncResultsVisibility(listEl);
}

function syncResultsVisibility(listEl) {
  listEl.hidden = listEl.childElementCount === 0;
}

function buildHistoryUrl({ path = '', key = '' }) {
  const params = new URLSearchParams();
  if (path) {
    params.set('path', path);
  }
  if (key) {
    params.set('key', key);
  }
  const versionId = currentVersionParam();
  if (versionId) {
    params.set('version', versionId);
  }
  const suffix = params.toString();
  return suffix ? `./history.html?${suffix}` : './history.html';
}

function createResultItem(
  targetHref,
  title,
  versionLabels,
  historyHref = '',
  extraElement = null,
  itemOptions = {},
) {
  const {
    selectablePills = false,
    activeVersionId = '',
    onVersionSelect = null,
    onVersionClick = null,
    shouldShowActiveMarker = null,
  } = itemOptions;

  const item = document.createElement('li');
  item.className = 'result-item';

  const head = document.createElement('div');
  head.className = 'result-head';

  const main = document.createElement('a');
  main.className = 'item-main';
  main.href = withVersionParam(targetHref);
  main.textContent = title;
  head.appendChild(main);

  if (historyHref) {
    const historyLink = document.createElement('a');
    historyLink.className = 'history-link';
    historyLink.href = withVersionParam(historyHref);
    historyLink.title = 'View value history';
    historyLink.setAttribute('aria-label', 'View value history');
    historyLink.textContent = '🕘';
    head.appendChild(historyLink);
  }

  const versions = document.createElement('div');
  versions.className = 'version-list';
  const pillNodes = [];
  const movingActiveMarker = selectablePills
    ? (() => {
      const marker = document.createElement('span');
      marker.className = 'version-pill-part version-pill-active-marker';
      marker.textContent = '↓';
      return marker;
    })()
    : null;

  const setActivePill = (versionId) => {
    for (const node of pillNodes) {
      node.classList.toggle('version-pill-active', node.dataset.versionId === versionId);
    }

    if (movingActiveMarker) {
      const activePill = pillNodes.find((node) => node.dataset.versionId === versionId) ?? null;
      if (!activePill) {
        movingActiveMarker.remove();
        return;
      }

      const shouldShow =
        typeof shouldShowActiveMarker === 'function'
          ? shouldShowActiveMarker(versionId)
          : true;
      if (shouldShow) {
        activePill.appendChild(movingActiveMarker);
      } else {
        movingActiveMarker.remove();
      }
    }
  };

  const applyVersionSelection = (versionId) => {
    setActivePill(versionId);
    if (typeof onVersionSelect === 'function') {
      onVersionSelect(versionId);
    }
  };

  for (const version of versionLabels) {
    const pill = selectablePills ? document.createElement('button') : document.createElement('span');
    pill.className = selectablePills ? 'version-pill version-pill-interactive' : 'version-pill';
    if (selectablePills) {
      pill.type = 'button';
      pill.dataset.versionId = version.versionId;
      pill.setAttribute('aria-label', `Show value for ${version.iosVersion} (${version.build})`);
      pill.addEventListener('click', () => {
        applyVersionSelection(version.versionId);
        if (typeof onVersionClick === 'function') {
          onVersionClick(version.versionId, item);
        }
      });
    }
    pill.style.setProperty('--pill-hue', String(stableHue(version.versionId)));

    const versionPart = document.createElement('span');
    versionPart.className = 'version-pill-part';
    versionPart.textContent = version.iosVersion;

    const separator = document.createElement('span');
    separator.className = 'version-pill-separator';
    separator.setAttribute('aria-hidden', 'true');

    const buildPart = document.createElement('span');
    buildPart.className = 'version-pill-part version-pill-build';
    buildPart.textContent = version.build;

    pill.append(versionPart, separator, buildPart);
    if (!selectablePills && version.isPrimaryMarker) {
      const primaryMarker = document.createElement('span');
      primaryMarker.className = 'version-pill-part version-pill-active-marker';
      primaryMarker.textContent = '↓';
      pill.appendChild(primaryMarker);
    }

    pillNodes.push(pill);
    versions.appendChild(pill);
  }

  if (selectablePills) {
    const fallback = versionLabels[0]?.versionId ?? '';
    const selectedId = activeVersionId || fallback;
    if (selectedId) {
      applyVersionSelection(selectedId);
    }

    item.applyVersionSelection = applyVersionSelection;
  }

  item.append(head, versions);
  if (extraElement) {
    item.appendChild(extraElement);
  }
  return item;
}

function stableHue(text) {
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash) % 360;
}

function fnvShardPrefix(text) {
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  const shard = hash % 256;
  return shard.toString(16).padStart(2, '0');
}

async function loadCoreData(indexFile) {
  const [versions, index] = await Promise.all([
    fetchJson('versions.json'),
    fetchJson(indexFile),
  ]);

  const versionLabelById = new Map();
  const versionRankById = new Map();
  for (const version of versions) {
    versionRankById.set(version.version_id, versionRankById.size);
    versionLabelById.set(version.version_id, {
      iosVersion: version.ios_version,
      build: version.build,
    });
  }

  const byName = new Map();
  for (const row of index) {
    byName.set(row.name, row.entries);
  }

  return { versionLabelById, versionRankById, byName };
}

async function loadVersions() {
  return await fetchJson('versions.json');
}

function normalizeForFilter(text) {
  return text.trim().toLowerCase();
}

function debounce(fn, waitMs) {
  let timer = null;
  return (...args) => {
    if (timer !== null) {
      clearTimeout(timer);
    }
    timer = setTimeout(() => fn(...args), waitMs);
  };
}

function findHintCandidates(nameEntries, keyword, limit) {
  if (!keyword) {
    return [];
  }

  const results = [];
  const seen = new Set();

  for (const entry of nameEntries) {
    if (!entry.normalized.startsWith(keyword)) {
      continue;
    }
    results.push(entry.original);
    seen.add(entry.original);
    if (results.length >= limit) {
      return results;
    }
  }

  for (const entry of nameEntries) {
    if (!entry.normalized.includes(keyword)) {
      continue;
    }
    if (seen.has(entry.original)) {
      continue;
    }
    results.push(entry.original);
    if (results.length >= limit) {
      return results;
    }
  }

  return results;
}

function attachRealtimeHints(input, allNames, onSelect) {
  const disableHintsOnSmallScreen = window.matchMedia('(max-width: 768px)').matches;
  if (disableHintsOnSmallScreen) {
    input.removeAttribute('list');
    input.setAttribute('autocomplete', 'off');
    return {
      dismissHints: () => { },
    };
  }

  const datalistId = `${input.id}-hints`;
  let datalist = document.getElementById(datalistId);
  if (!datalist) {
    datalist = document.createElement('datalist');
    datalist.id = datalistId;
    input.insertAdjacentElement('afterend', datalist);
  }

  input.setAttribute('list', datalistId);
  input.setAttribute('autocomplete', 'off');

  const nameEntries = allNames.map((name) => ({
    original: name,
    normalized: name.toLowerCase(),
  }));
  const exactNameSet = new Set(allNames);

  const maybeTriggerImmediateSearch = () => {
    const value = input.value.trim();
    if (!value || !exactNameSet.has(value)) {
      return;
    }
    onSelect(value);
  };

  const updateHints = debounce(() => {
    const keyword = normalizeForFilter(input.value);
    const hints = findHintCandidates(nameEntries, keyword, 15);

    datalist.innerHTML = '';
    if (hints.length === 0) {
      return;
    }

    if (hints.length === 1 && hints[0].toLowerCase() === keyword) {
      return;
    }

    const fragment = document.createDocumentFragment();
    for (const hint of hints) {
      const option = document.createElement('option');
      option.value = hint;
      fragment.appendChild(option);
    }
    datalist.appendChild(fragment);
  }, 80);

  input.addEventListener('input', updateHints);
  input.addEventListener('change', maybeTriggerImmediateSearch);

  return {
    dismissHints: () => {
      datalist.innerHTML = '';
    },
  };
}

function filterNames(allNames, keyword) {
  if (!keyword) {
    return [];
  }
  return allNames.filter((name) => name.toLowerCase().includes(keyword));
}

function toVersionLabels(versionIds, versionLabelById, versionRankById = null) {
  const sortedVersionIds = [...versionIds];
  if (versionRankById instanceof Map) {
    sortedVersionIds.sort((left, right) => {
      const leftRank = versionRankById.get(left);
      const rightRank = versionRankById.get(right);
      const fallbackRank = Number.MAX_SAFE_INTEGER;
      return (leftRank ?? fallbackRank) - (rightRank ?? fallbackRank);
    });
  }

  const labels = [];
  for (const id of sortedVersionIds) {
    const versionInfo = versionLabelById.get(id);
    if (versionInfo) {
      labels.push({
        versionId: id,
        iosVersion: versionInfo.iosVersion,
        build: versionInfo.build,
      });
      continue;
    }

    const [iosVersion = id, build = 'unknown'] = id.split('|', 2);
    labels.push({
      versionId: id,
      iosVersion,
      build,
    });
  }
  return labels;
}

async function loadHistoryEntries(kind, name) {
  const shard = fnvShardPrefix(name);
  const data = await fetchJsonOptional(`${V2_BASE}/${kind}/${shard}.json`);
  if (!data || !data.items) {
    return [];
  }
  return data.items[name] ?? [];
}

const historyBucketCache = new Map();

async function loadHistoryBucket(bucketPrefix) {
  if (historyBucketCache.has(bucketPrefix)) {
    return historyBucketCache.get(bucketPrefix);
  }

  const payload = await fetchJsonOptional(`${V2_BASE}/buckets/${bucketPrefix}.json`);
  historyBucketCache.set(bucketPrefix, payload);
  return payload;
}

async function loadPairRecord(path, key) {
  const candidates = await loadHistoryEntries('key_index', key);
  const pair = candidates.find((item) => item.path === path);
  if (!pair) {
    return null;
  }

  const bucketPrefix = String(pair.pair_id).slice(0, 2);
  const bucket = await loadHistoryBucket(bucketPrefix);
  if (!bucket || !bucket.pairs) {
    return null;
  }

  return bucket.pairs[pair.pair_id] ?? null;
}

function statusForHistory(current, previous) {
  if (!current && !previous) {
    return 'missing';
  }
  if (current && !previous) {
    return 'added';
  }
  if (!current && previous) {
    return 'removed';
  }
  if (!current || !previous) {
    return 'missing';
  }
  if (current.value_hash === previous.value_hash) {
    return 'unchanged';
  }
  return 'changed';
}

function escapeXml(text) {
  return String(text)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

function plistIndent(depth) {
  return '  '.repeat(depth);
}

function plistFragment(value, depth = 0) {
  const indent = plistIndent(depth);

  if (value === null || value === undefined) {
    return `${indent}<string></string>`;
  }

  if (typeof value === 'boolean') {
    return value ? `${indent}<true/>` : `${indent}<false/>`;
  }

  if (typeof value === 'number') {
    if (Number.isInteger(value)) {
      return `${indent}<integer>${value}</integer>`;
    }
    return `${indent}<real>${value}</real>`;
  }

  if (typeof value === 'string') {
    return `${indent}<string>${escapeXml(value)}</string>`;
  }

  if (Array.isArray(value)) {
    if (value.length === 0) {
      return `${indent}<array/>`;
    }

    const lines = [`${indent}<array>`];
    for (const item of value) {
      lines.push(plistFragment(item, depth + 1));
    }
    lines.push(`${indent}</array>`);
    return lines.join('\n');
  }

  if (typeof value === 'object') {
    const entries = Object.entries(value);
    if (entries.length === 0) {
      return `${indent}<dict/>`;
    }

    const lines = [`${indent}<dict>`];
    for (const [key, item] of entries) {
      lines.push(`${plistIndent(depth + 1)}<key>${escapeXml(key)}</key>`);
      lines.push(plistFragment(item, depth + 1));
    }
    lines.push(`${indent}</dict>`);
    return lines.join('\n');
  }

  return `${indent}<string>${escapeXml(String(value))}</string>`;
}

function highlightPlist(plistText) {
  const lines = plistText.split('\n');

  return lines
    .map((line) => {
      const tagPattern = /<\/?[a-zA-Z0-9:-]+\s*\/?>/g;
      let output = '';
      let lastIndex = 0;
      let inKey = false;

      for (const match of line.matchAll(tagPattern)) {
        const tag = match[0];
        const index = match.index ?? 0;

        const textPart = line.slice(lastIndex, index)
          .replaceAll('<', '&lt;')
          .replaceAll('>', '&gt;');

        if (textPart.trim() === '') {
          output += textPart;
        } else if (inKey) {
          output += `<span class="xml-key">${textPart}</span>`;
        } else {
          output += `<span class="xml-text">${textPart}</span>`;
        }

        const isClosing = tag.startsWith('</');
        const isSelfClosing = tag.endsWith('/>');
        const nameMatch = tag.match(/^<\/?([a-zA-Z0-9:-]+)/);
        const tagName = nameMatch ? nameMatch[1] : '';

        const renderedTag = `&lt;${isClosing ? '/' : ''}${tagName}${isSelfClosing && !isClosing ? '/' : ''}&gt;`;
        output += `<span class="xml-tag">${renderedTag}</span>`;

        if (!isClosing && !isSelfClosing && tagName === 'key') {
          inKey = true;
        }
        if (isClosing && tagName === 'key') {
          inKey = false;
        }

        lastIndex = index + tag.length;
      }

      const tail = line.slice(lastIndex)
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;');

      if (tail.trim() === '') {
        output += tail;
      } else if (inKey) {
        output += `<span class="xml-key">${tail}</span>`;
      } else {
        output += `<span class="xml-text">${tail}</span>`;
      }

      return output;
    })
    .join('\n');
}

function historyVersionLabel(version) {
  const iosVersion = version.ios_version ?? version.version_id;
  const build = version.build ?? '';
  return build ? `${iosVersion} (${build})` : String(iosVersion);
}

async function loadPathDetailRecord(path) {
  const shard = fnvShardPrefix(path);
  const data = await fetchJsonOptional(`${V2_BASE}/path_detail_shards/${shard}.json`);
  if (!data || !data.items) {
    return null;
  }
  return data.items[path] ?? null;
}

async function loadKeyDetailRecord(key) {
  const shard = fnvShardPrefix(key);
  const data = await fetchJsonOptional(`${V2_BASE}/key_detail_shards/${shard}.json`);
  if (!data || !data.items) {
    return null;
  }
  return data.items[key] ?? null;
}

function createVersionSwitchableValueElement(valuesByVersion, initialVersionId) {
  const wrapper = document.createElement('div');
  wrapper.className = 'latest-value-block';

  const missing = document.createElement('div');
  missing.className = 'history-body';
  missing.textContent = 'Entitlement is not present in this version.';
  missing.hidden = true;

  const pre = document.createElement('pre');
  pre.className = 'history-value latest-value';
  wrapper.append(missing, pre);

  const renderVersion = (versionId) => {
    const payload = valuesByVersion?.[versionId];
    if (!payload) {
      missing.hidden = false;
      pre.hidden = true;
      pre.textContent = '';
      return;
    }

    missing.hidden = true;
    pre.hidden = false;
    pre.innerHTML = highlightPlist(plistFragment(payload.value));
  };

  renderVersion(initialVersionId);

  return {
    element: wrapper,
    onVersionSelect: renderVersion,
  };
}

function createHistoryTimelineItem(versionLabel, status, value, options = {}) {
  const { hideValueBody = false } = options;

  const item = document.createElement('li');
  item.className = 'result-item history-item';

  const head = document.createElement('div');
  head.className = 'history-head';

  const label = document.createElement('span');
  label.className = 'history-version';
  label.textContent = versionLabel;

  const badge = document.createElement('span');
  badge.className = `history-badge history-${status}`;
  badge.textContent = status;

  head.append(label, badge);
  item.appendChild(head);

  if (hideValueBody) {
    return item;
  }

  const body = document.createElement('div');
  body.className = 'history-body';
  if (value === null || value === undefined) {
    body.textContent = 'Entitlement is not present in this version.';
  } else {
    const pre = document.createElement('pre');
    pre.className = 'history-value';
    pre.innerHTML = highlightPlist(plistFragment(value));
    body.appendChild(pre);
  }
  item.appendChild(body);

  return item;
}

function createCollapsedStatusItem(entries, status) {
  const item = document.createElement('li');
  item.className = 'result-item history-collapsed';

  const details = document.createElement('details');
  details.className = 'history-collapsed-details';

  const summary = document.createElement('summary');
  summary.className = 'history-collapsed-summary';

  const first = entries[0];
  const last = entries[entries.length - 1];

  const range = document.createElement('span');
  range.className = 'history-version history-collapsed-range';
  range.textContent = `${last.versionLabel} → ${first.versionLabel}`;

  const badge = document.createElement('span');
  badge.className = `history-badge history-${status}`;
  badge.textContent = status.toUpperCase();

  summary.append(range, badge);

  const list = document.createElement('ul');
  list.className = 'history-collapsed-list';
  for (const entry of entries) {
    const row = document.createElement('li');
    row.className = 'history-collapsed-entry';
    row.textContent = entry.versionLabel;
    list.appendChild(row);
  }

  details.append(summary, list);
  item.appendChild(details);
  return item;
}

function renderHistoryPairTimeline({ titleEl, summaryEl, listEl, versions, path, key, record }) {
  titleEl.textContent = `${path} · ${key}`;

  if (!record) {
    renderNoData(summaryEl, listEl, 'No value timeline found for this path/key pair.');
    return;
  }

  summaryEl.textContent = '';
  summaryEl.hidden = true;
  listEl.innerHTML = '';

  const historyMap = new Map();
  for (const item of record.history ?? []) {
    historyMap.set(item.version_id, item);
  }

  const chronologicalVersions = [...versions].reverse();
  const timelineEntries = [];

  let previous = null;
  for (const version of chronologicalVersions) {
    const current = historyMap.get(version.version_id) ?? null;
    const status = statusForHistory(current, previous);
    timelineEntries.push({
      versionLabel: historyVersionLabel(version),
      status,
      value: current?.value ?? null,
    });
    previous = current;
  }

  const displayEntries = [...timelineEntries].reverse();

  let index = 0;
  while (index < displayEntries.length) {
    const entry = displayEntries[index];
    if (entry.status !== 'unchanged' && entry.status !== 'missing') {
      const timelineItem = createHistoryTimelineItem(entry.versionLabel, entry.status, entry.value);
      listEl.appendChild(timelineItem);
      index += 1;
      continue;
    }

    let end = index;
    while (end + 1 < displayEntries.length && displayEntries[end + 1].status === entry.status) {
      end += 1;
    }

    const run = displayEntries.slice(index, end + 1);
    if (run.length >= 2) {
      listEl.appendChild(createCollapsedStatusItem(run, entry.status));
    } else {
      const timelineItem = createHistoryTimelineItem(entry.versionLabel, entry.status, entry.value, {
        hideValueBody: entry.status === 'unchanged',
      });
      listEl.appendChild(timelineItem);
    }

    index = end + 1;
  }

  syncResultsVisibility(listEl);
}

async function initSearchPage({ indexFile, linkBuilder, summaryPrefix, historyHrefBuilder }) {
  const form = document.getElementById('search-form');
  const input = document.getElementById('query');
  const summary = document.getElementById('summary');
  const results = document.getElementById('results');

  renderLoading(summary, results);

  input.setAttribute('spellcheck', 'false');

  const runSearch = (query) => {
    hintController?.dismissHints();
    const normalizedQuery = query.trim();
    setQueryParam('q', normalizedQuery);
    render(normalizedQuery);
  };

  const { byName, versionLabelById, versionRankById } = await loadCoreData(indexFile);
  const allNames = [...byName.keys()].sort();
  const hintController = attachRealtimeHints(input, allNames, runSearch);

  const initial = queryParam('q');
  if (initial) {
    input.value = initial;
    render(initial);
  } else {
    renderNoData(summary, results, 'Enter a query to search.');
  }

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    runSearch(input.value);
  });

  input.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' || event.isComposing) {
      return;
    }
    event.preventDefault();
    runSearch(input.value);
  });

  function render(rawQuery) {
    const query = normalizeForFilter(rawQuery);
    const matchedAll = filterNames(allNames, query);
    const matched = matchedAll.slice(0, 300);

    if (!query) {
      renderNoData(summary, results, 'Enter a query to search.');
      return;
    }

    if (matched.length === 0) {
      renderNoData(summary, results, 'No results found.');
      return;
    }

    const resultCountLabel = matchedAll.length > 300 ? '300+' : String(matchedAll.length);
    summary.textContent = `${summaryPrefix}: ${resultCountLabel} result(s)`;
    results.innerHTML = '';

    for (const name of matched) {
      const entries = byName.get(name) ?? [];
      const distinctVersionIds = new Set();
      for (const entry of entries) {
        for (const versionId of entry.version_ids) {
          distinctVersionIds.add(versionId);
        }
      }

      const versionLabels = toVersionLabels([...distinctVersionIds], versionLabelById, versionRankById);
      const historyHref = historyHrefBuilder ? historyHrefBuilder(name) : '';
      const item = createResultItem(linkBuilder(name), name, versionLabels, historyHref);
      results.appendChild(item);
    }

    syncResultsVisibility(results);
  }
}

function renderDetail({
  titleEl,
  summaryEl,
  listEl,
  targetName,
  entries,
  versionLabelById,
  versionRankById,
  itemHrefBuilder,
  historyHrefBuilder,
  extraElementBuilder,
}) {
  const rowVersionControllers = [];

  titleEl.textContent = targetName;

  if (!entries || entries.length === 0) {
    summaryEl.textContent = 'No records found.';
    listEl.innerHTML = '';
    syncResultsVisibility(listEl);
    return rowVersionControllers;
  }

  summaryEl.textContent = `${entries.length} linked item(s)`;
  listEl.innerHTML = '';

  for (const entry of entries) {
    const versionLabels = toVersionLabels(entry.version_ids, versionLabelById, versionRankById);
    if (extraElementBuilder && versionLabels.length > 0) {
      versionLabels[0].isPrimaryMarker = true;
    }
    const historyHref = historyHrefBuilder ? historyHrefBuilder(entry.name, targetName) : '';
    let extraElement = null;
    let itemOptions = {};
    const extraRender = extraElementBuilder ? extraElementBuilder(entry, versionLabels) : null;

    if (extraRender && typeof extraRender === 'object' && 'element' in extraRender) {
      extraElement = extraRender.element ?? null;
      itemOptions = extraRender.itemOptions ?? {};
    } else {
      extraElement = extraRender;
    }

    const item = createResultItem(
      itemHrefBuilder(entry.name),
      entry.name,
      versionLabels,
      historyHref,
      extraElement,
      itemOptions,
    );

    if (typeof item.applyVersionSelection === 'function') {
      rowVersionControllers.push(item.applyVersionSelection);
    }

    listEl.appendChild(item);
  }

  syncResultsVisibility(listEl);
  return rowVersionControllers;
}

async function initDetailPage({ indexFile, queryKey, itemHrefBuilder, historyHrefBuilder }) {
  const title = document.getElementById('title');
  const summary = document.getElementById('summary');
  const results = document.getElementById('results');

  const targetName = queryParam(queryKey).trim();
  if (!targetName) {
    renderNoData(summary, results, `Missing query parameter: ${queryKey}`);
    return;
  }

  const pagePrefix = queryKey === 'key' ? 'Entitlement Key' : 'Mach-O Path';
  document.title = `${pagePrefix}: ${targetName}`;
  title.textContent = targetName;

  renderLoading(summary, results);

  const { byName, versionLabelById, versionRankById } = await loadCoreData(indexFile);
  const entries = byName.get(targetName) ?? [];

  renderDetail({
    titleEl: title,
    summaryEl: summary,
    listEl: results,
    targetName,
    entries,
    versionLabelById,
    versionRankById,
    itemHrefBuilder,
    historyHrefBuilder,
  });
}

export async function initHistoryPage() {
  initThemeToggle();
  refreshVersionLinks();

  const title = document.getElementById('title');
  const summary = document.getElementById('summary');
  const results = document.getElementById('results');
  const nav = document.getElementById('history-nav');

  const path = queryParam('path').trim();
  const key = queryParam('key').trim();

  if (!path || !key) {
    renderNoData(summary, results, 'Missing query parameters: path and key are required.');
    return;
  }

  title.textContent = `${path} · ${key}`;
  renderLoading(summary, results);

  if (nav) {
    nav.innerHTML = '';

    const home = document.createElement('a');
    home.href = withVersionParam('./index.html');
    home.textContent = '← Home';

    const sep1 = document.createElement('span');
    sep1.className = 'sep';
    sep1.textContent = '·';

    const keyDetail = document.createElement('a');
    keyDetail.href = withVersionParam(`./key.html?key=${encodeURIComponent(key)}`);
    keyDetail.textContent = 'Back to Key Detail';

    const sep2 = document.createElement('span');
    sep2.className = 'sep';
    sep2.textContent = '·';

    const pathDetail = document.createElement('a');
    pathDetail.href = withVersionParam(`./path.html?path=${encodeURIComponent(path)}`);
    pathDetail.textContent = 'Back to Path Detail';

    nav.append(home, sep1, keyDetail, sep2, pathDetail);
  }

  document.title = `Value History: ${path} · ${key}`;

  const versions = await loadVersions();

  const record = await loadPairRecord(path, key);
  renderHistoryPairTimeline({
    titleEl: title,
    summaryEl: summary,
    listEl: results,
    versions,
    path,
    key,
    record,
  });
}

export function initHomePage() {
  initThemeToggle();
  refreshVersionLinks();

  const status = document.getElementById('home-summary-status');
  const list = document.getElementById('home-summary-list');
  if (!status || !list) {
    return;
  }

  (async () => {
    const [metadata, versions] = await Promise.all([
      fetchJson('metadata.json'),
      fetchJson('versions.json'),
    ]);

    const newest = versions[0] ?? null;
    const oldest = versions[versions.length - 1] ?? null;
    const rangeLabel = newest && oldest
      ? `${oldest.ios_version} (${oldest.build}) → ${newest.ios_version} (${newest.build})`
      : 'unknown';

    const rows = [
      ['Total Versions', formatCount(Number(metadata.total_versions ?? versions.length))],
      ['Total Entitlement Keys', formatCount(Number(metadata.total_keys))],
      ['Total Mach-O Paths', formatCount(Number(metadata.total_paths))],
      ['Version Range', rangeLabel],
      ['Generated At (UTC)', formatGeneratedAt(metadata.generated_at_utc)],
    ];

    list.innerHTML = '';
    for (const [label, value] of rows) {
      const item = document.createElement('li');
      item.textContent = `${label}: ${value}`;
      list.appendChild(item);
    }

    status.hidden = true;
    list.hidden = false;
  })().catch((error) => {
    status.hidden = false;
    status.textContent = `Failed to load dataset summary: ${String(error)}`;
    list.hidden = true;
  });
}

export function initSearchByKeyPage() {
  initThemeToggle();
  refreshVersionLinks();

  initSearchPage({
    indexFile: 'index_by_key.json',
    linkBuilder: (key) => `./key.html?key=${encodeURIComponent(key)}`,
    summaryPrefix: 'Matched entitlement keys',
  }).catch((error) => {
    const summary = document.getElementById('summary');
    summary.textContent = String(error);
  });
}

export function initSearchByPathPage() {
  initThemeToggle();
  refreshVersionLinks();

  initSearchPage({
    indexFile: 'index_by_path.json',
    linkBuilder: (path) => `./path.html?path=${encodeURIComponent(path)}`,
    summaryPrefix: 'Matched Mach-O paths',
  }).catch((error) => {
    const summary = document.getElementById('summary');
    summary.textContent = String(error);
  });
}

export function initKeyDetailPage() {
  initThemeToggle();
  refreshVersionLinks();

  (async () => {
    const title = document.getElementById('title');
    const summary = document.getElementById('summary');
    const results = document.getElementById('results');

    const targetKey = queryParam('key').trim();
    const requestedVersionId = queryParam('version').trim();
    if (!targetKey) {
      renderNoData(summary, results, 'Missing query parameter: key');
      return;
    }

    title.textContent = targetKey;
    renderLoading(summary, results);

    document.title = `Entitlement Key: ${targetKey}`;

    const [versions, keyRecord] = await Promise.all([
      loadVersions(),
      loadKeyDetailRecord(targetKey),
    ]);

    const versionLabelById = new Map();
    const versionRankById = new Map();
    for (const version of versions) {
      versionRankById.set(version.version_id, versionRankById.size);
      versionLabelById.set(version.version_id, {
        iosVersion: version.ios_version,
        build: version.build,
      });
    }

    const defaultVersionId = requestedVersionId || versions[0]?.version_id || '';

    const entries = (keyRecord?.entries ?? []).map((entry) => ({
      name: entry.path,
      pair_id: entry.pair_id,
      version_ids: entry.version_ids ?? [],
      values_by_version: entry.values_by_version ?? {},
    }));

    let rowVersionControllers = [];
    const syncPageVersion = (versionId, anchorEl = null) => {
      if (!versionId) {
        return;
      }

      runWithStableViewport(() => {
        for (const applyVersionSelection of rowVersionControllers) {
          applyVersionSelection(versionId);
        }
        setQueryParam('version', versionId);
        refreshVersionLinks(versionId);
      }, anchorEl);
    };

    rowVersionControllers = renderDetail({
      titleEl: title,
      summaryEl: summary,
      listEl: results,
      targetName: targetKey,
      entries,
      versionLabelById,
      versionRankById,
      itemHrefBuilder: (path) => `./path.html?path=${encodeURIComponent(path)}`,
      historyHrefBuilder: (path, currentKey) => buildHistoryUrl({ path, key: currentKey }),
      extraElementBuilder: (entry) => {
        const latestVersionId = entry.version_ids?.[0] ?? '';
        if (!latestVersionId) {
          return null;
        }

        const initialVersionId = defaultVersionId || latestVersionId;
        const valueController = createVersionSwitchableValueElement(
          entry.values_by_version,
          initialVersionId,
        );

        return {
          element: valueController.element,
          itemOptions: {
            selectablePills: true,
            activeVersionId: initialVersionId,
            onVersionSelect: valueController.onVersionSelect,
            onVersionClick: syncPageVersion,
            shouldShowActiveMarker: (versionId) => Boolean(entry.values_by_version?.[versionId]),
          },
        };
      },
    });

    if (defaultVersionId) {
      syncPageVersion(defaultVersionId);
    }
    refreshVersionLinks(currentVersionParam());
  })().catch((error) => {
    const summary = document.getElementById('summary');
    summary.textContent = String(error);
  });
}

export function initPathDetailPage() {
  initThemeToggle();
  refreshVersionLinks();

  (async () => {
    const title = document.getElementById('title');
    const summary = document.getElementById('summary');
    const results = document.getElementById('results');
    const downloadButton = document.getElementById('download-plist');

    const targetPath = queryParam('path').trim();
    const requestedVersionId = queryParam('version').trim();
    if (!targetPath) {
      renderNoData(summary, results, 'Missing query parameter: path');
      if (downloadButton) {
        downloadButton.hidden = true;
        downloadButton.disabled = true;
      }
      return;
    }

    title.textContent = targetPath;
    renderLoading(summary, results);

    document.title = `Mach-O Path: ${targetPath}`;

    const [versions, pathRecord] = await Promise.all([
      loadVersions(),
      loadPathDetailRecord(targetPath),
    ]);

    const versionLabelById = new Map();
    const versionRankById = new Map();
    for (const version of versions) {
      versionRankById.set(version.version_id, versionRankById.size);
      versionLabelById.set(version.version_id, {
        iosVersion: version.ios_version,
        build: version.build,
      });
    }

    const defaultVersionId = requestedVersionId || versions[0]?.version_id || '';

    const entries = (pathRecord?.entries ?? []).map((entry) => ({
      name: entry.key,
      pair_id: entry.pair_id,
      version_ids: entry.version_ids ?? [],
      values_by_version: entry.values_by_version ?? {},
    }));

    const buildEntitlementsForVersion = (versionId) => {
      const entitlements = {};
      for (const entry of entries) {
        const payload = entry.values_by_version?.[versionId];
        if (!payload || !Object.prototype.hasOwnProperty.call(payload, 'value')) {
          continue;
        }
        entitlements[entry.name] = payload.value;
      }
      return entitlements;
    };

    if (downloadButton) {
      downloadButton.hidden = false;
      downloadButton.disabled = false;
      downloadButton.addEventListener('click', () => {
        const versionId = currentVersionParam() || defaultVersionId;
        const entitlements = buildEntitlementsForVersion(versionId);
        const plistText = buildRootPlistText(entitlements);
        triggerTextDownload(
          plistText,
          plistDownloadFilename(targetPath, versionId),
          'application/x-plist+xml;charset=utf-8',
        );
      });
    }

    let rowVersionControllers = [];
    const syncPageVersion = (versionId, anchorEl = null) => {
      if (!versionId) {
        return;
      }

      runWithStableViewport(() => {
        for (const applyVersionSelection of rowVersionControllers) {
          applyVersionSelection(versionId);
        }
        setQueryParam('version', versionId);
        refreshVersionLinks(versionId);
      }, anchorEl);
    };

    rowVersionControllers = renderDetail({
      titleEl: title,
      summaryEl: summary,
      listEl: results,
      targetName: targetPath,
      entries,
      versionLabelById,
      versionRankById,
      itemHrefBuilder: (key) => `./key.html?key=${encodeURIComponent(key)}`,
      historyHrefBuilder: (key, currentPath) => buildHistoryUrl({ path: currentPath, key }),
      extraElementBuilder: (entry) => {
        const latestVersionId = entry.version_ids?.[0] ?? '';
        if (!latestVersionId) {
          return null;
        }

        const initialVersionId = defaultVersionId || latestVersionId;
        const valueController = createVersionSwitchableValueElement(
          entry.values_by_version,
          initialVersionId,
        );

        return {
          element: valueController.element,
          itemOptions: {
            selectablePills: true,
            activeVersionId: initialVersionId,
            onVersionSelect: valueController.onVersionSelect,
            onVersionClick: syncPageVersion,
            shouldShowActiveMarker: (versionId) => Boolean(entry.values_by_version?.[versionId]),
          },
        };
      },
    });

    if (defaultVersionId) {
      syncPageVersion(defaultVersionId);
    }
    refreshVersionLinks(currentVersionParam());
  })().catch((error) => {
    const summary = document.getElementById('summary');
    const downloadButton = document.getElementById('download-plist');
    summary.textContent = String(error);
    if (downloadButton) {
      downloadButton.hidden = true;
      downloadButton.disabled = true;
    }
  });
}
