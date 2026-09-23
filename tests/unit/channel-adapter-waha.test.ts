/**
 * Task 3 do seam de canais. O adapter é BURRO de propósito: traduz formato e
 * delega. Não há caso aqui sobre janela, cap ou horário — se um aparecer, o
 * desenho vazou (a regra pertence à cadeia `before_send`).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getAdapter } from '@/lib/channels';

const WAHA_BASE = 'http://localhost:3030';

/** Sobe o WAHA "configurado" e devolve o fetch espionado. */
function stubWaha(response: unknown) {
  vi.stubEnv('WAHA_API_BASE_URL', WAHA_BASE);
  vi.stubEnv('WAHA_API_KEY', 'hash123');
  const fetchMock = vi.fn().mockResolvedValue(Response.json(response));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('adapter WAHA', () => {
  it('resolve destinatário 1:1 por telefone', () => {
    const a = getAdapter('waha');
    expect(
      a.resolveRecipient({
        isGroup: false,
        groupChatId: null,
        phoneNumber: '+5531999998888',
        waIdentity: null,
      }),
    ).toBe('5531999998888@c.us');
  });

  it('resolve destinatário por lid quando não há telefone', () => {
    const a = getAdapter('waha');
    expect(
      a.resolveRecipient({
        isGroup: false,
        groupChatId: null,
        phoneNumber: null,
        waIdentity: 'lid:12345',
      }),
    ).toBe('12345@lid');
  });

  it('resolução de adapter é fail-closed', () => {
    // @ts-expect-error provider inexistente é erro de tipo E de runtime
    expect(() => getAdapter('telegram')).toThrow(/unknown_channel_provider/);
  });

  // `isConfigured` existe porque `send` devolvendo `{externalId:null}` colapsa
  // dois desfechos que o handler trata diferente: "não tentei" (fica `queued`)
  // e "tentei e a resposta não tinha id" (vira `sent`). Sem este pre-check, a
  // primeira viraria `sent` sem ter saído — perda de mensagem, não refactor.
  it('isConfigured é false sem env do canal', () => {
    vi.stubEnv('WAHA_API_BASE_URL', '');
    vi.stubEnv('WAHA_API_KEY', '');
    expect(getAdapter('waha').isConfigured()).toBe(false);
  });

  it('isConfigured é true com env do canal', () => {
    vi.stubEnv('WAHA_API_BASE_URL', WAHA_BASE);
    vi.stubEnv('WAHA_API_KEY', 'hash123');
    expect(getAdapter('waha').isConfigured()).toBe(true);
  });

  // Os códigos vivem no adapter porque carregam nome de provider, e o lint da
  // Task 7 proíbe esse nome fora de `lib/channels/`. Os valores são os literais
  // que o handler grava hoje — mudá-los é mudança de comportamento.
  it('codes carrega os literais que o handler grava', () => {
    expect(getAdapter('waha').codes).toEqual({
      notConfigured: 'waha_not_configured',
      sendFailed: 'waha_error',
      // Task 7: era literal no handler; o VALOR não muda (é gravado em
      // `messages.error_message`), só a casa.
      unknownError: 'waha_unknown',
    });
  });

  it('canal não configurado é NOOP, não erro — e nada sai pela rede', async () => {
    vi.stubEnv('WAHA_API_BASE_URL', '');
    vi.stubEnv('WAHA_API_KEY', '');
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      getAdapter('waha').send({ sessionRef: 's', to: '5531999998888@c.us', kind: 'text', body: 'oi' }),
    ).resolves.toEqual({ externalId: null });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('texto vai por sendText e o id externo sai parseado', async () => {
    const fetchMock = stubWaha({ id: { _serialized: 'ABC123' } });

    const res = await getAdapter('waha').send({
      sessionRef: 'default',
      to: '5531999998888@c.us',
      kind: 'text',
      body: 'oi',
    });

    expect(res).toEqual({ externalId: 'ABC123' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${WAHA_BASE}/api/sendText`);
    expect(JSON.parse(String(init.body))).toEqual({
      session: 'default',
      chatId: '5531999998888@c.us',
      text: 'oi',
    });
  });

  it('áudio vai pelo plano de mídia do WAHA (sendVoice), não por sendText', async () => {
    const fetchMock = stubWaha({ key: { id: 'VOICE1' } });

    const res = await getAdapter('waha').send({
      sessionRef: 'default',
      to: '5531999998888@c.us',
      kind: 'audio',
      media: { url: 'https://x/a.ogg', mime: 'audio/ogg' },
    });

    expect(res).toEqual({ externalId: 'VOICE1' });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${WAHA_BASE}/api/sendVoice`);
    expect(JSON.parse(String(init.body))).toEqual({
      session: 'default',
      chatId: '5531999998888@c.us',
      file: { url: 'https://x/a.ogg', mimetype: 'audio/ogg' },
      convert: true,
    });
  });
});

/**
 * Issue #196 — a chave que o banco compara.
 *
 * `messages_org_external_id_unique` compara STRING. Enquanto o envio gravava a
 * cauda e o eco do mesmo envio (que volta pelo webhook) gravava o composto, o
 * unique nunca disparava e a mesma frase virava duas linhas na conversa.
 */
describe('canonicalExternalId — a forma única da chave nos dois engines', () => {
  /** Payload real capturado numa instalação, engine NOWEB. */
  const NOWEB_ECO = 'true_250302204792918@lid_2A1B890FB8AA87730CBC';
  const NOWEB_ENVIO = '2A1B890FB8AA87730CBC';
  /** WEBJS manda o `_serialized` completo dos DOIS lados. */
  const WEBJS_SERIALIZADO = 'true_5511999999999@c.us_3EB0ABCDEF';

  it('NOWEB: as duas pontas do mesmo id convergem', () => {
    const a = getAdapter('waha');
    expect(a.canonicalExternalId!(NOWEB_ECO)).toBe(a.canonicalExternalId!(NOWEB_ENVIO));
    expect(a.canonicalExternalId!(NOWEB_ECO)).toBe(NOWEB_ENVIO);
  });

  it('WEBJS não regride: os dois lados continuam iguais depois de normalizar', () => {
    // ⚠️ O CASO QUE REPROVA A CORREÇÃO PELA METADE. No WEBJS as duas trilhas já
    // gravavam a MESMA string, então ali o unique JÁ era a rede. Normalizar só o
    // webhook melhoraria o NOWEB e QUEBRARIA o WEBJS — o envio ficaria com o
    // composto e o eco com a cauda. Normalizar os dois mantém a igualdade.
    const a = getAdapter('waha');
    expect(a.canonicalExternalId!(WEBJS_SERIALIZADO)).toBe(a.canonicalExternalId!(WEBJS_SERIALIZADO));
    expect(a.canonicalExternalId!(WEBJS_SERIALIZADO)).toBe('3EB0ABCDEF');
  });

  it('é ponto fixo: normalizar de novo devolve o mesmo (o backfill depende disso)', () => {
    const a = getAdapter('waha');
    const uma = a.canonicalExternalId!(NOWEB_ECO);
    expect(a.canonicalExternalId!(uma)).toBe(uma);
  });

  it('o composto reconstruído NÃO serve: o chat do eco é do engine, o do envio é do cadastro', () => {
    // A alternativa que parece simétrica e falha exatamente em quem tem contato
    // @lid — a instalação de onde a issue veio. O envio só conhece o cadastro
    // (telefone → `@c.us`); o eco chega com a identidade opaca do WhatsApp.
    const a = getAdapter('waha');
    const doCadastro = a.resolveRecipient({
      isGroup: false,
      groupChatId: null,
      phoneNumber: '+5525030220479',
      waIdentity: 'phone:+5525030220479',
    });
    const candidatos = a.echoExternalIds!({ externalId: NOWEB_ENVIO, recipient: doCadastro! });
    expect(candidatos, 'o composto montado pelo envio casou com o do eco — cenário irreal').not.toContain(
      NOWEB_ECO,
    );
    // E a cauda casa, que é o ponto.
    expect(a.canonicalExternalId!(NOWEB_ECO)).toBe(a.canonicalExternalId!(NOWEB_ENVIO));
  });
});
