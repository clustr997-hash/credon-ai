import json
import re
from typing import Any

from app.services.models import generate_sync

_CLASSIFIER_PROMPT = """You are the internal Router for Credon AI.
Analyze the user's latest message given the conversation history.

Determine the following:
1. Intent: (Question, Rewrite, Analysis, Coding, Debugging, Brainstorming, Reply generation, Translation, Planning, Comparison, Summarization, Research, or General)
2. Conversation Mode: (Information request, Feedback, Casual chat, Technical debugging, Research, Creative writing, Coding, Product design discussion, Follow-up question)
3. Need Search: (true/false - Does this need current web search to answer factually?)
4. Referenced Content: (What previous assistant message or part of it is the user referring to? Return empty string if none)

Return ONLY a valid JSON object. No markdown, no thinking.
Example:
{
  "intent": "Question",
  "mode": "Information request",
  "need_search": true,
  "referenced_content": ""
}
"""

def analyze_query(query: str, transcript: list[dict[str, str]], model: str | None = None) -> dict[str, Any]:
    history_text = ""
    if transcript:
        # Keep last 4 turns for context
        recent = transcript[-4:]
        for msg in recent:
            role = msg.get("role", "unknown")
            text = msg.get("text", "")[:500] # truncate
            history_text += f"{role.capitalize()}: {text}\n"

    user_prompt = f"Chat History:\n{history_text}\n\nLatest User Message: {query}"

    messages = [
        {"role": "system", "content": _CLASSIFIER_PROMPT},
        {"role": "user", "content": user_prompt}
    ]

    try:
        response = generate_sync(messages, model=model)
        # Extract JSON
        match = re.search(r'\{.*\}', response, re.DOTALL)
        if match:
            return json.loads(match.group(0))
        return {
            "intent": "General",
            "mode": "Casual chat",
            "need_search": False,
            "referenced_content": ""
        }
    except Exception as e:
        print(f"[Classification] Error: {e}")
        return {
            "intent": "General",
            "mode": "Casual chat",
            "need_search": False,
            "referenced_content": ""
        }
