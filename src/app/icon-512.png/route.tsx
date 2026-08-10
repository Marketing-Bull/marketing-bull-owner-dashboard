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
          background: "linear-gradient(135deg, #123227 0%, #1f6f52 52%, #f4efe4 100%)",
          color: "#f9f7f2",
          fontFamily: "sans-serif"
        }}
      >
        <div
          style={{
            width: 360,
            height: 360,
            borderRadius: 72,
            border: "10px solid rgba(249, 247, 242, 0.35)",
            background: "rgba(18, 50, 39, 0.42)",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: 12
          }}
        >
          <div style={{ fontSize: 56, letterSpacing: 10, textTransform: "uppercase", opacity: 0.82 }}>MB</div>
          <div style={{ fontSize: 118, fontWeight: 800, lineHeight: 1 }}>OD</div>
          <div style={{ fontSize: 30, letterSpacing: 4, textTransform: "uppercase", opacity: 0.85 }}>
            Dashboard
          </div>
        </div>
      </div>
    ),
    {
      width: 512,
      height: 512
    }
  );
}
