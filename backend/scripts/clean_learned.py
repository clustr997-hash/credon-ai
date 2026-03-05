import json
from pathlib import Path


def clean_learned_data():
    learned_path = Path("backend/data/credon_learned.json")
    if not learned_path.exists():
        learned_path.parent.mkdir(parents=True, exist_ok=True)
        learned_path.write_text("[]", encoding="utf-8")
        data: list[dict[str, str]] = []
    else:
        raw = learned_path.read_text(encoding="utf-8").strip()
        if not raw:
            data = []
        else:
            try:
                loaded = json.loads(raw)
                data = loaded if isinstance(loaded, list) else []
            except json.JSONDecodeError:
                data = []

    # Filter out bad entries
    cleaned = []
    for entry in data:
        if not isinstance(entry, dict):
            continue
        q = str(entry.get("question", "")).lower()
        a = str(entry.get("answer", "")).lower()
        if not q or not a:
            continue

        # Skip if:
        # - Question is too short/generic
        # - Answer contains error markers
        # - Answer is about wrong topic
        if len(q.split()) <= 2 and q not in {"who am i", "what is my name"}:
            continue
        if "hii" in q or "huntington ingalls" in a:
            continue
        if "i'm building a deeper understanding" in a:
            continue
        if "[user attached" in q or "[replying to" in q:
            continue

        cleaned.append(entry)

    # Save cleaned data
    learned_path.write_text(json.dumps(cleaned, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Cleaned: {len(data)} → {len(cleaned)} entries")


if __name__ == "__main__":
    clean_learned_data()
