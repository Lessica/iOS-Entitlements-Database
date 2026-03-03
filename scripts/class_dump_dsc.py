#!/usr/bin/env python3
from __future__ import annotations

import argparse
from pathlib import Path
import shlex
import subprocess
import sys

DEFAULT_CACHE_RELPATH = Path("System/Library/Caches/com.apple.dyld/dyld_shared_cache_arm64e")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Run `ipsw class-dump` for one or all firmware folders using dyld shared cache."
        )
    )
    parser.add_argument(
        "firmware_name",
        nargs="?",
        help=(
            "Firmware folder name under --firmwares-root "
            "(for example: 23C55__iPhone12,3_5)"
        ),
    )
    parser.add_argument(
        "--firmwares-root",
        type=Path,
        default=Path("files"),
        help="Root directory that contains firmware folders (default: files)",
    )
    parser.add_argument(
        "--output-root",
        type=Path,
        default=Path("headers"),
        help="Root directory for class-dump headers output (default: headers)",
    )
    parser.add_argument(
        "--cache-relpath",
        type=Path,
        default=DEFAULT_CACHE_RELPATH,
        help=(
            "Relative path of dyld shared cache inside each firmware "
            "(default: System/Library/Caches/com.apple.dyld/dyld_shared_cache_arm64e)"
        ),
    )
    parser.add_argument(
        "--all",
        action="store_true",
        help="Run class dump for all firmware folders under --firmwares-root",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Print commands without executing them",
    )
    parser.add_argument(
        "--continue-on-error",
        action="store_true",
        help="Continue processing remaining firmwares if a command fails",
    )
    args = parser.parse_args()

    if args.all and args.firmware_name is not None:
        parser.error("Do not provide firmware_name when using --all")

    if not args.all and args.firmware_name is None:
        parser.error("Either provide firmware_name or use --all")

    return args


def quote_command(parts: list[str]) -> str:
    return " ".join(shlex.quote(part) for part in parts)


def resolve_targets(args: argparse.Namespace) -> list[Path]:
    firmwares_root: Path = args.firmwares_root

    if not firmwares_root.exists() or not firmwares_root.is_dir():
        raise SystemExit(f"Invalid firmwares root: {firmwares_root}")

    if args.all:
        firmware_dirs = sorted(path for path in firmwares_root.iterdir() if path.is_dir())
        if not firmware_dirs:
            raise SystemExit(f"No firmware directories found under: {firmwares_root}")
        return firmware_dirs

    firmware_dir = firmwares_root / args.firmware_name
    if not firmware_dir.exists() or not firmware_dir.is_dir():
        raise SystemExit(f"Firmware directory not found: {firmware_dir}")
    return [firmware_dir]


def main() -> None:
    args = parse_args()

    output_root: Path = args.output_root
    cache_relpath: Path = args.cache_relpath

    firmware_dirs = resolve_targets(args)

    total = 0
    succeeded = 0
    skipped = 0
    failed = 0

    for firmware_dir in firmware_dirs:
        total += 1

        cache_path = firmware_dir / cache_relpath
        if not cache_path.is_file():
            skipped += 1
            print(f"[SKIP] Missing cache: {cache_path}", file=sys.stderr)
            continue

        out_dir = output_root / firmware_dir.name
        out_dir.mkdir(parents=True, exist_ok=True)

        command = [
            "ipsw",
            "class-dump",
            "--all",
            "--demangle",
            "--deps",
            "--headers",
            "--refs",
            "-o",
            str(out_dir),
            str(cache_path),
        ]

        print(f"[RUN ] {quote_command(command)}")
        if args.dry_run:
            succeeded += 1
            continue

        result = subprocess.run(command, check=False)
        if result.returncode == 0:
            succeeded += 1
        else:
            failed += 1
            print(
                f"[FAIL] Firmware {firmware_dir.name} exited with code {result.returncode}",
                file=sys.stderr,
            )
            if not args.continue_on_error:
                raise SystemExit(result.returncode)

    print(
        f"Done. total={total} succeeded={succeeded} skipped={skipped} failed={failed}",
        file=sys.stderr if failed else sys.stdout,
    )

    if failed:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
