import http from "node:http";
import { readFileSync } from "node:fs";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";

import { redriveQueued, type WatchdogConfig } from "@/lib/agent-engine/edge/crm/session-reconciler";
import { createLogger } from "@/lib/agent-engine/obs/logger";

/**
 * Issue #196 — a mesma frase aparecendo duas vezes na conversa.
 *
 * O que este arquivo prova, no BANCO de verdade (o unique é `DEFERRABLE
 * INITIALLY DEFERRED`, e nenhum duplo em memória reproduz isso):
 *
 *   1. a chave canônica faz `messages_org_external_id_unique` PEGAR o eco do
 *      próprio envio — e o composto escapava dele;
 *   2. a violação de uma constraint deferida só estoura no COMMIT (é a
 *      armadilha que faria a linha voltar a `queued` com a mensagem entregue);
 *   3. o watchdog — o TERCEIRO escritor da chave, o que roda fora do seam — não
 *      reenvia a mensagem a cada tique quando o eco já é dono da chave;
 *   4. o backfill do apêndice do baseline normaliza as linhas que já existem
 *      sem apagar histórico de cliente e sem tocar no id de outro canal.
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

const ORG = "e196e196-0000-4000-8000-000000000001";
const CONTACT = "e196e196-0000-4000-8000-000000000002";
/** Segundo contato porque `uniq_conversations_1to1_per_contact_session` só
 * admite UMA conversa 1:1 por (contato, sessão) — a segunda conversa precisa de
 * outra pessoa do outro lado. */
const CONTACT_2 = "e196e196-0000-4000-8000-000000000008";
const SESSION = "e196e196-0000-4000-8000-000000000003";
const CONV = "e196e196-0000-4000-8000-000000000004";
const CONV_2 = "e196e196-0000-4000-8000-000000000005";
const SESSION_META = "e196e196-0000-4000-8000-000000000006";
const CONV_META = "e196e196-0000-4000-8000-000000000007";
const WAHA_SESSION_NAME = "eco-196-session";

/** A cauda que o WAHA/NOWEB devolve no envio. */
const BARE = "2A1B890FB8AA87730CBC";
/** O MESMO id como o webhook o entrega de volta — com o chat opaco do engine. */
const COMPOSTO = `true_250302204792918@lid_${BARE}`;

async function seed(): Promise<void> {
  await pool.query(
    `insert into organizations (id, slug, legal_name, display_name)
     values ($1, 'eco-196', 'Eco 196', 'Eco 196') on conflict (id) do nothing`,
    [ORG],
  );
  await pool.query(
    `insert into contacts (id, organization_id, name, phone_number)
     values ($1, $2, 'Cliente 196', '+5525030220479') on conflict (id) do nothing`,
    [CONTACT, ORG],
  );
  await pool.query(
    `insert into contacts (id, organization_id, name, phone_number)
     values ($1, $2, 'Cliente 196 bis', '+5525030220480') on conflict (id) do nothing`,
    [CONTACT_2, ORG],
  );
  await pool.query(
    `insert into channel_sessions (id, organization_id, provider, waha_session_name, status, webhook_secret_encrypted)
     values ($1, $2, 'waha', $3, 'WORKING', '\\x00'::bytea) on conflict (id) do nothing`,
    [SESSION, ORG, WAHA_SESSION_NAME],
  );
  for (const [conv, contato] of [
    [CONV, CONTACT],
    [CONV_2, CONTACT_2],
  ] as const) {
    await pool.query(
      `insert into conversations (id, organization_id, contact_id, channel_session_id, status, is_group)
       values ($1, $2, $3, $4, 'open', false) on conflict (id) do nothing`,
      [conv, ORG, contato, SESSION],
    );
  }
}

