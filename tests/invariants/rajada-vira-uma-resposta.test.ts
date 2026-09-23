import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";

import { drainTick, type DrainKnobs } from "@/lib/agent-engine/edge/crm/drain";
import { claimJobs } from "@/lib/agent-engine/queue/queue";
import { createLogger } from "@/lib/agent-engine/obs/logger";

/**
 * Issue #196 (b) — três mensagens do mesmo cliente viravam três respostas.
 *
 * O CENÁRIO É O DA INSTALAÇÃO REAL, com os intervalos medidos lá: três mensagens
 * do mesmo contato em ~30 s, com pausas de 12,1 s e 17,5 s entre elas. O que
 * saiu de lá: 3 jobs `inbound_turn` e 3 respostas separadas sobre o mesmo
 * assunto.
 *
 * ⚠️ COMO O TEMPO É SIMULADO, e por que isto não é trapaça: `avancarPara`
 * empurra as linhas do cenário PARA TRÁS no relógio do banco. O `now()` que o
 * drain e o claim consultam é o de verdade; o que muda é a IDADE das linhas, que
 * é exatamente a grandeza da qual as duas decisões dependem. Esperar 30 s de
 * relógio daria o mesmo resultado e um teste que ninguém roda.
 *
 * O QUE SE CONTA: jobs `inbound_turn`. Um job é um turno, e um turno é uma
 * resposta — é a mesma unidade que a instalação relatou ("3 jobs, 3 respostas").
 *
 * DUAS ALAVANCAS, e o cenário só vira UMA resposta com as duas (medido):
 *
 *      janela de silêncio │ sem a janela deslizante │ com ela
 *      ─────────────────────────────────────────────────────
 *              8 s        │           3             │    2
 *             20 s        │           2             │    1
 *
 * A coluna da esquerda é o mundo de antes (registrada na sabotagem, não aqui —
 * um controle escrito à mão provaria a si mesmo). A leitura: nenhum desenho de
 * coalescência salva uma janela de silêncio MENOR que a pausa de quem digita —
 * com 8 s o turno da primeira mensagem já saiu quando a segunda chega, e isso é
 * aritmética. E aumentar a janela sem fazê-la deslizar também não basta: o prazo
 * era fixado no nascimento do job e vencia no meio da rajada.
 */

const container = process.env.TEST_DB_CONTAINER;
if (!container) {
  throw new Error("TEST_DB_CONTAINER not set — rode via `pnpm test:db` (scripts/test-db.sh)");
}

const PORT = Number(process.env.TEST_DB_PORT ?? 54329);
const pool = new pg.Pool({
  connectionString: `postgresql://postgres:postgres@127.0.0.1:${PORT}/postgres`,
  max: 3,
});
const log = createLogger();

const ORG = "4a1ada00-0000-4000-8000-000000000001";
const CONTACT = "4a1ada00-0000-4000-8000-000000000002";
const SESSION = "4a1ada00-0000-4000-8000-000000000003";
const CONV = "4a1ada00-0000-4000-8000-000000000004";
const AGENT = "4a1ada00-0000-4000-8000-000000000005";
const VERSION = "4a1ada00-0000-4000-8000-000000000006";

/** As pausas MEDIDAS na instalação que abriu a issue. */
const PAUSA_1 = 12.1;
const PAUSA_2 = 17.5;

function knobs(debounceMs: number): DrainKnobs {
  return {
    batchSize: 20,
    intervalMs: 100,
    idleIntervalMs: 100,
    debounceMs,
    rajadaTetoMs: 45_000,
    reapTimeoutMs: 300_000,
  };
}

