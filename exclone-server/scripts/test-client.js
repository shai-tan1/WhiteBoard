/**
 * Quick manual test for the whiteboard server.
 *
 * 1. In one terminal:  npm run start:dev
 * 2. In another:        node scripts/test-client.js
 *
 * It connects two clients, has client A draw/modify/remove objects, and
 * prints what client B receives — proving the broadcast + sync flow works.
 */
const { io } = require('socket.io-client');

const URL = process.env.URL || 'http://localhost:3000';

function connect(name) {
  const socket = io(URL, { transports: ['websocket'] });
  socket.on('connect', () => console.log(`[${name}] connected as ${socket.id}`));
  socket.on('object:sync', (d) =>
    console.log(`[${name}] sync -> ${d.objects.length} object(s)`),
  );
  socket.on('object:added', (d) => console.log(`[${name}] saw add`, d.id));
  socket.on('object:modified', (d) =>
    console.log(`[${name}] saw modify`, d.id, d.props),
  );
  socket.on('object:removed', (d) => console.log(`[${name}] saw remove`, d.id));
  socket.on('canvas:clear', () => console.log(`[${name}] saw canvas clear`));
  return socket;
}

const a = connect('A');
const b = connect('B');

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  await wait(500);

  console.log('\n--- A adds a rectangle ---');
  a.emit('object:added', {
    id: 'rect-1',
    props: { type: 'rect', x: 10, y: 10, w: 100, h: 60, color: 'blue' },
  });
  await wait(300);

  console.log('\n--- A moves the rectangle ---');
  a.emit('object:modified', { id: 'rect-1', props: { x: 200 } });
  await wait(300);

  console.log('\n--- A removes the rectangle ---');
  a.emit('object:removed', { id: 'rect-1', props: {} });
  await wait(300);

  console.log('\n--- A clears the canvas ---');
  a.emit('canvas:clear');
  await wait(300);

  console.log('\nDone. Closing.');
  a.close();
  b.close();
  process.exit(0);
})();
