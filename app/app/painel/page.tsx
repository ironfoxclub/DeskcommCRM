import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { requireAuth, resolveActiveOrg } from "@/lib/auth/server";
import { traduzir } from "@/lib/i18n/dicionario";

import { carregarPainel } from "./_dados";
import { PainelClient } from "./_components/PainelClient";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Painel" };

/**
 * PAINEL — a primeira tela do dia: o que está esperando resposta, como está o
 * funil, o que vence hoje e o que está marcado. Antes dele, o único painel do
 * produto era o do super-admin (`app/admin/(protected)/dashboard`), que olha a
 * PLATAFORMA inteira; quem opera uma organização caía direto na Inbox sem
 * visão nenhuma do conjunto.
 *
 * Todo papel vê (`viewer`): cada número é leitura com o escopo que a RLS já dá
 * nas telas de origem, e cada widget é um atalho para ela.
 */
export default async function PainelPage() {
  const user = await requireAuth();
  const activeOrg = await resolveActiveOrg(user);
  if (!activeOrg) redirect("/app/settings/profile");

  const dados = await carregarPainel({
    orgId: activeOrg.orgId,
    userId: user.id,
    fuso: activeOrg.timezone,
  });
  const idioma = user.idioma;

  return (
    <div className="flex h-full flex-col gap-4 p-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">{traduzir("Painel", idioma)}</h1>
        <p className="text-sm text-muted-foreground">
          {traduzir("A operação de hoje numa tela só. Clique num widget para ir até a tela dele.", idioma)}
        </p>
      </header>
      <PainelClient dados={dados} userId={user.id} orgId={activeOrg.orgId} />
    </div>
  );
}
