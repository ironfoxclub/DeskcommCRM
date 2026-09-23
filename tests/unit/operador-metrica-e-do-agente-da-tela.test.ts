/**
 * A MÉTRICA DO OPERADOR TEM A DIMENSÃO DO AGENTE QUE A TELA MOSTRA.
 *
 * ## O que este arquivo protege, e por que merece catraca
 *
 * O invariante 7 (`docs/doctrine/sistema-vivo.md`) não pede que o desfecho seja
 * gravado — pede que ele **volte e mude a decisão seguinte**. O painel do papel
 * Operador (`PainelDoOperador`) é o consumidor declarado dessa volta, e ele vive
 * dentro de `/app/ai/agents/[id]`: a página de **um** agente. Duas das três
 * frases que ele imprime mandam agir sobre *aquele* agente — em especial
 * *"tinha algo a registrar e nenhuma capacidade marcada — o que resolve é marcar
 * abaixo"*, onde "abaixo" é o `ToolPicker` daquele agente e de mais nenhum.
 *
 * O laço só fecha se o sinal tiver a **mesma dimensão do atuador**. Uma métrica
 * agregada por organização apresentada na página de um agente produz o pior tipo
 * de retorno: aquele que aponta uma ação concreta e errada. Numa organização com
 * dois agentes — o desenho normal do produto, que tem lista de agentes,
 * roteadores e mapeamento por funil —, o painel do agente A manda o dono mexer
 * nas capacidades de A por causa de turnos de B. E a promessa da spec 16 §7,
 * *"se ele parar de agir, alguém vê"*, fica falsa por agente: A pode parar
 * completamente que o número continua saudável enquanto B trabalhar.
 *
 * ## A armadilha do conserto ingênuo — falha-em-verde
 *
 * Filtrar por agente **só no leitor** é pior que não filtrar: `event_log` não tem
 * coluna de agente, e o `payload` que o Operador grava não carrega `agent_id`.
 * Um filtro sobre chave que ninguém escreve casa zero linha, e o painel passa a
 * dizer *"Nenhuma conversa passou por aqui"* para sempre — silenciosamente, e
 * justamente na tela que existe para denunciar silêncio. Por isso o caso 4
 * exige que a contagem seja **maior que zero** quando há linha do agente: ele
 * reprova o filtro fantasma que os outros três casos deixariam passar.
 *
 * ## Por que o dublê aplica os filtros de verdade
 *
 * Um mock que devolvesse contagem fixa mediria que a rota chama `.eq()`, não que
 * ela **conta certo**. Presença de chamada não é comportamento. O dublê abaixo
 * avalia cada filtro contra as linhas, com a semântica de SQL que importa aqui:
 * comparação com NULL não casa. As linhas trazem o agente nos dois lugares
 * plausíveis (coluna `agent_id` e `payload.agent_id`) de propósito — o teste
 * guarda a dimensão, não a decisão de onde guardá-la.
 */
import { describe, expect, it, vi } from "vitest";

import { requireAuth, resolveActiveOrg } from "@/lib/auth/server";
import { createClient } from "@/lib/supabase/server";

