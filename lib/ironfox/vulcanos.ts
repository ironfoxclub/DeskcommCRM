import { safeNext } from "@/lib/auth/safe-next";

/**
 * Fork IronFox — login central no VulcanOS (o hub da agência).
 *
 * Os dois apps usam o MESMO projeto Supabase, então o usuário já é o mesmo; o que
 * não atravessa é o cookie, porque os domínios são diferentes. A ponte é um link
 * de acesso de uso único (`generateLink` magiclink), gerado por quem tem sessão e
 * trocado por sessão do outro lado:
 *   - VulcanOS → CRM: `GET {VULCANOS}/api/sso/crm` → `/auth/vulcanos` aqui;
 *   - CRM → VulcanOS: `/api/ironfox/vulcanos` aqui → `GET {VULCANOS}/auth/crm`.
 *
 * Fixo aqui, e não numa NEXT_PUBLIC_*, porque a imagem Docker queima essas no
 * build com placeholder (ver app/public-env-script.tsx).
 */
export const URL_DO_VULCANOS = "https://vulcanos-app.vercel.app";

/**
 * Trava contra vai e volta: `/auth/vulcanos` grava este cookie por um minuto e a
 * tela de login não reenvia ao VulcanOS enquanto ele existir. Se a sessão recém
 * criada não pegar por qualquer motivo, a pessoa vê a tela de login do CRM em vez
 * de ficar presa num redirecionamento infinito.
 */
export const COOKIE_TENTATIVA_LOGIN_CENTRAL = "ironfox_login_central";

/**
 * Marca o navegador de quem já entrou pelo VulcanOS (equipe IronFox). Só nesses
 * navegadores a tela de login manda direto ao login central; os clientes que
 * usam o CRM veem a tela de login do próprio CRM, sem passar pelo hub interno.
 */
export const COOKIE_EQUIPE_IRONFOX = "ironfox_equipe";

/** Tela de login do VulcanOS, que devolve a pessoa logada em `next`. */
export function urlDoLoginCentral(next: string | undefined | null): string {
  const url = new URL("/api/sso/crm", URL_DO_VULCANOS);
  url.searchParams.set("next", safeNext(next, "/app"));
  return url.toString();
}
