#!/usr/bin/env python3
from __future__ import annotations

import argparse
from pathlib import Path
import subprocess
import sys


def resolve_output_path(input_path: Path, input_root_name: str, output_root: Path) -> Path:
    parts = input_path.parts
    if input_root_name in parts:
        index = parts.index(input_root_name)
        if index + 1 >= len(parts):
            raise ValueError(f"Path is missing bundle segment after '{input_root_name}': {input_path}")
        relative_parts = parts[index + 1 :]
    else:
        relative_parts = parts

    relative_path = Path(*relative_parts)
    return (output_root / relative_path).with_name(relative_path.name + ".xml")


def dump_entitlements(binary_path: Path) -> bytes:
    result = subprocess.run(
        ["ldid", "-e", str(binary_path)],
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        check=False,
    )

    if result.returncode != 0:
        stderr_text = result.stderr.decode("utf-8", errors="replace").strip()
        raise RuntimeError(f"ldid failed ({result.returncode}): {stderr_text}")

    if not result.stdout.strip():
        raise RuntimeError("ldid returned empty entitlements")

    return result.stdout


def iter_input_paths() -> list[Path]:
    paths: list[Path] = []
    for raw in sys.stdin:
        line = raw.strip()
        if not line:
            continue
        paths.append(Path(line))
    return paths


def main() -> None:
    parser = argparse.ArgumentParser(
        description=(
            "Read Mach-O paths from stdin, run 'ldid -e' for each, and write entitlements XML "
            "to mirrored output paths."
        )
    )
    parser.add_argument(
        "--output-root",
        type=Path,
        default=Path("entitlements"),
        help="Directory used to store generated entitlement XML files",
    )
    parser.add_argument(
        "--input-root-name",
        default="files",
        help="Path segment to strip before mirroring into output root",
    )
    args = parser.parse_args()

    input_paths = iter_input_paths()
    if not input_paths:
        return

    for input_path in input_paths:
        try:
            xml_path = resolve_output_path(input_path, args.input_root_name, args.output_root)
            xml_path.parent.mkdir(parents=True, exist_ok=True)

            entitlements = dump_entitlements(input_path)
            xml_path.write_bytes(entitlements)
            print(xml_path)
        except Exception as exc:
            print(f"[WARN] Skip {input_path}: {exc}", file=sys.stderr)


if __name__ == "__main__":
    main()
