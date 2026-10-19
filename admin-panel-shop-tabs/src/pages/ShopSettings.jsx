import { useState, useEffect } from "react";
import { shopSettingsAPI } from "../services/communication";
import Layout from "../components/Layout.jsx";
import Loader from "../components/Loader.jsx";
import { toast } from "react-toastify";
import { useNavigate } from "react-router-dom";
import { SlidersHorizontal, Save, RotateCcw, Truck, Percent, Banknote, IndianRupee, ShieldCheck, Calculator } from "lucide-react";

/*
  DESIGN NOTE — why every structural style carries !important:
  The panel's deployed CSS (its local index.css working copy) contains
  rules that override ordinary utility classes AND ordinary inline styles on
  nested divs and inputs. An inline style declared with !important sits above
  every author-stylesheet rule (including their !important ones), so this page
  sets every layout property that matters (display / width / flex / gap)
  inline with !important. No class is relied on for width or display.
*/

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
    tint: "#e8f0fe",
    tintColor: "#1a56db",
  },
  {
    key: "deliveryFee",
    label: "Delivery Charges",
    prefix: "₹",
    max: 100000,
    step: 1,
    hint: "Flat delivery charge added to every order below the free-shipping threshold.",
    icon: IndianRupee,
    tint: "#eef4f0",
    tintColor: "#1e7e34",
  },
  {
    key: "discountPercent",
    label: "Discount Percentage",
    suffix: "%",
    max: 100,
    step: 0.5,
    hint: "Percentage off the whole item total on every order (0–100).",
    icon: Percent,
    tint: "#fdf2e9",
    tintColor: "#c2571b",
  },
  {
    key: "codThreshold",
    label: "COD Threshold",
    prefix: "₹",
    max: 10000000,
    step: 1,
    hint: "Maximum item total a customer may still pay by Cash on Delivery. Set 0 to allow COD on any order.",
    icon: Banknote,
    tint: "#f3e8ff",
    tintColor: "#7e22ce",
  },
  {
    key: "codCharges",
    label: "COD Charges",
    prefix: "₹",
    max: 100000,
    step: 1,
    hint: "Extra fee charged when the customer chooses Cash on Delivery.",
    icon: ShieldCheck,
    tint: "#e6f7f7",
    tintColor: "#0f766e",
  },
];

const inr = (n) => `₹${Number(n || 0).toLocaleString("en-IN")}`;

// Mirror of the backend's bill computation, for the live preview only.
const previewBill = (v, exampleTotal = 600) => {
  const itemTotal = exampleTotal;
  const discount = Math.round(itemTotal * (Number(v?.discountPercent) || 0) / 100);
  const subtotal = itemTotal - discount;
  const freeAbove = Number(v?.freeDeliveryAbove) || 0;
  const deliveryFee = freeAbove > 0 && subtotal >= freeAbove ? 0 : Number(v?.deliveryFee) || 0;
  const codThreshold = Number(v?.codThreshold) || 0;
  const codFee = Number(v?.codCharges) || 0;
  const codAllowed = codThreshold === 0 || itemTotal <= codThreshold;
  const onlineTotal = subtotal + deliveryFee;
  const codTotal = onlineTotal + (codAllowed ? codFee : 0);
  return { itemTotal, discount, subtotal, deliveryFee, freeAbove, codThreshold, codFee, codAllowed, onlineTotal, codTotal };
};

// Structural helpers — every declaration !important on purpose (see note above).
const box = (extra) => ({ boxSizing: "border-box !important", ...extra });
const rowFlex = (extra) => box({ display: "flex !important", ...extra });

const inputStyle = box({
  flex: "1 1 0% !important",
  minWidth: "0 !important",
  width: "100% !important",
  height: "46px !important",
  padding: "0 14px !important",
  border: "1px solid #d9e0da !important",
  borderRadius: "10px !important",
  fontSize: "1rem !important",
  background: "#ffffff !important",
  color: "#0f1c1a !important",
  fontFamily: "inherit !important",
  display: "block !important",
});

