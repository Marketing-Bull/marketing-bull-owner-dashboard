import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Marketing Bull Owner Dashboard",
    short_name: "Owner Dashboard",
    description: "Single-screen daily command center for Alex.",
    start_url: "/",
    display: "standalone",
    background_color: "#f4efe4",
    theme_color: "#123227",
    orientation: "portrait",
    icons: [
      {
        src: "/icon-192.png",
        sizes: "192x192",
        type: "image/png"
      },
      {
        src: "/icon-512.png",
        sizes: "512x512",
        type: "image/png"
      },
      {
        src: "/icon-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable"
      }
    ]
  };
}
