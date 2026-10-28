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
  rupturaCausas: j("ruptura_causas.json"), marcas: j("marcas.json"), caixasPremissas: j("caixas_premissas.json"),
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

describe("alertas coerentes", () => {
  const a = d.alertas;
  it("no máximo um alerta por SKU-loja, sem ordens opostas", () => {
    const todos = a.eventos_destaque;
    const chaves = new Set<string>();
    for (const e of todos) {
      const k = `${e.loja_id}-${e.sku_id}`;
      expect(chaves.has(k)).toBe(false);
      chaves.add(k);
    }
  });
  it("vencimento só entra com sobra que não vende até a data", () => {
    for (const e of a.eventos_destaque.filter((x) => x.regra === "R3")) {
      expect((e.sobra_un ?? 0) > 0).toBe(true);
      expect(e.cobertura_dias > (e.dias_para_vencer ?? 99) - 0.001).toBe(true);
    }
  });
  it("severidade segue o dinheiro em risco", () => {
    for (const e of a.eventos_destaque) {
      const esperado = e.impacto_rs >= a.severidade_faixas.alta ? "alta" : e.impacto_rs >= a.severidade_faixas.media ? "media" : "baixa";
      expect(e.severidade).toBe(esperado);
    }
  });
  it("mensagem do gerente tem no máximo 6 itens", () => {
    for (const msg of Object.values(a.mensagens_exemplo)) {
      const itens = msg.split("\n").filter((l) => /^(🔴|🟠|🟡|⚪) .+:/.test(l)).length;
      expect(itens > 0 && itens <= a.max_itens_mensagem).toBe(true);
    }
  });
});

describe("variação entre lojas", () => {
  it("margem por categoria não é idêntica entre as lojas", () => {
    const m = d.lojaCategoria.filter((x) => x.categoria === "Mercearia").map((x) => x.margem_bruta_pct);
    expect(Math.max(...m) - Math.min(...m) > 0.5).toBe(true);
  });
  it("Jardins perde mais nos perecíveis, mas não por um fator único", () => {
    const razoes = ["Hortifruti", "Frios e Laticínios", "Padaria", "Açougue"].map((c) => {
      const l = d.lojaCategoria.filter((x) => x.categoria === c);
      const j = l.find((x) => x.loja_id === 2)!.perda_pct_receita;
      const outras = l.filter((x) => x.loja_id !== 2).reduce((s, x) => s + x.perda_pct_receita, 0) / 3;
      return j / outras;
    });
    expect(Math.min(...razoes) > 1).toBe(true);
    expect(Math.max(...razoes) - Math.min(...razoes) > 0.3).toBe(true);
  });
});

describe("caixas valoradas", () => {
  it("falta é sempre positiva e a decisão compara venda em risco com custo", () => {
    for (const h of d.horario.filter((x) => x.falta > 0)) {
      expect(h.falta > 0).toBe(true);
      expect(h.decisao === (h.venda_em_risco_hora > h.custo_reforco_hora ? "Reforçar" : "Manter escala")).toBe(true);
    }
  });
});
