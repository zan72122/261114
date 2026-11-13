export default async ({ page, open, wait, g, drag }) => {
  await open('#stage=lift1'); await g('localStorage.clear()'); await g(`__g.goto('lift1')`); await wait(1500);
  await drag(195, 372, 195, 330, 3); await wait(800);
  console.log('small lift release ->', await g('__g.stage'), await g('__g.busy'), await g('__g.cloth.pose.grip.y'));
  await wait(3000);
  console.log('settled', await g('__g.cloth.pose.grip.y'));
  await drag(195, 372, 195, 250, 4);
  console.log('released at', await g('__g.cloth.pose.grip.y'), await g('__g.busy'));
  await wait(20000);
  console.log('later ->', await g('__g.stage'), await g('__g.busy'));
  await g(`__g.goto('sew1')`); await wait(2500);
  await drag(200, 780, 200, 560, 8); await wait(3000);
  console.log('stitches after one swipe', await g('__g.state.st.length'));
};
