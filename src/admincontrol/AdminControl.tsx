// Admin Draft Control room — one place that governs the whole chain:
// WhatsApp screenshot -> row -> customer -> owner -> work batch -> next action -> booking.
// Filters at the top apply to every tab and are remembered between visits.
import { SplitFlow } from "@/bf100x/SplitFlow";
import { ContactActions } from "@/components/common/ContactActions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { supabase } from "@/integrations/supabase/client";
import {
  assignOwner,
  escalateToTower,
  resolveRow,
  setNextAction,
} from "@/lib/admin-control/actions.functions";
import { getAdminControlData } from "@/lib/admin-control/data.functions";
import { canonicalCustomerId } from "@/lib/canonical/customer-id";
import { cn } from "@/lib/utils";
import { Ingest } from "@/vision2/Ingest";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import {
  AlertTriangle,
  Camera,
  Clock,
  IndianRupee,
  Layers,
  RefreshCw,
  ShieldAlert,
  Users,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { CallIntelligence } from "./CallIntelligence";
import { CheckpointControl } from "./CheckpointControl";
import { ViewerBar } from "./ViewerBar";
import { deepen, money } from "./deep";
import { derive, LEAKS, type CustomerRow } from "./derive";
import { useControlFilters, type DayWindow, type HealthFilter } from "./filters";
import { powersOf, scopeControlData, scopeOptions, useViewer } from "./viewer";

/** Rows whose stage, journey step or conversation type mentions this phase. */
const phase = (rows: CustomerRow[], re: RegExp) =>
  rows.filter((r) => re.test(`${r.stage} ${r.journeyStep} ${r.bucket} ${r.nextActionKind}`));

const PHASES = {
  tours: /tour|visit|site/i,
  closing: /clos|negoti|quot|offer|decision/i,
  booking: /book|payment|reserv|approv|token|advance/i,
  checkin: /check.?in|move.?in|onboard/i,
};

const DAYS: Array<[DayWindow, string]> = [
  ["today", "Today"],
  ["1", "24 hours"],
  ["3", "3 days"],
  ["7", "7 days"],
  ["all", "All"],
];

const HEALTHS: Array<[HealthFilter, string]> = [
  ["all", "All"],
  ["RED", "Red"],
  ["AMBER", "Amber"],
  ["GREEN", "Green"],
  ["GREY", "Parked"],
];

const healthTone: Record<string, string> = {
  RED: "bg-destructive/15 text-destructive border-destructive/30",
  AMBER: "bg-amber-500/15 text-amber-600 border-amber-500/30",
  GREEN: "bg-emerald-500/15 text-emerald-600 border-emerald-500/30",
  GREY: "bg-muted text-muted-foreground border-border",
};

const ago = (t: number) => {
  if (!t) return "never";
  const m = Math.round((Date.now() - t) / 60000);
  if (m < 60) return `${m}m ago`;
  if (m < 60 * 24) return `${Math.round(m / 60)}h ago`;
  return `${Math.round(m / 1440)}d ago`;
};

export function AdminControl() {
  const f = useControlFilters();
  const viewer = useViewer();
  const can = powersOf(viewer.role);
  const [tab, setTab] = useState("command");
  const [openRow, setOpenRow] = useState<CustomerRow | null>(null);

  const {
    data: raw,
    isLoading,
    refetch,
    isFetching,
  } = useQuery({
    queryKey: ["admin-control-data"],
    queryFn: () => getAdminControlData(),
    staleTime: 60_000,
  });

  const allOptions = useMemo(() => scopeOptions(raw), [raw]);
  const data = useMemo(
    () =>
      raw
        ? scopeControlData(raw, {
            role: viewer.role,
            zones: viewer.zones,
            accounts: viewer.accounts,
            person: viewer.person,
          })
        : undefined,
    [raw, viewer.role, viewer.zones, viewer.accounts, viewer.person],
  );

  const d = useMemo(() => (data ? derive(data, f) : null), [data, f]);
  const deep = useMemo(() => (data && d ? deepen(data, d) : null), [data, d]);

  const openCustomer = (row: CustomerRow) => {
    setOpenRow(row);
    setTab("customer");
  };
  // TODO: Added a new component BookingFLowActivity.
  function BookingFlowActivity() {
    const [rows, setRows] = useState<{ id: string; data: any; updated_at: string }[]>([]);
    const [openId, setOpenId] = useState<string | null>(null);

    useEffect(() => {
      const load = async () => {
        const { data, error } = await (supabase as any)
          .from("booking_flow_records")
          .select("id,data,updated_at")
          .eq("kind", "lead")
          .order("updated_at", { ascending: false })
          .limit(20);
        if (!error) setRows(data ?? []);
      };
      load();
      const t = setInterval(load, 15000);
      return () => clearInterval(t);
    }, []);

    return (
      <Card title="Activity — what changed by who!">
        <div className="max-h-96 space-y-1 overflow-y-auto text-[11px]">
          {rows.map((r) => {
            const events: { at: string; actor: string; label: string; detail?: string }[] =
              r.data?.events ?? [];
            const last = events[events.length - 1];
            const isOpen = openId === r.id;
            return (
              <div key={r.id} className="border-b py-1 last:border-0">
                <button
                  type="button"
                  onClick={() => setOpenId(isOpen ? null : r.id)}
                  className="flex w-full items-center justify-between gap-2 text-left hover:bg-muted/50"
                >
                  <span className="truncate">
                    <span className="font-medium">{last?.actor ?? "Someone"}</span>
                    {" · "}
                    {r.data?.name ?? "Unnamed"}
                    {" · "}
                    {last?.label ?? "updated"}
                  </span>
                  <span className="shrink-0 text-muted-foreground">
                    {new Date(r.updated_at).toLocaleTimeString([], {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}{" "}
                    {isOpen ? "▲" : "▼"}
                  </span>
                </button>
                {isOpen && (
                  <div className="mt-1 space-y-1 rounded bg-muted/30 p-2">
                    {events.length === 0 && (
                      <div className="text-muted-foreground">No event history.</div>
                    )}
                    {[...events].reverse().map((e, i) => (
                      <div
                        key={i}
                        className="flex justify-between gap-2 border-b border-dashed pb-1 last:border-0"
                      >
                        <span>
                          <span className="font-medium">{e.actor}</span> · {e.label}
                          {e.detail && <span className="text-muted-foreground"> — {e.detail}</span>}
                        </span>
                        <span className="shrink-0 text-muted-foreground">
                          {new Date(e.at).toLocaleString([], {
                            day: "numeric",
                            month: "short",
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
          {rows.length === 0 && <div className="text-muted-foreground">No changes yet.</div>}
        </div>
      </Card>
    );
  }

  const run = async (label: string, fn: () => Promise<unknown>) => {
    try {
      await fn();
      toast.success(label);
      await refetch();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save that");
    }
  };

  return (
    <div className="mx-auto w-full max-w-[1500px] space-y-3 p-3 sm:p-4">
      <ViewerBar options={allOptions} />

      <header className="rounded-xl border bg-card p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h1 className="text-lg font-bold tracking-tight">Admin · Draft Control</h1>
            <p className="text-xs text-muted-foreground">
              Screenshot → row → customer → owner → work batch → next action → booking. Everything
              below reads the same company record as Draft Vision, Movement OS and the Booking Flow.
            </p>
          </div>
          <Button size="sm" variant="outline" onClick={() => refetch()} disabled={isFetching}>
            <RefreshCw className={cn("mr-1 h-3.5 w-3.5", isFetching && "animate-spin")} /> Refresh
          </Button>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-1.5 text-xs">
          {DAYS.map(([v, label]) => (
            <Button
              key={v}
              size="sm"
              variant={f.day === v ? "default" : "outline"}
              className="h-7 px-2"
              onClick={() => f.set({ day: v })}
            >
              {label}
            </Button>
          ))}
          <span className="mx-1 h-5 w-px bg-border" />
          {HEALTHS.map(([v, label]) => (
            <Button
              key={v}
              size="sm"
              variant={f.health === v ? "default" : "outline"}
              className="h-7 px-2"
              onClick={() => f.set({ health: v })}
            >
              {label}
            </Button>
          ))}
          <span className="mx-1 h-5 w-px bg-border" />
          <Select
            label="WhatsApp"
            value={f.wa}
            onChange={(v) => f.set({ wa: v })}
            options={d?.options.accounts ?? []}
          />
          <Select
            label="Person"
            value={f.operator}
            onChange={(v) => f.set({ operator: v })}
            options={d?.options.operators ?? []}
          />
          <Select
            label="Zone"
            value={f.zone}
            onChange={(v) => f.set({ zone: v })}
            options={d?.options.zones ?? []}
          />
          <Select
            label="Stage"
            value={f.stage}
            onChange={(v) => f.set({ stage: v })}
            options={d?.options.stages ?? []}
          />
          <Select
            label="Problem"
            value={f.leak}
            onChange={(v) => f.set({ leak: v })}
            options={LEAKS.map(([k]) => k)}
          />
          <Input
            value={f.search}
            onChange={(e) => f.set({ search: e.target.value })}
            placeholder="Name or number"
            className="h-7 w-40 text-xs"
          />
          <Button size="sm" variant="ghost" className="h-7 px-2" onClick={() => f.reset()}>
            Clear
          </Button>
        </div>
      </header>

      {isLoading || !d || !deep ? (
        <div className="rounded-xl border bg-card p-8 text-center text-sm text-muted-foreground">
          Loading the company record…
        </div>
      ) : (
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList className="flex flex-wrap">
            <TabsTrigger value="command">Command</TabsTrigger>
            <TabsTrigger value="vision">Screenshots</TabsTrigger>
            <TabsTrigger value="reconcile">Zero miss</TabsTrigger>
            <TabsTrigger value="batches">Work batches</TabsTrigger>
            <TabsTrigger value="ownership">Ownership</TabsTrigger>
            <TabsTrigger value="risk">Risk &amp; leakage</TabsTrigger>
            <TabsTrigger value="movement">Movement</TabsTrigger>
            <TabsTrigger value="checkpoints">Checkpoints</TabsTrigger>
            <TabsTrigger value="calls">Calls</TabsTrigger>
            <TabsTrigger value="flow">Booking Flow</TabsTrigger>
            <TabsTrigger value="tours">Tours</TabsTrigger>
            <TabsTrigger value="closing">Closing</TabsTrigger>
            <TabsTrigger value="booking">Booking</TabsTrigger>
            <TabsTrigger value="checkin">Check-in</TabsTrigger>
            <TabsTrigger value="sla">SLA clock</TabsTrigger>
            <TabsTrigger value="aging">Aging</TabsTrigger>
            <TabsTrigger value="bottlenecks">Bottlenecks</TabsTrigger>
            <TabsTrigger value="zones">Zones</TabsTrigger>
            <TabsTrigger value="accuracy">Reading quality</TabsTrigger>
            <TabsTrigger value="compliance">Compliance</TabsTrigger>
            {can.seeWorkloadBalance && <TabsTrigger value="balance">Workload</TabsTrigger>}
            {can.seeMoney && <TabsTrigger value="value">Money at risk</TabsTrigger>}
            <TabsTrigger value="heat">When chats land</TabsTrigger>
            <TabsTrigger value="anomalies">Alerts</TabsTrigger>
            {can.seePeopleQuality && <TabsTrigger value="people">People</TabsTrigger>}
            {can.seeFullHistory && <TabsTrigger value="history">History</TabsTrigger>}
            <TabsTrigger value="upload">Add screenshots</TabsTrigger>
            <TabsTrigger value="customer">Customer</TabsTrigger>
          </TabsList>

          {/* COMMAND ------------------------------------------------------ */}
          <TabsContent value="command" className="space-y-3 pt-3">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
              <Kpi
                icon={Camera}
                label="Screenshots read"
                value={d.kpi.screenshots}
                hint={`${d.kpi.accounts} WhatsApp accounts`}
                onClick={() => setTab("vision")}
              />
              <Kpi
                icon={Layers}
                label="Chat rows detected"
                value={d.kpi.detected}
                hint={`${d.kpi.expected} expected`}
                onClick={() => setTab("reconcile")}
              />
              <Kpi
                icon={AlertTriangle}
                label="Rows unaccounted"
                value={d.kpi.silentDrops + d.kpi.review}
                hint={`${d.kpi.review} need review`}
                tone="amber"
                onClick={() => setTab("reconcile")}
              />
              <Kpi
                icon={Users}
                label="Customers on WhatsApp"
                value={d.kpi.customersSeen}
                hint={`${d.kpi.newCustomers} first-time rows`}
                onClick={() => setTab("ownership")}
              />
              <Kpi
                icon={ShieldAlert}
                label="Nobody owns"
                value={d.kpi.unownedActive}
                hint="active customers with no handler"
                tone="red"
                onClick={() => {
                  f.set({ leak: "no_owner" });
                  setTab("risk");
                }}
              />
              <Kpi
                icon={Clock}
                label="Overdue next actions"
                value={d.kpi.overdue}
                hint={`${d.kpi.red} red customers`}
                tone="red"
                onClick={() => {
                  f.set({ leak: "overdue_action" });
                  setTab("risk");
                }}
              />
            </div>

            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
              {can.seeMoney ? (
                <Kpi
                  icon={IndianRupee}
                  label="Money at risk"
                  value={money(deep.value.atRisk)}
                  tone="red"
                  onClick={() => setTab("value")}
                />
              ) : (
                <Kpi
                  icon={ShieldAlert}
                  label="Red customers"
                  value={d.kpi.red}
                  tone="red"
                  onClick={() => f.set({ health: "RED" })}
                />
              )}
              <Kpi
                icon={Clock}
                label="Due in 2 hours"
                value={deep.forecast.next2h}
                onClick={() => setTab("sla")}
              />
              <Kpi
                icon={Clock}
                label="No deadline"
                value={deep.forecast.missing}
                tone="amber"
                onClick={() => setTab("sla")}
              />
              <Kpi
                icon={AlertTriangle}
                label="Slowest stage"
                value={deep.bottlenecks[0]?.stage ?? "—"}
                hint={`${deep.bottlenecks[0]?.avgIdleH ?? 0}h average idle`}
                onClick={() => setTab("bottlenecks")}
              />
              <Kpi
                icon={Users}
                label="Numbers saved twice"
                value={deep.duplicatesCount}
                tone="amber"
                onClick={() => setTab("accuracy")}
              />
              <Kpi
                icon={ShieldAlert}
                label="Alerts to decide"
                value={deep.anomalies.length}
                tone="red"
                onClick={() => setTab("anomalies")}
              />
            </div>

            {deep.anomalies.length > 0 && (
              <Card title="Top alerts right now">
                <ul className="space-y-1.5">
                  {deep.anomalies.slice(0, 5).map((a, i) => (
                    <li
                      key={i}
                      className={cn(
                        "rounded-md border p-2 text-xs",
                        a.severity === "high"
                          ? "border-destructive/40 bg-destructive/5"
                          : "border-amber-500/40 bg-amber-500/5",
                      )}
                    >
                      <div className="font-semibold">{a.what}</div>
                      <div className="text-muted-foreground">{a.detail}</div>
                    </li>
                  ))}
                </ul>
              </Card>
            )}

            <div className="grid gap-3 lg:grid-cols-3">
              <Card title="Execution health">
                <Bars
                  rows={[
                    ["Red — broken now", d.kpi.red, "bg-destructive"],
                    ["Amber — slipping", d.kpi.amber, "bg-amber-500"],
                    ["Green — on track", d.kpi.green, "bg-emerald-500"],
                    ["Parked / closed", d.kpi.grey, "bg-muted-foreground"],
                  ]}
                  onPick={(i) =>
                    f.set({ health: ["RED", "AMBER", "GREEN", "GREY"][i] as HealthFilter })
                  }
                />
              </Card>
              <Card title="Where the customers are">
                <Bars
                  rows={d.funnel.slice(0, 8).map((s) => [s.stage, s.count, "bg-primary"])}
                  onPick={(i) => f.set({ stage: d.funnel[i]?.stage ?? "all" })}
                />
              </Card>
              <Card title="Journey step">
                <Bars rows={d.journey.slice(0, 8).map((s) => [s.step, s.count, "bg-sky-500"])} />
              </Card>
            </div>

            <Card title={`Worst first — ${d.rows.length} customers match these filters`}>
              <CustomerTable rows={d.rows.slice(0, 40)} onOpen={openCustomer} />
            </Card>
          </TabsContent>

          {/* SCREENSHOTS -------------------------------------------------- */}
          <TabsContent value="vision" className="space-y-3 pt-3">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Kpi
                icon={Camera}
                label="Batches"
                value={d.batches.length}
                hint="checkpoint uploads"
              />
              <Kpi
                icon={Layers}
                label="Rows read"
                value={d.kpi.detected}
                hint={`avg confidence ${d.kpi.avgConfidence}%`}
              />
              <Kpi
                icon={AlertTriangle}
                label="Low confidence rows"
                value={d.kpi.lowConfidence}
                hint="below 70%"
                tone="amber"
              />
              <Kpi
                icon={ShieldAlert}
                label="Not a customer"
                value={d.kpi.nonCustomer}
                hint="groups, vendors, noise"
              />
            </div>
            <Card title="WhatsApp account health">
              <Table
                head={[
                  "WhatsApp",
                  "Batches",
                  "Rows read",
                  "Missed rows",
                  "To review",
                  "Last upload",
                ]}
                rows={d.accounts.map((a) => [
                  a.wa,
                  a.batches,
                  a.detected,
                  a.drops,
                  a.review,
                  ago(a.lastAt),
                ])}
                onPick={(i) => f.set({ wa: d.accounts[i]?.wa ?? "all" })}
              />
            </Card>
            <Card title="Every checkpoint upload">
              <Table
                head={[
                  "Uploaded",
                  "WhatsApp",
                  "Checkpoint",
                  "By",
                  "Shots",
                  "Expected",
                  "Read",
                  "Review",
                  "Status",
                ]}
                rows={d.batches
                  .slice(0, 60)
                  .map((b) => [
                    ago(b.uploadedAt ? Date.parse(b.uploadedAt) : 0),
                    b.whatsappAccount ?? "—",
                    b.checkpoint ?? "—",
                    b.uploadedBy ?? "—",
                    b.screenshotCount ?? 0,
                    b.expected ?? 0,
                    b.detected ?? 0,
                    b.unresolved ?? 0,
                    b.status ?? "—",
                  ])}
              />
            </Card>
          </TabsContent>

          {/* ZERO MISS ---------------------------------------------------- */}
          <TabsContent value="reconcile" className="space-y-3 pt-3">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Kpi icon={Layers} label="Rows expected" value={d.kpi.expected} />
              <Kpi icon={Layers} label="Rows accounted" value={d.kpi.detected} />
              <Kpi
                icon={AlertTriangle}
                label="Silently dropped"
                value={d.kpi.silentDrops}
                tone="red"
              />
              <Kpi
                icon={ShieldAlert}
                label="Waiting for a decision"
                value={d.kpi.review}
                tone="amber"
              />
            </div>
            <Card title="Decide these rows now — accept or reject each one">
              <ResolveRows
                rows={d.observations
                  .filter((o) => o.state === "needs_review")
                  .slice(0, 25)
                  .map((o) => ({
                    id: o.id,
                    name: o.contactName ?? "Unknown",
                    phone: o.phone ?? "",
                    preview: (o.preview ?? "").slice(0, 70),
                    reason: o.reason ?? "no reason recorded",
                  }))}
                onDecide={(id, decision) =>
                  run(
                    decision === "reconciled"
                      ? "Row accepted as a customer"
                      : "Row marked not a customer",
                    () => resolveRow({ data: { observationId: id, decision } }),
                  )
                }
              />
            </Card>
            <Card title="Why rows are stuck">
              <Table head={["Reason", "Rows"]} rows={d.reviewReasons.map(([r, c]) => [r, c])} />
            </Card>
            <Card title="Review queue — decide each row">
              <Table
                head={[
                  "Customer",
                  "Number",
                  "WhatsApp",
                  "Last message",
                  "Confidence",
                  "Reason",
                  "Seen",
                ]}
                rows={d.observations
                  .filter((o) => o.state === "needs_review")
                  .slice(0, 60)
                  .map((o) => [
                    o.contactName ?? "—",
                    o.phone ?? "—",
                    o.whatsappAccount ?? "—",
                    (o.preview ?? "").slice(0, 46),
                    `${o.ocrConfidence ?? 0}%`,
                    o.reason ?? "—",
                    ago(o.capturedAt ? Date.parse(o.capturedAt) : 0),
                  ])}
                onPick={(i) => {
                  const obs = d.observations.filter((o) => o.state === "needs_review")[i];
                  const row = d.rows.find((r) => r.id === obs?.leadId);
                  if (row) openCustomer(row);
                }}
              />
            </Card>
            <Card title="Daily inflow">
              <Table
                head={["Day", "Rows read", "Customers", "To review"]}
                rows={d.dayTrend.map((t) => [t.day, t.detected, t.customers, t.review])}
              />
            </Card>
          </TabsContent>

          {/* WORK BATCHES ------------------------------------------------- */}
          <TabsContent value="batches" className="space-y-3 pt-3">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Kpi icon={Layers} label="Batches open" value={d.kpi.openBatches} />
              <Kpi icon={Layers} label="Batches finished" value={d.kpi.closedBatches} />
              <Kpi icon={Users} label="Customers assigned" value={d.kpi.assigned} />
              <Kpi
                icon={Clock}
                label="Completed"
                value={`${d.kpi.completionPct}%`}
                hint={`${d.kpi.completed} of ${d.kpi.assigned}`}
              />
            </div>
            <Card title="Batch G1–G4 per person, 30 customers each">
              <Table
                head={["Person", "Batches", "Assigned", "Done", "Done %", "In hand", "Red leads"]}
                rows={d.operators.map((o) => [
                  o.operator,
                  o.batches,
                  o.assigned,
                  o.done,
                  `${o.donePct}%`,
                  o.active,
                  o.red,
                ])}
                onPick={(i) => f.set({ operator: d.operators[i]?.operator ?? "all" })}
              />
            </Card>
            <Card title="Highest scoring customers in today's batches">
              <CustomerTable
                rows={[...d.rows].sort((a, b) => b.score - a.score).slice(0, 30)}
                onOpen={openCustomer}
              />
            </Card>
          </TabsContent>

          {/* OWNERSHIP ---------------------------------------------------- */}
          <TabsContent value="ownership" className="space-y-3 pt-3">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Kpi icon={Users} label="People holding customers" value={d.kpi.handlers} />
              <Kpi
                icon={ShieldAlert}
                label="No owner"
                value={d.kpi.unownedActive}
                tone="red"
                onClick={() => f.set({ leak: "no_owner" })}
              />
              <Kpi
                icon={Clock}
                label="No next action"
                value={d.leakCounts.find((l) => l.key === "no_next_action")?.count ?? 0}
                tone="amber"
                onClick={() => f.set({ leak: "no_next_action" })}
              />
              <Kpi
                icon={AlertTriangle}
                label="WhatsApp ahead of CRM"
                value={d.leakCounts.find((l) => l.key === "stale_evidence")?.count ?? 0}
                tone="amber"
                onClick={() => f.set({ leak: "stale_evidence" })}
              />
            </div>
            <Card title="Who holds what right now">
              <CustomerTable rows={d.rows.slice(0, 60)} onOpen={openCustomer} />
            </Card>
          </TabsContent>

          {/* RISK --------------------------------------------------------- */}
          <TabsContent value="risk" className="space-y-3 pt-3">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
              {d.leakCounts.map((l) => (
                <button
                  key={l.key}
                  onClick={() => f.set({ leak: l.key })}
                  className={cn(
                    "rounded-lg border p-2 text-left transition hover:border-primary",
                    f.leak === l.key && "border-primary bg-primary/5",
                  )}
                >
                  <div className="text-lg font-bold">{l.count}</div>
                  <div className="text-[11px] leading-tight text-muted-foreground">{l.label}</div>
                </button>
              ))}
            </div>
            <Card title="Escalate to Control Tower — red first">
              <CustomerTable
                rows={d.rows.filter((r) => r.health === "RED" || r.overdueMins > 0).slice(0, 60)}
                onOpen={openCustomer}
              />
            </Card>
          </TabsContent>

          {/* MOVEMENT — what every operator is holding right now ------------ */}
          <TabsContent value="movement" className="space-y-3 pt-3">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
              <Kpi
                icon={Users}
                label="Customers in movement"
                value={d.rows.filter((r) => r.health !== "GREY").length}
              />
              <Kpi
                icon={ShieldAlert}
                label="Unread waiting"
                value={d.rows.filter((r) => r.unread > 0).length}
                tone="red"
              />
              <Kpi icon={Clock} label="Overdue now" value={d.kpi.overdue} tone="red" />
              <Kpi
                icon={Layers}
                label="Being worked"
                value={d.rows.filter((r) => r.workState === "active").length}
              />
              <Kpi icon={Users} label="People on the floor" value={d.kpi.handlers} />
            </div>
            <Card title="Each person's tray — open the customer to see their Booking Flow Split">
              <Table
                head={["Person", "Batches", "Assigned", "In hand", "Done %", "Red"]}
                rows={d.operators.map((o) => [
                  o.operator,
                  o.batches,
                  o.assigned,
                  o.active,
                  `${o.donePct}%`,
                  o.red,
                ])}
                onPick={(i) => f.set({ operator: d.operators[i]?.operator ?? "all" })}
              />
            </Card>
            <Card title="Worst first — exactly what the operator sees in Movement OS">
              <CustomerTable
                rows={d.rows.filter((r) => r.health !== "GREY").slice(0, 60)}
                onOpen={openCustomer}
              />
            </Card>
          </TabsContent>

          <TabsContent value="checkpoints" className="pt-3">
            <CheckpointControl
              managerName={viewer.name || "Manager"}
              onOpenCustomer={(canonicalId) => {
                const row = d.rows.find(
                  (item) =>
                    canonicalCustomerId({ phone: item.phone, name: item.name }) === canonicalId ||
                    item.id === canonicalId,
                );
                if (row) openCustomer(row);
                else toast.error("This affected customer is not inside the current admin scope.");
              }}
            />
          </TabsContent>

          <TabsContent value="calls" className="pt-3">
            <CallIntelligence />
          </TabsContent>

          {/* BOOKING FLOW — where customers sit in the journey -------------- */}
          <TabsContent value="flow" className="space-y-3 pt-3">
            <BookingFlowActivity />
            <Card title="Customers per journey step">
              <Table
                head={["Journey step", "Customers", "Overdue", "No owner"]}
                rows={d.journey.map((j) => {
                  const g = d.rows.filter((r) => r.journeyStep === j.step);
                  return [
                    j.step,
                    j.count,
                    g.filter((r) => r.overdueMins > 0).length,
                    g.filter((r) => !r.owned).length,
                  ];
                })}
              />
            </Card>
            <Card title="Customers per stage">
              <Table
                head={["Stage", "Customers"]}
                rows={d.funnel.map((s) => [s.stage, s.count])}
                onPick={(i) => f.set({ stage: d.funnel[i]?.stage ?? "all" })}
              />
            </Card>
            <Card title="Open any customer in the same Booking Flow Split the operator uses">
              <CustomerTable rows={d.rows.slice(0, 60)} onOpen={openCustomer} />
            </Card>
          </TabsContent>

          {/* TOURS / CLOSING / BOOKING / CHECK-IN --------------------------- */}
          {(
            [
              ["tours", "Tours", PHASES.tours],
              ["closing", "Closing", PHASES.closing],
              ["booking", "Booking", PHASES.booking],
              ["checkin", "Check-in", PHASES.checkin],
            ] as const
          ).map(([value, label, re]) => {
            const rows = phase(d.rows, re);
            return (
              <TabsContent key={value} value={value} className="space-y-3 pt-3">
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  <Kpi icon={Users} label={`${label} customers`} value={rows.length} />
                  <Kpi
                    icon={Clock}
                    label="Overdue"
                    value={rows.filter((r) => r.overdueMins > 0).length}
                    tone="red"
                  />
                  <Kpi
                    icon={ShieldAlert}
                    label="Nobody owns"
                    value={rows.filter((r) => !r.owned).length}
                    tone="red"
                  />
                  <Kpi
                    icon={AlertTriangle}
                    label="Red"
                    value={rows.filter((r) => r.health === "RED").length}
                    tone="red"
                  />
                </div>
                <Card title={`${label} — grouped by where they stand`}>
                  <Table
                    head={["Step", "Customers", "Overdue"]}
                    rows={[...new Set(rows.map((r) => r.journeyStep))].map((step) => {
                      const g = rows.filter((r) => r.journeyStep === step);
                      return [step, g.length, g.filter((r) => r.overdueMins > 0).length];
                    })}
                  />
                </Card>
                <Card title={`${label} — every customer, worst first`}>
                  <CustomerTable rows={rows.slice(0, 60)} onOpen={openCustomer} />
                </Card>
              </TabsContent>
            );
          })}

          {/* SLA CLOCK ---------------------------------------------------- */}
          <TabsContent value="sla" className="space-y-3 pt-3">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
              <Kpi icon={Clock} label="Due in 2 hours" value={deep.forecast.next2h} />
              <Kpi icon={Clock} label="Due today" value={deep.forecast.today} />
              <Kpi icon={Clock} label="Due tomorrow" value={deep.forecast.tomorrow} />
              <Kpi icon={Clock} label="Later" value={deep.forecast.later} />
              <Kpi
                icon={AlertTriangle}
                label="No deadline at all"
                value={deep.forecast.missing}
                tone="red"
                onClick={() => f.set({ leak: "no_next_action" })}
              />
            </div>
            <Card title="How late are we — every customer with a deadline">
              <Table
                head={["Lateness", "Customers", "Value sitting there"]}
                rows={deep.sla.map((s) => [s.band, s.count, money(s.value)])}
              />
            </Card>
            <Card title="Worst lateness first">
              <CustomerTable
                rows={[...d.rows].sort((a, b) => b.overdueMins - a.overdueMins).slice(0, 50)}
                onOpen={openCustomer}
              />
            </Card>
          </TabsContent>

          {/* AGING -------------------------------------------------------- */}
          <TabsContent value="aging" className="space-y-3 pt-3">
            <Card title="How long since anything happened">
              <Table
                head={["Since last touch", "Customers", "Red", "Nobody owns"]}
                rows={deep.aging.map((a) => [a.band, a.count, a.red, a.unowned])}
              />
            </Card>
            <Card title="Oldest untouched customers">
              <CustomerTable
                rows={[...d.rows]
                  .sort(
                    (a, b) =>
                      Math.max(a.lastActionAt, a.lastObsAt) - Math.max(b.lastActionAt, b.lastObsAt),
                  )
                  .slice(0, 50)}
                onOpen={openCustomer}
              />
            </Card>
          </TabsContent>

          {/* BOTTLENECKS -------------------------------------------------- */}
          <TabsContent value="bottlenecks" className="space-y-3 pt-3">
            <Card title="Where the journey jams — slowest stage first">
              <Table
                head={[
                  "Stage",
                  "Customers",
                  "Average idle (hours)",
                  "Worst idle (hours)",
                  "Overdue",
                  "No owner",
                ]}
                rows={deep.bottlenecks.map((b) => [
                  b.stage,
                  b.customers,
                  b.avgIdleH,
                  b.worstIdleH,
                  b.overdue,
                  b.unowned,
                ])}
                onPick={(i) => f.set({ stage: deep.bottlenecks[i]?.stage ?? "all" })}
              />
            </Card>
            <Card title="Conversation type vs trouble">
              <Table
                head={["Conversation type", "Customers", "Red"]}
                rows={deep.mix.slice(0, 30).map((m) => [m.bucket, m.count, m.red])}
              />
            </Card>
          </TabsContent>

          {/* ZONES -------------------------------------------------------- */}
          <TabsContent value="zones" className="space-y-3 pt-3">
            <Card title="Area by area">
              <Table
                head={[
                  "Area",
                  "Customers",
                  "Red",
                  "Overdue",
                  "No owner",
                  "Average lateness (min)",
                  "Chat rows",
                  "Value",
                ]}
                rows={deep.zones
                  .slice(0, 40)
                  .map((z) => [
                    z.zone,
                    z.customers,
                    z.red,
                    z.overdue,
                    z.unowned,
                    z.avgOverdue,
                    z.rows,
                    money(z.value),
                  ])}
                onPick={(i) => f.set({ zone: deep.zones[i]?.zone ?? "all" })}
              />
            </Card>
          </TabsContent>

          {/* READING QUALITY ---------------------------------------------- */}
          <TabsContent value="accuracy" className="space-y-3 pt-3">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Kpi icon={Layers} label="Average confidence" value={`${d.kpi.avgConfidence}%`} />
              <Kpi
                icon={AlertTriangle}
                label="Rows read below 70%"
                value={d.kpi.lowConfidence}
                tone="amber"
              />
              <Kpi
                icon={ShieldAlert}
                label="Rows with no number"
                value={deep.accuracy.missingPhone}
                tone="amber"
              />
              <Kpi
                icon={Users}
                label="Numbers saved twice"
                value={deep.duplicatesCount}
                tone="red"
              />
            </div>
            <Card title="Confidence bands">
              <Table
                head={["Band", "Chat rows"]}
                rows={deep.accuracy.bands.map((b) => [b.band, b.rows])}
              />
            </Card>
            <Card title="Labelled vs unlabelled, incoming vs outgoing">
              <Table
                head={["Measure", "Rows"]}
                rows={[
                  ["Labelled by WhatsApp", deep.accuracy.labelled],
                  ["No label visible", deep.accuracy.unlabelled],
                  ["Customer wrote last", deep.accuracy.incoming],
                  ["We wrote last", deep.accuracy.outgoing],
                ]}
              />
            </Card>
            <Card title="Same number, different names — merge these">
              <Table
                head={["Number", "Names seen"]}
                rows={deep.accuracy.duplicatePhones.map((p) => [p.phone, p.names.join(" / ")])}
              />
            </Card>
          </TabsContent>

          {/* COMPLIANCE --------------------------------------------------- */}
          <TabsContent value="compliance" className="space-y-3 pt-3">
            <Card title="Every active customer must carry these — nothing may be blank">
              <Bars
                rows={deep.compliance.map((c) => [
                  `${c.field} — ${c.pct}% filled, ${c.missing} missing`,
                  c.pct,
                  c.pct === 100 ? "bg-emerald-500" : c.pct > 80 ? "bg-amber-500" : "bg-destructive",
                ])}
              />
            </Card>
            <Card title="Customers breaking the rules right now">
              <CustomerTable
                rows={d.rows
                  .filter((r) => !r.owned || !r.nextActionKind || !r.nextActionAt)
                  .slice(0, 60)}
                onOpen={openCustomer}
              />
            </Card>
          </TabsContent>

          {/* WORKLOAD ----------------------------------------------------- */}
          <TabsContent value="balance" className="space-y-3 pt-3">
            <Card title="Who is carrying how much">
              <Table
                head={["Person", "Holding", "Share %", "Red", "Overdue", "Unread", "Load"]}
                rows={deep.balance.map((b) => [
                  b.person,
                  b.holding,
                  `${b.share}%`,
                  b.red,
                  b.overdue,
                  b.unread,
                  b.load,
                ])}
                onPick={(i) => f.set({ operator: deep.balance[i]?.person ?? "all" })}
              />
            </Card>
          </TabsContent>

          {/* MONEY -------------------------------------------------------- */}
          <TabsContent value="value" className="space-y-3 pt-3">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              <Kpi
                icon={IndianRupee}
                label="At risk right now"
                value={money(deep.value.atRisk)}
                tone="red"
              />
              <Kpi icon={IndianRupee} label="Healthy pipeline" value={money(deep.value.safe)} />
              <Kpi
                icon={AlertTriangle}
                label="Red + amber customers"
                value={d.kpi.red + d.kpi.amber}
                tone="amber"
              />
            </div>
            <Card title="Biggest money slipping first">
              <CustomerTable rows={deep.value.topRisk} onOpen={openCustomer} />
            </Card>
          </TabsContent>

          {/* HEAT --------------------------------------------------------- */}
          <TabsContent value="heat" className="space-y-3 pt-3">
            <Card title="When customers actually message us">
              <Heat weekdays={deep.heat.weekdays} />
            </Card>
            <Card title="Busiest hours across the week">
              <Bars
                rows={deep.heat.hours.map((n, h) => [
                  `${String(h).padStart(2, "0")}:00`,
                  n,
                  "bg-primary",
                ])}
              />
            </Card>
          </TabsContent>

          {/* ALERTS ------------------------------------------------------- */}
          <TabsContent value="anomalies" className="space-y-3 pt-3">
            <Card title="What needs a decision from you today">
              {deep.anomalies.length === 0 ? (
                <p className="text-xs text-muted-foreground">No alert for these filters.</p>
              ) : (
                <ul className="space-y-1.5">
                  {deep.anomalies.map((a, i) => (
                    <li
                      key={i}
                      className={cn(
                        "rounded-md border p-2 text-xs",
                        a.severity === "high"
                          ? "border-destructive/40 bg-destructive/5"
                          : "border-amber-500/40 bg-amber-500/5",
                      )}
                    >
                      <div className="font-semibold">{a.what}</div>
                      <div className="text-muted-foreground">{a.detail}</div>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </TabsContent>

          {/* PEOPLE ------------------------------------------------------- */}
          <TabsContent value="people" className="space-y-3 pt-3">
            <Card title="Quality per person">
              <Table
                head={[
                  "Person",
                  "Batches",
                  "Assigned",
                  "Done %",
                  "In hand",
                  "Red leads",
                  "Top outcomes",
                ]}
                rows={d.operators.map((o) => [
                  o.operator,
                  o.batches,
                  o.assigned,
                  `${o.donePct}%`,
                  o.active,
                  o.red,
                  o.dispositions.map(([k, v]) => `${k} ${v}`).join(", ") || "—",
                ])}
                onPick={(i) => f.set({ operator: d.operators[i]?.operator ?? "all" })}
              />
            </Card>
          </TabsContent>

          {/* HISTORY ------------------------------------------------------ */}
          <TabsContent value="history" className="pt-3">
            <Card title="Nothing is deleted — every change is kept">
              <Table
                head={["When", "What happened", "By", "Why"]}
                rows={(data?.audit ?? [])
                  .slice(0, 80)
                  .map((a) => [
                    ago(a.at ? Date.parse(a.at) : 0),
                    a.action ?? "—",
                    a.by ?? "—",
                    a.reason ?? "—",
                  ])}
              />
            </Card>
          </TabsContent>

          {/* UPLOAD ------------------------------------------------------- */}
          <TabsContent value="upload" className="pt-3">
            <Ingest scope="admin" />
          </TabsContent>

          {/* CUSTOMER ----------------------------------------------------- */}
          <TabsContent value="customer" className="pt-3">
            {!openRow ? (
              <Card title="Pick a customer">
                <CustomerTable rows={d.rows.slice(0, 40)} onOpen={openCustomer} />
              </Card>
            ) : (
              <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
                <div className="space-y-3">
                  <Card title={`${openRow.name} · ${openRow.stage}`}>
                    <div className="space-y-2 text-xs">
                      <ContactActions phone={openRow.phone} name={openRow.name} />
                      <Row
                        k="Health"
                        v={
                          <Badge variant="outline" className={healthTone[openRow.health]}>
                            {openRow.health}
                          </Badge>
                        }
                      />
                      <Row k="Who owns it" v={openRow.handler} />
                      <Row
                        k="Journey step"
                        v={`${openRow.journeyStep} (${openRow.journeyIndex})`}
                      />
                      <Row k="Conversation type" v={openRow.bucket} />
                      <Row
                        k="Next action"
                        v={
                          openRow.nextActionKind
                            ? `${openRow.nextActionKind} · ${openRow.overdueMins > 0 ? `overdue ${openRow.overdueMins}m` : "due later"}`
                            : "missing"
                        }
                      />
                      <Row k="Last WhatsApp" v={ago(openRow.lastObsAt)} />
                      <Row k="Last CRM action" v={ago(openRow.lastActionAt)} />
                      <Row
                        k="Screenshot rows"
                        v={`${openRow.obsCount} (${openRow.reviewRows} unresolved)`}
                      />
                      <Row k="Last message" v={openRow.preview || "—"} />
                      {openRow.reasons.length > 0 && (
                        <div className="rounded-md border border-destructive/30 bg-destructive/5 p-2">
                          <div className="font-semibold text-destructive">Why this is flagged</div>
                          <ul className="mt-1 list-disc pl-4 text-muted-foreground">
                            {openRow.reasons.map((r) => (
                              <li key={r}>{r}</li>
                            ))}
                          </ul>
                        </div>
                      )}
                      <FixNow
                        row={openRow}
                        onAssign={(handler) =>
                          run(`${openRow.name} given to ${handler}`, () =>
                            assignOwner({ data: { leadId: openRow.id, handler } }),
                          )
                        }
                        onNext={(kind, mins2) =>
                          run("Next action set", () =>
                            setNextAction({
                              data: { leadId: openRow.id, kind, dueInMinutes: mins2 },
                            }),
                          )
                        }
                        canEscalate={can.escalateToTower}
                        onEscalate={() =>
                          run("Sent to Control Tower", () =>
                            escalateToTower({
                              data: {
                                leadId: openRow.id,
                                reason: openRow.reasons[0] ?? "Nobody moved this in time",
                              },
                            }),
                          )
                        }
                      />
                      <div className="flex flex-wrap gap-2 pt-1">
                        <Button asChild size="sm" variant="outline">
                          <Link to="/tower/leads/$id" params={{ id: openRow.id }}>
                            Full story
                          </Link>
                        </Button>
                        <Button asChild size="sm" variant="outline">
                          <Link to="/movement-split">Movement OS</Link>
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => setOpenRow(null)}>
                          Pick another
                        </Button>
                      </div>
                    </div>
                  </Card>
                  <Card title="Evidence from WhatsApp">
                    <Table
                      head={["Seen", "WhatsApp", "Message", "Label", "Confidence", "Decision"]}
                      rows={d.observations
                        .filter((o) => o.leadId === openRow.id)
                        .slice(0, 25)
                        .map((o) => [
                          ago(o.capturedAt ? Date.parse(o.capturedAt) : 0),
                          o.whatsappAccount ?? "—",
                          (o.preview ?? "").slice(0, 40),
                          o.label ?? "—",
                          `${o.ocrConfidence ?? 0}%`,
                          o.state ?? "—",
                        ])}
                    />
                  </Card>
                </div>
                <div className="h-[70vh] overflow-hidden rounded-xl border bg-card">
                  <SplitFlow
                    panelOnly
                    focus={{
                      name: openRow.name,
                      phone: openRow.phone,
                      canonicalId: canonicalCustomerId({
                        phone: openRow.phone,
                        name: openRow.name,
                      }),
                      key: openRow.id,
                    }}
                  />
                </div>
              </div>
            )}
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------- pieces */

function Select({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: string[];
}) {
  return (
    <label className="flex items-center gap-1 rounded-md border px-1.5 py-0.5">
      <span className="text-[10px] uppercase text-muted-foreground">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="bg-transparent text-xs outline-none"
      >
        <option value="all">All</option>
        {options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    </label>
  );
}

function Kpi({
  icon: Icon,
  label,
  value,
  hint,
  tone,
  onClick,
}: {
  icon: typeof Camera;
  label: string;
  value: number | string;
  hint?: string;
  tone?: "red" | "amber";
  onClick?: () => void;
}) {
  return (
    <button
      onClick={onClick}
      disabled={!onClick}
      className={cn(
        "rounded-xl border bg-card p-3 text-left transition",
        onClick && "hover:border-primary",
        tone === "red" && "border-destructive/40",
        tone === "amber" && "border-amber-500/40",
      )}
    >
      <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-muted-foreground">
        <Icon className="h-3.5 w-3.5" /> {label}
      </div>
      <div
        className={cn(
          "mt-1 text-2xl font-bold",
          tone === "red" && "text-destructive",
          tone === "amber" && "text-amber-600",
        )}
      >
        {value}
      </div>
      {hint && <div className="text-[11px] text-muted-foreground">{hint}</div>}
    </button>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border bg-card">
      <h2 className="border-b px-3 py-2 text-sm font-semibold">{title}</h2>
      <div className="p-3">{children}</div>
    </section>
  );
}

function Row({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-2 border-b py-1 last:border-0">
      <span className="text-muted-foreground">{k}</span>
      <span className="text-right font-medium">{v}</span>
    </div>
  );
}

function Bars({
  rows,
  onPick,
}: {
  rows: Array<[string, number, string]>;
  onPick?: (i: number) => void;
}) {
  const max = Math.max(1, ...rows.map((r) => r[1]));
  return (
    <div className="space-y-1.5">
      {rows.map(([label, value, tone], i) => (
        <button
          key={label}
          onClick={() => onPick?.(i)}
          disabled={!onPick}
          className="w-full text-left"
        >
          <div className="flex items-center justify-between text-xs">
            <span className="truncate">{label}</span>
            <span className="font-semibold">{value}</span>
          </div>
          <div className="mt-0.5 h-1.5 w-full rounded-full bg-muted">
            <div
              className={cn("h-1.5 rounded-full", tone)}
              style={{ width: `${(value / max) * 100}%` }}
            />
          </div>
        </button>
      ))}
      {rows.length === 0 && (
        <p className="text-xs text-muted-foreground">Nothing in this window yet.</p>
      )}
    </div>
  );
}

function Table({
  head,
  rows,
  onPick,
}: {
  head: string[];
  rows: Array<Array<string | number>>;
  onPick?: (i: number) => void;
}) {
  if (rows.length === 0)
    return <p className="text-xs text-muted-foreground">Nothing here for these filters.</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b text-left text-[11px] uppercase tracking-wide text-muted-foreground">
            {head.map((h) => (
              <th key={h} className="whitespace-nowrap px-2 py-1.5">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr
              key={i}
              onClick={() => onPick?.(i)}
              className={cn("border-b last:border-0", onPick && "cursor-pointer hover:bg-muted/50")}
            >
              {r.map((c, j) => (
                <td key={j} className="whitespace-nowrap px-2 py-1.5">
                  {c}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function CustomerTable({
  rows,
  onOpen,
}: {
  rows: CustomerRow[];
  onOpen: (r: CustomerRow) => void;
}) {
  if (rows.length === 0)
    return <p className="text-xs text-muted-foreground">No customer matches these filters.</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b text-left text-[11px] uppercase tracking-wide text-muted-foreground">
            {[
              "Customer",
              "Contact",
              "Health",
              "Owner",
              "Stage",
              "Step",
              "Next action",
              "Last WhatsApp",
              "Rows",
              "",
            ].map((h) => (
              <th key={h} className="whitespace-nowrap px-2 py-1.5">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="border-b last:border-0 hover:bg-muted/50">
              <td className="px-2 py-1.5">
                <button
                  className="font-medium underline-offset-2 hover:underline"
                  onClick={() => onOpen(r)}
                >
                  {r.name}
                </button>
                <div className="text-[11px] text-muted-foreground">{r.phone}</div>
              </td>
              <td className="px-2 py-1.5">
                <ContactActions phone={r.phone} name={r.name} compact />
              </td>
              <td className="px-2 py-1.5">
                <Badge variant="outline" className={healthTone[r.health]}>
                  {r.health}
                </Badge>
              </td>
              <td className="px-2 py-1.5">{r.handler}</td>
              <td className="whitespace-nowrap px-2 py-1.5">{r.stage}</td>
              <td className="whitespace-nowrap px-2 py-1.5">{r.journeyStep}</td>
              <td className="px-2 py-1.5">
                {r.nextActionKind ? (
                  <span className={cn(r.overdueMins > 0 && "font-semibold text-destructive")}>
                    {r.nextActionKind}
                    {r.overdueMins > 0 ? ` · overdue ${r.overdueMins}m` : ""}
                  </span>
                ) : (
                  <span className="text-destructive">missing</span>
                )}
              </td>
              <td className="whitespace-nowrap px-2 py-1.5">{ago(r.lastObsAt)}</td>
              <td className="px-2 py-1.5">{r.obsCount}</td>
              <td className="px-2 py-1.5">
                <Button
                  size="sm"
                  variant="outline"
                  className="h-6 px-2 text-[11px]"
                  onClick={() => onOpen(r)}
                >
                  Open
                </Button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Heat({ weekdays }: { weekdays: Array<{ day: string; counts: number[]; total: number }> }) {
  const max = Math.max(1, ...weekdays.flatMap((w) => w.counts));
  return (
    <div className="overflow-x-auto">
      <table className="text-[10px]">
        <thead>
          <tr>
            <th />
            {Array.from({ length: 24 }, (_, h) => (
              <th key={h} className="px-0.5 text-muted-foreground">
                {h}
              </th>
            ))}
            <th className="px-1 text-muted-foreground">All</th>
          </tr>
        </thead>
        <tbody>
          {weekdays.map((w) => (
            <tr key={w.day}>
              <td className="pr-1 text-muted-foreground">{w.day}</td>
              {w.counts.map((n, h) => (
                <td key={h} className="p-0.5">
                  <div
                    title={`${w.day} ${h}:00 — ${n} rows`}
                    className="h-4 w-4 rounded-sm bg-primary"
                    style={{ opacity: n === 0 ? 0.06 : 0.15 + (n / max) * 0.85 }}
                  />
                </td>
              ))}
              <td className="px-1 font-semibold">{w.total}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const QUICK: Array<[string, number]> = [
  ["Call now", 30],
  ["WhatsApp follow-up", 120],
  ["Share options", 240],
  ["Fix tour date", 1440],
];

function FixNow({
  row,
  onAssign,
  onNext,
  onEscalate,
  canEscalate = true,
}: {
  row: CustomerRow;
  onAssign: (handler: string) => void;
  onNext: (kind: string, dueInMinutes: number) => void;
  onEscalate: () => void;
  canEscalate?: boolean;
}) {
  const [who, setWho] = useState("");
  const [what, setWhat] = useState("");
  return (
    <div className="space-y-2 rounded-md border bg-muted/30 p-2">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        Fix it from here
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <Input
          value={who}
          onChange={(e) => setWho(e.target.value)}
          placeholder={row.owned ? `Move from ${row.handler}` : "Who takes this?"}
          className="h-7 w-40 text-xs"
        />
        <Button
          size="sm"
          className="h-7 px-2 text-[11px]"
          disabled={!who.trim()}
          onClick={() => {
            onAssign(who.trim());
            setWho("");
          }}
        >
          Give owner
        </Button>
        {canEscalate ? (
          <Button size="sm" variant="outline" className="h-7 px-2 text-[11px]" onClick={onEscalate}>
            Send to Control Tower
          </Button>
        ) : (
          <span className="text-[11px] text-muted-foreground">
            Only the founder can send this to Control Tower.
          </span>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <Input
          value={what}
          onChange={(e) => setWhat(e.target.value)}
          placeholder="What must happen next?"
          className="h-7 w-48 text-xs"
        />
        {QUICK.map(([label, mins2]) => (
          <Button
            key={label}
            size="sm"
            variant="outline"
            className="h-7 px-2 text-[11px]"
            onClick={() => {
              onNext(what.trim() || label, mins2);
              setWhat("");
            }}
          >
            {label} · {mins2 < 60 ? `${mins2}m` : `${Math.round(mins2 / 60)}h`}
          </Button>
        ))}
      </div>
    </div>
  );
}

function ResolveRows({
  rows,
  onDecide,
}: {
  rows: Array<{ id: string; name: string; phone: string; preview: string; reason: string }>;
  onDecide: (id: string, decision: "reconciled" | "non_customer") => void;
}) {
  if (rows.length === 0)
    return <p className="text-xs text-muted-foreground">Nothing waiting for a decision.</p>;
  return (
    <ul className="space-y-1.5">
      {rows.map((r) => (
        <li
          key={r.id}
          className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-2 text-xs"
        >
          <div className="min-w-0">
            <div className="font-medium">
              {r.name} · {r.phone || "no number"}
            </div>
            <div className="truncate text-muted-foreground">
              {r.preview || "no message read"} — {r.reason}
            </div>
          </div>
          <div className="flex gap-1.5">
            <Button
              size="sm"
              className="h-7 px-2 text-[11px]"
              onClick={() => onDecide(r.id, "reconciled")}
            >
              It is a customer
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="h-7 px-2 text-[11px]"
              onClick={() => onDecide(r.id, "non_customer")}
            >
              Not a customer
            </Button>
          </div>
        </li>
      ))}
    </ul>
  );
}
