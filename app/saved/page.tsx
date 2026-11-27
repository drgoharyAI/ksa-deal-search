import type { Metadata } from "next";
import SavedView from "./SavedView";

export const metadata: Metadata = { title: "Saved, Deal search" };

export default function SavedPage() {
  return <SavedView />;
}
