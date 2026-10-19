import { useState, useEffect } from "react";
import { Modal, Button, Spinner } from "react-bootstrap";
import { shopOrderAPI, distributorAPI } from "../services/communication";
import { toast } from "react-toastify";
import { Plus, CreditCard, UserPlus, CheckCircle2, XCircle, Truck, Ban, Store, Package, Banknote, Phone, MapPin } from "lucide-react";
import { INTERNAL_STATUS_META } from "../pages/ShopOrders.jsx";

/*
  DESIGN NOTE — why every structural style carries !important:
  The panel's deployed CSS (its local index.css working copy) contains rules
  that override ordinary utility classes AND ordinary inline styles on nested
  divs, inputs and selects. An inline style declared with !important sits
  above every author-stylesheet rule (including their !important ones), so
  this modal sets every layout property that matters (display / width /
  flex / gap) inline with !important. No class is relied on for width or
  display — classes are appearance only.
*/

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
  // The distributor carries the parcel forward — each move is its own event.
  PICKED: { icon: Package, color: "#fd7e14", label: "Picked up at the depot" },
  SHIPPED: { icon: Truck, color: "#0d6efd", label: "Out for delivery" },
  DELIVERED: { icon: CheckCircle2, color: "#1e7e34", label: "Delivered" },
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

// Product thumbnails: when the image URL is missing/broken the old code
// rendered a broken-image glyph; swap it for a tidy package placeholder.
const ItemThumb = ({ src, size = 32 }) => {
  const [failed, setFailed] = useState(false);
  if (!src || failed) {
    return (
      <div
        style={{
          width: `${size}px !important`, height: `${size}px !important`, borderRadius: "6px !important",
          background: "#eef1ee !important", display: "inline-flex !important", alignItems: "center !important",
          justifyContent: "center !important", flex: "0 0 auto !important", boxSizing: "border-box !important"
        }}
      >
        <Package size={size - 16} color="#9aa39a" />
      </div>
    );
  }
  return (
    <img
      src={src}
      alt=""
      onError={() => setFailed(true)}
      style={{
        width: `${size}px !important`, height: `${size}px !important`, objectFit: "cover !important",
        borderRadius: "6px !important", flex: "0 0 auto !important", display: "block !important", background: "#f4f6f4 !important"
      }}
    />
  );
};

// Structural helpers — every declaration !important on purpose (see note).
const box = (extra) => ({ boxSizing: "border-box !important", ...extra });
const rowFlex = (extra) => box({ display: "flex !important", ...extra });
const card = (extra) =>
  box({
    border: "1px solid #e3e8e3 !important",
    borderRadius: "12px !important",
    background: "#ffffff !important",
    ...extra
  });

const selectStyle = box({
  width: "100% !important",
  border: "1px solid #d9e0da !important",
  borderRadius: "10px !important",
  padding: "9px 12px !important",
  fontSize: "0.88rem !important",
  fontFamily: "inherit !important",
  background: "#ffffff !important",
  color: "#0f1c1a !important",
  display: "block !important",
});

const textareaStyle = box({
  width: "100% !important",
  border: "1px solid #d9e0da !important",
  borderRadius: "10px !important",
  padding: "9px 12px !important",
  fontSize: "0.88rem !important",
  fontFamily: "inherit !important",
  background: "#ffffff !important",
  color: "#0f1c1a !important",
  display: "block !important",
});

