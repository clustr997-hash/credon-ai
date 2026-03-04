from langdetect import detect, LangDetectException


def detect_language(user_text: str) -> str:
    lower = user_text.lower()
    hinglish_tokens = [
        "hai",
        "kya",
        "kaise",
        "mera",
        "tum",
        "aap",
        "nahi",
        "karna",
        "samjhao",
        "batao",
        "kyu",
    ]

    if any(token in lower for token in hinglish_tokens):
        return "hinglish"

    try:
        language = detect(user_text)
        if language == "en":
            return "en"
    except LangDetectException:
        pass

    return "en"
