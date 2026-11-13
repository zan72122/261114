export default async ({ open, shot, wait, g }) => {
  const list = (process.env.ST || 'fold,apple1,lift1,carry1,sew1,button,pack,park,home').split(',');
  await open('#stage=fold');
  await g('localStorage.clear()');
  for (const s of list) {
    await g(`__g.goto('${s}')`);
    await wait(+(process.env.WAIT || 2500));
    await shot('st_' + s);
  }
};
