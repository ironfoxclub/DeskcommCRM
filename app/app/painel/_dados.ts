import "server-only";

import { orgTemAutomatico } from "@/lib/ai/agents/org-tem-automatico";
import { listSelectableChannels } from "@/lib/channels/selectable";
import { comandosDaFila } from "@/lib/inbox/comando-da-conversa";
import { createClient } from "@/lib/supabase/server";

/**
 * Os números do Painel, agregados no servidor — o cliente só desenha.
 *
 * Cliente de SESSÃO (RLS), nunca o admin: o Painel mostra o que esta pessoa já
 * poderia ver nas telas de origem, com o mesmo escopo. E cada consulta filtra
 * `organization_id` explicitamente mesmo assim (CLAUDE.md § Multi-tenancy) —
 * quem pertence a duas organizações não pode ver a soma das duas.
 *
 * "Hoje" é o dia no fuso da ORGANIZAÇÃO, não do servidor: a VPS roda em UTC e,
 * depois das 21h em Brasília, o dia UTC já virou.
 *
 * Conversas contam pelo `comando_da_conversa`, com o MESMO predicado dos badges
 * da Inbox (`app/api/v1/conversations/counts`): "na fila" aqui é o número da aba
 * Fila, nunca um segundo cálculo por status.
 */

const LIMITE_LEADS = 5000;

export interface EtapaDoFunil {
  id: string;
  nome: string;
  cor: string | null;
  leads: number;
  valorCents: number;
}

export interface DadosPainel {
  hoje: string;
  fuso: string;
  moeda: string;
  conversas: {
    ativas: number;
    naFila: number;
    comIa: number;
    minhas: number;
  };
  funil: {
    nome: string | null;
    etapas: EtapaDoFunil[];
    abertos: number;
    valorAbertoCents: number;
  };
  leadsPorDia: { dia: string; total: number }[];
  mes: { ganhos: number; perdidos: number; valorGanhoCents: number };
  tarefas: {
    atrasadas: number;
    hoje: number;
    minhas: number;
    abertas: number;
    proximas: { id: string; titulo: string; prazo: string | null; prioridade: string }[];
  };
  agenda: { id: string; titulo: string; inicio: string; status: string }[];
  conexoes: { id: string; nome: string; status: string }[];
}

function diaNoFuso(d: Date, fuso: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: fuso }).format(d);
}

/** Meia-noite de `dia` no `fuso`, como instante UTC. */
function inicioDoDia(dia: string, fuso: string): Date {
  const meioDiaUtc = new Date(`${dia}T12:00:00Z`);
  const partes = new Intl.DateTimeFormat("en-US", {
    timeZone: fuso,
    hour: "numeric",
    hourCycle: "h23",
  }).format(meioDiaUtc);
  // Ao meio-dia UTC, a hora local diz o deslocamento do fuso naquele dia.
  const deslocamentoH = Number(partes) - 12;
  return new Date(Date.parse(`${dia}T00:00:00Z`) - deslocamentoH * 3600_000);
}