beforeAll(async () => {
  await pool.query(
    `insert into organizations (id, slug, legal_name, display_name)
     values ($1, 'rajada-196', 'Rajada 196', 'Rajada 196') on conflict (id) do nothing`,
    [ORG],
  );
  await pool.query(
    `insert into contacts (id, organization_id, name, phone_number)
     values ($1, $2, 'Cliente da rajada', '+5511900000196') on conflict (id) do nothing`,
    [CONTACT, ORG],
  );
  await pool.query(
    `insert into channel_sessions (id, organization_id, waha_session_name, status, webhook_secret_encrypted)
     values ($1, $2, 'rajada-196-session', 'WORKING', '\\x00'::bytea) on conflict (id) do nothing`,
    [SESSION, ORG],
  );
  await pool.query(
    `insert into conversations (id, organization_id, contact_id, channel_session_id, status, is_group)
     values ($1, $2, $3, $4, 'open', false) on conflict (id) do nothing`,
    [CONV, ORG, CONTACT, SESSION],
  );
  // Sem agente publicado o drain pula o turno de propósito (guarda de custo), e o
  // teste mediria essa guarda em vez da coalescência.
  await pool.query(
    `insert into ai_agents (id, organization_id, name, system_prompt)
     values ($1, $2, 'Agente da rajada', 'você atende') on conflict (id) do nothing`,
    [AGENT, ORG],
  );
  await pool.query(
    `insert into ai_agent_versions (id, organization_id, agent_id, version_number, system_prompt,
                                    provider, model, channel_session_id, status, published_at)
     values ($1, $2, $3, 1, 'você atende', 'anthropic', 'claude-sonnet-4-6', $4, 'published', now())
     on conflict (id) do nothing`,
    [VERSION, ORG, AGENT, SESSION],
  );
  await pool.query(`update ai_agents set published_version_id = $1 where id = $2`, [VERSION, AGENT]);
});

afterAll(async () => {
  await pool.end();
});

/** Uma mensagem do cliente + o evento de despacho que o ingest emite por ela. */
async function clienteEscreve(texto: string): Promise<void> {
  const { rows } = await pool.query<{ id: string }>(
    `insert into messages (organization_id, conversation_id, channel_session_id, contact_id,
                           type, direction, status, body, sent_via, sent_at)
     values ($1, $2, $3, $4, 'text', 'inbound', 'delivered', $5, 'external_device', now())
     returning id`,
    [ORG, CONV, SESSION, CONTACT, texto],
  );
  const msg = rows[0]!.id;
  await pool.query(
    `insert into event_log (organization_id, event_type, entity_kind, entity_id, payload, status)
     values ($1::uuid, 'ai_agent.dispatch_requested', 'message', $2::uuid,
             jsonb_build_object('organization_id', $1::text, 'conversation_id', $3::text,
                                'contact_id', $4::text, 'channel_session_id', $5::text,
                                'inbound_message_id', $2::text),
             'pending')`,
    [ORG, msg, CONV, CONTACT, SESSION],
  );
}

interface Cenario {
  jobs: number;
  eventosPendentes: number;
  esperaDoJobS: number | null;
}

/**
 * O cenário exato da issue, com a janela de silêncio pedida.
 *
 * O worker aparece a cada passo (`claimJobs`) porque é isso que ele faz na
 * prática: acorda, pega o que venceu e começa o turno. Nenhum turno é concluído
 * dentro do cenário — na instalação real as três respostas saíram em menos de
 * dois minutos, ou seja, os turnos ainda corriam enquanto as mensagens chegavam.
 * É o pior caso, e é o que produz o defeito.
 */
