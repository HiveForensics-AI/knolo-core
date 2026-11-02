#!/usr/bin/env python3
"""Field-selection checks for the optional DataFlash extractor. pymavlink is not required."""

from __future__ import annotations

import json
import unittest
from pathlib import Path

import extract_dataflash
import extract_ulog


ROOT = Path(__file__).resolve().parents[2]


def msg(kind, **fields):
    return {"type": kind, **fields}


def pairs(events):
    return [(event["kind"], event["timestampUs"], event["fields"]) for event in events]


class DataFlashTests(unittest.TestCase):
    def test_high_rate_messages_are_discarded_before_selection(self):
        def source():
            yield msg("IMU", TimeUS=1, AccX=1)
            yield msg("ARM", TimeUS=1000, ArmState=1)
            yield msg("ATT", TimeUS=2, Roll=1)
            yield msg("MSG", TimeUS=3, Message="Failsafe")

        kept = list(extract_dataflash.iter_relevant(source()))
        self.assertEqual([item["type"] for item in kept], ["ARM"])
        events = extract_dataflash.collect(extract_dataflash.iter_relevant(source()))
        self.assertEqual(pairs(events), [("arming", 1000, {"state": "armed"})])

    def test_compass_flight_mode_crash_gps_and_msg_emit_nothing(self):
        events = extract_dataflash.collect([
            msg("MSG", TimeUS=1000, Message="Failsafe battery"),
            msg("ERR", TimeUS=2000, Subsys=3, ECode=1),
            msg("ERR", TimeUS=3000, Subsys=7, ECode=1),
            msg("ERR", TimeUS=4000, Subsys=10, ECode=1),
            msg("ERR", TimeUS=5000, Subsys=12, ECode=1),
            msg("FMT", TimeUS=6000, Name="ERR"),
        ])
        self.assertEqual(events, [])

    def test_fence_is_failsafe_and_radio_is_link_only(self):
        events = extract_dataflash.collect([
            msg("ERR", TimeUS=1000, Subsys=9, ECode=0),
            msg("ERR", TimeUS=2000, Subsys=9, ECode=1),
            msg("ERR", TimeUS=3000, Subsys=9, ECode=2),
            msg("ERR", TimeUS=4000, Subsys=9, ECode=0),
            msg("ERR", TimeUS=5000, Subsys=5, ECode=0),
            msg("ERR", TimeUS=6000, Subsys=5, ECode=1),
            msg("ERR", TimeUS=7000, Subsys=5, ECode=0),
            msg("ERR", TimeUS=8000, Subsys=8, ECode=1),
        ])
        self.assertEqual(pairs(events), [
            ("failsafe-assert", 2000, {"name": "failsafe-fence"}),
            ("failsafe-clear", 4000, {"name": "failsafe-fence"}),
            ("link-loss", 6000, {}),
            ("link-restored", 7000, {}),
            ("link-loss", 8000, {}),
        ])
        self.assertEqual(events[0]["text"], "FAILSAFE failsafe-fence asserted at 2000 us.")
        self.assertEqual(events[2]["text"], "link loss recorded at 6000 us.")
        self.assertEqual(events[0]["byteStart"], 0)
        self.assertEqual(events[0]["byteEnd"], 0)
        self.assertNotIn("failsafe-assert", [event["kind"] for event in events[2:]])

    def test_each_failsafe_subsys_uses_its_name(self):
        messages = []
        expected = []
        for index, (subsys, name) in enumerate(sorted(extract_dataflash.FAILSAFE_NAMES.items())):
            timestamp = (index + 1) * 10
            messages.append(msg("ERR", TimeUS=timestamp, Subsys=subsys, ECode=1))
            expected.append((timestamp, name))
        events = extract_dataflash.collect(messages)
        self.assertEqual(
            [(event["timestampUs"], event["fields"]["name"]) for event in events],
            expected,
        )
        self.assertTrue(all(event["kind"] == "failsafe-assert" for event in events))

    def test_battery_instance_zero_crosses_below_20(self):
        events = extract_dataflash.collect([
            msg("BAT", TimeUS=1000, Inst=1, RemPct=5),
            msg("BAT", TimeUS=2000, Inst=0, RemPct=25),
            msg("BAT", TimeUS=3000, Inst=0, RemPct=20),
            msg("BAT", TimeUS=4000, Inst=0, RemPct=19),
            msg("BAT", TimeUS=5000, Inst=0, RemPct=5),
            msg("BAT", TimeUS=6000, Inst=0, RemPct=40),
            msg("BAT", TimeUS=7000, Inst=0, RemPct=10),
        ])
        self.assertEqual(pairs(events), [
            ("battery-threshold", 4000, {"level": "low"}),
            ("battery-threshold", 7000, {"level": "low"}),
        ])
        self.assertEqual(events[0]["text"], "battery threshold crossed at 4000 us. level low.")

    def test_arm_and_mode_emit_on_change(self):
        events = extract_dataflash.collect([
            msg("ARM", TimeUS=1000, ArmState=0),
            msg("ARM", TimeUS=2000, ArmState=0),
            msg("ARM", TimeUS=3000, ArmState=1),
            msg("ARM", TimeUS=4000, ArmState=2),
            msg("MODE", TimeUS=5000, Mode=4, ModeNum=99),
            msg("MODE", TimeUS=6000, Mode=4, ModeNum=1),
            msg("MODE", TimeUS=7000, ModeNum=7),
            msg("ARM", TimeUS=8000, ArmState=0),
        ])
        self.assertEqual(pairs(events), [
            ("arming", 1000, {"state": "disarmed"}),
            ("arming", 3000, {"state": "armed"}),
            ("nav-mode", 5000, {"mode": "mode-4"}),
            ("nav-mode", 7000, {"mode": "mode-7"}),
            ("arming", 8000, {"state": "disarmed"}),
        ])
        self.assertEqual(events[2]["text"], "NAV_STATE mode-4 at 5000 us.")

    def test_schema_accepts_a_dataflash_document(self):
        import jsonschema

        events = extract_dataflash.collect([
            msg("ARM", TimeUS=1000, ArmState=1),
            msg("ERR", TimeUS=2000, Subsys=9, ECode=1),
        ])
        extract_ulog.assign_unique_ids(events)
        events.sort(key=lambda item: (item["timestampUs"], item["kind"], item["byteStart"], item["id"]))
        document = {
            "format": "flight-events-1",
            "parser": {"id": "pymavlink", "version": "2.4.50"},
            "log": {"sha256": "sha256-" + ("ab" * 32), "byteLength": 12, "format": "dataflash"},
            "events": events,
        }
        schema = json.loads((ROOT / "schemas/experimental/flight/flight-events-v1.schema.json").read_text())
        jsonschema.validate(document, schema)


if __name__ == "__main__":
    unittest.main()
