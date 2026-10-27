// Cálculos derivados e leituras automáticas. Funções puras sobre os JSONs: sem React, sem alias "@".
// Todo número que aparece em texto sai daqui, calculado a partir dos dados, nunca digitado.
import { brlCompact, dec, pct, pp, int } from "./format";
import type { Dados, SkuAbc } from "./types";

export type ViewId = "geral" | "margem" | "ruptura" | "perdas" | "lojas" | "cesta" | "alertas";

export interface Insight {
  id: string;
  tom: "risco" | "atencao" | "info";
  titulo: string;
  texto: string;
  view: ViewId;
  /** valor em R$ associado ao sinal; null quando não há leitura financeira */
  reais: number | null;
  /** o que o valor representa */
  reaisRot: string;
  /** quem deve agir */
  dono: string;
  /** itens que sustentam o sinal (lista curta de SKUs, por exemplo) */
  itens?: { nome: string; valor: string }[];
}

/** "Aurora Jardins" -> "Jardins" */
export const lojaCurta = (nome: string): string => nome.replace(/^Aurora\s+/, "");

const DIA_LONGO: Record<string, string> = { Seg: "segunda", Ter: "terça", Qua: "quarta", Qui: "quinta", Sex: "sexta", Sab: "sábado", Dom: "domingo" };

/** "Sab" -> "sábado" */
export const diaLongo = (d: string): string => DIA_LONGO[d] ?? d.toLowerCase();

/** "Sab" -> "no sábado", "Sex" -> "na sexta" */
export const emDia = (d: string): string => (d === "Sab" || d === "Dom" ? `no ${diaLongo(d)}` : `na ${diaLongo(d)}`);

const cap1 = (s: string): string => (s ? s[0].toUpperCase() + s.slice(1) : s);

export const media = (xs: number[]): number => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

/** Limite de margem real (%) abaixo do qual um SKU de classe A é tratado como item de tráfego. */
export const LIMITE_TRAFEGO = 12;

export interface ResumoClasse {
  classe: "A" | "B" | "C";
  skus: number;
  receitaPct: number;
  margemRealPct: number;
}

export function resumoAbc(abc: SkuAbc[]): ResumoClasse[] {
  const receitaTotal = abc.reduce((a, s) => a + s.receita, 0);
  return (["A", "B", "C"] as const).map((classe) => {
    const g = abc.filter((s) => s.classe === classe);
    const rec = g.reduce((a, s) => a + s.receita, 0);
    const mr = g.reduce((a, s) => a + (s.receita * s.margem_real_pct) / 100, 0);
    return { classe, skus: g.length, receitaPct: (100 * rec) / receitaTotal, margemRealPct: rec ? (100 * mr) / rec : 0 };
  });
}

export interface Trafego {
  skus: number;
  receitaPct: number;
  margemRealPct: number; // participação na margem real total
  margemMediaPct: number; // margem real média do grupo
}

export function trafego(abc: SkuAbc[], limite = LIMITE_TRAFEGO): Trafego {
  const grupo = abc.filter((s) => s.classe === "A" && s.margem_real_pct < limite);
  const recTotal = abc.reduce((a, s) => a + s.receita, 0);
  const mrTotal = abc.reduce((a, s) => a + (s.receita * s.margem_real_pct) / 100, 0);
  const rec = grupo.reduce((a, s) => a + s.receita, 0);
  const mr = grupo.reduce((a, s) => a + (s.receita * s.margem_real_pct) / 100, 0);
  return {
    skus: grupo.length,
    receitaPct: (100 * rec) / recTotal,
    margemRealPct: (100 * mr) / mrTotal,
    margemMediaPct: rec ? (100 * mr) / rec : 0,
  };
}

export interface Ganho {
  vendaRecuperada: number; // R$ de receita
  margemRecuperada: number; // R$ de margem bruta sobre a venda recuperada
  perdaEvitada: number; // R$ a custo
  total: number;
  ppMargem: number; // pontos percentuais de margem real
}

/**
 * Estimativa simples: recuperar X% da venda perdida rende margem bruta média da rede sobre essa venda;
 * reduzir Y% da perda economiza o custo da perda. Premissas explícitas, sem efeito de segunda ordem.
 */
export function ganhoSimulado(d: Dados, recuperarPct: number, reduzirPerdaPct: number): Ganho {
  const r = d.meta.resumo;
  const vendaRecuperada = (r.venda_perdida * recuperarPct) / 100;
  const margemRecuperada = (vendaRecuperada * r.margem_bruta_pct) / 100;
  const perdaEvitada = (r.perda_custo * reduzirPerdaPct) / 100;
  const total = margemRecuperada + perdaEvitada;
  return { vendaRecuperada, margemRecuperada, perdaEvitada, total, ppMargem: (100 * total) / r.receita };
}

