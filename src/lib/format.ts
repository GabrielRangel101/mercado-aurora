// Formatadores pt-BR. Sem dependências: usados pela interface e pelos testes.

const nf0 = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 0 });
const cache = new Map<number, Intl.NumberFormat>();

function nf(d: number): Intl.NumberFormat {
  let f = cache.get(d);
  if (!f) {
    f = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: d, maximumFractionDigits: d });
    cache.set(d, f);
  }
  return f;
}

export const int = (n: number): string => nf0.format(n);
export const dec = (n: number, d = 1): string => nf(d).format(n);
export const pct = (n: number, d = 1): string => `${nf(d).format(n)}%`;
export const brl = (n: number): string => `R$ ${nf0.format(n)}`;

/** R$ 70,3 mi · R$ 899 mil · R$ 120 */
export function brlCompact(n: number): string {
  const a = Math.abs(n);
  if (a >= 1e6) return `R$ ${dec(n / 1e6, 1)} mi`;
  if (a >= 1e3) return `R$ ${dec(n / 1e3, a >= 1e5 ? 0 : 1)} mil`;
  return brl(n);
}

/** +1,2 p.p. / −0,4 p.p. */
export function pp(n: number, d = 1): string {
  const sign = n > 0 ? "+" : n < 0 ? "−" : "";
  return `${sign}${nf(d).format(Math.abs(n))} p.p.`;
}

const MESES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

/** "2025-10" -> "out/25" */
export function mesLabel(m: string): string {
  const [y, mo] = m.split("-");
  return `${MESES[Number(mo) - 1]}/${String(y).slice(2)}`;
}

/** "2025-11-24" -> "24/11" */
export function diaLabel(d: string): string {
  const [, mo, da] = d.split("-");
  return `${da}/${mo}`;
}

/** Primeira letra maiúscula. */
export const cap = (s: string): string => (s ? s[0].toUpperCase() + s.slice(1) : s);
