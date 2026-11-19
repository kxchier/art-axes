/* Pure view math shared by trackpad, touchscreen and button zoom. */
(function (root) {
  function zoomAt(view, factor, anchor, origin) {
    const zoom = Math.max(.2, Math.min(3, view.zoom * factor));
    const ratio = zoom / view.zoom;
    return {
      zoom,
      panX: anchor.x - origin.x - (anchor.x - origin.x - view.panX) * ratio,
      panY: anchor.y - origin.y - (anchor.y - origin.y - view.panY) * ratio
    };
  }
  function pinch(view, start, current, factor, origin) {
    const result = zoomAt(view, factor, start, origin);
    result.panX += current.x - start.x;
    result.panY += current.y - start.y;
    return result;
  }
  const api = { zoomAt, pinch };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.MapNavigation = api;
})(globalThis);
