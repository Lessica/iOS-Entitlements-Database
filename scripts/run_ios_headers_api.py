#!/usr/bin/env python3
from __future__ import annotations

import argparse
from dataclasses import dataclass
import difflib
import json
from pathlib import Path
import re
import sqlite3
from typing import Any
from urllib.parse import parse_qs
from wsgiref.simple_server import make_server


ALLOWED_SYMBOL_TYPES = {
    "ivar",
    "property",
    "class_method",
    "instance_method",
}


@dataclass(frozen=True)
class AppConfig:
    db_path: Path
    headers_root: Path
    static_root: Path


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run iOS Headers API server.")
    parser.add_argument(
        "--db",
        type=Path,
        default=Path("sites/ios-headers/data/headers_index.sqlite"),
        help="SQLite index path",
    )
    parser.add_argument(
        "--headers-root",
        type=Path,
        default=Path("headers"),
        help="Headers root directory",
    )
    parser.add_argument(
        "--static-root",
        type=Path,
        default=Path("sites/ios-headers"),
        help="Static files root",
    )
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", default=8011, type=int)
    return parser.parse_args()


def json_response(start_response: Any, status: str, payload: Any) -> list[bytes]:
    body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    start_response(
        status,
        [
            ("Content-Type", "application/json; charset=utf-8"),
            ("Content-Length", str(len(body))),
            ("Cache-Control", "no-store"),
        ],
    )
    return [body]


def text_response(start_response: Any, status: str, text: str, content_type: str) -> list[bytes]:
    body = text.encode("utf-8")
    start_response(
        status,
        [
            ("Content-Type", content_type),
            ("Content-Length", str(len(body))),
        ],
    )
    return [body]


def to_disk_relative(absolute_path: str) -> Path:
    return Path(absolute_path.lstrip("/"))


def read_file_for_version(config: AppConfig, absolute_path: str, version_id: str, conn: sqlite3.Connection) -> tuple[str, str]:
    row = conn.execute(
        """
        SELECT v.bundle_name
        FROM files f
        JOIN paths p ON p.path_id = f.path_id
        JOIN versions v ON v.version_id = f.version_id
        WHERE p.absolute_path = ? AND f.version_id = ?
        LIMIT 1
        """,
        (absolute_path, version_id),
    ).fetchone()

    if row is None:
        raise FileNotFoundError(f"No file for {absolute_path} @ {version_id}")

    bundle_name = str(row[0])
    disk_path = config.headers_root / bundle_name / to_disk_relative(absolute_path)
    content = disk_path.read_text(encoding="utf-8", errors="replace")
    return bundle_name, content


def remove_leading_slash_comments(lines: list[str]) -> list[str]:
    index = 0
    while index < len(lines):
        stripped = lines[index].lstrip()
        if stripped.startswith("//") or stripped == "":
            index += 1
            continue
        break
    return lines[index:]


def extract_selector(signature_line: str) -> str | None:
    match = re.match(r"^[+-]\s*\([^)]*\)\s*(.*);\s*$", signature_line)
    if not match:
        return None

    tail = match.group(1)
    tokens = re.findall(r"([A-Za-z_][A-Za-z0-9_]*)\s*:", tail)
    if tokens:
        return "".join(f"{token}:" for token in tokens)

    head = re.match(r"([A-Za-z_][A-Za-z0-9_]*)", tail)
    return head.group(1) if head else None


def extract_property_name(line: str) -> str | None:
    match = re.match(r"^\s*@property\b.*\b([A-Za-z_][A-Za-z0-9_]*)\s*;\s*$", line)
    return match.group(1) if match else None


def extract_ivar_name(line: str) -> str | None:
    if ";" not in line:
        return None
    cleaned = line.rsplit(";", maxsplit=1)[0]
    match = re.search(r"([A-Za-z_][A-Za-z0-9_]*)\s*$", cleaned)
    return match.group(1) if match else None


