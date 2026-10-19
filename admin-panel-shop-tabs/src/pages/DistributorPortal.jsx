import { useState, useEffect, useCallback } from "react";
import { shopOrderAPI } from "../services/communication";
import Loader from "../components/Loader.jsx";
import { toast } from "react-toastify";
import { useNavigate } from "react-router-dom";
import { Truck, CheckCircle2, XCircle, LogOut, Store, Package } from "lucide-react";

const money = (value) => {
  const num = Number(value);
  if (!Number.isFinite(num)) return "—";
  return `₹${num.toLocaleString("en-IN")}`;
};

const dateTime = (value) => {
  if (!value) return "—";
  const d = new Date(value);
  return d.toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
};

const STATUS_BADGES = {
  AWAITING_ACCEPTANCE: "bg-info-subtle text-info-emphasis",
  ASSIGNED: "bg-primary-subtle text-primary-emphasis",
  PICKED: "bg-warning-subtle text-warning-emphasis",
  SHIPPED: "bg-primary-subtle text-primary-emphasis",
  DELIVERED: "bg-success-subtle text-success-emphasis",
  CANCELLED: "bg-danger-subtle text-danger-emphasis"
};

const STATUS_LABELS = {
  AWAITING_ACCEPTANCE: "Needs your reply",
  ASSIGNED: "Accepted — pick up",
  PICKED: "Picked up",
  SHIPPED: "Shipped",
  DELIVERED: "Delivered",
  CANCELLED: "Cancelled"
};

// After accepting, the distributor carries the parcel forward — one button
// per step, so a double-tap or a skipped step can never corrupt the record
// (the server enforces the same chain).
const NEXT_STEP = {
  ASSIGNED: { to: "PICKED", label: "Mark Picked Up", icon: Package, variant: "button23" },
  PICKED: { to: "SHIPPED", label: "Mark Shipped", icon: Truck, variant: "button23" },
  SHIPPED: { to: "DELIVERED", label: "Mark Delivered", icon: CheckCircle2, variant: "button23" }
};

// Product thumbnails: a broken/missing image URL renders a tidy package
// placeholder instead of the browser's broken-image glyph.
const ItemThumb = ({ src, size = 30 }) => {
  const [failed, setFailed] = useState(false);
  if (!src || failed) {
    return (
      <div
        style={{
          width: size, height: size, borderRadius: 6, background: "#eef1ee",
          display: "inline-flex", alignItems: "center", justifyContent: "center",
          marginRight: 8, verticalAlign: "middle", flexShrink: 0
        }}
      >
        <Package size={size - 14} color="#9aa39a" />
      </div>
    );
  }
  return <img src={src} alt="" onError={() => setFailed(true)} style={{ width: size, height: size, objectFit: "cover", borderRadius: 6, marginRight: 8, verticalAlign: "middle", flexShrink: 0 }} />;
};

