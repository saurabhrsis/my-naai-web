import React from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
import { LocationPicker } from './LocationPicker';
import { LocationMap } from './LocationMap';
import { DEFAULT_MAP_CENTRE } from '../lib/tileMap';

const NAGPUR = { latitude: 21.1458, longitude: 79.0882 };

async function render(element) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => { root.render(element); });
  await act(async () => { await Promise.resolve(); });
  return { container, root };
}

// The picker listens to pointer events; jsdom has no PointerEvent constructor
// with coordinates, but a MouseEvent dispatched under the pointer's type name is
// what React sees anyway.
const pointer = (type, { clientX = 0, clientY = 0 } = {}) =>
  new MouseEvent(type, { bubbles: true, cancelable: true, clientX, clientY });

const fire = async (node, event) => {
  await act(async () => { node.dispatchEvent(event); });
};

describe('LocationPicker', () => {
  it('shows a usable map before anything is pinned', async () => {
    const { container } = await render(<LocationPicker value={null} onChange={() => {}} />);

    const surface = container.querySelector('.location-picker-map');
    expect(surface).not.toBeNull();
    // The map is never an empty box: tiles are there and the hint says what to do.
    expect(container.querySelectorAll('.location-picker-tile').length).toBeGreaterThan(0);
    expect(container.querySelector('.location-picker-hint').textContent).toMatch(/drop your pin/i);
    expect(container.querySelector('.location-picker-pin')).toBeNull();
    // OSM requires the credit to stay visible.
    expect(container.querySelector('.location-picker-attr').textContent).toContain('OpenStreetMap');
  });

  it('drops the pin where the map is tapped', async () => {
    const onChange = vi.fn();
    const { container } = await render(<LocationPicker value={null} onChange={onChange} />);
    const surface = container.querySelector('.location-picker-map');

    await fire(surface, pointer('pointerdown', { clientX: 150, clientY: 90 }));
    await fire(surface, pointer('pointerup', { clientX: 150, clientY: 90 }));

    expect(onChange).toHaveBeenCalledTimes(1);
    const point = onChange.mock.calls[0][0];
    expect(Number.isFinite(point.latitude)).toBe(true);
    expect(Number.isFinite(point.longitude)).toBe(true);
    // Rounded to ~1 m, which is what gets saved.
    expect(point.latitude).toBe(Number(point.latitude.toFixed(5)));
    // A tap has to land near the view, not on the other side of the planet.
    expect(Math.abs(point.latitude - DEFAULT_MAP_CENTRE.latitude)).toBeLessThan(1);
    expect(Math.abs(point.longitude - DEFAULT_MAP_CENTRE.longitude)).toBeLessThan(1);
  });

  it('pans instead of dropping a pin when the map is dragged', async () => {
    const onChange = vi.fn();
    const { container } = await render(<LocationPicker value={null} onChange={onChange} />);
    const surface = container.querySelector('.location-picker-map');

    await fire(surface, pointer('pointerdown', { clientX: 20, clientY: 20 }));
    await fire(surface, pointer('pointermove', { clientX: 120, clientY: 100 }));
    await fire(surface, pointer('pointerup', { clientX: 120, clientY: 100 }));

    expect(onChange).not.toHaveBeenCalled();
  });

  it('shows the saved pin with its coordinates, and can clear it', async () => {
    const onChange = vi.fn();
    const { container } = await render(<LocationPicker value={NAGPUR} onChange={onChange} />);

    expect(container.querySelector('.location-picker-pin')).not.toBeNull();
    expect(container.querySelector('.location-picker-read').textContent).toBe('21.14580, 79.08820');

    const clear = Array.from(container.querySelectorAll('button')).find(node => /clear pin/i.test(node.textContent));
    expect(clear).toBeTruthy();
    await fire(clear, pointer('click'));
    expect(onChange).toHaveBeenCalledWith(null);
  });

  it('leaves the permission conversation to the parent when one is given', async () => {
    const onLocate = vi.fn();
    const { container } = await render(
      <LocationPicker value={null} onChange={() => {}} onLocate={onLocate} locateLabel="Allow location" />
    );

    const locate = container.querySelector('.location-picker-locate');
    expect(locate.textContent).toContain('Allow location');
    await fire(locate, pointer('click'));
    expect(onLocate).toHaveBeenCalledTimes(1);
  });

  it('reports the error the parent flow produced', async () => {
    const { container } = await render(
      <LocationPicker value={null} onChange={() => {}} message="Location is blocked for this site." />
    );
    expect(container.querySelector('.location-picker-error').textContent).toContain('blocked');
  });

  it('drops the pin at the centre when Enter is pressed', async () => {
    const onChange = vi.fn();
    const { container } = await render(<LocationPicker value={null} onChange={onChange} />);
    const surface = container.querySelector('.location-picker-map');

    await fire(surface, new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0][0].latitude).toBeCloseTo(DEFAULT_MAP_CENTRE.latitude, 4);
  });
});

describe('LocationMap without a saved point', () => {
  it('draws the area it starts in, with no pin claiming the salon is there', async () => {
    const { container } = await render(<LocationMap value={null} fallbackPoint={DEFAULT_MAP_CENTRE} />);
    const frame = container.querySelector('iframe');
    expect(frame).not.toBeNull();
    // No marker: a pin in the middle of Nagpur would be a lie.
    expect(frame.getAttribute('src')).not.toContain('marker=');
    expect(container.querySelector('.location-map-badge').textContent).toMatch(/no location saved/i);
  });

  it('still says what is missing when there is nothing to draw', async () => {
    const { container } = await render(<LocationMap value={null} />);
    expect(container.querySelector('iframe')).toBeNull();
    expect(container.textContent).toContain('No location saved yet');
  });

  it('pins the saved point exactly', async () => {
    const { container } = await render(<LocationMap value={NAGPUR} />);
    const src = container.querySelector('iframe').getAttribute('src');
    expect(src).toContain('marker=21.1458,79.0882');
    expect(container.querySelector('.location-map-badge')).toBeNull();
  });
});
