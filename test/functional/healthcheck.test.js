const test = require('tap-only');
const path = require('path');
const got = require('got');
const app = require('../../lib');
const root = __dirname;

const { port, createTestServer } = require('../utils');

test('proxy requests originating from behind the broker client', (t) => {
  /**
   * 1. start broker in server mode
   * 2. start broker in client mode and join (1)
   * 3. check /healthcheck on client and server
   * 4. stop client and check it's on "disconnected" in the server
   * 5. restart client with same token, make sure it's not in "disconnected"
   */

  const { testServer } = createTestServer();

  t.teardown(() => {
    testServer.close();
  });

  process.env.ACCEPT = 'filters.json';

  process.chdir(path.resolve(root, '../fixtures/server'));
  process.env.BROKER_TYPE = 'server';
  const serverPort = port();
  const server = app.main({ port: serverPort });
  const BROKER_TOKEN = '12345';

  process.chdir(path.resolve(root, '../fixtures/client'));
  process.env.BROKER_TYPE = 'client';
  process.env.BROKER_TOKEN = BROKER_TOKEN;
  process.env.BROKER_SERVER_URL = `http://localhost:${serverPort}`;
  const clientPort = port();
  let client = app.main({ port: clientPort });

  t.plan(9);

  const serverHealth = `http://localhost:${serverPort}/healthcheck`;
  const connectionStatus =
    `http://localhost:${serverPort}/` + `connection-status/${BROKER_TOKEN}`;
  const clientHealth = `http://localhost:${clientPort}/healthcheck`;

  // instantiated and connected later
  let customHealthClient;

  t.test('server healthcheck', async (t) => {
    try {
      const res = await got(serverHealth, { responseType: 'json' });

      t.equal(res.statusCode, 200, '200 statusCode');
      t.equal(res.body.ok, true, '{ ok: true } in body');
      t.ok(res.body.version, 'version in body');
    } catch (err) {
      if (err) {
        return t.threw(err);
      }
    }
  });

  // wait for the client to successfully connect to the server and identify itself
  server.io.once('connection', (socket) => {
    socket.once('identify', () => {
      t.test('client healthcheck after connection', async (t) => {
        try {
          const res = await got(clientHealth, { responseType: 'json' });

          t.equal(res.statusCode, 200, '200 statusCode');
          t.equal(res.body.ok, true, '{ ok: true } in body');
          t.equal(
            res.body.websocketConnectionOpen,
            true,
            '{ websocketConnectionOpen: true } in body',
          );
          t.ok(res.body.brokerServerUrl, 'brokerServerUrl in body');
          t.ok(res.body.version, 'version in body');
        } catch (err) {
          if (err) {
            return t.threw(err);
          }
        }
      });

      t.test('check connection-status with connected client', async (t) => {
        try {
          const res = await got(connectionStatus, { responseType: 'json' });

          const expectedFilters = require('../fixtures/client/filters.json');

          t.equal(res.statusCode, 200, '200 statusCode');
          t.equal(res.body.ok, true, '{ ok: true } in body');
          t.ok(res.body.clients[0].version, 'client version in body');

          t.deepEqual(
            res.body.clients[0].filters,
            expectedFilters,
            'correct client filters in body',
          );
        } catch (err) {
          if (err) {
            return t.threw(err);
          }
        }
      });

      t.test('check connection-status after client disconnected', (t) => {
        client.close();
        setTimeout(async () => {
          try {
            const res = await got(connectionStatus, {
              responseType: 'json',
              throwHttpErrors: false,
            });

            t.equal(res.statusCode, 404, '404 statusCode');
          } catch (err) {
            if (err) {
              return t.threw(err);
            }
          }
        }, 100);
      });

      t.test('misconfigured client fails healthcheck', async (t) => {
        const badClient = app.main({
          port: clientPort,
          config: {
            brokerServerUrl: 'http://no-such-server',
          },
        });

        try {
          const res = await got(clientHealth, {
            responseType: 'json',
            throwHttpErrors: false,
          });

          t.equal(res.statusCode, 500, '500 statusCode');
          t.equal(res.body.ok, false, '{ ok: false } in body');
          t.equal(
            res.body.websocketConnectionOpen,
            false,
            '{ websocketConnectionOpen: false } in body',
          );
          t.ok(res.body.brokerServerUrl, 'brokerServerUrl in body');
          t.ok(res.body.version, 'version in body');

          badClient.close();
        } catch (err) {
          if (err) {
            return t.threw(err);
          }
        }
      });

      t.test('check connection-status after client re-connected', (t) => {
        client = app.main({ port: clientPort });
        setTimeout(async () => {
          try {
            const res = await got(connectionStatus, { responseType: 'json' });

            t.equal(res.statusCode, 200, '200 statusCode');
            t.equal(res.body.ok, true, '{ ok: true } in body');
            t.ok(res.body.clients[0].version, 'client version in body');
          } catch (err) {
            if (err) {
              return t.threw(err);
            }
          }
        }, 20);
      });

      t.test('client healthcheck after reconnection', async (t) => {
        try {
          const res = await got(clientHealth, { responseType: 'json' });

          t.equal(res.statusCode, 200, '200 statusCode');
          t.equal(res.body.ok, true, '{ ok: true } in body');
          t.equal(
            res.body.websocketConnectionOpen,
            true,
            '{ websocketConnectionOpen: true } in body',
          );
          t.ok(res.body.brokerServerUrl, 'brokerServerUrl in body');
          t.ok(res.body.version, 'version in body');
        } catch (err) {
          if (err) {
            return t.threw(err);
          }
        }
      });

      t.test('custom healthcheck endpoint', (t) => {
        // launch second client to test custom client healthcheck
        process.env.BROKER_HEALTHCHECK_PATH = '/custom/healthcheck/endpoint';
        const customClientPort = port();
        const customClientHealth = `http://localhost:${customClientPort}/custom/healthcheck/endpoint`;

        customHealthClient = app.main({ port: customClientPort });

        server.io.once('connection', (socket) => {
          socket.once('identify', () => {
            t.test('client custom healthcheck', async (t) => {
              try {
                const res = await got(customClientHealth, {
                  responseType: 'json',
                });

                t.equal(res.statusCode, 200, '200 statusCode');
                t.equal(res.body.ok, true, '{ ok: true } in body');
                t.ok(res.body.version, 'version in body');
              } catch (err) {
                if (err) {
                  return t.threw(err);
                }
              }
            });
            t.end();
          });
        });
      });

      t.test('clean up', (t) => {
        customHealthClient.close();
        client.close();
        setTimeout(() => {
          server.close();
          t.ok('sockets closed');
          t.end();
        }, 100);
      });
    });
  });
});
