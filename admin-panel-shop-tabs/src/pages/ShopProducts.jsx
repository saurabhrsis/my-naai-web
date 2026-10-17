import { useState, useEffect, useCallback } from "react";
import { shopProductAPI } from "../services/communication";
import Layout from "../components/Layout.jsx";
import SearchInput from "../components/SearchInput.jsx";
import Pagination from "../components/Pagination.jsx";
import Loader from "../components/Loader.jsx";
import DeleteConfirmModal from "../components/DeleteConfirmModal.jsx";
import ShopProductModal from "../components/ShopProductModal.jsx";
import { toast } from "react-toastify";
import { useNavigate } from "react-router-dom";
import { Package, Plus } from "lucide-react";

const GENDER_LABELS = { MALE: "Men", FEMALE: "Women", UNISEX: "Unisex" };

const money = (value) => {
  const num = Number(value);
  if (!Number.isFinite(num)) return "—";
  return `₹${num.toLocaleString("en-IN")}`;
};

const dateTime = (value) => {
  if (!value) return "—";
  const d = new Date(value);
  return d.toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
};

const ShopProducts = () => {
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [products, setProducts] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editingProduct, setEditingProduct] = useState(null);
  const [deleteModal, setDeleteModal] = useState({ show: false, target: null });
  const navigate = useNavigate();

  const fetchProducts = useCallback(async () => {
    try {
      setIsLoading(true);
      const result = await shopProductAPI.adminList({ page: currentPage, searchString: debouncedSearch });
      if (result.success) {
        setProducts(result.data?.products || []);
        setTotalPages(result.data?.pagination?.totalPages || 1);
      } else {
        toast.error(result.message || "Failed to load shop products");
      }
    } catch {
      toast.error("Failed to load shop products");
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
    fetchProducts();
  }, [fetchProducts]);

  useEffect(() => {
    const tab = localStorage.getItem("accessTab") ? JSON.parse(localStorage.getItem("accessTab")) : null;
    if (localStorage.getItem("role") === "distributor" || !(tab && tab?.includes("shopProducts"))) {
      navigate("/login", { replace: true });
    }
  }, []);

  const handleConfirmDelete = async () => {
    try {
      const result = await shopProductAPI.remove(deleteModal.target.productId);
      if (result.success) {
        toast.success("Product removed from the catalog");
        fetchProducts();
      } else {
        toast.error(result.message || "Delete failed");
      }
    } catch {
      toast.error("Delete failed");
    } finally {
      setDeleteModal({ show: false, target: null });
    }
  };

  return (
    <Layout>
      <div className="page-content d-flex flex-column p-2 p-md-3" style={{ height: "calc(100vh - 70px)", overflow: "hidden" }}>
        <div className="card shadow-sm mb-3 bg-white border-0 flex-shrink-0" style={{ borderRadius: "12px" }}>
          <div className="card-body p-3">
            <div className="row g-3 align-items-center">
              <div className="col-12 col-md-6">
                <SearchInput value={search} onChange={setSearch} placeholder="Search catalog products..." />
              </div>
              <div className="col-12 col-md-6 d-flex justify-content-md-end gap-2">
                <button className="button23" onClick={() => { setEditingProduct(null); setShowModal(true); }}>
                  <Plus size={15} className="me-1" /> Add Product
                </button>
                <Pagination currentPage={currentPage} totalPages={totalPages} onPageChange={setCurrentPage} size="sm" />
              </div>
            </div>
          </div>
        </div>

        <div className="flex-grow-1 p-3 shadow-sm border-0" style={{ overflowY: "auto", backgroundColor: "#ffffff", borderRadius: "12px" }}>
          {isLoading ? (
            <div className="text-center py-5"><Loader size="sm" /></div>
          ) : products.length === 0 ? (
            <div className="text-center py-5 text-muted">
              <Package size={40} className="mx-auto mb-2 opacity-25" />
              No catalog products yet. Add the first one so salons can buy from you.
            </div>
          ) : (
            <div className="table-responsive">
              <table className="table align-middle mb-0" style={{ fontSize: "0.9rem" }}>
                <thead>
                  <tr className="text-muted small" style={{ textTransform: "uppercase", letterSpacing: "0.4px" }}>
                    <th>Product</th>
                    <th className="text-end">Price</th>
                    <th className="text-end">MRP</th>
                    <th>Category</th>
                    <th>Gender</th>
                    <th>Status</th>
                    <th className="text-end">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {products.map((p) => {
                    const price = Number(p.price);
                    const mrp = Number(p.mrp);
                    const discount = mrp > price ? Math.round(((mrp - price) / mrp) * 100) : 0;
                    return (
                      <tr key={p.productId}>
                        <td>
                          <div className="d-flex align-items-center gap-2">
                            <div style={{ width: 40, height: 40, borderRadius: 8, background: "#f3f0ea", display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden", flexShrink: 0 }}>
                              {p.productImage ? (
                                <img src={p.productImage} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                              ) : (
                                <Package size={18} className="text-muted" />
                              )}
                            </div>
                            <div>
                              <div className="fw-semibold">{p.productName}</div>
                              <div className="text-muted small">Added {dateTime(p.createdAt)}</div>
                            </div>
                          </div>
                        </td>
                        <td className="text-end fw-semibold">{money(p.price)}</td>
                        <td className="text-end">
                          {mrp > price ? (
                            <span>
                              <span className="text-muted text-decoration-line-through small me-1">{money(p.mrp)}</span>
                              {discount > 0 && <span className="badge bg-success-subtle text-success">{discount}% off</span>}
                            </span>
                          ) : (
                            <span className="text-muted">—</span>
                          )}
                        </td>
                        <td>{p.category || "—"}</td>
                        <td>{GENDER_LABELS[p.gender] || "Any"}</td>
                        <td>
                          {p.isAvailable
                            ? <span className="badge bg-success-subtle text-success">Live</span>
                            : <span className="badge bg-secondary-subtle text-secondary">Hidden</span>}
                        </td>
                        <td className="text-end">
                          <button className="button22 me-1" onClick={() => { setEditingProduct(p); setShowModal(true); }}>Edit</button>
                          <button className="btn btn-sm btn-danger" onClick={() => { setDeleteModal({ show: true, target: p }); }}>
                            <i className="bi bi-trash"></i>
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <ShopProductModal
          showModal={showModal}
          setShowModal={setShowModal}
          initialProduct={editingProduct}
          onSuccess={() => { fetchProducts(); setShowModal(false); setEditingProduct(null); }}
        />

        <DeleteConfirmModal
          show={deleteModal.show}
          onHide={() => setDeleteModal({ show: false, target: null })}
          onConfirm={handleConfirmDelete}
        />
      </div>
    </Layout>
  );
};

export default ShopProducts;
