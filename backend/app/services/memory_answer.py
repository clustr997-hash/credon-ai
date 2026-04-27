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


def _is_name_recall_query(query: str) -> bool:
    q = query.lower().strip()
    patterns = [
        r"\bwho am i\b",
        r"\bwhat is my name\b",
        r"\bdo you remember my name\b",
        r"\bmera naam kya\b",
        r"\bnaam kya\b",
        r"\bwhat did i tell you about myself\b",
    ]
    return any(re.search(pattern, q) for pattern in patterns)


def _is_profile_intro_statement(query: str) -> bool:
    q = query.lower().strip()
    patterns = [
        r"\bmy name is\s+[a-zA-Z][a-zA-Z\s'-]{0,30}$",
        r"\bi am\s+[a-zA-Z][a-zA-Z\s'-]{0,30}$",
        r"\bi'm\s+[a-zA-Z][a-zA-Z\s'-]{0,30}$",
        r"\bmera naam\s+[a-zA-Z][a-zA-Z\s'-]{0,30}$",
    ]
    return any(re.search(pattern, q) for pattern in patterns)


def _extract_name_from_text(text: str) -> str | None:
    stopwords = {
        "talking", "about", "you", "this", "that", "here", "there", "working",
        "doing", "trying", "asking", "saying", "from", "with", "for",
    }
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
            words = [w for w in candidate.split() if w]
            if words and len(words) <= 3 and not any(w in stopwords for w in words):
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

    asks_name = _is_name_recall_query(query)

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


def profile_update_acknowledgement(query: str, transcript: list[dict[str, str]], target_language: str) -> str | None:
    if not _is_profile_intro_statement(query):
        return None

    updates = _extract_profile_updates(query)
    name = updates.get("name")
    location = updates.get("location")
    college = updates.get("college")
    if not any([name, location, college]):
        return None

    selector = (sum(ord(ch) for ch in query.lower()) + len(transcript)) % 3

    if target_language == "hinglish":
        if name:
            variants = [
                f"Hello {name}! Aapse milke accha laga. Aaj kis topic par help chahiye?",
                f"Hey {name}, got it. Aaj aap kya explore karna chahte ho?",
                f"Hi {name}! Main ready hoon. Aaj kaise help karun?",
            ]
            return variants[selector]
        if location:
            return f"Got it, aap {location} se ho. Ab batao kis cheez me help chahiye?"
        return f"Noted, aap {college} me padhte ho. Aaj kya kaam karna hai?"

    if name:
        variants = [
            f"Hello {name}. Nice to meet you. How can I help today?",
            f"Hey {name}, got it. What would you like to work on today?",
            f"Hi {name}. Good to meet you. How is your day going?",
        ]
        return variants[selector]
    if location:
        return f"Got it, you're from {location}. What would you like help with today?"
    return f"Noted, you study at {college}. What do you want to work on today?"


def personal_query_fallback(query: str, transcript: list[dict[str, str]], target_language: str) -> str | None:
    if not is_personal_query(query):
        return None

    profile = _build_profile(transcript)
    q = query.lower()

    asks_name = _is_name_recall_query(query)
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
