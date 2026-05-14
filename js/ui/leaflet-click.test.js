const { stopLeafletClickPropagation } = require('./leaflet-click');

describe('stopLeafletClickPropagation', () => {
  test('stops both Leaflet and underlying DOM click propagation when present', () => {
    const event = {
      stopPropagation: jest.fn(),
      originalEvent: {
        stopPropagation: jest.fn(),
      },
    };

    stopLeafletClickPropagation(event);

    expect(event.stopPropagation).toHaveBeenCalledTimes(1);
    expect(event.originalEvent.stopPropagation).toHaveBeenCalledTimes(1);
  });

  test('is safe when propagation helpers are missing', () => {
    expect(() => stopLeafletClickPropagation()).not.toThrow();
    expect(() => stopLeafletClickPropagation({})).not.toThrow();
    expect(() => stopLeafletClickPropagation({ originalEvent: {} })).not.toThrow();
  });
});
