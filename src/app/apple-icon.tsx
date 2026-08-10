import { ImageResponse } from "next/og";

export const size = {
  width: 180,
  height: 180
};

export const contentType = "image/png";

export default function AppleIcon() {
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
            width: 132,
            height: 132,
            borderRadius: 28,
            border: "4px solid rgba(249, 247, 242, 0.3)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 52,
            fontWeight: 800,
            letterSpacing: 2
          }}
        >
          OD
        </div>
      </div>
    ),
    size
  );
}
