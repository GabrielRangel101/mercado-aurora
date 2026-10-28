import { DADOS } from "@/lib/aurora-data";
import { useEffect, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { Bell, LayoutDashboard, PackageX, Percent, ShoppingBasket, Sparkles, Store, Trash2 } from "lucide-react";
import { AiPanel } from "@/components/ai/AiPanel";
import { useAi } from "@/components/ai/ai-store";
import { cn } from "@/lib/utils";
import type { ViewId } from "@/lib/insights";

export const VIEWS: { id: ViewId; label: string; titulo: string; sub: string; Icon: typeof Bell }[] = [
  { id: "geral", label: "Visão geral", titulo: "Visão geral da rede", sub: "Onde a margem aparece e onde ela escapa", Icon: LayoutDashboard },
  { id: "margem", label: "Margem", titulo: "Margem e curva ABC", sub: "Quem paga a conta e quem só gira", Icon: Percent },
  { id: "ruptura", label: "Ruptura", titulo: "Ruptura e venda perdida", sub: "O que faltou na gôndola e quanto custou", Icon: PackageX },
  { id: "perdas", label: "Perdas", titulo: "Perdas e giro", sub: "Quebra, vencimento e estoque parado", Icon: Trash2 },
  { id: "lojas", label: "Lojas e caixas", titulo: "Lojas e caixas", sub: "Comparativo entre unidades e escala por hora", Icon: Store },
  { id: "cesta", label: "Cesta", titulo: "Cesta de compras", sub: "O que sai junto e por quê", Icon: ShoppingBasket },
  { id: "alertas", label: "Alertas", titulo: "Alertas automáticos", sub: "O que a automação mandaria ao gerente", Icon: Bell },
];

export function Logo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" className={className} role="img" aria-label="Mercado Aurora">
      <rect width="64" height="64" rx="14" fill="#14523e" />
      <path d="M12 44a20 20 0 0 1 40 0" fill="none" stroke="#f6efe0" strokeWidth="5" strokeLinecap="round" />
      <path d="M21 44a11 11 0 0 1 22 0" fill="none" stroke="#f08a1c" strokeWidth="5" strokeLinecap="round" />
      <line x1="10" y1="51" x2="54" y2="51" stroke="#f6efe0" strokeWidth="4" strokeLinecap="round" />
    </svg>
  );
}

