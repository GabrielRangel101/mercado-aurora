// Motor do Modo IA: entende a pergunta (regras + sinônimos), escolhe a tabela certa, calcula e redige.
// Princípio: a "IA" nunca inventa número. Quem calcula é este módulo, sobre os mesmos JSONs do painel.
// `Consulta` é um JSON estruturado: um LLM (Claude via Edge Function) pode substituir só `interpretar()` e
// reaproveitar `executar()` sem mexer em mais nada.
// Puro (sem React, sem alias "@"), testado em src/test/ask.test.ts.
import { brlCompact, dec, int, mesLabel, pct, pp } from "./format";
import { diaLongo, ganhoLiquido, ganhoSimulado, gerarInsights, lojaCurta, premissasPadrao, type ViewId } from "./insights";
import type { Dados, VendaDia, VendaSemana } from "./types";

/* ───────────────────────── tipos públicos ───────────────────────── */

export interface Fontes {
  d: Dados;
  diarias: VendaDia[];
  semanais: VendaSemana[];
}

export type Dim = "loja" | "categoria" | "mes" | "dow" | "classe" | "marca" | "sku" | "motivo";

export type MedidaId =
  | "receita"
  | "margem_bruta"
  | "margem_real"
  | "margem_real_valor"
  | "perda"
  | "perda_valor"
  | "venda_perdida"
  | "ruptura"
  | "ticket"
  | "cupons"
  | "qtd"
  | "dias_ruptura"
  | "giro"
  | "cobertura";

export interface Filtros {
  loja?: number[];
  categoria?: string[];
  mes?: string[];
  dow?: number[];
  classe?: string[];
  marca?: string[];
  motivo?: string[];
  termos?: string[];
  periodo?: { de: string; ate: string; rotulo: string };
}

export interface Consulta {
  medida: MedidaId | null;
  filtros: Filtros;
  grupo: Dim | null;
  op: "valor" | "rank" | "tendencia" | "comparar";
  ordem: "desc" | "asc";
  n: number;
  /** em dia da semana e mês sem superlativo, mantém a ordem do calendário */
  cron?: boolean;
}

export type Bloco =
  | { tipo: "stats"; itens: { rotulo: string; valor: string; sub?: string }[] }
  | { tipo: "barras"; itens: { rotulo: string; valor: number; texto: string; sub?: string }[]; destaque?: number }
  | { tipo: "linha"; pontos: { x: string; y: number }[]; rotuloY: string; formato: "brl" | "pct" | "int" | "dec" }
  | { tipo: "tabela"; colunas: string[]; linhas: string[][] };

export interface Resposta {
  pergunta: string;
  titulo: string;
  texto: string;
  blocos: Bloco[];
  seguintes: string[];
  /** ok: respondida com o dado; parcial: respondida com ressalva; fora: não existe no dado */
  cobertura: "ok" | "parcial" | "fora";
  fonte: string;
  view?: ViewId;
  consulta?: Consulta;
}

/* ───────────────────────── texto ───────────────────────── */

