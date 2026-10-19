import { useState, useEffect } from "react";
import { shopSettingsAPI } from "../services/communication";
import Layout from "../components/Layout.jsx";
import Loader from "../components/Loader.jsx";
import { toast } from "react-toastify";
import { useNavigate } from "react-router-dom";
import { SlidersHorizontal, Save, RotateCcw, Truck, Percent, Banknote, IndianRupee, ShieldCheck } from "lucide-react";

// One field = one commerce rule the admin can change. `hint` is the plain-
// language explanation shown under the input so the setting does what it says.
const FIELDS = [
  {
    key: "freeDeliveryAbove",
    label: "Free Shipping Threshold",
    prefix: "₹",
    max: 1000000,
    step: 1,
    hint: "Orders whose item total (after discount) reaches this are delivered FREE. Below it, the delivery charge applies.",
    icon: Truck,
  },
  {
    key: "deliveryFee",
    label: "Delivery Charges",
    prefix: "₹",
    max: 100000,
    step: 1,
    hint: "Flat delivery charge added to every order below the free-shipping threshold.",
    icon: IndianRupee,
  },
  {
    key: "discountPercent",
    label: "Discount Percentage",
    prefix: "",
    suffix: "%",
    max: 100,
    step: 0.5,
    hint: "Percentage off the whole item total on every order (0–100).",
    icon: Percent,
  },
  {
    key: "codThreshold",
    label: "COD Threshold",
    prefix: "₹",
    max: 10000000,
    step: 1,
    hint: "Maximum item total a customer may still pay by Cash on Delivery. Set 0 to allow COD on any order.",
    icon: Banknote,
  },
  {
    key: "codCharges",
    label: "COD Charges",
    prefix: "₹",
    max: 100000,
    step: 1,
    hint: "Extra fee charged when the customer chooses Cash on Delivery.",
    icon: ShieldCheck,
  },
];

const ShopSettings = () => {
  const navigate = useNavigate();
  const [values, setValues] = useState({});
  const [isLoading, setIsLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = async () => {
    try {
      setIsLoading(true);
      const result = await shopSettingsAPI.get();
      if (result.success && result.data) {
        setValues(result.data);
      } else {
        toast.error(result.message || "Failed to load shop settings");
      }
    } catch {
      toast.error("Failed to load shop settings");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  // Gate on any shop tab (or the settings tab itself) — matches the sidebar
  // rule, and keeps the page honest for a directly-typed URL.
  useEffect(() => {
    if (localStorage.getItem("role") === "distributor") {
      navigate("/distributor", { replace: true });
      return;
    }
    const tab = JSON.parse(localStorage.getItem("accessTab") || "null");
    const hasShopAccess = ["shopProducts", "distributors", "shopOrders", "shopSettings"].some((key) => tab?.includes(key));
    if (!hasShopAccess) navigate("/login", { replace: true });
  }, [navigate]);

  const setField = (key, raw) => {
    let num = raw === "" ? "" : Number(raw);
    if (num !== "" && !Number.isFinite(num)) num = "";
    setValues((prev) => ({ ...prev, [key]: num }));
  };

  const handleSave = async () => {
    const payload = {};
    for (const f of FIELDS) {
      const raw = values?.[f.key];
      const num = raw === "" || raw === undefined || raw === null ? 0 : Number(raw);
      if (!Number.isFinite(num) || num < 0) {
        toast.error(`${f.label} must be a number of 0 or more.`);
        return;
      }
      if (f.max !== undefined && num > f.max) {
        toast.error(`${f.label} looks too large.`);
        return;
      }
      payload[f.key] = num;
    }
    try {
      setSaving(true);
      const result = await shopSettingsAPI.update(payload);
      if (result.success) {
        setValues(result.data || payload);
        toast.success("Shop settings saved — the shop now bills with these rules.");
      } else {
        toast.error(result.message || "Failed to save shop settings");
      }
    } catch {
      toast.error("Failed to save shop settings");
    } finally {
      setSaving(false);
    }
  };

  const handleReset = async () => {
    await load();
    toast.info("Reloaded the saved settings.");
  };

  return (
    <Layout>
      <div className="page-content d-flex flex-column p-2 p-md-3" style={{ height: "calc(100vh - 70px)", overflow: "hidden" }}>
        <div className="card shadow-sm bg-white border-0 flex-shrink-0" style={{ borderRadius: "12px" }}>
          <div className="card-body p-3">
            <div className="d-flex align-items-center gap-2">
              <SlidersHorizontal size={20} className="text-primary" />
              <div>
                <h5 className="mb-0 fw-semibold">Shop Settings</h5>
                <div className="text-muted small">
                  Delivery, discount and Cash-on-delivery rules for the Naai Shop. Saved instantly to every shop order.
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="flex-grow-1 p-3 shadow-sm border-0" style={{ overflowY: "auto", backgroundColor: "#ffffff", borderRadius: "12px" }}>
          {isLoading ? (
            <div className="text-center py-5"><Loader size="sm" /></div>
          ) : (
            <div className="row g-3">
              {FIELDS.map((f) => {
                const Icon = f.icon;
                return (
                  <div className="col-12 col-lg-6" key={f.key}>
                    <div className="border rounded p-3 h-100" style={{ borderColor: "#e9ecef" }}>
                      <label className="form-label d-flex align-items-center gap-2 fw-semibold mb-2">
                        <Icon size={16} className="text-primary" />
                        {f.label}
                      </label>
                      <div className="input-group">
                        {f.prefix && <span className="input-group-text">{f.prefix}</span>}
                        <input
                          type="number"
                          min="0"
                          step={f.step}
                          className="form-control form-control-lg"
                          style={f.prefix ? {} : { textAlign: "right" }}
                          value={values?.[f.key] ?? ""}
                          onChange={(e) => setField(f.key, e.target.value)}
                          placeholder="0"
                          aria-label={f.label}
                        />
                        {f.suffix && <span className="input-group-text">{f.suffix}</span>}
                      </div>
                      <div className="text-muted small mt-2">{f.hint}</div>
                    </div>
                  </div>
                );
              })}

              <div className="col-12">
                <div className="d-flex flex-wrap gap-2 pt-1">
                  <button className="button23" onClick={handleSave} disabled={saving}>
                    <Save size={15} className="me-1" /> {saving ? "Saving…" : "Save settings"}
                  </button>
                  <button className="btn btn-light border" onClick={handleReset} disabled={saving}>
                    <RotateCcw size={15} className="me-1" /> Reload
                  </button>
                </div>
                <div className="text-muted small mt-2">
                  Changes apply to new orders immediately. The web shop reads these same values, so the customer's bill always matches.
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </Layout>
  );
};

export default ShopSettings;
