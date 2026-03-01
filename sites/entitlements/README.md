# Entitlements Search Site

## Build data

Run the data builder from repository root:

```bash
/Users/82flex/Desktop/TweakDev/.venv/bin/python scripts/build_entitlements_site_data.py
```

By default, the builder prints problematic XML/plist file paths and exits with non-zero status.

If you want to keep building with valid files only:

```bash
/Users/82flex/Desktop/TweakDev/.venv/bin/python scripts/build_entitlements_site_data.py --continue-on-error
```

Generated files:

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

## Preview static site

```bash
cd sites/entitlements
python3 -m http.server 8000
```

Then open `http://127.0.0.1:8000`.

## Pages

- `index.html`: static home page
- `search-key.html`: search by entitlement key
- `search-path.html`: search by Mach-O path
- `key.html`: key detail page (links to path pages)
- `path.html`: path detail page (links to key pages)
- `history.html`: value-level history and version diff page
