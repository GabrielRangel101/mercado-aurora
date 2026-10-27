// Agregações da Visão geral com filtros de loja e período. Puro (sem React, sem alias "@").
import type { Dados, VendaDia } from "./types";

export type PeriodoId = "12m" | "6m" | "3m" | "1m";
export const PERIODOS: { id: PeriodoId; label: string; meses: number }[] = [
  { id: "12m", label: "12 meses", meses: 12 },
  { id: "6m", label: "6 meses", meses: 6 },
  { id: "3m", label: "3 meses", meses: 3 },
  { id: "1m", label: "Último mês", meses: 1 },
];

export interface MesAgg {
  mes: string;
  receita: number;
  margem: number; // R$ de margem bruta
  perda: number; // R$ a custo
  vp: number; // venda perdida
  cupons: number;
  ruptura: number; // taxa, %
}

export interface ResumoGeral {
  receita: number;
  margem_bruta_pct: number;
  perda_pct: number;
  perda_custo: number;
  margem_real_pct: number;
  ruptura_pct: number;
  venda_perdida: number;
  venda_perdida_pct: number;
  cupons: number;
}

const safe = (a: number, b: number): number => (b ? a / b : 0);

/** Série mensal da rede (loja = 0) ou de uma loja. Para uma loja precisa da série diária. */
export function serieMensal(d: Dados, diarias: VendaDia[] | null, loja: number): MesAgg[] {
  if (loja === 0) {
    return d.kpisMensais.map((m) => ({
      mes: m.mes,
      receita: m.receita,
      margem: (m.receita * m.margem_bruta_pct) / 100,
      perda: (m.receita * m.perda_pct_receita) / 100,
      vp: m.venda_perdida,
      cupons: m.cupons,
      ruptura: m.taxa_ruptura_pct,
    }));
  }
  if (!diarias) return [];
  const mapa = new Map<string, MesAgg>();
  for (const x of diarias) {
    if (x.loja_id !== loja) continue;
    const mes = x.data.slice(0, 7);
    const a = mapa.get(mes) ?? { mes, receita: 0, margem: 0, perda: 0, vp: 0, cupons: 0, ruptura: 0 };
    a.receita += x.receita;
    a.margem += x.margem_valor;
    a.perda += x.perda_custo;
    a.vp += x.venda_perdida;
    a.cupons += x.cupons;
    mapa.set(mes, a);
  }
  const rup = new Map<string, { s: number; n: number }>();
  for (const r of d.rupturaSemanal) {
    if (r.loja_id !== loja) continue;
    const mes = r.semana.slice(0, 7);
    const a = rup.get(mes) ?? { s: 0, n: 0 };
    a.s += r.taxa_ruptura_pct;
    a.n += 1;
    rup.set(mes, a);
  }
  return [...mapa.values()]
    .sort((a, b) => a.mes.localeCompare(b.mes))
    .map((m) => ({ ...m, ruptura: safe(rup.get(m.mes)?.s ?? 0, rup.get(m.mes)?.n ?? 0) }));
}

export function ultimosMeses(serie: MesAgg[], periodo: PeriodoId): MesAgg[] {
  const n = PERIODOS.find((p) => p.id === periodo)?.meses ?? 12;
  return serie.slice(-n);
}

export function resumir(serie: MesAgg[]): ResumoGeral {
  const receita = serie.reduce((a, m) => a + m.receita, 0);
  const margem = serie.reduce((a, m) => a + m.margem, 0);
  const perda = serie.reduce((a, m) => a + m.perda, 0);
  const vp = serie.reduce((a, m) => a + m.vp, 0);
  const rup = safe(
    serie.reduce((a, m) => a + m.ruptura * m.receita, 0),
    receita,
  );
  return {
    receita,
    margem_bruta_pct: 100 * safe(margem, receita),
    perda_pct: 100 * safe(perda, receita),
    perda_custo: perda,
    margem_real_pct: 100 * safe(margem - perda, receita),
    ruptura_pct: rup,
    venda_perdida: vp,
    venda_perdida_pct: 100 * safe(vp, receita),
    cupons: serie.reduce((a, m) => a + m.cupons, 0),
  };
}

export interface PassoPonte {
  nome: string;
  /** base invisível da barra */
  base: number;
  valor: number;
  tipo: "total" | "queda";
  /** p.p. de margem */
  pp: number;
}

/**
 * Ponte da margem em cascata: margem bruta → perda por motivo → margem real.
 * Os motivos são rateio por regra (ver meta). Com uma loja, cada categoria usa a perda da loja
 * naquela categoria como peso.
 */
export function ponteMargem(d: Dados, loja: number, meses: string[], resumo: ResumoGeral): PassoPonte[] {
  const sel = new Set(meses);
  const pesoLoja = new Map<string, number>(); // categoria -> fração da perda da categoria que é da loja
  if (loja > 0) {
    for (const c of d.categorias) {
      const total = d.lojaCategoria.filter((x) => x.categoria === c.categoria).reduce((a, x) => a + (x.receita * x.perda_pct_receita) / 100, 0);
      const l = d.lojaCategoria.find((x) => x.loja_id === loja && x.categoria === c.categoria);
      pesoLoja.set(c.categoria, safe(l ? (l.receita * l.perda_pct_receita) / 100 : 0, total));
    }
  }
  const porMotivo = new Map<string, number>();
  for (const p of d.perdasMotivos) {
    if (!sel.has(p.mes)) continue;
    const w = loja > 0 ? (pesoLoja.get(p.categoria) ?? 0) : 1;
    porMotivo.set(p.motivo, (porMotivo.get(p.motivo) ?? 0) + p.valor_custo * w);
  }
  const totalMot = [...porMotivo.values()].reduce((a, b) => a + b, 0);
  // fecha a ponte exatamente: escala os motivos para somarem a perda do período
  const k = totalMot ? resumo.perda_custo / totalMot : 0;
  const ordem = [...porMotivo.entries()].sort((a, b) => b[1] - a[1]);
  const curto: Record<string, string> = { "Quebra operacional": "Quebra oper.", "Furto/Desvio": "Furto" };
  const passos: PassoPonte[] = [{ nome: "Margem bruta", base: 0, valor: resumo.margem_bruta_pct, tipo: "total", pp: resumo.margem_bruta_pct }];
  let atual = resumo.margem_bruta_pct;
  for (const [motivo, valor] of ordem) {
    const pp = (100 * valor * k) / resumo.receita;
    atual -= pp;
    passos.push({ nome: curto[motivo] ?? motivo, base: atual, valor: pp, tipo: "queda", pp: -pp });
  }
  passos.push({ nome: "Margem real", base: 0, valor: atual, tipo: "total", pp: atual });
  return passos;
}
