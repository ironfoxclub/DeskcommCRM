-- 0167 — identidade canônica da mensagem do WhatsApp (issue #196)
--
-- O QUÊ. `messages.external_id`, nas linhas do canal WhatsApp (`channel_sessions
-- .provider = 'waha'`), passa a guardar SEMPRE a CAUDA do id — o trecho depois do
-- último `_`. É a mesma regra que `bareWaMessageId` (lib/waha/message-id.ts) já
-- aplicava na LEITURA e que agora vale na ESCRITA, nas três trilhas que gravam a
-- chave: o envio pelo CRM, o eco do próprio envio voltando pelo webhook e o
-- resgate do watchdog.
--
-- POR QUÊ. `messages_org_external_id_unique (organization_id, external_id)` é a
-- rede que deveria impedir a mesma mensagem de virar duas linhas. Ela compara
-- STRING. Com o engine NOWEB (o padrão do kit) as trilhas gravavam formas
-- diferentes do MESMO id:
--
--     eco (webhook): true_250302204792918@lid_2A1B890FB8AA87730CBC
--     envio (CRM):   2A1B890FB8AA87730CBC              -- iguais? false
--
-- então o 23505 nunca disparava e a mesma frase aparecia duas vezes na conversa.
-- Visto na instalação que abriu a issue: dois pares de linhas idênticas, ~1,3 s e
-- ~2 s entre a linha `sent_via='ai'` e a `sent_via='external_device'`.
--
-- POR QUE A CAUDA, e não o composto reconstruído dos dois lados: o chat do eco vem
-- do ENGINE (`@lid`, a identidade opaca que o WhatsApp está adotando) e o do envio
-- vem do NOSSO cadastro (`@c.us`, o telefone). Medido com o payload real:
-- o envio monta `true_5525030220479@c.us_2A1B…` e o eco gravou
-- `true_250302204792918@lid_2A1B…` — a chave voltaria a divergir exatamente em
-- quem tem contato `@lid`, que é a instalação de onde a issue veio. A cauda é a
-- única parte que os dois lados sempre têm.
--
-- POR QUE SÓ `provider = 'waha'`. O `wamid.…` da Meta é base64url e CONTÉM `_`.
-- Normalizar a coluna inteira truncaria o id do canal oficial e quebraria o ack
-- dele. A cauda é regra DAQUELE canal, não da tabela.
--
-- POR QUE NÃO ENTRA CHECK NENHUM. Pelo mesmo motivo: a coluna é compartilhada
-- entre canais e um `not like '%_%'` recusaria todo `wamid`. Quem guarda a regra é
-- `tests/unit/identidade-canonica-da-mensagem.test.ts` (as três trilhas) e
-- `tests/invariants/eco-do-envio-nao-duplica.test.ts` (o comportamento no banco).

-- ─────────────────────────────────────────────────────────────────────────────
-- BACKFILL — e a escolha declarada: MESCLAR e MARCAR; apagar só a cópia que este
-- defeito criou.
--
-- Normalizar sem mais nada violaria o unique nas conversas que já duplicaram: as
-- duas linhas passariam a querer a mesma chave. Deduplicar `messages` é apagar
-- histórico de cliente, então o critério é estreito, e cada linha cai num de dois
-- desfechos:
--
--   1. É a cópia que ESTE defeito criou — mesma conversa, mesmo corpo, mesma
--      cauda, ±10 min, `sent_via='external_device'` tendo do outro lado uma linha
--      `ai`/`user` da mesma mensagem. Ela é o eco do nosso próprio envio: não é
--      história do cliente, é a segunda cópia de uma linha que o CRM já tem, com
--      ESTRITAMENTE MENOS informação (sem autor, sem `sent_by_user_id`). Antes de
--      sair, o que ela tiver a mais (bytes de mídia já persistidos) é copiado para
--      a que fica. Essa some.
--   2. Qualquer outra colisão — inclusive uma mensagem legítima do celular que
--      por acaso convirja para a mesma cauda. A linha FICA; ela só perde a chave
--      (`external_id = null`), e o valor antigo é gravado em
--      `metadata.external_id_nao_canonico` para não se perder. O custo é o ack
--      daquela linha, não a mensagem.
-- ─────────────────────────────────────────────────────────────────────────────

-- (1) o que o eco tiver a mais vai para a linha que fica, ANTES de ele sair.
update public.messages ganhadora
   set media_storage_path = eco.media_storage_path,
       media_size_bytes   = coalesce(ganhadora.media_size_bytes, eco.media_size_bytes)
  from public.messages eco
  join public.channel_sessions s on s.id = eco.channel_session_id
 where s.provider = 'waha'
   and eco.sent_via = 'external_device'
   and eco.direction = 'outbound'
   and eco.external_id is not null
   and eco.media_storage_path is not null
   and ganhadora.media_storage_path is null
   and ganhadora.id <> eco.id
   and ganhadora.organization_id = eco.organization_id
   and ganhadora.conversation_id = eco.conversation_id
   and ganhadora.direction = 'outbound'
   and ganhadora.sent_via in ('ai', 'user')
   and ganhadora.external_id is not null
   and nullif(substring(ganhadora.external_id from '[^_]*$'), '')
       = nullif(substring(eco.external_id from '[^_]*$'), '')
   and ganhadora.body is not distinct from eco.body
   and abs(extract(epoch from (ganhadora.sent_at - eco.sent_at))) < 600;

-- (2) a cópia que este defeito criou sai.
delete from public.messages eco
 using public.messages ganhadora, public.channel_sessions s
 where s.id = eco.channel_session_id
   and s.provider = 'waha'
   and eco.sent_via = 'external_device'
   and eco.direction = 'outbound'
   and eco.external_id is not null
   and ganhadora.id <> eco.id
   and ganhadora.organization_id = eco.organization_id
   and ganhadora.conversation_id = eco.conversation_id
   and ganhadora.direction = 'outbound'
   and ganhadora.sent_via in ('ai', 'user')
   and ganhadora.external_id is not null
   and nullif(substring(ganhadora.external_id from '[^_]*$'), '')
       = nullif(substring(eco.external_id from '[^_]*$'), '')
   and ganhadora.body is not distinct from eco.body
   and abs(extract(epoch from (ganhadora.sent_at - eco.sent_at))) < 600;

-- (3) o que ainda colidiria perde a CHAVE, nunca a linha.
--
-- O ranking inclui as linhas de OUTROS canais (`eh_waha = false`): a chave delas
-- não se mexe, então elas vencem o empate por definição — sem isso, uma colisão
-- entre canais faria o passo (4) estourar o unique, e o `update.sh` roda SEM
-- `ON_ERROR_STOP`: a falha passaria em verde e o clone ficaria com metade da
-- normalização aplicada.
with alvo as (
  select m.id,
         m.organization_id,
         m.sent_via,
         m.created_at,
         (s.provider = 'waha') as eh_waha,
         case when s.provider = 'waha'
              then nullif(substring(m.external_id from '[^_]*$'), '')
              else m.external_id
         end as chave_alvo
    from public.messages m
    join public.channel_sessions s on s.id = m.channel_session_id
   where m.external_id is not null
),
ranqueado as (
  select id,
         row_number() over (
           partition by organization_id, chave_alvo
           -- quem NÃO se mexe primeiro; depois quem tem autoria; depois a mais
           -- antiga. `id` só para desempate determinístico.
           order by eh_waha, (sent_via = 'external_device'), created_at, id
         ) as posicao
    from alvo
   where chave_alvo is not null
),
perdedoras as (select id from ranqueado where posicao > 1)
update public.messages m
   set external_id = null,
       metadata = coalesce(m.metadata, '{}'::jsonb)
                  || jsonb_build_object('external_id_nao_canonico', m.external_id)
  from perdedoras p
 where m.id = p.id;

-- (4) e só agora a normalização, que já não pode colidir com nada.
update public.messages m
   set external_id = nullif(substring(m.external_id from '[^_]*$'), '')
  from public.channel_sessions s
 where s.id = m.channel_session_id
   and s.provider = 'waha'
   and m.external_id is not null
   and strpos(m.external_id, '_') > 0
   and nullif(substring(m.external_id from '[^_]*$'), '') is not null;

comment on column public.messages.external_id is
  'Id da mensagem no canal. WhatsApp/WAHA: SEMPRE a cauda (o trecho após o último "_") — as três trilhas de escrita normalizam por canonicalExternalId (lib/channels/types.ts); sem isso o unique (organization_id, external_id) não pega o eco do próprio envio. Outros canais gravam o id como o provedor o manda.';
