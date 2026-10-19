import { useState, useEffect, useCallback } from "react";
import { distributorAPI } from "../services/communication";
import Layout from "../components/Layout.jsx";
import SearchInput from "../components/SearchInput.jsx";
import Pagination from "../components/Pagination.jsx";
import Loader from "../components/Loader.jsx";
import DistributorModal from "../components/DistributorModal.jsx";
import { toast } from "react-toastify";
import { useNavigate } from "react-router-dom";
import { Truck, Plus } from "lucide-react";

const money = (value) => {
  const num = Number(value);
  if (!Number.isFinite(num)) return "—";
  return `₹${num.toLocaleString("en-IN")}`;
};

const Distributors = () => {
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [distributors, setDistributors] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editingDistributor, setEditingDistributor] = useState(null);
  const [activeFilter, setActiveFilter] = useState("ALL");
  const navigate = useNavigate();

  const fetchDistributors = useCallback(async () => {
    try {
      setIsLoading(true);
      const result = await distributorAPI.list({ page: currentPage, searchString: debouncedSearch });
      if (result.success) {
        setDistributors(result.data?.distributors || []);
        setTotalPages(result.data?.pagination?.totalPages || 1);
      } else {
        toast.error(result.message || "Failed to load distributors");
      }
    } catch {
      toast.error("Failed to load distributors");
    } finally {
      setIsLoading(false);
    }
  }, [currentPage, debouncedSearch]);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(search);
      setCurrentPage(1);
    }, 500);
    return () => clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    fetchDistributors();
  }, [fetchDistributors]);

  useEffect(() => {
    const tab = localStorage.getItem("accessTab") ? JSON.parse(localStorage.getItem("accessTab")) : null;
    if (localStorage.getItem("role") === "distributor" || !(tab && tab?.includes("distributors"))) {
      navigate("/login", { replace: true });
    }
  }, []);

  const handleToggleActive = async (distributor) => {
    try {
      const result = await distributorAPI.update({
        distributorId: distributor.distributorId,
        isActive: !distributor.isActive
      });
      if (result.success) {
        toast.success(distributor.isActive ? "Distributor disabled — they can no longer log in" : "Distributor activated");
        fetchDistributors();
      } else {
        toast.error(result.message || "Update failed");
      }
    } catch {
      toast.error("Update failed");
    }
  };

  const visible = distributors.filter((d) => (activeFilter === "ALL" ? true : activeFilter === "ACTIVE" ? d.isActive : !d.isActive));

  const FILTERS = [
    { key: "ALL", label: "All" },
    { key: "ACTIVE", label: "Active" },
    { key: "INACTIVE", label: "Disabled" }
  ];

  return (
    <Layout>
      <div className="page-content d-flex flex-column p-2 p-md-3" style={{ height: "calc(100vh - 70px)", overflow: "hidden" }}>
        <div className="card shadow-sm mb-3 bg-white border-0 flex-shrink-0" style={{ borderRadius: "12px" }}>
          <div className="card-body p-3">
            {/* Flex instead of row/col: the panel's CSS build does not carry
                the Bootstrap grid utilities, so widths are inline. */}
            <div className="d-flex flex-wrap align-items-center gap-3">
              <div style={{ flex: "1 1 240px", minWidth: 0 }}>
                <SearchInput value={search} onChange={setSearch} placeholder="Search by name, phone, area..." />
              </div>
              <div className="d-flex flex-wrap gap-2" style={{ flex: "1 1 260px", minWidth: 0 }}>
                {FILTERS.map((f) => (
                  <button
                    key={f.key}
                    onClick={() => setActiveFilter(f.key)}
                    className={`btn btn-sm ${activeFilter === f.key ? "btn-success" : "btn-outline-secondary"}`}
                  >
                    {f.label}
                  </button>
                ))}
              </div>
              <div className="d-flex align-items-center gap-2" style={{ flex: "1 1 auto", minWidth: 180, justifyContent: "flex-end" }}>
                <button className="button23" onClick={() => { setEditingDistributor(null); setShowModal(true); }}>
                  <Plus size={15} className="me-1" /> Add Distributor
                </button>
                <Pagination currentPage={currentPage} totalPages={totalPages} onPageChange={setCurrentPage} size="sm" />
              </div>
            </div>
          </div>
        </div>

        <div className="flex-grow-1 p-3 shadow-sm border-0" style={{ overflowY: "auto", backgroundColor: "#ffffff", borderRadius: "12px" }}>
          {isLoading ? (
            <div className="text-center py-5"><Loader size="sm" /></div>
          ) : visible.length === 0 ? (
            <div className="text-center py-5 text-muted">
              <Truck size={40} className="mx-auto mb-2 opacity-25" />
              No distributors found. Add one to start fulfilling salon orders.
            </div>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table className="table align-middle mb-0" style={{ fontSize: "0.9rem", width: "100%", minWidth: 640 }}>
                <thead>
                  <tr className="text-muted small" style={{ textTransform: "uppercase", letterSpacing: "0.4px" }}>
                    <th>Distributor</th>
                    <th>Contact</th>
                    <th>Area</th>
                    <th>Delivery Capability</th>
                    <th>Status</th>
                    <th className="text-end">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map((d) => (
                    <tr key={d.distributorId}>
                      <td>
                        <div className="fw-semibold">{d.name}</div>
                        {d.address && <div className="text-muted small">{d.address}</div>}
                      </td>
                      <td>
                        <div>{d.phone}</div>
                        {d.email && <div className="text-muted small">{d.email}</div>}
                      </td>
                      <td>{d.area || "—"}</td>
                      <td>{d.deliveryCapability || "—"}</td>
                      <td>
                        {d.isActive
                          ? <span className="badge bg-success-subtle text-success">Active</span>
                          : <span className="badge bg-secondary-subtle text-secondary">Disabled</span>}
                      </td>
                      <td className="text-end">
                        <button className="button22 me-1" onClick={() => { setEditingDistributor(d); setShowModal(true); }}>Edit</button>
                        <button
                          className="btn btn-sm"
                          style={{
                            color: d.isActive ? "#7f8c8d" : "#1e7e34",
                            border: `1px solid ${d.isActive ? "#dde5dd" : "#a3d9b1"}`,
                            background: d.isActive ? "#f4f6f4" : "#eaf7ee"
                          }}
                          onClick={() => handleToggleActive(d)}
                        >
                          {d.isActive ? "Disable" : "Activate"}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <DistributorModal
          showModal={showModal}
          setShowModal={setShowModal}
          initialDistributor={editingDistributor}
          onSuccess={() => { fetchDistributors(); setShowModal(false); setEditingDistributor(null); }}
        />
      </div>
    </Layout>
  );
};

export default Distributors;
