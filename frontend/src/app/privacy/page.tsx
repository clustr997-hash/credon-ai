import type { Metadata } from "next";
import { MetaPage } from "@/components/meta-page";

export const metadata: Metadata = { title: "Privacy policy" };

export default function PrivacyPage() {
  return (
    <MetaPage title="Privacy policy" updated="August 2026">
      <p>
        Credon AI is built to be useful without harvesting your life. This policy explains, in plain
        language, what happens to your data.
      </p>
      <h2>What stays on your device</h2>
      <ul className="list">
        <li>Your profile details (name, role, subjects, notes) saved in Settings → Profile.</li>
        <li>Your saved prompts and UI preferences.</li>
        <li>When the Credon engine (backend) runs on your own machine, chat sessions, uploaded
        documents and learned memories are stored locally in that machine&apos;s data folder.</li>
      </ul>
      <h2>What is sent to AI providers</h2>
      <p>
        To generate answers, your messages (and the content of documents you explicitly attach) are
        sent to the model providers configured in Credon — such as free-tier model APIs. We route
        through Credon&apos;s own orchestration layer and never sell or share your data with third
        parties beyond these providers.
      </p>
      <h2>What we collect</h2>
      <ul className="list">
        <li>Account basics if you sign in (email, display name) via Firebase Authentication.</li>
        <li>Optional: a push-notification token, only if you enable notifications.</li>
        <li>Feedback you deliberately submit (👍 / 👎 with a reason) to improve answer quality.</li>
      </ul>
      <h2>What we never do</h2>
      <ul className="list">
        <li>Sell your data. Ever.</li>
        <li>Train third-party models on your private documents.</li>
        <li>Read your uploads unless you attach them or ask Credon to use them.</li>
      </ul>
      <h2>Deleting your data</h2>
      <p>
        Delete any chat from the sidebar, forget individual memories in Settings → Memory, or sign
        out and clear local data. For account deletion, contact the site operator.
      </p>
      <h2>Questions</h2>
      <p>
        Reach us via the <a href="/help">Help page</a>.
      </p>
    </MetaPage>
  );
}
