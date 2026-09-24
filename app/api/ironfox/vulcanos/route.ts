import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { URL_DO_VULCANOS } from "@/lib/ironfox/vulcanos";

export const dynamic = "force-dynamic";

/**
 * Fork IronFox — ida para o VulcanOS já logado (ver lib/ironfox/vulcanos.ts).
 *
 * Rota autenticada (o `proxy.ts` barra quem não tem sessão). Gera um link de
 * acesso de uso único para o usuário atual e manda para o VulcanOS, que o troca
 * por sessão em `/auth/crm`. É o destino do atalho "VulcanOS" da barra lateral.
 */
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user?.email) return NextResponse.redirect(URL_DO_VULCANOS);

  const { data, error } = await createAdminClient().auth.admin.generateLink({
    type: "magiclink",
    email: user.email,
  });

  // Sem link, abre o VulcanOS do jeito normal (tela de login de lá).
  if (error || !data.properties?.hashed_token) return NextResponse.redirect(URL_DO_VULCANOS);

  const destino = new URL("/auth/crm", URL_DO_VULCANOS);
  destino.searchParams.set("token_hash", data.properties.hashed_token);
  const resposta = NextResponse.redirect(destino);
  resposta.headers.set("cache-control", "no-store");
  return resposta;
}