def preprocess_header_for_diff(text: str) -> list[str]:
    source_lines = remove_leading_slash_comments(text.splitlines())

    ivars: list[tuple[str, str]] = []
    properties: list[tuple[str, str]] = []
    class_methods: list[tuple[str, str]] = []
    instance_methods: list[tuple[str, str]] = []

    in_ivar_block = False
    in_interface = False

    for line in source_lines:
        stripped = line.strip()
        if not stripped:
            continue

        if stripped.startswith("@interface"):
            in_interface = True
            in_ivar_block = "{" in stripped
            continue
        if stripped.startswith("@end"):
            in_interface = False
            in_ivar_block = False
            continue
        if in_interface and stripped == "{":
            in_ivar_block = True
            continue
        if in_interface and stripped == "}":
            in_ivar_block = False
            continue

        if in_ivar_block and not stripped.startswith("/*"):
            ivar_name = extract_ivar_name(stripped)
            if ivar_name:
                ivars.append((ivar_name, stripped))
            continue

        property_name = extract_property_name(stripped)
        if property_name:
            properties.append((property_name, stripped))
            continue

        if stripped.startswith("+") and stripped.endswith(";"):
            selector = extract_selector(stripped)
            if selector:
                class_methods.append((selector, stripped))
            continue

        if stripped.startswith("-") and stripped.endswith(";"):
            selector = extract_selector(stripped)
            if selector:
                instance_methods.append((selector, stripped))
            continue

    ivars.sort(key=lambda item: (item[0], item[1]))
    properties.sort(key=lambda item: (item[0], item[1]))
    class_methods.sort(key=lambda item: (item[0], item[1]))
    instance_methods.sort(key=lambda item: (item[0], item[1]))

    processed: list[str] = [
        "# IVARS",
        *[item[1] for item in ivars],
        "# PROPERTIES",
        *[item[1] for item in properties],
        "# CLASS_METHODS",
        *[item[1] for item in class_methods],
        "# INSTANCE_METHODS",
        *[item[1] for item in instance_methods],
    ]
    return processed


def search_paths(conn: sqlite3.Connection, query: str, limit: int) -> list[dict[str, Any]]:
    rows = conn.execute(
        """
        SELECT p.absolute_path,
               GROUP_CONCAT(DISTINCT f.version_id) AS versions,
               COUNT(DISTINCT f.version_id) AS version_count
        FROM paths p
        JOIN files f ON f.path_id = p.path_id
        WHERE p.absolute_path LIKE ?
        GROUP BY p.path_id
        ORDER BY version_count DESC, p.absolute_path ASC
        LIMIT ?
        """,
        (f"%{query}%", limit),
    ).fetchall()

    result = []
    for row in rows:
        versions = sorted(str(row[1]).split(",")) if row[1] else []
        result.append(
            {
                "absolute_path": str(row[0]),
                "version_ids": versions,
                "version_count": int(row[2]),
            }
        )
    return result


def path_detail(conn: sqlite3.Connection, absolute_path: str) -> dict[str, Any]:
    rows = conn.execute(
        """
        SELECT f.version_id, v.label
        FROM files f
        JOIN paths p ON p.path_id = f.path_id
        JOIN versions v ON v.version_id = f.version_id
        WHERE p.absolute_path = ?
        ORDER BY v.ios_version DESC, v.build DESC
        """,
        (absolute_path,),
    ).fetchall()

    if not rows:
        raise FileNotFoundError(f"Path not found: {absolute_path}")

    return {
        "absolute_path": absolute_path,
        "versions": [
            {
                "version_id": str(row[0]),
                "label": str(row[1]),
            }
            for row in rows
        ],
    }