/** Uma linha de `messages` com o mínimo — o resto vem do default do DDL. */
async function inserirMensagem(campos: {
  id?: string;
  conversationId?: string;
  contactId?: string;
  sessionId?: string;
  externalId: string | null;
  direction: "inbound" | "outbound";
  sentVia: string;
  status?: string;
  body?: string | null;
  sentAt?: string;
  createdAt?: string;
}): Promise<string> {
  const { rows } = await pool.query<{ id: string }>(
    `insert into messages (id, organization_id, conversation_id, channel_session_id, contact_id,
                           external_id, type, direction, status, body, sent_via, sent_at, created_at)
     values (coalesce($1::uuid, extensions.uuid_generate_v4()), $2, $3, $4, $5,
             $6, 'text', $7, $8, $9, $10, $11::timestamptz, coalesce($12::timestamptz, now()))
     returning id`,
    [
      campos.id ?? null,
      ORG,
      campos.conversationId ?? CONV,
      campos.sessionId ?? SESSION,
      campos.contactId ?? CONTACT,
      campos.externalId,
      campos.direction,
      campos.status ?? "sent",
      campos.body ?? null,
      campos.sentVia,
      campos.sentAt ?? new Date().toISOString(),
      campos.createdAt ?? null,
    ],
  );
  return rows[0]!.id;
}

beforeAll(async () => {
  await seed();
});

afterAll(async () => {
  await pool.end();
});

describe("1. o unique só é rede quando as duas trilhas gravam a MESMA string", () => {
  it("com o composto, o eco entra: duas linhas para uma mensagem", async () => {
    // O MUNDO DE ANTES, reproduzido no banco. Sem este caso, o de baixo passaria
    // sem provar nada — "a segunda inserção falhou" só significa alguma coisa se
    // a primeira formulação NÃO falhava.
    await inserirMensagem({ externalId: BARE, direction: "outbound", sentVia: "ai", body: "oi" });
    await inserirMensagem({
      externalId: COMPOSTO,
      direction: "outbound",
      sentVia: "external_device",
      body: "oi",
    });

    const { rows } = await pool.query<{ n: string }>(
      `select count(*)::text as n from messages
        where organization_id = $1 and external_id in ($2, $3)`,
      [ORG, BARE, COMPOSTO],
    );
    expect(rows[0]!.n, "o unique deixou passar — é o defeito da issue #196").toBe("2");

    await pool.query(`delete from messages where organization_id = $1 and external_id in ($2, $3)`, [
      ORG,
      BARE,
      COMPOSTO,
    ]);
  });

  it("com a cauda dos dois lados, o eco bate no 23505 e a conversa fica com UMA linha", async () => {
    await inserirMensagem({ externalId: BARE, direction: "outbound", sentVia: "ai", body: "oi" });

    let sqlstate: string | null = null;
    try {
      await inserirMensagem({
        externalId: BARE,
        direction: "outbound",
        sentVia: "external_device",
        body: "oi",
      });
    } catch (err) {
      sqlstate = (err as { code?: string }).code ?? null;
    }
    expect(sqlstate).toBe("23505");

    const { rows } = await pool.query<{ n: string }>(
      `select count(*)::text as n from messages where organization_id = $1 and external_id = $2`,
      [ORG, BARE],
    );
    expect(rows[0]!.n).toBe("1");

    await pool.query(`delete from messages where organization_id = $1 and external_id = $2`, [ORG, BARE]);
  });

  it("a constraint é DEFERIDA: o INSERT sai 00000 e a violação só estoura no COMMIT", async () => {
    // ⚠️ ESTA É A ARMADILHA. Quem trata só o erro do statement conclui que deu
    // certo, não carimba nada e deixa a linha em `queued` — com a mensagem JÁ
    // ENTREGUE ao cliente, o que faz o watchdog reenviar. O erro chega no
    // commit, e é lá que ele tem de ser tratado.
    await inserirMensagem({ externalId: BARE, direction: "outbound", sentVia: "ai", body: "oi" });

    const cliente = await pool.connect();
    let doStatement: string | null = null;
    let doCommit: string | null = null;
    try {
      await cliente.query("begin");
      try {
        await cliente.query(
          `insert into messages (organization_id, conversation_id, channel_session_id, contact_id,
                                 external_id, type, direction, status, body, sent_via)
           values ($1, $2, $3, $4, $5, 'text', 'outbound', 'sent', 'oi', 'external_device')`,
          [ORG, CONV, SESSION, CONTACT, BARE],
        );
      } catch (err) {
        doStatement = (err as { code?: string }).code ?? "erro-sem-codigo";
      }
      try {
        await cliente.query("commit");
      } catch (err) {
        doCommit = (err as { code?: string }).code ?? "erro-sem-codigo";
      }
    } finally {
      await cliente.query("rollback").catch(() => undefined);
      cliente.release();
    }

    expect(doStatement, "o INSERT falhou na hora — a constraint deixou de ser deferida").toBeNull();
    expect(doCommit, "a violação não chegou no commit").toBe("23505");

    await pool.query(`delete from messages where organization_id = $1 and external_id = $2`, [ORG, BARE]);
  });
});

