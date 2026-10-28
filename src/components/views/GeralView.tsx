import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Link } from "@tanstack/react-router";
import { ArrowRight, ChevronDown } from "lucide-react";
import { Bar, BarChart, CartesianGrid, Cell, ComposedChart, LabelList, Line, ReferenceLine, ResponsiveContainer, Tooltip as RTooltip, XAxis, YAxis } from "recharts";
import { useAi } from "@/components/ai/ai-store";
import { AskButton, ChartBox, ChartTip, COR, EIXO, Kpi, KpiStrip, Panel, Segmented, Carga, useLazyEstado, type Delta, type MetaKpi } from "@/components/aurora/kit";
import { DADOS, INSIGHTS, LOJAS_CURTAS, loadVendasDiarias } from "@/lib/aurora-data";
import { brlCompact, dec, mesLabel, pct, pp } from "@/lib/format";
import { PERIODOS, ponteMargem, resumir, serieMensal, ultimosMeses, type PeriodoId, type ResumoGeral } from "@/lib/geral";
import { ganhoLiquido, lojaCurta, premissasPadrao, type Insight, type Premissas } from "@/lib/insights";
import { avaliarMeta, METAS, ROTULO_META, type ChaveMeta, type Metas } from "@/lib/metas";
import { cn } from "@/lib/utils";

const COR_SEV = { risco: "bg-danger", atencao: "bg-cat-5", info: "bg-cat-3" } as const;
const ROT_SEV = { risco: "Agir", atencao: "Atenção", info: "Informação" } as const;

function metaKpi(chave: ChaveMeta, valor: number, metas: Metas): MetaKpi {
  const a = avaliarMeta(chave, valor, metas);
  const nome = chave === "margem_real_pct" ? "margem" : "limite";
  return { status: a.status, texto: `Meta ${pct(a.meta, chave === "perda_pct" || chave === "venda_perdida_pct" ? 2 : 1)} · ${pp(a.gap, 2)}${nome === "margem" ? "" : ""}` };
}

function delta(atual: number, ref: number, tipo: "rel" | "pp", bomSe: "alta" | "queda"): Delta {
  const d = tipo === "rel" ? (ref ? (100 * (atual - ref)) / ref : 0) : atual - ref;
  const sobe = d >= 0;
  return { texto: tipo === "rel" ? `${sobe ? "+" : "−"}${dec(Math.abs(d), 1)}%` : pp(d, 2), sobe, bom: bomSe === "alta" ? sobe : !sobe };
}

function resumoRede12(): ResumoGeral {
  const r = DADOS.meta.resumo;
  return { receita: r.receita, margem_bruta_pct: r.margem_bruta_pct, perda_pct: r.perda_pct_receita, perda_custo: r.perda_custo, margem_real_pct: r.margem_real_pct, ruptura_pct: r.taxa_ruptura_pct, venda_perdida: r.venda_perdida, venda_perdida_pct: r.venda_perdida_pct_receita, cupons: r.cupons };
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
    case "loja-margem": {
      const pior = [...DADOS.lojas].sort((a, b) => a.margem_real_pct - b.margem_real_pct)[0];
      return `Por que a margem real do ${lojaCurta(pior.nome)} é baixa?`;
    }
    default:
      return "Alertas R1";
  }
}

