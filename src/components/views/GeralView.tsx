import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { ArrowRight } from "lucide-react";
import { Bar, BarChart, CartesianGrid, Cell, ComposedChart, Legend, Line, LabelList, ResponsiveContainer, Tooltip as RTooltip, XAxis, YAxis } from "recharts";
import { useAi } from "@/components/ai/ai-store";
import { AskButton, ChartBox, ChartTip, COR, EIXO, Kpi, KpiStrip, Panel, type Delta } from "@/components/aurora/kit";
import { DADOS, INSIGHTS } from "@/lib/aurora-data";
import { brlCompact, dec, mesLabel, pct, pp } from "@/lib/format";
import { ganhoSimulado, lojaCurta, type Insight } from "@/lib/insights";
import { cn } from "@/lib/utils";

const PONTO = { risco: "bg-danger", atencao: "bg-warning", info: "bg-cat-3" } as const;

/** Variação do último mês contra o anterior. `bomSe` diz qual direção é favorável. */
function variacao(atual: number, anterior: number, tipo: "rel" | "pp", bomSe: "alta" | "queda"): Delta {
  const d = tipo === "rel" ? (anterior ? (100 * (atual - anterior)) / anterior : 0) : atual - anterior;
  const sobe = d >= 0;
  const texto = tipo === "rel" ? `${sobe ? "+" : "−"}${dec(Math.abs(d), 1)}%` : pp(d, 2);
  return { texto, sobe, bom: bomSe === "alta" ? sobe : !sobe };
}

function perguntaDoInsight(i: Insight): string {
  const pior = [...DADOS.lojas].sort((a, b) => b.perda_pct_receita - a.perda_pct_receita)[0];
  switch (i.id) {
    case "ruptura-concentrada":
      return "Quais 15 SKUs concentram a venda perdida?";
    case "compra-em-excesso":
      return `Por que a perda do ${lojaCurta(pior.nome)} é alta?`;
    case "itens-de-trafego":
      return "Quais SKUs classe A têm a menor margem real?";
    case "loja-ruptura":
      return "Qual loja tem a maior venda perdida?";
    case "perecíveis":
      return "Perda por categoria";
    case "caixas":
      return "Onde falta caixa?";
    default:
      return "Alertas R1";
  }
}