describe("2. o watchdog não reenvia a mensagem a cada tique quando o eco tem a chave", () => {
  let wahaMock: http.Server;
  let wahaPort = 0;
  const sendTextCalls: Array<{ session: string; chatId: string; text: string }> = [];
  const MENSAGEM_PRESA = "e196e196-0000-4000-8000-0000000000a1";
  const CORPO = "resposta presa do agente";

  function cfg(): WatchdogConfig {
    return {
      wahaBaseUrl: `http://127.0.0.1:${wahaPort}`,
      wahaApiKey: "test-key",
      intervalMs: 1000,
      redriveMinAgeMs: 0,
      redriveBatchSize: 10,
      redriveSpacingMs: 1,
    };
  }

  beforeAll(async () => {
    wahaMock = http.createServer((req, res) => {
      if (req.method === "POST" && req.url === "/api/sendText") {
        let body = "";
        req.on("data", (c) => (body += c));
        req.on("end", () => {
          sendTextCalls.push(JSON.parse(body) as (typeof sendTextCalls)[number]);
          res.writeHead(201, { "content-type": "application/json" });
          res.end(JSON.stringify({ id: { id: BARE }, timestamp: 1 }));
        });
        return;
      }
      res.writeHead(404);
      res.end();
    });
    await new Promise<void>((resolve) => wahaMock.listen(0, "127.0.0.1", resolve));
    const addr = wahaMock.address();
    wahaPort = typeof addr === "object" && addr !== null ? addr.port : 0;

    // `redriveQueued` varre TODAS as orgs (comportamento de produção): a fila
    // precisa conter só a mensagem DESTE teste, senão a contagem mede as
    // vizinhas.
    await pool.query(`delete from messages where status = 'queued' and sent_via = 'ai'`);
    await inserirMensagem({
      id: MENSAGEM_PRESA,
      externalId: null,
      direction: "outbound",
      sentVia: "ai",
      status: "queued",
      body: CORPO,
    });
    // O ECO do reenvio, já na forma canônica — é o mundo depois do conserto das
    // outras duas trilhas, e é ele que faz a chave estar tomada quando o
    // watchdog vai carimbar.
    await inserirMensagem({
      externalId: BARE,
      direction: "outbound",
      sentVia: "external_device",
      body: CORPO,
    });
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => wahaMock.close(() => resolve()));
  });

  it("três tiques, UM sendText — e a linha fecha em sent, nunca em queued", async () => {
    // SEM o tratamento do 23505 aqui: o carimbo estoura, o `catch` classifica
    // como "erro transiente — mantida queued" e o tique seguinte manda de novo.
    // Medido: 3 tiques = 3 mensagens ao cliente. A doutrina do repo é explícita
    // — envio em dobro é pior que não-envio.
    for (let tique = 0; tique < 3; tique += 1) {
      await redriveQueued(pool, cfg(), log);
    }

    expect(sendTextCalls, "o cliente recebeu a mesma mensagem mais de uma vez").toHaveLength(1);

    const { rows } = await pool.query<{ status: string; external_id: string | null }>(
      `select status, external_id from messages where id = $1`,
      [MENSAGEM_PRESA],
    );
    expect(rows[0]!.status, "ficou em queued com a mensagem entregue — o watchdog reenviaria").toBe(
      "sent",
    );

    // A conversa tem UMA linha com aquele corpo: ou o eco saiu e o carimbo
    // pegou, ou o eco ficou e esta fechou sem a chave. As duas saídas são
    // aceitáveis; duas linhas não é.
    const { rows: linhas } = await pool.query<{ n: string }>(
      `select count(*)::text as n from messages where conversation_id = $1 and body = $2`,
      [CONV, CORPO],
    );
    expect(linhas[0]!.n, "a mesma frase ficou duas vezes na conversa").toBe("1");
  });
});

