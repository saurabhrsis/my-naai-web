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
      <div className="page-content" style={{ display: "flex !important", flexDirection: "column !important", gap: "12px !important", width: "100% !important", height: "calc(100vh - 70px) !important", overflow: "hidden !important", boxSizing: "border-box !important" }}>
      {/* NOTE: structural styles are inline with !important — the panel's deployed CSS
          overrides ordinary classes and inline styles on nested divs. */}
        <div className="card shadow-sm bg-white border-0" style={{ flex: "0 0 auto !important", width: "100% !important", borderRadius: "12px !important", boxSizing: "border-box !important", marginBottom: "0 !important" }}>
          <div className="card-body" style={{ display: "block !important", width: "100% !important", padding: "12px !important" }}>
            {/* Flex instead of row/col: the panel's CSS build does not carry
                the Bootstrap grid utilities, so widths are inline. */}
            <div style={{ display: "flex !important", flexWrap: "wrap !important", gap: "12px !important", alignItems: "center !important", width: "100% !important" }}>
              <div style={{ flex: "1 1 240px !important", minWidth: "0 !important", width: "100% !important" }}>
                <SearchInput value={search} onChange={setSearch} placeholder="Search by name, phone, area..." />
              </div>
              <div style={{ display: "flex !important", flexWrap: "wrap !important", gap: "8px !important", flex: "1 1 260px !important", minWidth: "0 !important", width: "100% !important" }}>
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
              <div style={{ display: "flex !important", alignItems: "center !important", gap: "8px !important", flex: "1 1 auto !important", minWidth: "180px !important", justifyContent: "flex-end !important", width: "100% !important" }}>
                <button className="button23" onClick={() => { setEditingDistributor(null); setShowModal(true); }}>
                  <Plus size={15} className="me-1" /> Add Distributor
                </button>
                <Pagination currentPage={currentPage} totalPages={totalPages} onPageChange={setCurrentPage} size="sm" />
              </div>
            </div>
          </div>
        </div>

        <div className="p-3" style={{ flex: "1 1 auto !important", minHeight: "0 !important", overflowY: "auto !important", backgroundColor: "#ffffff !important", borderRadius: "12px !important", width: "100% !important", boxSizing: "border-box !important" }}>
          {isLoading ? (
            <div className="text-center py-5"><Loader size="sm" /></div>
          ) : visible.length === 0 ? (
            <div className="text-center py-5 text-muted">
              <Truck size={40} className="mx-auto mb-2 opacity-25" />
              No distributors found. Add one to start fulfilling salon orders.
            </div>
          ) : (
            <div style={{ overflowX: "auto !important", width: "100% !important" }}>
              <table className="table align-middle mb-0" style={{ fontSize: "0.9rem !important", width: "100% !important", minWidth: "640px !important" }}>
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