export function GeralView() {
  const [loja, setLoja] = useState(0);
  const [periodo, setPeriodo] = useState<PeriodoId>("12m");
  const [metas, setMetas] = useState<Metas>({ ...METAS });
  const { data: diarias, erro: erroDiarias, recarregar } = useLazyEstado(loadVendasDiarias);

  const serie = useMemo(() => serieMensal(DADOS, diarias, loja), [diarias, loja]);
  const serieRede = useMemo(() => serieMensal(DADOS, null, 0), []);
  const sel = useMemo(() => ultimosMeses(serie, periodo), [serie, periodo]);
  const selRede = useMemo(() => ultimosMeses(serieRede, periodo), [serieRede, periodo]);
  const carregando = loja > 0 && !diarias;

  const res = useMemo(() => (loja === 0 && periodo === "12m" ? resumoRede12() : resumir(sel)), [loja, periodo, sel]);
  const res12 = useMemo(() => (loja === 0 ? resumoRede12() : resumir(serie)), [loja, serie]);
  const resRede = useMemo(() => (periodo === "12m" ? resumoRede12() : resumir(selRede)), [periodo, selRede]);
  const nomeLoja = loja === 0 ? "Rede toda" : LOJAS_CURTAS[loja - 1];
  const nMeses = sel.length || 1;

  // referência da variação: a rede quando há loja; a média de 12 meses quando o período é curto
  const refLabel = loja > 0 ? "vs rede" : periodo !== "12m" ? "vs média 12m" : "";
  const ref: ResumoGeral | null = loja > 0 ? resRede : periodo !== "12m" ? res12 : null;
  const d = (f: (r: ResumoGeral) => number, tipo: "rel" | "pp", bomSe: "alta" | "queda"): Delta | undefined => (ref ? delta(f(res), f(ref), tipo, bomSe) : undefined);

  const spark = (k: "receita" | "margem_real" | "perda" | "ruptura" | "vp" | "margem_bruta") =>
    serie.map((m) => (k === "receita" ? m.receita : k === "ruptura" ? m.ruptura : k === "vp" ? m.vp : k === "perda" ? (100 * m.perda) / m.receita : k === "margem_bruta" ? (100 * m.margem) / m.receita : (100 * (m.margem - m.perda)) / m.receita));

  const mensal = sel.map((m) => ({ mes: m.mes, receita: m.receita / 1e6, margemReal: (100 * (m.margem - m.perda)) / m.receita }));
  const mediaReceita = mensal.length ? mensal.reduce((a, m) => a + m.receita, 0) / mensal.length : 0;
  const ponte = useMemo(() => (sel.length ? ponteMargem(DADOS, loja, sel.map((m) => m.mes), res) : []), [sel, loja, res]);
  const pMin = ponte.length ? Math.floor(Math.min(...ponte.map((p) => (p.tipo === "total" ? p.valor : p.base)))) - 1 : 0;
  const pMax = ponte.length ? Math.ceil(Math.max(...ponte.map((p) => p.base + p.valor))) + 1 : 30;
  const ponteDados = ponte.map((p) => ({ ...p, rotulo: p.tipo === "total" ? pct(p.valor) : pp(p.pp, 2), cor: p.tipo === "total" ? (p.nome === "Margem real" ? COR.verde : COR.azul) : COR.perigo }));

  return (
    <div className="space-y-4 2xl:space-y-5">
      <BarraFiltros loja={loja} setLoja={setLoja} periodo={periodo} setPeriodo={setPeriodo} />

      {carregando ? (
        <div className="dash-card p-6">
          <Carga erro={erroDiarias} recarregar={recarregar} texto={`Carregando a série diária de ${nomeLoja}…`} />
        </div>
      ) : (
        <>
          <MetasEditor metas={metas} setMetas={setMetas} />

          <KpiStrip>
            <Kpi label="Receita" valor={brlCompact(res.receita)} delta={loja === 0 && periodo !== "12m" && ref ? delta(res.receita / nMeses, ref.receita / 12, "rel", "alta") : undefined} sub={loja > 0 ? `soma de ${nMeses} ${nMeses > 1 ? "meses" : "mês"} · ${pct((100 * res.receita) / resRede.receita, 1)} da rede` : refLabel ? `soma de ${nMeses} ${nMeses > 1 ? "meses" : "mês"} · mensal ${refLabel}` : `soma de ${nMeses} meses · ${nomeLoja}`} spark={spark("receita")} info="Receita do período selecionado." ask="Como evoluiu a receita por mês?" />
            <Kpi label="Margem bruta" valor={pct(res.margem_bruta_pct)} delta={d((r) => r.margem_bruta_pct, "pp", "alta")} sub={refLabel} spark={spark("margem_bruta")} info="Receita menos custo da mercadoria vendida." ask="Margem bruta por categoria" />
            <Kpi label="Margem real" valor={pct(res.margem_real_pct)} destaque delta={d((r) => r.margem_real_pct, "pp", "alta")} meta={metaKpi("margem_real_pct", res.margem_real_pct, metas)} sub={`${pp(res.margem_real_pct - res.margem_bruta_pct)} pelas perdas`} spark={spark("margem_real")} info="(Receita − CMV − perda a custo) ÷ receita. É a métrica central do painel. Meta de exemplo definida pelo autor." ask="Por que a margem real é menor que a bruta?" />
            <Kpi label="Perdas" valor={pct(res.perda_pct, 2)} tom="ruim" delta={d((r) => r.perda_pct, "pp", "queda")} meta={metaKpi("perda_pct", res.perda_pct, metas)} sub={`${brlCompact(res.perda_custo)} a custo`} spark={spark("perda")} info="Vencimento, avaria, furto e quebra operacional, valorizados a custo." ask="Qual loja tem a maior perda?" />
            <Kpi label="Ruptura" valor={pct(res.ruptura_pct, 2)} tom="ruim" delta={d((r) => r.ruptura_pct, "pp", "queda")} meta={metaKpi("ruptura_pct", res.ruptura_pct, metas)} sub={loja === 0 && periodo === "12m" ? `Classe A: ${pct(DADOS.meta.resumo.taxa_ruptura_A_pct, 2)} (meta ${pct(metas.ruptura_A_pct, 1)})` : undefined} spark={spark("ruptura")} info="SKU-loja-dias com demanda não atendida ÷ SKU-loja-dias com a loja aberta. É uma definição própria deste painel. Benchmarks de mercado costumam medir ruptura de gôndola por auditoria de prateleira e não são comparáveis: por isso a referência aqui é a meta interna, não um número de setor." ask="Ruptura por dia da semana" />
            <Kpi label="Venda perdida" valor={brlCompact(res.venda_perdida)} tom="ruim" delta={loja === 0 && periodo !== "12m" && ref ? delta(res.venda_perdida / nMeses, ref.venda_perdida / 12, "rel", "queda") : d((r) => r.venda_perdida_pct, "pp", "queda")} meta={metaKpi("venda_perdida_pct", res.venda_perdida_pct, metas)} sub={`${pct(res.venda_perdida_pct, 2)} da receita`} spark={spark("vp")} info="Unidades não atendidas × preço × 0,75 (premissa: 25% dos clientes levam outro item)." ask="Quais SKUs concentram a venda perdida?" />
          </KpiStrip>

          <div className="grid gap-4 xl:grid-cols-12 2xl:gap-5">
            <Panel title="Receita por mês" className="xl:col-span-4" summary={`${nomeLoja} · R$ mi`} ask="Como evoluiu a receita por mês?">
              <ChartBox height={300}>
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={mensal} margin={{ top: 10, right: 8, bottom: 0, left: -12 }}>
                    <CartesianGrid stroke={COR.grade} vertical={false} />
                    <XAxis dataKey="mes" tickFormatter={mesLabel} tick={EIXO} tickLine={false} axisLine={false} interval={0} />
                    <YAxis domain={[0, "auto"]} tick={EIXO} tickLine={false} axisLine={false} tickFormatter={(v: number) => dec(v, 1)} />
                    <RTooltip content={<ChartTip titulo={(l) => mesLabel(String(l))} formato={(v) => `R$ ${dec(v, 2)} mi`} />} />
                    <ReferenceLine y={mediaReceita} stroke={COR.laranja} strokeDasharray="4 3" label={{ value: `média ${dec(mediaReceita, 1)}`, position: "insideTopRight", fontSize: 10, fill: COR.laranja }} />
                    <Bar dataKey="receita" name="Receita" fill={COR.azul} fillOpacity={0.75} radius={[3, 3, 0, 0]} maxBarSize={36} isAnimationActive={false} />
                  </ComposedChart>
                </ResponsiveContainer>
              </ChartBox>
            </Panel>

            <Panel title="Margem real contra a meta" className="xl:col-span-4" summary={`meta ${pct(metas.margem_real_pct, 1)}`} info="Eixo de 20% a 30% para não exagerar variações pequenas. A meta é uma premissa do autor, editável acima." ask="Como evoluiu a margem real por mês?">
              <ChartBox height={300}>
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={mensal} margin={{ top: 10, right: 8, bottom: 0, left: -12 }}>
                    <CartesianGrid stroke={COR.grade} vertical={false} />
                    <XAxis dataKey="mes" tickFormatter={mesLabel} tick={EIXO} tickLine={false} axisLine={false} interval={0} />
                    <YAxis domain={[20, 30]} ticks={[20, 22, 24, 26, 28, 30]} tick={EIXO} tickLine={false} axisLine={false} tickFormatter={(v: number) => `${v}%`} />
                    <RTooltip content={<ChartTip titulo={(l) => mesLabel(String(l))} formato={(v) => pct(v, 2)} />} />
                    <ReferenceLine y={metas.margem_real_pct} stroke={COR.laranja} strokeDasharray="5 3" label={{ value: `meta ${pct(metas.margem_real_pct, 1)}`, position: "insideTopRight", fontSize: 10, fill: COR.laranja }} />
                    <Line type="monotone" dataKey="margemReal" name="Margem real" stroke={COR.verde} strokeWidth={2.6} dot={{ r: 3.5, strokeWidth: 2, fill: "var(--card)" }} activeDot={{ r: 5 }} isAnimationActive={false} />
                  </ComposedChart>
                </ResponsiveContainer>
              </ChartBox>
            </Panel>

            <Panel title="Ponte da margem" className="xl:col-span-4" summary={`${brlCompact(res.perda_custo)} perdidos`} info={`Da margem bruta à margem real, perda por motivo. O eixo começa em ${pMin}% para a cascata ficar legível. Os motivos são rateio por regra sobre a perda simulada; em dado real viriam do registro de quebra.`} ask="Perda por motivo">
              <ChartBox height={300}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={ponteDados} margin={{ top: 22, right: 6, bottom: 0, left: -10 }}>
                    <CartesianGrid stroke={COR.grade} vertical={false} />
                    <XAxis dataKey="nome" tick={{ ...EIXO, fontSize: 10 }} tickLine={false} axisLine={false} interval={0} />
                    <YAxis domain={[pMin, pMax]} allowDataOverflow tick={EIXO} tickLine={false} axisLine={false} tickFormatter={(v: number) => `${v}%`} />
                    <Bar dataKey="base" stackId="p" fill="transparent" isAnimationActive={false} />
                    <Bar dataKey="valor" stackId="p" radius={[3, 3, 0, 0]} isAnimationActive={false}>
                      {ponteDados.map((p) => (
                        <Cell key={p.nome} fill={p.cor} />
                      ))}
                      <LabelList dataKey="rotulo" position="top" style={{ fontSize: 11, fontWeight: 600, fill: "var(--foreground)" }} />
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </ChartBox>
            </Panel>
          </div>

          <div className="grid gap-4 xl:grid-cols-12 2xl:gap-5">
            <TabelaCategorias loja={loja} nomeLoja={nomeLoja} metas={metas} />
            <Sinais />
          </div>

          <Simulador />
        </>
      )}
    </div>
  );
}

