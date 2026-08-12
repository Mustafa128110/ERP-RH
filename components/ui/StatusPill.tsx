// Brand semantic colors only (docs/OS/02-brand/colors.json) — no rainbow of
// categorical hues. Non-status category tags (sale channel, document type)
// get the neutral "Royal pick" navy-100/navy-800 treatment instead.
const SUCCESS = "bg-success-tint text-success ring-success/20";
const WARNING = "bg-warning-tint text-warning ring-warning/20";
const ERROR = "bg-error-tint text-error ring-error/20";
const INFO = "bg-info-tint text-info ring-info/20";
const NEUTRAL = "bg-navy-100 text-navy-800 ring-navy-800/15";
const MUTED = "bg-sand text-steel ring-steel/20";

const TONE_MAP: Record<string, string> = {
  active: SUCCESS,
  posted: SUCCESS,
  paid: SUCCESS,
  received: SUCCESS,
  delivered: SUCCESS,
  read: SUCCESS,
  converted: SUCCESS,
  ok: SUCCESS,
  purchase: SUCCESS,
  cleared: SUCCESS,

  pending: WARNING,
  "pending approval": WARNING,
  partial: WARNING,
  "partial paid": WARNING,
  "in transit": WARNING,
  sent: WARNING,
  low: WARNING,
  update: WARNING,
  adjustment: WARNING,
  "in hand": WARNING,

  draft: MUTED,
  inactive: MUTED,

  locked: ERROR,
  unpaid: ERROR,
  out: ERROR,
  expired: ERROR,
  rejected: ERROR,
  delete: ERROR,
  returned: ERROR,
  cancelled: ERROR,
  void: ERROR,

  initiated: INFO,
  create: INFO,
  merge: INFO,
  import: INFO,
  // Quotation lifecycle.
  open: INFO,
  "partly converted": WARNING,
  transfer: INFO,
  "transfer in": INFO,
  web: INFO,
  deposited: INFO,
  issued: INFO,
  made: INFO,

  sale: NEUTRAL,
  shop: NEUTRAL,
  m52: NEUTRAL,
  balochistan: NEUTRAL,
};

export function StatusPill({ value }: { value: string | number | boolean | null }) {
  const label = String(value ?? "—");
  const tone = TONE_MAP[label.toLowerCase()] ?? MUTED;
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${tone}`}>
      {label}
    </span>
  );
}
