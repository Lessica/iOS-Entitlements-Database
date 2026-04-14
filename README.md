# iOS Entitlements Database

Source repository for [entitlements.82flex.com](https://entitlements.82flex.com), a static website for browsing iOS entitlement keys, Mach-O paths, and value history across firmware builds.

The repository contains two main parts:

- Python utilities for extracting entitlement data from firmware artifacts and generating JSON indexes.
- A static frontend in `sites/entitlements` that consumes the generated data without any server-side runtime.

Large extracted artifacts and generated datasets are intentionally ignored from version control. You are expected to build them locally.

## What the Site Provides

- Search by entitlement key.
- Search by Mach-O path.
- Per-key and per-path detail pages.
- History pages for tracking value changes across iOS versions.
- Static JSON indexes that can be hosted on any static file server.

## Repository Layout

```text
.
├── scripts/
│   ├── build_entitlements_site_data.py
│   ├── class_dump_dsc.py
│   ├── dump_entitlements_from_stdin.py
│   ├── find_macho_executables.py
│   └── split_dyld_caches.py
└── sites/
    └── entitlements/
        ├── index.html
        ├── search-key.html
        ├── search-path.html
        ├── key.html
        ├── path.html
        ├── history.html
        └── assets/
```

Common local working directories that are created outside version control:

- `files/`: extracted firmware filesystem content and metadata.
- `entitlements/`: dumped entitlement plist/XML files mirrored from firmware paths.
- `caches/`: optional split dyld shared cache outputs.
- `headers/`: optional class-dump outputs.
- `sites/entitlements/data/`: generated JSON payloads consumed by the static site.

## Prerequisites

- Python 3.10 or newer.
- `ldid` for reading code-signing entitlements.
- `ipsw` for AppleDB lookups, dyld cache splitting, and optional class-dump workflows.
- Extracted iOS firmware contents available under `files/`.

On macOS, make sure `ldid` and `ipsw` are available in `PATH` before running the scripts.

## Typical Workflow

### 1. Prepare firmware contents

Place extracted firmware directories under `files/`. Each firmware folder is expected to contain the original filesystem layout and, when available, metadata such as `SystemVersion.plist`, `Restore.plist`, or `System/Library/CoreServices/SystemVersion.plist`.

The data builder uses these files to derive labels such as `iOS 18.4 (22E240)`.

### 2. Find Mach-O executables

```bash
python3 scripts/find_macho_executables.py files/<firmware-folder>
```

This prints executable paths that can be piped into the entitlement dumper.

### 3. Dump entitlement XML files

```bash
python3 scripts/find_macho_executables.py files/<firmware-folder> \
  | python3 scripts/dump_entitlements_from_stdin.py
```

The dumper runs `ldid -e` for each binary and writes normalized plist/XML output to `entitlements/`, preserving the firmware-relative path layout.

### 4. Build static site data

Run the data builder from the repository root:

```bash
python3 scripts/build_entitlements_site_data.py
```

If malformed plist/XML files are present, the builder prints the problematic paths and exits with a non-zero status.

To keep building with valid files only:

```bash
python3 scripts/build_entitlements_site_data.py --continue-on-error
```

Generated files include:

- `sites/entitlements/data/metadata.json`
- `sites/entitlements/data/versions.json`
- `sites/entitlements/data/index_by_key.json`
- `sites/entitlements/data/index_by_path.json`
- `sites/entitlements/data/v2/metadata.json`
- `sites/entitlements/data/v2/key_index/*.json`
- `sites/entitlements/data/v2/path_index/*.json`
- `sites/entitlements/data/v2/buckets/*.json`
- `sites/entitlements/data/v2/path_detail_shards/*.json`
- `sites/entitlements/data/v2/key_detail_shards/*.json`

### 5. Preview the static site locally

```bash
cd sites/entitlements
python3 -m http.server 8000
```

Then open `http://127.0.0.1:8000` in a browser.

## Script Reference

### `build_entitlements_site_data.py`

Builds the JSON indexes consumed by the frontend. It reads entitlement XML files from `entitlements/`, resolves firmware version metadata from `files/`, and writes compact lookup structures under `sites/entitlements/data/`.

### `find_macho_executables.py`

Recursively scans a directory and prints Mach-O executables, including supported fat binaries.

### `dump_entitlements_from_stdin.py`

Reads binary paths from standard input, runs `ldid -e`, normalizes plist output, and writes mirrored XML files under `entitlements/`.

### `split_dyld_caches.py`

Batch wrapper around `ipsw dyld split` for firmware folders under `files/`. This is useful when you want extracted dyld cache contents in a predictable directory layout.

### `class_dump_dsc.py`

Runs `ipsw class-dump` either for dyld shared caches or for executable paths provided on standard input. Output is written under `headers/`.

## Frontend Pages

- `index.html`: landing page and dataset summary.
- `search-key.html`: search by entitlement key.
- `search-path.html`: search by Mach-O path.
- `key.html`: key detail page linking to matching paths.
- `path.html`: path detail page linking to matching keys.
- `history.html`: per-path and per-key value history across versions.

The frontend is plain static HTML, CSS, and JavaScript. There is no bundler and no deployment-specific build step beyond generating the JSON data.

## Deployment Notes

- The site can be deployed to any static hosting provider.
- Only `sites/entitlements/` needs to be published.
- Rebuild `sites/entitlements/data/` whenever source entitlement dumps or firmware metadata change.

## Related Documentation

For a shorter site-specific note focused only on local data generation and preview, see `sites/entitlements/README.md`.