export function norm(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9%$/\s.-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const tem = (t: string, re: RegExp): boolean => re.test(t);
const cap = (s: string): string => (s ? s[0].toUpperCase() + s.slice(1) : s);

const DOW = ["Seg", "Ter", "Qua", "Qui", "Sex", "Sab", "Dom"];
const DOW_RE: [RegExp, number][] = [
  [/\bsegunda/, 0],
  [/\bterca/, 1],
  [/\bquarta/, 2],
  [/\bquinta/, 3],
  [/\bsexta/, 4],
  [/\bsabado/, 5],
  [/\bdomingo/, 6],
];

const MESES_NOME: [RegExp, number][] = [
  [/\bjan(eiro)?\b/, 1],
  [/\bfev(ereiro)?\b/, 2],
  [/\bmar(co)?\b/, 3],
  [/\babr(il)?\b/, 4],
  [/\bmai(o)?\b/, 5],
  [/\bjun(ho)?\b/, 6],
  [/\bjul(ho)?\b/, 7],
  [/\bago(sto)?\b/, 8],
  [/\bset(embro)?\b/, 9],
  [/\bout(ubro)?\b/, 10],
  [/\bnov(embro)?\b/, 11],
  [/\bdez(embro)?\b/, 12],
];

/** Mês do período (out/25 a set/26): outubro a dezembro caem em 2025, o resto em 2026. */
function mesIso(m: number, d: Dados): string {
  const ini = d.meta.periodo.inicio; // 2025-10-01
  const y0 = Number(ini.slice(0, 4));
  const m0 = Number(ini.slice(5, 7));
  const y = m >= m0 ? y0 : y0 + 1;
  return `${y}-${String(m).padStart(2, "0")}`;
}

const EVENTOS: { re: RegExp; de: string; ate: string; rotulo: string }[] = [
  { re: /black\s*friday/, de: "2025-11-24", ate: "2025-11-30", rotulo: "Black Friday (24 a 30/11)" },
  { re: /natal/, de: "2025-12-22", ate: "2025-12-28", rotulo: "semana do Natal (22 a 28/12)" },
  { re: /pascoa/, de: "2026-03-30", ate: "2026-04-05", rotulo: "semana da Páscoa (30/03 a 05/04)" },
];

const CATEGORIAS_SIN: [RegExp, string][] = [
  [/mercearia/, "Mercearia"],
  [/bebida|refrigerante|cerveja/, "Bebidas"],
  [/frios|laticinio|lacteo/, "Frios e Laticínios"],
  [/acougue|\bcarnes?\b/, "Açougue"],
  [/hortifruti|\bflv\b|verdura|\bfrutas?\b|legume/, "Hortifruti"],
  [/padaria/, "Padaria"],
  [/\blimpeza\b/, "Limpeza"],
  [/higiene|beleza/, "Higiene e Beleza"],
  [/congelad/, "Congelados"],
  [/biscoito|matinais?/, "Biscoitos e Matinais"],
  [/\bbazar\b/, "Bazar"],
  [/\bpet\b/, "Pet"],
];

const MOTIVOS: [RegExp, string][] = [
  [/vencimento|vencid|validade|vencer/, "Vencimento"],
  [/avaria|danificad/, "Avaria"],
  [/furto|desvio|roubo/, "Furto/Desvio"],
  [/quebra operacional|operacional/, "Quebra operacional"],
];

const STOP = new Set(
  (
    "de da do das dos a o as os e em no na nos nas um uma uns umas por para pra com sem sobre entre que qual quais quanto quantos quantas como onde quando se foi sao ser tem temos ha " +
    "mais menos maior menor melhor pior top ranking me diga mostre mostra mostrar fale qual quem mim nos nosso nossa nossos nossas rede toda todo todos todas ano mes meses dia dias " +
    "vs versus contra ao aos aquele esse essa isso isto meu minha esta este est tudo algo cada ultimo ultimos ultima mesmo mesma tambem so apenas ainda ja muito pouco ver vai vou deu era ele ela fim uso pro tao tal vem foram sera tinha concentram concentra pesam pesa " +
    "loja lojas categoria categorias produto produtos sku skus item itens marca marcas classe curva receita faturamento venda vendas vendemos vendeu margem real bruta perda perdas perdemos " +
    "ruptura venda perdida perdidas ticket cupons cupom unidades quantidade volume giro cobertura estoque motivo motivos semana semanas hora horario evolucao tendencia valor total media"
  ).split(" "),
);

/* ───────────────────────── medidas ───────────────────────── */

interface Soma {
  receita: number;
  margem: number;
  perda: number;
  vp: number;
  cupons: number;
  qtd: number;
  dr: number;
}
type Campo = keyof Soma;
const zero = (): Soma => ({ receita: 0, margem: 0, perda: 0, vp: 0, cupons: 0, qtd: 0, dr: 0 });

interface Calc {
  n: number;
  t: string;
  sub?: string;
}

interface MedidaDef {
  rot: string;
  /** direção que é ruim: "alto" = quanto maior, pior */
  ruim: "alto" | "baixo" | null;
  campos: Campo[];
  calc: (s: Soma) => Calc;
  fmtY: "brl" | "pct" | "int" | "dec";
  view: ViewId;
  /** valor de y para gráficos de linha */
  y: (s: Soma) => number;
}

const safe = (a: number, b: number): number => (b ? a / b : 0);

const MEDIDAS: Record<Exclude<MedidaId, "ruptura" | "giro" | "cobertura">, MedidaDef> = {
  receita: { rot: "Receita", ruim: null, campos: ["receita"], calc: (s) => ({ n: s.receita, t: brlCompact(s.receita) }), fmtY: "brl", view: "geral", y: (s) => s.receita },
  margem_bruta: {
    rot: "Margem bruta",
    ruim: null,
    campos: ["receita", "margem"],
    calc: (s) => ({ n: 100 * safe(s.margem, s.receita), t: pct(100 * safe(s.margem, s.receita)) }),
    fmtY: "pct",
    view: "margem",
    y: (s) => 100 * safe(s.margem, s.receita),
  },
  margem_real: {
    rot: "Margem real",
    ruim: null,
    campos: ["receita", "margem", "perda"],
    calc: (s) => ({ n: 100 * safe(s.margem - s.perda, s.receita), t: pct(100 * safe(s.margem - s.perda, s.receita)) }),
    fmtY: "pct",
    view: "margem",
    y: (s) => 100 * safe(s.margem - s.perda, s.receita),
  },
  margem_real_valor: {
    rot: "Margem real em R$",
    ruim: null,
    campos: ["margem", "perda"],
    calc: (s) => ({ n: s.margem - s.perda, t: brlCompact(s.margem - s.perda) }),
    fmtY: "brl",
    view: "margem",
    y: (s) => s.margem - s.perda,
  },
  perda: {
    rot: "Perda",
    ruim: "alto",
    campos: ["perda"],
    calc: (s) => (s.receita > 0 ? { n: 100 * safe(s.perda, s.receita), t: `${pct(100 * safe(s.perda, s.receita), 2)} da receita`, sub: `${brlCompact(s.perda)} a custo` } : { n: s.perda, t: brlCompact(s.perda), sub: "a custo" }),
    fmtY: "pct",
    view: "perdas",
    y: (s) => (s.receita > 0 ? 100 * safe(s.perda, s.receita) : s.perda),
  },
  perda_valor: {
    rot: "Perda em R$",
    ruim: "alto",
    campos: ["perda"],
    calc: (s) => ({ n: s.perda, t: brlCompact(s.perda), sub: s.receita > 0 ? `${pct(100 * safe(s.perda, s.receita), 2)} da receita` : undefined }),
    fmtY: "brl",
    view: "perdas",
    y: (s) => s.perda,
  },
  venda_perdida: {
    rot: "Venda perdida por ruptura",
    ruim: "alto",
    campos: ["vp"],
    calc: (s) => ({ n: s.vp, t: brlCompact(s.vp), sub: s.receita > 0 ? `${pct(100 * safe(s.vp, s.receita), 2)} da receita` : undefined }),
    fmtY: "brl",
    view: "ruptura",
    y: (s) => s.vp,
  },
  ticket: { rot: "Ticket médio", ruim: null, campos: ["receita", "cupons"], calc: (s) => ({ n: safe(s.receita, s.cupons), t: `R$ ${dec(safe(s.receita, s.cupons), 2)}` }), fmtY: "dec", view: "lojas", y: (s) => safe(s.receita, s.cupons) },
  cupons: { rot: "Cupons", ruim: null, campos: ["cupons"], calc: (s) => ({ n: s.cupons, t: int(s.cupons) }), fmtY: "int", view: "lojas", y: (s) => s.cupons },
  qtd: { rot: "Unidades vendidas", ruim: null, campos: ["qtd"], calc: (s) => ({ n: s.qtd, t: int(s.qtd) }), fmtY: "int", view: "geral", y: (s) => s.qtd },
  dias_ruptura: { rot: "Dias em ruptura", ruim: "alto", campos: ["dr"], calc: (s) => ({ n: s.dr, t: int(s.dr) }), fmtY: "int", view: "ruptura", y: (s) => s.dr },
};

const ROT_EXTRA: Record<"ruptura" | "giro" | "cobertura", { rot: string; ruim: "alto" | "baixo" | null; view: ViewId }> = {
  ruptura: { rot: "Taxa de ruptura", ruim: "alto", view: "ruptura" },
  giro: { rot: "Giro de estoque", ruim: "baixo", view: "perdas" },
  cobertura: { rot: "Cobertura média", ruim: null, view: "perdas" },
};

function rotMedida(m: MedidaId): string {
  return m === "ruptura" || m === "giro" || m === "cobertura" ? ROT_EXTRA[m].rot : MEDIDAS[m].rot;
}
function ruimDe(m: MedidaId): "alto" | "baixo" | null {
  return m === "ruptura" || m === "giro" || m === "cobertura" ? ROT_EXTRA[m].ruim : MEDIDAS[m].ruim;
}
function viewDe(m: MedidaId): ViewId {
  return m === "ruptura" || m === "giro" || m === "cobertura" ? ROT_EXTRA[m].view : MEDIDAS[m].view;
}

/* ───────────────────────── fatos (tabelas planas) ───────────────────────── */

interface Linha extends Soma {
  loja?: number;
  categoria?: string;
  mes?: string;
  dow?: number;
  data?: string;
  semana?: string;
  classe?: string;
  marca?: string;
  sku?: string;
  motivo?: string;
}

type DimF = Dim | "periodo";

interface Fato {
  id: string;
  nome: string;
  dims: DimF[];
  campos: Campo[];
  linhas: Linha[];
  nota?: string;
}

const cacheFatos = new WeakMap<Dados, Fato[]>();

function dowDe(data: string): number {
  return (new Date(`${data}T12:00:00Z`).getUTCDay() + 6) % 7;
}

function construirFatos(f: Fontes): Fato[] {
  const { d } = f;
  const base = (x: Partial<Linha>): Linha => ({ ...zero(), ...x });

  const lc: Linha[] = d.lojaCategoria.map((r) =>
    base({ loja: r.loja_id, categoria: r.categoria, receita: r.receita, margem: (r.receita * r.margem_bruta_pct) / 100, perda: (r.receita * r.perda_pct_receita) / 100, vp: r.venda_perdida }),
  );
  const fd: Linha[] = f.diarias.map((r) => base({ loja: r.loja_id, mes: r.data.slice(0, 7), dow: dowDe(r.data), data: r.data, receita: r.receita, margem: r.margem_valor, perda: r.perda_custo, vp: r.venda_perdida, cupons: r.cupons }));
  const fs: Linha[] = f.semanais.map((r) => base({ loja: r.loja_id, categoria: r.categoria, mes: r.semana.slice(0, 7), semana: r.semana, receita: r.receita, margem: r.margem_valor, perda: r.perda_custo, vp: r.venda_perdida, qtd: r.qtd }));
  const fpm: Linha[] = d.perdasMes.map((r) => base({ categoria: r.categoria, mes: r.mes, receita: r.receita, perda: r.valor_custo, qtd: r.unidades }));
  const fmot: Linha[] = d.perdasMotivos.map((r) => base({ categoria: r.categoria, mes: r.mes, motivo: r.motivo, perda: r.valor_custo, qtd: r.unidades }));
  const fsku: Linha[] = d.curvaAbc.map((s) =>
    base({ sku: s.nome, categoria: s.categoria, classe: s.classe, marca: s.marca ?? "Sem marca", receita: s.receita, margem: (s.receita * s.margem_pct) / 100, perda: (s.receita * (s.margem_pct - s.margem_real_pct)) / 100, vp: s.venda_perdida, qtd: s.qtd, dr: s.dias_ruptura }),
  );
  const classeDe = new Map(d.curvaAbc.map((s) => [s.sku_id, s]));
  const fskul: Linha[] = [];
  for (const r of d.rupturaSkus) {
    const s = classeDe.get(r.sku_id);
    const vps = [r.venda_perdida_loja1, r.venda_perdida_loja2, r.venda_perdida_loja3, r.venda_perdida_loja4];
    vps.forEach((vp, i) => fskul.push(base({ sku: r.nome, categoria: r.categoria, classe: s?.classe ?? r.classe, loja: i + 1, vp })));
  }

  return [
    { id: "FLC", nome: "vendas por loja e categoria (12 meses)", dims: ["loja", "categoria"], campos: ["receita", "margem", "perda", "vp"], linhas: lc },
    { id: "FD", nome: "vendas diárias por loja", dims: ["loja", "mes", "dow", "periodo"], campos: ["receita", "margem", "perda", "vp", "cupons"], linhas: fd },
    { id: "FPM", nome: "perdas por mês e categoria", dims: ["categoria", "mes"], campos: ["receita", "perda"], linhas: fpm },
    { id: "FS", nome: "vendas semanais por loja e categoria", dims: ["loja", "categoria", "mes", "periodo"], campos: ["receita", "margem", "perda", "vp", "qtd"], linhas: fs, nota: "Cada semana entra no mês em que começa (segunda-feira), então o corte mensal por categoria é aproximado." },
    { id: "FMOT", nome: "perdas por motivo", dims: ["categoria", "mes", "motivo"], campos: ["perda"], linhas: fmot, nota: "O motivo da perda é rateado por regra a partir do total, não medido por ocorrência." },
    { id: "FSKU", nome: "curva ABC de SKUs (12 meses)", dims: ["sku", "categoria", "classe", "marca"], campos: ["receita", "margem", "perda", "vp", "qtd", "dr"], linhas: fsku },
    { id: "FSKUL", nome: "venda perdida por SKU e loja", dims: ["sku", "categoria", "classe", "loja"], campos: ["vp"], linhas: fskul },
  ];
}

function fatos(f: Fontes): Fato[] {
  let c = cacheFatos.get(f.d);
  // o cache vale por Dados + tamanho das séries (as séries diárias/semanais chegam depois, sob demanda)
  if (!c || c[1].linhas.length !== f.diarias.length || c[3].linhas.length !== f.semanais.length) {
    c = construirFatos(f);
    cacheFatos.set(f.d, c);
  }
  return c;
}

/* ───────────────────────── filtros ───────────────────────── */

const norm1 = (s: string) => norm(s);

function dimsUsadas(g: Dim | null, fl: Filtros): DimF[] {
  const out = new Set<DimF>();
  if (g) out.add(g);
  if (fl.loja?.length) out.add("loja");
  if (fl.categoria?.length) out.add("categoria");
  if (fl.mes?.length) out.add("mes");
  if (fl.dow?.length) out.add("dow");
  if (fl.classe?.length) out.add("classe");
  if (fl.marca?.length) out.add("marca");
  if (fl.motivo?.length) out.add("motivo");
  if (fl.termos?.length) out.add("sku");
  if (fl.periodo) out.add("periodo");
  return [...out];
}

function passa(l: Linha, fl: Filtros): boolean {
  if (fl.loja?.length && !(l.loja !== undefined && fl.loja.includes(l.loja))) return false;
  if (fl.categoria?.length && !(l.categoria !== undefined && fl.categoria.includes(l.categoria))) return false;
  if (fl.mes?.length && !(l.mes !== undefined && fl.mes.includes(l.mes))) return false;
  if (fl.dow?.length && !(l.dow !== undefined && fl.dow.includes(l.dow))) return false;
  if (fl.classe?.length && !(l.classe !== undefined && fl.classe.includes(l.classe))) return false;
  if (fl.marca?.length && !(l.marca !== undefined && fl.marca.includes(l.marca))) return false;
  if (fl.motivo?.length && !(l.motivo !== undefined && fl.motivo.includes(l.motivo))) return false;
  if (fl.termos?.length) {
    const toks = norm1(l.sku ?? "").split(" ");
    if (!fl.termos.every((t) => toks.some((k) => k.startsWith(t)))) return false;
  }
  if (fl.periodo) {
    const { de, ate } = fl.periodo;
    const ref = l.data ?? l.semana;
    if (!ref || ref < de || ref > ate) return false;
  }
  return true;
}

const ORDEM_DESCARTE: DimF[] = ["periodo", "dow", "motivo", "marca", "mes", "classe", "loja", "sku", "categoria"];

function tirar(fl: Filtros, dim: DimF): Filtros {
  const c: Filtros = { ...fl };
  if (dim === "periodo") delete c.periodo;
  else if (dim === "sku") delete c.termos;
  else delete c[dim];
  return c;
}

const ROT_DIM: Record<DimF, string> = { loja: "loja", categoria: "categoria", mes: "mês", dow: "dia da semana", classe: "classe ABC", marca: "marca", sku: "produto", motivo: "motivo", periodo: "período" };

interface Escolha {
  fato: Fato;
  filtros: Filtros;
  descartados: DimF[];
}

function escolherFato(fs: Fato[], medida: Exclude<MedidaId, "ruptura" | "giro" | "cobertura">, g: Dim | null, fl: Filtros): Escolha | null {
  const campos = MEDIDAS[medida].campos;
  let filtros = fl;
  let grupo = g;
  const descartados: DimF[] = [];
  for (let tent = 0; tent < 12; tent++) {
    const dims = dimsUsadas(grupo, filtros);
    const f = fs.find((x) => dims.every((dm) => x.dims.includes(dm)) && campos.every((c) => x.campos.includes(c)));
    if (f) return { fato: f, filtros, descartados };
    const alvo = ORDEM_DESCARTE.find((dm) => dm !== grupo && dims.includes(dm));
    if (!alvo) return null;
    descartados.push(alvo);
    filtros = tirar(filtros, alvo);
  }
  return null;
}

function chaveDe(l: Linha, g: Dim): string {
  const v = l[g];
  return v === undefined ? "—" : String(v);
}

function rotuloChave(g: Dim, k: string): string {
  if (g === "loja") return lojaCurta(lojasNomes.get(Number(k)) ?? `Loja ${k}`);
  if (g === "mes") return mesLabel(k);
  if (g === "dow") return cap(diaLongo(DOW[Number(k)] ?? k));
  return k;
}
let lojasNomes = new Map<number, string>();

/* ───────────────────────── ruptura, giro, cobertura (tabelas próprias) ───────────────────────── */

interface LinhaTaxa {
  loja?: number;
  categoria?: string;
  mes?: string;
  dow?: number;
  taxa: number;
  vp: number;
  peso: number;
}

function tabelaTaxa(d: Dados, chaves: Set<string>): LinhaTaxa[] | null {
  const k = [...chaves].sort().join("+");
  if (k === "") return [{ taxa: d.meta.resumo.taxa_ruptura_pct, vp: d.meta.resumo.venda_perdida, peso: 1 }];
  if (k === "loja") return d.lojas.map((l) => ({ loja: l.loja_id, taxa: l.taxa_ruptura_pct, vp: l.venda_perdida, peso: l.receita }));
  if (k === "categoria") return d.categorias.map((c) => ({ categoria: c.categoria, taxa: c.taxa_ruptura_pct, vp: c.venda_perdida, peso: c.receita }));
  if (k === "categoria+loja") return d.lojaCategoria.map((c) => ({ loja: c.loja_id, categoria: c.categoria, taxa: c.taxa_ruptura_pct, vp: c.venda_perdida, peso: c.receita }));
  if (k === "mes") return d.kpisMensais.map((m) => ({ mes: m.mes, taxa: m.taxa_ruptura_pct, vp: m.venda_perdida, peso: m.receita }));
  if (k === "loja+mes") return d.rupturaSemanal.map((r) => ({ loja: r.loja_id, mes: r.semana.slice(0, 7), taxa: r.taxa_ruptura_pct, vp: r.venda_perdida, peso: 1 }));
  if (k === "dow") return d.rupturaDow.map((r) => ({ loja: r.loja_id, dow: r.dow, taxa: r.taxa_ruptura_pct, vp: r.venda_perdida, peso: 1 }));
  if (k === "dow+loja") return d.rupturaDow.map((r) => ({ loja: r.loja_id, dow: r.dow, taxa: r.taxa_ruptura_pct, vp: r.venda_perdida, peso: 1 }));
  return null;
}

interface ItemTaxa {
  chave: string;
  taxa: number;
  vp: number;
}

function ruptura(d: Dados, g: Dim | null, fl: Filtros): { itens: ItemTaxa[]; descartados: DimF[] } {
  const suportadas: DimF[] = ["loja", "categoria", "mes", "dow"];
  const descartados: DimF[] = [];
  let filtros = { ...fl };
  if (!g && fl.classe?.length === 1 && fl.classe[0] === "A" && dimsUsadas(null, tirar(fl, "classe")).length === 0) {
    return { itens: [{ chave: "_", taxa: d.meta.resumo.taxa_ruptura_A_pct, vp: 0 }], descartados };
  }
  if (g && !suportadas.includes(g)) descartados.push(g);
  const pedidas = dimsUsadas(g, filtros);
  for (const dm of pedidas) if (!suportadas.includes(dm) && dm !== g) descartados.push(dm);
  for (const dm of descartados) filtros = tirar(filtros, dm);
  let chaves = new Set<string>(dimsUsadas(g && suportadas.includes(g) ? g : null, filtros).filter((x) => suportadas.includes(x)));
  let linhas = tabelaTaxa(d, chaves);
  for (const dm of ["dow", "mes", "categoria", "loja"] as const) {
    if (linhas) break;
    if (dm === g) continue;
    if (!chaves.has(dm)) continue;
    chaves = new Set([...chaves].filter((c) => c !== dm));
    filtros = tirar(filtros, dm);
    descartados.push(dm);
    linhas = tabelaTaxa(d, chaves);
  }
  const base = (linhas ?? []).filter((l) => (!filtros.loja?.length || (l.loja !== undefined && filtros.loja.includes(l.loja))) && (!filtros.categoria?.length || (l.categoria !== undefined && filtros.categoria.includes(l.categoria))) && (!filtros.mes?.length || (l.mes !== undefined && filtros.mes.includes(l.mes))) && (!filtros.dow?.length || (l.dow !== undefined && filtros.dow.includes(l.dow))));
  const mapa = new Map<string, { t: number; p: number; vp: number }>();
  for (const l of base) {
    const k = g && (g === "loja" || g === "categoria" || g === "mes" || g === "dow") ? String(l[g] ?? "—") : "_";
    const a = mapa.get(k) ?? { t: 0, p: 0, vp: 0 };
    a.t += l.taxa * l.peso;
    a.p += l.peso;
    a.vp += l.vp;
    mapa.set(k, a);
  }
  return { itens: [...mapa.entries()].map(([chave, a]) => ({ chave, taxa: safe(a.t, a.p), vp: a.vp })), descartados };
}

function giroCobertura(d: Dados, medida: "giro" | "cobertura", g: Dim | null, fl: Filtros): { itens: ItemTaxa[]; descartados: DimF[] } {
  const descartados = dimsUsadas(g === "categoria" ? null : g, fl).filter((x) => x !== "categoria");
  const cats = d.categorias.filter((c) => !fl.categoria?.length || fl.categoria.includes(c.categoria));
  const v = (c: (typeof cats)[number]) => (medida === "giro" ? c.giro_estoque_ano : c.cobertura_media_dias);
  if (g === "categoria") return { itens: cats.map((c) => ({ chave: c.categoria, taxa: v(c), vp: 0 })), descartados };
  const peso = cats.reduce((a, c) => a + c.receita, 0);
  return { itens: [{ chave: "_", taxa: safe(cats.reduce((a, c) => a + v(c) * c.receita, 0), peso), vp: 0 }], descartados };
}

/* ───────────────────────── interpretação ───────────────────────── */

function detectarMedida(t: string): MedidaId | null {
  if (tem(t, /dias? (de |em )?(ruptura|falta)|dias sem estoque/)) return "dias_ruptura";
  if (tem(t, /venda\s*perdida|vendas\s*perdidas|deixamos de vender|deixou de vender|receita perdida|dinheiro perdido por (falta|ruptura)/)) return "venda_perdida";
  if (tem(t, /ruptura|em falta|faltou|falta de produto|sem estoque|desabastec|gondola vazia/)) return "ruptura";
  if (tem(t, /margem (em )?(r\$|reais|valor)|lucro|quanto sobra|quanto ganh/)) return "margem_real_valor";
  if (tem(t, /margem bruta|markup/)) return "margem_bruta";
  if (tem(t, /margem/)) return "margem_real";
  if (tem(t, /perda|perdemos|perde|perdem|desperdic|quebra|furto|avaria|vencid|jogam fora|joga fora|jogou fora/)) return tem(t, /r\$|reais|valor|custo|em dinheiro|quanto/) && !tem(t, /taxa|percentual|proporcao|% da receita/) ? "perda_valor" : "perda";
  if (tem(t, /ticket|tiquete|compra media|gasto medio/)) return "ticket";
  if (tem(t, /cupom|cupons|fluxo|movimento|transac|quantos clientes|clientes atendidos/)) return "cupons";
  if (tem(t, /giro/)) return "giro";
  if (tem(t, /cobertura|dias de estoque/)) return "cobertura";
  if (tem(t, /unidades|quantidade|volume|itens vendidos|pecas/)) return "qtd";
  if (tem(t, /receita|faturamento|faturou|fatura|vendas?\b|vend(?:e|em|emos|eu|ido|idos)\b/)) return "receita";
  return null;
}

function detectarGrupo(t: string): Dim | null {
  const m = t.match(/\b(?:por|qual|quais|cada|em que|que|pior|melhor|maior|menor|principal|principais)\s+(?:(?:a|o|as|os)\s+)?(?:(?:pior|melhor|maior|menor|principal)\s+)?(loja|lojas|categoria|categorias|setor|setores|departamento|mes|meses|dia|dias|produto|produtos|sku|skus|item|itens|marca|marcas|motivo|motivos|classe|classes|secao)\b/);
  if (m) {
    const w = m[1];
    if (/^loja/.test(w)) return "loja";
    if (/^(categoria|setor|departamento|secao)/.test(w)) return "categoria";
    if (/^mes/.test(w)) return "mes";
    if (/^dia/.test(w)) return "dow";
    if (/^(produto|sku|item)/.test(w)) return "sku";
    if (/^marca/.test(w)) return "marca";
    if (/^motivo/.test(w)) return "motivo";
    if (/^classe/.test(w)) return "classe";
  }
  const np = t.match(/\b\d+\s+(skus|produtos|itens|lojas|categorias|marcas)\b/);
  if (np) return np[1] === "lojas" ? "loja" : np[1] === "categorias" ? "categoria" : np[1] === "marcas" ? "marca" : "sku";
  if (tem(t, /por dia da semana|dia da semana|dias da semana/)) return "dow";
  if (tem(t, /mes a mes|mensal|por mes|evolucao/)) return "mes";
  if (tem(t, /\b(lojas)\b/) && tem(t, /maiores|menores|melhores|piores|ranking|mais|menos|compar/)) return "loja";
  if (tem(t, /\b(categorias|setores|departamentos)\b/)) return "categoria";
  if (tem(t, /\b(produtos|skus|itens)\b/) && tem(t, /maiores|menores|melhores|piores|ranking|mais|menos|top/)) return "sku";
  if (tem(t, /\bmarcas\b/)) return "marca";
  if (tem(t, /\bmotivos\b/)) return "motivo";
  return null;
}

function extrairFiltros(t: string, d: Dados): Filtros & { multi: Dim | null } {
  const fl: Filtros = {};
  const lojas: number[] = [];
  if (/\bcentro\b/.test(t)) lojas.push(1);
  if (/\bjardins\b/.test(t)) lojas.push(2);
  if (/\bvila( nova)?\b/.test(t)) lojas.push(3);
  if (/\bportal\b/.test(t)) lojas.push(4);
  if (lojas.length) fl.loja = lojas;

  const cats = CATEGORIAS_SIN.filter(([re]) => re.test(t)).map(([, c]) => c);
  if (cats.length) fl.categoria = [...new Set(cats)];

  const meses = new Set<string>();
  for (const [re, n] of MESES_NOME) {
    const m = t.match(new RegExp(re.source + "(?:\\s*/\\s*(\\d{2,4}))?"));
    if (m) {
      const y = m[1] ? (m[1].length === 2 ? 2000 + Number(m[1]) : Number(m[1])) : undefined;
      const iso = y ? `${y}-${String(n).padStart(2, "0")}` : mesIso(n, d);
      if (d.kpisMensais.some((k) => k.mes === iso)) meses.add(iso);
    }
  }
  if (tem(t, /ultimo mes|mes passado|mes mais recente/)) meses.add(d.kpisMensais[d.kpisMensais.length - 1].mes);
  const un = t.match(/ultimos (\d+) meses/);
  if (un) for (const k of d.kpisMensais.slice(-Number(un[1]))) meses.add(k.mes);
  if (meses.size) fl.mes = [...meses].sort();

  const dows = DOW_RE.filter(([re]) => re.test(t)).map(([, i]) => i);
  if (tem(t, /fim de semana|fins de semana/)) dows.push(5, 6);
  if (dows.length) fl.dow = [...new Set(dows)].sort();

  for (const e of EVENTOS) if (e.re.test(t)) fl.periodo = { de: e.de, ate: e.ate, rotulo: e.rotulo };

  const cl = [...t.matchAll(/\b(?:classe|curva)\s+([abc])\b/g)].map((m) => m[1].toUpperCase());
  if (cl.length) fl.classe = [...new Set(cl)];

  const marcas = [...new Set(d.curvaAbc.map((s) => s.marca).filter((m): m is string => !!m && m !== "Aurora"))];
  const mm = marcas.filter((m) => t.includes(norm(m)));
  if (/\bmarca aurora\b|\baurora (marca|propria)\b|marca propria/.test(t)) mm.push("Aurora");
  if (mm.length) fl.marca = mm;

  const mot = MOTIVOS.filter(([re]) => re.test(t)).map(([, m]) => m);
  if (mot.length) fl.motivo = [...new Set(mot)];

  // termos de produto: palavras que sobram e batem com o começo de uma palavra de nome de SKU
  const usadas = new Set<string>();
  for (const [re] of [...CATEGORIAS_SIN, ...MOTIVOS, ...DOW_RE, ...MESES_NOME]) {
    const m = t.match(re);
    if (m) m[0].split(" ").forEach((w) => usadas.add(w));
  }
  const vocab = new Set<string>();
  for (const s of d.curvaAbc) for (const w of norm(s.nome).split(" ")) if (w.length >= 3 && !/^\d/.test(w)) vocab.add(w);
  const termos: string[] = [];
  for (let w of t.split(" ")) {
    if (w.length < 3 || STOP.has(w) || usadas.has(w) || /^\d/.test(w)) continue;
    if (/^(centro|jardins|vila|nova|portal|natal|pascoa|black|friday|semana|domingo|sabado|segunda|terca|quarta|quinta|sexta|aurora)$/.test(w)) continue;
    const sing = w.endsWith("s") && w.length > 4 ? w.slice(0, -1) : w;
    const alvo = [w, sing].find((x) => [...vocab].some((v) => v.startsWith(x)));
    if (alvo) termos.push(alvo);
  }
  if (termos.length) fl.termos = termos;

  const multi: Dim | null = lojas.length > 1 ? "loja" : (fl.categoria?.length ?? 0) > 1 ? "categoria" : (fl.mes?.length ?? 0) > 1 && !un && !tem(t, /ultimos/) ? "mes" : (fl.dow?.length ?? 0) > 1 && !tem(t, /fim de semana/) ? "dow" : (fl.marca?.length ?? 0) > 1 ? "marca" : (fl.motivo?.length ?? 0) > 1 ? "motivo" : (fl.classe?.length ?? 0) > 1 ? "classe" : null;
  return { ...fl, multi };
}

function direcao(t: string, m: MedidaId | null): "desc" | "asc" {
  const ruim = m ? ruimDe(m) : null;
  if (tem(t, /\bpior(es)?\b/)) return ruim === "baixo" ? "asc" : ruim === "alto" ? "desc" : "asc";
  if (tem(t, /\bmelhor(es)?\b/)) return ruim === "alto" ? "asc" : "desc";
  if (tem(t, /\b(menor|menores|menos|minimo|mais baixa|mais baixo|menos)\b/)) return "asc";
  return "desc";
}

export function interpretar(texto: string, d: Dados, anterior?: Consulta): { consulta: Consulta; topico: Topico } {
  const t = norm(texto);
  const { multi, ...filtros } = extrairFiltros(t, d);
  const medida = detectarMedida(t);
  let grupo = detectarGrupo(t);

  const tendencia = tem(t, /evolu|tendencia|ao longo|mes a mes|semana a semana|historico|serie|cresc|caiu|queda|subiu|variou|sazonal|mensal|por mes|mes por mes/);
  const comparar = tem(t, /compar|versus|\bvs\b|\bx\b|diferenca entre|em relacao (a|ao)|contra o|contra a/) || (multi !== null && !tendencia);
  const forte = tem(t, /maior|menor|melhor|pior|top|ranking|mais|menos|lidera|primeir|campe|destaque|concentr|pesa/);
  const rank = forte || (grupo !== null && tem(t, /\b(qual|quais)\b/));

  let op: Consulta["op"] = tendencia ? "tendencia" : comparar ? "comparar" : rank ? "rank" : "valor";
  if (tem(t, /^(quanto|qual o total|qual foi o total|total)/) && !tem(t, /por |qual loja|qual categoria/)) op = tendencia ? "tendencia" : comparar ? "comparar" : "valor";

  if (op === "tendencia") grupo = "mes";
  if (op === "comparar" && multi) grupo = multi;
  // dimensão já fixada por um único valor deixa de ser agrupamento
  if (op === "rank" && grupo) {
    const val = filtros[grupo === "sku" ? "termos" : grupo];
    if (val && (val as unknown[]).length === 1 && grupo !== "sku") grupo = null;
  }
  if (op === "rank" && !grupo) {
    if (filtros.termos?.length || tem(t, /produto|sku|item|artigo/)) grupo = "sku";
    else if (!filtros.loja?.length) grupo = "loja";
    else if (!filtros.categoria?.length) grupo = "categoria";
    else grupo = "mes";
  }
  if (op === "valor" && grupo && !tem(t, /por |cada |detalh|abert/)) grupo = null;
  if (op === "valor" && grupo) op = "rank";

  const nm = t.match(/\btop\s*(\d+)|\b(\d+)\s*(?:maiores|menores|melhores|piores|primeiros|principais|skus|produtos|itens|lojas|categorias|marcas)/);
  const n = nm ? Math.min(40, Number(nm[1] ?? nm[2])) : grupo === "sku" ? 8 : 12;

  const continua = /^(e|agora|tambem|so|mesma)\b/.test(t);
  let medidaF: MedidaId | null = medida;
  if (!medidaF && (op === "rank" || op === "tendencia")) medidaF = continua ? (anterior?.medida ?? "receita") : "receita";
  if (medidaF === "ruptura" && (grupo === "sku" || grupo === "marca")) medidaF = "dias_ruptura";
  const cron = (grupo === "mes" || grupo === "dow") && !forte;

  let consulta: Consulta = { medida: medidaF, filtros, grupo, op, ordem: direcao(t, medidaF), n, cron };

  const topico = detectarTopico(t, consulta);
  // continuação: "e no Jardins?", "e em novembro?"
  if (anterior && topico === "dados" && continua && t.split(" ").length <= 9) {
    const f2: Filtros = { ...anterior.filtros, ...filtros };
    let op2 = consulta.op !== "valor" ? consulta.op : anterior.op;
    let g2: Dim | null = multi ?? grupo ?? anterior.grupo;
    if (!medida && multi && op2 === "valor") op2 = "comparar";
    if (op2 === "comparar" && !multi && g2 && g2 !== "sku" && (f2[g2]?.length ?? 0) < 2) {
      op2 = "valor";
      g2 = null;
    }
    consulta = { ...anterior, filtros: f2, op: op2, grupo: g2, medida: medida ?? anterior.medida, ordem: consulta.ordem, cron: anterior.cron };
  }
  return { consulta, topico };
}

export type Topico = "porque" | "dados" | "definicao" | "simulacao" | "resumo" | "alertas" | "cesta" | "caixas" | "causa" | "contagem" | "ajuda" | "fora";

function detectarTopico(t: string, c: Consulta): Topico {
  if (tem(t, /previs|forecast|projec|concorr|funcionari|salario|folha|imposto|aluguel|clima|pesquisa de satisf|nps|cartao de fidel|cliente [a-z]+ comprou|cpf/)) return "fora";
  if (tem(t, /fornecedor|atraso|lead ?time|prazo de entrega|no prazo|causa d[ae] (ruptura|falta)|quem aciona|estoque de seguranca|pico de demanda/) && !c.medida?.startsWith("perda")) return "causa";
  if (tem(t, /\bpor ?que\b|o que explica|qual (a )?causa|\bcausas?\b|o que (esta )?(puxando|derrubando|causando)|\bmotivo d[ao]\b/) && c.medida && ["perda", "perda_valor", "margem_real", "margem_bruta", "ruptura", "venda_perdida"].includes(c.medida)) return "porque";
  if (tem(t, /o que (e|significa|quer dizer)|como (e )?(calcul|medi)|defini|formula|explica (a |o )?(metrica|margem|ruptura|lift|curva)/)) return "definicao";
  if (tem(t, /simul|e se |se eu |se a gente|se reduzir|se recuper|quanto (vale|ganho|ganhar|economiz)|reduzir (a )?perda|recuperar/) && tem(t, /\d+\s*%|perda|ruptura|venda perdida|margem/)) return "simulacao";
  if (tem(t, /\balert|\br[0-4]\b|mensagem (ao|para o) gerente|whatsapp|vence em|vencimento proximo/)) return "alertas";
  if (tem(t, /\bcesta|junto com|comprados juntos|saem juntos|cross.?sell|combina|afinidade|\blift\b|missao de compra|missoes|\bpares?\b/)) return "cesta";
  if (tem(t, /\bcaixas?\b|\bfila\b|pico de (movimento|horario)|escala|\bhora\b|\bhorario/) && !tem(t, /dados|ticket/)) return "caixas";
  if (tem(t, /quantos (skus|produtos|itens)|quantas (lojas|categorias|marcas)|quantos meses|quantos dias|qual o periodo|periodo (dos|do) dado/)) return "contagem";
  if (tem(t, /resumo|panorama|visao geral|onde agir|principais (problemas|achados|insights)|insight|o que (devo|preciso|temos que) (olhar|fazer|priorizar)|prioridade|problema|oportunidade|destaques? (da|do)/) && !c.medida) return "resumo";
  if (tem(t, /\b(ajuda|help|o que (voce|vc) (sabe|faz|responde)|o que posso perguntar|que dados|quais dados|oi|ola|bom dia|boa tarde|boa noite)\b/) && !c.medida) return "ajuda";
  return "dados";
}

/* ───────────────────────── execução ───────────────────────── */

const FONTE_METRICA = (f: Fato) => `Fonte: ${f.nome}`;

function escopo(fl: Filtros, d: Dados): string {
  const p: string[] = [];
  if (fl.loja?.length) p.push(fl.loja.map((i) => lojaCurta(d.lojas.find((l) => l.loja_id === i)?.nome ?? `Loja ${i}`)).join(" + "));
  if (fl.categoria?.length) p.push(fl.categoria.join(" + "));
  if (fl.mes?.length) p.push(fl.mes.length > 3 ? `${mesLabel(fl.mes[0])} a ${mesLabel(fl.mes[fl.mes.length - 1])}` : fl.mes.map(mesLabel).join(" + "));
  if (fl.periodo) p.push(fl.periodo.rotulo);
  if (fl.dow?.length) p.push(fl.dow.map((i) => diaLongo(DOW[i])).join(" + "));
  if (fl.classe?.length) p.push(`classe ${fl.classe.join("/")}`);
  if (fl.marca?.length) p.push(`marca ${fl.marca.join(" + ")}`);
  if (fl.motivo?.length) p.push(fl.motivo.join(" + "));
  if (fl.termos?.length) {
    const achados = d.curvaAbc.filter((s) => passa({ ...zero(), sku: s.nome }, { termos: fl.termos })).map((s) => s.nome);
    p.push(achados.length > 0 && achados.length <= 2 ? achados.join(" + ") : `produtos "${fl.termos.join(" ")}" (${achados.length} SKUs)`);
  }
  return p.length ? p.join(" · ") : "Rede toda, 12 meses";
}

interface Item {
  chave: string;
  rot: string;
  c: Calc;
}

function aviso(desc: DimF[]): string {
  if (!desc.length) return "";
  return ` Não existe o recorte por ${desc.map((x) => ROT_DIM[x]).join(" e ")} para esta métrica; mostrei sem ele.`;
}

function calcular(consulta: Consulta, f: Fontes): { itens: Item[]; fonte: string; descartados: DimF[]; nota?: string; medida: MedidaId; total?: Calc; filtrosEf: Filtros } | null {
  const { d } = f;
  lojasNomes = new Map(d.lojas.map((l) => [l.loja_id, l.nome]));
  const m = consulta.medida as MedidaId;
  const g = consulta.grupo;

  if (m === "ruptura" || m === "giro" || m === "cobertura") {
    const r = m === "ruptura" ? ruptura(d, g, consulta.filtros) : giroCobertura(d, m, g, consulta.filtros);
    const itens: Item[] = r.itens.map((x) => ({
      chave: x.chave,
      rot: x.chave === "_" ? "Total" : g ? rotuloChave(g, x.chave) : x.chave,
      c: m === "ruptura" ? { n: x.taxa, t: pct(x.taxa, 2), sub: x.vp ? `${brlCompact(x.vp)} de venda perdida` : undefined } : m === "giro" ? { n: x.taxa, t: `${dec(x.taxa, 1)}x ao ano` } : { n: x.taxa, t: `${dec(x.taxa, 1)} dias` },
    }));
    const lc = r.descartados.length === 0;
    return {
      itens,
      fonte: m === "ruptura" ? "Fonte: taxa de ruptura por loja, categoria, mês e dia da semana" : "Fonte: giro e cobertura por categoria",
      descartados: r.descartados,
      nota: lc && (["loja", "categoria", "mes", "dow"] as const).some((k) => k !== g && (consulta.filtros[k]?.length ?? 0) > 1) ? "Quando junta mais de um valor, é média simples das taxas." : undefined,
      medida: m,
      filtrosEf: consulta.filtros,
    };
  }

  const esc = escolherFato(fatos(f), m, g, consulta.filtros);
  if (!esc) return null;
  const def = MEDIDAS[m];
  const mapa = new Map<string, Soma>();
  const tot = zero();
  const ks = Object.keys(tot) as Campo[];
  for (const l of esc.fato.linhas) {
    if (!passa(l, esc.filtros)) continue;
    const k = g ? chaveDe(l, g) : "_";
    const a = mapa.get(k) ?? zero();
    for (const c of ks) {
      a[c] += l[c];
      tot[c] += l[c];
    }
    mapa.set(k, a);
  }
  const itens: Item[] = [...mapa.entries()].map(([chave, s]) => ({ chave, rot: chave === "_" ? "Total" : g ? rotuloChave(g, chave) : chave, c: def.calc(s) }));
  return { itens, fonte: FONTE_METRICA(esc.fato), descartados: esc.descartados, nota: esc.fato.nota, medida: m, total: def.calc(tot), filtrosEf: esc.filtros };
}

function ordenar(itens: Item[], ordem: "desc" | "asc", g: Dim | null, cron = true): Item[] {
  const c = [...itens];
  if (!cron) return c.sort((a, b) => (ordem === "desc" ? b.c.n - a.c.n : a.c.n - b.c.n));
  if (g === "mes") return c.sort((a, b) => a.chave.localeCompare(b.chave));
  if (g === "dow") return c.sort((a, b) => Number(a.chave) - Number(b.chave));
  return c.sort((a, b) => (ordem === "desc" ? b.c.n - a.c.n : a.c.n - b.c.n));
}

function vazia(pergunta: string, texto: string, seguintes: string[]): Resposta {
  return { pergunta, titulo: "Sem dado para isso", texto, blocos: [], seguintes, cobertura: "fora", fonte: "Nenhuma tabela do painel cobre esta pergunta." };
}

const SUGESTOES_BASE = ["Qual loja tem a maior perda?", "Quais categorias perdem mais margem?", "Quais 10 SKUs concentram a venda perdida?", "Como evoluiu a margem real por mês?", "Compare Centro e Jardins", "O que posso fazer para ganhar margem?"];

function seguintesDe(c: Consulta, m: MedidaId, d: Dados): string[] {
  const out: string[] = [];
  const rot = m === "giro" ? "giro" : m === "cobertura" ? "cobertura" : m === "venda_perdida" ? "venda perdida" : rotMedida(m).toLowerCase();
  if (c.op !== "tendencia") out.push(`Como evoluiu ${rot} por mês?`);
  if (c.grupo !== "categoria") out.push(`${cap(rot)} por categoria`);
  if (c.grupo !== "loja" && !c.filtros.loja?.length) out.push(`${cap(rot)} por loja`);
  if (c.op !== "comparar" && !c.filtros.loja?.length) out.push(`Compare ${lojaCurta(d.lojas[0].nome)} e ${lojaCurta(d.lojas[1].nome)} em ${rot}`);
  if (m === "margem_real" || m === "perda" || m === "venda_perdida") out.push("Simule recuperar 30% da venda perdida");
  return out.slice(0, 4);
}

function compararGeral(pergunta: string, c: Consulta, f: Fontes): Resposta {
  const { d } = f;
  const ms: MedidaId[] = ["receita", "margem_real", "perda", "ruptura", "venda_perdida"];
  const rs = ms.map((m) => calcular({ ...c, medida: m, op: "comparar" }, f));
  const chaves = (rs[0]?.itens ?? []).map((i) => i.chave);
  const linhas = chaves.map((k) => {
    const rot = rs[0]?.itens.find((i) => i.chave === k)?.rot ?? k;
    return [rot, ...rs.map((r) => r?.itens.find((i) => i.chave === k)?.c.t ?? "—")];
  });
  return { pergunta, titulo: `Comparação · ${escopo({ ...c.filtros, loja: c.grupo === "loja" ? undefined : c.filtros.loja }, d)}`, texto: `Comparei ${chaves.length} recortes nas cinco métricas centrais. Diga uma métrica para abrir o detalhe.`, blocos: [{ tipo: "tabela", colunas: ["", "Receita", "Margem real", "Perda", "Ruptura", "Venda perdida"], linhas }], seguintes: ["Compare em margem real", "Compare em perda", "Como evoluiu a margem real por mês?"], cobertura: "ok", fonte: "Fonte: vendas, perdas e ruptura", consulta: c };
}

const PCT_TIPO: MedidaId[] = ["margem_bruta", "margem_real", "ruptura"];

function difTxt(m: MedidaId, a: Calc, b: Calc): string {
  const pctTipo = PCT_TIPO.includes(m) || (m === "perda" && a.t.includes("%"));
  if (pctTipo) return pp(a.n - b.n, 2);
  return b.n ? `${a.n >= b.n ? "+" : "−"}${pct(Math.abs((100 * (a.n - b.n)) / b.n), 0)}` : "";
}

function responderDados(pergunta: string, c: Consulta, f: Fontes): Resposta {
  const { d } = f;
  if (!c.medida && c.op === "comparar" && c.grupo) return compararGeral(pergunta, c, f);
  if (!c.medida) {
    // panorama do recorte pedido (ou da rede)
    const itens: { rotulo: string; valor: string; sub?: string }[] = [];
    const base = (m: MedidaId) => calcular({ ...c, medida: m, grupo: null, op: "valor" }, f);
    for (const m of ["receita", "margem_real", "perda", "venda_perdida", "ruptura"] as MedidaId[]) {
      const r = base(m);
      const it = r?.itens[0];
      if (it) itens.push({ rotulo: rotMedida(m), valor: it.c.t, sub: it.c.sub });
    }
    return { pergunta, titulo: escopo(c.filtros, d), texto: `Painel do recorte "${escopo(c.filtros, d)}". Pergunte por uma métrica específica para abrir o detalhe.`, blocos: [{ tipo: "stats", itens }], seguintes: SUGESTOES_BASE.slice(0, 4), cobertura: "ok", fonte: "Fonte: vendas diárias, perdas e ruptura", consulta: c };
  }
  const m = c.medida;
  const r = calcular(c, f);
  if (!r || !r.itens.length) {
    return vazia(pergunta, `Não consegui cruzar ${rotMedida(m).toLowerCase()} com esse recorte (${escopo(c.filtros, d)}). Tente remover um dos filtros ou pergunte por loja, categoria ou mês.`, seguintesDe(c, m, d));
  }
  if (r.itens.length === 1 && r.itens[0].chave === "_" && c.grupo) c = { ...c, op: "valor", grupo: null };
  const rot = rotMedida(m);
  const sc = escopo(r.filtrosEf, d);
  const parcial = r.descartados.length > 0;
  const extra = `${aviso(r.descartados)}${r.nota ? ` ${r.nota}` : ""}`;
  const view = viewDe(m);
  const base = { pergunta, seguintes: seguintesDe(c, m, d), cobertura: (parcial ? "parcial" : "ok") as Resposta["cobertura"], fonte: r.fonte, view, consulta: c };

  /* valor único */
  if (c.op === "valor" || !c.grupo) {
    const it = r.itens[0];
    const stats: { rotulo: string; valor: string; sub?: string }[] = [{ rotulo: rot, valor: it.c.t, sub: it.c.sub }];
    let comp = "";
    if (m !== "ruptura" && m !== "giro" && m !== "cobertura" && Object.keys(r.filtrosEf).some((k) => (r.filtrosEf as Record<string, unknown>)[k] !== undefined)) {
      const rede = calcular({ ...c, filtros: {}, grupo: null, op: "valor" }, f);
      const rt = rede?.itens[0];
      if (rt) {
        stats.push({ rotulo: "Rede toda, 12 meses", valor: rt.c.t, sub: rt.c.sub });
        if (m === "receita" || m === "venda_perdida" || m === "perda_valor" || m === "qtd" || m === "cupons" || m === "margem_real_valor") {
          const parte = (100 * it.c.n) / rt.c.n;
          comp = ` Isso é ${pct(parte, 1)} do total da rede.`;
        } else comp = ` A rede toda fica em ${rt.c.t}${rt.c.n ? ` (diferença de ${difTxt(m, it.c, rt.c)})` : ""}.`;
      }
    }
    return { ...base, titulo: `${rot} · ${sc}`, texto: `${sc}: ${rot.toLowerCase()} de ${it.c.t}${it.c.sub ? ` (${it.c.sub})` : ""}.${comp}${extra}`, blocos: [{ tipo: "stats", itens: stats }] };
  }

  const g = c.grupo;
  const gRot = ROT_DIM[g];

  /* tendência */
  if (c.op === "tendencia") {
    const ord = ordenar(r.itens, "asc", "mes");
    const pontos = ord.map((i) => ({ x: i.rot, y: i.c.n }));
    const a = ord[0];
    const z = ord[ord.length - 1];
    const maior = [...ord].sort((x, y) => y.c.n - x.c.n)[0];
    const menor = [...ord].sort((x, y) => x.c.n - y.c.n)[0];
    const fmtY = m === "ruptura" ? "pct" : m === "giro" || m === "cobertura" ? "dec" : MEDIDAS[m as keyof typeof MEDIDAS].fmtY;
    const pctVar = a.c.n ? (100 * (z.c.n - a.c.n)) / a.c.n : 0;
    const delta = fmtY === "pct" ? pp(z.c.n - a.c.n, 2) : `${pctVar >= 0 ? "+" : "−"}${pct(Math.abs(pctVar), 1)}`;
    return {
      ...base,
      titulo: `${rot} por mês · ${sc}`,
      texto: `${sc}: ${rot.toLowerCase()} foi de ${a.c.t} em ${a.rot} para ${z.c.t} em ${z.rot} (${delta}). Maior em ${maior.rot} (${maior.c.t}), menor em ${menor.rot} (${menor.c.t}).${extra}`,
      blocos: [{ tipo: "linha", pontos, rotuloY: rot, formato: fmtY }],
    };
  }

  /* comparação */
  if (c.op === "comparar") {
    const ord = ordenar(r.itens, c.ordem, g, false).sort((x, y) => y.c.n - x.c.n);
    const itens = ord.map((i) => ({ rotulo: i.rot, valor: i.c.n, texto: i.c.t, sub: i.c.sub }));
    let dif = "";
    if (ord.length >= 2) {
      const [x, y] = [ord[0], ord[ord.length - 1]];
      dif = ` ${x.rot} contra ${y.rot} (${difTxt(m, x.c, y.c)}).`;
    }
    return { ...base, titulo: `${rot}: ${ord.map((i) => i.rot).join(" × ")}`, texto: `${sc ? `${rot} por ${gRot}` : rot}: ${ord.map((i) => `${i.rot} ${i.c.t}`).join(", ")}.${dif}${extra}`, blocos: [{ tipo: "barras", itens }] };
  }

  /* ranking */
  const ord = ordenar(r.itens, c.ordem, g, !!c.cron);
  const topo = c.cron ? ord : ord.slice(0, c.n);
  const melhor = [...r.itens].sort((a, b) => (c.ordem === "desc" ? b.c.n - a.c.n : a.c.n - b.c.n))[0];
  const itens = topo.map((i) => ({ rotulo: i.rot, valor: i.c.n, texto: i.c.t, sub: i.c.sub }));
  const adj = c.ordem === "desc" ? "maior" : "menor";
  const segundo = [...r.itens].sort((a, b) => (c.ordem === "desc" ? b.c.n - a.c.n : a.c.n - b.c.n))[1];
  const parte = r.total && ["receita", "venda_perdida", "perda_valor", "qtd", "cupons", "margem_real_valor", "dias_ruptura"].includes(m) && r.total.n ? ` (${pct((100 * melhor.c.n) / r.total.n, 1)} do total)` : "";
  const texto = `${sc}. Por ${gRot}, ${rot.toLowerCase()} é ${adj} em ${melhor.rot}, com ${melhor.c.t}${parte}.${segundo ? ` Em seguida, ${segundo.rot} (${segundo.c.t}).` : ""}${g === "sku" && r.itens.length > c.n ? ` Mostrando ${c.n} de ${r.itens.length}.` : ""}${extra}`;
  return { ...base, titulo: `${rot} por ${gRot} · ${sc}`, texto, blocos: [{ tipo: "barras", itens, destaque: 0 }] };
}

/* ───────────────────────── tópicos especiais ───────────────────────── */

/** "Por que a perda do Jardins é alta?": decompõe o desvio contra a rede em categorias (ou lojas). */
function responderPorQue(pergunta: string, c: Consulta, f: Fontes): Resposta {
  const { d } = f;
  const m = c.medida as MedidaId;
  const campo = m === "ruptura" ? "taxa_ruptura_pct" : m === "margem_real" || m === "margem_bruta" ? (m === "margem_real" ? "margem_real_pct" : "margem_bruta_pct") : "perda_pct_receita";
  const lojaId = c.filtros.loja?.length === 1 ? c.filtros.loja[0] : null;
  const catUnica = c.filtros.categoria?.length === 1 ? c.filtros.categoria[0] : null;
  const rot = m === "venda_perdida" ? "Venda perdida" : rotMedida(m);
  if (m === "venda_perdida" || (!lojaId && !catUnica)) return responderDados(pergunta, { ...c, op: "rank", grupo: lojaId ? "categoria" : "loja" }, f);
  const lojaNome = (id: number) => lojaCurta(d.lojas.find((l) => l.loja_id === id)?.nome ?? `Loja ${id}`);
  const refRede = (d.meta.resumo as unknown as Record<string, number>)[campo] ?? 0;
  const catRede = new Map(d.categorias.map((x) => [x.categoria, x]));
  type R = { rot: string; contrib: number; taxa: number; ref: number };
  let linhas: R[] = [];
  let gap = 0;
  let alvoRot = "";
  if (lojaId) {
    const l = d.lojas.find((x) => x.loja_id === lojaId);
    if (!l) return responderDados(pergunta, c, f);
    alvoRot = lojaNome(lojaId);
    gap = (l[campo] as number) - refRede;
    linhas = d.lojaCategoria
      .filter((x) => x.loja_id === lojaId && (!catUnica || x.categoria === catUnica))
      .map((x) => {
        const ref = catRede.get(x.categoria);
        const refV = ref ? (ref[campo] as number) : 0;
        return { rot: x.categoria, taxa: x[campo] as number, ref: refV, contrib: ((x.receita / l.receita) * ((x[campo] as number) - refV)) };
      });
  } else if (catUnica) {
    const cr = catRede.get(catUnica);
    if (!cr) return responderDados(pergunta, c, f);
    alvoRot = catUnica;
    const totalCat = d.lojaCategoria.filter((x) => x.categoria === catUnica).reduce((a, x) => a + x.receita, 0);
    gap = 0;
    linhas = d.lojaCategoria
      .filter((x) => x.categoria === catUnica)
      .map((x) => ({ rot: lojaNome(x.loja_id), taxa: x[campo] as number, ref: cr[campo] as number, contrib: (x.receita / totalCat) * ((x[campo] as number) - (cr[campo] as number)) }));
  }
  const ruim = ruimDe(m) === "alto";
  linhas.sort((a, b) => (ruim ? b.contrib - a.contrib : a.contrib - b.contrib));
  const fmt = (v: number) => pct(v, 2);
  const top = linhas.slice(0, 5);
  const soma = linhas.reduce((a, x) => a + x.contrib, 0);
  const mix = lojaId ? gap - soma : 0;
  const lead = top[0];
  const texto = lojaId
    ? `${alvoRot} está ${pp(gap, 2)} ${gap >= 0 ? "acima" : "abaixo"} da rede em ${rot.toLowerCase()} (${fmt(gap + refRede)} contra ${fmt(refRede)}). O maior peso vem de ${lead.rot}: ${fmt(lead.taxa)} na loja contra ${fmt(lead.ref)} na rede, o que explica ${pp(lead.contrib, 2)} do desvio${top[1] ? `, seguido de ${top[1].rot} (${pp(top[1].contrib, 2)})` : ""}.${Math.abs(mix) >= 0.1 ? ` O restante (${pp(mix, 2)}) vem do mix de categorias da loja.` : ""}`
    : `Em ${alvoRot}, ${lead.rot} lidera o desvio: ${fmt(lead.taxa)} contra ${fmt(lead.ref)} na rede (${pp(lead.contrib, 2)} sobre o total da categoria).`;
  return {
    pergunta,
    titulo: `O que explica ${rot.toLowerCase()} em ${alvoRot}`,
    texto,
    blocos: [{ tipo: "barras", itens: top.map((x) => ({ rotulo: x.rot, valor: Math.abs(x.contrib), texto: pp(x.contrib, 2), sub: `${fmt(x.taxa)} contra ${fmt(x.ref)} na rede` })), destaque: 0 }],
    seguintes: lojaId ? [`${rotMedida(m)} por categoria no ${alvoRot}`, `Compare ${alvoRot} e ${lojaCurta(d.lojas.find((l) => l.loja_id !== lojaId)?.nome ?? "")}`, "Simule reduzir 30% da perda"] : [`${rotMedida(m)} por loja`],
    cobertura: "ok",
    fonte: "Fonte: vendas por loja e categoria, contra a média da rede em cada categoria",
    view: viewDe(m),
    consulta: c,
  };
}

function responderDefinicao(pergunta: string, t: string, d: Dados): Resposta {
  const map: [RegExp, string][] = [
    [/margem real/, "margem_real"],
    [/margem bruta|margem/, "margem_bruta"],
    [/venda perdida/, "venda_perdida"],
    [/ruptura/, "taxa_ruptura"],
    [/perda/, "perda"],
    [/lift/, "lift"],
    [/curva|abc|classe/, "classe_abc"],
    [/cobertura|estoque/, "cobertura_dias"],
    [/receita|faturamento/, "receita"],
  ];
  const k = map.find(([re]) => re.test(t))?.[1];
  const def = k ? d.meta.definicoes[k] : undefined;
  if (!k || !def) {
    return { pergunta, titulo: "Definições", texto: `Tenho definição de: ${Object.keys(d.meta.definicoes).join(", ")}.`, blocos: [{ tipo: "tabela", colunas: ["Métrica", "Definição"], linhas: Object.entries(d.meta.definicoes).map(([a, b]) => [a.replace(/_/g, " "), b]) }], seguintes: ["O que é margem real?", "Como se calcula a venda perdida?", "O que é lift?"], cobertura: "ok", fonte: "Fonte: dicionário de métricas do gerador" };
  }
  return { pergunta, titulo: cap(k.replace(/_/g, " ")), texto: def, blocos: [], seguintes: ["Qual a margem real da rede?", "Qual a taxa de ruptura por loja?"], cobertura: "ok", fonte: "Fonte: dicionário de métricas do gerador" };
}

function numeros(t: string): number[] {
  return [...t.matchAll(/(\d+(?:[.,]\d+)?)\s*%/g)].map((m) => Number(m[1].replace(",", ".")));
}

function responderSimulacao(pergunta: string, t: string, d: Dados): Resposta {
  const ns = numeros(t);
  const reduzPerda = tem(t, /perda/) && !tem(t, /venda perdida/);
  const recupera = tem(t, /venda perdida|ruptura|recuper/);
  let rec = recupera ? 30 : 0;
  let red = reduzPerda ? 20 : 0;
  if (ns.length === 1) {
    if (recupera && !reduzPerda) rec = ns[0];
    else if (reduzPerda && !recupera) red = ns[0];
    else {
      rec = ns[0];
      red = ns[0];
    }
  } else if (ns.length >= 2) {
    // ordem em que aparecem no texto
    const ordem = [...t.matchAll(/(\d+(?:[.,]\d+)?)\s*%[^%]*?(venda perdida|ruptura|recuper|perda|reduz)/g)];
    if (ordem.length >= 2) {
      for (const o of ordem) {
        if (/venda perdida|ruptura|recuper/.test(o[2])) rec = Number(o[1].replace(",", "."));
        else red = Number(o[1].replace(",", "."));
      }
    } else {
      rec = ns[0];
      red = ns[1];
    }
  } else if (!recupera && !reduzPerda) {
    rec = 30;
    red = 20;
  }
  rec = Math.min(100, rec);
  red = Math.min(100, red);
  const g = ganhoSimulado(d, rec, red);
  const gl = ganhoLiquido(d, { ...premissasPadrao(d), recuperarPct: rec, reduzirPerdaPct: red });
  const r = d.meta.resumo;
  return {
    pergunta,
    titulo: "Simulação de ganho",
    texto: `Recuperando ${pct(rec, 0)} da venda perdida e reduzindo ${pct(red, 0)} da perda, o ganho é de ${brlCompact(g.total)} por ano: ${brlCompact(g.margemRecuperada)} de margem sobre ${brlCompact(g.vendaRecuperada)} de venda recuperada e ${brlCompact(g.perdaEvitada)} de perda evitada. A margem real iria de ${pct(r.margem_real_pct)} para ${pct(r.margem_real_pct + g.ppMargem)}. Descontando o custo da ação (capital parado em estoque extra, vencimento extra, operação e remarcação), o ganho líquido é de ${brlCompact(gl.liquido)} por ano (${brlCompact(gl.custos)} de custos). Premissas editáveis na Visão geral: venda recuperada rende a margem bruta média da rede, ${premissasPadrao(d).diasEstoque} dias de estoque extra a ${premissasPadrao(d).capitalAnoPct}% ao ano.`,
    blocos: [{ tipo: "stats", itens: [{ rotulo: "Ganho bruto", valor: brlCompact(g.total), sub: `${dec(g.ppMargem, 2)} p.p. de margem real` }, { rotulo: "Ganho líquido", valor: brlCompact(gl.liquido), sub: `após ${brlCompact(gl.custos)} de custos` }, { rotulo: "Venda recuperada", valor: brlCompact(g.vendaRecuperada), sub: `${pct(rec, 0)} de ${brlCompact(r.venda_perdida)}` }, { rotulo: "Perda evitada", valor: brlCompact(g.perdaEvitada), sub: `${pct(red, 0)} de ${brlCompact(r.perda_custo)}` }] }],
    seguintes: ["Simule recuperar 50% da venda perdida", "Simule reduzir 40% da perda", "Quais SKUs concentram a venda perdida?"],
    cobertura: "ok",
    fonte: "Fonte: resumo da rede e simulador do painel",
    view: "geral",
  };
}

function responderResumo(pergunta: string, d: Dados): Resposta {
  const ins = gerarInsights(d);
  return {
    pergunta,
    titulo: "Onde agir primeiro",
    texto: `${ins.length} leituras automáticas dos dados, da mais crítica para a mais informativa. ${ins[0]?.titulo}.`,
    blocos: [{ tipo: "tabela", colunas: ["Leitura", "Detalhe"], linhas: ins.map((i) => [i.titulo, i.texto]) }],
    seguintes: ["Simule recuperar 30% da venda perdida", "Quais SKUs concentram a venda perdida?", "Qual loja tem a maior perda?"],
    cobertura: "ok",
    fonte: "Fonte: leituras automáticas (gerarInsights)",
    view: "geral",
  };
}

function responderAlertas(pergunta: string, t: string, c: Consulta, d: Dados): Resposta {
  const regra = [...t.matchAll(/\br([0-4])\b/g)].map((m) => `R${m[1]}`);
  if (tem(t, /vencimento|vence/)) regra.push("R3");
  const lista = d.alertas.eventos_destaque
    .filter((e) => (!c.filtros.loja?.length || c.filtros.loja.includes(e.loja_id)) && (!c.filtros.categoria?.length || c.filtros.categoria.includes(e.categoria)) && (!regra.length || regra.includes(e.regra)))
    .sort((a, b) => b.impacto_rs - a.impacto_rs);
  const total = d.alertas.contagem_por_loja_regra.filter((x) => (!c.filtros.loja?.length || c.filtros.loja.includes(x.loja_id)) && (!regra.length || regra.includes(x.regra))).reduce((a, x) => a + x.n, 0);
  if (!lista.length) return { pergunta, titulo: "Alertas", texto: `Nenhum alerta em destaque para esse recorte. No total há ${int(total)} eventos no estoque de fechamento.`, blocos: [], seguintes: ["Quais alertas R1 existem?", "Quais as regras de alerta?"], cobertura: "parcial", fonte: "Fonte: alertas do estoque de fechamento (30/09/2026)", view: "alertas" };
  const lojaN = (id: number) => lojaCurta(d.lojas.find((l) => l.loja_id === id)?.nome ?? `${id}`);
  return {
    pergunta,
    titulo: `Alertas${regra.length ? ` ${regra.join(", ")}` : ""}${c.filtros.loja?.length ? ` · ${c.filtros.loja.map(lojaN).join(" + ")}` : ""}`,
    texto: `${int(total)} eventos no recorte; o mais pesado entre os destaques é ${lista[0].produto} em ${lojaN(lista[0].loja_id)} (${lista[0].regra_nome}, ${brlCompact(lista[0].impacto_rs)} em risco). A automação ainda está em desenvolvimento: isto é o que as regras gerariam.`,
    blocos: [{ tipo: "tabela", colunas: ["Produto", "Loja", "Regra", "R$ em risco", "Ação"], linhas: lista.slice(0, 8).map((e) => [e.produto, lojaN(e.loja_id), e.regra, brlCompact(e.impacto_rs), e.acao]) }],
    seguintes: ["Quais as regras de alerta?", "Alertas R1 no Centro", "Quantos alertas por loja?"],
    cobertura: "ok",
    fonte: "Fonte: alertas do estoque de fechamento (30/09/2026)",
    view: "alertas",
  };
}

function responderCesta(pergunta: string, t: string, c: Consulta, d: Dados): Resposta {
  const cs = d.cesta;
  const alvoTermos = c.filtros.termos ?? [];
  const todos = [...cs.pares_maior_lift, ...cs.pares_maior_suporte].filter((p, i, a) => a.findIndex((q) => q.item_a === p.item_a && q.item_b === p.item_b) === i);
  if (alvoTermos.length) {
    const bate = (s: string) => alvoTermos.every((w) => norm(s).split(" ").some((k) => k.startsWith(w)));
    const ps = todos.filter((p) => bate(p.item_a) || bate(p.item_b));
    if (ps.length) {
      const linhas = ps
        .map((p) => (bate(p.item_a) ? { com: p.item_b, de: p.item_a, conf: p.confianca_a_b_pct, p } : { com: p.item_a, de: p.item_b, conf: p.confianca_b_a_pct, p }))
        .sort((a, b) => b.conf - a.conf)
        .slice(0, 8);
      return {
        pergunta,
        titulo: `O que sai junto com ${linhas[0].de}`,
        texto: `${pct(linhas[0].conf, 0)} das cestas com ${linhas[0].de} também levam ${linhas[0].com} (lift ${dec(linhas[0].p.lift, 1)}). Os pares vêm de cestas sintéticas geradas por missão de compra, então o lift é maior do que seria em dado real.`,
        blocos: [{ tipo: "barras", itens: linhas.map((l) => ({ rotulo: l.com, valor: l.conf, texto: pct(l.conf, 0), sub: `lift ${dec(l.p.lift, 1)} · suporte ${pct(l.p.suporte_pct, 1)}` })), destaque: 0 }],
        seguintes: ["Quais os pares de maior lift?", "Quais as missões de compra?", "Quais os itens mais presentes nas cestas?"],
        cobertura: "ok",
        fonte: "Fonte: análise de cesta (pares com maior lift e maior suporte)",
        view: "cesta",
      };
    }
  }
  if (tem(t, /missao|missoes/)) {
    const ms = Object.entries(d.meta.cestas_missoes_pct).sort((a, b) => b[1] - a[1]);
    return { pergunta, titulo: "Missões de compra", texto: `${ms[0][0]} é a missão mais comum (${pct(ms[0][1], 1)} das cestas). Uma cesta pode ter mais de uma missão.`, blocos: [{ tipo: "barras", itens: ms.map(([k, v]) => ({ rotulo: k, valor: v, texto: pct(v, 1) })), destaque: 0 }], seguintes: ["Quais os pares de maior lift?", "Itens mais presentes nas cestas"], cobertura: "ok", fonte: "Fonte: missões de compra das cestas", view: "cesta" };
  }
  if (tem(t, /presente|penetracao|mais comprad|itens mais/)) {
    return { pergunta, titulo: "Itens mais presentes nas cestas", texto: `${cs.itens_mais_presentes[0].item} aparece em ${pct(cs.itens_mais_presentes[0].penetracao_pct, 1)} das ${int(cs.n_cestas)} cestas.`, blocos: [{ tipo: "barras", itens: cs.itens_mais_presentes.slice(0, 10).map((i) => ({ rotulo: i.item, valor: i.penetracao_pct, texto: pct(i.penetracao_pct, 1) })), destaque: 0 }], seguintes: ["Quais as missões de compra?", "O que sai junto com pão francês?"], cobertura: "ok", fonte: "Fonte: penetração por item", view: "cesta" };
  }
  const pares = (tem(t, /suporte|frequen/) ? cs.pares_maior_suporte : cs.pares_maior_lift).slice(0, 8);
  return {
    pergunta,
    titulo: tem(t, /suporte|frequen/) ? "Pares mais frequentes" : "Pares com maior afinidade (lift)",
    texto: `${pares[0].item_a} + ${pares[0].item_b}: lift ${dec(pares[0].lift, 1)}, em ${pct(pares[0].suporte_pct, 1)} das cestas. São ${int(cs.n_cestas)} cestas, com ${dec(cs.itens_por_cesta_media, 1)} itens em média.`,
    blocos: [{ tipo: "tabela", colunas: ["Par", "Suporte", "A→B", "B→A", "Lift"], linhas: pares.map((p) => [`${p.item_a} + ${p.item_b}`, pct(p.suporte_pct, 1), pct(p.confianca_a_b_pct, 0), pct(p.confianca_b_a_pct, 0), dec(p.lift, 1)]) }],
    seguintes: ["O que sai junto com leite?", "Quais as missões de compra?", "Quais os itens mais presentes nas cestas?"],
    cobertura: "ok",
    fonte: "Fonte: análise de cesta",
    view: "cesta",
  };
}

function responderCausa(pergunta: string, d: Dados): Resposta {
  const rc = d.rupturaCausas;
  const top = [...rc.por_causa].sort((a, b) => b.venda_perdida - a.venda_perdida);
  const forn = rc.fornecedores.filter((f) => f.fornecedor !== "Granel / sem marca");
  const pior = [...forn].sort((a, b) => a.pct_no_prazo - b.pct_no_prazo)[0];
  return {
    pergunta,
    titulo: "Causa da ruptura",
    texto: `Da venda perdida de ${brlCompact(top.reduce((a, c) => a + c.venda_perdida, 0))}, ${top.map((c) => `${pct(c.pct_venda_perdida, 0)} vem de ${c.causa.toLowerCase()} (${brlCompact(c.venda_perdida)})`).join(", ")}. O fornecedor com menos pedidos no prazo é ${pior.fornecedor}, com ${pct(pior.pct_no_prazo, 1)} e atraso médio de ${dec(pior.atraso_medio_dias, 1)} dias quando atrasa. ${rc.nota} ${rc.fornecedor_e_marca}`,
    blocos: [
      { tipo: "tabela", colunas: ["Causa", "Venda perdida", "% do total"], linhas: top.map((c) => [c.causa, brlCompact(c.venda_perdida), pct(c.pct_venda_perdida, 0)]) },
      { tipo: "tabela", colunas: ["Fornecedor (marca)", "No prazo", "Atraso médio", "Venda perdida por atraso"], linhas: rc.fornecedores.map((f) => [f.fornecedor, pct(f.pct_no_prazo, 1), `${dec(f.atraso_medio_dias, 1)} d`, brlCompact(f.venda_perdida_atraso)]) },
    ],
    seguintes: ["Quais SKUs concentram a venda perdida?", "Ruptura por categoria", "Simule recuperar 30% da venda perdida"],
    cobertura: "ok",
    fonte: "Fonte: simulação de estoque dia a dia, causa atribuída por regra",
    view: "ruptura",
  };
}

function responderCaixas(pergunta: string, c: Consulta, d: Dados): Resposta {
  const hs = d.horario.filter((h) => (!c.filtros.loja?.length || c.filtros.loja.includes(h.loja_id)) && (!c.filtros.dow?.length || c.filtros.dow.includes(h.dow)));
  const faltas = hs.filter((h) => h.falta >= 1).sort((a, b) => b.falta - a.falta || b.venda_em_risco_hora - a.venda_em_risco_hora);
  const sobras = hs.filter((h) => h.sobra >= 2).length;
  const lojaN = (id: number) => lojaCurta(d.lojas.find((l) => l.loja_id === id)?.nome ?? `${id}`);
  if (!faltas.length) return { pergunta, titulo: "Caixas", texto: `Nenhuma faixa de hora com falta de caixa nesse recorte. Há ${int(sobras)} faixas com 2 ou mais caixas sobrando.`, blocos: [], seguintes: ["Onde falta caixa?", "Qual o horário de pico?"], cobertura: "ok", fonte: "Fonte: cupons médios por hora e escala de caixas", view: "lojas" };
  const pico = [...hs].sort((a, b) => b.cupons_medios - a.cupons_medios)[0];
  return {
    pergunta,
    titulo: "Falta de caixa por faixa de hora",
    texto: `${faltas.length} faixas com falta de caixa. O pior caso é ${lojaN(faltas[0].loja_id)} ${diaLongo(faltas[0].dia)} às ${faltas[0].hora}h: ${faltas[0].caixas_necessarios} caixas necessários, ${faltas[0].caixas_escalados} escalados (falta ${faltas[0].falta}). Nas ${faltas.length} faixas, a venda em risco por fila é de ${brlCompact(faltas.reduce((a, h) => a + h.venda_em_risco_hora, 0) * 52)} por ano, mas o que sobra de verdade é a margem dessa venda, ${brlCompact(faltas.reduce((a, h) => a + h.margem_em_risco_hora, 0) * 52)}, contra ${brlCompact(faltas.reduce((a, h) => a + h.custo_reforco_hora, 0) * 52)} para pagar o reforço (premissas: ${d.caixasPremissas.desistencia_fila_pct}% dos cupons acima da capacidade desistem; operador a R$ ${d.caixasPremissas.custo_operador_hora}/h; a decisão é por margem, não por venda). O pico de movimento no recorte é ${lojaN(pico.loja_id)} ${diaLongo(pico.dia)} às ${pico.hora}h (${dec(pico.cupons_medios, 0)} cupons/hora). Há ${int(sobras)} faixas com 2 ou mais caixas sobrando.`,
    blocos: [{ tipo: "tabela", colunas: ["Loja", "Dia", "Hora", "Falta", "Margem em risco/dia", "Reforço/dia", "Decisão"], linhas: faltas.slice(0, 8).map((h) => [lojaN(h.loja_id), cap(diaLongo(h.dia)), `${h.hora}h`, `${h.falta} caixa${h.falta > 1 ? "s" : ""}`, brlCompact(h.margem_em_risco_hora), brlCompact(h.custo_reforco_hora), h.decisao]) }],
    seguintes: ["Qual o horário de pico no Centro?", "Falta caixa no sábado?", "Ticket médio por loja"],
    cobertura: "ok",
    fonte: "Fonte: cupons médios por hora e escala de caixas",
    view: "lojas",
  };
}

function responderContagem(pergunta: string, t: string, c: Consulta, d: Dados): Resposta {
  const p = d.meta.periodo;
  if (tem(t, /periodo|meses|dias/)) return { pergunta, titulo: "Período dos dados", texto: `${p.dias} dias, de ${p.inicio.split("-").reverse().join("/")} a ${p.fim.split("-").reverse().join("/")}, em ${d.lojas.length} lojas e ${d.meta.categorias.length} categorias. ${d.meta.aviso}`, blocos: [], seguintes: SUGESTOES_BASE.slice(0, 3), cobertura: "ok", fonte: "Fonte: metadados do gerador" };
  if (tem(t, /lojas/)) return { pergunta, titulo: "Lojas", texto: `${d.lojas.length} lojas: ${d.lojas.map((l) => lojaCurta(l.nome)).join(", ")}.`, blocos: [], seguintes: ["Compare as lojas em margem real"], cobertura: "ok", fonte: "Fonte: cadastro de lojas" };
  if (tem(t, /categorias/)) return { pergunta, titulo: "Categorias", texto: `${d.meta.categorias.length} categorias: ${d.meta.categorias.join(", ")}.`, blocos: [], seguintes: ["Receita por categoria"], cobertura: "ok", fonte: "Fonte: cadastro de categorias" };
  const f = c.filtros;
  const n = d.curvaAbc.filter((s) => (!f.categoria?.length || f.categoria.includes(s.categoria)) && (!f.classe?.length || f.classe.includes(s.classe)) && (!f.marca?.length || f.marca.includes(s.marca ?? "")) && passa({ ...zero(), sku: s.nome }, { termos: f.termos })).length;
  return { pergunta, titulo: "Contagem de SKUs", texto: `${int(n)} SKUs no recorte "${escopo({ ...f, loja: undefined, mes: undefined, dow: undefined, periodo: undefined }, d)}", de ${int(d.meta.resumo.n_skus)} no catálogo.`, blocos: [], seguintes: ["Quantos SKUs são classe A?", "Quais os 10 maiores SKUs por receita?"], cobertura: "ok", fonte: "Fonte: curva ABC", view: "margem" };
}

function responderAjuda(pergunta: string, d: Dados): Resposta {
  return {
    pergunta,
    titulo: "O que eu sei responder",
    texto: `Respondo sobre os dados do painel (${d.lojas.length} lojas, ${d.meta.categorias.length} categorias, ${int(d.meta.resumo.n_skus)} SKUs, ${d.meta.periodo.dias} dias): receita, margem bruta e real, perdas (por motivo também), ruptura e venda perdida, ticket e cupons, giro e cobertura, curva ABC, cestas, caixas e alertas. Cruzo por loja, categoria, mês, dia da semana, classe, marca e produto, além de Black Friday, Natal e Páscoa. Todo número vem dos mesmos arquivos do dashboard.`,
    blocos: [],
    seguintes: SUGESTOES_BASE,
    cobertura: "ok",
    fonte: "Fonte: catálogo de dados do painel",
  };
}

/* ───────────────────────── entrada principal ───────────────────────── */

export function executar(pergunta: string, consulta: Consulta, f: Fontes): Resposta {
  return responderDados(pergunta, consulta, f);
}

export function perguntar(pergunta: string, f: Fontes, anterior?: Consulta): Resposta {
  const r = perguntarBruto(pergunta, f, anterior);
  const nq = norm(pergunta);
  return { ...r, seguintes: r.seguintes.filter((s) => norm(s) !== nq) };
}

function perguntarBruto(pergunta: string, f: Fontes, anterior?: Consulta): Resposta {
  const texto = pergunta.trim();
  if (!texto) return responderAjuda(pergunta, f.d);
  const { d } = f;
  lojasNomes = new Map(d.lojas.map((l) => [l.loja_id, l.nome]));
  const t = norm(texto);
  const { consulta, topico } = interpretar(texto, d, anterior);
  switch (topico) {
    case "fora":
      return vazia(pergunta, "Isso não existe nos dados do painel: ele só tem vendas, margem, perdas, ruptura, cestas, caixas e alertas de 4 lojas fictícias, de out/25 a set/26. Não há previsão, cadastro real de fornecedores, equipe nem clientes individuais.", SUGESTOES_BASE.slice(0, 4));
    case "porque":
      return responderPorQue(pergunta, consulta, f);
    case "definicao":
      return responderDefinicao(pergunta, t, d);
    case "simulacao":
      return responderSimulacao(pergunta, t, d);
    case "resumo":
      return responderResumo(pergunta, d);
    case "alertas":
      return responderAlertas(pergunta, t, consulta, d);
    case "cesta":
      return responderCesta(pergunta, t, consulta, d);
    case "caixas":
      return responderCaixas(pergunta, consulta, d);
    case "causa":
      return responderCausa(pergunta, d);
    case "contagem":
      return responderContagem(pergunta, t, consulta, d);
    case "ajuda":
      return responderAjuda(pergunta, d);
    default: {
      const temAlgo = consulta.medida !== null || Object.values(consulta.filtros).some((v) => v !== undefined);
      if (!temAlgo) return vazia(pergunta, "Não identifiquei qual métrica ou recorte você quer. Tente citar uma métrica (receita, margem, perda, ruptura...) e, se quiser, uma loja, categoria ou mês.", SUGESTOES_BASE.slice(0, 4));
      return responderDados(pergunta, consulta, f);
    }
  }
}

export const SUGESTOES_INICIAIS = SUGESTOES_BASE;
