import { ogImage, OG_SIZE } from "@/lib/og";

export const size = OG_SIZE;
export const contentType = "image/png";
export const alt = "Boult — the AI running your inbox";

export default function Image() {
  return ogImage("Meet your new employee.", "It reads every thread, drafts in your voice, books meetings, and runs while you sleep. Nothing sends without your approval.");
}
