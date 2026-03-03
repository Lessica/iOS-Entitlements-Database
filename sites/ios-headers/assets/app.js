const state = {
  selectedPath: '',
  versions: [],
  loadedSymbols: [],
};

const $ = (id) => document.getElementById(id);

function versionOptions(select, versions) {
  select.innerHTML = '';
  for (const version of versions) {
    const option = document.createElement('option');
    option.value = version.version_id;
    option.textContent = version.label;
    select.appendChild(option);
  }
}

async function fetchJson(url) {
  const response = await fetch(url);
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || `HTTP ${response.status}`);
  }
  return data;
}

function renderPathResults(items) {
  const list = $('path-results');
  list.innerHTML = '';

  for (const item of items) {
    const li = document.createElement('li');
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'path-item';
    button.textContent = `${item.absolute_path} (${item.version_count} versions)`;
    button.addEventListener('click', () => selectPath(item.absolute_path));
    li.appendChild(button);
    list.appendChild(li);
  }
}

async function selectPath(relativePath) {
  state.selectedPath = relativePath;
  $('selected-path').textContent = `Selected path: ${relativePath}`;
  $('diff-output').textContent = '';
  $('symbol-output').textContent = '';

  const payload = await fetchJson(`/api/path?absolute_path=${encodeURIComponent(relativePath)}`);
  state.versions = payload.versions;

  versionOptions($('base-version'), payload.versions);
  versionOptions($('target-version'), payload.versions);
  versionOptions($('symbol-version'), payload.versions);
}

function getSelectedSymbol() {
  const raw = $('symbol-select').value;
  if (!raw) {
    return null;
  }
  return JSON.parse(raw);
}

async function loadSymbols() {
  if (!state.selectedPath) {
    throw new Error('Select a path first');
  }

  const versionId = $('symbol-version').value;
  if (!versionId) {
    throw new Error('Select a version first');
  }

  const payload = await fetchJson(
    `/api/path/symbols?absolute_path=${encodeURIComponent(state.selectedPath)}&version_id=${encodeURIComponent(versionId)}`,
  );

  state.loadedSymbols = payload.symbols;
  const select = $('symbol-select');
  select.innerHTML = '';

  for (const symbol of payload.symbols) {
    const option = document.createElement('option');
    option.value = JSON.stringify(symbol);
    option.textContent = `${symbol.symbol_type} :: ${symbol.owner_name} :: ${symbol.symbol_key}`;
    select.appendChild(option);
  }
}

async function runDiff() {
  if (!state.selectedPath) {
    throw new Error('Select a path first');
  }

  const base = $('base-version').value;
  const target = $('target-version').value;
  if (!base || !target) {
    throw new Error('Select base and target versions');
  }

  const payload = await fetchJson(
    `/api/diff?absolute_path=${encodeURIComponent(state.selectedPath)}&base=${encodeURIComponent(base)}&target=${encodeURIComponent(target)}`,
  );

  $('diff-output').textContent = payload.diff.join('\n');
}

async function checkSymbolExistence() {
  if (!state.selectedPath) {
    throw new Error('Select a path first');
  }

  const symbol = getSelectedSymbol();
  if (!symbol) {
    throw new Error('Load and select a symbol first');
  }

  const payload = await fetchJson(
    `/api/symbol/existence?absolute_path=${encodeURIComponent(state.selectedPath)}&owner_name=${encodeURIComponent(symbol.owner_name)}&symbol_type=${encodeURIComponent(symbol.symbol_type)}&symbol_key=${encodeURIComponent(symbol.symbol_key)}`,
  );

  const lines = payload.versions.map((version) => {
    const stateText = version.exists ? 'present' : 'absent';
    const details = version.exists ? ` @ line ${version.line_no}` : '';
    return `${version.label} => ${stateText}${details}`;
  });

  $('symbol-output').textContent = lines.join('\n');
}

function bindEvents() {
  $('path-search-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const query = $('path-query').value.trim();
    if (!query) {
      return;
    }

    try {
      const payload = await fetchJson(`/api/search/paths?q=${encodeURIComponent(query)}&limit=50`);
      renderPathResults(payload.items);
    } catch (error) {
      $('path-results').innerHTML = `<li>${error.message}</li>`;
    }
  });

  $('run-diff').addEventListener('click', async () => {
    try {
      await runDiff();
    } catch (error) {
      $('diff-output').textContent = error.message;
    }
  });

  $('load-symbols').addEventListener('click', async () => {
    try {
      await loadSymbols();
    } catch (error) {
      $('symbol-output').textContent = error.message;
    }
  });

  $('check-symbol').addEventListener('click', async () => {
    try {
      await checkSymbolExistence();
    } catch (error) {
      $('symbol-output').textContent = error.message;
    }
  });
}

bindEvents();
