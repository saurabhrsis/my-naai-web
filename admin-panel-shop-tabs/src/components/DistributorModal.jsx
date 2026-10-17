import { useState, useEffect } from "react";
import { Modal, Form, Button } from "react-bootstrap";
import { distributorAPI } from "../services/communication";
import { toast } from "react-toastify";

const DistributorModal = ({ showModal, setShowModal, initialDistributor = null, onSuccess }) => {
  const isEdit = Boolean(initialDistributor);
  const [isLoading, setIsLoading] = useState(false);
  const [formData, setFormData] = useState({
    name: "",
    phone: "",
    email: "",
    area: "",
    deliveryCapability: "",
    address: "",
    password: ""
  });

  useEffect(() => {
    if (showModal) {
      if (initialDistributor) {
        setFormData({
          name: initialDistributor.name || "",
          phone: initialDistributor.phone || "",
          email: initialDistributor.email || "",
          area: initialDistributor.area || "",
          deliveryCapability: initialDistributor.deliveryCapability || "",
          address: initialDistributor.address || "",
          password: ""
        });
      } else {
        setFormData({ name: "", phone: "", email: "", area: "", deliveryCapability: "", address: "", password: "" });
      }
    }
  }, [showModal, initialDistributor]);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  const handleModalClose = () => setShowModal(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    const payload = {
      name: formData.name.trim(),
      phone: formData.phone.trim(),
      email: formData.email.trim() || null,
      area: formData.area.trim() || null,
      deliveryCapability: formData.deliveryCapability.trim() || null,
      address: formData.address.trim() || null
    };
    if (!payload.name) { toast.error("Distributor name is required"); return; }
    if (!payload.phone) { toast.error("Phone number is required (distributors log in with it)"); return; }

    if (isEdit) {
      // Send password only when the admin typed a new one; '' clears the stored password.
      payload.password = formData.password;
    } else {
      if (!formData.password) { toast.error("Set a login password (min 6 characters)"); return; }
      if (formData.password.length < 6) { toast.error("Password must be at least 6 characters"); return; }
      payload.password = formData.password;
    }

    setIsLoading(true);
    try {
      const result = isEdit
        ? await distributorAPI.update({ distributorId: initialDistributor.distributorId, ...payload })
        : await distributorAPI.create(payload);
      if (result.success) {
        toast.success(isEdit ? "Distributor updated" : "Distributor added");
        onSuccess?.();
      } else {
        toast.error(result.message || "Failed to save distributor");
      }
    } catch {
      toast.error("Failed to save distributor");
    } finally {
      setIsLoading(false);
    }
  };

  if (!showModal) return null;

  return (
    <Modal show={showModal} onHide={handleModalClose} centered size="lg">
      <Modal.Header closeButton>
        <Modal.Title className="fw-bold">
          {isEdit ? "Edit Distributor" : "Add Distributor"}
        </Modal.Title>
      </Modal.Header>
      <Form onSubmit={handleSubmit}>
        <Modal.Body>
          <div className="row g-3">
            <div className="col-md-6">
              <Form.Label className="fw-semibold small">Name *</Form.Label>
              <Form.Control type="text" name="name" value={formData.name} onChange={handleChange} placeholder="e.g. Ravi Gupta" required />
            </div>
            <div className="col-md-6">
              <Form.Label className="fw-semibold small">Phone *</Form.Label>
              <Form.Control type="tel" name="phone" value={formData.phone} onChange={handleChange} placeholder="10-digit mobile number" required />
            </div>
            <div className="col-md-6">
              <Form.Label className="fw-semibold small">Email (used as an alternate login ID)</Form.Label>
              <Form.Control type="email" name="email" value={formData.email} onChange={handleChange} placeholder="optional" />
            </div>
            <div className="col-md-6">
              <Form.Label className="fw-semibold small">Area / City</Form.Label>
              <Form.Control type="text" name="area" value={formData.area} onChange={handleChange} placeholder="e.g. Nagpur, Maharashtra" />
            </div>
            <div className="col-md-6">
              <Form.Label className="fw-semibold small">Delivery Capability</Form.Label>
              <Form.Control type="text" name="deliveryCapability" value={formData.deliveryCapability} onChange={handleChange} placeholder="e.g. Same-day within 20km, 2-wheelers x2" />
            </div>
            <div className="col-md-6">
              <Form.Label className="fw-semibold small">
                {isEdit ? "New Password (leave blank to keep the old one)" : "Login Password *"}
              </Form.Label>
              <Form.Control
                type="password"
                name="password"
                value={formData.password}
                onChange={handleChange}
                placeholder={isEdit ? "min 6 characters" : "min 6 characters"}
                autoComplete="new-password"
              />
            </div>
            <div className="col-12">
              <Form.Label className="fw-semibold small">Address</Form.Label>
              <Form.Control as="textarea" rows={2} name="address" value={formData.address} onChange={handleChange} placeholder="Warehouse / pickup address" />
            </div>
            <div className="col-12">
              <div className="alert alert-light border small mb-0">
                This distributor will log in to the Distributor Portal with their <strong>phone or email</strong> and this
                password. Their portal only shows orders that you assign to them.
              </div>
            </div>
          </div>
        </Modal.Body>
        <Modal.Footer>
          <Button variant="outline-secondary" onClick={handleModalClose} disabled={isLoading}>Cancel</Button>
          <Button variant="success" type="submit" disabled={isLoading}>
            {isLoading ? "Saving..." : isEdit ? "Update Distributor" : "Add Distributor"}
          </Button>
        </Modal.Footer>
      </Form>
    </Modal>
  );
};

export default DistributorModal;
