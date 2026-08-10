/**
 * O AVISO SÓ AFIRMA O QUE ALGUMA LINHA DE CÓDIGO APUROU.
 *
 * ## O defeito
 *
 * `avisarPromessasEmAberto` disparava por `promessas.length > 0` — a contagem de
 * promessas que o **Conversador** declarou — e o texto que chegava à Central
 * dizia "o sistema ainda não registrou o cumprimento". Nenhuma linha olhava o que
 * o Operador tinha feito: o retorno de `runModelCall` era descartado. O aviso
 * nascia inclusive quando o papel acabara de agendar o retorno, e inclusive
 * quando nenhuma chamada de modelo aconteceu.
 *
 * Era a única coisa que a feature mostrava ao dono do negócio, e era uma
 * afirmação sem apuração. Alarme que dispara sempre não informa — treina a
 * ignorar o alarme que importa.
 *
 * ## O que se apura, e o que continua não se sabendo
 *
 * `apuraDonoDaPromessa` responde **"alguém ficou responsável?"**, que é o que o
 * sistema consegue medir. Não responde "foi cumprida?" — agendar um retorno não
 * é cumprir, e nenhuma frase do produto pode dizer que foi.
 *
 * ## Por que testes PUROS aqui
 *
 * A decisão inteira cabe em quatro entradas. Exercitá-la com Postgres e modelo
 * mediria a fiação; o que pode quebrar é a REGRA — e a parte da regra que se
 * perde primeiro num refactor é a **precedência**, que só aparece quando duas
 * condições verdadeiras disputam. Por isso há caso para cada caminho E caso para
 * cada disputa. Cobrir N caminhos não prova a ordem entre eles.
 */
import { describe, expect, it } from "vitest";

import {
  apuraDonoDaPromessa,
  nomesDasFerramentasChamadas,
} from "@/lib/agent-engine/agent/operator-turn";

/** O caso base: papel ligado, com mão, rodou, e nada aconteceu. */
const RODOU_COM_MAO = {
  ferramentasChamadas: [] as readonly string[],
  temRetornoVivo: false,
  operadorRodou: true,
  operadorTemFerramentas: true,
};

describe("apuraDonoDaPromessa — quem ficou responsável", () => {
  it("ferramenta chamada neste turno assume a promessa", () => {
    expect(
      apuraDonoDaPromessa({ ...RODOU_COM_MAO, ferramentasChamadas: ["crm_schedule_followup"] }),
    ).toEqual({ assumida: true, por: "ferramenta_do_operador" });
  });

  it("retorno já agendado assume a promessa, mesmo sem o turno agir", () => {
    expect(apuraDonoDaPromessa({ ...RODOU_COM_MAO, temRetornoVivo: true })).toEqual({
      assumida: true,
      por: "retorno_agendado",
    });
  });

  it("ORDEM: ferramenta E retorno juntos — vence a ferramenta deste turno", () => {
    // Cobrir os dois caminhos separados não prova a precedência entre eles. Foi
    // ESTE turno que agiu; creditar ao retorno pré-existente contaria a história
    // errada para quem for auditar depois.
    expect(
      apuraDonoDaPromessa({
        ...RODOU_COM_MAO,
        ferramentasChamadas: ["crm_move_lead_stage"],
        temRetornoVivo: true,
      }),
    ).toEqual({ assumida: true, por: "ferramenta_do_operador" });
  });

  it("retorno vivo assume mesmo com o Operador PULADO — o papel desligado não desfaz o que existe", () => {
    expect(
      apuraDonoDaPromessa({ ...RODOU_COM_MAO, temRetornoVivo: true, operadorRodou: false }),
    ).toEqual({ assumida: true, por: "retorno_agendado" });
  });

  it("rodou, tinha mão, e não agiu — ninguém assumiu", () => {
    expect(apuraDonoDaPromessa(RODOU_COM_MAO)).toEqual({
      assumida: false,
      porque: "operador_nao_agiu",
    });
  });

  it("ORDEM: rodou SEM capacidade marcada — vence `operador_sem_ferramentas`", () => {
    // A distinção não é cosmética: muda a AÇÃO que o aviso pede. Sem capacidade,
    // o dono precisa marcar na tela do assistente; com capacidade e sem ação, ele
    // precisa decidir sobre este cliente. Colapsar as duas dá um aviso que manda
    // a pessoa para o lugar errado.
    expect(apuraDonoDaPromessa({ ...RODOU_COM_MAO, operadorTemFerramentas: false })).toEqual({
      assumida: false,
      porque: "operador_sem_ferramentas",
    });
  });

  it("não rodou e não há retorno — ninguém assumiu, e o motivo é outro", () => {
    expect(
      apuraDonoDaPromessa({ ...RODOU_COM_MAO, operadorRodou: false, operadorTemFerramentas: false }),
    ).toEqual({ assumida: false, porque: "operador_nao_rodou" });
  });
});

describe("nomesDasFerramentasChamadas — de onde se lê a ação", () => {
  it("conta chamada do PRIMEIRO passo — o caso que `result.toolCalls` perderia", () => {
    // No AI SDK, `toolCalls` do topo é o do ÚLTIMO passo. Um turno que agiu no
    // passo 1 e encerrou no 2 contaria zero, e zero aqui vira "ninguém assumiu":
    // o alarme falso voltaria pela porta de trás, com aparência de medição.
    const saida = {
      result: {
        steps: [
          { toolCalls: [{ toolName: "crm_schedule_followup" }] },
          { toolCalls: [] },
        ],
      },
    };
    expect(nomesDasFerramentasChamadas(saida)).toEqual(["crm_schedule_followup"]);
  });

  it("junta os passos, na ordem", () => {
    const saida = {
      result: {
        steps: [
          { toolCalls: [{ toolName: "crm_update_lead" }] },
          { toolCalls: [{ toolName: "crm_move_lead_stage" }] },
        ],
      },
    };
    expect(nomesDasFerramentasChamadas(saida)).toEqual(["crm_update_lead", "crm_move_lead_stage"]);
  });

  it("sem chamada de modelo (saída nula) devolve lista vazia, não estoura", () => {
    // O caminho do papel ligado sem capacidade marcada: `mcp` é null e o modelo
    // nunca é chamado. Estourar aqui derrubaria o job por causa do registro.
    expect(nomesDasFerramentasChamadas(null)).toEqual([]);
  });

  it("passo sem toolCalls não conta como ação", () => {
    expect(nomesDasFerramentasChamadas({ result: { steps: [{}, {}] } })).toEqual([]);
  });
});
