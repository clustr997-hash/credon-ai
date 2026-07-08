import re
from typing import Optional

def check_three_turn_rule(transcript: list[dict[str, str]], latest_query: str) -> Optional[str]:
    """
    If three consecutive messages (including the latest) are only acknowledgements or feedback,
    summarize, list action items, and stop.
    """
    ack_patterns = [
        r"^(ok|okay|got it|thanks|thank you|cool|awesome|great|good|fine|sure|yes|yeah|yep|understood|noted)[\.\!]*\s*$"
    ]

    def is_ack(text: str) -> bool:
        text = text.lower().strip()
        for p in ack_patterns:
            if re.match(p, text):
                return True
        return False

    # Need at least 2 previous turns + the current one
    if len(transcript) < 4:  # Each turn has user + assistant, so we need at least 4 past messages to have 2 past user messages
        return None

    user_msgs = [m.get("text", "") for m in transcript if m.get("role") == "user"]

    if len(user_msgs) < 2:
        return None

    recent_user_msgs = user_msgs[-2:] + [latest_query]

    if all(is_ack(msg) for msg in recent_user_msgs):
        return "It seems we're wrapped up here! Let me know if you need help with anything else. You can start a new topic or ask a new question."

    return None

def enforce_three_turn_rule_if_applicable(query: str, transcript: list[dict[str, str]]) -> Optional[str]:
    return check_three_turn_rule(transcript, query)
