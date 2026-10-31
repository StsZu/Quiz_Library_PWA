#!/usr/bin/env python3
"""Check the shared quiz-package fixtures against Creator_quiz/tools/build_quiz.py (spec 002, SC-11, SC-12).

Usage: python3 scripts/check_fixtures.py [--write-keys]
For every fixture in tests/fixtures/quiz-package/ the exit code of build_quiz.py and its expected warnings
must match expected.json. keys.json holds the question keys computed by import_quizzes.py for accepted
fixtures; --write-keys regenerates it, otherwise it is compared. Creator_quiz is only read.
"""

import argparse
import json
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
FIXTURES = ROOT / "tests" / "fixtures" / "quiz-package"
SERVICE_FILES = {"expected.json", "keys.json"}

sys.dont_write_bytecode = True  # Creator_quiz stays unchanged (constitution V.6)
sys.path.insert(0, str(ROOT / "scripts"))
from import_quizzes import question_key  # noqa: E402


def creator_dir():
    config = json.loads((ROOT / "content" / "courses.json").read_text(encoding="utf-8"))
    return (ROOT / config["source"]).resolve()


def fixture_keys(path):
    data = json.loads(path.read_text(encoding="utf-8"))
    return [question_key(q) for q in data["questions"]]


def main(argv=None):
    parser = argparse.ArgumentParser(prog="check_fixtures.py")
    parser.add_argument("--write-keys", action="store_true", help="regenerate keys.json")
    args = parser.parse_args(argv)

    build_script = creator_dir() / "tools" / "build_quiz.py"
    if not build_script.is_file():
        print(f"error: Creator_quiz not found: {build_script}", file=sys.stderr)
        return 1
    expected = json.loads((FIXTURES / "expected.json").read_text(encoding="utf-8"))
    names = sorted(p.name for p in FIXTURES.glob("*.json") if p.name not in SERVICE_FILES)
    errors = []
    if sorted(expected) != names:
        errors.append(f"expected.json lists {sorted(set(expected) ^ set(names))} differently from the fixture files")

    keys = {}
    with tempfile.TemporaryDirectory() as workdir:
        for name in names:
            entry = expected.get(name)
            if entry is None:
                continue
            result = subprocess.run(
                [sys.executable, str(build_script), str(FIXTURES / name), "-o", str(Path(workdir) / "out.html"), "--force"],
                capture_output=True, text=True,
            )
            if result.returncode != entry["build_quiz"]:
                errors.append(f"{name}: build_quiz.py exit {result.returncode}, expected {entry['build_quiz']}\n{result.stderr.strip()}")
            for warning in entry.get("build_quiz_warnings", []):
                if warning not in result.stderr:
                    errors.append(f"{name}: build_quiz.py did not warn about «{warning}»")
            if entry["app"] == "accept":
                keys[name] = fixture_keys(FIXTURES / name)

    keys_path = FIXTURES / "keys.json"
    text = json.dumps(keys, ensure_ascii=False, indent=1) + "\n"
    if args.write_keys:
        keys_path.write_text(text, encoding="utf-8")
        print(f"wrote {keys_path.relative_to(ROOT)}")
    elif not keys_path.is_file() or keys_path.read_text(encoding="utf-8") != text:
        errors.append("keys.json is missing or out of date: run with --write-keys and review the diff")

    if errors:
        for message in errors:
            print(f"error: {message}", file=sys.stderr)
        return 1
    print(f"checked {len(names)} fixtures against {build_script}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
