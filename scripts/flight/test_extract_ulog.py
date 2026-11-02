#!/usr/bin/env python3
"""Field-selection checks for the optional ULog extractor. pyulog is not required."""

from __future__ import annotations

import json
import unittest
from pathlib import Path

import extract_ulog


ROOT = Path(__file__).resolve().parents[2]


class Dataset:
    def __init__(self, name: str, changes: dict, data: dict | None = None):
        self.name = name
        self._changes = changes
        self.data = data if data is not None else {field: [] for field in changes}

    def list_value_changes(self, field: str):
        if field not in self._changes:
            raise KeyError(field)
        return self._changes[field]


class Log:
    def __init__(self, datasets: list):
        self.data_list = datasets


def kinds(events: list[dict]) -> list[str]:
    return [event["kind"] for event in events]


class ExtractTests(unittest.TestCase):
    def test_failsafe_boolean_ignores_defer_state(self):
        status = Dataset(
            "vehicle_status",
            {
                "failsafe": [(10, 0), (20, 1), (30, 0)],
                "failsafe_defer_state": [(10, 0), (15, 1), (25, 2)],
                "failsafe_and_user_took_over": [(10, 0), (30, 1)],
            },
        )
        events = extract_ulog.collect(Log([status]))
        self.assertEqual(kinds(events), ["failsafe-assert", "failsafe-clear"])
        self.assertEqual(events[0]["fields"], {"name": "failsafe"})
        self.assertNotIn("failsafe_defer_state", json.dumps(events))

    def test_link_loss_uses_gcs_connection_lost_not_telemetry(self):
        status = Dataset(
            "vehicle_status",
            {"gcs_connection_lost": [(10, 0), (30, 1), (40, 0)]},
        )
        telemetry = Dataset(
            "telemetry_status",
            {
                "heartbeat_type": [(10, 1), (30, 0)],
                "type": [(10, 1), (30, 0)],
                "heartbeat_type_gcs": [(10, 1), (30, 0)],
            },
        )
        events = extract_ulog.collect(Log([status, telemetry]))
        self.assertEqual(kinds(events), ["link-loss", "link-restored"])
        self.assertEqual(events[0]["fields"], {})
        self.assertEqual(events[0]["timestampUs"], 30)
        self.assertEqual(events[1]["timestampUs"], 40)

    def test_older_data_link_lost_is_used_when_gcs_field_is_absent(self):
        status = Dataset(
            "vehicle_status",
            {
                "data_link_lost": [(5, 1), (9, 0)],
                "rc_signal_lost": [(7, 1)],
            },
        )
        events = extract_ulog.collect(Log([status]))
        self.assertEqual(
            [(event["kind"], event["timestampUs"]) for event in events],
            [("link-loss", 5), ("link-restored", 9), ("link-loss", 7)],
        )

    def test_gcs_field_wins_over_the_old_data_link_name(self):
        names = {"gcs_connection_lost", "data_link_lost", "high_latency_data_link_lost"}
        self.assertEqual(
            extract_ulog.link_loss_fields(names),
            ["gcs_connection_lost", "high_latency_data_link_lost"],
        )

    def test_duplicate_suffix_survives_a_64_character_base(self):
        base = "a" * 64
        events = [{"id": base}, {"id": base}]
        extract_ulog.assign_unique_ids(events)
        self.assertEqual(events[0]["id"], base)
        self.assertEqual(len(events[1]["id"]), 64)
        self.assertTrue(events[1]["id"].endswith("-1"))
        self.assertNotEqual(events[0]["id"], events[1]["id"])
        self.assertTrue(extract_ulog.token_ok(events[1]["id"]))

    def test_schema_matches_ingest_constraints(self):
        import jsonschema

        schema = json.loads((ROOT / "schemas/experimental/flight/flight-events-v1.schema.json").read_text())
        fixture = json.loads((ROOT / "examples/flight-ops/events.json").read_text())
        jsonschema.validate(fixture, schema)
        rejected = json.loads(json.dumps(fixture))
        rejected["parser"]["id"] = "my parser"
        rejected["events"] = []
        with self.assertRaises(jsonschema.ValidationError):
            jsonschema.validate(rejected, schema)
        loose = json.loads(json.dumps(fixture))
        loose["events"][0]["fields"]["extra"] = "nope"
        with self.assertRaises(jsonschema.ValidationError):
            jsonschema.validate(loose, schema)


if __name__ == "__main__":
    unittest.main()