export function GeralView() {
  const { meta, kpisMensais: km, categorias } = DADOS;
  const r = meta.resumo;
  const serie = (k: keyof (typeof km)[number]) => km.map((m) => m[k] as number);
  const u = km[km.length - 1];
  const a = km[km.length - 2];
  const vs = `vs ${mesLabel(a.mes)}`;

  const mensal = km.map((m) => ({ mes: m.mes, receita: m.receita / 1e6, margemReal: m.margem_real_pct }));
  const ponte = [
    { nome: "Margem bruta", base: 0, valor: r.margem_bruta_pct, cor: COR.azul, rotulo: pct(r.margem_bruta_pct) },
    { nome: "Perdas", base: r.margem_real_pct, valor: r.margem_bruta_pct - r.margem_real_pct, cor: COR.perigo, rotulo: pp(r.margem_real_pct - r.margem_bruta_pct) },
    { nome: "Margem real", base: 0, valor: r.margem_real_pct, cor: COR.verde, rotulo: pct(r.margem_real_pct) },
  ];
  const cats = [...categorias].sort((a2, b) => b.receita - a2.receita).map((c) => ({ categoria: c.categoria, bruta: c.margem_bruta_pct, real: c.margem_real_pct }));

  return (
    <div className="space-y-4 2xl:space-y-5">
      <KpiStrip>
        <Kpi label="Receita" valor={brlCompact(r.receita)} delta={variacao(u.receita, a.receita, "rel", "alta")} sub={vs} spark={serie("receita")} info="Receita dos 12 meses, quatro lojas." ask="Como evoluiu a receita por mês?" />
        <Kpi label="Margem bruta" valor={pct(r.margem_bruta_pct)} delta={variacao(u.margem_bruta_pct, a.margem_bruta_pct, "pp", "alta")} sub={vs} spark={serie("margem_bruta_pct")} info="Receita menos custo da mercadoria vendida." ask="Margem bruta por categoria" />
        <Kpi label="Margem real" valor={pct(r.margem_real_pct)} destaque delta={variacao(u.margem_real_pct, a.margem_real_pct, "pp", "alta")} sub={`${pp(r.margem_real_pct - r.margem_bruta_pct)} pelas perdas`} spark={serie("margem_real_pct")} info="(Receita − CMV − perda a custo) ÷ receita. É a métrica central do painel." ask="Por que a margem real é menor que a bruta?" />
        <Kpi label="Perdas" valor={pct(r.perda_pct_receita, 2)} tom="ruim" delta={variacao(u.perda_pct_receita, a.perda_pct_receita, "pp", "queda")} sub={`${brlCompact(r.perda_custo)} a custo`} spark={serie("perda_pct_receita")} info="Vencimento, avaria, furto e quebra operacional, valorizados a custo." ask="Qual loja tem a maior perda?" />
        <Kpi label="Ruptura" valor={pct(r.taxa_ruptura_pct, 2)} tom="ruim" delta={variacao(u.taxa_ruptura_pct, a.taxa_ruptura_pct, "pp", "queda")} sub={`Classe A: ${pct(r.taxa_ruptura_A_pct, 2)}`} spark={serie("taxa_ruptura_pct")} info="SKU-loja-dias com demanda não atendida ÷ SKU-loja-dias com loja aberta." ask="Ruptura por dia da semana" />
        <Kpi label="Venda perdida" valor={brlCompact(r.venda_perdida)} tom="ruim" delta={variacao(u.venda_perdida, a.venda_perdida, "rel", "queda")} sub={`${pct(r.venda_perdida_pct_receita, 2)} da receita`} spark={serie("venda_perdida")} info="Unidades não atendidas × preço × 0,75 (premissa: 25% dos clientes levam outro item)." ask="Quais SKUs concentram a venda perdida?" />
      </KpiStrip>

      <div className="grid gap-4 xl:grid-cols-12 2xl:gap-5">
        <Panel title="Receita e margem real por mês" className="xl:col-span-8" summary="barras: receita (R$ mi) · linha: margem real (%)" ask="Como evoluiu a margem real por mês?">
          <ChartBox height={340}>
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={mensal} margin={{ top: 8, right: 8, bottom: 0, left: -8 }}>
                <defs>
                  <linearGradient id="gRec" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="hsl(207 66% 40%)" stopOpacity={0.55} />
                    <stop offset="100%" stopColor="hsl(207 66% 40%)" stopOpacity={0.12} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke={COR.grade} vertical={false} />
                <XAxis dataKey="mes" tickFormatter={mesLabel} tick={EIXO} tickLine={false} axisLine={false} />
                <YAxis yAxisId="l" tick={EIXO} tickLine={false} axisLine={false} tickFormatter={(v: number) => dec(v, 0)} />
                <YAxis yAxisId="r" orientation="right" domain={[22, 28]} tick={EIXO} tickLine={false} axisLine={false} tickFormatter={(v: number) => `${dec(v, 0)}%`} />
                <RTooltip content={<ChartTip titulo={(l) => mesLabel(String(l))} formato={(v, n) => (n === "Receita" ? `R$ ${dec(v, 2)} mi` : pct(v, 2))} />} />
                <Bar yAxisId="l" dataKey="receita" name="Receita" fill="url(#gRec)" radius={[4, 4, 0, 0]} maxBarSize={56} />
                <Line yAxisId="r" type="monotone" dataKey="margemReal" name="Margem real" stroke={COR.verde} strokeWidth={2.6} dot={{ r: 3.5, strokeWidth: 2, fill: "var(--card)" }} activeDot={{ r: 5 }} isAnimationActive={false} />
              </ComposedChart>
            </ResponsiveContainer>
          </ChartBox>
        </Panel>

        <Panel title="Ponte da margem" className="xl:col-span-4" summary={`${brlCompact(r.perda_custo)} perdidos`} info="Quanto da margem bruta sobra depois das perdas. A venda perdida por ruptura não entra aqui: é receita que nunca aconteceu." ask="Por que a margem real é menor que a bruta?">
          <ChartBox height={340}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={ponte} margin={{ top: 22, right: 8, bottom: 0, left: -18 }}>
                <CartesianGrid stroke={COR.grade} vertical={false} />
                <XAxis dataKey="nome" tick={EIXO} tickLine={false} axisLine={false} />
                <YAxis domain={[0, 30]} tick={EIXO} tickLine={false} axisLine={false} tickFormatter={(v: number) => `${v}%`} />
                <Bar dataKey="base" stackId="p" fill="transparent" isAnimationActive={false} />
                <Bar dataKey="valor" stackId="p" radius={[4, 4, 0, 0]} isAnimationActive={false}>
                  {ponte.map((p) => (
                    <Cell key={p.nome} fill={p.cor} />
                  ))}
                  <LabelList dataKey="rotulo" position="top" style={{ fontSize: 12, fontWeight: 600, fill: "var(--foreground)" }} />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </ChartBox>
        </Panel>
      </div>

      <div className="grid gap-4 xl:grid-cols-12 2xl:gap-5">
        <Panel title="Margem bruta × real por categoria" className="xl:col-span-7" summary="ordenadas por receita" ask="Quais categorias perdem mais margem?">
          <ChartBox height={420}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={cats} layout="vertical" margin={{ top: 0, right: 16, bottom: 0, left: 8 }} barCategoryGap={6}>
                <CartesianGrid stroke={COR.grade} horizontal={false} />
                <XAxis type="number" tick={EIXO} tickLine={false} axisLine={false} tickFormatter={(v: number) => `${v}%`} />
                <YAxis type="category" dataKey="categoria" width={140} tick={EIXO} tickLine={false} axisLine={false} />
                <RTooltip content={<ChartTip formato={(v) => pct(v)} />} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Bar dataKey="bruta" name="Margem bruta" fill={COR.azul} fillOpacity={0.4} radius={[0, 3, 3, 0]} isAnimationActive={false} />
                <Bar dataKey="real" name="Margem real" fill={COR.verde} radius={[0, 3, 3, 0]} isAnimationActive={false} />
              </BarChart>
            </ResponsiveContainer>
          </ChartBox>
        </Panel>

        <Sinais />
      </div>

      <Simulador />
    </div>
  );
}

