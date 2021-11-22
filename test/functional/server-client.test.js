const test = require('tap-only');
const path = require('path');
const got = require('got');
const app = require('../../lib');
const version = require('../../lib/version');
const root = __dirname;

const { port, createTestServer } = require('../utils');

test('proxy requests originating from behind the broker server', (t) => {
  /**
   * 1. start broker in server mode
   * 2. start broker in client mode and join (1)
   * 3. run local http server that replicates "private server"
   * 4. send requests to **server**
   *
   * Note: client is forwarding requests to echo-server defined in test/util.js
   */

  const { echoServerPort, testServer } = createTestServer();

  t.teardown(() => {
    testServer.close();
  });

  const ACCEPT = 'filters.json';
  process.env.ACCEPT = ACCEPT;

  process.chdir(path.resolve(root, '../fixtures/server'));
  process.env.BROKER_TYPE = 'server';
  const serverPort = port();
  const server = app.main({ port: serverPort });

  const clientRootPath = path.resolve(root, '../fixtures/client');
  process.chdir(clientRootPath);
  const BROKER_SERVER_URL = `http://localhost:${serverPort}`;
  const BROKER_TOKEN = '98f04768-50d3-46fa-817a-9ee6631e9970';
  process.env.BROKER_TYPE = 'client';
  process.env.GITHUB = 'github.com';
  process.env.BROKER_TOKEN = BROKER_TOKEN;
  process.env.BROKER_SERVER_URL = BROKER_SERVER_URL;
  process.env.ORIGIN_PORT = echoServerPort;
  process.env.USERNAME = 'user@email.com';
  process.env.PASSWORD = 'aB}#/:%40*1';
  process.env.GIT_CLIENT_URL = `http://localhost:${echoServerPort}`;
  process.env.GIT_URL = process.env.GITHUB;
  process.env.GIT_USERNAME = process.env.USERNAME;
  process.env.GIT_PASSWORD = process.env.PASSWORD;
  process.env.RES_BODY_URL_SUB = `http://private`;
  const client = app.main({ port: port() });

  // wait for the client to successfully connect to the server and identify itself
  server.io.on('connection', (socket) => {
    socket.on('identify', (clientData) => {
      const token = clientData.token;
      t.plan(30);

      t.test('identification', (t) => {
        const filters = require(`${clientRootPath}/${ACCEPT}`);
        t.equal(clientData.token, BROKER_TOKEN, 'correct token');
        t.deepEqual(
          clientData.metadata,
          {
            version,
            filters,
          },
          'correct metadata',
        );
        t.end();
      });

      t.test('successfully broker POST', async (t) => {
        const url = `http://localhost:${serverPort}/broker/${token}/echo-body`;
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
        const url = `http://localhost:${serverPort}/broker/${token}/echo-body`;
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
        const url = `http://localhost:${serverPort}/broker/${token}/echo-param/xyz`;
        const res = await got(url, { responseType: 'text' });

        t.equal(res.statusCode, 200, '200 statusCode');
        t.equal(res.body, 'xyz', 'body brokered');
      });

      // the variable substitution takes place in the broker client
      t.test('variable subsitution', async (t) => {
        const url = `http://localhost:${serverPort}/broker/${token}/echo-body`;
        const body = {
          BROKER_VAR_SUB: ['swap.me'],
          swap: { me: '${BROKER_TYPE}:${BROKER_TOKEN}' },
        };
        const res = await got(url, {
          method: 'POST',
          responseType: 'json',
          json: body,
        });

        const swappedBody = {
          BROKER_VAR_SUB: ['swap.me'],
          swap: { me: `client:${token}` },
        };
        t.equal(res.statusCode, 200, '200 statusCode');
        t.same(res.body, swappedBody, 'body brokered');
      });

      // the filtering happens in the broker client
      t.test('block request for non-whitelisted url', async (t) => {
        const url = `http://localhost:${serverPort}/broker/${token}/not-allowed`;
        const res = await got(url, {
          method: 'POST',
          responseType: 'json',
          throwHttpErrors: false,
        });

        t.equal(res.statusCode, 401, '401 statusCode');
        t.equal(res.body.message, 'blocked', '"blocked" body: ' + res.body);
        t.equal(
          res.body.reason,
          'Response does not match any accept rule, blocking websocket request',
          'Block message',
        );
        t.equal(res.body.url, '/not-allowed', 'Blocked url');
      });

      // the filtering happens in the broker client
      t.test('allow request for valid url with valid body', async (t) => {
        const url = `http://localhost:${serverPort}/broker/${token}/echo-body/filtered`;
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
        const url = `http://localhost:${serverPort}/broker/${token}/echo-body/filtered`;
        const body = { proxy: { me: 'now!' } };
        const res = await got(url, {
          method: 'POST',
          responseType: 'json',
          json: body,
          throwHttpErrors: false,
        });

        t.equal(res.statusCode, 401, '401 statusCode');
        t.equal(res.body.message, 'blocked', '"blocked" body: ' + res.body);
        t.equal(
          res.body.reason,
          'Response does not match any accept rule, blocking websocket request',
          'Block message',
        );
      });

      // the filtering happens in the broker client
      t.test(
        'allow request for valid url with valid query param',
        async (t) => {
          const url = `http://localhost:${serverPort}/broker/${token}/echo-query/filtered`;
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
          const url = `http://localhost:${serverPort}/broker/${token}/echo-query/filtered`;
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
          const url = `http://localhost:${serverPort}/broker/${token}/echo-query/filtered`;
          const res = await got(url, {
            responseType: 'json',
            throwHttpErrors: false,
          });

          t.equal(res.statusCode, 401, '401 statusCode');
        },
      );

      t.test('bad broker id', async (t) => {
        const url = `http://localhost:${serverPort}/broker/${token}XXX/echo-body`;
        const res = await got(url, {
          method: 'POST',
          responseType: 'json',
          throwHttpErrors: false,
        });

        t.equal(res.statusCode, 404, '404 statusCode');
      });

      // don't leak broker tokens to systems on the client side
      t.test(
        'broker token is not included in headers from client to private',
        async (t) => {
          const url = `http://localhost:${serverPort}/broker/${token}/echo-headers`;
          const res = await got(url, { method: 'POST', responseType: 'json' });

          t.equal(res.statusCode, 200, '200 statusCode');
          t.equal(
            res.body['x-broker-token'],
            undefined,
            'X-Broker-Token header not sent',
          );
        },
      );

      t.test('querystring parameters are brokered', async (t) => {
        const url =
          `http://localhost:${serverPort}/broker/${token}/` +
          'echo-query?shape=square&colour=yellow&' +
          'url_as_param=https%3A%2F%2Fclojars.org%2Fsearch%3Fq%3Dbtc&' +
          'one_more_top_level_param=true';
        const res = await got(url, { responseType: 'json' });

        t.equal(res.statusCode, 200, '200 statusCode');
        t.same(
          res.body,
          {
            shape: 'square',
            colour: 'yellow',
            url_as_param: 'https://clojars.org/search?q=btc', // eslint-disable-line
            one_more_top_level_param: 'true', // eslint-disable-line
          },
          'querystring brokered',
        );
      });

      t.test('approved URLs are blocked when escaped', async (t) => {
        const url =
          `http://localhost:${serverPort}/broker/${token}/` +
          'long/nested%2Fpath%2Fto%2Ffile.ext';
        const res = await got(url, {
          responseType: 'json',
          throwHttpErrors: false,
        });

        t.equal(res.statusCode, 401, '401 statusCode');
        t.equal(res.body.message, 'blocked', 'Block message');
        t.equal(
          res.body.reason,
          'Response does not match any accept rule, blocking websocket request',
          'Block message',
        );
      });

      t.test(
        'approved URLs are brokered when escaped as expected',
        async (t) => {
          const url =
            `http://localhost:${serverPort}/broker/${token}/` +
            'long/nested/partially/encoded%2Fpath%2Fto%2Ffile.ext';
          const res = await got(url, { responseType: 'text' });

          t.equal(res.statusCode, 200, '200 statusCode');
          t.equal(
            res.body,
            '/long/nested/partially/encoded%2Fpath%2Fto%2Ffile.ext',
            'proper brokered URL',
          );
        },
      );

      t.test('content-length is not set when using chunked http', async (t) => {
        const url = `http://localhost:${serverPort}/broker/${token}/echo-headers`;
        const res = await got(url, {
          responseType: 'json',
          headers: [{ 'Transfer-Encoding': 'chunked' }],
          throwHttpErrors: false,
        });

        t.notOk(res.headers['Content-Length'], 'no content-length header');
      });

      t.test('content-length is set without chunked http', async (t) => {
        const url = `http://localhost:${serverPort}/broker/${token}/echo-headers`;
        const res = await got(url, {
          method: 'POST',
          responseType: 'json',
          throwHttpErrors: false,
        });

        t.ok(res.headers['content-length'], 'found content-length header');
      });

      t.test('auth header is replaced when url contains token', async (t) => {
        const url = `http://localhost:${serverPort}/broker/${token}/echo-headers/github`;
        const headers = { Authorization: 'broker auth' };
        const res = await got(url, {
          method: 'POST',
          headers,
          responseType: 'json',
        });

        t.equal(res.statusCode, 200, '200 statusCode');
        t.equal(
          res.body.authorization,
          'token githubToken',
          'auth header was replaced by github token',
        );
      });

      t.test(
        'auth header is is replaced when url contains basic auth',
        async (t) => {
          const url = `http://localhost:${serverPort}/broker/${token}/echo-headers/bitbucket`;
          const headers = {};
          const res = await got(url, {
            method: 'POST',
            headers,
            responseType: 'json',
          });

          t.equal(res.statusCode, 200, '200 statusCode');
          const auth = res.body.authorization.replace('Basic ', '');
          const encodedAuth = Buffer.from(auth, 'base64').toString('utf-8');
          t.equal(
            encodedAuth,
            'bitbucketUser:bitbucketPassword',
            'auth header is set correctly',
          );
        },
      );

      t.test(
        'successfully broker on endpoint that forwards requests with basic auth',
        async (t) => {
          const url = `http://localhost:${serverPort}/broker/${token}/basic-auth`;
          const res = await got(url, { responseType: 'text' });

          t.equal(res.statusCode, 200, '200 statusCode');

          const auth = res.body.replace('Basic ', '');
          const encodedAuth = Buffer.from(auth, 'base64').toString('utf-8');
          t.equal(
            encodedAuth,
            `${process.env.USERNAME}:${process.env.PASSWORD}`,
            'auth header is set correctly',
          );
        },
      );

      t.test('ignores accept-encoding (gzip)', async (t) => {
        const paramRequiringCompression = 'hello-'.repeat(200);
        const url = `http://localhost:${serverPort}/broker/${token}/echo-param/${paramRequiringCompression}`;
        const res = await got(url, { responseType: 'text', gzip: true });

        t.equal(res.statusCode, 200, '200 statusCode');
        t.equal(res.body, paramRequiringCompression, 'body');
      });

      t.test('ignores accept-encoding (deflate)', async (t) => {
        const paramRequiringCompression = 'hello-'.repeat(200);
        const headers = { 'Accept-Encoding': 'deflate' };
        const url = `http://localhost:${serverPort}/broker/${token}/echo-param/${paramRequiringCompression}`;

        const res = await got(url, { responseType: 'text', headers });

        t.equal(res.statusCode, 200, '200 statusCode');
        t.equal(res.body, paramRequiringCompression, 'body');
      });

      t.test('successfully stream data', async (t) => {
        const url = `http://localhost:${serverPort}/broker/${token}/test-blob/1`;
        const res = await got(url, {
          encoding: '',
          responseType: 'buffer',
        });

        // No encoding is only possible when streaming
        // data as we otherwise encode the data
        // when making the request on the client.

        t.equal(res.statusCode, 299, '299 statusCode');
        t.equal(res.headers['test-orig-url'], '/test-blob/1', 'orig URL');

        // Check that the server response with the correct data

        const buf = Buffer.alloc(500);
        for (let i = 0; i < 500; i++) {
          buf.writeUInt8(i & 0xff, i);
        }
        t.deepEqual(res.body, buf);
      });

      t.test('fail to stream data', async (t) => {
        const url = `http://localhost:${serverPort}/broker/${token}/test-blob/2`;
        const res = await got(url, {
          encoding: '',
          responseType: 'buffer',
          throwHttpErrors: false,
        });

        t.equal(res.statusCode, 500, '500 statusCode');
        t.equal(res.headers['test-orig-url'], '/test-blob/2', 'orig URL');
        t.equal(String(res.body), 'Test Error');
      });

      t.test('successfully redirect POST request to git client', async (t) => {
        const url = `http://localhost:${serverPort}/broker/${token}/snykgit/echo-body`;
        const body = { some: { example: 'json' } };
        const res = await got(url, {
          method: 'POST',
          responseType: 'json',
          json: body,
        });

        t.equal(res.statusCode, 200, '200 statusCode');
        t.same(res.body, body, 'body brokered');
      });

      t.test(
        'successfully redirect exact bytes of POST body to git client',
        async (t) => {
          const url = `http://localhost:${serverPort}/broker/${token}/snykgit/echo-body`;
          const body = Buffer.from(
            JSON.stringify({ some: { example: 'json' } }, null, 5),
          );
          const headers = { 'Content-Type': 'application/json' };
          const res = await got(url, {
            method: 'POST',
            headers,
            body,
            responseType: 'buffer',
          });

          const responseBody = Buffer.from(res.body);
          t.equal(res.statusCode, 200, '200 statusCode');
          t.same(responseBody, body, 'body brokered exactly');
        },
      );

      t.test('successfully GET from git client', async (t) => {
        const url = `http://localhost:${serverPort}/broker/${token}/snykgit/echo-param/xyz`;
        const res = await got(url, { responseType: 'text' });

        t.equal(res.statusCode, 200, '200 statusCode');
        t.equal(res.body, 'xyz', 'body brokered');
      });

      t.test('allow request to git client with valid param', async (t) => {
        const url = `http://localhost:${serverPort}/broker/${token}/snykgit/echo-query`;
        const qs = { proxyMe: 'please' };
        const res = await got(url, { responseType: 'json', searchParams: qs });

        t.equal(res.statusCode, 200, '200 statusCode');
        t.same(res.body, qs, 'querystring brokered');
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
