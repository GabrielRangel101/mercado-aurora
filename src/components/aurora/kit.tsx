import { useEffect, useState, type ReactNode } from "react";
import { ArrowDownRight, ArrowUpRight, Info, Sparkles } from "lucide-react";
import { Line, LineChart, ResponsiveContainer } from "recharts";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useAi } from "@/components/ai/ai-store";
import { cn } from "@/lib/utils";

/** Cores das séries (variáveis CSS do tema). */
export const COR = {
  verde: "var(--cat-1)",
  laranja: "var(--cat-2)",
  azul: "var(--cat-3)",
  magenta: "var(--cat-4)",
  dourado: "var(--cat-5)",
  cinza: "var(--cat-6)",
  grade: "var(--chart-grid)",
  texto: "var(--muted-foreground)",
  perigo: "var(--danger)",
  positivo: "var(--positive-fill)",
} as const;

/** Uma cor por loja, na ordem do id (1..4). */
export const COR_LOJA = [COR.verde, COR.laranja, COR.azul, COR.magenta];

export const EIXO = { fontSize: 11, fill: "var(--muted-foreground)" } as const;

export function useMounted(): boolean {
  const [ok, setOk] = useState(false);
  useEffect(() => setOk(true), []);
  return ok;
}

/** Carrega um módulo (JSON grande) sob demanda, só no navegador. */
export function useLazy<T>(loader: () => Promise<T>): T | null {
  const [data, setData] = useState<T | null>(null);
  useEffect(() => {
    let vivo = true;
    loader().then((v) => {
      if (vivo) setData(v);
    });
    return () => {
      vivo = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return data;
}

/** Área de gráfico com altura fixa. Recharts só monta no cliente (evita descompasso de hidratação). */
export function ChartBox({ height = 260, children }: { height?: number; children: ReactNode }) {
  const mounted = useMounted();
  return (
    <div style={{ height }} className="w-full min-w-0">
      {mounted ? children : <div className="h-full w-full animate-pulse rounded-md bg-muted/50" aria-hidden />}
    </div>
  );
}

export function InfoTip({ text }: { text: ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button type="button" aria-label="Mais informações" className="inline-flex size-4 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:text-foreground">
          <Info className="size-3.5" aria-hidden />
        </button>
      </TooltipTrigger>
      <TooltipContent className="max-w-72 text-xs leading-relaxed">{text}</TooltipContent>
    </Tooltip>
  );
}

/** Botão ✦ que abre o Modo IA já com uma pergunta sobre o gráfico. */
export function AskButton({ pergunta, className }: { pergunta: string; className?: string }) {
  const ai = useAi();
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button type="button" onClick={() => ai.perguntar(pergunta)} aria-label={`Perguntar ao Modo IA: ${pergunta}`} className={cn("inline-flex size-6 shrink-0 items-center justify-center rounded-md text-brand/80 transition-colors hover:bg-brand/12 hover:text-brand", className)}>
          <Sparkles className="size-3.5" aria-hidden />
        </button>
      </TooltipTrigger>
      <TooltipContent className="max-w-64 text-xs">{pergunta}</TooltipContent>
    </Tooltip>
  );
}

export function Panel({
  title,
  info,
  summary,
  actions,
  ask,
  className,
  children,
}: {
  title: string;
  info?: ReactNode;
  summary?: ReactNode;
  actions?: ReactNode;
  /** pergunta sugerida ao Modo IA para este painel */
  ask?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section className={cn("dash-card flex min-w-0 flex-col gap-3 p-4 2xl:p-5", className)}>
      <header className="flex min-h-7 flex-wrap items-center gap-2">
        <h2 className="font-display text-[15px] font-semibold tracking-tight text-foreground">{title}</h2>
        {info && <InfoTip text={info} />}
        <div className="ml-auto flex min-w-0 items-center gap-2">
          {summary && <span className="min-w-0 truncate text-xs tabular-nums text-muted-foreground">{summary}</span>}
          {actions}
          {ask && <AskButton pergunta={ask} />}
        </div>
      </header>
      <div className="min-w-0 flex-1">{children}</div>
    </section>
  );
}

export function Segmented<T extends string>({ value, options, onChange, label }: { value: T; options: readonly { value: T; label: string }[]; onChange: (v: T) => void; label: string }) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex shrink-0 rounded-md border bg-background/50 p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          onClick={() => onChange(o.value)}
          className={cn("rounded px-2 py-0.5 text-[11px] font-medium transition-colors", o.value === value ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground")}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export interface MetaKpi {
  texto: string;
  status: "ok" | "atencao" | "ruim";
}

export interface Delta {
  texto: string;
  /** true = mudança favorável */
  bom: boolean;
  sobe: boolean;
}

/** Faixa única de indicadores: um cartão, células separadas por linha fina. */
export function KpiStrip({ children, className }: { children: ReactNode; className?: string }) {
  return <section className={cn("dash-card grid grid-cols-2 gap-px overflow-hidden bg-border p-0 md:grid-cols-3 xl:grid-cols-6", className)}>{children}</section>;
}

export function Kpi({
  label,
  valor,
  sub,
  tom = "neutro",
  info,
  spark,
  destaque,
  delta,
  meta,
  ask,
}: {
  label: string;
  valor: string;
  sub?: ReactNode;
  tom?: "neutro" | "bom" | "ruim";
  info?: ReactNode;
  spark?: number[];
  destaque?: boolean;
  delta?: Delta;
  meta?: MetaKpi;
  ask?: string;
}) {
  const dados = spark?.map((v, i) => ({ i, v }));
  const cor = tom === "ruim" ? COR.perigo : tom === "bom" ? COR.positivo : COR.verde;
  return (
    <article className={cn("group relative flex min-w-0 flex-col gap-1.5 bg-card p-4 2xl:p-5", destaque && "bg-primary text-primary-foreground")}>
      <div className="flex items-center gap-1">
        <h3 className={cn("truncate text-[12px] font-medium", destaque ? "text-primary-foreground/75" : "text-muted-foreground")}>{label}</h3>
        {info && !destaque && <InfoTip text={info} />}
        {ask && <AskButton pergunta={ask} className={cn("ml-auto opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100", destaque && "text-primary-foreground hover:bg-white/15 hover:text-primary-foreground")} />}
      </div>
      <p className="truncate font-display text-[30px] font-semibold leading-none tracking-tight 2xl:text-[34px]">{valor}</p>
      <div className="flex min-h-9 items-end justify-between gap-2">
        <div className="min-w-0 space-y-1">
          {delta && (
            <p className={cn("inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[11px] font-semibold tabular-nums", destaque ? "bg-white/15 text-primary-foreground" : delta.bom ? "bg-positive/12 text-positive" : "bg-danger/12 text-danger")}>
              {delta.sobe ? <ArrowUpRight className="size-3" aria-hidden /> : <ArrowDownRight className="size-3" aria-hidden />}
              {delta.texto}
            </p>
          )}
          {meta && (
            <p className={cn("flex items-center gap-1.5 text-[11px] font-medium", destaque ? "text-primary-foreground/90" : "text-foreground")}>
              <span className={cn("size-2 shrink-0 rounded-full", meta.status === "ok" ? "bg-positive-fill" : meta.status === "atencao" ? "bg-cat-5" : "bg-danger")} aria-hidden />
              {meta.texto}
            </p>
          )}
          {sub && <p className={cn("text-[11px] leading-snug", destaque ? "text-primary-foreground/70" : "text-muted-foreground")}>{sub}</p>}
        </div>
        {dados && (
          <div className="w-20 shrink-0" aria-hidden>
            <div className="h-9">
              <MiniLine dados={dados} cor={destaque ? "hsl(26 95% 62%)" : cor} />
            </div>
            <p className={cn("text-right text-[9px]", destaque ? "text-primary-foreground/60" : "text-muted-foreground")}>12 meses</p>
          </div>
        )}
      </div>
    </article>
  );
}

function MiniLine({ dados, cor }: { dados: { i: number; v: number }[]; cor: string }) {
  const mounted = useMounted();
  if (!mounted) return null;
  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={dados} margin={{ top: 3, right: 2, bottom: 3, left: 2 }}>
        <Line type="monotone" dataKey="v" stroke={cor} strokeWidth={1.6} dot={false} isAnimationActive={false} />
      </LineChart>
    </ResponsiveContainer>
  );
}

/** Tooltip padrão dos gráficos. */
export function ChartTip({
  active,
  payload,
  label,
  formato,
  titulo,
}: {
  active?: boolean;
  payload?: { name?: string; value?: number | string; color?: string; dataKey?: string }[];
  label?: string | number;
  formato?: (v: number, nome: string) => string;
  titulo?: (l: string | number | undefined) => string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="glass-tip rounded-md border bg-popover px-2.5 py-1.5 text-xs shadow-md">
      {label !== undefined && <p className="mb-1 font-medium text-foreground">{titulo ? titulo(label) : String(label)}</p>}
      <ul className="space-y-0.5">
        {payload
          .filter((p) => p.value !== undefined && p.value !== null)
          .map((p, i) => (
            <li key={`${p.dataKey ?? p.name}-${i}`} className="flex items-center gap-1.5 tabular-nums">
              <span className="size-2 shrink-0 rounded-full" style={{ background: p.color }} aria-hidden />
              <span className="text-muted-foreground">{p.name}</span>
              <span className="ml-auto pl-3 font-medium text-foreground">{typeof p.value === "number" && formato ? formato(p.value, p.name ?? "") : String(p.value)}</span>
            </li>
          ))}
      </ul>
    </div>
  );
}

/** 0 = ruim (vermelho), 0.5 = atenção (âmbar), 1 = bom (verde). */
export function heatColor(t: number): string {
  const x = Math.max(0, Math.min(1, t));
  const hue = x < 0.5 ? 6 + (x / 0.5) * 34 : 40 + ((x - 0.5) / 0.5) * 112;
  const alpha = 0.16 + Math.abs(x - 0.5) * 0.7;
  return `hsl(${hue.toFixed(0)} 62% 42% / ${alpha.toFixed(2)})`;
}

export interface HeatCell {
  texto: string;
  /** 0..1, onde 1 é o melhor. Omitir deixa a célula sem cor. */
  t?: number;
  dica?: string;
}

/** Grade de calor: linhas x colunas, com valores já formatados. */
export function HeatGrid({ cols, rows, corner, colWidth = "5.5rem" }: { cols: string[]; rows: { label: string; cells: HeatCell[] }[]; corner?: string; colWidth?: string }) {
  return (
    <div className="overflow-x-auto scrollbar-thin">
      <table className="w-full border-separate border-spacing-0.5 text-xs tabular-nums">
        <thead>
          <tr>
            <th className="px-1 py-1 text-left text-[10px] font-medium uppercase tracking-wider text-muted-foreground">{corner}</th>
            {cols.map((c) => (
              <th key={c} style={{ minWidth: colWidth }} className="px-1 py-1 text-center text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.label}>
              <th scope="row" className="whitespace-nowrap px-1 py-1 text-left font-medium text-foreground">
                {r.label}
              </th>
              {r.cells.map((c, i) => (
                <td key={i} title={c.dica} style={c.t === undefined ? undefined : { background: heatColor(c.t) }} className="rounded px-1 py-1.5 text-center text-foreground">
                  {c.texto}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export interface BarItem {
  label: ReactNode;
  value: number;
  texto: string;
  cor?: string;
  sub?: ReactNode;
}

/** Lista de barras horizontais em HTML puro (leve e legível em tela pequena). */
export function BarList({ items, max }: { items: BarItem[]; max?: number }) {
  const teto = max ?? Math.max(...items.map((i) => i.value), 0.0001);
  return (
    <ul className="space-y-2">
      {items.map((it, idx) => (
        <li key={idx} className="min-w-0">
          <div className="flex items-baseline justify-between gap-3 text-xs">
            <span className="min-w-0 truncate text-foreground">{it.label}</span>
            <span className="shrink-0 font-medium tabular-nums text-foreground">{it.texto}</span>
          </div>
          <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted/70">
            <div className="h-full rounded-full" style={{ width: `${Math.max(1.5, (100 * Math.abs(it.value)) / teto)}%`, background: it.cor ?? COR.verde }} />
          </div>
          {it.sub && <p className="mt-0.5 text-[10px] text-muted-foreground">{it.sub}</p>}
        </li>
      ))}
    </ul>
  );
}

export function Nota({ children }: { children: ReactNode }) {
  return <p className="text-[11px] leading-relaxed text-muted-foreground">{children}</p>;
}

export function Tag({ children, tom = "neutro" }: { children: ReactNode; tom?: "neutro" | "risco" | "atencao" | "ok" }) {
  const cls = {
    neutro: "bg-muted text-muted-foreground",
    risco: "bg-danger/15 text-danger",
    atencao: "bg-warning/15 text-warning",
    ok: "bg-positive/15 text-positive",
  }[tom];
  return <span className={cn("inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide", cls)}>{children}</span>;
}
