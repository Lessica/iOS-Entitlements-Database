const DATA_BASE = './data';
const V2_BASE = `${DATA_BASE}/v2`;

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
  const suffix = params.toString();
  return suffix ? `./history.html?${suffix}` : './history.html';
}

function createResultItem(targetHref, title, versionLabels, historyHref = '') {
  const item = document.createElement('li');
  item.className = 'result-item';

  const head = document.createElement('div');
  head.className = 'result-head';

  const main = document.createElement('a');
  main.className = 'item-main';
  main.href = targetHref;
  main.textContent = title;
  head.appendChild(main);

  if (historyHref) {
    const historyLink = document.createElement('a');
    historyLink.className = 'history-link';
    historyLink.href = historyHref;
    historyLink.title = 'View value history';
    historyLink.setAttribute('aria-label', 'View value history');
    historyLink.textContent = '🕘';
    head.appendChild(historyLink);
  }

  const versions = document.createElement('div');
  versions.className = 'version-list';
  for (const version of versionLabels) {
    const pill = document.createElement('span');
    pill.className = 'version-pill';
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
    versions.appendChild(pill);
  }

  item.append(head, versions);
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
  for (const version of versions) {
    versionLabelById.set(version.version_id, {
      iosVersion: version.ios_version,
      build: version.build,
    });
  }

  const byName = new Map();
  for (const row of index) {
    byName.set(row.name, row.entries);
  }

  return { versionLabelById, byName };
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
    const hints = findHintCandidates(nameEntries, keyword, 50);

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

function toVersionLabels(versionIds, versionLabelById) {
  const labels = [];
  for (const id of versionIds) {
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

function historyVersionLabel(version) {
  const iosVersion = version.ios_version ?? version.version_id;
  const build = version.build ?? '';
  return build ? `${iosVersion} (${build})` : String(iosVersion);
}

function createHistoryTimelineItem(versionLabel, status, value) {
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

  const body = document.createElement('div');
  body.className = 'history-body';
  if (value === null || value === undefined) {
    body.textContent = 'Entitlement is not present in this version.';
  } else {
    const pre = document.createElement('pre');
    pre.className = 'history-value';
    pre.textContent = plistFragment(value);
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
      const timelineItem = createHistoryTimelineItem(entry.versionLabel, entry.status, entry.value);
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

  input.setAttribute('spellcheck', 'false');

  const runSearch = (query) => {
    hintController?.dismissHints();
    const normalizedQuery = query.trim();
    setQueryParam('q', normalizedQuery);
    render(normalizedQuery);
  };

  const { byName, versionLabelById } = await loadCoreData(indexFile);
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

      const versionLabels = toVersionLabels([...distinctVersionIds], versionLabelById);
      const historyHref = historyHrefBuilder ? historyHrefBuilder(name) : '';
      const item = createResultItem(linkBuilder(name), name, versionLabels, historyHref);
      results.appendChild(item);
    }

    syncResultsVisibility(results);
  }
}

function renderDetail({ titleEl, summaryEl, listEl, targetName, entries, versionLabelById, itemHrefBuilder, historyHrefBuilder }) {
  titleEl.textContent = targetName;

  if (!entries || entries.length === 0) {
    summaryEl.textContent = 'No records found.';
    listEl.innerHTML = '';
    syncResultsVisibility(listEl);
    return;
  }

  summaryEl.textContent = `${entries.length} linked item(s)`;
  listEl.innerHTML = '';

  for (const entry of entries) {
    const versionLabels = toVersionLabels(entry.version_ids, versionLabelById);
    const historyHref = historyHrefBuilder ? historyHrefBuilder(entry.name, targetName) : '';
    const item = createResultItem(itemHrefBuilder(entry.name), entry.name, versionLabels, historyHref);
    listEl.appendChild(item);
  }

  syncResultsVisibility(listEl);
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

  const { byName, versionLabelById } = await loadCoreData(indexFile);
  const entries = byName.get(targetName) ?? [];

  renderDetail({
    titleEl: title,
    summaryEl: summary,
    listEl: results,
    targetName,
    entries,
    versionLabelById,
    itemHrefBuilder,
    historyHrefBuilder,
  });
}

export async function initHistoryPage() {
  const title = document.getElementById('title');
  const summary = document.getElementById('summary');
  const results = document.getElementById('results');
  const nav = document.getElementById('history-nav');

  const path = queryParam('path').trim();
  const key = queryParam('key').trim();
  summary.hidden = true;

  if (!path || !key) {
    renderNoData(summary, results, 'Missing query parameters: path and key are required.');
    return;
  }

  if (nav) {
    nav.innerHTML = '';

    const home = document.createElement('a');
    home.href = './index.html';
    home.textContent = '← Home';

    const sep1 = document.createElement('span');
    sep1.className = 'sep';
    sep1.textContent = '·';

    const keyDetail = document.createElement('a');
    keyDetail.href = `./key.html?key=${encodeURIComponent(key)}`;
    keyDetail.textContent = 'Back to Key Detail';

    const sep2 = document.createElement('span');
    sep2.className = 'sep';
    sep2.textContent = '·';

    const pathDetail = document.createElement('a');
    pathDetail.href = `./path.html?path=${encodeURIComponent(path)}`;
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

export function initSearchByKeyPage() {
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
  initDetailPage({
    indexFile: 'index_by_key.json',
    queryKey: 'key',
    itemHrefBuilder: (path) => `./path.html?path=${encodeURIComponent(path)}`,
    historyHrefBuilder: (path, currentKey) => buildHistoryUrl({ path, key: currentKey }),
  }).catch((error) => {
    const summary = document.getElementById('summary');
    summary.textContent = String(error);
  });
}

export function initPathDetailPage() {
  initDetailPage({
    indexFile: 'index_by_path.json',
    queryKey: 'path',
    itemHrefBuilder: (key) => `./key.html?key=${encodeURIComponent(key)}`,
    historyHrefBuilder: (key, currentPath) => buildHistoryUrl({ path: currentPath, key }),
  }).catch((error) => {
    const summary = document.getElementById('summary');
    summary.textContent = String(error);
  });
}