vi.mock("@/lib/auth/server", () => ({
  requireAuth: vi.fn(),
  resolveActiveOrg: vi.fn(),
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));

import { GET } from "@/app/api/v1/ai/operator-metrics/route";

const ORG = "aaaaaaaa-0000-4000-8000-000000000001";
const AGENTE_A = "aaaaaaaa-0000-4000-8000-00000000000a";
const AGENTE_B = "aaaaaaaa-0000-4000-8000-00000000000b";

/** A rota hoje não declara parâmetro; o cast deixa o arquivo compilar nos dois estados. */
const rota = GET as unknown as (req: Request) => Promise<Response>;

type Linha = Record<string, unknown>;

/** Uma linha de `event_log` como o Operador a grava, com o agente declarado. */
function turno(agente: string, extra: Record<string, unknown> = {}): Linha {
  return {
    id: `${agente}-${Math.random()}`,
    organization_id: ORG,
    event_type: "agent.operator_turn",
    entity_kind: "contact",
    agent_id: agente,
    created_at: new Date().toISOString(),
    payload: {
      desfecho: "agiu",
      agent_id: agente,
      ferramentas_chamadas: [] as string[],
      promessas_declaradas: 0,
      promessa_assumida_por: null,
      promessa_sem_dono_porque: null,
      ...extra,
    },
  };
}

/** Resolve `col`, `payload->>chave` e `payload->chave->>0` como o Postgres faria. */
function valorDe(linha: Linha, caminho: string): string | null {
  if (!caminho.includes("->")) {
    const v = linha[caminho];
    return v === undefined || v === null ? null : String(v);
  }
  const partes = caminho.split(/->>?/).filter((p) => p.length > 0);
  let atual: unknown = linha[partes[0]!];
  for (const parte of partes.slice(1)) {
    if (atual === undefined || atual === null) return null;
    const chave = /^\d+$/.test(parte) ? Number(parte) : parte;
    atual = (atual as Record<string | number, unknown>)[chave];
  }
  if (atual === undefined || atual === null) return null;
  return typeof atual === "object" ? JSON.stringify(atual) : String(atual);
}

type Filtro = (l: Linha) => boolean;

/**
 * Dublê do client de sessão: só `event_log`, só contagem com `head: true`.
 * Comparação com NULL nunca casa — é o que decide `not(col, eq, "0")` para linha
 * sem a chave, e errar isso inverteria o sinal de "promessas declaradas".
 */
function fazerDb(linhas: Linha[]) {
  const from = (tabela: string) => {
    const filtros: Filtro[] = [];
    const chain = {
      select: () => chain,
      eq: (col: string, val: unknown) => {
        filtros.push((l) => {
          const v = valorDe(l, col);
          return v !== null && v === String(val);
        });
        return chain;
      },
      gte: (col: string, val: unknown) => {
        filtros.push((l) => {
          const v = valorDe(l, col);
          return v !== null && v >= String(val);
        });
        return chain;
      },
      not: (col: string, op: string, val: unknown) => {
        filtros.push((l) => {
          const v = valorDe(l, col);
          if (op === "is" && val === null) return v !== null;
          if (op === "eq") return v !== null && v !== String(val);
          throw new Error(`operador não suportado no dublê: not(${col}, ${op})`);
        });
        return chain;
      },
      then: (res: (v: unknown) => unknown) => {
        const alvo = tabela === "event_log" ? linhas : [];
        const count = alvo.filter((l) => filtros.every((f) => f(l))).length;
        return Promise.resolve({ count, error: null }).then(res);
      },
    };
    return chain;
  };
  return { from };
}

async function medir(linhas: Linha[], agente: string) {
  vi.mocked(requireAuth).mockResolvedValue({ id: "u1" } as never);
  vi.mocked(resolveActiveOrg).mockResolvedValue({
    orgId: ORG,
    name: "Org",
    role: "admin",
  } as never);
  vi.mocked(createClient).mockResolvedValue(fazerDb(linhas) as never);

  const resp = await rota(
    new Request(`http://localhost/api/v1/ai/operator-metrics?agent_id=${agente}`),
  );
  const corpo = (await resp.json()) as {
    data?: { turnos: number; agiu: number; quisAgirENaoPode: number };
  };
  expect(resp.status, "a rota precisa responder 200 para um gerente").toBe(200);
  return corpo.data!;
}

describe("a volta do papel Operador é do agente que a tela mostra (invariante 7)", () => {
  it("turnos de OUTRO agente não entram na contagem do agente aberto", async () => {
    // Dois de A, três de B. O painel de A tem de dizer 2 — dizer 5 é atribuir a
    // A trabalho que A não fez, na tela onde se decide sobre A.
    const linhas = [turno(AGENTE_A), turno(AGENTE_A), turno(AGENTE_B), turno(AGENTE_B), turno(AGENTE_B)];
    const m = await medir(linhas, AGENTE_A);
    expect(m.turnos, "a contagem somou turnos de outro agente").toBe(2);
  });

  it("'quis agir e não pôde' é do agente aberto — é o número que manda mexer na configuração DELE", async () => {
    // Este é o caso caro. A frase que acompanha o número manda marcar capacidade
    // "abaixo", no ToolPicker do agente aberto. Contar a falta de capacidade de
    // OUTRO agente manda o dono configurar o agente errado — retorno que aponta
    // uma ação concreta e errada é pior que retorno nenhum.
    const semMao = { promessas_declaradas: 1, promessa_sem_dono_porque: "operador_sem_ferramentas" };
    const linhas = [turno(AGENTE_A), turno(AGENTE_B, semMao), turno(AGENTE_B, semMao)];
    const m = await medir(linhas, AGENTE_A);
    expect(m.quisAgirENaoPode, "contou falta de capacidade de outro agente").toBe(0);
  });

  it("'se ele parar de agir, alguém vê' — A parado com B trabalhando mostra A parado", async () => {
    // A promessa literal da spec 16 §7. Sem dimensão por agente ela é falsa: o
    // agregado da organização continua saudável enquanto qualquer outro agente
    // trabalhar, e o agente que parou nunca aparece.
    const agiu = { ferramentas_chamadas: ["crm_schedule_followup"] };
    const linhas = [turno(AGENTE_A), turno(AGENTE_B, agiu), turno(AGENTE_B, agiu)];
    const m = await medir(linhas, AGENTE_A);
    expect(m.turnos).toBe(1);
    expect(m.agiu, "creditou a A a ação de outro agente").toBe(0);
  });

  it("o filtro casa a chave que o emissor GRAVA — senão o painel zera em silêncio", async () => {
    // Guarda de vacuidade e de falha-em-verde. Os três casos acima passam
    // igualmente se o filtro por agente casar ZERO linha sempre (chave que
    // ninguém escreve). Aqui a única linha existente é do agente pedido: a
    // contagem tem de ser 1. Zero aqui denuncia filtro fantasma.
    const m = await medir([turno(AGENTE_A, { ferramentas_chamadas: ["crm_update_lead"] })], AGENTE_A);
    expect(m.turnos, "filtro por agente não casa a chave que o Operador grava").toBe(1);
    expect(m.agiu).toBe(1);
  });
});
