import React from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  EditSalonServicesScreen,
  buildServicesPayload,
  serviceRowFrom,
  serviceRowsFromProfile,
  serviceNameSuggestions,
  validateServiceRow,
  validateServiceRows,
} from './EditSalonServices';
import { ConfirmProvider } from './ConfirmDialog';

const { salonProfile, salonServicesSave } = vi.hoisted(() => ({
  salonProfile: vi.fn(),
  salonServicesSave: vi.fn(),
}));

vi.mock('../lib/api', async () => {
  const actual = await vi.importActual('../lib/api');
  return { ...actual, api: { ...actual.api, salonProfile, salonServicesSave } };
});

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const SESSION = { userId: 'salon-1', role: 'SALON', user: { salonName: 'Glow Studio' } };

const MENU = {
  salonName: 'Glow Studio',
  genderType: 'male',
  services: [
    { serviceId: 'svc-1', serviceName: 'Haircut', price: '250.00', durationMinutes: 30, description: 'Salon service' },
    { serviceId: 'svc-2', serviceName: 'Beard trim', price: '150.00', durationMinutes: 20, description: '' },
  ],
};

const navigate = vi.fn();
const notify = vi.fn();

function render(props = {}) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  const tree = (
    <ConfirmProvider>
      <EditSalonServicesScreen session={SESSION} navigate={navigate} notify={notify} {...props} />
    </ConfirmProvider>
  );
  return { container, root, mount: () => root.render(tree) };
}

const flush = async () => { await act(async () => { await Promise.resolve(); }); };

const rowInputs = container => Array.from(container.querySelectorAll('[data-service-row]'));
const named = (container, name) => container.querySelector(`[aria-label="${name}"]`);
const buttonByText = (container, text) => Array.from(container.querySelectorAll('button')).find(node => node.textContent.trim().startsWith(text));

// Setting a controlled input's value the way a person typing does: the native
// setter, then the event React listens for.
function type(node, value) {
  const setter = Object.getOwnPropertyDescriptor(node instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype, 'value').set;
  setter.call(node, value);
  node.dispatchEvent(new Event(node instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }));
}

beforeEach(() => {
  vi.clearAllMocks();
  salonProfile.mockResolvedValue({ status: 'SUCCESS', data: MENU });
  salonServicesSave.mockImplementation(async payload => ({
    status: 'SUCCESS',
    data: {
      services: payload.services.map((service, index) => ({
        serviceId: service.serviceId || `new-${index}`,
        serviceName: service.serviceName,
        price: String(service.price),
        durationMinutes: service.durationMinutes,
        description: service.description || '',
      })),
    },
  }));
});

afterEach(() => { document.body.innerHTML = ''; });

