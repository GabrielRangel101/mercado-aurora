import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ganhoSimulado, gerarInsights, LIMITE_TRAFEGO, resumoAbc, trafego } from "../lib/insights";
import type { Dados } from "../lib/types";

const dir = join(__dirname, "..", "data");
const j = (f: string) => JSON.parse(readFileSync(join(dir, f), "utf8"));

const d = {
  meta: j("meta.json"),
  kpisMensais: j("kpis_mensais.json"),
  categorias: j("categorias.json"),
  lojas: j("lojas.json"),
  lojaCategoria: j("loja_categoria.json"),
  curvaAbc: j("curva_abc.json"),
  rupturaSemanal: j("ruptura_semanal.json"),
  rupturaDow: j("ruptura_dia_semana.json"),
  rupturaSkus: j("ruptura_skus.json"),
  perdasMes: j("perdas_mensal_categoria.json"),
  perdasMotivos: j("perdas_motivos.json"),
  cesta: j("cesta.json"),
  horario: j("horario_caixas.json"),
  alertas: j("alertas.json"),
  rupturaCausas: j("ruptura_causas.json"), marcas: j("marcas.json"), caixasPremissas: j("caixas_premissas.json"),
} as Dados;

describe("dados gerados", () => {
  it("a margem real é a bruta menos a perda", () => {
    const r = d.meta.resumo;
    expect(r.margem_real_pct).toBeCloseTo(r.margem_bruta_pct - r.perda_pct_receita, 1);
  });

  it("as lojas somam a receita da rede", () => {
    const soma = d.lojas.reduce((a, l) => a + l.receita, 0);
    expect(soma).toBeCloseTo(d.meta.resumo.receita, -2);
  });

  it("os meses somam a receita da rede", () => {
    const soma = d.kpisMensais.reduce((a, m) => a + m.receita, 0);
    expect(soma).toBeCloseTo(d.meta.resumo.receita, -2);
  });

  it("a curva ABC fecha em 100% e a classe A cobre cerca de 80%", () => {
    const abc = d.curvaAbc;
    expect(abc[abc.length - 1].pct_acum).toBeCloseTo(100, 0);
    const a = resumoAbc(abc)[0];
    expect(a.receitaPct).toBeGreaterThan(78);
    expect(a.receitaPct).toBeLessThan(86);
  });
});

describe("leituras automáticas", () => {
  const ins = gerarInsights(d);

  it("gera as oito leituras com título e texto", () => {
    expect(ins).toHaveLength(8);
    for (const i of ins) {
      expect(i.titulo.length).toBeGreaterThan(10);
      expect(i.texto.length).toBeGreaterThan(10);
      expect(i.titulo).not.toContain("NaN");
      expect(i.texto).not.toContain("NaN");
      expect(i.texto).not.toContain("undefined");
    }
  });

  it("aponta a loja com maior perda e traz o número do JSON", () => {
    const pior = [...d.lojas].sort((a, b) => b.perda_pct_receita - a.perda_pct_receita)[0];
    const i = ins.find((x) => x.id === "compra-em-excesso");
    expect(i?.titulo).toContain(pior.nome.replace("Aurora ", ""));
  });

  it("os itens de tráfego têm muita receita e pouca margem", () => {
    const t = trafego(d.curvaAbc);
    expect(t.skus).toBeGreaterThan(5);
    expect(t.margemRealPct).toBeLessThan(t.receitaPct);
    expect(t.margemMediaPct).toBeLessThan(LIMITE_TRAFEGO);
  });
});

describe("simulador", () => {
  it("sem alavancas não há ganho", () => {
    expect(ganhoSimulado(d, 0, 0).total).toBe(0);
  });

  it("o ganho cresce com as alavancas e é a soma das duas partes", () => {
    const a = ganhoSimulado(d, 30, 20);
    const b = ganhoSimulado(d, 60, 40);
    expect(b.total).toBeGreaterThan(a.total);
    expect(a.total).toBeCloseTo(a.margemRecuperada + a.perdaEvitada, 6);
    expect(a.ppMargem).toBeGreaterThan(0);
  });
});
