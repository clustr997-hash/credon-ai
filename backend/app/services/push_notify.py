from __future__ import annotations

from typing import Any

from app.services.push_store import get_user_push_tokens

try:
    from firebase_admin import messaging  # type: ignore[import-untyped]
except Exception:
    messaging = None  # type: ignore[assignment]


def send_test_push(user_id: str, title: str, body: str) -> dict[str, Any]:
    tokens = get_user_push_tokens(user_id)
    if not tokens:
        return {"ok": False, "error": "no_registered_tokens", "sent": 0}
    if messaging is None:
        return {"ok": False, "error": "firebase_messaging_unavailable", "sent": 0}

    sent = 0
    failed = 0
    for token in tokens:
        try:
            message = messaging.Message(
                token=token,
                notification=messaging.Notification(title=title, body=body),
                data={"kind": "credon-test", "user_id": user_id},
                webpush=messaging.WebpushConfig(
                    fcm_options=messaging.WebpushFCMOptions(link="/"),
                ),
            )
            messaging.send(message)
            sent += 1
        except Exception:
            failed += 1

    return {
        "ok": sent > 0,
        "sent": sent,
        "failed": failed,
        "total_tokens": len(tokens),
    }
