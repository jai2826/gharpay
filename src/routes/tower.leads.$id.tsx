import { RoleGate } from "@/components/tower/RoleGate";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PRIORITY_COLORS, PRIORITY_LABELS, SCENARIOS, priorityFor, type LeadPriority, type ScenarioCode } from "@/lib/tower/scoring";
import { logFirstAction, reassign, setScenarioAndNextAction, acceptAssignment, reopenCycle, closeCycle, claimCowork } from "@/lib/tower/engine";
import { Input } from "@/components/ui/input";
import { MOVE_IN_LABELS, type MoveInBucket } from "@/lib/tower/scoring";
import { useTowerAuth } from "@/lib/tower/auth";
import { toast } from "sonner";
import { LeadQualityTimeline } from "@/components/tower/LeadQualityTimeline";
import { SellThisPG } from "@/components/supply/SellThisPG";
import { useBookingFlow, autoTemp } from "@/bookingflow/store";
import { ArrowLeft, ExternalLink } from "lucide-react";

export const Route = createFileRoute("/tower/leads/$id")({ component: () => <RoleGate module="my-leads"><LeadDetail /></RoleGate> });

const isUuid = (val?: string | null): boolean =>
  typeof val === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(val);

function LeadDetail() {
  const { id } = Route.useParams();
  const auth = useTowerAuth();
  const [loading, setLoading] = useState(true);
  const [isBf, setIsBf] = useState(false);
  const [lead, setLead] = useState<any>(null);
  const [assignments, setAssignments] = useState<any[]>([]);
  const [scenarios, setScenarios] = useState<any[]>([]);
  const [next, setNext] = useState<any[]>([]);
  const [cycles, setCycles] = useState<any[]>([]);
  const [scen, setScen] = useState<ScenarioCode | "">("");
  const [notes, setNotes] = useState("");
  const [reason, setReason] = useState("");
  const [reopenReason, setReopenReason] = useState("");
  const [reopenBucket, setReopenBucket] = useState<MoveInBucket | "">("");
  const [reopenLocation, setReopenLocation] = useState("");
  const [closeReason, setCloseReason] = useState("");
  const [coworkReason, setCoworkReason] = useState("");

  const load = async () => {
    setLoading(true);
    if (isUuid(id)) {
      try {
        const [l, a, s, n, c] = await Promise.all([
          supabase.from("leads").select("*, zones(name, code)").eq("id", id).maybeSingle(),
          supabase.from("assignments").select("*").eq("lead_id", id).order("assigned_at", { ascending: false }),
          supabase.from("lead_scenarios_log").select("*").eq("lead_id", id).order("created_at", { ascending: false }),
          supabase.from("next_actions").select("*").eq("lead_id", id).order("due_at", { ascending: true }),
          supabase.from("lead_cycles").select("*").eq("lead_id", id).order("cycle_no", { ascending: false }),
        ]);
        if (l.data) {
          setLead(l.data);
          setAssignments(a.data ?? []);
          setScenarios(s.data ?? []);
          setNext(n.data ?? []);
          setCycles(c.data ?? []);
          setIsBf(false);
          setLoading(false);
          return;
        }
      } catch (err) {
        console.error("Failed to load UUID lead from Supabase:", err);
      }
    }

    // Fall back to Booking Flow store for bf-* or non-UUID leads
    let bfLead = useBookingFlow.getState().leads.find((item) => item.id === id || item.canonicalId === id || item.phone === id);
    if (!bfLead) {
      try {
        const raw = localStorage.getItem("gharpayy-booking-flow-v2");
        if (raw) {
          const parsed = JSON.parse(raw);
          if (parsed?.state?.leads) {
            bfLead = parsed.state.leads.find((l: any) => l.id === id || l.canonicalId === id || l.phone === id);
          }
        }
      } catch {
        // ignore
      }
    }

    if (bfLead) {
      setIsBf(true);
      const isHot = autoTemp(bfLead) === "HOT";
      const leadScore = bfLead.score ?? (isHot ? 88 : 65);
      const priority = bfLead.priority ? (bfLead.priority.toLowerCase() as LeadPriority) : priorityFor(leadScore);
      const isClosed = bfLead.stage === "SETTLED" || bfLead.f?.["closed"] === "true";

      const mappedLead = {
        id: bfLead.id,
        wa_name: bfLead.name,
        name: bfLead.name,
        phone: bfLead.phone,
        score: leadScore,
        priority,
        status: isClosed ? "closed" : "open",
        movein_bucket: (bfLead.f?.["moveIn"] as MoveInBucket) || (bfLead.q?.moveIn as MoveInBucket) || "within_7d",
        location_text: bfLead.f?.["area"] || bfLead.q?.area || "Bangalore",
        zones: { name: bfLead.f?.["area"] || bfLead.q?.area || "Bangalore", code: "BLR" },
        current_scenario: (bfLead.f?.["scenario"] as ScenarioCode) || "connected_qualified",
        budget_min: bfLead.f?.["budget"] ? Number(bfLead.f["budget"]) : 12000,
        budget_max: bfLead.f?.["budget"] ? Number(bfLead.f["budget"]) + 4000 : 18000,
        raw_bf: bfLead,
      };

      const ownerId = auth.user?.id || "current-user";
      const asg = [
        {
          id: `asg-${bfLead.id}`,
          lead_id: bfLead.id,
          owner_id: ownerId,
          owner_name: bfLead.owner || "Handler",
          state: "accepted",
          priority: 1,
          assigned_at: bfLead.ownedAt || bfLead.lastActivityAt || new Date().toISOString(),
          first_action_at: bfLead.lastActionAt || new Date().toISOString(),
          reassign_reason: null,
        },
      ];

      const cyc = [
        {
          id: `cycle-${bfLead.id}-1`,
          lead_id: bfLead.id,
          cycle_no: 1,
          opened_at: bfLead.lastActivityAt || new Date().toISOString(),
          open_reason: bfLead.lastMessage ? `Inquiry: “${bfLead.lastMessage}”` : "Booking Flow lead",
          closed_at: isClosed ? new Date().toISOString() : null,
          close_reason: isClosed ? (bfLead.f?.["closeReason"] || "Settled / Closed") : null,
        },
      ];

      const na = bfLead.nextAction ? [
        {
          id: `na-${bfLead.id}`,
          lead_id: bfLead.id,
          kind: bfLead.nextAction,
          due_at: bfLead.nextActionAt || new Date(Date.now() + 2 * 3600000).toISOString(),
          done_at: null,
        },
      ] : [];

      const sc = (bfLead.events || []).map((e, idx) => ({
        id: `scen-${bfLead.id}-${idx}`,
        lead_id: bfLead.id,
        scenario: "connected_qualified" as ScenarioCode,
        notes: `${e.actor}: ${e.label}${e.detail ? ` — ${e.detail}` : ""}`,
        created_at: e.at,
      }));

      setLead(mappedLead);
      setAssignments(asg);
      setCycles(cyc);
      setNext(na);
      setScenarios(sc);
      setLoading(false);
      return;
    }

    setLead(null);
    setLoading(false);
  };

  useEffect(() => { load(); }, [id]);

  if (loading) {
    return <div className="p-8 text-center text-sm text-muted-foreground">Loading lead details…</div>;
  }

  if (!lead) {
    return (
      <Card className="p-8 text-center space-y-4 max-w-lg mx-auto mt-8">
        <h2 className="text-xl font-bold">Lead Not Found</h2>
        <p className="text-sm text-muted-foreground">
          Could not find lead ID <code className="bg-muted px-1.5 py-0.5 rounded text-xs">{id}</code> in Control Tower or Booking Flow.
        </p>
        <div className="flex justify-center gap-3">
          <Button variant="outline" asChild>
            <Link to="/closing">← Back to Closing</Link>
          </Button>
          <Button variant="outline" asChild>
            <Link to="/tower">Control Tower</Link>
          </Button>
          <Button variant="outline" asChild>
            <Link to="/booking-flow">Booking Flow</Link>
          </Button>
        </div>
      </Card>
    );
  }

  const openAsg = assignments.find((a) => a.state === "pending_accept" || a.state === "accepted");
  const isOwner = isBf ? true : Boolean(openAsg && auth.user?.id === openAsg.owner_id);
  const isClosed = lead.status !== "open";
  const currentCycleNo = cycles[0]?.cycle_no ?? 1;
  // Group history by cycle for the "15+ enquiries" timeline.
  const historyByCycle = cycles.map((c) => ({
    cycle: c,
    assignments: assignments.filter((a) => a.cycle_id === c.id),
    scenarios: scenarios.filter((s) => {
      const cs = new Date(s.created_at).getTime();
      const o = new Date(c.opened_at).getTime();
      const cl = c.closed_at ? new Date(c.closed_at).getTime() : Infinity;
      return cs >= o && cs <= cl;
    }),
  }));

  return (
    <div className="space-y-4">
      {/* Top back & contextual navigation strip */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b pb-3">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" asChild className="h-8 gap-1 text-xs">
            <Link to="/closing">
              <ArrowLeft className="h-3.5 w-3.5" /> Back to Closing
            </Link>
          </Button>
          <Button variant="ghost" size="sm" asChild className="h-8 text-xs text-muted-foreground">
            <Link to="/tower/my-leads">My Leads</Link>
          </Button>
        </div>
        {isBf && (
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="text-[11px] text-muted-foreground">
              Booking Flow Customer
            </Badge>
            <Button variant="outline" size="sm" asChild className="h-8 gap-1.5 text-xs">
              <Link to="/booking-flow-split">
                Open in Split Screen <ExternalLink className="h-3 w-3" />
              </Link>
            </Button>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-4">
        <div className="space-y-4">
          <Card className="p-4">
            <div className="flex items-center gap-3 flex-wrap">
              {lead.priority && <Badge className={PRIORITY_COLORS[lead.priority as keyof typeof PRIORITY_COLORS]}>{PRIORITY_LABELS[lead.priority as keyof typeof PRIORITY_LABELS]}</Badge>}
              <h1 className="text-xl font-bold">{lead.wa_name ?? "Unknown"} · {lead.phone}</h1>
              <span className="text-sm text-muted-foreground">{lead.zones?.name} · Score {lead.score} · {lead.movein_bucket}</span>
              <Badge variant="outline">Cycle #{currentCycleNo} of {cycles.length}</Badge>
              {isClosed && <Badge variant="destructive">Closed</Badge>}
            </div>
            {lead.current_scenario && <div className="text-sm mt-2">Current scenario: <span className="font-medium">{SCENARIOS.find((s) => s.code === lead.current_scenario)?.label}</span></div>}
          </Card>

          {isOwner && openAsg && (
            <Card className="p-4 space-y-3">
              <div className="font-semibold">Progress this lead</div>
              {openAsg.state === "pending_accept" && (
                <Button onClick={async () => {
                  if (isBf) {
                    toast.success("Accepted");
                  } else {
                    await acceptAssignment(openAsg.id);
                    toast.success("Accepted");
                  }
                  load();
                }}>Accept & Work</Button>
              )}
              {openAsg.state === "accepted" && !openAsg.first_action_at && (
                <Button variant="secondary" onClick={async () => {
                  if (isBf) {
                    useBookingFlow.getState().logActivity(id, "First contact logged", "Logged from Control Tower");
                    toast.success("First action logged");
                  } else {
                    await logFirstAction(openAsg.id, "First contact logged");
                    toast.success("First action logged");
                  }
                  load();
                }}>Log first action</Button>
              )}
              <div>
                <div className="text-sm font-medium mb-1">Set lead scenario (mandatory)</div>
                <Select value={scen} onValueChange={(v) => setScen(v as ScenarioCode)}>
                  <SelectTrigger><SelectValue placeholder="Pick scenario…" /></SelectTrigger>
                  <SelectContent>{SCENARIOS.map((s) => <SelectItem key={s.code} value={s.code}>{s.label}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <Textarea placeholder="Notes (optional)" value={notes} onChange={(e) => setNotes(e.target.value)} />
              <Button disabled={!scen} onClick={async () => {
                if (isBf) {
                  const scenObj = SCENARIOS.find((s) => s.code === scen);
                  const kind = scenObj?.nextAction.kind ?? "Follow up";
                  const due = new Date(Date.now() + (scenObj?.nextAction.dueInMin ?? 60) * 60_000).toISOString();
                  useBookingFlow.getState().setNext(id, kind, due);
                  useBookingFlow.getState().editFields(id, { scenario: scen }, `Scenario set: ${scenObj?.label}`);
                  if (notes) {
                    useBookingFlow.getState().logActivity(id, `Scenario: ${scenObj?.label}`, notes);
                  }
                  toast.success("Scenario set — next action created");
                  setScen(""); setNotes(""); load();
                } else {
                  await setScenarioAndNextAction({ leadId: id, assignmentId: openAsg.id, scenario: scen as ScenarioCode, notes, ownerId: openAsg.owner_id });
                  toast.success("Scenario set — next action created");
                  setScen(""); setNotes(""); load();
                }
              }}>Set scenario & create next action</Button>
            </Card>
          )}

        {/* Reopen — for returning leads (Jan → Apr → Jun → …) */}
        {isClosed && (
          <Card className="p-4 space-y-3 border-primary/50">
            <div className="font-semibold">Returning enquiry — reopen as Cycle #{currentCycleNo + 1}</div>
            <p className="text-xs text-muted-foreground">Full history from all {cycles.length} prior cycles stays intact. This creates a fresh assignment, ownership, and SLA clock.</p>
            <Input placeholder="Why is the lead back? (e.g. 6-month stay ended, changed city, wants BHK now)" value={reopenReason} onChange={(e) => setReopenReason(e.target.value)} />
            <Input placeholder="New location (optional)" value={reopenLocation} onChange={(e) => setReopenLocation(e.target.value)} />
            <Select value={reopenBucket} onValueChange={(v) => setReopenBucket(v as MoveInBucket)}>
              <SelectTrigger><SelectValue placeholder="New move-in urgency" /></SelectTrigger>
              <SelectContent>{(Object.keys(MOVE_IN_LABELS) as MoveInBucket[]).map((b) => <SelectItem key={b} value={b}>{MOVE_IN_LABELS[b]}</SelectItem>)}</SelectContent>
            </Select>
            <Button disabled={!reopenReason} onClick={async () => {
              if (isBf) {
                useBookingFlow.getState().moveStage(id, "WHERE", reopenReason);
                useBookingFlow.getState().editFields(id, {
                  closed: "",
                  reopenReason,
                  ...(reopenLocation ? { area: reopenLocation } : {}),
                  ...(reopenBucket ? { moveIn: reopenBucket } : {}),
                }, reopenReason);
                useBookingFlow.getState().logActivity(id, "Reopened cycle", reopenReason);
                toast.success(`Reopened as Cycle #${currentCycleNo + 1} — routed to owner`);
                setReopenReason(""); setReopenBucket(""); setReopenLocation(""); load();
              } else {
                const r = await reopenCycle({
                  leadId: id, reason: reopenReason,
                  moveinBucket: reopenBucket || undefined,
                  locationText: reopenLocation || undefined,
                });
                if (!r.ok) toast.error(r.error); else toast.success(`Reopened as Cycle #${currentCycleNo + 1} — routed to owner`);
                setReopenReason(""); setReopenBucket(""); setReopenLocation(""); load();
              }
            }}>Reopen cycle & re-route</Button>
          </Card>
        )}

        {/* Close current cycle */}
        {!isClosed && isOwner && (
          <Card className="p-3 space-y-2">
            <div className="font-semibold text-sm">Close this cycle</div>
            <p className="text-xs text-muted-foreground">Preserves all history. Lead can be reopened later as Cycle #{currentCycleNo + 1}.</p>
            <Input placeholder="Close reason (booked / not interested / no-show / etc.)" value={closeReason} onChange={(e) => setCloseReason(e.target.value)} />
            <Button size="sm" variant="secondary" disabled={!closeReason} onClick={async () => {
              if (isBf) {
                useBookingFlow.getState().moveStage(id, "SETTLED", closeReason);
                useBookingFlow.getState().editFields(id, { closed: "true", closeReason }, closeReason);
                useBookingFlow.getState().logActivity(id, "Cycle closed", closeReason);
                toast.success("Cycle closed");
                setCloseReason(""); load();
              } else {
                await closeCycle(id, closeReason);
                toast.success("Cycle closed");
                setCloseReason(""); load();
              }
            }}>Close cycle</Button>
          </Card>
        )}

        {/* Co-work claim on an actively owned lead */}
        {!isClosed && !isOwner && openAsg && (
          <Card className="p-3 space-y-2 border-accent/50">
            <div className="font-semibold text-sm">Claim & work in parallel</div>
            <p className="text-xs text-muted-foreground">Primary owner keeps the lead. You get a tracked shadow assignment so nothing collides.</p>
            <Input placeholder="Why claim now? (owner unavailable, live call, WA reply, etc.)" value={coworkReason} onChange={(e) => setCoworkReason(e.target.value)} />
            <Button size="sm" variant="outline" disabled={!coworkReason} onClick={async () => {
              if (isBf) {
                useBookingFlow.getState().logActivity(id, "Co-work claimed", coworkReason);
                toast.success("Co-work claim recorded");
                setCoworkReason(""); load();
              } else {
                const r = await claimCowork(id, coworkReason);
                if (!r.ok) toast.error(r.error); else toast.success("Co-work claim recorded");
                setCoworkReason(""); load();
              }
            }}>Claim & work</Button>
          </Card>
        )}

        <Card className="p-4">
          <div className="font-semibold mb-2">Next actions</div>
          {next.length === 0 && <div className="text-sm text-muted-foreground">No next action yet — pick a scenario above.</div>}
          <div className="space-y-1">
            {next.map((n) => (
              <div key={n.id} className="flex items-center justify-between border rounded p-2 text-sm">
                <div><span className="font-medium">{n.kind}</span> · due {new Date(n.due_at).toLocaleString()}</div>
                {n.done_at ? <Badge variant="outline">done</Badge> :
                  <Button size="sm" variant="outline" onClick={async () => {
                    if (isBf) {
                      useBookingFlow.getState().setNext(id, "", "");
                      useBookingFlow.getState().logActivity(id, "Marked next action done");
                      load();
                    } else {
                      await supabase.from("next_actions").update({ done_at: new Date().toISOString() }).eq("id", n.id);
                      load();
                    }
                  }}>Mark done</Button>}
              </div>
            ))}
          </div>
        </Card>

        <Card className="p-4">
          <div className="font-semibold mb-3">Full journey — {cycles.length} enquiry cycle{cycles.length === 1 ? "" : "s"}</div>
          <div className="space-y-3">
            {historyByCycle.map(({ cycle, assignments: cAsg, scenarios: cScen }) => (
              <div key={cycle.id} className="border-l-2 border-primary/40 pl-3">
                <div className="text-sm font-semibold">
                  Cycle #{cycle.cycle_no}
                  <span className="text-xs text-muted-foreground ml-2">
                    opened {new Date(cycle.opened_at).toLocaleDateString()}
                    {cycle.closed_at && ` → closed ${new Date(cycle.closed_at).toLocaleDateString()}`}
                  </span>
                </div>
                {cycle.open_reason && <div className="text-xs text-muted-foreground">Opened: {cycle.open_reason}</div>}
                {cycle.close_reason && <div className="text-xs text-amber-600">Closed: {cycle.close_reason}</div>}
                {cAsg.length > 0 && (
                  <div className="mt-1 text-xs">{cAsg.length} assignment{cAsg.length === 1 ? "" : "s"} · {cAsg.filter((a) => a.reassign_reason).length} reassign{cAsg.filter((a) => a.reassign_reason).length === 1 ? "" : "s"}</div>
                )}
                {cScen.map((s) => (
                  <div key={s.id} className="text-xs mt-1">
                    → <span className="font-medium">{SCENARIOS.find((x) => x.code === s.scenario)?.label}</span> · {new Date(s.created_at).toLocaleString()}
                    {s.notes && <div className="text-muted-foreground pl-3">{s.notes}</div>}
                  </div>
                ))}
              </div>
            ))}
          </div>
        </Card>
      </div>

      <div className="space-y-4">
        <SellThisPG
          leadId={id}
          leadName={lead?.name ?? undefined}
          phone={lead?.phone ?? undefined}
          area={lead?.location_text ?? lead?.zones?.name ?? ""}
          budgetMin={lead?.budget_min ?? undefined}
          budgetMax={lead?.budget_max ?? undefined}
          onInjectMessages={(pitch, pgName) => {
            setNotes((n) => (n ? `${n}\n\n` : "") + `[${pgName}]\n${pitch}`);
            toast.success("Pitch added to notes");
          }}
        />
        <Card className="p-3">
          <div className="font-semibold mb-2 text-sm">Enquiry cycles</div>
          {cycles.map((c) => (
            <div key={c.id} className="text-xs border-b py-1">
              Cycle #{c.cycle_no} · opened {new Date(c.opened_at).toLocaleDateString()} · {c.open_reason ?? ""}
            </div>
          ))}
        </Card>
        <Card className="p-3">
          <div className="font-semibold mb-2 text-sm">Assignment history</div>
          {assignments.map((a) => (
            <div key={a.id} className="text-xs border-b py-1">
              <div><Badge variant="outline" className="mr-1">{a.state}</Badge>Priority {a.priority}</div>
              <div className="text-muted-foreground">Assigned {new Date(a.assigned_at).toLocaleString()}</div>
              {a.reassign_reason && <div className="text-amber-600">Reassign: {a.reassign_reason}</div>}
            </div>
          ))}
        </Card>
        {(auth.isManager || auth.isOperator) && (
          <Card className="p-3 space-y-2">
            <div className="font-semibold text-sm">Manager override — Reassign</div>
            <Textarea placeholder="Reason (required)" value={reason} onChange={(e) => setReason(e.target.value)} />
            <Button size="sm" variant="secondary" disabled={!reason} onClick={async () => {
              if (isBf) {
                useBookingFlow.getState().reassign(id, auth.user?.full_name || "Manager Override");
                useBookingFlow.getState().logActivity(id, "Reassigned", reason);
                toast.success("Reassigned");
                setReason(""); load();
              } else {
                const r = await reassign(id, reason);
                if (!r.ok) toast.error(r.error); else toast.success("Reassigned");
                setReason(""); load();
              }
            }}>Reassign now</Button>
          </Card>
        )}
      </div>
    </div>

    <LeadQualityTimeline leadId={id} />
  </div>
);
}