export function AppShell({ view, periodo, children }: { view: ViewId; periodo: string; children: ReactNode }) {
  const ai = useAi();
  const atual = VIEWS.find((v) => v.id === view) ?? VIEWS[0];

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        ai.alternar();
      }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [ai]);

  return (
    <div className="min-h-screen">
      {/* barra lateral (desktop) */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-56 flex-col bg-[var(--side-bg)] px-3 py-4 text-[var(--side-fg)] xl:flex">
        <Link to="/" search={{ view: "geral" }} className="mb-6 flex items-center gap-2.5 px-2">
          <Logo className="size-9" />
          <div className="leading-tight">
            <p className="font-display text-[17px] font-semibold tracking-tight text-white">Mercado Aurora</p>
            <p className="text-[10px] tracking-wide text-[var(--side-muted)]">Radar de margem</p>
          </div>
        </Link>
        <nav aria-label="Telas do dashboard" className="flex flex-col gap-0.5">
          {VIEWS.map((v) => (
            <NavLink key={v.id} v={v} on={v.id === view} />
          ))}
        </nav>
        <button
          type="button"
          onClick={ai.alternar}
          aria-pressed={ai.aberto}
          className={cn("mt-6 flex items-center gap-2.5 rounded-lg px-3 py-2.5 text-left text-[13px] font-semibold transition-colors", ai.aberto ? "bg-[var(--brand)] text-white" : "bg-white/8 text-white hover:bg-white/14")}
        >
          <Sparkles className="size-4 shrink-0" aria-hidden />
          <span className="flex-1">Modo IA</span>
          <kbd className="rounded bg-black/25 px-1.5 py-0.5 font-sans text-[10px] font-medium text-white/80">Ctrl K</kbd>
        </button>
        <div className="mt-auto space-y-1 px-2 text-[11px] leading-snug text-[var(--side-muted)]">
          <p className="font-medium text-[var(--side-fg)]">{periodo}</p>
          <p>Rede fictícia de 4 lojas. Dados sintéticos gerados em Python.</p>
          {DADOS.meta.versao_dados && <p>Dados {DADOS.meta.versao_dados}</p>}
        </div>
      </aside>

      <div className={cn("min-h-screen transition-[padding] duration-200 xl:pl-56", ai.aberto && "xl:pr-[26.5rem]")}>
        {/* topo */}
        <header className="sticky top-0 z-20 border-b bg-background/90 backdrop-blur">
          <div className="flex items-center gap-3 px-4 py-3 lg:px-6 2xl:px-8">
            <Link to="/" search={{ view: "geral" }} className="shrink-0 xl:hidden" aria-label="Mercado Aurora">
              <Logo className="size-8" />
            </Link>
            <div className="min-w-0">
              <h1 className="truncate font-display text-[20px] font-semibold leading-tight tracking-tight text-foreground 2xl:text-[22px]">{atual.titulo}</h1>
              <p className="hidden truncate text-[12px] text-muted-foreground sm:block">{atual.sub}</p>
            </div>
            <span className="ml-auto hidden shrink-0 items-center gap-1.5 rounded-full border border-warning/40 bg-warning/10 px-2.5 py-1 text-[11px] font-semibold text-warning sm:inline-flex" title="Rede fictícia: marcas, lojas e números são inventados">
              <span className="size-1.5 rounded-full bg-warning" aria-hidden />
              Dados sintéticos · rede fictícia
            </span>
            <button
              type="button"
              onClick={ai.abrir}
              className="ml-3 hidden min-w-0 max-w-sm flex-1 items-center gap-2 rounded-lg border bg-card px-3 py-2 text-left text-[13px] text-muted-foreground shadow-sm transition-colors hover:border-[var(--brand)] md:flex"
            >
              <Sparkles className="size-4 shrink-0 text-brand" aria-hidden />
              <span className="truncate">Pergunte aos dados…</span>
            </button>
            <button type="button" onClick={ai.alternar} aria-pressed={ai.aberto} className={cn("ml-auto inline-flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-2 text-[13px] font-semibold sm:ml-0", ai.aberto ? "bg-brand text-brand-foreground" : "bg-primary text-primary-foreground")}>
              <Sparkles className="size-4" aria-hidden />
              <span className="hidden sm:inline">Modo IA</span>
            </button>
          </div>
          <div id="barra-filtros" />
          <nav aria-label="Telas do dashboard" className="scrollbar-thin flex gap-1 overflow-x-auto px-4 pb-2 xl:hidden">
            {VIEWS.map((v) => (
              <Link
                key={v.id}
                to="/"
                search={{ view: v.id }}
                aria-current={v.id === view ? "page" : undefined}
                className={cn("shrink-0 whitespace-nowrap rounded-md px-3 py-1.5 text-[13px] font-medium transition-colors", v.id === view ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-secondary hover:text-foreground")}
              >
                {v.label}
              </Link>
            ))}
          </nav>
        </header>

        <main className="px-4 py-5 lg:px-6 2xl:px-8">{children}</main>
        <footer className="px-4 pb-8 pt-1 text-[11px] leading-relaxed text-muted-foreground lg:px-6 2xl:px-8">
          Marcas, lojas e números são inventados: o gerador (Python, seed fixa) simula o estoque dia a dia, e a ruptura e a perda nascem dessa simulação. Catálogo de 280 SKUs, lift alto nas cestas (missões de compra) e causas de ruptura atribuídas por regra são simplificações de um conjunto sintético, não retrato de uma loja real.
        </footer>
      </div>

      <AiPanel />
    </div>
  );
}

function NavLink({ v, on }: { v: (typeof VIEWS)[number]; on: boolean }) {
  return (
    <Link
      to="/"
      search={{ view: v.id }}
      aria-current={on ? "page" : undefined}
      className={cn("relative flex items-center gap-2.5 rounded-lg px-3 py-2 text-[13px] font-medium transition-colors", on ? "bg-white/12 text-white" : "text-[var(--side-fg)] hover:bg-white/7 hover:text-white")}
    >
      {on && <span className="absolute inset-y-1.5 left-0 w-0.5 rounded-full bg-[var(--brand)]" aria-hidden />}
      <v.Icon className="size-4 shrink-0 opacity-90" aria-hidden />
      {v.label}
    </Link>
  );
}
