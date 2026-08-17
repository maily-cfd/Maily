import { ImageResponse } from "next/og";

export const OG_SIZE = { width: 1200, height: 630 };

/**
 * Shared OG-image template — black ground, white headline, muted subtitle.
 * Used by every route's opengraph-image.tsx so social cards carry each page's
 * actual positioning instead of one generic image. (In ImageResponse JSX,
 * every element with multiple children must be display:flex.)
 */
export function ogImage(title: string, subtitle: string) {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          backgroundColor: "#000000",
          color: "#ffffff",
          padding: "72px",
        }}
      >
        <div style={{ display: "flex", fontSize: 26, letterSpacing: 8, color: "#8a8f98" }}>
          MAILY
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
          <div style={{ display: "flex", fontSize: 62, fontWeight: 600, lineHeight: 1.12, letterSpacing: -1.5, maxWidth: 1020 }}>
            {title}
          </div>
          <div style={{ display: "flex", fontSize: 27, color: "#8a8f98", maxWidth: 980, lineHeight: 1.45 }}>
            {subtitle}
          </div>
        </div>
        <div style={{ display: "flex", fontSize: 22, color: "#555555" }}>maily.cfd</div>
      </div>
    ),
    OG_SIZE,
  );
}
