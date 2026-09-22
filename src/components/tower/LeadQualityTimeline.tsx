import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { STATUS_CLASS, STATUS_LABEL, TEAM_LABEL, fmtTime } from "@/lib/tower/review-os";
import type { Database } from "@/integrations/supabase/types";
import { useBookingFlow } from "@/bookingflow/store";

type Row = Database["public"]["Tables"]["lead_timeline"]["Row"];

const isUuid = (val?: string | null): boolean =>
  typeof val === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(val);

export function LeadQualityTimeline({ leadId, limit = 60 }: { leadId: string; limit?: number }) {
  const [rows, setRows] = useState<Row[]>([]);
  const [names, setNames] = useState<Record<string, string>>({});

  const load = async () => {
    if (!isUuid(leadId)) {
      const bfLead = useBookingFlow.getState().leads.find((l) => l.id === leadId || l.canonicalId === leadId || l.phone === leadId);
      if (bfLead && bfLead.events) {
        const synthetic: Row[] = [...bfLead.events].reverse().slice(0, limit).map((e, idx) => ({
          id: `ev-${leadId}-${idx}`,
          lead_id: leadId,
          at: e.at,
          team: "calling" as any,
          activity: `${e.label}${e.detail ? ` — ${e.detail}` : ""}`,
          actor: e.actor || "Handler",
          score: null,
          feedback_status: null,
          metadata: null,
          created_at: e.at,
        }));
        setRows(synthetic);
      } else {
        setRows([]);
      }
      return;
    }
    const { data } = await supabase
      .from("lead_timeline")
      .select("*")
      .eq("lead_id", leadId)
      .order("at", { ascending: false })
      .limit(limit);
    setRows((data ?? []) as Row[]);
  };

  useEffect(() => {
    load();
    if (!isUuid(leadId)) return;
    const ch = supabase
      .channel(`timeline-${leadId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "lead_timeline", filter: `lead_id=eq.${leadId}` }, () => load())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leadId]);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.from("profiles").select("user_id, full_name");
      setNames(Object.fromEntries((data ?? []).map((p) => [p.user_id, p.full_name ?? "Member"])));
    })();
  }, []);

  return (
    <Card className="p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="font-semibold text-sm">Lead Quality Timeline</div>
        <div className="text-[11px] text-muted-foreground">One lead · one timeline · visible to every team</div>
      </div>
      {rows.length === 0 && <div className="text-sm text-muted-foreground">No timeline entries yet.</div>}
      <ol className="relative border-l pl-4 space-y-3">
        {rows.map((r) => (
          <li key={r.id} className="relative">
            <span className="absolute -left-[21px] top-1.5 h-2 w-2 rounded-full bg-primary" />
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="font-mono text-xs text-muted-foreground">{fmtTime(r.at)}</span>
              {r.team && <Badge variant="outline" className="text-[10px]">{TEAM_LABEL[r.team]}</Badge>}
              <span className="font-medium">{r.activity}</span>
              {typeof r.score === "number" && <Badge variant="secondary" className="text-[10px]">Score {r.score}</Badge>}
              {r.feedback_status && <Badge className={`text-[10px] ${STATUS_CLASS[r.feedback_status]}`}>{STATUS_LABEL[r.feedback_status]}</Badge>}
            </div>
            <div className="text-xs text-muted-foreground mt-0.5 space-x-2">
              {r.actor && <span>by {names[r.actor] ?? "Member"}</span>}
              {r.prev_stage && <span>· {r.prev_stage} → {r.new_stage}</span>}
              {!r.prev_stage && r.new_stage && <span>· stage {r.new_stage}</span>}
              {r.new_owner && <span>· owner {names[r.new_owner] ?? "Member"}</span>}
              {r.customer_outcome && <span>· outcome {r.customer_outcome}</span>}
              {r.detail && <span>· {r.detail}</span>}
              {r.next_action && <span>· next: {r.next_action}</span>}
              {r.deadline && <span>· due {fmtTime(r.deadline)}</span>}
            </div>
          </li>
        ))}
      </ol>
    </Card>
  );
}
