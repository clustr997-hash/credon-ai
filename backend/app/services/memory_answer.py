from __future__ import annotations

import re


def is_personal_query(query: str) -> bool:
    q = query.lower().strip()
    patterns = [
        r"\bwho am i\b",
        r"\bwhat is my name\b",
        r"\bmera naam\b",
        r"\bmy name\b",
        r"\bwhere do i live\b",
        r"\bwhere am i from\b",
        r"\bmy city\b",
        r"\bmy hometown\b",
        r"\bmy college\b",
        r"\bwhich college\b",
        r"\bwhat did i tell you about myself\b",
        r"\babout me\b",
        r"\bremember me\b",
    ]
    return any(re.search(pattern, q) for pattern in patterns)


def _extract_name_from_text(text: str) -> str | None:
    patterns = [
        r"\bmy name is\s*([a-zA-Z][a-zA-Z\s'-]{0,40})",
        r"\bi am\s+([a-zA-Z][a-zA-Z\s'-]{0,40})",
        r"\bi'm\s+([a-zA-Z][a-zA-Z\s'-]{0,40})",
    ]

    lowered = text.strip().lower()
    for pattern in patterns:
        match = re.search(pattern, lowered)
        if match:
            candidate = match.group(1).strip(" .,!?")
            if candidate:
                return " ".join(word.capitalize() for word in candidate.split())
    return None


def _extract_profile_updates(text: str) -> dict[str, str]:
    lowered = text.strip().lower()
    updates: dict[str, str] = {}

    name = _extract_name_from_text(text)
    if name:
        updates["name"] = name

    live_patterns = [
        r"\bi live in\s+([a-zA-Z][a-zA-Z\s'-]{1,50})",
        r"\bi am from\s+([a-zA-Z][a-zA-Z\s'-]{1,50})",
        r"\bmy city is\s+([a-zA-Z][a-zA-Z\s'-]{1,50})",
        r"\bmy hometown is\s+([a-zA-Z][a-zA-Z\s'-]{1,50})",
    ]
    for pattern in live_patterns:
        match = re.search(pattern, lowered)
        if match:
            updates["location"] = " ".join(word.capitalize() for word in match.group(1).strip(" .,!?").split())
            break

    college_patterns = [
        r"\bi study at\s+([a-zA-Z][a-zA-Z\s&'.,-]{1,80})",
        r"\bmy college is\s+([a-zA-Z][a-zA-Z\s&'.,-]{1,80})",
        r"\bi am in\s+([a-zA-Z][a-zA-Z\s&'.,-]{1,80})\s+college",
    ]
    for pattern in college_patterns:
        match = re.search(pattern, lowered)
        if match:
            updates["college"] = " ".join(word.capitalize() for word in match.group(1).strip(" .,!?").split())
            break

    return updates


def _build_profile(transcript: list[dict[str, str]]) -> dict[str, str]:
    profile: dict[str, str] = {}
    for item in transcript:
        if item.get("role") != "user":
            continue
        updates = _extract_profile_updates(item.get("text", ""))
        if updates:
            profile.update(updates)
    return profile


def memory_based_answer(query: str, transcript: list[dict[str, str]], target_language: str) -> str | None:
    query_lower = query.lower()
    profile = _build_profile(transcript)

    asks_name = any(
        phrase in query_lower
        for phrase in ["what is my name", "who am i", "mera naam", "my name", "naam kya"]
    )

    asks_other_personal = any(
        phrase in query_lower
        for phrase in ["where do i live", "where am i from", "my city", "hometown", "my college", "which college", "college"]
    )

    # Let personal_query_fallback handle combined profile questions (name + location/college).
    if asks_name and asks_other_personal:
        return None

    if not asks_name:
        return None

    latest_name = profile.get("name")

    if not latest_name:
        if target_language == "hinglish":
            return "Mujhe abhi aapka naam conversation me clear nahi mila. Aap bol sakte ho: 'my name is ...'."
        return "I could not find your name in this chat yet. You can tell me like: 'my name is ...'."

    if target_language == "hinglish":
        return f"Aapne pehle bataya tha ki aapka naam {latest_name} hai."
    return f"You told me earlier that your name is {latest_name}."


def personal_query_fallback(query: str, transcript: list[dict[str, str]], target_language: str) -> str | None:
    if not is_personal_query(query):
        return None

    profile = _build_profile(transcript)
    q = query.lower()

    asks_name = any(x in q for x in ["who am i", "what is my name", "my name"])
    asks_location = any(x in q for x in ["where do i live", "where am i from", "my city", "hometown"])
    asks_college = any(x in q for x in ["my college", "which college", "college"])

    parts: list[str] = []
    if asks_name and profile.get("name"):
        if target_language == "hinglish":
            parts.append(f"Aapka naam {profile['name']} hai")
        else:
            parts.append(f"your name is {profile['name']}")

    if asks_location and profile.get("location"):
        if target_language == "hinglish":
            parts.append(f"aap {profile['location']} se ho")
        else:
            parts.append(f"you are from {profile['location']}")

    if asks_college and profile.get("college"):
        if target_language == "hinglish":
            parts.append(f"aap {profile['college']} me padhte ho")
        else:
            parts.append(f"you study at {profile['college']}")

    if parts:
        if target_language == "hinglish":
            return "Aapne pehle bataya tha ki " + ", aur ".join(parts) + "."
        return "From this chat history, " + ", and ".join(parts) + "."

    if target_language == "hinglish":
        return (
            "Yeh personal question hai. Mujhe abhi is chat me enough personal details nahi mile. "
            "Aap aise bata sakte ho: 'my name is ...', 'I live in ...', 'my college is ...'."
        )
    return (
        "This is a personal question. I don't have enough personal details from this chat yet. "
        "You can tell me like: 'my name is ...', 'I live in ...', 'my college is ...'."
    )
