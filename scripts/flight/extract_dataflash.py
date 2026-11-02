#!/usr/bin/env python3
"""Extract discrete ArduPilot DataFlash transitions into a flight-events-1 document.

Optional producer. npm test does not run this file and does not install pymavlink.
pymavlink is LGPLv3 and is not vendored. Sentence text comes from extract_ulog
so it matches packages/cli/bin/flight.mjs. Byte offsets are 0. The log hash is
the tamper bind.

ARM.ArmState emits on change, including the first sample. Non-zero is armed.
MODE emits mode-<Mode>, or mode-<ModeNum> when Mode is absent. The number is
not translated into a copter or plane name.

ERR failsafe subsystems, and only these, are failsafe edges. Non-zero ECode is
asserted. Zero is cleared. An opening zero emits nothing. Subsys 5 (radio) and
8 (gcs) are link edges only, not a second failsafe. Compass, flight-mode,
crash-check, GPS, and every other ERR are ignored. MSG text is ignored.

BAT instance 0 emits battery-threshold level low when RemPct crosses below 20.
That threshold is producer policy, not an airworthiness limit. This script does
not decide that a flight was safe or compliant. It does not emit a scan sentence.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import sys

import extract_ulog

PINNED_VERSION = "2.4.50"
MAX_EVENTS = 10_000
PARSER_ID = "pymavlink"

# ArduPilot error_subsystem values that mean an asserted failsafe.
# Names are the enum names in lowercase. Radio (5) and GCS (8) are not here.
FAILSAFE_NAMES = {
    6: "failsafe-batt",
    9: "failsafe-fence",
    17: "failsafe-ekfinav",
    20: "failsafe-adsb",
    23: "failsafe-terrain",
    26: "failsafe-sensors",
    27: "failsafe-leak",
    29: "failsafe-vibe",
    31: "failsafe-deadreckon",
}

# Radio and GCS failsafe-enum values are link state, not failsafe events.
LINK_SUBSYS = {5, 8}


def main() -> int:
    parser = argparse.ArgumentParser(description="Write flight-events-1 JSON from a DataFlash log.")
    parser.add_argument("--log", required=True)
    parser.add_argument("--out", required=True)
    args = parser.parse_args()
    try:
        import pymavlink
        from pymavlink import DFReader
    except ImportError:
        print("FLIGHT_PARSER_MISSING: install scripts/flight/requirements.txt", file=sys.stderr)
        return 1
    version = getattr(pymavlink, "__version__", "")
    if version != PINNED_VERSION:
        print(f"FLIGHT_PARSER_PIN: pymavlink {version or 'unknown'} is not {PINNED_VERSION}", file=sys.stderr)
        return 1
    try:
        reader = DFReader.DFReader_binary(args.log)
        messages = []
        while True:
            message = reader.recv_msg()
            if message is None:
                break
            messages.append(message)
    except Exception as error:  # DFReader raises its own parse errors
        print(f"FLIGHT_LOG_PARSE: {error}", file=sys.stderr)
        return 1
    events = collect(messages)
    return write_document(args.log, args.out, events)


def collect(messages) -> list[dict]:
    """Select events from DataFlash messages. pymavlink objects or plain dicts."""
    events = []
    previous_arm = None
    previous_mode = None
    err_active = {}
    battery_below = False
    for message in messages:
        kind, fields = as_record(message)
        timestamp = time_us(fields)
        if timestamp is None:
            continue
        if kind == "ARM":
            state = arm_name(fields.get("ArmState"))
            if state is None or state == previous_arm:
                continue
            events.append(extract_ulog.make_event("arming", timestamp, {"state": state}))
            previous_arm = state
        elif kind == "MODE":
            token = mode_token(fields)
            if token is None or token == previous_mode:
                continue
            events.append(extract_ulog.make_event("nav-mode", timestamp, {"mode": token}))
            previous_mode = token
        elif kind == "ERR":
            edge = err_edge(fields, err_active)
            if edge is None:
                continue
            rising, name = edge
            if name is None:
                kind_name = "link-loss" if rising else "link-restored"
                payload = {}
            else:
                kind_name = "failsafe-assert" if rising else "failsafe-clear"
                payload = {"name": name}
            events.append(extract_ulog.make_event(kind_name, timestamp, payload))
        elif kind == "BAT":
            level = remaining_pct(fields)
            if level is None:
                continue
            now = level < 20
            if now and not battery_below:
                events.append(extract_ulog.make_event("battery-threshold", timestamp, {"level": "low"}))
            battery_below = now
    return events


def as_record(message):
    if isinstance(message, dict):
        kind = message.get("type")
        fields = {key: value for key, value in message.items() if key != "type"}
        return kind, fields
    kind = message.get_type() if hasattr(message, "get_type") else None
    names = list(getattr(message, "_fieldnames", []) or [])
    fields = {}
    for name in names:
        try:
            fields[name] = getattr(message, name)
        except AttributeError:
            continue
    return kind, fields


def time_us(fields):
    if "TimeUS" not in fields:
        return None
    try:
        value = int(fields["TimeUS"])
    except (TypeError, ValueError):
        return None
    if value < 0:
        return 0
    return value


def arm_name(value):
    try:
        number = int(value)
    except (TypeError, ValueError):
        return None
    return "armed" if number != 0 else "disarmed"


def mode_token(fields):
    raw = fields.get("Mode")
    if raw is None:
        raw = fields.get("ModeNum")
    if raw is None:
        return None
    try:
        number = int(raw)
    except (TypeError, ValueError):
        return None
    if number < 0:
        return None
    token = f"mode-{number}"
    if not extract_ulog.token_ok(token):
        return None
    return token


def err_edge(fields, err_active):
    """Return (rising, failsafe name or None for a link) or None for no edge."""
    try:
        subsys = int(fields["Subsys"])
        code = int(fields["ECode"])
    except (KeyError, TypeError, ValueError):
        return None
    if subsys in FAILSAFE_NAMES:
        name = FAILSAFE_NAMES[subsys]
    elif subsys in LINK_SUBSYS:
        name = None
    else:
        return None
    active = code != 0
    previous = err_active.get(subsys)
    err_active[subsys] = active
    if previous is None:
        if not active:
            return None
        return True, name
    if not previous and active:
        return True, name
    if previous and not active:
        return False, name
    return None


def remaining_pct(fields):
    raw = fields.get("Inst", 0)
    try:
        if int(raw) != 0 or "RemPct" not in fields:
            return None
        return float(fields["RemPct"])
    except (TypeError, ValueError):
        return None


def write_document(log_path: str, out_path: str, events: list[dict]) -> int:
    extract_ulog.assign_unique_ids(events)
    events.sort(key=lambda item: (item["timestampUs"], item["kind"], item["byteStart"], item["id"]))
    if len(events) > MAX_EVENTS:
        print(f"FLIGHT_TOO_MANY_EVENTS: event count {len(events)} exceeds {MAX_EVENTS}", file=sys.stderr)
        return 1
    raw = open(log_path, "rb").read()
    document = {
        "format": "flight-events-1",
        "parser": {"id": PARSER_ID, "version": PINNED_VERSION},
        "log": {
            "sha256": "sha256-" + hashlib.sha256(raw).hexdigest(),
            "byteLength": len(raw),
            "format": "dataflash",
        },
        "events": events,
    }
    with open(out_path, "w", encoding="utf-8") as handle:
        json.dump(document, handle, indent=2, sort_keys=True)
        handle.write("\n")
    print(f"events {len(events)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
