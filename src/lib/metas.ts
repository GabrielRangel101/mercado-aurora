// Metas de exemplo da rede fictícia. São premissas do autor (num cliente real viriam do orçamento);
// o painel as mostra como "meta" para que cada indicador tenha uma régua.
export const METAS = {
  margem_real_pct: 25.0,
  perda_pct: 1.5,
  ruptura_pct: 3.0,
  ruptura_A_pct: 2.0,
  venda_perdida_pct: 1.0,
} as const;

export type ChaveMeta = keyof typeof METAS;
export type StatusMeta = "ok" | "atencao" | "ruim";

/** Tolerância relativa da faixa "atenção" (acima/abaixo da meta, conforme a direção). */
const TOL: Record<ChaveMeta, number> = { margem_real_pct: 0.02, perda_pct: 0.1, ruptura_pct: 0.1, ruptura_A_pct: 0.1, venda_perdida_pct: 0.2 };

/** "alto" = quanto maior, pior (perda, ruptura). "baixo" = quanto menor, pior (margem). */
const PIOR: Record<ChaveMeta, "alto" | "baixo"> = { margem_real_pct: "baixo", perda_pct: "alto", ruptura_pct: "alto", ruptura_A_pct: "alto", venda_perdida_pct: "alto" };

export interface AvaliacaoMeta {
  meta: number;
  /** valor − meta, na unidade do indicador (p.p.) */
  gap: number;
  status: StatusMeta;
}

export function avaliarMeta(chave: ChaveMeta, valor: number): AvaliacaoMeta {
  const meta = METAS[chave];
  const gap = valor - meta;
  const tol = TOL[chave];
  let status: StatusMeta;
  if (PIOR[chave] === "alto") status = valor <= meta ? "ok" : valor <= meta * (1 + tol) ? "atencao" : "ruim";
  else status = valor >= meta ? "ok" : valor >= meta * (1 - tol) ? "atencao" : "ruim";
  return { meta, gap, status };
}
