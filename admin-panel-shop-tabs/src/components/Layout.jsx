import { useState, useEffect } from "react";
import { NavLink, Link, useNavigate } from "react-router-dom";
import ProfileDropdown from "./ProfileDropdown.jsx";
import ChangePasswordModal from "./ChangePasswordModal.jsx";
import { useUser } from "../contexts/UserContext.jsx";
import { ClipboardList, Store, CalendarCheck, User, Users, Package, Truck, ShoppingBag, SlidersHorizontal } from "lucide-react";
import { salonRequestAPI } from "../services/communication.jsx";
// Icons definitions (SVG)
const Icons = {
  Salon: () => (
    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"> <circle cx="6" cy="6" r="3" /><circle cx="6" cy="18" r="3" /><path d="M20 4v16" /><path d="M15.11 14.48 20 20" /><path d="m15.11 9.52 4.89-5.48" /><circle cx="18" cy="12" r="2" /></svg>
  ),
  Users: () => (
    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M22 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" /></svg>
  ),
  Scissors: () => (
    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="6" cy="6" r="3" /><circle cx="6" cy="18" r="3" /><line x1="20" y1="4" x2="8.12" y2="15.88" /><line x1="14.47" y1="14.48" x2="20" y2="20" /><line x1="8.12" y1="8.12" x2="12" y2="12" /></svg>
  ),
  Calendar: () => (
    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect width="18" height="18" x="3" y="4" rx="2" ry="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" /></svg>
  ),
  Advertisement: () => (
    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect width="20" height="14" x="2" y="3" rx="2" /><line x1="8" y1="21" x2="16" y2="21" /><line x1="12" y1="17" x2="12" y2="21" /></svg>
  ),
  Logout: () => (
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="me-2"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><polyline points="16 17 21 12 16 7" /><line x1="21" y1="12" x2="9" y2="12" /></svg>
  ),
  Customer: () => (
    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24"
      fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="7" r="4" />
      <path d="M5.5 21a6.5 6.5 0 0 1 13 0" />
    </svg>
  ),
  Notification: () => (
    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
      <path d="M13.73 21a2 2 0 0 1-3.46 0" />
    </svg>
  ),

};

const navItems = [
  { path: "/user", key: "user", label: "User Management", icon: <User size={20} /> },
  { path: "/customer", key: "customer", label: "Customer Management", icon: <Users size={20} /> },
  { path: "/salons", key: "salonManagement", label: "Salon Management", icon: <Store size={20} /> },
  { path: "/bookings", key: "bookings", label: "Booking Management", icon: <CalendarCheck size={20} /> },
  // { path: "/salonrequest", key: "salonRequest", label: "Salon Request", icon: <ClipboardList size={20} /> },
  { path: "/advertisement", key: "advertisement", label: "Advertisement", icon: <Icons.Advertisement /> },
  { path: "/notifications", key: "notifications", label: "Push Notifications", icon: <Icons.Notification /> },
  { path: "/shop-products", key: "shopProducts", label: "Shop Products", icon: <Package size={20} /> },
  { path: "/distributors", key: "distributors", label: "Distributors", icon: <Truck size={20} /> },
  { path: "/shop-orders", key: "shopOrders", label: "Shop Orders", icon: <ShoppingBag size={20} /> },
  { path: "/shop-settings", key: "shopSettings", label: "Shop Settings", icon: <SlidersHorizontal size={20} /> },
];

