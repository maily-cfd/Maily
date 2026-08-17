import { ogImage, OG_SIZE } from "@/lib/og";

export const size = OG_SIZE;
export const contentType = "image/png";
export const alt = "Maily pricing";

export default function Image() {
  return ogImage("Your next hire costs $29 a month.", "One plan, everything included. Monthly $29, Annual $199/yr, Lifetime $499. 3-day free trial.");
}
