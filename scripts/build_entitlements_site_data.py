#!/usr/bin/env python3
from __future__ import annotations

import argparse
from collections import defaultdict
from dataclasses import dataclass
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import plistlib
import shutil
import sys
from typing import Any
from xml.parsers.expat import ExpatError


@dataclass(frozen=True)
class VersionInfo:
    version_id: str
    ios_version: str
    build: str
    label: str


@dataclass(frozen=True)
class Issue:
    path: Path
    reason: str


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Build static JSON indexes for entitlement search website."
    )
    parser.add_argument(
        "--entitlements-root",
        type=Path,
        default=Path("entitlements"),
        help="Root directory that contains dumped entitlement XML files",
    )
    parser.add_argument(
        "--files-root",
        type=Path,
        default=Path("files"),
        help="Root directory that contains extracted firmware metadata",
    )
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=Path("sites/entitlements/data"),
        help="Output directory for generated JSON files",
    )
    parser.add_argument(
        "--continue-on-error",
        action="store_true",
        help="Print problematic file paths but continue building with valid files",
    )
    return parser.parse_args()


def read_plist(path: Path) -> dict[str, Any]:
    with path.open("rb") as file_obj:
        data = plistlib.load(file_obj)
    if not isinstance(data, dict):
        raise ValueError("Plist root is not a dictionary")
    return data


def try_read_plist(path: Path, issues: list[Issue]) -> dict[str, Any] | None:
    try:
        return read_plist(path)
    except (OSError, plistlib.InvalidFileException, ExpatError, ValueError) as exc:
        issues.append(Issue(path=path, reason=str(exc)))
        return None


def build_version_info(bundle_name: str, files_root: Path, issues: list[Issue]) -> VersionInfo:
    fallback_build = bundle_name.split("__", maxsplit=1)[0]
    fallback_version = "unknown"

    metadata_dir = files_root / bundle_name
    metadata = None

    system_version_plist = metadata_dir / "SystemVersion.plist"
    restore_plist = metadata_dir / "Restore.plist"

    if system_version_plist.exists():
        metadata = try_read_plist(system_version_plist, issues)
    if metadata is None and restore_plist.exists():
        metadata = try_read_plist(restore_plist, issues)

    ios_version = fallback_version
    build = fallback_build

    if metadata is not None:
        ios_version = str(metadata.get("ProductVersion", fallback_version))
        build = str(metadata.get("ProductBuildVersion", fallback_build))

    version_id = f"{ios_version}|{build}"
    label = f"iOS {ios_version} ({build})"
    return VersionInfo(version_id=version_id, ios_version=ios_version, build=build, label=label)


def parse_version_tuple(version: str) -> tuple[int, ...]:
    parts = []
    for token in version.split("."):
        if token.isdigit():
            parts.append(int(token))
        else:
            parts.append(-1)
    return tuple(parts)


def sort_versions(versions: dict[str, VersionInfo]) -> list[VersionInfo]:
    return sorted(
        versions.values(),
        key=lambda item: (parse_version_tuple(item.ios_version), item.build),
        reverse=True,
    )


def extract_entitlements(xml_file: Path) -> dict[str, Any]:
    data = read_plist(xml_file)
    entitlements: dict[str, Any] = {}
    for key, value in data.items():
        if isinstance(key, str):
            entitlements[key] = value
    return entitlements


def normalize_path(path_without_ext: Path) -> str:
    return "/" + path_without_ext.as_posix().lstrip("/")


def canonicalize_value(value: Any) -> Any:
    if isinstance(value, dict):
        normalized: dict[str, Any] = {}
        for key in sorted(value.keys(), key=str):
            normalized[str(key)] = canonicalize_value(value[key])
        return normalized

    if isinstance(value, list):
        return [canonicalize_value(item) for item in value]

    if isinstance(value, (str, int, float, bool)) or value is None:
        return value

    if isinstance(value, bytes):
        return value.hex()

    return str(value)