function Sinais() {
  const ai = useAi();
  return (
    <Panel title="Sinais para agir" className="xl:col-span-5" summary="clique para perguntar">
      <ul className="divide-y">
        {INSIGHTS.map((i) => (
          <li key={i.id} className="group flex items-start gap-3 py-3 first:pt-0 last:pb-0">
            <span className={cn("mt-1.5 size-2.5 shrink-0 rounded-full", PONTO[i.tom])} aria-hidden />
            <button type="button" onClick={() => ai.perguntar(perguntaDoInsight(i))} className="min-w-0 flex-1 text-left">
              <p className="text-[13.5px] font-semibold leading-snug text-foreground group-hover:text-primary">{i.titulo}</p>
              <p className="mt-0.5 line-clamp-2 text-[12px] leading-snug text-muted-foreground">{i.texto}</p>
            </button>
            <div className="flex shrink-0 items-center gap-0.5">
              <AskButton pergunta={perguntaDoInsight(i)} />
              <Link to="/" search={{ view: i.view }} aria-label={`Abrir tela: ${i.titulo}`} className="inline-flex size-6 items-center justify-center rounded-md text-muted-foreground hover:bg-secondary hover:text-foreground">
                <ArrowRight className="size-3.5" aria-hidden />
              </Link>
            </div>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

function Simulador() {
  const [recupera, setRecupera] = useState(30);
  const [reduz, setReduz] = useState(20);
  const g = ganhoSimulado(DADOS, recupera, reduz);
  const r = DADOS.meta.resumo;
  return (
    <Panel title="Quanto vale agir" summary="simulador" info="Estimativa simples: venda recuperada rende a margem bruta média da rede; perda evitada economiza o custo. Sem efeitos de segunda ordem." ask="Simule recuperar 30% da venda perdida e reduzir 20% da perda">
      <div className="grid items-center gap-6 md:grid-cols-3">
        <label className="block text-xs">
          <span className="flex justify-between text-[13px] font-medium text-foreground">
            Recuperar da venda perdida <span className="tabular-nums text-primary">{recupera}%</span>
          </span>
          <input type="range" min={0} max={80} step={5} value={recupera} onChange={(e) => setRecupera(Number(e.target.value))} className="mt-2 w-full" />
          <span className="mt-1 block text-[11px] text-muted-foreground">Venda perdida atual: {brlCompact(r.venda_perdida)}</span>
        </label>
        <label className="block text-xs">
          <span className="flex justify-between text-[13px] font-medium text-foreground">
            Reduzir a perda <span className="tabular-nums text-primary">{reduz}%</span>
          </span>
          <input type="range" min={0} max={60} step={5} value={reduz} onChange={(e) => setReduz(Number(e.target.value))} className="mt-2 w-full" />
          <span className="mt-1 block text-[11px] text-muted-foreground">Perda atual: {brlCompact(r.perda_custo)} a custo</span>
        </label>
        <div className="rounded-xl bg-primary p-4 text-primary-foreground">
          <p className="text-[12px] font-medium text-primary-foreground/70">Ganho estimado por ano</p>
          <p className="mt-0.5 font-display text-[34px] font-semibold leading-tight">{brlCompact(g.total)}</p>
          <p className="text-[12px] text-primary-foreground/80">
            Margem real de {pct(r.margem_real_pct)} para {pct(r.margem_real_pct + g.ppMargem)} ({dec(g.ppMargem, 2)} p.p.)
          </p>
        </div>
      </div>
    </Panel>
  );
}
