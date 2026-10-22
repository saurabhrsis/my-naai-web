import { describe, expect, it } from 'vitest';
import {
  SHOP_AUDIENCE,
  buyerName,
  isShopGuest,
  shopAudience,
  shopCopy,
  shopStorageOwnerId,
} from './shopBuyer';

const SALON = {
  role: 'SALON',
  userId: 'salon-1',
  user: { salon: { salonName: 'Golden Scissors' }, ownerName: 'Ramesh Kumar' },
};
const CUSTOMER = {
  role: 'USER',
  userId: 'user-9',
  user: { fullName: 'Sneha Waghmare', phoneNumber: '9876543210' },
};

describe('shopAudience', () => {
  it('separates the three people who can open the shop', () => {
    expect(shopAudience(SALON)).toBe(SHOP_AUDIENCE.SALON);
    expect(shopAudience(CUSTOMER)).toBe(SHOP_AUDIENCE.CUSTOMER);
    expect(shopAudience(null)).toBe(SHOP_AUDIENCE.GUEST);
    // A session without an id is not signed in, whatever its role field says.
    expect(shopAudience({ role: 'USER', user: {} })).toBe(SHOP_AUDIENCE.GUEST);
    expect(isShopGuest(null)).toBe(true);
    expect(isShopGuest(CUSTOMER)).toBe(false);
  });

  it('names the buyer the way the order should record them', () => {
    expect(buyerName(SALON)).toBe('Golden Scissors');
    expect(buyerName(CUSTOMER)).toBe('Sneha Waghmare');
    expect(buyerName(null)).toBe('');
  });

  it('keeps a customer cart apart from a salon cart on the same device', () => {
    // Salons keep the bare account id their stored carts already use.
    expect(shopStorageOwnerId(SALON)).toBe('salon-1');
    expect(shopStorageOwnerId(CUSTOMER)).toBe('user:user-9');
    expect(shopStorageOwnerId(null)).toBe('guest');
  });
});

describe('shopCopy', () => {
  it('never tells a customer their parcel is going to "your salon"', () => {
    const salon = shopCopy(SALON);
    const customer = shopCopy(CUSTOMER);
    const guest = shopCopy(null);

    expect(salon.deliveryTarget).toBe('your salon');
    expect(customer.deliveryTarget).toBe('your address');
    // "Salon-grade" is the product promise; "your salon" would be the parcel
    // going to the wrong place.
    expect(customer.subtitle).not.toContain('your salon');
    expect(customer.subtitle).toContain('your door');
    expect(customer.checkoutSubtitle).toBe('Delivery to your address');
    expect(customer.addressFieldLabel).toBe('Delivery address');
    expect(customer.cartEmptyHint).toContain('your door');
    expect(customer.deliveryLine).toContain('your address');
    // Guests are told to sign in rather than being handed a dead cart.
    expect(guest.isGuest).toBe(true);
    expect(guest.signInToBuy).toMatch(/sign in/i);
  });
});
