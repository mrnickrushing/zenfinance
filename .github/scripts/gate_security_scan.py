#!/usr/bin/env python3
"""Turn an `agents.cli scan` JSON report into a CI pass/fail decision.

`python -m agents.cli scan` always exits 0 — it is a reporter, not a gate. This
script reads the report it writes and decides whether the build should fail.

Two modes, matching PLAN §7 ("free heuristic pass on every PR, --triage pass on
release branches"):

  * Heuristic pass (no triage): the report has no `triage_summary`. Heuristic
    findings false-positive on context outside the one file each check sees, so
    this mode never fails the build — it prints the counts so the check is
    informative but non-blocking on noise.

  * Triage pass (LLM verified, release branches): each entry carries a
    `triage` verdict of CONFIRMED / FALSE_POSITIVE / UNKNOWN. Only findings on
    CONFIRMED entries can fail the build, and only at/above --fail-on severity
    (default CRITICAL). FALSE_POSITIVE and UNKNOWN entries never fail it.

Exit code is 1 when the build should fail, 0 otherwise.
"""

from __future__ import annotations

import argparse
import json
import sys
from typing import Any, Dict, List

SEVERITY_RANK = {"CRITICAL": 0, "HIGH": 1, "MEDIUM": 2, "LOW": 3, "INFO": 4}


def _entry_findings(entry: Dict[str, Any]) -> List[Dict[str, Any]]:
    result = entry.get("result", {})
    findings = (
        result.get("findings")
        or result.get("jwt_findings")
        or result.get("cors_findings")
        or result.get("diagnoses")
        or []
    )
    return [f for f in findings if isinstance(f, dict)]


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("report", help="Path to the scan JSON report")
    parser.add_argument(
        "--fail-on",
        default="CRITICAL",
        choices=list(SEVERITY_RANK),
        help="Lowest severity that fails a triaged build (default: CRITICAL)",
    )
    args = parser.parse_args()

    try:
        with open(args.report, encoding="utf-8") as fh:
            report = json.load(fh)
    except (OSError, json.JSONDecodeError) as exc:
        print(f"::error::Could not read scan report {args.report!r}: {exc}")
        return 1

    summary = report.get("summary") or {}
    triaged = report.get("triage_summary") is not None
    threshold = SEVERITY_RANK[args.fail_on]

    counts = ", ".join(f"{sev}={summary[sev]}" for sev in SEVERITY_RANK if sev in summary) or "none"
    print(f"Scan of {report.get('project', '.')}: {report.get('files_matched', 0)} files with findings")
    print(f"Severity counts: {counts}")

    if not triaged:
        print(
            "Heuristic pass (no LLM triage) — informational only, not gating. "
            "Findings here can false-positive on cross-file context; the triaged "
            "pass on release branches is the gate."
        )
        return 0

    ts = report["triage_summary"]
    print(
        f"Triage: {ts.get('confirmed', 0)} confirmed, "
        f"{ts.get('false_positive', 0)} dismissed, {ts.get('unknown', 0)} unverified"
    )

    blocking: List[str] = []
    for entry in report.get("results", []):
        verdict = entry.get("triage", {}).get("verdict")
        if verdict != "CONFIRMED":
            continue
        for finding in _entry_findings(entry):
            sev = finding.get("severity", "INFO")
            if SEVERITY_RANK.get(sev, 4) <= threshold:
                title = finding.get("title") or finding.get("issue") or finding.get("summary") or "finding"
                where = f"{entry.get('file', '?')} [{entry.get('agent', '?')}.{entry.get('tool', '?')}]"
                blocking.append(f"{sev}  {where}: {title}")

    if blocking:
        print(f"\n{len(blocking)} confirmed finding(s) at or above {args.fail_on} — failing build:")
        for line in blocking:
            print(f"::error::{line}")
        return 1

    print(f"\nNo confirmed findings at or above {args.fail_on}. Passing.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