describe('the menu editor opens every service at once', () => {
  it('paints all of the salon’s services as inputs, with no tap needed to open one', async () => {
    const { container, mount } = render();
    await act(async () => { mount(); });
    await flush();

    const rows = rowInputs(container);
    expect(rows).toHaveLength(2);
    // The point of the screen: the fields are already there.
    expect(rows[0].querySelector('input').value).toBe('Haircut');
    expect(rows[0].querySelector('input[type="number"]').value).toBe('250');
    expect(rows[0].querySelector('select').value).toBe('30');
    expect(rows[1].querySelector('input').value).toBe('Beard trim');
    // …and no profile fields are on it at all.
    expect(container.textContent).not.toContain('Salon name');
    expect(container.textContent).not.toContain('Opening Time');
  });

  it('saves only the services, in order, and nothing else about the salon', async () => {
    const { container, mount } = render();
    await act(async () => { mount(); });
    await flush();

    const [firstRow] = rowInputs(container);
    await act(async () => { type(firstRow.querySelector('input[type="number"]'), '300'); });
    await act(async () => { buttonByText(container, 'Save services').click(); });
    await flush();

    expect(salonServicesSave).toHaveBeenCalledTimes(1);
    const payload = salonServicesSave.mock.calls[0][0];
    expect(Object.keys(payload).sort()).toEqual(['removedServiceIds', 'services']);
    expect(payload.services).toEqual([
      { serviceId: 'svc-1', serviceName: 'Haircut', price: 300, durationMinutes: 30, description: 'Salon service', displayOrder: 0 },
      { serviceId: 'svc-2', serviceName: 'Beard trim', price: 150, durationMinutes: 20, displayOrder: 1 },
    ]);
    expect(payload.removedServiceIds).toEqual([]);
    // No salon id: the server takes it from the partner's token.
    expect(JSON.stringify(payload)).not.toContain('salon-1');
    expect(notify).toHaveBeenCalledWith('success', expect.stringContaining('2 services'));
  });

  it('adds a service and sends it without a serviceId, so the server creates it', async () => {
    const { container, mount } = render();
    await act(async () => { mount(); });
    await flush();

    await act(async () => { buttonByText(container, 'Add').click(); });
    await flush();
    const rows = rowInputs(container);
    expect(rows).toHaveLength(3);

    const added = rows[2];
    await act(async () => { type(added.querySelector('input'), 'Hair spa'); });
    await act(async () => { type(added.querySelector('input[type="number"]'), '900'); });
    await act(async () => { type(added.querySelector('select'), '45'); });
    await act(async () => { buttonByText(container, 'Save services').click(); });
    await flush();

    const payload = salonServicesSave.mock.calls[0][0];
    expect(payload.services).toHaveLength(3);
    expect(payload.services[2]).toEqual({ serviceName: 'Hair spa', price: 900, durationMinutes: 45, displayOrder: 2 });
    expect(payload.services[2].serviceId).toBeUndefined();
  });

  it('takes a removed service off the menu by id, and puts the whole row back on Undo', async () => {
    const { container, mount } = render();
    await act(async () => { mount(); });
    await flush();

    const removeBeardTrim = async () => {
      await act(async () => { named(container, 'Remove Beard trim').click(); });
      await flush();
      // The confirmation is a real sheet; the safe answer is its default, so the
      // test presses the destructive one on purpose.
      await act(async () => { buttonByText(document.body, 'Remove from menu').click(); });
      await flush();
    };

    await removeBeardTrim();
    expect(rowInputs(container)).toHaveLength(1);
    expect(container.textContent).toContain('will be removed when you save');

    // Undo restores the row itself — price and duration included, not a blank
    // line with the right name.
    await act(async () => { buttonByText(container, 'Beard trim').click(); });
    await flush();
    const restored = rowInputs(container);
    expect(restored).toHaveLength(2);
    expect(restored[1].querySelector('input').value).toBe('Beard trim');
    expect(restored[1].querySelector('input[type="number"]').value).toBe('150');
    expect(restored[1].querySelector('select').value).toBe('20');
    // Nothing differs from what the server has, so there is nothing to save.
    expect(container.textContent).not.toContain('will be removed when you save');
    expect(buttonByText(container, 'Save services').disabled).toBe(true);

    await removeBeardTrim();
    await act(async () => { buttonByText(container, 'Save services').click(); });
    await flush();
    const payload = salonServicesSave.mock.calls[0][0];
    expect(payload.services.map(service => service.serviceId)).toEqual(['svc-1']);
    expect(payload.removedServiceIds).toEqual(['svc-2']);
  });

  it('walks a row with Enter and starts a new service after the last field', async () => {
    const { container, mount } = render();
    await act(async () => { mount(); });
    await flush();

    const press = async node => {
      await act(async () => { node.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); });
      await act(async () => { await new Promise(resolve => setTimeout(resolve, 40)); });
      return document.activeElement;
    };

    const [firstRow] = rowInputs(container);
    const name = firstRow.querySelector('input');
    name.focus();

    // Service → Price → Duration → Description, all inside the same row.
    expect(await press(name)).toBe(firstRow.querySelector('input[type="number"]'));
    expect(await press(document.activeElement)).toBe(firstRow.querySelector('select'));
    expect(await press(document.activeElement)).toBe(firstRow.querySelectorAll('input')[2]);

    // The last field of the LAST row adds one and puts the cursor in it, so a
    // whole menu can be typed without touching the mouse.
    await act(async () => { type(firstRow.querySelectorAll('input')[2], 'Note'); });
    await act(async () => { type(firstRow.querySelector('input[type="number"]'), '250'); });
    const secondRow = rowInputs(container)[1];
    secondRow.querySelectorAll('input')[2].focus();
    const focused = await press(secondRow.querySelectorAll('input')[2]);

    const rows = rowInputs(container);
    expect(rows).toHaveLength(3);
    expect(rows[2].classList.contains('is-new')).toBe(true);
    expect(focused).toBe(rows[2].querySelector('input'));
  });

  it('refuses to save a row with no price, and says which field', async () => {
    const { container, mount } = render();
    await act(async () => { mount(); });
    await flush();

    const [firstRow] = rowInputs(container);
    await act(async () => { type(firstRow.querySelector('input[type="number"]'), ''); });
    await act(async () => { buttonByText(container, 'Save services').click(); });
    await flush();

    expect(salonServicesSave).not.toHaveBeenCalled();
    expect(container.textContent).toContain('Add the price');
    expect(notify).toHaveBeenCalledWith('error', expect.stringContaining('price'));
  });

  it('says the backend update is missing instead of blaming the partner at 404', async () => {
    salonServicesSave.mockRejectedValueOnce(Object.assign(new Error('Request failed with status code 404'), { status: 404 }));
    const { container, mount } = render();
    await act(async () => { mount(); });
    await flush();

    const [firstRow] = rowInputs(container);
    await act(async () => { type(firstRow.querySelector('input[type="number"]'), '275'); });
    await act(async () => { buttonByText(container, 'Save services').click(); });
    await flush();

    expect(notify).toHaveBeenCalledWith('error', expect.stringContaining('latest backend update'));
  });

  it('keeps Save off until something actually changed', async () => {
    const { container, mount } = render();
    await act(async () => { mount(); });
    await flush();

    expect(buttonByText(container, 'Save services').disabled).toBe(true);
    const [firstRow] = rowInputs(container);
    await act(async () => { type(firstRow.querySelector('input[type="number"]'), '260'); });
    await flush();
    expect(container.textContent).toContain('Unsaved changes');
    expect(buttonByText(container, 'Save services').disabled).toBe(false);
  });

  it('offers the default menu when there is nothing on it yet', async () => {
    salonProfile.mockResolvedValue({ status: 'SUCCESS', data: { salonName: 'Glow Studio', genderType: 'male', services: [] } });
    const { container, mount } = render();
    await act(async () => { mount(); });
    await flush();

    expect(container.textContent).toContain('No services yet');
    await act(async () => { buttonByText(container, 'Load defaults').click(); });
    await flush();

    const rows = rowInputs(container);
    expect(rows.length).toBeGreaterThan(5);
    expect(rows[0].querySelector('input').value).toBe('Normal Hair Cut');
  });
});

