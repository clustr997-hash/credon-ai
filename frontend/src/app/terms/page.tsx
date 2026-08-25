import type { Metadata } from "next";
import { MetaPage } from "@/components/meta-page";

export const metadata: Metadata = { title: "Terms of use" };

export default function TermsPage() {
  return (
    <MetaPage title="Terms of use" updated="August 2026">
      <p>Short version: use Credon honestly and it will be genuinely useful. Full version below.</p>
      <h2>1. The service</h2>
      <p>
        Credon AI provides an AI-assisted workspace: chat, research with web sources, document
        reading, agentic code execution in a sandbox, and document exports. The core service is
        provided free of charge.
      </p>
      <h2>2. Acceptable use</h2>
      <ul className="list">
        <li>Don&apos;t use Credon for illegal, harmful, or deceptive activity.</li>
        <li>Don&apos;t attempt to abuse, overload, or reverse the model providers Credon routes to.</li>
        <li>Don&apos;t submit malware to the code sandbox or attempt to escape it.</li>
        <li>Academic work: follow your institution&apos;s AI policy. Credon is a learning tool, not a cheating tool.</li>
      </ul>
      <h2>3. AI output</h2>
      <p>
        Answers are generated and can be wrong. Verify important information — medical, legal,
        financial, or academic. Credon shows sources and confidence so you can check its work.
      </p>
      <h2>4. Agent mode & sandbox</h2>
      <p>
        Agent mode executes model-written Python in an isolated, timeout-bounded environment with
        network and filesystem restrictions. While we work hard to keep it safe, you run it at your
        own discretion on your own machine.
      </p>
      <h2>5. Availability</h2>
      <p>
        Credon relies on free-tier model providers. Routes fail over automatically, but no uptime
        guarantee is offered. Check <a href="/status">status</a> for live health.
      </p>
      <h2>6. Changes</h2>
      <p>
        These terms may change; material updates appear in the <a href="/changelog">changelog</a>.
        Continued use means acceptance.
      </p>
    </MetaPage>
  );
}