const OrderCard = ({ order, onAccept, onReject, onAdvance, busy }) => {
  const [showReject, setShowReject] = useState(false);
  const [reason, setReason] = useState("");
  const items = order.items || [];
  const awaiting = order.status === "AWAITING_ACCEPTANCE";
  const step = NEXT_STEP[order.status];

  const submitReject = () => {
    if (reason.trim().length < 3) {
      toast.error("Please give a reason so MyNaai can find another distributor");
      return;
    }
    onReject(order.orderId, reason.trim());
  };

  // NOTE on layout: the admin panel's CSS build does not reliably carry the
  // Bootstrap grid (row/col-*) utilities, so this card lays its sections out
  // with plain flex + explicit inline widths that behave at every screen size.
  return (
    <div className="card border-0 shadow-sm mb-3" style={{ borderRadius: "12px" }}>
      <div className="card-body p-3 d-flex flex-column gap-3">
        <div className="d-flex flex-wrap justify-content-between align-items-center gap-2">
          <div className="d-flex align-items-center gap-2 flex-wrap">
            <span className="fw-semibold">Order #{order.orderId}</span>
            <span className={`badge ${STATUS_BADGES[order.status] || "bg-secondary-subtle text-secondary"}`}>
              {STATUS_LABELS[order.status] || order.status}
            </span>
          </div>
          <div className="text-muted small">{dateTime(order.createdAt)}</div>
        </div>

        <div className="d-flex flex-wrap gap-3">
          <div style={{ flex: "1 1 220px", minWidth: 0 }}>
            <div className="small text-muted">From Salon</div>
            <div className="small fw-semibold">{order.salon?.salonName || "—"}</div>
            <div className="small text-muted">{order.salon?.phoneNumber || ""}</div>
          </div>
          <div style={{ flex: "1 1 220px", minWidth: 0 }}>
            <div className="small text-muted">Deliver To</div>
            <div className="small fw-semibold">{order.address?.name || "—"}</div>
            <div className="small text-muted">
              {order.address?.line1}{order.address?.city ? `, ${order.address.city}` : ""} – {order.address?.pincode || ""}
            </div>
            {order.address?.phone && <div className="small text-muted">Contact: {order.address.phone}</div>}
          </div>
        </div>

        <div className="border rounded-2 p-2" style={{ backgroundColor: "#fafaf8", width: "100%" }}>
          {/* Table scrolls sideways on narrow phones instead of squeezing. */}
          <div style={{ overflowX: "auto" }}>
            <table className="table table-sm mb-0 align-middle" style={{ fontSize: "0.87rem", width: "100%", minWidth: 280 }}>
              <tbody>
                {items.map((it, idx) => (
                  <tr key={it.productId || idx}>
                    <td className="pe-2">
                      <ItemThumb src={it.image} size={30} />
                      {it.name}
                    </td>
                    <td className="text-center small">{it.qty}</td>
                    <td className="text-end small fw-semibold">{money(Number(it.price || 0) * Number(it.qty || 1))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="d-flex flex-wrap gap-3 small pt-1 border-top" style={{ borderColor: "#eee" }}>
            <span><span className="text-muted">Total: </span><span className="fw-semibold">{money(order.amounts?.total)}</span></span>
            <span>
              <span className="text-muted">Payment: </span>
              {order.payment?.status === "PAID"
                ? <span className="text-success fw-semibold">{order.payment.method} • Already paid</span>
                : <span className="text-warning-emphasis fw-semibold">{order.payment?.method} • Collect on delivery</span>}
            </span>
          </div>
        </div>

        {awaiting && (
          <div>
            {/* Full-width stacked buttons on phones, inline on desktop. */}
            <div className="d-grid d-sm-flex gap-2">
              <button className="button23" onClick={() => onAccept(order.orderId)} disabled={busy} style={{ padding: "10px 18px" }}>
                <CheckCircle2 size={15} className="me-1" /> Accept Order
              </button>
              <button
                className="button22"
                onClick={() => setShowReject((v) => !v)}
                disabled={busy}
                style={{ color: "#c0392b", borderColor: "#e6b3ad", background: "#fdf3f1", padding: "10px 18px" }}
              >
                <XCircle size={15} className="me-1" /> Reject
              </button>
            </div>
            {showReject && (
              <div className="mt-2 border rounded-3 p-2" style={{ backgroundColor: "#fdf3f1", borderColor: "#e6b3ad" }}>
                <textarea
                  className="form-control form-control-sm mb-2"
                  rows={2}
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="Reason (MyNaai admin will see this, e.g. out of stock, cannot cover this area...)"
                />
                <div className="d-grid d-sm-flex gap-2">
                  <button className="btn btn-sm btn-danger" onClick={submitReject} disabled={busy}>
                    {busy ? "Sending..." : "Confirm Rejection"}
                  </button>
                  <button className="btn btn-sm btn-outline-secondary" onClick={() => { setShowReject(false); setReason(""); }} disabled={busy}>
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* After accepting: one tap moves the parcel to the next step. */}
        {step && (
          <div className="d-grid d-sm-flex gap-2 align-items-center">
            <button className={step.variant} onClick={() => onAdvance(order.orderId, step.to)} disabled={busy} style={{ padding: "10px 18px" }}>
              {(() => { const Icon = step.icon; return <Icon size={15} className="me-1" />; })()}
              {step.label}
            </button>
            <span className="small text-muted d-none d-sm-inline">
              Next: {STATUS_LABELS[step.to]} — the salon sees the update immediately.
            </span>
          </div>
        )}

        {order.status === "DELIVERED" && (
          <div className="small text-success d-flex align-items-center gap-1 mt-2">
            <CheckCircle2 size={14} /> Delivered — nice work!
          </div>
        )}

        {!awaiting && order.status === "CANCELLED" && order.cancelReason && (
          <div className="small text-muted mt-1">Cancel reason: {order.cancelReason}</div>
        )}
      </div>
    </div>
  );
};

const DistributorPortal = () => {
  const [tab, setTab] = useState("queue"); // queue | all
  const [orders, setOrders] = useState([]);
  const [queueCount, setQueueCount] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();

  const userData = localStorage.getItem("userData") ? JSON.parse(localStorage.getItem("userData")) : {};

  useEffect(() => {
    if (localStorage.getItem("role") !== "distributor") {
      navigate("/login", { replace: true });
    }
  }, []);

  const fetchOrders = useCallback(async () => {
    try {
      setIsLoading(true);
      const params = tab === "queue" ? { status: "AWAITING_ACCEPTANCE" } : {};
      const result = await shopOrderAPI.distributorOrders(params);
      if (result.success) {
        setOrders(result.data?.orders || []);
        // The queue badge needs the respond-queue count even while the
        // "all" tab is showing — one extra cheap call only when needed.
        if (tab !== "queue") {
          const q = await shopOrderAPI.distributorOrders({ status: "AWAITING_ACCEPTANCE" });
          if (q.success) setQueueCount((q.data?.orders || []).length);
        } else {
          setQueueCount((result.data?.orders || []).length);
        }
      } else {
        toast.error(result.message || "Failed to load orders");
      }
    } catch {
      toast.error("Failed to load orders");
    } finally {
      setIsLoading(false);
    }
  }, [tab]);

  useEffect(() => {
    fetchOrders();
  }, [fetchOrders]);

  const handleAccept = async (orderId) => {
    if (!window.confirm("Accept this order? The salon will see it as confirmed.")) return;
    setBusy(true);
    try {
      const result = await shopOrderAPI.accept(orderId);
      if (result.success) {
        toast.success("Order accepted — pick it up and deliver. MyNaai has been notified.");
        fetchOrders();
      } else {
        toast.error(result.message || "Failed to accept order");
      }
    } catch {
      toast.error("Failed to accept order");
    } finally {
      setBusy(false);
    }
  };

  const handleReject = async (orderId, reason) => {
    setBusy(true);
    try {
      const result = await shopOrderAPI.reject({ orderId, reason });
      if (result.success) {
        toast.success("Rejected — MyNaai admin will re-assign the order to another distributor.");
        fetchOrders();
      } else {
        toast.error(result.message || "Failed to reject order");
      }
    } catch {
      toast.error("Failed to reject order");
    } finally {
      setBusy(false);
    }
  };

  const handleAdvance = async (orderId, nextStatus) => {
    setBusy(true);
    try {
      const result = await shopOrderAPI.distributorUpdateStatus({ orderId, status: nextStatus });
      if (result.success) {
        const verb = nextStatus === "PICKED" ? "marked picked up" : nextStatus === "SHIPPED" ? "marked shipped" : "marked delivered";
        toast.success(`Order ${verb}. The salon can see the update.`);
        fetchOrders();
      } else {
        toast.error(result.message || "Could not update the order status");
      }
    } catch {
      toast.error("Could not update the order status");
    } finally {
      setBusy(false);
    }
  };

  const handleLogout = () => {
    localStorage.removeItem("token");
    localStorage.removeItem("userData");
    localStorage.removeItem("role");
    navigate("/login", { replace: true });
  };

  const activeCount = tab === "all" ? orders.filter((o) => ["ASSIGNED", "PICKED", "SHIPPED"].includes(o.status)).length : null;

  return (
    <div className="min-vh-100" style={{ backgroundColor: "#f4f5f2" }}>
      <nav className="navbar border-bottom px-3 px-md-4 py-2" style={{ backgroundColor: "#ffffff" }}>
        <div className="d-flex align-items-center gap-2">
          <div
            className="d-flex align-items-center justify-content-center rounded-3"
            style={{ width: 38, height: 38, background: "#1e7e34", flexShrink: 0 }}
          >
            <Truck size={20} color="#fff" />
          </div>
          <div style={{ minWidth: 0, flex: "1 1 auto" }}>
            {/* The long title would crowd a phone — keep it on one line. */}
            <div className="fw-bold text-truncate" style={{ fontSize: "1rem", lineHeight: 1.1 }}>
              <span className="d-none d-sm-inline">MyNaai </span>Distributor Portal
            </div>
            <div className="text-muted small text-truncate">{userData?.name || "Distributor"}</div>
          </div>
        </div>
        <button className="btn btn-sm btn-outline-secondary" onClick={handleLogout} title="Logout">
          <LogOut size={14} className="me-1" /><span className="d-none d-sm-inline">Logout</span>
        </button>
      </nav>

      <div className="container-fluid px-3 px-md-4 py-3" style={{ maxWidth: 900 }}>
        {/* Segmented tabs: full-width on phones, compact on desktop. */}
        <div className="d-grid d-md-flex gap-2 mb-3">
          <button
            className={`btn btn-sm d-flex align-items-center justify-content-center gap-2 ${tab === "queue" ? "btn-success" : "btn-outline-secondary"}`}
            onClick={() => setTab("queue")}
          >
            <Package size={14} className="d-none d-sm-inline" />
            Waiting for your reply
            {queueCount != null && queueCount > 0 && (
              <span className={`badge rounded-pill ${tab === "queue" ? "bg-white text-success" : "bg-success"}`}>{queueCount}</span>
            )}
          </button>
          <button
            className={`btn btn-sm d-flex align-items-center justify-content-center gap-2 ${tab === "all" ? "btn-success" : "btn-outline-secondary"}`}
            onClick={() => setTab("all")}
          >
            <Store size={14} className="d-none d-sm-inline" />
            All my orders
            {activeCount != null && activeCount > 0 && (
              <span className={`badge rounded-pill ${tab === "all" ? "bg-white text-success" : "bg-primary"}`}>{activeCount}</span>
            )}
          </button>
        </div>

        {isLoading ? (
          <div className="text-center py-5"><Loader size="sm" /></div>
        ) : orders.length === 0 ? (
          <div className="card border-0 shadow-sm text-center py-5 text-muted" style={{ borderRadius: "12px" }}>
            <Truck size={40} className="mx-auto mb-2 opacity-25" />
            {tab === "queue"
              ? "No orders waiting for your reply right now."
              : "You have no orders yet. MyNaai admin will assign orders here."}
          </div>
        ) : (
          orders.map((o) => (
            <OrderCard
              key={o.orderId}
              order={o}
              busy={busy}
              onAccept={handleAccept}
              onReject={handleReject}
              onAdvance={handleAdvance}
            />
          ))
        )}
      </div>
    </div>
  );
};

export default DistributorPortal;