export function gerarInsights(d: Dados): Insight[] {
  const out: Insight[] = [];
  const lojaNome = (id: number) => lojaCurta(d.lojas.find((l) => l.loja_id === id)?.nome ?? `Loja ${id}`);

  // 1. Concentração da venda perdida
  const n = Math.min(15, d.rupturaSkus.length);
  if (n > 0) {
    const topo = d.rupturaSkus[n - 1];
    const primeiro = d.rupturaSkus[0];
    out.push({
      id: "ruptura-concentrada",
      tom: "risco",
      titulo: `${n} SKUs concentram ${pct(topo.pct_acum, 0)} da venda perdida`,
      texto: `O maior é ${primeiro.nome}, com ${brlCompact(primeiro.venda_perdida)} (${pct(primeiro.pct_do_total)} do total), seguido de ${d.rupturaSkus[1]?.nome ?? "—"} e ${d.rupturaSkus[2]?.nome ?? "—"}. Uma lista curta de itens concentra boa parte da ruptura.`,
      view: "ruptura",
      reais: (d.rupturaSkus.slice(0, n).reduce((a, x) => a + x.venda_perdida, 0) * d.meta.resumo.margem_bruta_pct) / 100,
      reaisRot: "margem em risco por ano",
      dono: "Compras e abastecimento",
      itens: d.rupturaSkus.slice(0, 6).map((x) => ({ nome: x.nome, valor: brlCompact(x.venda_perdida) })),
    });
  }

  // 2. Loja que perde mais por compra em excesso
  const maiorPerda = [...d.lojas].sort((a, b) => b.perda_pct_receita - a.perda_pct_receita)[0];
  if (maiorPerda) {
    const outras = d.lojas.filter((l) => l.loja_id !== maiorPerda.loja_id);
    const rupturaOutras = media(outras.map((l) => l.taxa_ruptura_pct));
    const faltaMenos = maiorPerda.taxa_ruptura_pct < rupturaOutras;
    const hf = (id: number) => d.lojaCategoria.find((x) => x.loja_id === id && x.categoria === "Hortifruti");
    const hfLoja = hf(maiorPerda.loja_id);
    const hfOutras = media(outras.map((l) => hf(l.loja_id)?.perda_pct_receita ?? 0));
    out.push({
      id: "compra-em-excesso",
      tom: "risco",
      titulo: faltaMenos
        ? `${lojaCurta(maiorPerda.nome)}: a loja que menos falta produto é a que mais joga fora`
        : `${lojaCurta(maiorPerda.nome)} tem a maior perda da rede`,
      texto: `Perda de ${pct(maiorPerda.perda_pct_receita)} da receita (demais lojas: ${pct(media(outras.map((l) => l.perda_pct_receita)))}); ruptura de ${pct(maiorPerda.taxa_ruptura_pct)} contra ${pct(rupturaOutras)}.${hfLoja ? ` Só em hortifruti a perda é ${pct(hfLoja.perda_pct_receita)} da receita, contra ${pct(hfOutras)} nas outras.` : ""}`,
      view: "perdas",
      reais: ((maiorPerda.perda_pct_receita - media(outras.map((l) => l.perda_pct_receita))) / 100) * maiorPerda.receita,
      reaisRot: "perda acima das outras lojas, por ano",
      dono: `Gerente ${lojaCurta(maiorPerda.nome)} e compras`,
      itens: d.categorias
        .filter((c) => c.perecivel)
        .map((c) => ({ c, l: d.lojaCategoria.find((x) => x.loja_id === maiorPerda.loja_id && x.categoria === c.categoria) }))
        .filter((x) => x.l)
        .sort((a, b) => (b.l?.perda_pct_receita ?? 0) - (a.l?.perda_pct_receita ?? 0))
        .slice(0, 4)
        .map((x) => ({ nome: x.c.categoria, valor: `${pct(x.l?.perda_pct_receita ?? 0)} da receita` })),
    });
  }

  // 3. Itens de tráfego
  const t = trafego(d.curvaAbc);
  if (t.skus > 0) {
    const apertados = d.curvaAbc.filter((s) => s.classe === "A" && s.margem_real_pct < LIMITE_TRAFEGO).sort((x, y) => x.margem_real_pct - y.margem_real_pct).slice(0, 3);
    out.push({
      id: "itens-de-trafego",
      tom: "atencao",
      titulo: `${t.skus} itens de tráfego: ${pct(t.receitaPct, 0)} da receita, ${pct(t.margemRealPct, 0)} da margem`,
      texto: `SKUs classe A com margem real abaixo de ${LIMITE_TRAFEGO}% rendem ${pct(t.margemMediaPct)} em média. Os mais apertados: ${apertados.map((s) => `${s.nome} (${pct(s.margem_real_pct)})`).join(", ")}.`,
      view: "margem",
      reais: (() => {
        const grupo = d.curvaAbc.filter((s) => s.classe === "A" && s.margem_real_pct < LIMITE_TRAFEGO);
        return grupo.reduce((a, s) => a + (s.receita * (d.meta.resumo.margem_real_pct - s.margem_real_pct)) / 100, 0);
      })(),
      reaisRot: "margem abaixo da média da rede, por ano",
      dono: "Comercial (preço e mix)",
      itens: apertados.map((s) => ({ nome: s.nome, valor: `${pct(s.margem_real_pct)} de margem real` })),
    });
  }

  // 4. Loja com maior venda perdida
  const maiorVp = [...d.lojas].sort((a, b) => b.venda_perdida_pct_receita - a.venda_perdida_pct_receita)[0];
  if (maiorVp) {
    const outras = d.lojas.filter((l) => l.loja_id !== maiorVp.loja_id);
    const dias = d.rupturaDow.filter((x) => x.loja_id === maiorVp.loja_id).sort((a, b) => b.taxa_ruptura_pct - a.taxa_ruptura_pct);
    out.push({
      id: "loja-ruptura",
      tom: "atencao",
      titulo: `${lojaCurta(maiorVp.nome)} perde mais venda por falta de produto`,
      texto: `Venda perdida de ${pct(maiorVp.venda_perdida_pct_receita, 2)} da receita (demais: ${pct(media(outras.map((l) => l.venda_perdida_pct_receita)), 2)}).${dias[0] ? ` O pior dia é ${diaLongo(dias[0].dia)}, com ${pct(dias[0].taxa_ruptura_pct)} de ruptura.` : ""}`,
      view: "ruptura",
      reais: (((maiorVp.venda_perdida_pct_receita - media(outras.map((l) => l.venda_perdida_pct_receita))) / 100) * maiorVp.receita * d.meta.resumo.margem_bruta_pct) / 100,
      reaisRot: "margem em risco acima das outras lojas, por ano",
      dono: `Gerente ${lojaCurta(maiorVp.nome)}`,
      itens: dias.slice(0, 3).map((x) => ({ nome: cap1(diaLongo(x.dia)), valor: `${pct(x.taxa_ruptura_pct)} de ruptura` })),
    });
  }

  // 5. Perecíveis
  const per = d.categorias.filter((c) => c.perecivel);
  const nao = d.categorias.filter((c) => !c.perecivel);
  if (per.length && nao.length) {
    const pc = (xs: typeof per) => (100 * xs.reduce((a, c) => a + (c.perda_pct_receita * c.receita) / 100, 0)) / xs.reduce((a, c) => a + c.receita, 0);
    const pior = [...per].sort((a, b) => b.margem_bruta_pct - b.margem_real_pct - (a.margem_bruta_pct - a.margem_real_pct))[0];
    out.push({
      id: "perecíveis",
      tom: "atencao",
      titulo: `Perecíveis perdem ${pct(pc(per))} da receita; o resto, ${pct(pc(nao))}`,
      texto: `${pior.categoria} cai de ${pct(pior.margem_bruta_pct)} de margem bruta para ${pct(pior.margem_real_pct)} depois da perda (${pp(pior.margem_real_pct - pior.margem_bruta_pct)}).`,
      view: "perdas",
      reais: per.reduce((a, c) => a + (c.perda_pct_receita * c.receita) / 100, 0),
      reaisRot: "perda a custo nos perecíveis, por ano",
      dono: "Gerente de perecíveis",
      itens: [...per].sort((a, b) => b.perda_pct_receita - a.perda_pct_receita).slice(0, 4).map((c) => ({ nome: c.categoria, valor: `${pct(c.perda_pct_receita)} da receita` })),
    });
  }

  // 6. Caixas
  const gaps = d.horario.filter((h) => h.gap >= 1);
  if (gaps.length) {
    const dias = Array.from(new Set(gaps.map((g) => diaLongo(g.dia))));
    const pior = [...gaps].sort((a, b) => b.gap - a.gap)[0];
    out.push({
      id: "caixas",
      tom: "info",
      titulo: `${gaps.length} faixas de hora com falta de caixa${dias.length <= 2 ? `, só em ${dias.join(" e ")}` : ""}`,
      texto: `O pior caso é ${lojaNome(pior.loja_id)} ${emDia(pior.dia)} às ${pior.hora}h: ${pior.caixas_necessarios} caixas necessários e ${pior.caixas_escalados} escalados.`,
      view: "lojas",
      reais: null,
      reaisRot: "",
      dono: "Gerente de operações",
      itens: [...gaps].sort((a, b) => b.gap - a.gap).slice(0, 3).map((g) => ({ nome: `${lojaNome(g.loja_id)} · ${diaLongo(g.dia)} ${g.hora}h`, valor: `faltam ${g.gap} caixa${g.gap > 1 ? "s" : ""}` })),
    });
  }

  // 7. Alertas
  const r1 = d.alertas.contagem_por_loja_regra.filter((c) => c.regra === "R1").reduce((a, c) => a + c.n, 0);
  out.push({
    id: "alertas",
    tom: "info",
    titulo: `${int(d.alertas.total_eventos)} alertas no estoque de fechamento`,
    texto: `${int(r1)} são de ruptura iminente em item classe A. É o que a automação enviaria ao gerente na manhã seguinte.`,
    view: "alertas",
    reais: d.alertas.eventos_destaque.reduce((acc, e) => acc + e.impacto_rs, 0),
    reaisRot: "em risco no estoque de hoje (destaques)",
    dono: "Compras e gerentes de loja",
    itens: [...d.alertas.eventos_destaque].sort((x, y) => y.impacto_rs - x.impacto_rs).slice(0, 4).map((e) => ({ nome: `${e.produto} · ${lojaNome(e.loja_id)}`, valor: brlCompact(e.impacto_rs) })),
  });

  return out;
}