def canonical_string(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def shard_prefix(text: str) -> str:
    hash_value = 2166136261
    for byte in text.encode("utf-8"):
        hash_value ^= byte
        hash_value = (hash_value * 16777619) & 0xFFFFFFFF
    return f"{hash_value % 256:02x}"


def pair_id_for(path: str, key: str) -> str:
    raw = f"{path}\n{key}".encode("utf-8")
    return hashlib.sha256(raw).hexdigest()[:16]


def to_sorted_records(
    index_data: dict[str, dict[str, set[str]]],
    version_rank: dict[str, int],
) -> list[dict[str, Any]]:
    records: list[dict[str, Any]] = []

    for root_key in sorted(index_data.keys()):
        mapping = index_data[root_key]
        entries = []
        for sub_key in sorted(mapping.keys()):
            version_ids = sorted(mapping[sub_key], key=lambda item: version_rank[item])
            entries.append({"name": sub_key, "version_ids": version_ids})
        records.append({"name": root_key, "entries": entries})

    return records


def write_json(path: Path, data: Any, *, pretty: bool = False) -> None:
    if pretty:
        text = json.dumps(data, ensure_ascii=False, indent=2)
    else:
        text = json.dumps(data, ensure_ascii=False, separators=(",", ":"))
    path.write_text(text, encoding="utf-8")


def main() -> None:
    args = parse_args()

    entitlements_root: Path = args.entitlements_root
    files_root: Path = args.files_root
    output_dir: Path = args.output_dir

    if not entitlements_root.exists() or not entitlements_root.is_dir():
        raise SystemExit(f"Invalid entitlements root: {entitlements_root}")

    key_index: dict[str, dict[str, set[str]]] = defaultdict(lambda: defaultdict(set))
    path_index: dict[str, dict[str, set[str]]] = defaultdict(lambda: defaultdict(set))
    pair_histories: dict[tuple[str, str], dict[str, dict[str, Any]]] = defaultdict(dict)
    versions_by_id: dict[str, VersionInfo] = {}
    issues: list[Issue] = []

    bundle_dirs = sorted([item for item in entitlements_root.iterdir() if item.is_dir()])

    for bundle_dir in bundle_dirs:
        version = build_version_info(bundle_dir.name, files_root, issues)
        versions_by_id[version.version_id] = version

        xml_files = sorted(bundle_dir.rglob("*.xml"))
        for xml_file in xml_files:
            relative_xml = xml_file.relative_to(bundle_dir)
            binary_relative = relative_xml.with_suffix("")
            binary_path = normalize_path(binary_relative)

            try:
                entitlements = extract_entitlements(xml_file)
            except (OSError, plistlib.InvalidFileException, ExpatError, ValueError) as exc:
                issues.append(Issue(path=xml_file, reason=str(exc)))
                continue

            for key_name, raw_value in entitlements.items():
                key_index[key_name][binary_path].add(version.version_id)
                path_index[binary_path][key_name].add(version.version_id)

                normalized_value = canonicalize_value(raw_value)
                value_text = canonical_string(normalized_value)
                value_hash = hashlib.sha256(value_text.encode("utf-8")).hexdigest()[:16]
                pair_histories[(binary_path, key_name)][version.version_id] = {
                    "value_hash": value_hash,
                    "value": normalized_value,
                }

    if issues:
        for issue in issues:
            print(issue.path, file=sys.stderr)
        if not args.continue_on_error:
            raise SystemExit(
                "Found problematic plist/XML files. Use --continue-on-error to continue building."
            )

    sorted_versions = sort_versions(versions_by_id)
    version_rank = {version.version_id: idx for idx, version in enumerate(sorted_versions)}

    output_dir.mkdir(parents=True, exist_ok=True)

    metadata = {
        "generated_at_utc": datetime.now(timezone.utc).isoformat(),
        "total_versions": len(sorted_versions),
        "total_keys": len(key_index),
        "total_paths": len(path_index),
    }

    versions_json = [
        {
            "version_id": item.version_id,
            "ios_version": item.ios_version,
            "build": item.build,
            "label": item.label,
        }
        for item in sorted_versions
    ]

    key_index_json = to_sorted_records(key_index, version_rank)
    path_index_json = to_sorted_records(path_index, version_rank)

    write_json(output_dir / "metadata.json", metadata, pretty=True)
    write_json(output_dir / "versions.json", versions_json, pretty=True)
    write_json(output_dir / "index_by_key.json", key_index_json)
    write_json(output_dir / "index_by_path.json", path_index_json)

    v2_dir = output_dir / "v2"
    if v2_dir.exists():
        shutil.rmtree(v2_dir)

    key_index_dir = v2_dir / "key_index"
    path_index_dir = v2_dir / "path_index"
    buckets_dir = v2_dir / "buckets"
    key_index_dir.mkdir(parents=True, exist_ok=True)
    path_index_dir.mkdir(parents=True, exist_ok=True)
    buckets_dir.mkdir(parents=True, exist_ok=True)

    key_shards: dict[str, dict[str, list[dict[str, str]]]] = defaultdict(lambda: defaultdict(list))
    path_shards: dict[str, dict[str, list[dict[str, str]]]] = defaultdict(lambda: defaultdict(list))
    bucket_shards: dict[str, dict[str, dict[str, Any]]] = defaultdict(dict)

    pair_count = 0
    for path, key in sorted(pair_histories.keys()):
        history_by_version = pair_histories[(path, key)]
        pair_id = pair_id_for(path, key)
        pair_count += 1

        key_shards[shard_prefix(key)][key].append({"path": path, "pair_id": pair_id})
        path_shards[shard_prefix(path)][path].append({"key": key, "pair_id": pair_id})

        timeline = []
        for version_id in sorted(history_by_version.keys(), key=lambda item: version_rank[item]):
            payload = history_by_version[version_id]
            timeline.append(
                {
                    "version_id": version_id,
                    "value_hash": payload["value_hash"],
                    "value": payload["value"],
                }
            )

        bucket_shards[pair_id[:2]][pair_id] = {
            "path": path,
            "key": key,
            "history": timeline,
        }

    for prefix, payload in key_shards.items():
        normalized_items = {
            key: sorted(items, key=lambda entry: (entry["path"], entry["pair_id"]))
            for key, items in sorted(payload.items())
        }
        write_json(key_index_dir / f"{prefix}.json", {"items": normalized_items})

    for prefix, payload in path_shards.items():
        normalized_items = {
            path: sorted(items, key=lambda entry: (entry["key"], entry["pair_id"]))
            for path, items in sorted(payload.items())
        }
        write_json(path_index_dir / f"{prefix}.json", {"items": normalized_items})

    max_bucket_pairs = 0
    for prefix, pairs in bucket_shards.items():
        max_bucket_pairs = max(max_bucket_pairs, len(pairs))
        write_json(buckets_dir / f"{prefix}.json", {"pairs": pairs})

    v2_metadata = {
        "generated_at_utc": metadata["generated_at_utc"],
        "canon_version": "v1",
        "total_pairs": pair_count,
        "key_shard_files": len(key_shards),
        "path_shard_files": len(path_shards),
        "bucket_files": len(bucket_shards),
        "max_pairs_in_bucket": max_bucket_pairs,
    }
    write_json(v2_dir / "metadata.json", v2_metadata, pretty=True)

    print(f"Generated data into: {output_dir}")
    print(f"Versions: {len(sorted_versions)}")
    print(f"Entitlement keys: {len(key_index)}")
    print(f"Mach-O paths: {len(path_index)}")
    print(f"Value-diff pairs: {pair_count}")


if __name__ == "__main__":
    main()
