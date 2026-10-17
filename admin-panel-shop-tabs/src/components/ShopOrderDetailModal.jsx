import { useState, useEffect } from "react";
import { Modal, Button, Spinner } from "react-bootstrap";
import { shopOrderAPI, distributorAPI } from "../services/communication";
import { toast } from "react-toastify";
import { Plus, CreditCard, UserPlus, CheckCircle2, XCircle, Truck, Ban, Store } from "lucide-react";
import { INTERNAL_STATUS_META } from "../pages/ShopOrders.jsx";

const money = (value) => {
  const num = Number(value);
  if (!Number.isFinite(num)) return "—";
  return `₹${num.toLocaleString("en-IN")}`;
};

const dateTime = (value) => {
  if (!value) return "";
  const d = new Date(value);
  return d.toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
};

const EVENT_META = {
  ORDER_PLACED: { icon: Plus, color: "#0d6efd", label: "Order placed" },
  PAYMENT_CONFIRMED: { icon: CreditCard, color: "#1e7e34", label: "Payment confirmed" },
  ASSIGNED: { icon: UserPlus, color: "#6f42c1", label: "Distributor requested" },
  ACCEPTED: { icon: CheckCircle2, color: "#1e7e34", label: "Distributor accepted" },
  REJECTED: { icon: XCircle, color: "#dc3545", label: "Distributor rejected" },
  STATUS_CHANGED: { icon: Truck, color: "#0d6efd", label: "Status changed" },
  CANCELLED: { icon: Ban, color: "#dc3545", label: "Order cancelled" }
};

const ACTOR_LABELS = {
  ADMIN: "MyNaai Admin",
  DISTRIBUTOR: "Distributor",
  SALON: "Salon",
  SYSTEM: "System"
};

const actorName = (ev) => {
  if (!ev.actor) return ACTOR_LABELS[ev.actorType] || "System";
  const name = ev.actor.name || ev.actor.phone || ev.actor.email;
  return name ? name : ACTOR_LABELS[ev.actorType] || "System";
};