/** Texto curto do ganho simulado, para o card do simulador. */
export function textoGanho(g: Ganho): string {
  return `${brlCompact(g.total)} por ano, ${dec(g.ppMargem, 2)} p.p. de margem real`;
}

/* ───────────── simulador com custo da ação ───────────── */

export interface Premissas {
  recuperarPct: number;
  reduzirPerdaPct: number;
  /** margem bruta sobre a venda recuperada, % */
  margemPct: number;
  /** dias de estoque extra necessários para segurar a venda recuperada */
  diasEstoque: number;
  /** custo do capital parado, % ao ano */
  capitalAnoPct: number;
  /** perda por vencimento sobre o custo da venda recuperada, % */
  perdaExtraPct: number;
  /** compra emergencial, frete e transferência, % da margem recuperada */
  custoOperacionalPct: number;
  /** remarcação e processo para reduzir perda, % da economia */
  custoAcaoPct: number;
}

export const premissasPadrao = (d: Dados): Premissas => ({
  recuperarPct: 30,
  reduzirPerdaPct: 20,
  margemPct: Math.round(d.meta.resumo.margem_bruta_pct * 10) / 10,
  diasEstoque: 4,
  capitalAnoPct: 14,
  perdaExtraPct: 2,
  custoOperacionalPct: 10,
  custoAcaoPct: 25,
});

