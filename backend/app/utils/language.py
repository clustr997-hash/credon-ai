import re
from langdetect import detect, LangDetectException

# Explicit "answer in hinglish" signals — user wants Hinglish output
_HINGLISH_REQUEST_PATTERNS = re.compile(
    r"(?:in\s+)?hinglish|apni\s+(?:bhasha|language)\s+(?:mein|me)|hindi\s+me(?:in)?\s+(?:bata|samjha|explain)"
    r"|(?:samjha|bata|explain\s+kar).*(?:hindi|hinglish)"
    r"|(?:hinglish|hindi)\s+(?:mein|me|main)\s+(?:bata|samjha|de|do)",
    re.IGNORECASE,
)

# Hinglish word tokens
_HINGLISH_TOKENS = {
    "hai", "kya", "kaise", "mera", "meri", "tum", "aap", "nahi",
    "karna", "samjhao", "batao", "kyu", "kyun", "kyuki",
    "haan", "matlab", "lekin", "aur", "yeh", "woh", "kaisa",
    "bhai", "yaar", "bol", "bolo", "dekh", "dekho", "padh",
    "achha", "accha", "theek", "thik", "sahi", "galat",
    "samajh", "pata", "chalega", "milega", "hoga", "ho",
    "karo", "karo", "kar", "raha", "rahi", "rahe", "wala",
}


def detect_language(user_text: str) -> str:
    """Detect whether user wants English or Hinglish response.
    Handles: pure Hinglish text, explicit 'in hinglish' requests,
    English questions asking for Hinglish answers."""
    lower = user_text.lower()

    # Explicit request to answer in Hinglish
    if _HINGLISH_REQUEST_PATTERNS.search(lower):
        return "hinglish"

    # Check for Hinglish tokens (word-boundary aware)
    words = set(re.findall(r"[a-z]+", lower))
    hinglish_count = len(words & _HINGLISH_TOKENS)
    if hinglish_count >= 2 or (hinglish_count >= 1 and len(words) <= 5):
        return "hinglish"

    try:
        language = detect(user_text)
        if language in ("hi", "mr", "ne"):  # Hindi/Marathi/Nepali script
            return "hinglish"
        if language == "en":
            return "en"
    except LangDetectException:
        pass

    return "en"
