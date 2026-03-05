import json
import requests

payload = {
    "user_id": "smoke-user",
    "session_id": "smoke-session",
    "query": "What is quantum computing in simple terms?",
    "language": "en",
    "use_web": True,
}

response = requests.post(
    "http://127.0.0.1:8000/api/v1/chat/stream",
    json=payload,
    stream=True,
    timeout=120,
)
response.raise_for_status()

event_types: list[str] = []
got_sources = False
got_thinking = False
got_token = False
done_event: dict[str, object] | None = None

for raw in response.iter_lines():
    if not raw:
        continue
    line = raw.decode("utf-8", "ignore")
    if not line.startswith("data: "):
        continue
    event = json.loads(line[6:])
    event_type = str(event.get("type", ""))
    if event_type:
        event_types.append(event_type)
    if event_type in {"thinking", "thinking_token", "thinking_done"}:
        got_thinking = True
    if event_type == "sources" and event.get("sources"):
        got_sources = True
    if event_type == "token" and event.get("content"):
        got_token = True
    if event_type == "done":
        done_event = event
        break

print("EVENTS", event_types[:25])
print("THINKING", got_thinking)
print("SOURCES", got_sources)
print("TOKEN", got_token)
print("DONE_KEYS", sorted(done_event.keys()) if done_event else None)
