/**
 * Fork IronFox — POST /api/internal/vulcanos/avisar
 *
 * O VulcanOS (Fase 33c) manda o resumo das 8h e os alertas na hora pelo
 * WhatsApp. O WAHA não fica aberto na internet, então o VulcanOS pede para o
 * CRM enviar por uma sessão já conectada aqui.
 *
 * Arquivo novo, e sob `/api/internal/` (já público no `proxy`, auth dentro da
 * rota), para não tocar em nenhum arquivo do original e não dar conflito
 * quando o CRM de cima atualizar.
 *
 * Auth: `authorization: Bearer <VULCANOS_AVISOS_SECRET>`. Sem a variável no
 * servidor, responde 404 (a rota "não existe").
 * Body: { sessao_id: uuid de channel_sessions, para: telefone só com dígitos
 * (com DDI), texto }.
 */
import { type NextRequest } from "next/server";
import { z } from "zod";

import { ok, fail } from "@/lib/api/wrappers";
import { createAdminClient } from "@/lib/supabase/admin";
import { getWahaClient, wahaFriendlyError } from "@/lib/waha/client";
import { resolveCanonicalCusChatId } from "@/lib/waha/resolve-contact-whatsapp-id";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const bodySchema = z.object({
  sessao_id: z.string().uuid(),
  para: z.string().regex(/^\d{10,15}$/, "telefone só com dígitos, com DDI"),
  texto: z.string().min(1).max(4000),
});

function timingSafeEq(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
}

export async function POST(req: NextRequest) {
  const segredo = process.env.VULCANOS_AVISOS_SECRET;
  if (!segredo) return fail("not_found", "Not found", 404);

  const match = /^Bearer\s+(.+)$/i.exec((req.headers.get("authorization") ?? "").trim());
  if (!match || !timingSafeEq(match[1]!.trim(), segredo)) {
    return fail("unauthorized", "Chave inválida", 401);
  }

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return fail("validation_error", "Corpo inválido", 400, { details: parsed.error.flatten() });
  }
  const { sessao_id, para, texto } = parsed.data;

  const { data: sessao } = await createAdminClient()
    .from("channel_sessions")
    .select("waha_session_name, provider, status, archived_at")
    .eq("id", sessao_id)
    .maybeSingle();
  if (!sessao || sessao.archived_at || sessao.provider !== "waha" || !sessao.waha_session_name) {
    return fail("not_found", "Sessão de WhatsApp não encontrada", 404);
  }
  if (sessao.status !== "WORKING") {
    return fail("sessao_desconectada", `WhatsApp desconectado no CRM (status ${sessao.status})`, 409);
  }

  const waha = getWahaClient();
  if (!waha) return fail("waha_indisponivel", "WAHA não configurado no CRM", 503);

  try {
    // Resolve o nono dígito do celular brasileiro (e `@lid`) como o envio normal do CRM.
    const chatId = await resolveCanonicalCusChatId(waha, sessao.waha_session_name, `${para}@c.us`);
    await waha.sendMessage(sessao.waha_session_name, chatId, texto);
  } catch (erro) {
    return fail("envio_falhou", wahaFriendlyError(erro), 502);
  }
  return ok({ enviado: true });
}
