from __future__ import annotations

import argparse
import json
from pathlib import Path
from datetime import datetime, timezone


def build_record(question: str, answer: str) -> dict[str, str]:
    return {
        "instruction": question.strip(),
        "input": "",
        "output": answer.strip(),
        "system": "You are Credon AI, an intelligent assistant that explains clearly and accurately.",
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Export Credon learned Q&A into JSONL training data")
    parser.add_argument("--learned", default="backend/data/credon_learned.json", help="Path to credon_learned.json")
    parser.add_argument("--out", default="backend/data/credon_training.jsonl", help="Output JSONL file")
    parser.add_argument("--min-answer-len", type=int, default=40, help="Minimum answer length to keep")
    args = parser.parse_args()

    learned_path = Path(args.learned)
    out_path = Path(args.out)

    if not learned_path.exists():
        print(f"No learned data found at: {learned_path}")
        return 1

    raw = json.loads(learned_path.read_text(encoding="utf-8"))
    if not isinstance(raw, list):
        print("Invalid learned data format (expected a list)")
        return 1

    records: list[dict[str, str]] = []
    for item in raw:
        if not isinstance(item, dict):
            continue
        question = str(item.get("question", "")).strip()
        answer = str(item.get("answer", "")).strip()
        if not question or not answer:
            continue
        if len(answer) < args.min_answer_len:
            continue
        if "backend not" in answer.lower() or "something went wrong" in answer.lower():
            continue
        records.append(build_record(question, answer))

    out_path.parent.mkdir(parents=True, exist_ok=True)
    with out_path.open("w", encoding="utf-8") as f:
        for rec in records:
            f.write(json.dumps(rec, ensure_ascii=False) + "\n")

    meta = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "source": str(learned_path),
        "output": str(out_path),
        "records": len(records),
        "min_answer_len": args.min_answer_len,
    }
    meta_path = out_path.with_suffix(".meta.json")
    meta_path.write_text(json.dumps(meta, ensure_ascii=False, indent=2), encoding="utf-8")

    print(f"Generated: {out_path}")
    print(f"Records: {len(records)}")
    print(f"Meta: {meta_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
