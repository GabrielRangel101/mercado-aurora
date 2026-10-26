import { createFileRoute } from "@tanstack/react-router";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AppShell } from "@/components/shell/AppShell";
import { AlertasView } from "@/components/views/AlertasView";
import { CestaView } from "@/components/views/CestaView";
import { GeralView } from "@/components/views/GeralView";
import { LojasView } from "@/components/views/LojasView";
import { MargemView } from "@/components/views/MargemView";
import { PerdasView } from "@/components/views/PerdasView";
import { RupturaView } from "@/components/views/RupturaView";
import { DADOS, parseView } from "@/lib/aurora-data";
import type { ViewId } from "@/lib/insights";
import { mesLabel } from "@/lib/format";

export const Route = createFileRoute("/")({
  validateSearch: (search: Record<string, unknown>): { view?: ViewId } => ({ view: parseView(search["view"]) }),
  head: () => ({
    meta: [
      { title: "Mercado Aurora · Radar de margem e ruptura" },
      { name: "description", content: "Dashboard de uma rede fictícia de supermercados: margem real, curva ABC, ruptura de estoque, perdas, cesta de compras e alertas, com dados sintéticos." },
      { property: "og:title", content: "Mercado Aurora · Radar de margem e ruptura" },
      { property: "og:description", content: "Onde o supermercado ganha e perde margem: ruptura, perdas, itens de tráfego e alertas automáticos." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Index,
});

const VIEWS = {
  geral: GeralView,
  margem: MargemView,
  ruptura: RupturaView,
  perdas: PerdasView,
  lojas: LojasView,
  cesta: CestaView,
  alertas: AlertasView,
} as const;

const PERIODO = (() => {
  const p = DADOS.meta.periodo;
  return `${mesLabel(p.inicio.slice(0, 7))} a ${mesLabel(p.fim.slice(0, 7))}`;
})();

function Index() {
  const view = Route.useSearch().view ?? "geral";
  const View = VIEWS[view];
  return (
    <TooltipProvider delayDuration={150}>
      <AppShell view={view} periodo={PERIODO}>
        <View />
      </AppShell>
    </TooltipProvider>
  );
}
