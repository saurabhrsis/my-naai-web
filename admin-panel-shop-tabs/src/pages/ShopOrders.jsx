import { useState, useEffect, useCallback } from "react";
import { shopOrderAPI } from "../services/communication";
import Layout from "../components/Layout.jsx";
import SearchInput from "../components/SearchInput.jsx";
import Pagination from "../components/Pagination.jsx";
import Loader from "../components/Loader.jsx";
import ShopOrderDetailModal from "../components/ShopOrderDetailModal.jsx";
import { toast } from "react-toastify";
import { useNavigate } from "react-router-dom";
import { ShoppingBag } from "lucide-react";

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

export const INTERNAL_STATUS_META = {
  PENDING_ASSIGNMENT: { label: "Pending Assignment", badge: "bg-warning-subtle text-warning-emphasis" },
  AWAITING_ACCEPTANCE: { label: "Awaiting Distributor", badge: "bg-info-subtle text-info-emphasis" },
  ASSIGNED: { label: "Assigned", badge: "bg-primary-subtle text-primary-emphasis" },
  PICKED: { label: "Picked Up", badge: "bg-secondary-subtle text-secondary-emphasis" },
  SHIPPED: { label: "Shipped", badge: "bg-primary-subtle text-primary-emphasis" },
  DELIVERED: { label: "Delivered", badge: "bg-success-subtle text-success-emphasis" },
  CANCELLED: { label: "Cancelled", badge: "bg-danger-subtle text-danger-emphasis" }
};

const STATUS_FILTERS = [
  { key: "ALL", label: "All" },
  { key: "PENDING_ASSIGNMENT", label: "To Assign" },
  { key: "AWAITING_ACCEPTANCE", label: "Awaiting Reply" },
  { key: "ASSIGNED", label: "Assigned" },
  { key: "PICKED", label: "Picked" },
  { key: "SHIPPED", label: "Shipped" },
  { key: "DELIVERED", label: "Delivered" },
  { key: "CANCELLED", label: "Cancelled" }
];

