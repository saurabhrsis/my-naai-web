import { useState, useEffect } from "react";
import { Modal, Form, Button } from "react-bootstrap";
import { shopProductAPI } from "../services/communication";
import { toast } from "react-toastify";

const ShopProductModal = ({ showModal, setShowModal, initialProduct = null, onSuccess }) => {
  const isEdit = Boolean(initialProduct);
  const [isLoading, setIsLoading] = useState(false);
  const [formData, setFormData] = useState({
    productName: "",
    price: "",
    mrp: "",
    productImage: "",
    category: "",
    gender: "",
    rating: "",
    isAvailable: true,
    description: ""
  });

  useEffect(() => {
    if (showModal) {
      if (initialProduct) {
        setFormData({
          productName: initialProduct.productName || "",
          price: initialProduct.price != null ? String(initialProduct.price) : "",
          mrp: initialProduct.mrp != null ? String(initialProduct.mrp) : "",
          productImage: initialProduct.productImage || "",
          category: initialProduct.category || "",
          gender: initialProduct.gender || "",
          rating: initialProduct.rating != null ? String(initialProduct.rating) : "",
          isAvailable: Boolean(initialProduct.isAvailable),
          description: initialProduct.description || ""
        });
      } else {
        setFormData({
          productName: "", price: "", mrp: "", productImage: "",
          category: "", gender: "", rating: "", isAvailable: true, description: ""
        });
      }
    }
  }, [showModal, initialProduct]);

  const handleChange = (e) => {
    const { name, value, type, checked } = e.target;
    setFormData((prev) => ({ ...prev, [name]: type === "checkbox" ? checked : value }));
  };

  const handleModalClose = () => setShowModal(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!formData.productName.trim()) {
      toast.error("Product name is required");
      return;
    }
    const price = Number(formData.price);
    const mrp = formData.mrp ? Number(formData.mrp) : null;
    if (!Number.isFinite(price) || price <= 0) {
      toast.error("Enter a valid selling price");
      return;
    }
    if (mrp != null && (!Number.isFinite(mrp) || mrp < price)) {
      toast.error("MRP must be greater than or equal to the selling price");
      return;
    }
    const rating = formData.rating !== "" ? Number(formData.rating) : 0;
    if (rating < 0 || rating > 5) {
      toast.error("Rating must be between 0 and 5");
      return;
    }

    const payload = {
      productName: formData.productName.trim(),
      price,
      mrp,
      productImage: formData.productImage.trim() || null,
      category: formData.category.trim() || null,
      gender: formData.gender,
      rating,
      isAvailable: formData.isAvailable,
      description: formData.description.trim() || null
    };

    setIsLoading(true);
    try {
      const result = isEdit
        ? await shopProductAPI.update({ productId: initialProduct.productId, ...payload })
        : await shopProductAPI.create(payload);
      if (result.success) {
        toast.success(isEdit ? "Product updated" : "Product added to catalog");
        onSuccess?.();
      } else {
        toast.error(result.message || "Failed to save product");
      }
    } catch {
      toast.error("Failed to save product");
    } finally {
      setIsLoading(false);
    }
  };

  if (!showModal) return null;

  return (
    <Modal show={showModal} onHide={handleModalClose} centered size="lg">
      <Modal.Header closeButton>
        <Modal.Title className="fw-bold">
          {isEdit ? "Edit Catalog Product" : "Add Catalog Product"}
        </Modal.Title>
      </Modal.Header>
      <Form onSubmit={handleSubmit}>
        <Modal.Body>
          <div className="row g-3">
            <div className="col-12">
              <Form.Label className="fw-semibold small">Product Name *</Form.Label>
              <Form.Control
                type="text"
                name="productName"
                value={formData.productName}
                onChange={handleChange}
                placeholder="e.g. Herbal Hair Oil 200ml"
                required
              />
            </div>
            <div className="col-6">
              <Form.Label className="fw-semibold small">Selling Price (₹) *</Form.Label>
              <Form.Control type="number" min="1" step="0.01" name="price" value={formData.price} onChange={handleChange} placeholder="899" required />
            </div>
            <div className="col-6">
              <Form.Label className="fw-semibold small">MRP (₹)</Form.Label>
              <Form.Control type="number" min="1" step="0.01" name="mrp" value={formData.mrp} onChange={handleChange} placeholder="1099 (optional, enables discount badge)" />
            </div>
            <div className="col-12">
              <Form.Label className="fw-semibold small">Product Image URL</Form.Label>
              <Form.Control type="url" name="productImage" value={formData.productImage} onChange={handleChange} placeholder="https://... (blank = no image)" />
            </div>
            <div className="col-md-4 col-6">
              <Form.Label className="fw-semibold small">Category</Form.Label>
              <Form.Control type="text" name="category" value={formData.category} onChange={handleChange} placeholder="Hair Care" />
            </div>
            <div className="col-md-4 col-6">
              <Form.Label className="fw-semibold small">Gender</Form.Label>
              <Form.Select name="gender" value={formData.gender} onChange={handleChange}>
                <option value="">Any</option>
                <option value="MALE">Men</option>
                <option value="FEMALE">Women</option>
                <option value="UNISEX">Unisex</option>
              </Form.Select>
            </div>
            <div className="col-md-4 col-6">
              <Form.Label className="fw-semibold small">Rating (0–5)</Form.Label>
              <Form.Control type="number" min="0" max="5" step="0.1" name="rating" value={formData.rating} onChange={handleChange} placeholder="4.5" />
            </div>
            <div className="col-12">
              <Form.Label className="fw-semibold small">Description</Form.Label>
              <Form.Control as="textarea" rows={3} name="description" value={formData.description} onChange={handleChange} placeholder="What the salon owners should know about this product..." />
            </div>
            <div className="col-12">
              <Form.Check
                type="switch"
                id="isAvailable"
                label="Available in the app catalog (unhide to remove it from sale)"
                name="isAvailable"
                checked={formData.isAvailable}
                onChange={handleChange}
              />
            </div>
          </div>
        </Modal.Body>
        <Modal.Footer>
          <Button variant="outline-secondary" onClick={handleModalClose} disabled={isLoading}>Cancel</Button>
          <Button variant="success" type="submit" disabled={isLoading}>
            {isLoading ? "Saving..." : isEdit ? "Update Product" : "Add Product"}
          </Button>
        </Modal.Footer>
      </Form>
    </Modal>
  );
};

export default ShopProductModal;