describe("3. o backfill do baseline normaliza sem apagar histórico de cliente", () => {
  /**
   * O bloco é EXTRAÍDO do baseline, não redigitado: uma cópia aqui continuaria
   * verde com o bloco apagado de lá — o teste estaria provando a si mesmo. E é
   * o `baseline.sql` que o `install.sh`/`update.sh` do self-hoster aplica.
   */
  function blocoDoBackfill(): string {
    const texto = readFileSync("supabase/baseline.sql", "utf8");
    const marcador = "-- ---- identidade canônica da mensagem do WhatsApp (migration 0167) ----";
    const inicio = texto.indexOf(marcador);
    if (inicio === -1) {
      throw new Error(
        `bloco do backfill não encontrado em supabase/baseline.sql (marcador "${marcador}"). ` +
          "Ele foi removido ou renomeado — sem ele, quem já instalou não recebe a normalização.",
      );
    }
    return texto.slice(inicio);
  }

  const ECO_DO_ENVIO = "3EB0AAA111";
  const DO_CELULAR = "3EB0BBB222";
  const DO_CLIENTE = "3EB0CCC333";
  const COLISAO = "3EB0DDD444";
  const WAMID = "wamid.HBgNNTUxMTk5OTk5OTk5ORUCABIYFjNBMEE_QjFDMkQzRTRGNQA=";

  let idDoEnvio = "";
  let idDoEcoDoEnvio = "";
  let idDoCelular = "";
  let idDoCliente = "";
  let idColisaoAntiga = "";
  let idColisaoNova = "";
  let idDoMeta = "";

  beforeAll(async () => {
    await pool.query(`delete from messages where organization_id = $1`, [ORG]);

    const t = "2026-08-19T12:00:00Z";
    // (a) O PAR QUE ESTE DEFEITO CRIOU: o envio da IA e o eco dele.
    idDoEnvio = await inserirMensagem({
      externalId: ECO_DO_ENVIO,
      direction: "outbound",
      sentVia: "ai",
      body: "posso te ajudar com o pedido?",
      sentAt: t,
    });
    idDoEcoDoEnvio = await inserirMensagem({
      externalId: `true_250302204792918@lid_${ECO_DO_ENVIO}`,
      direction: "outbound",
      sentVia: "external_device",
      body: "posso te ajudar com o pedido?",
      sentAt: "2026-08-19T12:00:01.3Z",
    });
    // (b) mensagem LEGÍTIMA do celular do dono — id diferente, tem de sobreviver.
    idDoCelular = await inserirMensagem({
      externalId: `true_250302204792918@lid_${DO_CELULAR}`,
      direction: "outbound",
      sentVia: "external_device",
      body: "vou verificar e já te falo",
      sentAt: t,
    });
    // (c) mensagem do cliente (inbound).
    idDoCliente = await inserirMensagem({
      externalId: `false_250302204792918@lid_${DO_CLIENTE}`,
      direction: "inbound",
      sentVia: "external_device",
      body: "bom dia",
      sentAt: t,
    });
    // (d) colisão que NÃO é o par do defeito: duas linhas de conversas
    // diferentes cuja cauda coincide. Nenhuma pode sumir.
    idColisaoAntiga = await inserirMensagem({
      externalId: COLISAO,
      direction: "inbound",
      sentVia: "external_device",
      body: "primeira",
      sentAt: t,
      createdAt: "2026-08-19T12:00:00Z",
    });
    idColisaoNova = await inserirMensagem({
      conversationId: CONV_2,
      contactId: CONTACT_2,
      externalId: `false_5511999999999@c.us_${COLISAO}`,
      direction: "inbound",
      sentVia: "external_device",
      body: "segunda",
      sentAt: t,
      createdAt: "2026-08-19T13:00:00Z",
    });
    // (e) canal OFICIAL: o wamid tem `_` e não pode ser tocado.
    await pool.query(
      `insert into channel_sessions (id, organization_id, provider, meta_phone_number_id, status, webhook_secret_encrypted)
       values ($1, $2, 'meta_cloud', '1234567890', 'WORKING', '\\x00'::bytea) on conflict (id) do nothing`,
      [SESSION_META, ORG],
    );
    await pool.query(
      `insert into conversations (id, organization_id, contact_id, channel_session_id, status, is_group)
       values ($1, $2, $3, $4, 'open', false) on conflict (id) do nothing`,
      [CONV_META, ORG, CONTACT, SESSION_META],
    );
    idDoMeta = await inserirMensagem({
      conversationId: CONV_META,
      sessionId: SESSION_META,
      externalId: WAMID,
      direction: "outbound",
      sentVia: "ai",
      body: "mensagem pelo número oficial",
      sentAt: t,
    });

    await pool.query(blocoDoBackfill());
  });

  const chaveDe = async (id: string): Promise<string | null> => {
    const { rows } = await pool.query<{ external_id: string | null }>(
      `select external_id from messages where id = $1`,
      [id],
    );
    return rows.length === 0 ? "(linha apagada)" : rows[0]!.external_id;
  };

  it("o eco do próprio envio sai e a linha que fica é a que tem autoria", async () => {
    const { rows } = await pool.query<{ n: string }>(
      `select count(*)::text as n from messages where id = $1`,
      [idDoEcoDoEnvio],
    );
    expect(rows[0]!.n, "a cópia duplicada continua na conversa").toBe("0");
    expect(await chaveDe(idDoEnvio)).toBe(ECO_DO_ENVIO);
    const { rows: quem } = await pool.query<{ sent_via: string }>(
      `select sent_via from messages where id = $1`,
      [idDoEnvio],
    );
    expect(quem[0]!.sent_via, "ficou com a linha do webhook e a autoria se perdeu").toBe("ai");
  });

  it("mensagem legítima do celular sobrevive — e ganha a chave canônica", async () => {
    expect(await chaveDe(idDoCelular)).toBe(DO_CELULAR);
  });

  it("mensagem do cliente sobrevive — e ganha a chave canônica", async () => {
    expect(await chaveDe(idDoCliente)).toBe(DO_CLIENTE);
  });

  it("colisão que não é o par do defeito: as DUAS linhas ficam, só a chave sai", async () => {
    expect(await chaveDe(idColisaoAntiga)).toBe(COLISAO);
    expect(await chaveDe(idColisaoNova), "a linha perdedora foi apagada em vez de marcada").toBeNull();
    const { rows } = await pool.query<{ marca: string | null }>(
      `select metadata->>'external_id_nao_canonico' as marca from messages where id = $1`,
      [idColisaoNova],
    );
    expect(rows[0]!.marca, "o id antigo se perdeu sem deixar rastro").toBe(
      `false_5511999999999@c.us_${COLISAO}`,
    );
  });

  it("o id do canal oficial (wamid, que CONTÉM `_`) fica intacto", async () => {
    expect(await chaveDe(idDoMeta), "o backfill truncou o id do número oficial").toBe(WAMID);
  });

  it("re-aplicar o bloco não muda mais nada (o update.sh roda de novo a cada versão)", async () => {
    const foto = async () => {
      const { rows } = await pool.query<{ f: string }>(
        `select coalesce(string_agg(id::text || '=' || coalesce(external_id, '(null)'), ',' order by id), '(vazio)') as f
           from messages where organization_id = $1`,
        [ORG],
      );
      return rows[0]!.f;
    };
    const antes = await foto();
    await pool.query(blocoDoBackfill());
    expect(await foto()).toBe(antes);
  });
});