function BarraFiltros(p: { loja: number; setLoja: (n: number) => void; periodo: PeriodoId; setPeriodo: (p: PeriodoId) => void }) {
  const [alvo, setAlvo] = useState<HTMLElement | null>(null);
  useEffect(() => setAlvo(document.getElementById("barra-filtros")), []);
  if (!alvo) return null;
  return createPortal(
    <div className="scrollbar-thin flex items-center gap-x-5 gap-y-2 overflow-x-auto border-t bg-card/60 px-4 py-2 lg:px-6 2xl:px-8" role="group" aria-label="Filtros da visão geral">
      <div className="flex shrink-0 items-center gap-2">
        <span className="text-[11px] font-medium text-muted-foreground">Loja</span>
        <Segmented label="Loja" value={String(p.loja)} onChange={(v) => p.setLoja(Number(v))} options={[{ value: "0", label: "Rede" }, ...LOJAS_CURTAS.map((n, i) => ({ value: String(i + 1), label: n }))]} />
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <span className="text-[11px] font-medium text-muted-foreground">Período</span>
        <Segmented label="Período" value={p.periodo} onChange={p.setPeriodo} options={PERIODOS.map((x) => ({ value: x.id, label: x.label }))} />
      </div>
      <span className="hidden shrink-0 text-[11px] text-muted-foreground xl:inline">Aplicados a esta tela. Filtro por categoria: use o Modo IA.</span>
    </div>,
    alvo,
  );
}