async function rodarCenario(debounceMs: number): Promise<Cenario> {
  await pool.query(`delete from job_queue where organization_id = $1`, [ORG]);
  await pool.query(
    `delete from event_log where organization_id = $1 and event_type = 'ai_agent.dispatch_requested'`,
    [ORG],
  );
  await pool.query(`delete from messages where organization_id = $1`, [ORG]);

  const avancar = async (segundos: number): Promise<void> => {
    for (const sql of [
      `update job_queue set run_after = run_after - make_interval(secs => $2::double precision),
                            created_at = created_at - make_interval(secs => $2::double precision)
        where organization_id = $1`,
      `update event_log set created_at = created_at - make_interval(secs => $2::double precision),
                            updated_at = updated_at - make_interval(secs => $2::double precision)
        where organization_id = $1`,
      `update messages set sent_at = sent_at - make_interval(secs => $2::double precision),
                           created_at = created_at - make_interval(secs => $2::double precision)
        where organization_id = $1`,
    ]) {
      await pool.query(sql, [ORG, segundos]);
    }
    // O worker acordou: pega o que já venceu (o claim serializa por contato).
    await claimJobs(pool, { workerId: "rajada-196", maxConcurrency: 8 });
  };

  await clienteEscreve("oi, bom dia");
  await drainTick(pool, knobs(debounceMs), log);

  await avancar(PAUSA_1);
  await clienteEscreve("queria saber o preço do plano");
  await drainTick(pool, knobs(debounceMs), log);

  await avancar(PAUSA_2);
  await clienteEscreve("e se der pra parcelar");
  await drainTick(pool, knobs(debounceMs), log);

  const { rows: jobs } = await pool.query<{ n: string }>(
    `select count(*)::text as n from job_queue where organization_id = $1 and kind = 'inbound_turn'`,
    [ORG],
  );
  const { rows: eventos } = await pool.query<{ n: string }>(
    `select count(*)::text as n from event_log
      where organization_id = $1 and event_type = 'ai_agent.dispatch_requested' and status <> 'done'`,
    [ORG],
  );
  const { rows: espera } = await pool.query<{ s: string | null }>(
    `select max(extract(epoch from (run_after - created_at)))::text as s
       from job_queue where organization_id = $1 and status = 'pending'`,
    [ORG],
  );
  return {
    jobs: Number(jobs[0]!.n),
    eventosPendentes: Number(eventos[0]!.n),
    esperaDoJobS: espera[0]?.s == null ? null : Number(espera[0].s),
  };
}

describe("rajada do cliente com a janela de silêncio em 20 s (o default de hoje)", () => {
  it("as três mensagens viram UM turno — uma resposta só", async () => {
    const r = await rodarCenario(20_000);
    expect(r.jobs, "cada mensagem virou um turno; o cliente recebe a rajada de volta").toBe(1);
  });

  it("nenhuma mensagem fica sem turno: os três eventos foram consumidos", async () => {
    // A GUARDA CONTRA O CONSERTO ERRADO. Coalescer é fácil; coalescer PERDENDO a
    // mensagem é mais fácil ainda — bastaria dar o evento por consumido sem
    // ninguém para lê-lo. O turno único lê o histórico inteiro da conversa, então
    // as três entram nele.
    const r = await rodarCenario(20_000);
    expect(r.eventosPendentes).toBe(0);
    expect(r.jobs).toBeGreaterThanOrEqual(1);
  });

  it("o teto segura quem não para de escrever: a espera não passa de 45 s", async () => {
    // Sem teto, a janela deslizante é uma promessa de nunca responder. Aqui a
    // terceira mensagem chega aos 29,6 s e pediria 49,6 s; o teto corta em 45 s
    // contados da PRIMEIRA mensagem da rajada.
    const r = await rodarCenario(20_000);
    expect(r.esperaDoJobS).not.toBeNull();
    expect(r.esperaDoJobS!).toBeLessThanOrEqual(45.5);
    expect(r.esperaDoJobS!, "o teto cortou antes da hora e a rajada foi partida").toBeGreaterThan(
      PAUSA_1 + PAUSA_2,
    );
  });
});

describe("a mesma rajada com a janela em 8 s — o default antigo", () => {
  it("cai de três turnos para dois, e o que resta é aritmética, não desenho", async () => {
    // ⚠️ ESTE CASO EXISTE PARA NÃO DEIXAR A CORREÇÃO PARECER MAIOR DO QUE É.
    // Com 8 s, o turno da primeira mensagem já foi despachado quando a segunda
    // chega aos 12,1 s — nenhuma coalescência alcança um turno que já começou, e
    // a mensagem nova PRECISA de turno próprio (perdê-la seria pior). O que a
    // janela deslizante conserta é a terceira: ela entra de carona na segunda,
    // que estava pendente atrás do turno em voo. De 3 para 2.
    const r = await rodarCenario(8_000);
    expect(r.jobs).toBe(2);
    expect(r.eventosPendentes).toBe(0);
  });
});