describe('the rules behind the editor', () => {
  it('normalises a saved service and a brand-new one the same way', () => {
    expect(serviceRowFrom({ serviceId: 'a', serviceName: 'Haircut', price: '250.00', durationMinutes: 30 })).toMatchObject({
      serviceId: 'a', name: 'Haircut', price: '250', duration: '30',
    });
    const created = serviceRowFrom({ name: 'Trim', price: 100, duration: 15 });
    expect(created.serviceId).toBeNull();
    expect(created.key.startsWith('new-service-')).toBe(true);
  });

  it('reads a menu out of the profile in the order the salon arranged it', () => {
    const rows = serviceRowsFromProfile({ services: [{ serviceId: 'b', serviceName: 'B' }, { serviceId: 'a', serviceName: 'A' }] });
    expect(rows.map(row => row.name)).toEqual(['B', 'A']);
  });

  it('validates the three required fields and nothing invented', () => {
    expect(validateServiceRow({ name: 'Haircut', price: '250', duration: '30' })).toEqual({});
    expect(validateServiceRow({ name: '', price: '', duration: '' })).toEqual({
      name: 'Add the service name', price: 'Add the price', duration: 'Add the minutes',
    });
    expect(validateServiceRow({ name: 'X', price: '-1', duration: '5000' })).toEqual({
      name: 'Name is too short', price: 'Price must be a number, 0 or more', duration: 'Keep it under 24 hours',
    });
  });

  it('treats two services with the same name as one mistake, ignoring case and spacing', () => {
    const rows = [
      serviceRowFrom({ serviceId: '1', serviceName: 'Hair cut', price: 250, durationMinutes: 30 }),
      serviceRowFrom({ serviceId: '2', serviceName: 'HAIR  CUT', price: 300, durationMinutes: 40 }),
    ];
    const { errorsByKey, valid } = validateServiceRows(rows);
    expect(valid).toBe(false);
    expect(Object.values(errorsByKey).every(errors => errors.name === 'Two services have this name')).toBe(true);
  });

  it('builds the payload from the rows, order included, and drops blank descriptions', () => {
    const rows = [
      serviceRowFrom({ serviceId: 'svc-1', serviceName: ' Haircut ', price: '250', durationMinutes: 30, description: '  ' }),
      serviceRowFrom({ serviceName: 'Beard trim', price: '150.5', durationMinutes: 20 }),
    ];
    expect(buildServicesPayload(rows, ['svc-9'])).toEqual({
      services: [
        { serviceId: 'svc-1', serviceName: 'Haircut', price: 250, durationMinutes: 30, displayOrder: 0 },
        { serviceName: 'Beard trim', price: 150.5, durationMinutes: 20, displayOrder: 1 },
      ],
      removedServiceIds: ['svc-9'],
    });
  });

  it('suggests the salon type’s own menu first while typing a name', () => {
    const names = serviceNameSuggestions('female', ['Haircut']);
    // The type's own defaults lead, the other menus follow, and a name already on
    // the menu is offered once.
    expect(names[0]).toBe('Eyebrow Threading');
    expect(names).toContain('Haircut');
    expect(new Set(names).size).toBe(names.length);
    expect(names.filter(name => name === 'Haircut')).toHaveLength(1);
  });
});