def symbol_existence(
    conn: sqlite3.Connection,
    absolute_path: str,
    owner_name: str,
    symbol_type: str,
    symbol_key: str,
) -> dict[str, Any]:
    if symbol_type not in ALLOWED_SYMBOL_TYPES:
        raise ValueError(f"Invalid symbol_type: {symbol_type}")

    all_rows = conn.execute(
        """
        SELECT f.version_id, v.label
        FROM files f
        JOIN paths p ON p.path_id = f.path_id
        JOIN versions v ON v.version_id = f.version_id
        WHERE p.absolute_path = ?
        ORDER BY v.ios_version DESC, v.build DESC
        """,
        (absolute_path,),
    ).fetchall()

    hit_rows = conn.execute(
        """
        SELECT DISTINCT f.version_id, s.line_no
        FROM symbols s
        JOIN files f ON f.file_id = s.file_id
        JOIN paths p ON p.path_id = f.path_id
                WHERE p.absolute_path = ?
          AND s.owner_name = ?
          AND s.symbol_type = ?
          AND s.symbol_key = ?
        """,
                (absolute_path, owner_name, symbol_type, symbol_key),
    ).fetchall()

    hit_map = {
        str(row[0]): {"line_no": int(row[1])}
        for row in hit_rows
    }

    return {
        "absolute_path": absolute_path,
        "owner_name": owner_name,
        "symbol_type": symbol_type,
        "symbol_key": symbol_key,
        "versions": [
            {
                "version_id": str(row[0]),
                "label": str(row[1]),
                "exists": str(row[0]) in hit_map,
                "line_no": hit_map.get(str(row[0]), {}).get("line_no"),
            }
            for row in all_rows
        ],
    }


def path_diff(config: AppConfig, conn: sqlite3.Connection, absolute_path: str, base: str, target: str) -> dict[str, Any]:
    _, base_text = read_file_for_version(config, absolute_path, base, conn)
    _, target_text = read_file_for_version(config, absolute_path, target, conn)

    base_lines = preprocess_header_for_diff(base_text)
    target_lines = preprocess_header_for_diff(target_text)
    diff_lines = list(
        difflib.unified_diff(
            base_lines,
            target_lines,
            fromfile=f"{absolute_path}@{base}",
            tofile=f"{absolute_path}@{target}",
            lineterm="",
        )
    )

    return {
        "absolute_path": absolute_path,
        "base": base,
        "target": target,
        "preprocessed": True,
        "diff": diff_lines,
        "base_line_count": len(base_lines),
        "target_line_count": len(target_lines),
    }


def read_versions(conn: sqlite3.Connection) -> list[dict[str, str]]:
    rows = conn.execute(
        """
        SELECT version_id, ios_version, build, label, bundle_name
        FROM versions
        ORDER BY ios_version DESC, build DESC
        """
    ).fetchall()

    return [
        {
            "version_id": str(row[0]),
            "ios_version": str(row[1]),
            "build": str(row[2]),
            "label": str(row[3]),
            "bundle_name": str(row[4]),
        }
        for row in rows
    ]


def read_symbols_for_file(conn: sqlite3.Connection, absolute_path: str, version_id: str) -> list[dict[str, Any]]:
    rows = conn.execute(
        """
        SELECT s.owner_kind, s.owner_name, s.symbol_type, s.symbol_key, s.line_no
        FROM symbols s
        JOIN files f ON f.file_id = s.file_id
        JOIN paths p ON p.path_id = f.path_id
        WHERE p.absolute_path = ? AND f.version_id = ?
        ORDER BY s.owner_name, s.symbol_type, s.line_no
        """,
        (absolute_path, version_id),
    ).fetchall()

    return [
        {
            "owner_kind": str(row[0]),
            "owner_name": str(row[1]),
            "symbol_type": str(row[2]),
            "symbol_key": str(row[3]),
            "line_no": int(row[4]),
        }
        for row in rows
    ]


def read_metadata(config: AppConfig) -> dict[str, Any]:
    metadata_path = config.db_path.parent / "metadata.json"
    if not metadata_path.exists():
        return {}
    return json.loads(metadata_path.read_text(encoding="utf-8"))


def guess_mime(path: Path) -> str:
    if path.suffix == ".html":
        return "text/html; charset=utf-8"
    if path.suffix == ".js":
        return "text/javascript; charset=utf-8"
    if path.suffix == ".css":
        return "text/css; charset=utf-8"
    if path.suffix == ".json":
        return "application/json; charset=utf-8"
    return "application/octet-stream"


