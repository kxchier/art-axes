const test = require('node:test');
const assert = require('node:assert/strict');
const { zoomAt, pinch } = require('../dist/map-navigation.js');
const close = (a,b) => assert(Math.abs(a-b)<1e-9);
const worldPoint = (view, screen, origin) => ({x:(screen.x-origin.x-view.panX)/view.zoom, y:(screen.y-origin.y-view.panY)/view.zoom});
test('zoom keeps the world point underneath the cursor fixed, including after panning', () => {
  const view={zoom:.8,panX:120,panY:-50}, anchor={x:270,y:190}, origin={x:500,y:350};
  const before=worldPoint(view,anchor,origin), after=worldPoint(zoomAt(view,1.5,anchor,origin),anchor,origin);
  close(before.x,after.x); close(before.y,after.y);
});
test('pinch combines zoom and two-finger movement without jumping', () => {
  const view={zoom:1,panX:20,panY:30}, start={x:200,y:200}, current={x:240,y:215}, origin={x:400,y:300};
  const result=pinch(view,start,current,1.4,origin);
  const before=worldPoint(view,start,origin), after=worldPoint(result,current,origin);
  close(before.x,after.x); close(before.y,after.y);
  close(result.zoom,1.4);
});
test('zoom limits still preserve the gesture anchor and reverse zoom restores the view', () => {
  const view={zoom:1,panX:30,panY:-20}, anchor={x:200,y:100}, origin={x:400,y:300};
  const limit=zoomAt(view,100,anchor,origin);
  assert.equal(limit.zoom,3);
  const p=worldPoint(view,anchor,origin), q=worldPoint(limit,anchor,origin);
  close(p.x,q.x); close(p.y,q.y);
  const restored=zoomAt(zoomAt(view,2,anchor,origin),.5,anchor,origin);
  close(restored.zoom,view.zoom); close(restored.panX,view.panX); close(restored.panY,view.panY);
  assert.equal(zoomAt(view,.001,anchor,origin).zoom,.2);
});