function TabelaCategorias({ loja, nomeLoja, metas }: { loja: number; nomeLoja: string; metas: Metas }) {
  const { categorias, lojaCategoria } = DADOS;
  const linhas = [...categorias]
    .map((c) => {
      const lc = loja > 0 ? lojaCategoria.find((x) => x.loja_id === loja && x.categoria === c.categoria) : undefined;
      return {
        categoria: c.categoria,
        perecivel: c.perecivel,
        receita: lc ? lc.receita : c.receita,
        margemReal: lc ? lc.margem_real_pct : c.margem_real_pct,
        perda: lc ? lc.perda_pct_receita : c.perda_pct_receita,
        ruptura: lc ? lc.taxa_ruptura_pct : c.taxa_ruptura_pct,
        perdaRef: c.perda_pct_receita,
        rupturaRef: c.taxa_ruptura_pct,
        giro: c.giro_estoque_ano,
        cobertura: c.cobertura_media_dias,
      };
    })
    .sort((a, b) => b.receita - a.receita);
  const total = linhas.reduce((a, l) => a + l.receita, 0);
  const maxRec = Math.max(...linhas.map((l) => l.receita));
  // sem loja: contra a meta da rede; com loja: contra a mesma categoria na rede
  const cor = (v: number, ref: number, meta: number): string => {
    const r = loja > 0 ? ref : meta;
    return v > r * 1.15 ? "font-semibold text-danger" : v < r * 0.85 ? "text-positive" : "text-foreground";
  };
  return (
    <Panel
      title="Mix, perda, ruptura e giro por categoria"
      className="xl:col-span-7"
      summary={`${nomeLoja} · 12 meses`}
      info={`Vermelho: perda ou ruptura mais de 15% acima ${loja > 0 ? "da mesma categoria na rede" : "da meta da rede"}; verde: mais de 15% abaixo. Giro e cobertura são da rede (não existem por loja). O painel não tem preço de gôndola nem concorrência, então não mede elasticidade.`}
      ask="Quais categorias perdem mais margem?"
    >
      <div className="scrollbar-thin overflow-x-auto">
        <table className="w-full min-w-[34rem] text-xs tabular-nums">
          <thead>
            <tr className="text-left text-[11px] text-muted-foreground">
              <th className="py-1.5 pr-2 font-medium">Categoria</th>
              <th className="w-[26%] px-2 py-1.5 font-medium">Receita (mix)</th>
              <th className="px-2 py-1.5 text-right font-medium">Mg real</th>
              <th className="px-2 py-1.5 text-right font-medium">Perda</th>
              <th className="px-2 py-1.5 text-right font-medium">Ruptura</th>
              <th className="px-2 py-1.5 text-right font-medium">Giro/ano</th>
              <th className="px-2 py-1.5 text-right font-medium">Cobert.</th>
              <th className="w-7" />
            </tr>
          </thead>
          <tbody>
            {linhas.map((l) => (
              <tr key={l.categoria} className="border-t">
                <td className="py-2 pr-2 font-medium text-foreground">
                  {l.categoria}
                  {l.perecivel && <span className="ml-1.5 inline-block size-1.5 rounded-full bg-cat-2 align-middle" title="Perecível" />}
                </td>
                <td className="px-2 py-2">
                  <div className="flex items-center gap-2">
                    <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted/70">
                      <div className="h-full rounded-full bg-cat-3" style={{ width: `${(100 * l.receita) / maxRec}%` }} />
                    </div>
                    <span className="w-9 shrink-0 text-right text-muted-foreground">{pct((100 * l.receita) / total, 0)}</span>
                  </div>
                </td>
                <td className="px-2 py-2 text-right text-foreground">{pct(l.margemReal)}</td>
                <td className={cn("px-2 py-2 text-right", cor(l.perda, l.perdaRef, metas.perda_pct))}>{pct(l.perda, 2)}</td>
                <td className={cn("px-2 py-2 text-right", cor(l.ruptura, l.rupturaRef, metas.ruptura_pct))}>{pct(l.ruptura, 2)}</td>
                <td className="px-2 py-2 text-right text-foreground">{dec(l.giro, 0)}×</td>
                <td className="px-2 py-2 text-right text-foreground">{dec(l.cobertura, 1)} d</td>
                <td className="py-1 text-right">
                  <AskButton pergunta={`Por que a perda em ${l.categoria} está assim?`.replace(/^Por que a perda em (.*) está assim\?$/, `Perda de ${l.categoria} por loja`)} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

function CartaoSinal({ i, aberto, alternar }: { i: Insight; aberto: boolean; alternar: () => void }) {
  const ai = useAi();
  return (
    <li className="overflow-hidden rounded-lg border bg-background/40">
      <div className="flex">
        <span className={cn("w-1.5 shrink-0", COR_SEV[i.tom])} aria-hidden />
        <div className="min-w-0 flex-1 p-3">
          <div className="flex items-start gap-3">
            <div className="min-w-0 flex-1">
              <p className="text-[13.5px] font-semibold leading-snug text-foreground">{i.titulo}</p>
              <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[11px] text-muted-foreground">
                <span className="font-semibold">{ROT_SEV[i.tom]}</span>
                <span>Responsável: {i.dono}</span>
              </p>
            </div>
            {i.reais !== null && (
              <div className="shrink-0 text-right">
                <p className="font-display text-[19px] font-semibold leading-none text-foreground">{brlCompact(i.reais)}</p>
                <p className="mt-1 max-w-[11rem] text-[10px] leading-tight text-muted-foreground">{i.reaisRot}</p>
              </div>
            )}
          </div>
          <div className="mt-2 flex items-center gap-1">
            {i.itens && i.itens.length > 0 && (
              <button type="button" onClick={alternar} aria-expanded={aberto} className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-[12px] font-medium text-primary hover:bg-primary/8">
                {aberto ? "Ocultar itens" : "Ver itens"}
                <ChevronDown className={cn("size-3.5 transition-transform", aberto && "rotate-180")} aria-hidden />
              </button>
            )}
            <Link to="/" search={{ view: i.view }} className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-[12px] font-medium text-muted-foreground hover:bg-secondary hover:text-foreground">
              Abrir tela <ArrowRight className="size-3" aria-hidden />
            </Link>
            <span className="ml-auto">
              <button type="button" onClick={() => ai.perguntar(perguntaDoInsight(i))} className="rounded-md px-1.5 py-1 text-[12px] font-medium text-brand hover:bg-brand/10">
                Perguntar ✦
              </button>
            </span>
          </div>
          {aberto && i.itens && (
            <ul className="mt-2 divide-y rounded-md border bg-card text-[12px]">
              {i.itens.map((it) => (
                <li key={it.nome} className="flex justify-between gap-3 px-2.5 py-1.5">
                  <span className="min-w-0 truncate text-foreground">{it.nome}</span>
                  <span className="shrink-0 tabular-nums text-muted-foreground">{it.valor}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </li>
  );
}

function Sinais() {
  const [abertos, setAbertos] = useState<Record<string, boolean>>({});
  const alt = (id: string) => () => setAbertos((a) => ({ ...a, [id]: !a[id] }));
  const recuperaveis = INSIGHTS.filter((i) => i.base === "recuperavel").sort((a, b) => (b.reais ?? -1) - (a.reais ?? -1));
  const contexto = INSIGHTS.filter((i) => i.base === "contexto");
  return (
    <Panel
      title="Sinais para agir"
      className="xl:col-span-5"
      summary="ordenados por ganho anual recuperável"
      info="Mesma régua em todos os sinais: quanto se ganha por ano se a diferença for fechada ou a premissa indicada em cada linha for atingida. Os sinais se sobrepõem (por exemplo, perecíveis e a perda de uma loja), então não some os valores. Abaixo, o que fica fora da ordenação por ter outra natureza."
    >
      <ul className="space-y-2.5">
        {recuperaveis.map((i) => (
          <CartaoSinal key={i.id} i={i} aberto={!!abertos[i.id]} alternar={alt(i.id)} />
        ))}
      </ul>
      {contexto.length > 0 && (
        <>
          <p className="mb-2 mt-4 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Contexto, fora da ordenação (outra base de valor)</p>
          <ul className="space-y-2.5">
            {contexto.map((i) => (
              <CartaoSinal key={i.id} i={i} aberto={!!abertos[i.id]} alternar={alt(i.id)} />
            ))}
          </ul>
        </>
      )}
    </Panel>
  );
}

function MetasEditor({ metas, setMetas }: { metas: Metas; setMetas: (m: Metas) => void }) {
  const chaves = Object.keys(METAS) as ChaveMeta[];
  return (
    <details className="dash-card px-4 py-2.5">
      <summary className="cursor-pointer text-[12.5px] font-medium text-foreground">
        Metas usadas nos indicadores <span className="font-normal text-muted-foreground">· definidas pelo autor para esta demonstração, sem benchmark de mercado. Edite para a realidade do cliente.</span>
      </summary>
      <div className="mt-3 grid gap-x-6 gap-y-2 sm:grid-cols-2 xl:grid-cols-5">
        {chaves.map((k) => (
          <label key={k} className="flex items-center justify-between gap-2 text-[12px]">
            <span className="text-muted-foreground">{ROTULO_META[k]}</span>
            <span className="flex items-center gap-1">
              <input type="number" step={0.1} min={0} max={100} value={metas[k]} onChange={(e) => setMetas({ ...metas, [k]: Math.max(0, Math.min(100, Number(e.target.value) || 0)) })} className="w-16 rounded-md border bg-background px-1.5 py-1 text-right tabular-nums" />%
            </span>
          </label>
        ))}
      </div>
      <button type="button" onClick={() => setMetas({ ...METAS })} className="mt-2 text-[11.5px] font-medium text-primary hover:underline">
        Voltar às metas de exemplo
      </button>
    </details>
  );
}

function Campo({ rotulo, valor, onChange, sufixo, min = 0, max = 100, step = 1 }: { rotulo: string; valor: number; onChange: (n: number) => void; sufixo: string; min?: number; max?: number; step?: number }) {
  return (
    <label className="flex items-center justify-between gap-2 text-[12px] text-foreground">
      <span className="text-muted-foreground">{rotulo}</span>
      <span className="flex items-center gap-1">
        <input type="number" value={valor} min={min} max={max} step={step} onChange={(e) => onChange(Math.max(min, Math.min(max, Number(e.target.value) || 0)))} className="w-16 rounded-md border bg-background px-1.5 py-1 text-right tabular-nums" />
        <span className="w-9 text-muted-foreground">{sufixo}</span>
      </span>
    </label>
  );
}

function Simulador() {
  const [p, setP] = useState<Premissas>(() => premissasPadrao(DADOS));
  const set = (k: keyof Premissas) => (n: number) => setP((x) => ({ ...x, [k]: n }));
  const g = ganhoLiquido(DADOS, p);
  const r = DADOS.meta.resumo;
  const linhas: { rot: string; v: number }[] = [
    { rot: "Margem sobre a venda recuperada", v: g.margemRecuperada },
    { rot: "Perda evitada (a custo)", v: g.perdaEvitada },
    { rot: "Compra emergencial, frete e transferência", v: -g.custoOperacional },
    { rot: `Capital parado em ${brlCompact(g.estoqueExtra)} de estoque extra`, v: -g.custoCapital },
    { rot: "Vencimento extra sobre o estoque adicional", v: -g.perdaExtra },
    { rot: "Remarcação e processo para reduzir perda", v: -g.custoAcao },
  ];
  return (
    <Panel title="Quanto vale agir" summary="ganho líquido, por ano" info="Estimativa linear, sem efeitos de segunda ordem. Venda recuperada rende a margem informada; segurar essa venda exige estoque extra (capital parado e mais vencimento); reduzir perda custa remarcação e processo. Todas as premissas são editáveis." ask="Simule recuperar 30% da venda perdida e reduzir 20% da perda">
      <div className="grid gap-6 xl:grid-cols-12">
        <div className="space-y-4 xl:col-span-4">
          <label className="block">
            <span className="flex justify-between text-[13px] font-medium text-foreground">
              Recuperar da venda perdida <span className="tabular-nums text-primary">{p.recuperarPct}%</span>
            </span>
            <input type="range" min={0} max={80} step={5} value={p.recuperarPct} onChange={(e) => set("recuperarPct")(Number(e.target.value))} className="mt-2 w-full" />
            <span className="block text-[11px] text-muted-foreground">Venda perdida atual: {brlCompact(r.venda_perdida)}</span>
          </label>
          <label className="block">
            <span className="flex justify-between text-[13px] font-medium text-foreground">
              Reduzir a perda <span className="tabular-nums text-primary">{p.reduzirPerdaPct}%</span>
            </span>
            <input type="range" min={0} max={60} step={5} value={p.reduzirPerdaPct} onChange={(e) => set("reduzirPerdaPct")(Number(e.target.value))} className="mt-2 w-full" />
            <span className="block text-[11px] text-muted-foreground">Perda atual: {brlCompact(r.perda_custo)} a custo</span>
          </label>
          <details className="rounded-lg border bg-background/40 p-3">
            <summary className="cursor-pointer text-[12px] font-medium text-foreground">Premissas (editáveis)</summary>
            <div className="mt-3 space-y-2">
              <Campo rotulo="Margem sobre a venda recuperada" valor={p.margemPct} onChange={set("margemPct")} sufixo="%" step={0.1} />
              <Campo rotulo="Estoque extra necessário" valor={p.diasEstoque} onChange={set("diasEstoque")} sufixo="dias" max={30} />
              <Campo rotulo="Custo do capital" valor={p.capitalAnoPct} onChange={set("capitalAnoPct")} sufixo="% a.a." />
              <Campo rotulo="Vencimento extra (sobre custo)" valor={p.perdaExtraPct} onChange={set("perdaExtraPct")} sufixo="%" step={0.5} />
              <Campo rotulo="Custo operacional (da margem)" valor={p.custoOperacionalPct} onChange={set("custoOperacionalPct")} sufixo="%" />
              <Campo rotulo="Custo da ação de perda (da economia)" valor={p.custoAcaoPct} onChange={set("custoAcaoPct")} sufixo="%" />
            </div>
          </details>
        </div>

        <div className="xl:col-span-5">
          <ul className="divide-y rounded-lg border text-[12.5px]">
            {linhas.map((l) => (
              <li key={l.rot} className="flex items-center justify-between gap-3 px-3 py-2">
                <span className="text-foreground">{l.rot}</span>
                <span className={cn("shrink-0 font-medium tabular-nums", l.v >= 0 ? "text-positive" : "text-danger")}>{l.v >= 0 ? "+" : "−"} {brlCompact(Math.abs(l.v))}</span>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-[11px] leading-snug text-muted-foreground">
            Premissas em uso: margem de {pct(p.margemPct, 1)}, {p.diasEstoque} dias de estoque extra a {p.capitalAnoPct}% a.a., vencimento extra de {pct(p.perdaExtraPct, 1)}, operação de {p.custoOperacionalPct}% da margem e ação de perda de {p.custoAcaoPct}% da economia.
          </p>
        </div>

        <div className="rounded-xl bg-primary p-4 text-primary-foreground xl:col-span-3">
          <p className="text-[12px] font-medium text-primary-foreground/70">Ganho líquido por ano</p>
          <p className="mt-0.5 font-display text-[34px] font-semibold leading-tight">{brlCompact(g.liquido)}</p>
          <p className="text-[12px] text-primary-foreground/80">
            Bruto {brlCompact(g.bruto)} menos {brlCompact(g.custos)} de custos
          </p>
          <p className="mt-2 text-[12px] text-primary-foreground/80">
            Margem real de {pct(r.margem_real_pct)} para {pct(r.margem_real_pct + g.ppMargem)} ({dec(g.ppMargem, 2)} p.p.)
          </p>
        </div>
      </div>
    </Panel>
  );
}
