#!/usr/bin/env python3
"""Extract discrete PX4 ULog transitions into a flight-events-1 document.

Optional producer. npm test does not run this file and does not install pyulog.
Sentence text must match packages/cli/bin/flight.mjs. Byte offsets are 0 because
pyulog does not expose message offsets. The log hash is the tamper bind.
A battery event is emitted only when remaining charge crosses below 0.2.
That threshold is producer policy, not an airworthiness limit.
A scan sentence is not inferred. This script does not decide that a flight was
safe or compliant.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import sys

PINNED_VERSION = "1.2.4"
MAX_EVENTS = 10_000

ARMING_NAMES = {
    0: "init",
    1: "standby",
    2: "armed",
    3: "standby-error",
    4: "shutdown",
    5: "in-air-restore",
}

NAV_NAMES = {
    0: "manual",
    1: "altctl",
    2: "posctl",
    3: "auto-mission",
    4: "auto-loiter",
    5: "auto-rtl",
    14: "descend",
    17: "auto-takeoff",
    18: "auto-land",
}


def main() -> int:
    parser = argparse.ArgumentParser(description="Write flight-events-1 JSON from a PX4 ULog.")
    parser.add_argument("--log", required=True)
    parser.add_argument("--out", required=True)
    args = parser.parse_args()
    try:
        import pyulog
        from pyulog import ULog
    except ImportError:
        print("FLIGHT_PARSER_MISSING: install scripts/flight/requirements.txt", file=sys.stderr)
        return 1
    version = getattr(pyulog, "__version__", "")
    if version != PINNED_VERSION:
        print(f"FLIGHT_PARSER_PIN: pyulog {version or 'unknown'} is not {PINNED_VERSION}", file=sys.stderr)
        return 1
    try:
        ulog = ULog(args.log)
    except Exception as error:  # pyulog raises its own parse errors
        print(f"FLIGHT_LOG_PARSE: {error}", file=sys.stderr)
        return 1
    events = collect(ulog)
    seen = {}
    for event in events:
        base = event["id"]
        count = seen.get(base, 0)
        seen[base] = count + 1
        if count:
            event["id"] = f"{base}-{count}"[:64]
    events.sort(key=lambda item: (item["timestampUs"], item["kind"], item["byteStart"], item["id"]))
    if len(events) > MAX_EVENTS:
        print(f"FLIGHT_TOO_MANY_EVENTS: event count {len(events)} exceeds {MAX_EVENTS}", file=sys.stderr)
        return 1
    raw = open(args.log, "rb").read()
    document = {
        "format": "flight-events-1",
        "parser": {"id": "pyulog", "version": PINNED_VERSION},
        "log": {
            "sha256": "sha256-" + hashlib.sha256(raw).hexdigest(),
            "byteLength": len(raw),
            "format": "ulog",
        },
        "events": events,
    }
    with open(args.out, "w", encoding="utf-8") as handle:
        json.dump(document, handle, indent=2, sort_keys=True)
        handle.write("\n")
    print(f"events {len(events)}")
    return 0


def collect(ulog) -> list[dict]:
    events = []
    for dataset in datasets(ulog, "vehicle_status"):
        events.extend(changes(dataset, "arming_state", "arming", arming_text))
        events.extend(changes(dataset, "nav_state", "nav-mode", nav_text))
        for field in field_names(dataset):
            if "failsafe" not in field:
                continue
            events.extend(flag_changes(dataset, field))
    for dataset in datasets(ulog, "battery_status"):
        events.extend(battery_changes(dataset))
    for dataset in datasets(ulog, "telemetry_status"):
        for field in ("heartbeat_type", "type"):
            if field in field_names(dataset):
                events.extend(link_changes(dataset, field))
                break
    return events


def datasets(ulog, name: str) -> list:
    found = []
    for item in getattr(ulog, "data_list", []):
        if getattr(item, "name", None) == name:
            found.append(item)
    return found


def field_names(dataset) -> list[str]:
    data = getattr(dataset, "data", {})
    return [str(name) for name in data.keys()]


def changes(dataset, field: str, kind: str, render) -> list[dict]:
    if not hasattr(dataset, "list_value_changes") or field not in field_names(dataset):
        return []
    try:
        pairs = list(dataset.list_value_changes(field))
    except Exception:
        return []
    events = []
    for timestamp, value in pairs:
        if int(value) < 0:
            continue
        fields = render(int(value))
        if fields is None:
            continue
        events.append(make_event(kind, int(timestamp), fields))
    return events


def flag_changes(dataset, field: str) -> list[dict]:
    if not hasattr(dataset, "list_value_changes"):
        return []
    try:
        pairs = list(dataset.list_value_changes(field))
    except Exception:
        return []
    events = []
    previous = None
    token = token_of(field)
    for timestamp, value in pairs:
        current = int(value)
        if previous is None:
            previous = current
            if current != 0:
                events.append(make_event("failsafe-assert", int(timestamp), {"name": token}))
            continue
        if previous == 0 and current != 0:
            events.append(make_event("failsafe-assert", int(timestamp), {"name": token}))
        elif previous != 0 and current == 0:
            events.append(make_event("failsafe-clear", int(timestamp), {"name": token}))
        previous = current
    return events


def battery_changes(dataset) -> list[dict]:
    data = getattr(dataset, "data", {})
    stamps = data.get("timestamp")
    remaining = data.get("remaining")
    if stamps is None or remaining is None:
        return []
    events = []
    below = False
    for stamp, value in zip(stamps, remaining):
        try:
            level = float(value)
        except (TypeError, ValueError):
            continue
        now = level < 0.2
        if now and not below:
            events.append(make_event("battery-threshold", int(stamp), {"level": "low"}))
        below = now
    return events


def link_changes(dataset, field: str) -> list[dict]:
    data = getattr(dataset, "data", {})
    stamps = data.get("timestamp")
    values = data.get(field)
    if stamps is None or values is None:
        return []
    events = []
    lost = False
    for stamp, value in zip(stamps, values):
        now = int(value) == 0
        if now and not lost:
            events.append(make_event("link-loss", int(stamp), {}))
        elif lost and not now:
            events.append(make_event("link-restored", int(stamp), {}))
        lost = now
    return events


def arming_text(value: int):
    name = ARMING_NAMES.get(value)
    if name is None:
        return None
    return {"state": name}


def nav_text(value: int):
    name = NAV_NAMES.get(value, f"mode-{value}")
    if not token_ok(name):
        return None
    return {"mode": name}


def make_event(kind: str, timestamp: int, fields: dict) -> dict:
    if timestamp < 0:
        timestamp = 0
    event = {
        "id": event_id(kind, timestamp, fields),
        "kind": kind,
        "timestampUs": timestamp,
        "byteStart": 0,
        "byteEnd": 0,
        "fields": fields,
    }
    event["text"] = render_text(event)
    return event


def event_id(kind: str, timestamp: int, fields: dict) -> str:
    suffix = "-".join(fields.values()) if fields else "event"
    raw = f"{kind}-{timestamp}-{suffix}"
    cleaned = "".join(char if char.isalnum() or char in "._-" else "-" for char in raw)
    return cleaned[:64]


def render_text(event: dict) -> str:
    time = event["timestampUs"]
    fields = event["fields"]
    kind = event["kind"]
    if kind == "arming":
        return f"ARMING_STATE {fields['state']} at {time} us."
    if kind == "nav-mode":
        return f"NAV_STATE {fields['mode']} at {time} us."
    if kind == "failsafe-assert":
        return f"FAILSAFE {fields['name']} asserted at {time} us."
    if kind == "failsafe-clear":
        return f"FAILSAFE {fields['name']} cleared at {time} us."
    if kind == "battery-threshold":
        return f"battery threshold crossed at {time} us. level {fields['level']}."
    if kind == "link-loss":
        return f"link loss recorded at {time} us."
    if kind == "link-restored":
        return f"LINK_RESTORED at {time} us."
    raise ValueError(kind)


def token_of(field: str) -> str:
    cleaned = "".join(char if char.isalnum() or char in "._-" else "-" for char in field)
    cleaned = cleaned.strip("-._") or "failsafe"
    return cleaned[:64]


def token_ok(value: str) -> bool:
    if not value or len(value) > 64:
        return False
    return value[0].isalnum() and all(char.isalnum() or char in "._-" for char in value)


if __name__ == "__main__":
    sys.exit(main())