function somarDias(dia: string, n: number): string {
  const d = new Date(`${dia}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export async function carregarPainel(args: {
  orgId: string;
  userId: string;
  fuso?: string | null;
}): Promise<DadosPainel> {
  const { orgId, userId } = args;
  const fuso = args.fuso || "America/Sao_Paulo";
  const supabase = await createClient();

  const agora = new Date();
  const hoje = diaNoFuso(agora, fuso);
  const inicioHoje = inicioDoDia(hoje, fuso).toISOString();
  const inicioAmanha = inicioDoDia(somarDias(hoje, 1), fuso).toISOString();
  const inicioJanela = inicioDoDia(somarDias(hoje, -13), fuso).toISOString();
  const inicioMes = inicioDoDia(`${hoje.slice(0, 8)}01`, fuso).toISOString();

  const contar = (q: PromiseLike<{ count: number | null }>) => q.then((r) => r.count ?? 0);
  const conversas = () =>
    supabase
      .from("conversations")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", orgId)
      .eq("is_group", false);

  const automaticoDaOrg = await orgTemAutomatico(supabase, orgId);

  const [ativas, naFila, comIa, minhas, pipelinesR, leadsJanelaR, fechadosR, tarefasR, agendaR, conexoesR] =
    await Promise.all([
      contar(conversas().neq("comando_da_conversa", "encerrada")),
      contar(conversas().in("comando_da_conversa", comandosDaFila(automaticoDaOrg))),
      contar(conversas().eq("comando_da_conversa", "automatico")),
      contar(conversas().neq("comando_da_conversa", "encerrada").eq("assigned_to_user_id", userId)),
      supabase
        .from("crm_pipelines")
        .select("id,name,is_default,position")
        .eq("organization_id", orgId)
        .eq("is_archived", false)
        .order("is_default", { ascending: false })
        .order("position", { ascending: true })
        .limit(1),
      supabase
        .from("crm_leads")
        .select("created_at")
        .eq("organization_id", orgId)
        .gte("created_at", inicioJanela)
        .limit(LIMITE_LEADS),
      supabase
        .from("crm_leads")
        .select("status,value_cents,currency")
        .eq("organization_id", orgId)
        .in("status", ["won", "lost"])
        .gte("closed_at", inicioMes)
        .limit(LIMITE_LEADS),
      supabase
        .from("crm_tasks")
        .select("id,title,due_date,priority,assigned_to")
        .eq("organization_id", orgId)
        .in("status", ["pending", "in_progress"])
        .order("due_date", { ascending: true, nullsFirst: false })
        .limit(500),
      supabase
        .from("calendar_appointments")
        .select("id,title,starts_at,status")
        .eq("organization_id", orgId)
        .in("status", ["pending", "confirmed"])
        .gte("starts_at", inicioHoje)
        .lt("starts_at", inicioAmanha)
        .order("starts_at", { ascending: true })
        .limit(8),
      // A fonte única dos canais: fora os arquivados e as linhas de voz.
      listSelectableChannels(supabase, orgId).catch(() => []),
    ]);

  // ── Funil: etapas do funil padrão e os leads em aberto em cada uma ─────────
  const pipeline = pipelinesR.data?.[0] ?? null;
  let etapas: EtapaDoFunil[] = [];
  let moedaDosAbertos: string | null = null;
  if (pipeline) {
    const [etapasR, abertosR] = await Promise.all([
      supabase
        .from("crm_stages")
        .select("id,name,color,is_won,is_lost")
        .eq("organization_id", orgId)
        .eq("pipeline_id", pipeline.id)
        .eq("is_archived", false)
        .order("position", { ascending: true }),
      supabase
        .from("crm_leads")
        .select("stage_id,value_cents,currency")
        .eq("organization_id", orgId)
        .eq("pipeline_id", pipeline.id)
        .eq("status", "open")
        .limit(LIMITE_LEADS),
    ]);
    const porEtapa = new Map<string, { leads: number; valorCents: number }>();
    for (const l of abertosR.data ?? []) {
      const e = porEtapa.get(l.stage_id) ?? { leads: 0, valorCents: 0 };
      e.leads += 1;
      e.valorCents += l.value_cents ?? 0;
      porEtapa.set(l.stage_id, e);
      moedaDosAbertos ??= l.currency;
    }
    etapas = (etapasR.data ?? [])
      .filter((s) => !s.is_won && !s.is_lost)
      .map((s) => ({
        id: s.id,
        nome: s.name,
        cor: s.color,
        leads: porEtapa.get(s.id)?.leads ?? 0,
        valorCents: porEtapa.get(s.id)?.valorCents ?? 0,
      }));
  }

  // ── Leads novos por dia (14 dias, no fuso da organização) ───────────────────
  const porDia = new Map<string, number>();
  for (let i = 13; i >= 0; i--) porDia.set(somarDias(hoje, -i), 0);
  for (const l of leadsJanelaR.data ?? []) {
    const dia = diaNoFuso(new Date(l.created_at), fuso);
    if (porDia.has(dia)) porDia.set(dia, (porDia.get(dia) ?? 0) + 1);
  }

  const fechados = fechadosR.data ?? [];
  const tarefas = tarefasR.data ?? [];

  return {
    hoje,
    fuso,
    moeda: moedaDosAbertos ?? fechados.find((f) => f.currency)?.currency ?? "BRL",
    conversas: { ativas, naFila, comIa, minhas },
    funil: {
      nome: pipeline?.name ?? null,
      etapas,
      abertos: etapas.reduce((a, e) => a + e.leads, 0),
      valorAbertoCents: etapas.reduce((a, e) => a + e.valorCents, 0),
    },
    leadsPorDia: [...porDia.entries()].map(([dia, total]) => ({ dia, total })),
    mes: {
      ganhos: fechados.filter((f) => f.status === "won").length,
      perdidos: fechados.filter((f) => f.status === "lost").length,
      valorGanhoCents: fechados
        .filter((f) => f.status === "won")
        .reduce((a, f) => a + (f.value_cents ?? 0), 0),
    },
    tarefas: {
      abertas: tarefas.length,
      atrasadas: tarefas.filter((t) => t.due_date && Date.parse(t.due_date) < Date.parse(inicioHoje)).length,
      hoje: tarefas.filter(
        (t) =>
          t.due_date &&
          Date.parse(t.due_date) >= Date.parse(inicioHoje) &&
          Date.parse(t.due_date) < Date.parse(inicioAmanha),
      ).length,
      minhas: tarefas.filter((t) => t.assigned_to === userId).length,
      proximas: tarefas
        .filter((t) => t.due_date)
        .slice(0, 3)
        .map((t) => ({ id: t.id, titulo: t.title, prazo: t.due_date, prioridade: t.priority })),
    },
    agenda: (agendaR.data ?? []).map((a) => ({
      id: a.id,
      titulo: a.title,
      inicio: a.starts_at,
      status: a.status,
    })),
    conexoes: conexoesR.slice(0, 6).map((c) => ({
      id: c.id,
      nome: c.display_name || c.phone_number || "WhatsApp",
      status: c.status,
    })),
  };
}
