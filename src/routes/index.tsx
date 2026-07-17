import { createFileRoute } from "@tanstack/react-router";
import { useEffect } from "react";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Kun Tartibim" },
      { name: "description", content: "Kun tartibi ilovasi — namoz, ish, sport va dorilar jadvali" },
      { property: "og:title", content: "Kun Tartibim" },
      { property: "og:description", content: "Kun tartibi ilovasi" },
    ],
  }),
  component: Index,
});

function Index() {
  useEffect(() => {
    window.location.replace("/kun-tartibim.html");
  }, []);
  return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#0a0a0f", color: "#f2f2f8", fontFamily: "system-ui" }}>
      Yuklanmoqda…
    </div>
  );
}
