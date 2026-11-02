#!/usr/bin/env python3
"""Extract discrete rosbag2 transitions into a flight-events-1 document.

Optional producer. npm test does not run this file and does not install rosbags.
rosbags is Apache-2.0 and is not vendored. --log is one .mcap or .db3 file,
because knolo flight ingest hashes one file. A directory is refused.

px4_msgs/msg/VehicleStatus and px4_msgs/msg/BatteryStatus reuse extract_ulog
field rules. Event time is the bag timestamp in microseconds, not a timestamp
inside the message. mavros_msgs/msg/State maps armed, inverts connected so a
lost link is the active flag, and tokenizes mode. A mode name is not a failsafe.
Every other message type is ignored, including IMU, image, and point cloud.
Those connections are not deserialized and their definitions are not loaded.

A bag with no allowlisted messages writes an empty event list and exits 0.
Byte offsets are 0. The log hash is the tamper bind. The battery threshold is
producer policy, not an airworthiness limit. This script does not emit a scan
sentence and does not decide that a flight was safe or compliant.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
from pathlib import Path

import extract_ulog

PINNED_VERSION = "0.11.9"
MAX_EVENTS = 10_000
PARSER_ID = "rosbags"
STATUS_TYPE = "px4_msgs/msg/VehicleStatus"
BATTERY_TYPE = "px4_msgs/msg/BatteryStatus"
MAVROS_TYPE = "mavros_msgs/msg/State"
ALLOWED_TYPES = frozenset({STATUS_TYPE, BATTERY_TYPE, MAVROS_TYPE})
_MISSING = object()


def main() -> int:
    parser = argparse.ArgumentParser(description="Write flight-events-1 JSON from one rosbag2 file.")
    parser.add_argument("--log", required=True)
    parser.add_argument("--out", required=True)
    args = parser.parse_args()
    path = Path(args.log)
    problem = bag_path_error(path)
    if problem:
        print(problem, file=sys.stderr)
        return 1
    try:
        from importlib.metadata import PackageNotFoundError, version

        found = version("rosbags")
    except (ImportError, PackageNotFoundError):
        print("FLIGHT_PARSER_MISSING: install scripts/flight/requirements.txt", file=sys.stderr)
        return 1
    if found != PINNED_VERSION:
        print(f"FLIGHT_PARSER_PIN: rosbags {found or 'unknown'} is not {PINNED_VERSION}", file=sys.stderr)
        return 1
    try:
        records = read_bag(path)
    except Exception as error:  # rosbags raises its own parse errors
        print(f"FLIGHT_LOG_PARSE: {error}", file=sys.stderr)
        return 1
    events = collect(records)
    return write_document(path, args.out, events)


def bag_path_error(path: Path) -> str | None:
    """Refuse a directory or any path that is not one .mcap or .db3 file."""
    if path.is_dir() or path.suffix.lower() not in {".mcap", ".db3"} or not path.is_file():
        return "FLIGHT_ROSBAG_FILE: --log must be one .mcap or .db3 file."
    return None


def allowlisted_connections(connections) -> list:
    """Keep the three supported message types. Everything else is never deserialized."""
    return [connection for connection in connections if getattr(connection, "msgtype", None) in ALLOWED_TYPES]


def read_bag(path: Path) -> list[dict]:
    """Open one .mcap or .db3 file and deserialize only the allowlisted connections."""
    from rosbags.rosbag2 import Reader

    records = []
    with Reader(path) as reader:
        chosen = allowlisted_connections(reader.connections)
        if not chosen:
            return records
        typestore = typestore_for(chosen)
        for connection, timestamp, raw in reader.messages(connections=chosen):
            message = typestore.deserialize_cdr(raw, connection.msgtype)
            records.append({
                "msgtype": connection.msgtype,
                "timestamp_ns": int(timestamp),
                "msg": message,
            })
    return records


def typestore_for(connections):
    """Register definitions for allowlisted connections only."""
    from rosbags.interfaces import MessageDefinitionFormat
    from rosbags.typesys import Stores, get_types_from_idl, get_types_from_msg, get_typestore

    typestore = get_typestore(Stores.EMPTY)
    merged = {}
    seen = set()
    for connection in connections:
        if connection.msgtype in seen:
            continue
        seen.add(connection.msgtype)
        merged.update(definition_map(
            connection,
            MessageDefinitionFormat,
            get_types_from_msg,
            get_types_from_idl,
        ))
    if merged:
        typestore.register(merged)
    checked = set()
    for connection in connections:
        digest = getattr(connection, "digest", "")
        if not digest or connection.msgtype in checked:
            continue
        checked.add(connection.msgtype)
        have = typestore.hash_rihs01(connection.msgtype)
        if have != digest:
            raise ValueError(f"message type {connection.msgtype} hash mismatch")
    return typestore


def definition_map(connection, message_format, get_types_from_msg, get_types_from_idl) -> dict:
    msgdef = connection.msgdef
    if msgdef.format == message_format.MSG:
        return get_types_from_msg(msgdef.data, connection.msgtype)
    if msgdef.format == message_format.IDL:
        found = {}
        separator = "=" * 80 + "\n"
        if msgdef.data.startswith(f"{separator}IDL: "):
            for part in msgdef.data.split(separator)[1:]:
                header, idl = part.split("\n", 1)
                if not header.startswith("IDL: "):
                    raise ValueError(f"message type {connection.msgtype} has a broken IDL definition")
                found.update(get_types_from_idl(idl))
        else:
            found.update(get_types_from_idl(msgdef.data))
        return found
    raise ValueError(f"message type {connection.msgtype} has no embedded definition")


def collect(records) -> list[dict]:
    """Select events from bag records. Records may carry fields or a message object."""
    status_rows = []
    battery_rows = []
    mavros_rows = []
    for record in records:
        msgtype = record.get("msgtype")
        timestamp = bag_us(record.get("timestamp_ns", 0))
        fields = record_fields(record)
        if msgtype == STATUS_TYPE:
            status_rows.append((timestamp, fields))
        elif msgtype == BATTERY_TYPE:
            battery_rows.append((timestamp, fields))
        elif msgtype == MAVROS_TYPE:
            mavros_rows.append((timestamp, fields))
    events = []
    if status_rows:
        events.extend(extract_ulog.collect(status_log(status_rows)))
    if battery_rows:
        events.extend(extract_ulog.collect(battery_log(battery_rows)))
    events.extend(mavros_events(mavros_rows))
    return events


def record_fields(record) -> dict:
    if isinstance(record.get("fields"), dict):
        return record["fields"]
    return message_mapping(record.get("msg"))


def message_mapping(message) -> dict:
    if message is None:
        return {}
    if isinstance(message, dict):
        return dict(message)
    if hasattr(message, "__dataclass_fields__"):
        return {name: getattr(message, name) for name in message.__dataclass_fields__}
    if hasattr(message, "_asdict"):
        return message._asdict()
    slots = getattr(message, "__slots__", None)
    if slots:
        return {name: getattr(message, name) for name in slots}
    return {}


def bag_us(timestamp_ns) -> int:
    try:
        value = int(timestamp_ns)
    except (TypeError, ValueError):
        return 0
    if value < 0:
        return 0
    return value // 1000


def status_log(rows):
    names = []
    seen = set()
    for _timestamp, fields in rows:
        for name in fields:
            if name not in seen:
                seen.add(name)
                names.append(name)
    changes = {name: value_changes(rows, name) for name in names}
    data = {name: [value for _timestamp, value in pairs] for name, pairs in changes.items()}
    return Log([Dataset("vehicle_status", changes, data)])


def battery_log(rows):
    stamps = []
    remaining = []
    for timestamp, fields in rows:
        if "remaining" not in fields:
            continue
        stamps.append(timestamp)
        remaining.append(fields["remaining"])
    return Log([Dataset("battery_status", {}, {"timestamp": stamps, "remaining": remaining})])


def value_changes(rows, field):
    found = []
    previous = _MISSING
    for timestamp, fields in rows:
        if field not in fields:
            continue
        value = fields[field]
        if previous is _MISSING or value != previous:
            found.append((timestamp, value))
            previous = value
    return found


def mavros_events(rows) -> list[dict]:
    events = []
    previous_armed = None
    previous_loss = None
    previous_mode = None
    for timestamp, fields in rows:
        if "armed" in fields:
            state = "armed" if bool(fields["armed"]) else "disarmed"
            if state != previous_armed:
                events.append(extract_ulog.make_event("arming", timestamp, {"state": state}))
                previous_armed = state
        if "connected" in fields:
            loss = 0 if bool(fields["connected"]) else 1
            if previous_loss is None:
                previous_loss = loss
                if loss != 0:
                    events.append(extract_ulog.make_event("link-loss", timestamp, {}))
            elif previous_loss == 0 and loss != 0:
                events.append(extract_ulog.make_event("link-loss", timestamp, {}))
                previous_loss = loss
            elif previous_loss != 0 and loss == 0:
                events.append(extract_ulog.make_event("link-restored", timestamp, {}))
                previous_loss = loss
            else:
                previous_loss = loss
        token = mode_token(fields.get("mode"))
        if token is not None and token != previous_mode:
            events.append(extract_ulog.make_event("nav-mode", timestamp, {"mode": token}))
            previous_mode = token
    return events


def mode_token(mode):
    if not isinstance(mode, str) or not any(char.isalnum() for char in mode):
        return None
    token = extract_ulog.token_of(mode)
    if not extract_ulog.token_ok(token):
        return None
    return token


class Dataset:
    def __init__(self, name: str, changes: dict, data: dict):
        self.name = name
        self._changes = changes
        self.data = data

    def list_value_changes(self, field: str):
        if field not in self._changes:
            raise KeyError(field)
        return self._changes[field]


class Log:
    def __init__(self, datasets: list):
        self.data_list = datasets


def write_document(log_path: Path, out_path: str, events: list[dict]) -> int:
    extract_ulog.assign_unique_ids(events)
    events.sort(key=lambda item: (item["timestampUs"], item["kind"], item["byteStart"], item["id"]))
    if len(events) > MAX_EVENTS:
        print(f"FLIGHT_TOO_MANY_EVENTS: event count {len(events)} exceeds {MAX_EVENTS}", file=sys.stderr)
        return 1
    raw = log_path.read_bytes()
    document = {
        "format": "flight-events-1",
        "parser": {"id": PARSER_ID, "version": PINNED_VERSION},
        "log": {
            "sha256": "sha256-" + hashlib.sha256(raw).hexdigest(),
            "byteLength": len(raw),
            "format": "rosbag2",
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
