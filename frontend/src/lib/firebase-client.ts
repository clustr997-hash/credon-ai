import { getApps, initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

const hasRequiredConfig =
  !!firebaseConfig.apiKey &&
  !!firebaseConfig.authDomain &&
  !!firebaseConfig.projectId &&
  !!firebaseConfig.appId;

const app = hasRequiredConfig
  ? getApps().length
    ? getApps()[0]
    : initializeApp(firebaseConfig)
  : null;

export const firebaseAuth = app ? getAuth(app) : null;
export const firebaseDb = app ? getFirestore(app) : null;

export type FcmReadiness = {
  ready: boolean;
  reason?: string;
};

export function getFcmReadiness(): FcmReadiness {
  if (!app) return { ready: false, reason: "Firebase app is not configured." };
  if (typeof window === "undefined") return { ready: false, reason: "Notifications require a browser runtime." };
  if (!("Notification" in window)) return { ready: false, reason: "This browser does not support notifications." };
  if (!("serviceWorker" in navigator)) return { ready: false, reason: "Service workers are not available in this browser." };
  if (!process.env.NEXT_PUBLIC_FIREBASE_VAPID_KEY) {
    return { ready: false, reason: "Missing NEXT_PUBLIC_FIREBASE_VAPID_KEY for FCM token generation." };
  }
  return { ready: true };
}

export async function enableFcmAndGetToken(): Promise<{ token?: string; error?: string }> {
  const readiness = getFcmReadiness();
  if (!readiness.ready) {
    return { error: readiness.reason || "FCM is not ready." };
  }
  try {
    const permission = await Notification.requestPermission();
    if (permission !== "granted") {
      return { error: "Notification permission was denied." };
    }

    const messagingModule = await import("firebase/messaging");
    const registration = await navigator.serviceWorker.getRegistration("/");
    const swRegistration = registration ?? await navigator.serviceWorker.register("/sw.js");
    const messaging = messagingModule.getMessaging(app!);

    const token = await messagingModule.getToken(messaging, {
      vapidKey: process.env.NEXT_PUBLIC_FIREBASE_VAPID_KEY,
      serviceWorkerRegistration: swRegistration,
    });
    if (!token) {
      return { error: "FCM token could not be generated." };
    }
    return { token };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown FCM error";
    return { error: message };
  }
}
