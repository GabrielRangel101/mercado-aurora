import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { avaliarMeta } from "../lib/metas";
import { PERIODOS, ponteMargem, resumir, serieMensal, ultimosMeses } from "../lib/geral";
import { gerarInsights, ganhoLiquido, ganhoSimulado, premissasPadrao } from "../lib/insights";
import type { Dados, VendaDia } from "../lib/types";

const dir = join(__dirname, "..", "data");
const j = (f: string) => JSON.parse(readFileSync(join(dir, f), "utf8"));
const d = {
  meta: j("meta.json"), kpisMensais: j("kpis_mensais.json"), categorias: j("categorias.json"), lojas: j("lojas.json"),
  lojaCategoria: j("loja_categoria.json"), curvaAbc: j("curva_abc.json"), rupturaSemanal: j("ruptura_semanal.json"),
  rupturaDow: j("ruptura_dia_semana.json"), rupturaSkus: j("ruptura_skus.json"), perdasMes: j("perdas_mensal_categoria.json"),
  perdasMotivos: j("perdas_motivos.json"), cesta: j("cesta.json"), horario: j("horario_caixas.json"), alertas: j("alertas.json"),
} as unknown as Dados;
const diarias = j("vendas_diarias_loja.json") as VendaDia[];

describe("metas", () => {
  it("classifica os KPIs da rede", () => {
    const r = d.meta.resumo;
    expect(avaliarMeta("perda_pct", r.perda_pct_receita).status).toBe("ruim");
    expect(avaliarMeta("margem_real_pct", r.margem_real_pct).status).toBe("atencao");
    expect(avaliarMeta("ruptura_pct", 2.5).status).toBe("ok");
  });
});

describe("visão geral", () => {
  it("12 meses da rede reproduz o resumo", () => {
    const r = resumir(ultimosMeses(serieMensal(d, null, 0), "12m"));
    expect(r.receita).toBeCloseTo(d.meta.resumo.receita, -2);
    expect(r.margem_real_pct).toBeCloseTo(d.meta.resumo.margem_real_pct, 1);
  });
  it("ponte fecha na margem real em todos os recortes", () => {
    for (const loja of [0, 1, 2, 3, 4])
      for (const p of PERIODOS) {
        const sel = ultimosMeses(serieMensal(d, loja ? diarias : null, loja), p.id);
        const res = resumir(sel);
        const ponte = ponteMargem(d, loja, sel.map((m) => m.mes), res);
        const fim = ponte[ponte.length - 1];
        expect(fim.valor).toBeCloseTo(res.margem_real_pct, 1);
        const soma = ponte[0].valor + ponte.slice(1, -1).reduce((a, x) => a + x.pp, 0);
        expect(soma).toBeCloseTo(fim.valor, 1);
      }
  });
});

describe("ganho líquido", () => {
  it("é menor que o bruto e o bruto bate com o simulador antigo", () => {
    const p = premissasPadrao(d);
    const g = ganhoLiquido(d, p);
    expect(g.liquido).toBeLessThan(g.bruto);
    expect(g.liquido).toBeGreaterThan(0);
    expect(g.bruto).toBeCloseTo(ganhoSimulado(d, p.recuperarPct, p.reduzirPerdaPct).total, -2);
  });
  it("sinais trazem dinheiro, responsável e itens", () => {
    for (const i of gerarInsights(d)) {
      expect(i.dono.length).toBeGreaterThan(0);
      if (i.reais !== null) expect(i.reaisRot.length).toBeGreaterThan(0);
    }
  });
});