const Layout = ({ children }) => {
  const [open, setOpen] = useState(false);
  const [showProfileDropdown, setShowProfileDropdown] = useState(false);
  const [showLogoutModal, setShowLogoutModal] = useState(false);
  const [showChangePasswordModal, setShowChangePasswordModal] = useState(false);
  const [isLogoutLoading, setIsLogoutLoading] = useState(false);
  const [salonRequestCount, setSalonRequestCount] = useState(0);
  const navigate = useNavigate();
  const accessTab = JSON.parse(localStorage.getItem("accessTab"))
  // Shop Settings rides with any of the shop tabs (it manages the same shop)
  // or its own key — so admins provisioned before this tab existed still see
  // it without an accessTab change.
  const hasAnyShopTab = ["shopProducts", "distributors", "shopOrders"].some((key) => accessTab?.includes(key))
  const [filteredTabs, setFilterTabs] = useState(navItems.filter((navDetails) =>
    accessTab?.includes(navDetails.key) || (navDetails.key === "shopSettings" && hasAnyShopTab)
  ))
  // const [filteredTabs, setFilterTabs] = useState(accessTab.map((ele) => {
  //   const data = navItems.find((navDetails) => navDetails?.key === ele)
  //   if (data) {
  //     return data
  //   }
  // }).filter(Boolean))


  const { user, logout } = useUser();

  // Profile dropdown close handler
  const handleProfileClose = () => {
    setShowProfileDropdown(false);
  };

  // Logout handlers
  const handleLogoutClick = () => {
    setShowLogoutModal(true);
  };

  const handleLogoutConfirm = async () => {
    setIsLogoutLoading(true);
    logout();
    setShowLogoutModal(false);
    localStorage.removeItem("token")
    localStorage.removeItem("accessTab")
    localStorage.removeItem("userData")
    setTimeout(() => {
      navigate("/login", { replace: true });
      setIsLogoutLoading(false);
    }, 100);
  };

  const handleLogoutCancel = () => {
    setShowLogoutModal(false);
  };

  const handleChangePassword = () => {
    setShowChangePasswordModal(true);
  };

  // Fallback user data if no user is loaded
  const displayUser = JSON.parse(localStorage.getItem("userData")) || user || {
    name: "",
    email: "",
    role: ""
  };

  // Fetch salon request count for notifications
  const fetchSalonRequestCount = async () => {
    try {
      const token = localStorage.getItem("token");
      if (!token) return;

      const response = await salonRequestAPI.getSalonRequests({
        page: 1,
        salonNameFilter: "",
        requestDate: "",
        searchString: ""
      });

      if (response.success && response.pagination) {
        setSalonRequestCount(response.pagination.total || 0);
      }
    } catch (error) {
      console.error("Error fetching salon request count:", error);
    }
  };

  // Fetch count on mount and every 30 seconds
  // useEffect(() => {
  //   fetchSalonRequestCount();
  //   const interval = setInterval(fetchSalonRequestCount, 30000); // 30 seconds
  //   return () => clearInterval(interval);
  // }, []);


  return (
    <div className="app-shell d-flex">
      {/* Desktop Sidebar */}
      <aside className="sidebar d-none d-md-flex flex-column p-3 gap-3 position-sticky top-0 vh-100">
        <div className="d-flex flex-column align-items-center gap-2 mb-3">
          {/* <Link
            to="/"
            className="d-flex justify-content-center align-items-center text-decoration-none"
          > */}
          <img
            src="/images/my_naai_logo.png"
            alt="Salon Logo"
            className="object-fit-contain"
            style={{ maxHeight: "80px" }}
          />
          {/* </Link> */}
        </div>

        <nav className="nav flex-column gap-1 sidebarmt">
          {filteredTabs?.map((item) => (
            <NavLink
              key={item.path}
              to={item.path}
              end={item.path === "/"}
              className={({ isActive }) =>
                `nav-link d-flex align-items-center gap-2 ${isActive ? "active" : ""}`
              }
            >
              {item.icon}
              <span>{item.label}</span>
              {item.path === "/salonrequest" && salonRequestCount > 0 && (
                <span className="badge bg-danger ms-auto" style={{ fontSize: '0.7rem', padding: '0.2rem 0.4rem' }}>
                  {salonRequestCount > 99 ? '99+' : salonRequestCount}
                </span>
              )}
            </NavLink>
          ))}
        </nav>

        <div className="mt-auto d-flex flex-column gap-2">
          {/* Profile Section */}
          <div
            className="d-flex align-items-center gap-3 p-2 rounded sidebar-profile"
            style={{ cursor: 'pointer' }}
            onClick={() => setShowProfileDropdown(!showProfileDropdown)}
          >
            <div className="bg-white text-primary rounded-circle d-flex align-items-center justify-content-center"
              style={{ width: '40px', height: '40px' }}>
              <span style={{ fontSize: '1.2rem' }}>👤</span>
            </div>
            <div className="flex-grow-1">
              <div className="text-white fw-medium small">{displayUser.name}</div>
              <div className="text-white-50 small">{displayUser.role}</div>
            </div>
          </div>

          {/* Logout Button WITH MODAL */}
          <div className="p-3 border-top ">
            <button
              className="logoutbutton btn-sm w-100"
              onClick={handleLogoutClick}
            >
              <i className="bi bi-box-arrow-right me-2"></i>
              Logout
            </button>
          </div>
        </div>
      </aside>

      {/* LOGOUT CONFIRMATION MODAL */}
      {showLogoutModal && (
        <div
          className="modal fade show d-block position-fixed top-0 start-0 w-100 h-100"
          style={{ backgroundColor: 'rgba(0,0,0,0.5)', zIndex: 1060 }}
        >
          <div className="modal-dialog modal-dialog-centered">
            <div className="modal-content shadow-lg">
              <div className="modal-header border-0 pb-0">
                <h5 className="modal-title">Confirm Logout</h5>
                <button
                  type="button"
                  className="btn-close"
                  onClick={handleLogoutCancel}
                />
              </div>
              <div className="modal-body py-4 text-center">
                <i className="bi bi-exclamation-triangle-fill text-warning mb-3" style={{ fontSize: '3rem' }}></i>
                <p className="mb-0 fs-5 fw-medium">Are you sure you want to logout?</p>
              </div>
              <div className="modal-footer border-0 pt-0">
                <button
                  type="button"
                  className="btn btn-outline-secondary px-4"
                  onClick={handleLogoutCancel}
                >
                  No, Stay
                </button>
                <button
                  type="button"
                  className="btn btn-danger px-4"
                  onClick={handleLogoutConfirm}
                  disabled={isLogoutLoading}
                >
                  {isLogoutLoading ? (
                    <>
                      <span className="spinner-border spinner-border-sm me-2" role="status" aria-hidden="true"></span>
                      Logging out...
                    </>
                  ) : (
                    "Yes, Logout"
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Change Password Modal */}
      <ChangePasswordModal
        show={showChangePasswordModal}
        onClose={() => setShowChangePasswordModal(false)}
      />

      {/* Desktop Profile Dropdown - positioned outside sidebar */}
      <div className="d-none d-md-block">
        {showProfileDropdown && (
          <ProfileDropdown
            isOpen={showProfileDropdown}
            onClose={() => setShowProfileDropdown(false)}
            onChangePassword={handleChangePassword}
            position="desktop"
          />
        )}
      </div>

      {/* Mobile + Desktop Main Content */}
      <div className="flex-grow-1 d-flex flex-column">
        {/* Mobile Topbar */}
        <div className="d-md-none position-relative">
          <header className="navbar bg-white shadow-sm sticky-top px-2 mobile-header-fixed">
            <div className="d-flex align-items-center justify-content-between w-100">
              <div className="d-flex align-items-center gap-2 min-w-0 flex-grow-1">
                {/* <Link
                  to="/"
                  className="navbar-brand fw-semibold text-truncate m-0 d-flex align-items-center gap-2"
                  style={{ maxWidth: "150px", fontSize: '1rem' }}
                > */}
                <img
                  src="/images/my_naai_logo.png"
                  alt="Salon Logo"
                  className="object-fit-contain"
                  style={{ maxHeight: "35px" }}
                />
                {/* </Link> */}
              </div>

              <button
                className="btn btn-outline-secondary btn-sm flex-shrink-0 d-flex align-items-center justify-content-center profile-btn"
                onClick={() => {
                  const newState = !showProfileDropdown;
                  setShowProfileDropdown(newState);
                }}
                style={{
                  width: '36px',
                  height: '36px',
                  borderRadius: '50%',
                  padding: '0'
                }}
                title="Profile"
              >
                <span style={{ fontSize: '1.2rem' }}>👤</span>
              </button>
            </div>

          </header>

          {/* Profile Dropdown */}
          <ProfileDropdown
            isOpen={showProfileDropdown}
            onClose={() => setShowProfileDropdown(false)}
            onChangePassword={handleChangePassword}
            position="mobile"
          />
        </div>

        {/* Main Content Area */}
        <main className="flex-grow-1">
          <div className="container-fluid">{children}</div>
        </main>

        {/* Mobile Bottom Navigation (now uses filteredTabs for access control) */}
        <div className="d-md-none">
          <nav className="navbar fixed-bottom bg-white border-top shadow-lg mobile-bottom-nav">
            <div className="container-fluid d-flex justify-content-around align-items-center px-2">
              {filteredTabs?.map((item) => (
                <NavLink
                  key={item.path}
                  to={item.path}
                  end={item.path === "/"}
                  className={({ isActive }) =>
                    `nav-link text-center p-2 mobile-nav-item ${isActive ? "active" : ""}`
                  }
                >
                  <div className={`d-flex flex-column align-items-center${item.path === "/salonrequest" ? " position-relative" : ""}`}>
                    {item.icon}
                    <small className="mt-1 nav-text">{item.label.replace(" Management", "").replace("Customer", "Customer").replace("User", "Users").replace("Salon Request", "Salon Request").replace("Advertisement", "Ads")}</small>
                    {item.path === "/salonrequest" && salonRequestCount > 0 && (
                      <span className="badge bg-danger position-absolute top-0 end-0 translate-middle" style={{ fontSize: '0.6rem', padding: '0.15rem 0.25rem' }}>
                        {salonRequestCount > 99 ? '99+' : salonRequestCount}
                      </span>
                    )}
                  </div>
                </NavLink>
              ))}
            </div>
          </nav>
        </div>
      </div>
    </div>
  );
};

export default Layout;
