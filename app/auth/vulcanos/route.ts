import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { createClient } from "@/lib/supabase/server";
import { safeNext } from "@/lib/auth/safe-next";
import { cookieSecure } from "@/lib/supabase/cookie-secure";
import { COOKIE_EQUIPE_IRONFOX, COOKIE_TENTATIVA_LOGIN_CENTRAL } from "@/lib/ironfox/vulcanos";
import { audit } from "@/lib/audit";
import { env } from "@/lib/env";

export const dynamic = "force-dynamic";

/**
 * Fork IronFox — chegada do login central (ver lib/ironfox/vulcanos.ts).
 *
 * O VulcanOS gerou um link de acesso de uso único para quem já estava logado lá;
 * aqui ele vira sessão do CRM. Rota pública (lib/auth/public-paths.ts): quem chega
 * vem de outro site e, por definição, sem o cookie `Strict` de sessão.
 *
 * A saída é por PÁGINA-PONTE, não redirect — mesmo motivo da volta da Agenda
 * (app/api/v1/agenda/google/callback/route.ts): um 307 daqui ainda pertence à
 * navegação iniciada no VulcanOS, o cookie `Strict` recém gravado não viajaria e o
 * `proxy.ts` mandaria para `/login`.
 *
 * `org` (opcional) é a organization do cliente clicado no VulcanOS: vira o cookie
 * `active_org`, e o CRM já abre nela. Não precisa conferir vínculo aqui — o
 * `resolveActiveOrg` (lib/auth/server.ts) só aceita o cookie se a pessoa for membro
 * e, se não for, cai na primeira organization, como sem o cookie.
 */
export async function GET(request: NextRequest) {
  const url = request.nextUrl;
  const tokenHash = url.searchParams.get("token_hash");
  const next = safeNext(url.searchParams.get("next"), "/app");
  const orgPedida = url.searchParams.get("org");
  const org = z.string().uuid().safeParse(orgPedida).success ? orgPedida : null;
  const requestId = request.headers.get("x-request-id");

  const redirectTo = (path: string) => NextResponse.redirect(new URL(path, env.NEXT_PUBLIC_APP_URL));

  if (!tokenHash) return redirectTo("/login?error=link_invalido");

  const supabase = await createClient();
  const { data, error } = await supabase.auth.verifyOtp({ type: "magiclink", token_hash: tokenHash });

  if (error || !data?.user) {
    await audit({
      action: "auth.email_link_rejected",
      metadata: { formato: "login_central", reason: (error?.message ?? "no_user").slice(0, 200) },
      requestId,
    });
    return redirectTo("/login?error=link_invalido");
  }

  // Mesma regra da entrada com Google: quem tem autenticador ativo confirma o
  // código antes de entrar.
  let destino = next;
  const { data: fatores } = await supabase.auth.mfa.listFactors();
  const totpVerificado = fatores?.totp?.find((f) => f.status === "verified");
  if (totpVerificado) {
    destino = `/login/mfa?${new URLSearchParams({ factor: totpVerificado.id, next })}`;
  }

  await audit({
    action: "auth.login_success",
    actorUserId: data.user.id,
    metadata: { provider: "vulcanos" },
    requestId,
  });

  return ponte(destino, org);
}

function ponte(caminho: string, org: string | null): NextResponse {
  const destino = new URL(caminho, env.NEXT_PUBLIC_APP_URL).toString();
  const seguro = destino
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
  const resposta = new NextResponse(
    `<!doctype html><html lang="pt-br"><head><meta charset="utf-8">` +
      `<meta name="robots" content="noindex">` +
      `<noscript><meta http-equiv="refresh" content="0;url=${seguro}"></noscript>` +
      `<title>Entrando…</title></head><body>` +
      `<p>Entrando no CRM…</p>` +
      `<script>location.replace(${JSON.stringify(destino).replace(/</g, "\u003c")})</script>` +
      `<noscript><p><a href="${seguro}">Continuar</a></p></noscript>` +
      `</body></html>`,
    {
      status: 200,
      headers: {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store",
        // O link de uso único está na URL desta página — não vaza para lugar nenhum.
        "referrer-policy": "no-referrer",
      },
    },
  );
  resposta.cookies.set(COOKIE_TENTATIVA_LOGIN_CENTRAL, "1", {
    httpOnly: true,
    sameSite: "lax",
    secure: cookieSecure(),
    path: "/",
    maxAge: 60,
  });
  resposta.cookies.set(COOKIE_EQUIPE_IRONFOX, "1", {
    httpOnly: true,
    sameSite: "lax",
    secure: cookieSecure(),
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });
  if (org) {
    resposta.cookies.set("active_org", org, {
      httpOnly: true,
      sameSite: "strict",
      secure: cookieSecure(),
      path: "/",
      maxAge: 60 * 60 * 24 * 30,
    });
  }
  return resposta;
}
