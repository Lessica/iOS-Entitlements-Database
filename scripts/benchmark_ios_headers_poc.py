#!/usr/bin/env python3
from __future__ import annotations

import argparse
from dataclasses import dataclass
from datetime import datetime, timezone
import json
from pathlib import Path
import sqlite3
import time
from typing import Any


@dataclass(frozen=True)
class QueryCase:
    name: str
    sql: str
    params: tuple[Any, ...]


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Benchmark key SQLite queries for iOS Headers PoC index."
    )
    parser.add_argument(
        "--db",
        type=Path,
        default=Path("sites/ios-headers/data/headers_index.sqlite"),
        help="SQLite index path",
    )
    parser.add_argument(
        "--out",
        type=Path,
        default=Path("sites/ios-headers/data/poc_benchmark.json"),
        help="Output JSON path",
    )
    parser.add_argument(
        "--iterations",
        type=int,
        default=20,
        help="Iterations per query case",
    )
    parser.add_argument(
        "--path-query",
        default="NFDriverWrapper.h",
        help="LIKE keyword for path search benchmark",
    )
    parser.add_argument(
        "--symbol-owner",
        default="NFDriverWrapper",
        help="Owner name used in symbol existence benchmark",
    )
    parser.add_argument(
        "--symbol-key",
        default="enableHeadlessMode:shutdown:",
        help="Symbol key used in symbol existence benchmark",
    )
    return parser.parse_args()


def now_utc() -> str:
    return datetime.now(timezone.utc).isoformat()


def timed_query(conn: sqlite3.Connection, case: QueryCase, iterations: int) -> dict[str, Any]:
    durations_ms: list[float] = []
    row_count = 0

    for _ in range(iterations):
        t0 = time.perf_counter()
        rows = conn.execute(case.sql, case.params).fetchall()
        elapsed_ms = (time.perf_counter() - t0) * 1000.0
        durations_ms.append(elapsed_ms)
        row_count = len(rows)

    durations_ms.sort()
    p50 = durations_ms[len(durations_ms) // 2]
    p95 = durations_ms[min(len(durations_ms) - 1, int(len(durations_ms) * 0.95))]

    return {
        "name": case.name,
        "iterations": iterations,
        "row_count": row_count,
        "min_ms": round(durations_ms[0], 3),
        "p50_ms": round(p50, 3),
        "p95_ms": round(p95, 3),
        "max_ms": round(durations_ms[-1], 3),
    }


def main() -> None:
    args = parse_args()
    if not args.db.exists():
        raise SystemExit(f"SQLite index not found: {args.db}")

    conn = sqlite3.connect(args.db)
    try:
        conn.row_factory = sqlite3.Row

        summary = {
            "generated_at_utc": now_utc(),
            "db_path": str(args.db),
            "db_size_bytes": args.db.stat().st_size,
            "versions": conn.execute("SELECT COUNT(*) FROM versions").fetchone()[0],
            "paths": conn.execute("SELECT COUNT(*) FROM paths").fetchone()[0],
            "files": conn.execute("SELECT COUNT(*) FROM files").fetchone()[0],
            "symbols": conn.execute("SELECT COUNT(*) FROM symbols").fetchone()[0],
        }

        shared_paths = conn.execute(
            """
            SELECT COUNT(*)
            FROM (
                SELECT p.path_id
                FROM paths p
                JOIN files f ON f.path_id = p.path_id
                GROUP BY p.path_id
                HAVING COUNT(DISTINCT f.version_id) > 1
            )
            """
        ).fetchone()[0]
        summary["shared_paths_multi_version"] = shared_paths

        one_shared = conn.execute(
            """
            SELECT p.absolute_path
            FROM paths p
            JOIN files f ON f.path_id = p.path_id
            GROUP BY p.path_id
            HAVING COUNT(DISTINCT f.version_id) > 1
            ORDER BY p.absolute_path
            LIMIT 1
            """
        ).fetchone()
        sample_path = str(one_shared[0]) if one_shared else ""

        cases = [
            QueryCase(
                name="path_search_like",
                sql=(
                    """
                    SELECT p.absolute_path
                    FROM paths p
                    WHERE p.absolute_path LIKE ?
                    ORDER BY p.absolute_path
                    LIMIT 50
                    """
                ),
                params=(f"%{args.path_query}%",),
            ),
            QueryCase(
                name="path_version_matrix",
                sql=(
                    """
                    SELECT f.version_id
                    FROM files f
                    JOIN paths p ON p.path_id = f.path_id
                    WHERE p.absolute_path = ?
                    """
                ),
                params=(sample_path,),
            ),
            QueryCase(
                name="symbol_existence",
                sql=(
                    """
                    SELECT DISTINCT f.version_id
                    FROM symbols s
                    JOIN files f ON f.file_id = s.file_id
                    WHERE s.owner_name = ?
                      AND s.symbol_type = 'instance_method'
                      AND s.symbol_key = ?
                    """
                ),
                params=(args.symbol_owner, args.symbol_key),
            ),
        ]

        benchmarks = [timed_query(conn, case, args.iterations) for case in cases]

        payload = {
            "summary": summary,
            "sample_path": sample_path,
            "benchmarks": benchmarks,
        }

        args.out.parent.mkdir(parents=True, exist_ok=True)
        args.out.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")

        print(json.dumps(payload, ensure_ascii=False, indent=2))
        print(f"Saved benchmark report to: {args.out}")
    finally:
        conn.close()


if __name__ == "__main__":
    main()
