/**
 * O Painel desenha com a operação cheia E com a organização recém-criada.
 *
 * O caso vazio é o que mais importa: é o que toda instalação nova vê na primeira
 * tela depois do onboarding (o Painel é a tela inicial — `homeDaInterface`).
 * Um `Math.max()` sem piso ou uma divisão por zero ali derrubaria a entrada do
 * produto inteiro.
 */
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

import { PainelClient } from "@/app/app/painel/_components/PainelClient";
import type { DadosPainel } from "@/app/app/painel/_dados";

beforeAll(() => {
  // O grid mede a própria largura; o jsdom não tem ResizeObserver.
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
  // Nem matchMedia (o Painel vira uma coluna em tela estreita).
  window.matchMedia ??= ((query: string) => ({
    matches: false,
    media: query,
    addEventListener() {},
    removeEventListener() {},
  })) as unknown as typeof window.matchMedia;
});
afterEach(cleanup);

const VAZIO: DadosPainel = {
  hoje: "2026-09-23",
  fuso: "America/Sao_Paulo",
  moeda: "BRL",
  conversas: { ativas: 0, naFila: 0, comIa: 0, minhas: 0 },
  funil: { nome: null, etapas: [], abertos: 0, valorAbertoCents: 0 },
  leadsPorDia: Array.from({ length: 14 }, (_, i) => ({
    dia: `2026-09-${String(10 + i).padStart(2, "0")}`,
    total: 0,
  })),
  mes: { ganhos: 0, perdidos: 0, valorGanhoCents: 0 },
  tarefas: { atrasadas: 0, hoje: 0, minhas: 0, abertas: 0, proximas: [] },
  agenda: [],
  conexoes: [],
};

const CHEIO: DadosPainel = {
  ...VAZIO,
  conversas: { ativas: 12, naFila: 3, comIa: 5, minhas: 2 },
  funil: {
    nome: "Vendas",
    etapas: [
      { id: "e1", nome: "Novo", cor: null, leads: 8, valorCents: 400_000 },
      { id: "e2", nome: "Proposta", cor: "#aa0000", leads: 3, valorCents: 900_000 },
    ],
    abertos: 11,
    valorAbertoCents: 1_300_000,
  },
  mes: { ganhos: 4, perdidos: 1, valorGanhoCents: 2_000_000 },
  tarefas: {
    atrasadas: 2,
    hoje: 1,
    minhas: 1,
    abertas: 6,
    proximas: [{ id: "t1", titulo: "Ligar de volta", prazo: "2026-09-20T13:00:00+00:00", prioridade: "high" }],
  },
  agenda: [{ id: "a1", titulo: "Avaliação", inicio: "2026-09-23T17:00:00+00:00", status: "confirmed" }],
  conexoes: [{ id: "c1", nome: "Loja", status: "WORKING" }],
};

describe("Painel", () => {
  it("organização vazia: desenha todos os widgets com os textos de vazio", () => {
    render(<PainelClient dados={VAZIO} userId="u1" orgId="o1" />);
    expect(screen.getAllByRole("listitem").length).toBeGreaterThanOrEqual(7);
    expect(screen.getByText("Nenhum funil criado ainda.")).toBeTruthy();
    expect(screen.getByText("Nenhum compromisso marcado para hoje.")).toBeTruthy();
    expect(screen.getByText("Nenhum número conectado ainda.")).toBeTruthy();
  });

  it("operação cheia: números e atalhos para as telas de origem", () => {
    render(<PainelClient dados={CHEIO} userId="u1" orgId="o1" />);
    expect(screen.getByText("Proposta")).toBeTruthy();
    expect(screen.getByText("Avaliação")).toBeTruthy();
    expect(screen.getByText("80%")).toBeTruthy(); // 4 ganhos de 5 fechados
    const hrefs = screen.getAllByRole("link").map((a) => a.getAttribute("href"));
    expect(hrefs).toEqual(
      expect.arrayContaining(["/app/inbox", "/app/kanban", "/app/tasks", "/app/agenda", "/app/connections"]),
    );
  });
});
