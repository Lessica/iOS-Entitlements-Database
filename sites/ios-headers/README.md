# iOS Headers Site

## 1) Build SQLite index

Run from repository root:

```bash
/Users/82flex/Desktop/TweakDev/.venv/bin/python scripts/build_headers_site_data.py \
  --headers-root headers \
  --files-root files \
  --output-dir sites/ios-headers/data
```

Optional arguments:

- `--bundle <bundle_name>`: process selected bundle(s) only (repeatable)
- `--continue-on-error`: keep valid files when parsing issues occur

Generated outputs:

- `sites/ios-headers/data/headers_index.sqlite`
- `sites/ios-headers/data/metadata.json`

### Two-version PoC example

```bash
/Users/82flex/Desktop/TweakDev/.venv/bin/python scripts/build_headers_site_data.py \
  --bundle 23A341__iPhone12,3_5 \
  --bundle 23C55__iPhone12,3_5 \
  --output-dir sites/ios-headers/data \
  --full-rebuild
```

Optional smoke-test mode:

```bash
/Users/82flex/Desktop/TweakDev/.venv/bin/python scripts/build_headers_site_data.py \
  --bundle 23C55__iPhone12,3_5 \
  --max-files 500 \
  --output-dir sites/ios-headers/data \
  --full-rebuild
```

## 2) Start API + static site

```bash
/Users/82flex/Desktop/TweakDev/.venv/bin/python scripts/run_ios_headers_api.py \
  --db sites/ios-headers/data/headers_index.sqlite \
  --headers-root headers \
  --static-root sites/ios-headers \
  --host 127.0.0.1 \
  --port 8011
```

Open `http://127.0.0.1:8011`.

## 3) Run SQLite PoC benchmark

```bash
/Users/82flex/Desktop/TweakDev/.venv/bin/python scripts/benchmark_ios_headers_poc.py \
  --db sites/ios-headers/data/headers_index.sqlite \
  --out sites/ios-headers/data/poc_benchmark.json \
  --iterations 20
```

## 4) API endpoints

- `GET /api/metadata`
- `GET /api/versions`
- `GET /api/search/paths?q=<keyword>&limit=50`
- `GET /api/path?absolute_path=<path>`
- `GET /api/path/symbols?absolute_path=<path>&version_id=<version_id>`
- `GET /api/diff?absolute_path=<path>&base=<version_id>&target=<version_id>`
- `GET /api/symbol/existence?absolute_path=<path>&owner_name=<owner>&symbol_type=<type>&symbol_key=<key>`

Run Diff preprocessing rules:

- Remove leading `//` comments at the beginning of each header file.
- Collect and sort by semantic key before diff:
  - ivar: sort by ivar name
  - property: sort by property name
  - class method: sort by selector
  - instance method: sort by selector

Symbol type values:

- `ivar`
- `property`
- `class_method`
- `instance_method`
