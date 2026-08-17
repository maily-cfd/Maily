import { ogImage, OG_SIZE } from "@/lib/og";

export const size = OG_SIZE;
export const contentType = "image/png";
export const alt = "Maily security";

export default function Image() {
  return ogImage("We can't read your email.", "Encrypted in your browser before it leaves. Never used to train models. Architecture, not a promise.");
}