const ShopOrderDetailModal = ({ order, onClose, onStatusChange, onAssign, onRecordDecision }) => {
  const [showAssign, setShowAssign] = useState(false);
  const [distributors, setDistributors] = useState([]);
  const [distributorLoading, setDistributorLoading] = useState(false);
  const [selectedDistributor, setSelectedDistributor] = useState("");
  const [assigning, setAssigning] = useState(false);
  const [showReject, setShowReject] = useState(false);
  const [rejectReason, setRejectReason] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setShowAssign(false);
    setShowReject(false);
    setRejectReason("");
    setSelectedDistributor("");
  }, [order]);

  if (!order) return null;

  const meta = INTERNAL_STATUS_META[order.status] || { label: order.status, badge: "bg-secondary-subtle text-secondary" };
  const items = order.items || [];
  const events = [...(order.events || [])].reverse(); // newest first

  const loadDistributors = async () => {
    setDistributorLoading(true);
    try {
      // Server page size is fixed (10), so pull a few pages for the picker.
      const first = await distributorAPI.list({ page: 1 });
      if (!first.success) {
        toast.error(first.message || "Failed to load distributors");
        return;
      }
      let rows = first.data?.distributors || [];
      const totalPages = first.data?.pagination?.totalPages || 1;
      const extra = Math.min(totalPages, 5) - 1;
      if (extra > 0) {
        const pages = await Promise.all(
          Array.from({ length: extra }, (_, i) => distributorAPI.list({ page: i + 2 }))
        );
        rows = rows.concat(...pages.filter((p) => p.success).map((p) => p.data?.distributors || []));
      }
      setDistributors(rows);
    } catch {
      toast.error("Failed to load distributors");
    } finally {
      setDistributorLoading(false);
    }
  };

  const openAssign = () => {
    setShowAssign(true);
    if (distributors.length === 0) loadDistributors();
  };

  const confirmAssign = async () => {
    if (!selectedDistributor) { toast.error("Choose a distributor"); return; }
    setAssigning(true);
    try {
      await onAssign(order.orderId, selectedDistributor);
    } finally {
      setAssigning(false);
    }
  };

  const recordAccept = async () => {
    setBusy(true);
    try { await onRecordDecision(order.orderId, "accept"); }
    finally { setBusy(false); }
  };

  const recordReject = async () => {
    if (rejectReason.trim().length < 3) { toast.error("A rejection reason is required (min 3 characters)"); return; }
    setBusy(true);
    try { await onRecordDecision(order.orderId, "reject", rejectReason.trim()); }
    finally { setBusy(false); }
  };

  const changeStatus = (status) => {
    if (status === "CANCELLED" && !window.confirm("Cancel this order? The salon customer will see it as cancelled.")) return;
    setBusy(true);
    onStatusChange(order.orderId, status);
  };

  const statusActionButtons = () => {
    const s = order.status;
    const btns = [];
    if (s === "PENDING_ASSIGNMENT") {
      btns.push(<Button key="assign" variant="success" size="sm" onClick={openAssign} disabled={busy}><UserPlus size={14} className="me-1" />Assign Distributor</Button>);
    }
    if (s === "AWAITING_ACCEPTANCE") {
      btns.push(<Button key="acc" variant="success" size="sm" onClick={recordAccept} disabled={busy}><CheckCircle2 size={14} className="me-1" />Record Accept</Button>);
      btns.push(
        <Button key="rej" variant="outline-danger" size="sm" onClick={() => setShowReject((v) => !v)} disabled={busy}>
          <XCircle size={14} className="me-1" />Record Reject
        </Button>
      );
    }
    if (s === "ASSIGNED") {
      btns.push(<Button key="pick" variant="primary" size="sm" onClick={() => changeStatus("PICKED")} disabled={busy}><Truck size={14} className="me-1" />Mark Picked Up</Button>);
    }
    if (s === "PICKED") {
      btns.push(<Button key="ship" variant="primary" size="sm" onClick={() => changeStatus("SHIPPED")} disabled={busy}><Truck size={14} className="me-1" />Mark Shipped</Button>);
    }
    if (s === "SHIPPED") {
      btns.push(<Button key="del" variant="success" size="sm" onClick={() => changeStatus("DELIVERED")} disabled={busy}><CheckCircle2 size={14} className="me-1" />Mark Delivered</Button>);
    }
    if (s !== "CANCELLED" && s !== "DELIVERED") {
      btns.push(<Button key="cancel" variant="outline-danger" size="sm" onClick={() => changeStatus("CANCELLED")} disabled={busy}><Ban size={14} className="me-1" />Cancel</Button>);
    }
    return btns;
  };

  return (
    <Modal show={Boolean(order)} onHide={onClose} centered size="xl" backdrop="static">
      <Modal.Header closeButton>
        <Modal.Title className="fw-bold d-flex align-items-center gap-2">
          <Store size={18} />
          Order #{order.orderId?.slice(0, 8)}
          <span className={`badge ${meta.badge}`}>{meta.label}</span>
        </Modal.Title>
      </Modal.Header>
      <Modal.Body>
        <div className="row g-4">
          {/* Left column: details + timeline */}
          <div className="col-lg-7">
            <div className="row g-3 mb-3">
              <div className="col-sm-6">
                <div className="small text-muted mb-1">Ordered By (Salon)</div>
                <div className="fw-semibold">{order.salon?.salonName || "—"}</div>
                <div className="text-muted small">{order.salon?.phoneNumber || ""}</div>
              </div>
              <div className="col-sm-6">
                <div className="small text-muted mb-1">Delivery Contact</div>
                <div className="fw-semibold">{order.address?.name || "—"}</div>
                <div className="text-muted small">{order.address?.phone || ""}</div>
              </div>
            </div>

            {order.address && (
              <div className="mb-3">
                <div className="small text-muted mb-1">Delivery Address</div>
                <div className="small text-muted">
                  {order.address.line1}{order.address.city ? `, ${order.address.city}` : ""}{order.address.state ? `, ${order.address.state}` : ""} – {order.address.pincode || ""}
                </div>
              </div>
            )}

            <div className="border rounded-2 p-2 mb-3" style={{ backgroundColor: "#fafaf8" }}>
              <div className="small text-muted mb-2">Items ({order.amounts?.itemCount ?? items.length})</div>
              <table className="table table-sm mb-0 align-middle" style={{ fontSize: "0.87rem" }}>
                <thead>
                  <tr className="text-muted small">
                    <th>Item</th>
                    <th className="text-center">Qty</th>
                    <th className="text-end">Price</th>
                    <th className="text-end">Line Total</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((it, idx) => {
                    const qty = Number(it.qty || 1);
                    const price = Number(it.price || 0);
                    return (
                      <tr key={it.productId || idx}>
                        <td className="pe-2" style={{ maxWidth: 260 }}>
                          {it.image && <img src={it.image} alt="" style={{ width: 32, height: 32, objectFit: "cover", borderRadius: 6, marginRight: 8, verticalAlign: "middle" }} />}
                          {it.name}
                        </td>
                        <td className="text-center">{qty}</td>
                        <td className="text-end">{money(it.price)}</td>
                        <td className="text-end fw-semibold">{money(price * qty)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="d-flex flex-wrap gap-4 small mb-3">
              <div>
                <span className="text-muted">Items: </span><span className="fw-semibold">{money(order.amounts?.itemTotal)}</span>
              </div>
              <div>
                <span className="text-muted">Delivery: </span>
                <span className="fw-semibold">{Number(order.amounts?.deliveryFee) === 0 ? "Free" : money(order.amounts?.deliveryFee)}</span>
              </div>
              <div>
                <span className="text-muted">Total: </span><span className="fw-semibold">{money(order.amounts?.total)}</span>
              </div>
              {Number(order.amounts?.savings) > 0 && (
                <div>
                  <span className="text-muted">Salon saved: </span><span className="text-success fw-semibold">{money(order.amounts?.savings)}</span>
                </div>
              )}
              <div>
                <span className="text-muted">Payment: </span>
                {order.payment?.status === "PAID"
                  ? <span className="badge bg-success-subtle text-success">{order.payment.method} • Paid{order.payment.paymentId ? " (Razorpay)" : ""}</span>
                  : <span className="badge bg-secondary-subtle text-secondary">{order.payment?.method} • Unpaid</span>}
              </div>
              <div>
                <span className="text-muted">Placed: </span><span>{dateTime(order.createdAt)}</span>
              </div>
            </div>

            {/* Timeline */}
            <div className="small text-muted mb-2 fw-semibold" style={{ textTransform: "uppercase", letterSpacing: "0.4px" }}>Full Order History</div>
            <div className="d-flex flex-column gap-0">
              {events.map((ev, idx) => {
                const evMeta = EVENT_META[ev.action] || { icon: Truck, color: "#6c757d", label: ev.action };
                const Icon = evMeta.icon;
                return (
                  <div key={ev.id || idx} className="d-flex gap-3" style={{ position: "relative" }}>
                    <div className="d-flex flex-column align-items-center">
                      <div
                        style={{
                          width: 30, height: 30, borderRadius: "50%", backgroundColor: `${evMeta.color}1a`,
                          color: evMeta.color, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0
                        }}
                      >
                        <Icon size={15} />
                      </div>
                      {idx < events.length - 1 && <div style={{ width: 2, flex: 1, minHeight: 18, backgroundColor: "#e3e6e3" }} />}
                    </div>
                    <div style={{ paddingBottom: 14 }}>
                      <div className="fw-semibold">{evMeta.label}</div>
                      <div className="text-muted">
                        {actorName(ev)} • {dateTime(ev.createdAt)}
                        {ev.fromStatus && ev.toStatus && (
                          <> <span className="text-muted">•</span> {INTERNAL_STATUS_META[ev.fromStatus]?.label || ev.fromStatus} → {INTERNAL_STATUS_META[ev.toStatus]?.label || ev.toStatus}</>
                        )}
                      </div>
                      {ev.note && (
                        <div className={`small mt-1 p-2 rounded-2 ${ev.action === "REJECTED" ? "bg-danger-subtle text-danger-emphasis" : "bg-light border"}`}>
                          “{ev.note}”
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
              {events.length === 0 && <div className="text-muted small">No events recorded yet.</div>}
            </div>
          </div>

          {/* Right column: actions */}
          <div className="col-lg-5">
            <div className="border rounded-3 p-3 mb-3" style={{ backgroundColor: "#fafaf8" }}>
              <div className="small text-muted mb-1">Distributor</div>
              {order.distributor ? (
                <>
                  <div className="fw-semibold">{order.distributor.name}</div>
                  <div className="small text-muted">{order.distributor.phone}{order.distributor.area ? ` • ${order.distributor.area}` : ""}</div>
                  {order.distributor.deliveryCapability && <div className="small text-muted mt-1">Capability: {order.distributor.deliveryCapability}</div>}
                </>
              ) : (
                <div className="text-muted">Not assigned yet</div>
              )}
              <div className="mt-3">
                <Button variant="success" size="sm" onClick={openAssign} disabled={busy} className="w-100">
                  <UserPlus size={14} className="me-1" />
                  {order.distributor ? "Re-assign / Request Another" : "Assign Distributor"}
                </Button>
              </div>
            </div>

            <div className="small text-muted mb-2 fw-semibold" style={{ textTransform: "uppercase", letterSpacing: "0.4px" }}>Actions</div>
            <div className="d-flex flex-wrap gap-2">
              {statusActionButtons()}
            </div>

            {showReject && (
              <div className="mt-3 border rounded-3 p-3 bg-danger-subtle" style={{ borderColor: "#f1c1c6" }}>
                <div className="small fw-semibold mb-2">Rejection Reason (recorded on the order history)</div>
                <textarea
                  className="form-control form-control-sm mb-2"
                  rows={3}
                  value={rejectReason}
                  onChange={(e) => setRejectReason(e.target.value)}
                  placeholder="e.g. Out of stock of Herbal Oil, cannot deliver to this pincode..."
                />
                <div className="d-flex gap-2">
                  <Button variant="danger" size="sm" onClick={recordReject} disabled={busy}>{busy ? "Saving..." : "Confirm Rejection"}</Button>
                  <Button variant="outline-secondary" size="sm" onClick={() => { setShowReject(false); setRejectReason(""); }} disabled={busy}>Cancel</Button>
                </div>
              </div>
            )}

            <div className="alert small mb-0 mt-3" style={{ backgroundColor: "#f6f8f6", borderColor: "#e3e8e3" }}>
              <strong>How the flow works:</strong> assign a distributor → it waits in <em>Awaiting Distributor</em> while they check
              the order in the Distributor Portal. They Accept (→ Assigned) or Reject (back to To Assign with their reason).
              You can also record their decision here if they told you on the phone.
            </div>
          </div>
        </div>

        {/* Assign distributor inline section */}
        {showAssign && (
          <div className="mt-4 border-top pt-3">
            <div className="d-flex align-items-center justify-content-between mb-2">
              <div className="fw-semibold">Choose a distributor</div>
              <Button variant="link" size="sm" className="p-0" onClick={() => setShowAssign(false)}>Close</Button>
            </div>
            {distributorLoading ? (
              <div className="text-center py-3"><Spinner size="sm" /></div>
            ) : distributors.length === 0 ? (
              <div className="text-muted small py-2">No active distributors yet — add some in the Distributors tab first.</div>
            ) : (
              <div className="row g-2" style={{ maxHeight: 240, overflowY: "auto" }}>
                {distributors.map((d) => (
                  <div className="col-md-6" key={d.distributorId}>
                    <button
                      className="w-100 text-start border rounded-3 p-2 small"
                      style={{
                        backgroundColor: selectedDistributor === d.distributorId ? "#eaf7ee" : "#ffffff",
                        borderColor: selectedDistributor === d.distributorId ? "#1e7e34" : "#e3e6e3"
                      }}
                      onClick={() => setSelectedDistributor(d.distributorId)}
                    >
                      <div className="fw-semibold">{d.name}</div>
                      <div className="text-muted">{d.phone} • {d.area || "no area set"}</div>
                      {d.deliveryCapability && <div className="text-muted" style={{ fontSize: "0.78rem" }}>{d.deliveryCapability}</div>}
                      {!d.isActive && <div className="text-danger" style={{ fontSize: "0.78rem" }}>Disabled — cannot log in</div>}
                    </button>
                  </div>
                ))}
              </div>
            )}
            <div className="mt-3 d-flex gap-2">
              <Button variant="success" size="sm" onClick={confirmAssign} disabled={assigning || !selectedDistributor}>
                {assigning ? "Requesting..." : "Send to Distributor (Awaiting Accept/Reject)"}
              </Button>
            </div>
          </div>
        )}
      </Modal.Body>
    </Modal>
  );
};

export default ShopOrderDetailModal;