const billLine = (label, value, opts = {}) => (
  <div style={rowFlex({ justifyContent: "space-between !important", alignItems: "baseline !important", gap: "12px !important", width: "100% !important", padding: "3px 0 !important" })}>
    <span style={{ color: "#6b7570 !important", fontSize: "0.82rem !important", minWidth: "0 !important" }}>{label}</span>
    <span
      style={{
        fontWeight: opts.bold ? "700 !important" : "500 !important",
        fontSize: opts.bold ? "0.95rem !important" : "0.85rem !important",
        color: opts.color || "#0f1c1a !important",
        whiteSpace: "nowrap !important"
      }}
    >
      {value}
    </span>
  </div>
);

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

  const paid = order.payment?.status === "PAID";
  const thStyle = box({
    textAlign: "left !important",
    padding: "8px 6px !important",
    fontSize: "0.72rem !important",
    fontWeight: "600 !important",
    textTransform: "uppercase !important",
    letterSpacing: "0.4px !important",
    color: "#6b7570 !important",
    borderBottom: "1px solid #e3e8e3 !important",
    whiteSpace: "nowrap !important"
  });
  const tdStyle = box({
    padding: "9px 6px !important",
    fontSize: "0.85rem !important",
    color: "#0f1c1a !important",
    borderBottom: "1px solid #f0f2f0 !important",
    verticalAlign: "middle !important"
  });

  const actionButtonStyle = box({
    width: "100% !important",
    display: "inline-flex !important",
    alignItems: "center !important",
    justifyContent: "center !important",
    gap: "6px !important",
  });

  return (
    // Fullscreen below the sm breakpoint — on a phone the order, the bill
    // and the actions all fit in one scroll instead of a cramped popup.
    <Modal show={Boolean(order)} onHide={onClose} centered size="xl" fullscreen="sm-down" backdrop="static" className="shop-order-detail-modal">
      <style>{`
        .shop-order-detail-modal .modal-content { border: none; border-radius: 14px; }
        .shop-order-detail-modal .modal-header { padding: 14px 18px; border-bottom: 1px solid #e3e8e3; }
        .shop-order-detail-modal .modal-body { padding: 18px; }
      `}</style>
      <Modal.Header closeButton>
        <div style={rowFlex({ flexWrap: "wrap !important", alignItems: "center !important", gap: "10px !important", flex: "1 1 auto !important", minWidth: "0 !important", width: "100% !important" })}>
          <div
            style={box({
              width: "36px !important", height: "36px !important", borderRadius: "10px !important",
              background: "#eef4f0 !important", color: "#1e7e34 !important",
              display: "flex !important", alignItems: "center !important", justifyContent: "center !important",
              flex: "0 0 auto !important"
            })}
          >
            <Store size={18} />
          </div>
          <div style={box({ minWidth: "0 !important" })}>
            <div style={{ fontWeight: "600 !important", fontSize: "0.95rem !important", lineHeight: "1.2 !important" }}>
              Order #{order.orderId?.slice(0, 8)}
            </div>
            <div style={{ color: "#6b7570 !important", fontSize: "0.75rem !important", marginTop: "2px !important" }}>
              Placed {dateTime(order.createdAt)}
            </div>
          </div>
          <span className={`badge ${meta.badge}`} style={{ whiteSpace: "nowrap !important", flex: "0 0 auto !important" }}>{meta.label}</span>
          <span
            style={box({
              display: "inline-flex !important", alignItems: "center !important", gap: "6px !important",
              padding: "5px 12px !important", borderRadius: "999px !important",
              background: order.payment?.method === "COD" ? "#f3e8ff !important" : "#e8f0fe !important",
              color: order.payment?.method === "COD" ? "#7e22ce !important" : "#1a56db !important",
              border: `1px solid ${order.payment?.method === "COD" ? "#e2ccf5" : "#c4d7f7"} !important`,
              fontSize: "0.78rem !important", fontWeight: "600 !important", whiteSpace: "nowrap !important", flex: "0 0 auto !important"
            })}
          >
            {order.payment?.method === "COD" ? <Banknote size={12} /> : <CreditCard size={12} />}
            {order.payment?.method === "COD" ? "Cash on Delivery" : "Paid Online"}
          </span>
        </div>
      </Modal.Header>
      <Modal.Body>
        <div style={rowFlex({ flexDirection: "column !important", gap: "18px !important", width: "100% !important" })}>
          <div style={rowFlex({ flexWrap: "wrap !important", gap: "18px !important", width: "100% !important" })}>
            {/* Left panel: details + timeline */}
            <div style={box({ flex: "2 1 460px !important", minWidth: "0 !important", width: "100% !important" })}>
              {/* Salon + delivery contact */}
              <div style={rowFlex({ flexWrap: "wrap !important", gap: "14px !important", width: "100% !important" })}>
                <div style={card({ flex: "1 1 220px !important", minWidth: "0 !important", width: "100% !important", padding: "14px !important", background: "#fafbfa !important" })}>
                  <div style={rowFlex({ alignItems: "center !important", gap: "8px !important", marginBottom: "10px !important", width: "100% !important" })}>
                    <Store size={15} color="#1e7e34" style={{ flex: "0 0 auto !important" }} />
                    <span style={{ fontSize: "0.72rem !important", fontWeight: "600 !important", textTransform: "uppercase !important", letterSpacing: "0.5px !important", color: "#6b7570 !important" }}>Ordered By (Salon)</span>
                  </div>
                  <div style={{ fontWeight: "600 !important", fontSize: "0.95rem !important", color: "#0f1c1a !important", width: "100% !important", wordBreak: "break-word !important" }}>
                    {order.salon?.salonName || "—"}
                  </div>
                  {order.salon?.phoneNumber && (
                    <button
                      onClick={() => window.open(`tel:${order.salon.phoneNumber}`, "_blank")}
                      style={box({
                        display: "inline-flex !important", alignItems: "center !important", gap: "6px !important",
                        marginTop: "8px !important", padding: "6px 10px !important",
                        border: "1px solid #c9e2cf !important", borderRadius: "8px !important",
                        background: "#ffffff !important", color: "#1e7e34 !important",
                        fontSize: "0.8rem !important", fontWeight: "500 !important", cursor: "pointer !important",
                        maxWidth: "100% !important"
                      })}
                    >
                      <Phone size={12} style={{ flex: "0 0 auto !important" }} /> {order.salon.phoneNumber}
                    </button>
                  )}
                </div>
                <div style={card({ flex: "1 1 220px !important", minWidth: "0 !important", width: "100% !important", padding: "14px !important", background: "#fafbfa !important" })}>
                  <div style={rowFlex({ alignItems: "center !important", gap: "8px !important", marginBottom: "10px !important", width: "100% !important" })}>
                    <Package size={15} color="#0e5fd8" style={{ flex: "0 0 auto !important" }} />
                    <span style={{ fontSize: "0.72rem !important", fontWeight: "600 !important", textTransform: "uppercase !important", letterSpacing: "0.5px !important", color: "#6b7570 !important" }}>Delivery Contact</span>
                  </div>
                  <div style={{ fontWeight: "600 !important", fontSize: "0.95rem !important", color: "#0f1c1a !important", width: "100% !important", wordBreak: "break-word !important" }}>
                    {order.address?.name || "—"}
                  </div>
                  {order.address?.phone && (
                    <button
                      onClick={() => window.open(`tel:${order.address.phone}`, "_blank")}
                      style={box({
                        display: "inline-flex !important", alignItems: "center !important", gap: "6px !important",
                        marginTop: "8px !important", padding: "6px 10px !important",
                        border: "1px solid #c4d7f7 !important", borderRadius: "8px !important",
                        background: "#ffffff !important", color: "#0e5fd8 !important",
                        fontSize: "0.8rem !important", fontWeight: "500 !important", cursor: "pointer !important",
                        maxWidth: "100% !important"
                      })}
                    >
                      <Phone size={12} style={{ flex: "0 0 auto !important" }} /> {order.address.phone}
                    </button>
                  )}
                </div>
              </div>

              {/* Address */}
              {order.address && (
                <div style={card({ display: "flex !important", alignItems: "flex-start !important", gap: "10px !important", width: "100% !important", marginTop: "14px !important", padding: "12px !important", background: "#fafbfa !important" })}>
                  <MapPin size={16} style={{ flex: "0 0 auto !important", marginTop: "2px !important" }} />
                  <div style={{ minWidth: "0 !important", fontSize: "0.85rem !important", color: "#3d4a42 !important", lineHeight: "1.5 !important", wordBreak: "break-word !important", width: "100% !important" }}>
                    {order.address.line1 || "—"}
                    {(order.address.city || order.address.state || order.address.pincode) && (
                      <div style={{ color: "#6b7570 !important" }}>
                        {[order.address.city, order.address.state].filter(Boolean).join(", ")}
                        {order.address.pincode ? ` · PIN ${order.address.pincode}` : ""}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Items */}
              <div style={card({ width: "100% !important", marginTop: "14px !important", padding: "0 !important", overflow: "hidden !important" })}>
                <div style={rowFlex({ alignItems: "center !important", gap: "8px !important", padding: "10px 14px !important", borderBottom: "1px solid #e3e8e3 !important", width: "100% !important" })}>
                  <Package size={14} color="#1e7e34" style={{ flex: "0 0 auto !important" }} />
                  <span style={{ fontWeight: "600 !important", fontSize: "0.85rem !important" }}>Items ({order.amounts?.itemCount ?? items.length})</span>
                </div>
                {/* overflowX: the bill scrolls sideways on a phone instead of squeezing the item names. */}
                <div style={{ overflowX: "auto !important", width: "100% !important" }}>
                  <table style={{ width: "100% !important", minWidth: "380px !important", borderCollapse: "collapse !important" }}>
                    <thead>
                      <tr>
                        <th style={thStyle}>Item</th>
                        <th style={{ ...thStyle, textAlign: "right !important" }}>Qty</th>
                        <th style={{ ...thStyle, textAlign: "right !important" }}>Price</th>
                        <th style={{ ...thStyle, textAlign: "right !important" }}>Line Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {items.map((it, idx) => {
                        const qty = Number(it.qty || 1);
                        const price = Number(it.price || 0);
                        return (
                          <tr key={it.productId || idx}>
                            <td style={{ ...tdStyle, maxWidth: "260px !important" }}>
                              <div style={rowFlex({ alignItems: "center !important", gap: "10px !important", width: "100% !important" })}>
                                <ItemThumb src={it.image} size={32} />
                                <span style={{ minWidth: "0 !important", wordBreak: "break-word !important" }}>{it.name}</span>
                              </div>
                            </td>
                            <td style={{ ...tdStyle, textAlign: "right !important", whiteSpace: "nowrap !important" }}>{qty}</td>
                            <td style={{ ...tdStyle, textAlign: "right !important", whiteSpace: "nowrap !important" }}>{money(it.price)}</td>
                            <td style={{ ...tdStyle, textAlign: "right !important", whiteSpace: "nowrap !important", fontWeight: "600 !important" }}>{money(price * qty)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Bill — receipt style */}
              <div style={card({ width: "100% !important", maxWidth: "420px !important", marginTop: "14px !important", padding: "4px 14px 10px !important", background: "#fafbfa !important" })}>
                <div style={rowFlex({ alignItems: "center !important", gap: "8px !important", padding: "10px 0 6px !important", width: "100% !important" })}>
                  <Banknote size={14} color="#1e7e34" style={{ flex: "0 0 auto !important" }} />
                  <span style={{ fontWeight: "600 !important", fontSize: "0.85rem !important" }}>Bill</span>
                </div>
                {billLine(`Items (${order.amounts?.itemCount ?? items.length})`, money(order.amounts?.itemTotal))}
                {Number(order.amounts?.discount) > 0 && billLine(
                  order.amounts?.discountPercent != null ? `Discount (${order.amounts.discountPercent}% off)` : "Discount",
                  `− ${money(order.amounts?.discount)}`,
                  { color: "#1e7e34" }
                )}
                {billLine(
                  "Delivery",
                  Number(order.amounts?.deliveryFee) === 0 ? "FREE" : money(order.amounts?.deliveryFee),
                  { color: Number(order.amounts?.deliveryFee) === 0 ? "#1e7e34" : "#0f1c1a" }
                )}
                {Number(order.amounts?.codFee) > 0 && billLine("COD charges", money(order.amounts?.codFee))}
                <div style={{ borderTop: "1px dashed #cfd8d1 !important", margin: "8px 0 6px !important", width: "100% !important" }} />
                {billLine("Total", money(order.amounts?.total), { bold: true })}
                {Number(order.amounts?.savings) > 0 && billLine("Salon saved (MRP)", money(order.amounts?.savings), { color: "#1e7e34" })}
              </div>

              {/* Payment + placed */}
              <div style={rowFlex({ flexWrap: "wrap !important", alignItems: "center !important", gap: "10px 18px !important", width: "100% !important", marginTop: "14px !important" })}>
                <div style={{ fontSize: "0.85rem !important" }}>
                  <span style={{ color: "#6b7570 !important" }}>Payment: </span>
                  {paid
                    ? <span className="badge bg-success-subtle text-success" style={{ fontSize: "0.75rem !important" }}>{order.payment?.method} • Paid{order.payment?.paymentId ? " (Razorpay)" : ""}</span>
                    : <span className="badge bg-secondary-subtle text-secondary" style={{ fontSize: "0.75rem !important" }}>{order.payment?.method} • Unpaid</span>}
                </div>
                <div style={{ fontSize: "0.85rem !important" }}>
                  <span style={{ color: "#6b7570 !important" }}>Placed: </span>
                  <span>{dateTime(order.createdAt)}</span>
                </div>
              </div>

              {/* Timeline */}
              <div style={{ ...box({ width: "100% !important", marginTop: "18px !important" }), color: "#6b7570 !important", fontSize: "0.75rem !important", fontWeight: "600 !important", textTransform: "uppercase !important", letterSpacing: "0.4px !important" }}>
                Full Order History
              </div>
              <div style={rowFlex({ flexDirection: "column !important", width: "100% !important", marginTop: "10px !important" })}>
                {events.map((ev, idx) => {
                  const evMeta = EVENT_META[ev.action] || { icon: Truck, color: "#6c757d", label: ev.action };
                  const Icon = evMeta.icon;
                  return (
                    <div key={ev.id || idx} style={rowFlex({ gap: "12px !important", width: "100% !important" })}>
                      <div style={rowFlex({ flexDirection: "column !important", alignItems: "center !important", flex: "0 0 auto !important" })}>
                        <div
                          style={box({
                            width: "30px !important", height: "30px !important", borderRadius: "50% !important",
                            backgroundColor: `${evMeta.color}1a !important`, color: `${evMeta.color} !important`,
                            display: "flex !important", alignItems: "center !important", justifyContent: "center !important",
                            flex: "0 0 auto !important"
                          })}
                        >
                          <Icon size={15} />
                        </div>
                        {idx < events.length - 1 && <div style={{ width: "2px !important", flex: "1 1 auto !important", minHeight: "18px !important", backgroundColor: "#e3e6e3 !important" }} />}
                      </div>
                      <div style={box({ paddingBottom: "14px !important", minWidth: "0 !important", flex: "1 1 auto !important", width: "100% !important" })}>
                        <div style={{ fontWeight: "600 !important", fontSize: "0.88rem !important", color: "#0f1c1a !important", width: "100% !important" }}>{evMeta.label}</div>
                        <div style={{ color: "#6b7570 !important", fontSize: "0.78rem !important", marginTop: "3px !important", width: "100% !important" }}>
                          {actorName(ev)} • {dateTime(ev.createdAt)}
                          {ev.fromStatus && ev.toStatus && (
                            <> • {INTERNAL_STATUS_META[ev.fromStatus]?.label || ev.fromStatus} → {INTERNAL_STATUS_META[ev.toStatus]?.label || ev.toStatus}</>
                          )}
                        </div>
                        {ev.note && (
                          <div
                            style={box({
                              marginTop: "8px !important", padding: "8px 12px !important", borderRadius: "10px !important",
                              width: "100% !important", fontSize: "0.8rem !important", lineHeight: "1.4 !important",
                              wordBreak: "break-word !important",
                              background: ev.action === "REJECTED" ? "#fdf3f2 !important" : "#f6f7f6 !important",
                              border: `1px solid ${ev.action === "REJECTED" ? "#f3d6d3" : "#e3e8e3"} !important`,
                              color: ev.action === "REJECTED" ? "#9c3630 !important" : "#3d4a42 !important"
                            })}
                          >
                            “{ev.note}”
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
                {events.length === 0 && <div style={{ color: "#6b7570 !important", fontSize: "0.8rem !important", width: "100% !important" }}>No events recorded yet.</div>}
              </div>
            </div>

            {/* Right panel: distributor + actions */}
            <div style={rowFlex({ flexDirection: "column !important", gap: "14px !important", flex: "1 1 300px !important", minWidth: "0 !important", width: "100% !important" })}>
              {/* Distributor card */}
              <div style={card({ width: "100% !important", padding: "14px !important" })}>
                <div style={rowFlex({ alignItems: "center !important", gap: "8px !important", marginBottom: "12px !important", width: "100% !important" })}>
                  <Truck size={15} color="#0f766e" style={{ flex: "0 0 auto !important" }} />
                  <span style={{ fontSize: "0.72rem !important", fontWeight: "600 !important", textTransform: "uppercase !important", letterSpacing: "0.5px !important", color: "#6b7570 !important" }}>Distributor</span>
                </div>
                {order.distributor ? (
                  <div style={rowFlex({ gap: "12px !important", width: "100% !important", alignItems: "flex-start !important" })}>
                    <div
                      style={box({
                        width: "40px !important", height: "40px !important", borderRadius: "50% !important",
                        background: "#e6f7f7 !important", color: "#0f766e !important",
                        display: "flex !important", alignItems: "center !important", justifyContent: "center !important",
                        fontWeight: "700 !important", fontSize: "0.9rem !important", flex: "0 0 auto !important"
                      })}
                    >
                      {(order.distributor.name || "?").split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() || "").join("")}
                    </div>
                    <div style={box({ flex: "1 1 auto !important", minWidth: "0 !important", width: "100% !important" })}>
                      <div style={{ fontWeight: "600 !important", fontSize: "0.95rem !important", color: "#0f1c1a !important", width: "100% !important", wordBreak: "break-word !important" }}>{order.distributor.name}</div>
                      <div style={{ color: "#6b7570 !important", fontSize: "0.8rem !important", marginTop: "3px !important", width: "100% !important" }}>
                        {order.distributor.phone}{order.distributor.area ? ` • ${order.distributor.area}` : ""}
                      </div>
                      {order.distributor.deliveryCapability && (
                        <div style={{ color: "#6b7570 !important", fontSize: "0.78rem !important", marginTop: "4px !important", width: "100% !important" }}>
                          Capability: {order.distributor.deliveryCapability}
                        </div>
                      )}
                    </div>
                  </div>
                ) : (
                  <div style={{ color: "#6b7570 !important", fontSize: "0.85rem !important", width: "100% !important" }}>Not assigned yet</div>
                )}

                {showAssign ? (
                  <div style={box({ marginTop: "12px !important", width: "100% !important" })}>
                    <label htmlFor="distributor-select" style={{ display: "block !important", color: "#6b7570 !important", fontSize: "0.78rem !important", marginBottom: "6px !important", width: "100% !important" }}>
                      {order.distributor ? "Re-assign to another distributor" : "Choose a distributor"}
                    </label>
                    {distributorLoading ? (
                      <div style={rowFlex({ alignItems: "center !important", gap: "8px !important", padding: "8px 0 !important", color: "#6b7570 !important", fontSize: "0.8rem !important", width: "100% !important" })}>
                        <Spinner size="sm" /> Loading distributors…
                      </div>
                    ) : distributors.length === 0 ? (
                      <div style={{ color: "#6b7570 !important", fontSize: "0.8rem !important", padding: "4px 0 !important", width: "100% !important" }}>
                        No active distributors yet — add some in the Distributors tab first.
                      </div>
                    ) : (
                      <select
                        id="distributor-select"
                        value={selectedDistributor}
                        onChange={(e) => setSelectedDistributor(e.target.value)}
                        style={selectStyle}
                      >
                        <option value="">Choose a distributor…</option>
                        {distributors.map((d) => (
                          <option key={d.distributorId} value={d.distributorId} disabled={!d.isActive}>
                            {d.name} — {d.phone}{d.area ? ` • ${d.area}` : ""}{!d.isActive ? " (disabled)" : ""}
                          </option>
                        ))}
                      </select>
                    )}
                    <div style={rowFlex({ flexDirection: "column !important", gap: "8px !important", marginTop: "10px !important", width: "100% !important" })}>
                      <Button variant="success" size="sm" onClick={confirmAssign} disabled={assigning || !selectedDistributor || distributorLoading} style={actionButtonStyle}>
                        {assigning ? "Requesting…" : "Assign"}
                      </Button>
                      <Button variant="outline-secondary" size="sm" onClick={() => { setShowAssign(false); setSelectedDistributor(""); }} disabled={assigning} style={actionButtonStyle}>
                        Close
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div style={box({ marginTop: "12px !important", width: "100% !important" })}>
                    <Button variant="success" size="sm" onClick={openAssign} disabled={busy} style={actionButtonStyle}>
                      <UserPlus size={14} />
                      {order.distributor ? "Re-assign / Request Another" : "Assign Distributor"}
                    </Button>
                  </div>
                )}
              </div>

              {/* Actions */}
              <div style={{ ...box({ width: "100% !important" }), color: "#6b7570 !important", fontSize: "0.75rem !important", fontWeight: "600 !important", textTransform: "uppercase !important", letterSpacing: "0.4px !important" }}>
                Actions
              </div>
              {/* Two-up on a wide panel, one-up on a narrow one — big tap targets at every size. */}
              <div style={rowFlex({ flexWrap: "wrap !important", gap: "8px !important", width: "100% !important", marginTop: "10px !important" })}>
                {statusActionButtons().map((b, i) => (
                  <div key={i} style={box({ flex: "1 1 calc(50% - 4px) !important", minWidth: "130px !important", width: "100% !important" })}>{b}</div>
                ))}
              </div>

              {showReject && (
                <div style={card({ width: "100% !important", padding: "14px !important", background: "#fdf3f2 !important", border: "1px solid #f1c1c6 !important" })}>
                  <div style={{ fontSize: "0.8rem !important", fontWeight: "600 !important", color: "#9c3630 !important", marginBottom: "10px !important", width: "100% !important" }}>
                    Rejection Reason (recorded on the order history)
                  </div>
                  <textarea
                    rows={3}
                    value={rejectReason}
                    onChange={(e) => setRejectReason(e.target.value)}
                    placeholder="e.g. Out of stock of Herbal Oil, cannot deliver to this pincode..."
                    style={textareaStyle}
                  />
                  <div style={rowFlex({ flexDirection: "column !important", gap: "8px !important", marginTop: "10px !important", width: "100% !important" })}>
                    <Button variant="danger" size="sm" onClick={recordReject} disabled={busy} style={actionButtonStyle}>{busy ? "Saving..." : "Confirm Rejection"}</Button>
                    <Button variant="outline-secondary" size="sm" onClick={() => { setShowReject(false); setRejectReason(""); }} disabled={busy} style={actionButtonStyle}>Cancel</Button>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Flow note — full-width at the bottom, readable at every width. */}
          <div
            style={box({
              display: "flex !important", flexWrap: "wrap !important", alignItems: "center !important", gap: "6px 14px !important",
              width: "100% !important", padding: "12px 14px !important", borderRadius: "12px !important",
              background: "#f6f8f6 !important", border: "1px solid #e3e8e3 !important",
              fontSize: "0.78rem !important", color: "#3d4a42 !important", lineHeight: "1.5 !important"
            })}
          >
            <span style={{ display: "inline-flex !important", alignItems: "center !important", gap: "6px !important", fontWeight: "600 !important", color: "#1e7e34 !important" }}>
              <CheckCircle2 size={13} /> How the flow works
            </span>
            <span style={{ width: "100% !important" }}>
              assign a distributor → it waits in <em>Awaiting Distributor</em> while they check the order in the Distributor Portal.
              They Accept (→ Assigned) or Reject (back to To Assign with their reason). After accepting, the distributor carries it
              forward — Picked Up → Shipped → Delivered — from the portal, and you can record any of those moves here too (over the phone).
            </span>
          </div>
        </div>
      </Modal.Body>
    </Modal>
  );
};

export default ShopOrderDetailModal;
