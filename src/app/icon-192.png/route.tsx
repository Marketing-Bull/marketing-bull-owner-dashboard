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
          background: "linear-gradient(135deg, #123227 0%, #1f6f52 60%, #f4efe4 100%)",
          color: "#f9f7f2",
          fontFamily: "sans-serif"
        }}
      >
        <div
          style={{
            width: 136,
            height: 136,
            borderRadius: 28,
            border: "4px solid rgba(249, 247, 242, 0.34)",
            background: "rgba(18, 50, 39, 0.4)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 54,
            fontWeight: 800,
            letterSpacing: 2
          }}
        >
          OD
        </div>
      </div>
    ),
    {
      width: 192,
      height: 192
    }
  );
}
