import { ImageResponse } from "next/og";

export const runtime = "nodejs";

export async function GET() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#123227",
          color: "#f9f7f2",
          fontFamily: "sans-serif"
        }}
      >
        <div
          style={{
            width: 420,
            height: 420,
            borderRadius: 96,
            border: "12px solid rgba(249, 247, 242, 0.32)",
            background: "linear-gradient(180deg, rgba(31, 111, 82, 0.72), rgba(18, 50, 39, 0.95))",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: 16
          }}
        >
          <div style={{ fontSize: 124, fontWeight: 800, lineHeight: 1 }}>OD</div>
          <div style={{ fontSize: 32, letterSpacing: 6, textTransform: "uppercase", opacity: 0.82 }}>Owner View</div>
        </div>
      </div>
    ),
    {
      width: 512,
      height: 512
    }
  );
}
