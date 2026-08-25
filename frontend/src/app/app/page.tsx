import type { Metadata } from "next";
import { Workspace } from "@/components/chat/workspace";

export const metadata: Metadata = { title: "Workspace" };

export default function AppPage() {
  return <Workspace />;
}
