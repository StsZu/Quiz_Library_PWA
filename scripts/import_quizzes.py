#!/usr/bin/env python3
"""Import quizzes from Creator_quiz into public/content/ (spec FR-01…FR-03, plan → «Контракти»).

Usage: python3 scripts/import_quizzes.py [content/courses.json] [public/content]
Each quiz must pass Creator_quiz/tools/build_quiz.py with exit code 0; any failure stops the import
and nothing is written. Output is deterministic: the same input gives byte-identical files.
"""

import argparse
import hashlib
import json
import subprocess
import sys
import tempfile
from pathlib import Path

QUESTION_KEYS = ("title", "question", "options", "correct", "feedback")


def digest(value):
    return hashlib.sha256(json.dumps(value, ensure_ascii=False, sort_keys=True).encode("utf-8")).hexdigest()[:12]


def question_key(q):
    return digest([q["question"], q["options"], q["correct"]])


def gate(build_script, source, workdir):
    out = Path(workdir) / (source.stem + ".html")
    result = subprocess.run(
        [sys.executable, str(build_script), str(source), "-o", str(out), "--force"],
        capture_output=True, text=True,
    )
    return result.returncode, result.stderr.strip()


def load_quiz(build_quiz, source):
    questions, meta, wrapper_strings = build_quiz.load_input(str(source))
    args = argparse.Namespace(lang=None, title=None, description=None, dir=None)
    resolved = build_quiz.resolve_meta(args, meta)
    strings = build_quiz.resolve_strings(resolved["lang"], wrapper_strings, None)
    items = []
    for q in questions:
        item = {key: q[key] for key in QUESTION_KEYS}
        items.append({"key": question_key(item), **item})
    keys = [q["key"] for q in items]
    if len(set(keys)) != len(keys):
        raise ValueError(f"{source.name}: two questions have the same content")
    quiz = {"id": source.stem, "meta": resolved, "strings": strings, "questions": items}
    return {"id": quiz["id"], "contentHash": digest(quiz), **{k: quiz[k] for k in ("meta", "strings", "questions")}}


def main(argv=None):
    parser = argparse.ArgumentParser(prog="import_quizzes.py")
    parser.add_argument("courses", nargs="?", default="content/courses.json")
    parser.add_argument("out", nargs="?", default="public/content")
    args = parser.parse_args(argv)
    courses_path = Path(args.courses).resolve()
    config = json.loads(courses_path.read_text(encoding="utf-8"))
    creator = (courses_path.parent.parent / config["source"]).resolve()
    build_script = creator / "tools" / "build_quiz.py"
    if not build_script.is_file():
        print(f"error: Creator_quiz not found: {build_script}", file=sys.stderr)
        return 1
    sys.dont_write_bytecode = True  # Creator_quiz stays unchanged (constitution V.6)
    sys.path.insert(0, str(build_script.parent))
    import build_quiz  # noqa: E402

    errors, quizzes, index = [], {}, {"courses": []}
    with tempfile.TemporaryDirectory() as workdir:
        for course in config["courses"]:
            entry = {"id": course["id"], "title": course["title"], "quizzes": []}
            for quiz_id in course["quizzes"]:
                source = creator / "OUTPUT_quiz" / f"{quiz_id}.json"
                code, stderr = gate(build_script, source, workdir)
                if code != 0:
                    errors.append(f"{quiz_id}: build_quiz.py exit {code}\n{stderr}")
                    continue
                for line in stderr.splitlines():
                    if line.startswith("warning:"):
                        print(f"{quiz_id}: {line}", file=sys.stderr)
                try:
                    quiz = load_quiz(build_quiz, source)
                except (build_quiz.BuildError, ValueError) as exc:
                    errors.append(f"{quiz_id}: {exc}")
                    continue
                quizzes[quiz_id] = quiz
                entry["quizzes"].append({
                    "id": quiz_id, "title": quiz["meta"]["title"], "lang": quiz["meta"]["lang"],
                    "questions": len(quiz["questions"]), "contentHash": quiz["contentHash"],
                })
            index["courses"].append(entry)
    if errors:
        for message in errors:
            print(f"error: {message}", file=sys.stderr)
        print("import stopped: nothing was written", file=sys.stderr)
        return 2

    index = {"version": digest(index), **index}
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    expected = {f"{quiz_id}.json" for quiz_id in quizzes} | {"index.json"}
    for quiz_id, quiz in quizzes.items():
        (out / f"{quiz_id}.json").write_text(json.dumps(quiz, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    (out / "index.json").write_text(json.dumps(index, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    for stale in out.glob("*.json"):
        if stale.name not in expected:
            stale.unlink()
            print(f"removed stale {stale}")
    print(f"imported {len(quizzes)} quizzes in {len(index['courses'])} courses → {out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
