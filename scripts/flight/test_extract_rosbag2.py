#!/usr/bin/env python3
"""Allowlist checks for the optional rosbag2 extractor. rosbags is not required."""

from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

import extract_rosbag2
import extract_ulog


ROOT = Path(__file__).resolve().parents[2]
STATUS = "px4_msgs/msg/VehicleStatus"
BATTERY = "px4_msgs/msg/BatteryStatus"
MAVROS = "mavros_msgs/msg/State"


def record(msgtype, timestamp_ns, **fields):
    return {"msgtype": msgtype, "timestamp_ns": timestamp_ns, "fields": fields}


def pairs(events):
    return [(event["kind"], event["timestampUs"], event["fields"]) for event in events]


class UlogDataset:
    def __init__(self, name, changes):
        self.name = name
        self._changes = changes
        self.data = {field: [] for field in changes}

    def list_value_changes(self, field):
        if field not in self._changes:
            raise KeyError(field)
        return self._changes[field]


class UlogView:
    def __init__(self, datasets):
        self.data_list = datasets


class Conn:
    def __init__(self, msgtype):
        self.msgtype = msgtype


class RosbagTests(unittest.TestCase):
    def test_allowlist_drops_imu_and_custom_types_before_decode(self):
        chosen = extract_rosbag2.allowlisted_connections([
            Conn("sensor_msgs/msg/Imu"),
            Conn("sensor_msgs/msg/Image"),
            Conn(STATUS),
            Conn("my_robot/msg/Custom"),
            Conn(BATTERY),
            Conn(MAVROS),
        ])
        self.assertEqual([item.msgtype for item in chosen], [STATUS, BATTERY, MAVROS])

    def test_imu_and_empty_bag_emit_nothing(self):
        self.assertEqual(extract_rosbag2.collect([]), [])
        events = extract_rosbag2.collect([
            record("sensor_msgs/msg/Imu", 5_000_000, x=1),
            record("sensor_msgs/msg/Image", 6_000_000, data="x"),
            record("px4_msgs/msg/VehicleStatusExtra", 7_000_000, failsafe=1),
        ])
        self.assertEqual(events, [])

    def test_directory_and_foreign_suffix_are_refused(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            self.assertIn("FLIGHT_ROSBAG_FILE", extract_rosbag2.bag_path_error(root))
            foreign = root / "sample.txt"
            foreign.write_text("x", encoding="utf-8")
            self.assertIn("FLIGHT_ROSBAG_FILE", extract_rosbag2.bag_path_error(foreign))
            missing = root / "missing.mcap"
            self.assertIn("FLIGHT_ROSBAG_FILE", extract_rosbag2.bag_path_error(missing))

    def test_defer_state_and_internal_timestamp_are_not_events(self):
        events = extract_rosbag2.collect([
            record(STATUS, 1_000_000, failsafe=0, failsafe_defer_state=0, timestamp=999),
            record(STATUS, 2_000_000, failsafe=0, failsafe_defer_state=1, timestamp=1000),
        ])
        self.assertEqual(events, [])
        self.assertNotIn("failsafe_defer_state", json.dumps(events))

    def test_vehicle_status_matches_ulog_rules_at_bag_time(self):
        rows = [
            record(
                STATUS,
                10_000_000,
                arming_state=2,
                nav_state=1,
                failsafe=0,
                failsafe_defer_state=1,
                gcs_connection_lost=0,
                high_latency_data_link_lost=0,
                rc_signal_lost=0,
                timestamp=5,
            ),
            record(
                STATUS,
                20_000_000,
                arming_state=2,
                nav_state=4,
                failsafe=1,
                failsafe_defer_state=2,
                gcs_connection_lost=1,
                high_latency_data_link_lost=0,
                rc_signal_lost=1,
                timestamp=6,
            ),
            record(
                STATUS,
                30_000_000,
                arming_state=1,
                nav_state=4,
                failsafe=0,
                failsafe_defer_state=0,
                gcs_connection_lost=0,
                high_latency_data_link_lost=1,
                rc_signal_lost=1,
                timestamp=7,
            ),
        ]
        events = extract_rosbag2.collect(rows)
        direct = extract_ulog.collect(UlogView([
            UlogDataset("vehicle_status", {
                "arming_state": [(10000, 2), (30000, 1)],
                "nav_state": [(10000, 1), (20000, 4)],
                "failsafe": [(10000, 0), (20000, 1), (30000, 0)],
                "failsafe_defer_state": [(10000, 1), (20000, 2), (30000, 0)],
                "gcs_connection_lost": [(10000, 0), (20000, 1), (30000, 0)],
                "high_latency_data_link_lost": [(10000, 0), (30000, 1)],
                "rc_signal_lost": [(10000, 0), (20000, 1)],
                "timestamp": [(10000, 5), (20000, 6), (30000, 7)],
            }),
        ]))
        self.assertEqual(events, direct)
        self.assertNotIn(5, [event["timestampUs"] for event in events])
        self.assertNotIn("failsafe_defer_state", json.dumps(events))
        self.assertIn(("failsafe-assert", 20000, {"name": "failsafe"}), pairs(events))
        self.assertIn(("link-loss", 20000, {}), pairs(events))
        self.assertIn(("arming", 10000, {"state": "armed"}), pairs(events))
        self.assertEqual(events[0]["byteStart"], 0)
        self.assertEqual(events[0]["byteEnd"], 0)

    def test_battery_uses_bag_time_and_the_ulog_fraction(self):
        events = extract_rosbag2.collect([
            record("sensor_msgs/msg/Imu", 1_000_000, x=1),
            record(BATTERY, 2_000_000, remaining=0.5, timestamp=9),
            record(BATTERY, 3_000_000, remaining=0.2, timestamp=8),
            record(BATTERY, 4_000_000, remaining=0.19, timestamp=7),
            record(BATTERY, 5_000_000, remaining=0.1, timestamp=6),
        ])
        self.assertEqual(pairs(events), [
            ("battery-threshold", 4000, {"level": "low"}),
        ])
        self.assertEqual(events[0]["text"], "battery threshold crossed at 4000 us. level low.")

    def test_mavros_state_does_not_infer_failsafe_from_mode(self):
        events = extract_rosbag2.collect([
            record(MAVROS, 15_000_000, armed=True, connected=True, mode="OFFBOARD"),
            record(MAVROS, 16_000_000, armed=True, connected=False, mode="OFFBOARD"),
            record(MAVROS, 18_000_000, armed=False, connected=True, mode="Failsafe"),
            record("sensor_msgs/msg/Imu", 19_000_000, x=1),
        ])
        self.assertEqual(pairs(events), [
            ("arming", 15000, {"state": "armed"}),
            ("nav-mode", 15000, {"mode": "OFFBOARD"}),
            ("link-loss", 16000, {}),
            ("arming", 18000, {"state": "disarmed"}),
            ("link-restored", 18000, {}),
            ("nav-mode", 18000, {"mode": "Failsafe"}),
        ])
        self.assertNotIn("failsafe-assert", [event["kind"] for event in events])
        self.assertEqual(events[1]["text"], "NAV_STATE OFFBOARD at 15000 us.")

    def test_schema_accepts_a_rosbag2_document(self):
        import jsonschema

        events = extract_rosbag2.collect([
            record(MAVROS, 1_000_000, armed=False, connected=False, mode="AUTO.LOITER"),
        ])
        extract_ulog.assign_unique_ids(events)
        events.sort(key=lambda item: (item["timestampUs"], item["kind"], item["byteStart"], item["id"]))
        document = {
            "format": "flight-events-1",
            "parser": {"id": "rosbags", "version": "0.11.9"},
            "log": {"sha256": "sha256-" + ("cd" * 32), "byteLength": 8, "format": "rosbag2"},
            "events": events,
        }
        schema = json.loads((ROOT / "schemas/experimental/flight/flight-events-v1.schema.json").read_text())
        jsonschema.validate(document, schema)


if __name__ == "__main__":
    unittest.main()
