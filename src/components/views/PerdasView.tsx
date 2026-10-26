import { useMemo } from "react";
import { Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip as RTooltip, XAxis, YAxis } from "recharts";
import { BarList, ChartBox, ChartTip, COR, EIXO, HeatGrid, Kpi, Nota, Panel, Tag, type HeatCell } from "@/components/aurora/kit";
import { DADOS, LOJAS_CURTAS } from "@/lib/aurora-data";
import { brlCompact, dec, mesLabel, pct } from "@/lib/format";
import { media } from "@/lib/insights";

const MOTIVOS = ["Vencimento", "Avaria", "Furto/Desvio", "Quebra operacional"];
const COR_MOTIVO = [COR.laranja, COR.azul, COR.magenta, COR.cinza];
const COR_CAT = [COR.verde, COR.laranja, COR.azul, COR.magenta];

export function PerdasView() {
  const { categorias, lojaCategoria, perdasMes, perdasMotivos, meta, lojas } = DADOS;
  const r = meta.resumo;

  const perecivelCusto = categorias.filter((c) => c.perecivel).reduce((a, c) => a + (c.perda_pct_receita * c.receita) / 100, 0);
  const partePerecivel = (100 * perecivelCusto) / r.perda_custo;
  const ordenadas = [...categorias].sort((a, b) => b.perda_pct_receita - a.perda_pct_receita);

  const top4 = ordenadas.slice(0, 4).map((c) => c.categoria);
  const evolucao = useMemo(() => {
    const meses = Array.from(new Set(perdasMes.map((p) => p.mes))).sort();
    return meses.map((mes) => {
      const linha: Record<string, number | string> = { mes };
      for (const c of top4) linha[c] = perdasMes.find((p) => p.mes === mes && p.categoria === c)?.perda_pct_receita ?? 0;
      return linha;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [perdasMes]);

  const motivos = useMemo(() => {
    const porCat = new Map<string, Record<string, number | string>>();
    for (const p of perdasMotivos) {
      const linha = porCat.get(p.categoria) ?? { categoria: p.categoria, total: 0 };
      linha[p.motivo] = Number(linha[p.motivo] ?? 0) + p.valor_custo;
      linha["total"] = Number(linha["total"]) + p.valor_custo;
      porCat.set(p.categoria, linha);
    }
    return Array.from(porCat.values())
      .sort((a, b) => Number(b["total"]) - Number(a["total"]))
      .slice(0, 8);
  }, [perdasMotivos]);

  const linhas = ordenadas.map((c) => {
    const vals = lojas.map((l) => lojaCategoria.find((x) => x.loja_id === l.loja_id && x.categoria === c.categoria)?.perda_pct_receita ?? 0);
    const m = media(vals);
    const cells: HeatCell[] = vals.map((v) => ({ texto: pct(v), t: 0.5 - Math.max(-1, Math.min(1, (v - m) / Math.max(m * 0.6, 0.3))) / 2, dica: `${c.categoria}: perda de ${pct(v, 2)} da receita` }));
    return { label: c.categoria, cells };
  });

  return (
    <div className="space-y-4">
      <section className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Kpi label="Perda total" valor={brlCompact(r.perda_custo)} tom="ruim" sub={`${pct(r.perda_pct_receita, 2)} da receita, a custo`} destaque />
        <Kpi label="Peso dos perecíveis" valor={pct(partePerecivel, 0)} sub="da perda vem de FLV, padaria, frios e açougue" />
        <Kpi label="Maior categoria" valor={ordenadas[0].categoria} sub={`${pct(ordenadas[0].perda_pct_receita)} da receita da categoria`} tom="ruim" />
        <Kpi label="Margem perdida" valor={`${dec(r.margem_bruta_pct - r.margem_real_pct, 1)} p.p.`} sub={`${pct(r.margem_bruta_pct)} bruta → ${pct(r.margem_real_pct)} real`} />
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Perda por categoria" summary="% da receita da categoria" info="Perda a custo ÷ receita da categoria. Barras laranja: categorias perecíveis.">
          <BarList
            items={ordenadas.map((c) => ({
              label: c.categoria,
              value: c.perda_pct_receita,
              texto: pct(c.perda_pct_receita, 2),
              cor: c.perecivel ? COR.laranja : COR.cinza,
              sub: `Margem ${pct(c.margem_bruta_pct)} → ${pct(c.margem_real_pct)}`,
            }))}
          />
        </Panel>

        <Panel title="Perda por categoria e loja" summary="% da receita" info="Cor relativa à média da linha: vermelho é pior que as outras lojas na mesma categoria.">
          <HeatGrid corner="Categoria" cols={LOJAS_CURTAS} rows={linhas} />
        </Panel>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Evolução mensal da perda" summary="4 maiores categorias, % da receita">
          <ChartBox height={270}>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={evolucao} margin={{ top: 8, right: 12, bottom: 0, left: -8 }}>
                <CartesianGrid stroke={COR.grade} vertical={false} />
                <XAxis dataKey="mes" tickFormatter={mesLabel} tick={EIXO} tickLine={false} axisLine={false} />
                <YAxis tick={EIXO} tickLine={false} axisLine={false} tickFormatter={(v: number) => `${v}%`} />
                <RTooltip content={<ChartTip titulo={(l) => mesLabel(String(l))} formato={(v) => pct(v, 2)} />} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                {top4.map((c, i) => (
                  <Line key={c} type="monotone" dataKey={c} stroke={COR_CAT[i]} strokeWidth={2} dot={false} isAnimationActive={false} />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </ChartBox>
        </Panel>

        <Panel title="Motivos da perda" summary="R$ a custo, 8 maiores categorias">
          <ChartBox height={270}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={motivos} layout="vertical" margin={{ top: 0, right: 12, bottom: 0, left: 8 }} barCategoryGap={6}>
                <CartesianGrid stroke={COR.grade} horizontal={false} />
                <XAxis type="number" tick={EIXO} tickLine={false} axisLine={false} tickFormatter={(v: number) => `${Math.round(v / 1000)}k`} />
                <YAxis type="category" dataKey="categoria" width={120} tick={EIXO} tickLine={false} axisLine={false} />
                <RTooltip content={<ChartTip formato={(v) => brlCompact(v)} />} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                {MOTIVOS.map((m, i) => (
                  <Bar key={m} dataKey={m} stackId="m" fill={COR_MOTIVO[i]} isAnimationActive={false} />
                ))}
              </BarChart>
            </ResponsiveContainer>
          </ChartBox>
          <Nota>
            Os motivos são uma apropriação por regra sobre a perda simulada (vencimento domina nos perecíveis; furto e avaria nos demais). Em dado real, viria do registro de quebra por motivo.
          </Nota>
        </Panel>
      </div>

      <Panel title="Giro e cobertura de estoque" summary="por categoria">
        <div className="overflow-x-auto scrollbar-thin">
          <table className="w-full text-xs tabular-nums">
            <thead>
              <tr className="text-left text-[10px] uppercase tracking-wider text-muted-foreground">
                <th className="py-1 pr-2 font-medium">Categoria</th>
                <th className="px-2 py-1 text-right font-medium">Giro/ano</th>
                <th className="px-2 py-1 text-right font-medium">Cobertura (dias)</th>
                <th className="px-2 py-1 text-right font-medium">Perda</th>
                <th className="px-2 py-1 text-right font-medium">Mg bruta</th>
                <th className="px-2 py-1 text-right font-medium">Mg real</th>
                <th className="py-1 pl-2 text-right font-medium">Tipo</th>
              </tr>
            </thead>
            <tbody>
              {[...categorias].sort((a, b) => b.giro_estoque_ano - a.giro_estoque_ano).map((c) => (
                <tr key={c.categoria} className="border-t">
                  <td className="py-1.5 pr-2 text-foreground">{c.categoria}</td>
                  <td className="px-2 py-1.5 text-right">{dec(c.giro_estoque_ano, 0)}×</td>
                  <td className="px-2 py-1.5 text-right">{dec(c.cobertura_media_dias, 1)}</td>
                  <td className="px-2 py-1.5 text-right">{pct(c.perda_pct_receita, 2)}</td>
                  <td className="px-2 py-1.5 text-right">{pct(c.margem_bruta_pct)}</td>
                  <td className="px-2 py-1.5 text-right font-medium text-foreground">{pct(c.margem_real_pct)}</td>
                  <td className="py-1.5 pl-2 text-right">{c.perecivel ? <Tag tom="atencao">Perecível</Tag> : <Tag>Não perecível</Tag>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
    </div>
  );
}
