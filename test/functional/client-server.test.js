const test = require('tap-only');
const path = require('path');
const got = require('got');
const app = require('../../lib');
const { port, createTestServer } = require('../utils');

const root = __dirname;

test('proxy requests originating from behind the broker client', (t) => {
  /**
   * 1. start broker in server mode
   * 2. start broker in client mode and join (1)
   * 3. run local http server that replicates "private server"
   * 4. send requests to **client**
   *
   * Note: server is forwarding requests to echo-server defined in test/util.js
   */

  const { echoServerPort, testServer } = createTestServer();

  t.teardown(() => {
    testServer.close();
  });

  process.env.ACCEPT = 'filters.json';

  process.chdir(path.resolve(root, '../fixtures/server'));
  process.env.BROKER_TYPE = 'server';
  process.env.ORIGIN_PORT = echoServerPort;
  const serverPort = port();
  const server = app.main({ port: serverPort });

  process.chdir(path.resolve(root, '../fixtures/client'));
  process.env.BROKER_TYPE = 'client';
  process.env.BROKER_TOKEN = 'C481349B-4014-43D9-B59D-BA41E1315001'; // uuid.v4
  process.env.BROKER_SERVER_URL = `http://localhost:${serverPort}`;
  const clientPort = port();
  const client = app.main({ port: clientPort });

  // wait for the client to successfully connect to the server and identify itself
  server.io.once('connection', (socket) => {
    socket.once('identify', (clientData) => {
      t.plan(14);

      t.test('successfully broker POST', async (t) => {
        const url = `http://localhost:${clientPort}/echo-body`;
        const body = { some: { example: 'json' } };
        const res = await got(url, {
          method: 'POST',
          responseType: 'json',
          json: body,
        });

        t.equal(res.statusCode, 200, '200 statusCode');
        t.same(res.body, body, 'body brokered');
      });

      t.test('successfully broker exact bytes of POST body', async (t) => {
        const url = `http://localhost:${clientPort}/echo-body`;
        // stringify the JSON unusually to ensure an unusual exact body
        const body = Buffer.from(
          JSON.stringify({ some: { example: 'json' } }, null, 5),
        );
        const headers = { 'Content-Type': 'application/json' };
        const res = await got(url, { method: 'POST', headers, body });

        const responseBody = Buffer.from(res.body);
        t.equal(res.statusCode, 200, '200 statusCode');
        t.same(responseBody, body, 'body brokered exactly');
      });

      t.test('successfully broker GET', async (t) => {
        const url = `http://localhost:${clientPort}/echo-param/xyz`;
        const res = await got(url, { responseType: 'text' });

        t.equal(res.statusCode, 200, '200 statusCode');
        t.equal(res.body, 'xyz', 'body brokered');
      });

      // the filtering happens in the broker client
      t.test('block request for non-whitelisted url', async (t) => {
        const url = `http://localhost:${clientPort}/not-allowed`;
        const res = await got(url, {
          method: 'POST',
          responseType: 'json',
          throwHttpErrors: false,
        });

        t.equal(res.statusCode, 401, '401 statusCode');
        t.equal(res.body.message, 'blocked', '"blocked" body: ' + res.body);
        t.equal(
          res.body.reason,
          'Request does not match any accept rule, blocking HTTP request',
          'Block message',
        );
        t.equal(res.body.url, '/not-allowed', 'Blocked url');
      });

      // the filtering happens in the broker client
      t.test('allow request for valid url with valid body', async (t) => {
        const url = `http://localhost:${clientPort}/echo-body/filtered`;
        const body = { proxy: { me: 'please' } };
        const res = await got(url, {
          method: 'POST',
          responseType: 'json',
          json: body,
        });

        t.equal(res.statusCode, 200, '200 statusCode');
        t.same(res.body, body, 'body brokered');
      });

      // the filtering happens in the broker client
      t.test('block request for valid url with invalid body', async (t) => {
        const url = `http://localhost:${clientPort}/echo-body/filtered`;
        const body = { proxy: { me: 'now!' } };
        const res = await got(url, {
          method: 'POST',
          responseType: 'json',
          throwHttpErrors: false,
          json: body,
        });

        t.equal(res.statusCode, 401, '401 statusCode');
        t.equal(res.body.message, 'blocked', '"blocked" body: ' + body);
      });

      // the filtering happens in the broker client
      t.test(
        'allow request for valid url with valid query param',
        async (t) => {
          const url = `http://localhost:${clientPort}/echo-query/filtered`;
          const qs = { proxyMe: 'please' };
          const res = await got(url, {
            responseType: 'json',
            searchParams: qs,
          });

          t.equal(res.statusCode, 200, '200 statusCode');
          t.same(res.body, qs, 'querystring brokered');
        },
      );

      // the filtering happens in the broker client
      t.test(
        'block request for valid url with invalid query param',
        async (t) => {
          const url = `http://localhost:${clientPort}/echo-query/filtered`;
          const qs = { proxyMe: 'now!' };
          const res = await got(url, {
            responseType: 'json',
            searchParams: qs,
            throwHttpErrors: false,
          });

          t.equal(res.statusCode, 401, '401 statusCode');
        },
      );

      // the filtering happens in the broker client
      t.test(
        'block request for valid url with missing query param',
        async (t) => {
          const url = `http://localhost:${clientPort}/echo-query/filtered`;
          const res = await got(url, {
            responseType: 'json',
            throwHttpErrors: false,
          });

          t.equal(res.statusCode, 401, '401 statusCode');
        },
      );

      t.test(
        'allow request for valid url with valid accept header',
        async (t) => {
          const url = `http://localhost:${clientPort}/echo-param-protected/xyz`;
          const res = await got(url, {
            responseType: 'text',

            headers: {
              ACCEPT: 'valid.accept.header',
              accept: 'valid.accept.header',
            },
          });

          t.equal(res.statusCode, 200, '200 statusCode');
          t.equal(res.body, 'xyz', 'body brokered');
        },
      );

      t.test(
        'block request for valid url with invalid accept header',
        async (t) => {
          const invalidAcceptHeader = 'invalid.accept.header';
          const url = `http://localhost:${clientPort}/echo-param-protected/xyz`;
          const res = await got(url, {
            responseType: 'text',
            headers: {
              ACCEPT: invalidAcceptHeader,
              accept: invalidAcceptHeader,
            },
            throwHttpErrors: false,
          });

          t.equal(res.statusCode, 401, '401 statusCode');
        },
      );

      // this validates that the broker *server* sends to the correct broker token
      // header to the echo-server
      t.test(
        'broker ID is included in headers from server to private',
        async (t) => {
          const url = `http://localhost:${clientPort}/echo-headers`;
          const res = await got(url, {
            responseType: 'json',
            method: 'POST',
          });

          t.equal(res.statusCode, 200, '200 statusCode');
          t.equal(
            res.body['x-broker-token'],
            clientData.token.toLowerCase(),
            'X-Broker-Token header present and lowercased',
          );
        },
      );

      t.test('querystring parameters are brokered', async (t) => {
        const url = `http://localhost:${clientPort}/echo-query?shape=square&colour=yellow`;
        const res = await got(url, {
          responseType: 'json',
        });

        t.equal(res.statusCode, 200, '200 statusCode');
        t.same(
          res.body,
          { shape: 'square', colour: 'yellow' },
          'querystring brokered',
        );
      });

      t.test('clean up', (t) => {
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
