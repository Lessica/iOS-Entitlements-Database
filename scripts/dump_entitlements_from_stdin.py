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


def _extract_plist_documents(raw_xml: bytes) -> list[bytes]:
    docs: list[bytes] = []
    search_from = 0
    plist_open = b"<plist"
    plist_close = b"</plist>"
    xml_open = b"<?xml"
    xml_close = b"?>"

    while True:
        plist_start = raw_xml.find(plist_open, search_from)
        if plist_start == -1:
            break

        plist_end = raw_xml.find(plist_close, plist_start)
        if plist_end == -1:
            break

        plist_end += len(plist_close)

        xml_start = raw_xml.rfind(xml_open, 0, plist_start)
        if xml_start != -1:
            xml_end = raw_xml.find(xml_close, xml_start)
            if xml_end != -1 and xml_end <= plist_start:
                doc_start = xml_start
            else:
                doc_start = plist_start
        else:
            doc_start = plist_start

        doc = raw_xml[doc_start:plist_end].strip()
        if doc:
            docs.append(doc)

        search_from = plist_end

    if docs:
        return docs

    normalized = raw_xml.strip()
    return [normalized] if normalized else []


def normalize_entitlements_xml(raw_xml: bytes) -> bytes:
    documents = _extract_plist_documents(raw_xml)
    if not documents:
        raise RuntimeError("ldid returned empty entitlements")

    unique_docs: list[bytes] = []
    seen: set[bytes] = set()
    for doc in documents:
        if doc in seen:
            continue
        seen.add(doc)
        unique_docs.append(doc)

    return unique_docs[0] + b"\n"


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

    return normalize_entitlements_xml(result.stdout)


def iter_input_paths() -> list[Path]:
    paths: list[Path] = []
    for raw in sys.stdin:
        line = raw.strip()
        if not line:
            continue
        if "/tmp/" in line:
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
