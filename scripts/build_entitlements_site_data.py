#!/usr/bin/env python3
from __future__ import annotations

import argparse
from collections import defaultdict
from dataclasses import dataclass
from datetime import datetime, timezone
import json
from pathlib import Path
import plistlib
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
        default=Path("site/data"),
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


def extract_key_list(xml_file: Path) -> list[str]:
    data = read_plist(xml_file)

    key_list: list[str] = []
    for key in data.keys():
        if isinstance(key, str):
            key_list.append(key)
    return key_list


def normalize_path(path_without_ext: Path) -> str:
    return "/" + path_without_ext.as_posix().lstrip("/")


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


def main() -> None:
    args = parse_args()

    entitlements_root: Path = args.entitlements_root
    files_root: Path = args.files_root
    output_dir: Path = args.output_dir

    if not entitlements_root.exists() or not entitlements_root.is_dir():
        raise SystemExit(f"Invalid entitlements root: {entitlements_root}")

    key_index: dict[str, dict[str, set[str]]] = defaultdict(lambda: defaultdict(set))
    path_index: dict[str, dict[str, set[str]]] = defaultdict(lambda: defaultdict(set))
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
                key_list = extract_key_list(xml_file)
            except (OSError, plistlib.InvalidFileException, ExpatError, ValueError) as exc:
                issues.append(Issue(path=xml_file, reason=str(exc)))
                continue

            for key_name in key_list:
                key_index[key_name][binary_path].add(version.version_id)
                path_index[binary_path][key_name].add(version.version_id)

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

    (output_dir / "metadata.json").write_text(
        json.dumps(metadata, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    (output_dir / "versions.json").write_text(
        json.dumps(versions_json, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    (output_dir / "index_by_key.json").write_text(
        json.dumps(key_index_json, ensure_ascii=False), encoding="utf-8"
    )
    (output_dir / "index_by_path.json").write_text(
        json.dumps(path_index_json, ensure_ascii=False), encoding="utf-8"
    )

    print(f"Generated data into: {output_dir}")
    print(f"Versions: {len(sorted_versions)}")
    print(f"Entitlement keys: {len(key_index)}")
    print(f"Mach-O paths: {len(path_index)}")


if __name__ == "__main__":
    main()