const unitChip = box({
  display: "inline-flex !important",
  alignItems: "center !important",
  justifyContent: "center !important",
  padding: "0 14px !important",
  background: "#f4f6f4 !important",
  border: "1px solid #d9e0da !important",
  borderRadius: "10px !important",
  fontWeight: "600 !important",
  color: "#495057 !important",
  fontSize: "0.95rem !important",
  flex: "0 0 auto !important",
  height: "46px !important",
  width: "auto !important",
});

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
      navigate("/login", { replace: true });
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

  const bill = previewBill(values);
  const EXAMPLE = 600;

  return (
    <Layout>
      <style>{`
        .mns-set-input:focus { outline: none !important; border-color: #1e7e34 !important; box-shadow: 0 0 0 3px rgba(30,126,52,0.15) !important; }
        .mns-set-btn:hover:not(:disabled) { filter: brightness(0.97); }
        .mns-set-btn:active:not(:disabled) { transform: translateY(1px); }
      `}</style>
      <div
        className="page-content"
        style={rowFlex({
          flexDirection: "column !important",
          gap: "12px !important",
          padding: "10px 14px !important",
          height: "calc(100vh - 70px) !important",
          overflow: "hidden !important",
          width: "100% !important",
          alignItems: "stretch !important",
        })}
      >
        {/* Header */}
        <div
          style={rowFlex({
            background: "#ffffff !important",
            border: "1px solid #e3e8e3 !important",
            borderRadius: "12px !important",
            padding: "14px 18px !important",
            alignItems: "center !important",
            gap: "12px !important",
            flex: "0 0 auto !important",
            boxShadow: "0 1px 3px rgba(15,28,26,0.06) !important",
            width: "100% !important",
          })}
        >
          <div
            style={box({
              width: "38px !important",
              height: "38px !important",
              borderRadius: "10px !important",
              background: "#eef4f0 !important",
              display: "flex !important",
              alignItems: "center !important",
              justifyContent: "center !important",
              flex: "0 0 auto !important",
            })}
          >
            <SlidersHorizontal size={19} color="#1e7e34" />
          </div>
          <div style={box({ minWidth: "0 !important", width: "100% !important" })}>
            <div style={{ fontWeight: "600 !important", fontSize: "1rem !important", lineHeight: "1.2 !important", width: "100% !important" }}>
              Shop Settings
            </div>
            <div style={{ color: "#6b7570 !important", fontSize: "0.8rem !important", marginTop: "2px !important", width: "100% !important" }}>
              Delivery, discount and Cash-on-delivery rules for the Naai Shop — saved instantly to every shop order.
            </div>
          </div>
        </div>

        {/* Scrollable body */}
        <div
          style={box({
            flex: "1 1 auto !important",
            minHeight: "0 !important",
            overflowY: "auto !important",
            background: "#ffffff !important",
            border: "1px solid #e3e8e3 !important",
            borderRadius: "12px !important",
            padding: "18px !important",
            width: "100% !important",
          })}
        >
          {isLoading ? (
            <div style={{ textAlign: "center !important", padding: "60px 0 !important", width: "100% !important" }}>
              <Loader size="sm" />
            </div>
          ) : (
            <div style={rowFlex({ flexDirection: "column !important", gap: "16px !important", width: "100% !important" })}>
              {/* Fields */}
              <div style={rowFlex({ flexWrap: "wrap !important", gap: "14px !important", width: "100% !important" })}>
                {FIELDS.map((f) => {
                  const Icon = f.icon;
                  return (
                    <div key={f.key} style={box({ flex: "1 1 320px !important", minWidth: "280px !important", width: "100% !important" })}>
                      <div
                        style={box({
                          width: "100% !important",
                          border: "1px solid #e3e8e3 !important",
                          borderRadius: "12px !important",
                          padding: "16px !important",
                          background: "#ffffff !important",
                          height: "100% !important",
                        })}
                      >
                        {/* Label row */}
                        <div style={rowFlex({ alignItems: "center !important", gap: "10px !important", marginBottom: "12px !important", width: "100% !important" })}>
                          <div
                            style={box({
                              width: "30px !important",
                              height: "30px !important",
                              borderRadius: "8px !important",
                              background: `${f.tint} !important`,
                              color: `${f.tintColor} !important`,
                              display: "flex !important",
                              alignItems: "center !important",
                              justifyContent: "center !important",
                              flex: "0 0 auto !important",
                            })}
                          >
                            <Icon size={16} />
                          </div>
                          <span style={{ fontWeight: "600 !important", fontSize: "0.92rem !important", minWidth: "0 !important", width: "100% !important" }}>
                            {f.label}
                          </span>
                        </div>

                        {/* Input row */}
                        <div style={rowFlex({ alignItems: "stretch !important", gap: "8px !important", width: "100% !important" })}>
                          {f.prefix && <span style={unitChip}>{f.prefix}</span>}
                          <input
                            className="mns-set-input"
                            type="number"
                            min="0"
                            step={f.step}
                            style={inputStyle}
                            value={values?.[f.key] ?? ""}
                            onChange={(e) => setField(f.key, e.target.value)}
                            placeholder="0"
                            aria-label={f.label}
                          />
                          {f.suffix && <span style={unitChip}>{f.suffix}</span>}
                        </div>

                        {/* Hint */}
                        <div
                          style={{
                            color: "#6b7570 !important",
                            fontSize: "0.78rem !important",
                            marginTop: "10px !important",
                            lineHeight: "1.45 !important",
                            width: "100% !important",
                          }}
                        >
                          {f.hint}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Live preview — same math the backend bills with */}
              <div
                style={box({
                  width: "100% !important",
                  border: "1px solid #cfe3d6 !important",
                  background: "#f6faf7 !important",
                  borderRadius: "12px !important",
                  padding: "16px !important",
                })}
              >
                <div style={rowFlex({ alignItems: "center !important", gap: "8px !important", marginBottom: "12px !important", width: "100% !important" })}>
                  <Calculator size={15} color="#1e7e34" style={{ flex: "0 0 auto !important" }} />
                  <span style={{ fontWeight: "600 !important", fontSize: "0.85rem !important", color: "#17321f !important", width: "100% !important" }}>
                    Live preview — how an order of {inr(EXAMPLE)} bills right now
                  </span>
                </div>
                <div style={rowFlex({ flexWrap: "wrap !important", gap: "10px 28px !important", width: "100% !important" })}>
                  <div style={{ fontSize: "0.85rem !important", minWidth: "0 !important", width: "100% !important" }}>
                    <span style={{ color: "#6b7570 !important" }}>Items </span>
                    <span style={{ fontWeight: "600 !important" }}>{inr(bill.itemTotal)}</span>
                  </div>
                  {bill.discount > 0 && (
                    <div style={{ fontSize: "0.85rem !important", minWidth: "0 !important", width: "100% !important" }}>
                      <span style={{ color: "#6b7570 !important" }}>Discount ({Number(values?.discountPercent) || 0}%) </span>
                      <span style={{ fontWeight: "600 !important", color: "#1e7e34 !important" }}>− {inr(bill.discount)}</span>
                    </div>
                  )}
                  <div style={{ fontSize: "0.85rem !important", minWidth: "0 !important", width: "100% !important" }}>
                    <span style={{ color: "#6b7570 !important" }}>Delivery </span>
                    <span style={{ fontWeight: "600 !important", color: bill.deliveryFee === 0 ? "#1e7e34 !important" : "#0f1c1a !important" }}>
                      {bill.deliveryFee === 0 ? "FREE" : inr(bill.deliveryFee)}
                    </span>
                  </div>
                  <div style={{ fontSize: "0.85rem !important", minWidth: "0 !important", width: "100% !important" }}>
                    <span style={{ color: "#6b7570 !important" }}>COD </span>
                    <span style={{ fontWeight: "600 !important", color: bill.codAllowed ? "#1e7e34 !important" : "#c0392b !important" }}>
                      {bill.codAllowed ? (bill.codFee > 0 ? `allowed, + ${inr(bill.codFee)}` : "allowed, no extra charge") : `only online (above ${inr(bill.codThreshold)})`}
                    </span>
                  </div>
                  <div style={{ fontSize: "0.85rem !important", minWidth: "0 !important", width: "100% !important", fontWeight: "700 !important" }}>
                    <span style={{ color: "#6b7570 !important", fontWeight: "400 !important" }}>Online total </span>
                    <span>{inr(bill.onlineTotal)}</span>
                    {bill.codAllowed && bill.codFee > 0 && (
                      <span style={{ fontWeight: "400 !important", color: "#6b7570 !important" }}> · COD total {inr(bill.codTotal)}</span>
                    )}
                  </div>
                </div>
              </div>

              {/* Save bar */}
              <div style={rowFlex({ flexWrap: "wrap !important", alignItems: "center !important", gap: "10px !important", width: "100% !important" })}>
                <button
                  className="mns-set-btn"
                  onClick={handleSave}
                  disabled={saving}
                  style={box({
                    display: "inline-flex !important",
                    alignItems: "center !important",
                    justifyContent: "center !important",
                    gap: "8px !important",
                    padding: "11px 22px !important",
                    borderRadius: "10px !important",
                    border: "1px solid #17652c !important",
                    background: "#1e7e34 !important",
                    color: "#ffffff !important",
                    fontSize: "0.9rem !important",
                    fontWeight: "600 !important",
                    cursor: saving ? "default !important" : "pointer !important",
                    opacity: saving ? "0.7 !important" : "1 !important",
                  })}
                >
                  <Save size={15} /> {saving ? "Saving…" : "Save settings"}
                </button>
                <button
                  className="mns-set-btn"
                  onClick={handleReset}
                  disabled={saving}
                  style={box({
                    display: "inline-flex !important",
                    alignItems: "center !important",
                    justifyContent: "center !important",
                    gap: "8px !important",
                    padding: "11px 18px !important",
                    borderRadius: "10px !important",
                    border: "1px solid #d9e0da !important",
                    background: "#ffffff !important",
                    color: "#3d4a42 !important",
                    fontSize: "0.9rem !important",
                    fontWeight: "500 !important",
                    cursor: "pointer !important",
                  })}
                >
                  <RotateCcw size={14} /> Reload
                </button>
                <span style={{ color: "#6b7570 !important", fontSize: "0.78rem !important", flexBasis: "100% !important", marginTop: "2px !important", width: "100% !important" }}>
                  Changes apply to new orders immediately. The web shop reads these same values, so the customer's bill always matches.
                </span>
              </div>
            </div>
          )}
        </div>
      </div>
    </Layout>
  );
};

export default ShopSettings;
