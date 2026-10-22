import React from 'react';
import { buyerOf, buyerTypeParam, telHref } from './buyer';
import './shop-orders-buyer.css';

/**
 * The three small pieces the Shop Orders tab needs so that a customer order is
 * identifiable at a glance. Deliberately UI-library-free: they render a
 * <span>, a <select> and a <div>, so they drop into a Tailwind table, an MUI
 * drawer or plain CSS without a rewrite. Style them by overriding the
 * `soc-*` classes (see shop-orders-buyer.css).
 */

/** The pill beside the buyer's name — "Customer" for a USER order. */
export function BuyerBadge({ order }) {
    const buyer = buyerOf(order);
    if (!buyer.isCustomer) return null; // a salon order keeps its old look
    return (
        <span className="soc-badge" title="Placed by a customer, not a salon">
            Customer
        </span>
    );
}

/** Name (+ optional phone) as one table cell. Salon orders read as before. */
export function BuyerCell({ order, showPhone = true }) {
    const buyer = buyerOf(order);
    const href = telHref(buyer.phone);
    return (
        <span className="soc-cell">
            <span className="soc-cell-main">
                <span className="soc-name">{buyer.name}</span>
                <BuyerBadge order={order} />
            </span>
            {showPhone && buyer.phone ? (
                href
                    ? <a className="soc-phone" href={href}>{buyer.phone}</a>
                    : <span className="soc-phone">{buyer.phone}</span>
            ) : null}
        </span>
    );
}

/**
 * The drawer block that replaces the "Salon" card for a customer order.
 * Render it in place of the existing salon card, not next to it.
 */
export function BuyerSummary({ order }) {
    const buyer = buyerOf(order);
    const href = telHref(buyer.phone);
    return (
        <div className="soc-summary">
            <div className="soc-summary-head">
                <span className="soc-summary-label">{buyer.isCustomer ? 'Customer' : 'Salon'}</span>
                <BuyerBadge order={order} />
            </div>
            <p className="soc-summary-name">{buyer.name}</p>
            {buyer.phone && (
                <p className="soc-summary-line">
                    {href ? <a href={href}>{buyer.phone}</a> : buyer.phone}
                </p>
            )}
            <p className="soc-summary-note">{buyer.subtitle}</p>
        </div>
    );
}

/**
 * The "Buyer type" filter. Controlled — the parent keeps the value and sends
 * `buyerType` (or omits it for "all") to /api/shop-orders/admin-list.
 *
 *   const [buyerType, setBuyerType] = useState('');
 *   loadOrders({ page, buyerType: buyerTypeParam(buyerType) });
 */
export function BuyerTypeFilter({ value = '', onChange, label = 'Buyer type' }) {
    return (
        <label className="soc-filter">
            <span className="soc-filter-label">{label}</span>
            <select
                className="soc-select"
                value={buyerTypeParam(value)}
                onChange={(event) => onChange?.(event.target.value)}
                aria-label={label}
            >
                <option value="">All buyers</option>
                <option value="SALON">Salons</option>
                <option value="CUSTOMER">Customers</option>
            </select>
        </label>
    );
}
