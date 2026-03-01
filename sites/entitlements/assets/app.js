const DATA_BASE = './data';

async function fetchJson(name) {
  const response = await fetch(`${DATA_BASE}/${name}`);
  if (!response.ok) {
    throw new Error(`Failed to load ${name}: ${response.status}`);
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
  listEl.innerHTML = '';
  syncResultsVisibility(listEl);
}

function syncResultsVisibility(listEl) {
  listEl.hidden = listEl.childElementCount === 0;
}

function createResultItem(targetHref, title, versionLabels) {
  const item = document.createElement('li');
  item.className = 'result-item';

  const main = document.createElement('a');
  main.className = 'item-main';
  main.href = targetHref;
  main.textContent = title;

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

  item.append(main, versions);
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

async function initSearchPage({ indexFile, linkBuilder, summaryPrefix }) {
  const form = document.getElementById('search-form');
  const input = document.getElementById('query');
  const summary = document.getElementById('summary');
  const results = document.getElementById('results');

  const runSearch = (query) => {
    const normalizedQuery = query.trim();
    setQueryParam('q', normalizedQuery);
    render(normalizedQuery);
  };

  const { byName, versionLabelById } = await loadCoreData(indexFile);
  const allNames = [...byName.keys()].sort();
  attachRealtimeHints(input, allNames, runSearch);

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
      const item = createResultItem(linkBuilder(name), name, versionLabels);
      results.appendChild(item);
    }

    syncResultsVisibility(results);
  }
}

function renderDetail({ titleEl, summaryEl, listEl, targetName, entries, versionLabelById, itemHrefBuilder }) {
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
    const item = createResultItem(itemHrefBuilder(entry.name), entry.name, versionLabels);
    listEl.appendChild(item);
  }

  syncResultsVisibility(listEl);
}

async function initDetailPage({ indexFile, queryKey, itemHrefBuilder }) {
  const title = document.getElementById('title');
  const summary = document.getElementById('summary');
  const results = document.getElementById('results');

  const targetName = queryParam(queryKey).trim();
  if (!targetName) {
    renderNoData(summary, results, `Missing query parameter: ${queryKey}`);
    return;
  }

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
  }).catch((error) => {
    const summary = document.getElementById('summary');
    summary.textContent = String(error);
  });
}
