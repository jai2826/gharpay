// Every M-POWER CALL is written to the database as well as the local store,
// so the operator and the admin see the same record from any device.
import { supabase } from "@/integrations/supabase/client";
// GHARPAY_TODO: Added the Database Type.
import type { Database, Json } from "@/integrations/supabase/types";
import type { CallRecord } from "./types";

// GHARPAY_TODO: Added the Database Type.
type Row = Database["public"]["Tables"]["call_records"]["Row"];

// GHARPAY_TODO: Added the function to convert a database row to a CallRecord object.
export function rowToRecord(r: Row): CallRecord {
  return {
    id: r.client_id ?? r.id,
    ts: r.called_at,
    ulid: r.lead_ulid ?? "",
    canonicalId: r.canonical_id ?? "",
    name: r.customer_name ?? undefined,
    operatorId: r.operator_id ?? "",
    operatorName: r.operator_name ?? "Unknown",
    agenda: r.agenda as CallRecord["agenda"],
    agendaSource: (r.agenda_source as CallRecord["agendaSource"]) ?? "system",
    outcome: r.outcome as CallRecord["outcome"],
    durationSec: r.duration_sec ?? undefined,
    capture: r.capture as unknown as CallRecord["capture"],
    movement: (r.movement ?? "none") as CallRecord["movement"],
    messageNow: r.message_now ?? "",
    messageSent: r.message_sent,
    followUp: r.follow_up as unknown as CallRecord["followUp"],
    followUpState: (r.follow_up_state ?? "armed") as CallRecord["followUpState"],
    nextStep: r.next_step as unknown as CallRecord["nextStep"],
    stageAfter: r.stage_after ?? "",
    waste: Array.isArray(r.waste) ? (r.waste as unknown as string[]) : [],
  };
}

// GHARPAY_TODO: Added New function to patch the call record in the database when a message is sent or a follow-up is cancelled/sent.
export async function patchCallRecord(
  clientId: string,
  patch: { message_sent?: boolean; follow_up_state?: string; capture?: Json },
): Promise<{ ok: boolean; error?: string }> {
  const { error } = await supabase.from("call_records").update(patch).eq("client_id", clientId);
  return error ? { ok: false, error: error.message } : { ok: true };
}

export async function pushCallRecord(r: CallRecord): Promise<{ ok: boolean; error?: string }> {
  const { data: auth } = await supabase.auth.getUser();
  const row = {
    called_at: r.ts,
    operator_id: auth.user?.id ?? null,
    operator_name: r.operatorName ?? null,
    lead_ulid: r.ulid ?? null,
    canonical_id: r.canonicalId ?? null,
    customer_name: r.name ?? null,
    agenda: r.agenda,
    agenda_source: r.agendaSource ?? null,
    outcome: r.outcome,
    duration_sec: r.durationSec ?? null,
    capture: r.capture as unknown as Json,
    movement: r.movement ?? null,
    message_now: r.messageNow ?? null,
    message_sent: !!r.messageSent,
    follow_up: r.followUp as unknown as Json,
    follow_up_state: r.followUpState ?? null,
    next_step: r.nextStep as unknown as Json,
    stage_after: r.stageAfter ?? null,
    waste: (r.waste ?? []) as unknown as Json,
    client_id: r.id,
  };
  const { error } = await supabase.from("call_records").insert(row);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

/** Calls stored centrally — used by the admin view and by the operator's own history. */
export async function fetchCallRecords(limit = 200) {
  const { data, error } = await supabase
    .from("call_records")
    .select("*")
    .order("called_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data ?? [];
}