const ShopOrders = () => {
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [orders, setOrders] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedOrder, setSelectedOrder] = useState(null);
  const navigate = useNavigate();

  const fetchOrders = useCallback(async () => {
    try {
      setIsLoading(true);
      const params = { page: currentPage, searchString: debouncedSearch };
      if (statusFilter !== "ALL") params.status = statusFilter;
      const result = await shopOrderAPI.adminList(params);
      if (result.success) {
        setOrders(result.data?.orders || []);
        setTotalPages(result.data?.pagination?.totalPages || 1);
      } else {
        toast.error(result.message || "Failed to load shop orders");
      }
    } catch {
      toast.error("Failed to load shop orders");
    } finally {
      setIsLoading(false);
    }
  }, [currentPage, debouncedSearch, statusFilter]);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(search);
      setCurrentPage(1);
    }, 500);
    return () => clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    fetchOrders();
  }, [fetchOrders]);

  useEffect(() => {
    const tab = localStorage.getItem("accessTab") ? JSON.parse(localStorage.getItem("accessTab")) : null;
    if (localStorage.getItem("role") === "distributor" || !(tab && tab?.includes("shopOrders"))) {
      navigate("/login", { replace: true });
    }
  }, []);

  const handleStatusChange = async (orderId, status) => {
    try {
      const result = await shopOrderAPI.updateStatus({ orderId, status });
      if (result.success) {
        toast.success(`Order ${status === "DELIVERED" ? "marked as delivered" : `moved to ${INTERNAL_STATUS_META[status]?.label || status}`}`);
        setSelectedOrder(null);
        fetchOrders();
      } else {
        toast.error(result.message || "Failed to update order status");
      }
    } catch {
      toast.error("Failed to update order status");
    }
  };

  const handleAssign = async (orderId, distributorId) => {
    try {
      const result = await shopOrderAPI.assignDistributor({ orderId, distributorId });
      if (result.success) {
        toast.success("Order requested to the distributor — waiting for their Accept / Reject");
        setSelectedOrder(null);
        fetchOrders();
      } else {
        toast.error(result.message || "Failed to assign distributor");
      }
    } catch {
      toast.error("Failed to assign distributor");
    }
  };

  // The admin token is accepted by the accept/reject endpoints, so an admin
  // can record a decision taken over the phone and it lands as a proper
  // ACCEPTED / REJECTED event (with the reason) in the order history.
  const handleRecordDecision = async (orderId, action, reason) => {
    try {
      const result = action === "accept"
        ? await shopOrderAPI.accept(orderId)
        : await shopOrderAPI.reject({ orderId, reason });
      if (result.success) {
        toast.success(action === "accept" ? "Acceptance recorded" : "Rejection recorded — order is back to To Assign");
        setSelectedOrder(null);
        fetchOrders();
      } else {
        toast.error(result.message || "Failed to record decision");
      }
    } catch {
      toast.error("Failed to record decision");
    }
  };

  return (
    <Layout>
      <div className="page-content d-flex flex-column p-2 p-md-3" style={{ height: "calc(100vh - 70px)", overflow: "hidden" }}>
        <div className="card shadow-sm mb-3 bg-white border-0 flex-shrink-0" style={{ borderRadius: "12px" }}>
          <div className="card-body p-3">
            {/* Flex instead of row/col: the panel's CSS build does not carry
                the Bootstrap grid utilities, so widths are inline. */}
            <div className="d-flex flex-column gap-2">
              <div style={{ flex: "0 0 auto", width: "100%", maxWidth: 420 }}>
                <SearchInput value={search} onChange={setSearch} placeholder="Search by order ID..." />
              </div>
              <div className="d-flex flex-wrap gap-2 align-items-center">
                {STATUS_FILTERS.map((f) => (
                  <button
                    key={f.key}
                    onClick={() => { setStatusFilter(f.key); setCurrentPage(1); }}
                    className={`btn btn-sm ${statusFilter === f.key ? "btn-success" : "btn-outline-secondary"}`}
                  >
                    {f.label}
                  </button>
                ))}
                <div style={{ marginLeft: "auto" }}><Pagination currentPage={currentPage} totalPages={totalPages} onPageChange={setCurrentPage} size="sm" /></div>
              </div>
            </div>
          </div>
        </div>

        <div className="flex-grow-1 p-3 shadow-sm border-0" style={{ overflowY: "auto", backgroundColor: "#ffffff", borderRadius: "12px" }}>
          {isLoading ? (
            <div className="text-center py-5"><Loader size="sm" /></div>
          ) : orders.length === 0 ? (
            <div className="text-center py-5 text-muted">
              <ShoppingBag size={40} className="mx-auto mb-2 opacity-25" />
              No shop orders match this filter.
            </div>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table className="table align-middle mb-0" style={{ fontSize: "0.9rem", width: "100%", minWidth: 640 }}>
                <thead>
                  <tr className="text-muted small" style={{ textTransform: "uppercase", letterSpacing: "0.4px" }}>
                    <th>Order</th>
                    <th>Salon (Customer)</th>
                    <th className="text-end">Items</th>
                    <th className="text-end">Total</th>
                    <th>Payment</th>
                    <th>Internal Status</th>
                    <th>Customer Sees</th>
                    <th>Distributor</th>
                    <th>Placed</th>
                  </tr>
                </thead>
                <tbody>
                  {orders.map((o) => {
                    const meta = INTERNAL_STATUS_META[o.status] || { label: o.status, badge: "bg-secondary-subtle text-secondary" };
                    const customerMeta = INTERNAL_STATUS_META[o.customerStatus] || { label: o.customerStatus };
                    const itemCount = (o.items || []).length;
                    return (
                      <tr
                        key={o.orderId}
                        className="cursor-pointer"
                        onClick={() => setSelectedOrder(o)}
                        style={{ cursor: "pointer" }}
                      >
                        <td className="fw-semibold">#{o.orderId}</td>
                        <td>
                          <div>{o.salon?.salonName || "—"}</div>
                          <div className="text-muted small">{o.salon?.phoneNumber || ""}</div>
                        </td>
                        <td className="text-end">{o.amounts?.itemCount ?? (o.items || []).length}</td>
                        <td className="text-end fw-semibold">{money(o.amounts?.total)}</td>
                        <td>
                          {o.payment?.status === "PAID"
                            ? <span className="badge bg-success-subtle text-success">{o.payment?.method} • Paid</span>
                            : <span className="badge bg-secondary-subtle text-secondary">{o.payment?.method} • Unpaid</span>}
                        </td>
                        <td><span className={`badge ${meta.badge}`}>{meta.label}</span></td>
                        <td><span className="text-muted small">{customerMeta.label}</span></td>
                        <td>{o.distributor?.name || <span className="text-muted">—</span>}</td>
                        <td className="text-muted small">{dateTime(o.createdAt)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <ShopOrderDetailModal
          order={selectedOrder}
          onClose={() => setSelectedOrder(null)}
          onStatusChange={handleStatusChange}
          onAssign={handleAssign}
          onRecordDecision={handleRecordDecision}
        />
      </div>
    </Layout>
  );
};

export default ShopOrders;