def create_app(config: AppConfig):
    def app(environ: dict[str, Any], start_response: Any) -> list[bytes]:
        path = environ.get("PATH_INFO", "")
        query = parse_qs(environ.get("QUERY_STRING", ""), keep_blank_values=False)

        conn = sqlite3.connect(config.db_path)
        conn.row_factory = sqlite3.Row

        try:
            if path == "/api/metadata":
                return json_response(start_response, "200 OK", read_metadata(config))

            if path == "/api/versions":
                return json_response(start_response, "200 OK", {"items": read_versions(conn)})

            if path == "/api/search/paths":
                q = str(query.get("q", [""])[0]).strip()
                if not q:
                    return json_response(start_response, "400 Bad Request", {"error": "Missing q"})
                limit_raw = str(query.get("limit", ["50"])[0])
                limit = max(1, min(200, int(limit_raw)))
                items = search_paths(conn, q, limit)
                return json_response(start_response, "200 OK", {"items": items, "query": q})

            if path == "/api/path":
                absolute_path = str(query.get("absolute_path", [""])[0]).strip()
                if not absolute_path:
                    return json_response(start_response, "400 Bad Request", {"error": "Missing absolute_path"})
                payload = path_detail(conn, absolute_path)
                return json_response(start_response, "200 OK", payload)

            if path == "/api/path/symbols":
                absolute_path = str(query.get("absolute_path", [""])[0]).strip()
                version_id = str(query.get("version_id", [""])[0]).strip()
                if not absolute_path or not version_id:
                    return json_response(
                        start_response,
                        "400 Bad Request",
                        {"error": "Missing absolute_path or version_id"},
                    )
                payload = {
                    "absolute_path": absolute_path,
                    "version_id": version_id,
                    "symbols": read_symbols_for_file(conn, absolute_path, version_id),
                }
                return json_response(start_response, "200 OK", payload)

            if path == "/api/diff":
                absolute_path = str(query.get("absolute_path", [""])[0]).strip()
                base = str(query.get("base", [""])[0]).strip()
                target = str(query.get("target", [""])[0]).strip()
                if not absolute_path or not base or not target:
                    return json_response(
                        start_response,
                        "400 Bad Request",
                        {"error": "Missing absolute_path/base/target"},
                    )
                payload = path_diff(config, conn, absolute_path, base, target)
                return json_response(start_response, "200 OK", payload)

            if path == "/api/symbol/existence":
                absolute_path = str(query.get("absolute_path", [""])[0]).strip()
                owner_name = str(query.get("owner_name", [""])[0]).strip()
                symbol_type = str(query.get("symbol_type", [""])[0]).strip()
                symbol_key = str(query.get("symbol_key", [""])[0]).strip()
                if not absolute_path or not owner_name or not symbol_type or not symbol_key:
                    return json_response(
                        start_response,
                        "400 Bad Request",
                        {
                            "error": (
                                "Missing one of absolute_path/owner_name/symbol_type/symbol_key"
                            )
                        },
                    )
                payload = symbol_existence(
                    conn=conn,
                    absolute_path=absolute_path,
                    owner_name=owner_name,
                    symbol_type=symbol_type,
                    symbol_key=symbol_key,
                )
                return json_response(start_response, "200 OK", payload)

            static_relative = "index.html" if path in {"", "/"} else path.lstrip("/")
            static_path = (config.static_root / static_relative).resolve()
            root_resolved = config.static_root.resolve()
            if not str(static_path).startswith(str(root_resolved)) or not static_path.exists():
                return json_response(start_response, "404 Not Found", {"error": "Not found"})

            text = static_path.read_text(encoding="utf-8")
            return text_response(start_response, "200 OK", text, guess_mime(static_path))
        except FileNotFoundError as exc:
            return json_response(start_response, "404 Not Found", {"error": str(exc)})
        except ValueError as exc:
            return json_response(start_response, "400 Bad Request", {"error": str(exc)})
        except Exception as exc:  # pragma: no cover - safe fallback
            return json_response(start_response, "500 Internal Server Error", {"error": str(exc)})
        finally:
            conn.close()

    return app


def main() -> None:
    args = parse_args()

    if not args.db.exists():
        raise SystemExit(f"SQLite index not found: {args.db}")
    if not args.static_root.exists() or not args.static_root.is_dir():
        raise SystemExit(f"Static root not found: {args.static_root}")

    config = AppConfig(
        db_path=args.db,
        headers_root=args.headers_root,
        static_root=args.static_root,
    )

    app = create_app(config)
    with make_server(args.host, args.port, app) as server:
        print(f"iOS Headers server running on http://{args.host}:{args.port}")
        server.serve_forever()


if __name__ == "__main__":
    main()
