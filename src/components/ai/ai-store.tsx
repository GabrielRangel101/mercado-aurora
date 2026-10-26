import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";
import { perguntar, type Consulta, type Fontes, type Resposta } from "@/lib/ask";
import { DADOS, loadVendasDiarias, loadVendasSemanais } from "@/lib/aurora-data";

export interface Mensagem {
  id: number;
  pergunta: string;
  /** undefined enquanto calcula */
  resposta?: Resposta;
}

interface AiCtx {
  aberto: boolean;
  abrir: () => void;
  fechar: () => void;
  alternar: () => void;
  mensagens: Mensagem[];
  carregando: boolean;
  perguntar: (q: string) => void;
  limpar: () => void;
}

const Ctx = createContext<AiCtx | null>(null);

/** Fontes completas (as duas séries grandes carregam na primeira pergunta). */
let cacheFontes: Promise<Fontes> | null = null;
function carregarFontes(): Promise<Fontes> {
  if (!cacheFontes) {
    cacheFontes = Promise.all([loadVendasDiarias(), loadVendasSemanais()]).then(([diarias, semanais]) => ({ d: DADOS, diarias, semanais }));
    cacheFontes.catch(() => {
      cacheFontes = null;
    });
  }
  return cacheFontes;
}

export function AiProvider({ children }: { children: ReactNode }) {
  const [aberto, setAberto] = useState(false);
  const [mensagens, setMensagens] = useState<Mensagem[]>([]);
  const [carregando, setCarregando] = useState(false);
  const seq = useRef(0);
  const ultima = useRef<Consulta | undefined>(undefined);

  const perguntarFn = useCallback((q: string) => {
    const texto = q.trim();
    if (!texto) return;
    const id = ++seq.current;
    setAberto(true);
    setMensagens((m) => [...m, { id, pergunta: texto }]);
    setCarregando(true);
    carregarFontes()
      .then((f) => {
        const r = perguntar(texto, f, ultima.current);
        if (r.consulta) ultima.current = r.consulta;
        setMensagens((m) => m.map((x) => (x.id === id ? { ...x, resposta: r } : x)));
      })
      .catch(() => {
        const r: Resposta = { pergunta: texto, titulo: "Não consegui carregar os dados", texto: "Falha ao carregar as séries diárias. Recarregue a página e tente de novo.", blocos: [], seguintes: [], cobertura: "fora", fonte: "" };
        setMensagens((m) => m.map((x) => (x.id === id ? { ...x, resposta: r } : x)));
      })
      .finally(() => setCarregando(false));
  }, []);

  const valor = useMemo<AiCtx>(
    () => ({
      aberto,
      abrir: () => setAberto(true),
      fechar: () => setAberto(false),
      alternar: () => setAberto((a) => !a),
      mensagens,
      carregando,
      perguntar: perguntarFn,
      limpar: () => {
        setMensagens([]);
        ultima.current = undefined;
      },
    }),
    [aberto, mensagens, carregando, perguntarFn],
  );
  return <Ctx.Provider value={valor}>{children}</Ctx.Provider>;
}

const VAZIO: AiCtx = { aberto: false, abrir: () => {}, fechar: () => {}, alternar: () => {}, mensagens: [], carregando: false, perguntar: () => {}, limpar: () => {} };

export function useAi(): AiCtx {
  return useContext(Ctx) ?? VAZIO;
}
