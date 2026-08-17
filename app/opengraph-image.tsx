import { ogImage, OG_SIZE } from "@/lib/og";

export const size = OG_SIZE;
export const contentType = "image/png";
export const alt = "Maily — runs your inbox while you build your company";

export default function Image() {
  return ogImage("You run your company, We run your inbox.", "It reads, prioritizes, drafts in your voice, books meetings, and follows up — you wake up to one morning briefing instead of an inbox.");
}