export interface GanhoLiquido {
  margemRecuperada: number;
  perdaEvitada: number;
  bruto: number;
  custoOperacional: number;
  custoCapital: number;
  perdaExtra: number;
  custoAcao: number;
  custos: number;
  liquido: number;
  ppMargem: number;
  estoqueExtra: number;
}

/** Ganho bruto menos o que a ação custa: estoque parado, vencimento extra, operação e remarcação. */
export function ganhoLiquido(d: Dados, p: Premissas): GanhoLiquido {
  const r = d.meta.resumo;
  const vendaRec = (r.venda_perdida * p.recuperarPct) / 100;
  const margemRecuperada = (vendaRec * p.margemPct) / 100;
  const custoRec = vendaRec * (1 - p.margemPct / 100);
  const estoqueExtra = (custoRec / 365) * p.diasEstoque;
  const custoCapital = (estoqueExtra * p.capitalAnoPct) / 100;
  const perdaExtra = (custoRec * p.perdaExtraPct) / 100;
  const custoOperacional = (margemRecuperada * p.custoOperacionalPct) / 100;
  const perdaEvitada = (r.perda_custo * p.reduzirPerdaPct) / 100;
  const custoAcao = (perdaEvitada * p.custoAcaoPct) / 100;
  const bruto = margemRecuperada + perdaEvitada;
  const custos = custoCapital + perdaExtra + custoOperacional + custoAcao;
  const liquido = bruto - custos;
  return { margemRecuperada, perdaEvitada, bruto, custoOperacional, custoCapital, perdaExtra, custoAcao, custos, liquido, ppMargem: (100 * liquido) / r.receita, estoqueExtra };
}
