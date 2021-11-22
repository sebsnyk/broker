const test = require('tap-only');
const path = require('path');
const got = require('got');
const app = require('../../lib');
const root = __dirname;

const { port, createTestServer } = require('../utils');

test('broker client systemcheck endpoint', (t) => {
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

  process.chdir(path.resolve(root, '../fixtures/client'));
  const clientPort = port();

  t.plan(4);

  const clientUrl = `http://localhost:${clientPort}`;

  t.test('good validation url, custom endpoint', async (t) => {
    const client = app.main({
      port: clientPort,
      config: {
        brokerType: 'client',
        brokerToken: '1234567890',
        brokerServerUrl: 'http://localhost:12345',
        brokerClientValidationUrl: 'https://snyk.io',
        brokerSystemcheckPath: '/custom-systemcheck',
        brokerClientValidationJsonDisabled: true,
      },
    });

    try {
      const res = await got(`${clientUrl}/custom-systemcheck`, {
        responseType: 'json',
      });

      t.equal(res.statusCode, 200, '200 statusCode');
      t.equal(res.body.ok, true, '{ ok: true } in response body');
      t.equal(
        res.body.brokerClientValidationUrl,
        'https://snyk.io',
        'validation url present',
      );

      client.close();
    } catch (err) {
      if (err) {
        return t.threw(err);
      }
    }
  });

  t.test('good validation url, authorization header', async (t) => {
    const client = app.main({
      port: clientPort,
      config: {
        brokerType: 'client',
        brokerToken: '1234567890',
        brokerServerUrl: 'http://localhost:12345',
        brokerClientValidationUrl: 'https://httpbin.org/headers',
        brokerClientValidationAuthorizationHeader:
          'token my-special-access-token',
      },
    });

    try {
      const res = await got(`${clientUrl}/systemcheck`, {
        responseType: 'json',
      });

      t.equal(res.statusCode, 200, '200 statusCode');
      t.equal(res.body.ok, true, '{ ok: true } in body');
      t.equal(
        res.body.brokerClientValidationUrl,
        'https://httpbin.org/headers',
        'validation url present',
      );
      t.ok(
        res.body.testResponse.headers['User-Agent'],
        'user-agent header is present in validation request',
      );
      t.equal(
        res.body.testResponse.headers.Authorization,
        'token my-special-access-token',
        'proper authorization header in validation request',
      );

      client.close();
    } catch (err) {
      if (err) {
        return t.threw(err);
      }
    }
  });

  t.test('good validation url, basic auth', async (t) => {
    const client = app.main({
      port: clientPort,
      config: {
        brokerType: 'client',
        brokerToken: '1234567890',
        brokerServerUrl: 'http://localhost:12345',
        brokerClientValidationUrl: 'https://httpbin.org/headers',
        brokerClientValidationBasicAuth: 'username:password',
      },
    });

    try {
      const res = await got(`${clientUrl}/systemcheck`, {
        responseType: 'json',
      });

      t.equal(res.statusCode, 200, '200 statusCode');
      t.equal(res.body.ok, true, '{ ok: true } in body');
      t.equal(
        res.body.brokerClientValidationUrl,
        'https://httpbin.org/headers',
        'validation url present',
      );
      t.ok(
        res.body.testResponse.headers['User-Agent'],
        'user-agent header is present in validation request',
      );
      const expectedAuthHeader = `Basic ${Buffer.from(
        'username:password',
      ).toString('base64')}`;
      t.equal(
        res.body.testResponse.headers.Authorization,
        expectedAuthHeader,
        'proper authorization header in request',
      );

      client.close();
    } catch (err) {
      if (err) {
        return t.threw(err);
      }
    }
  });

  t.test('bad validation url', async (t) => {
    const client = app.main({
      port: clientPort,
      config: {
        brokerType: 'client',
        brokerToken: '1234567890',
        brokerServerUrl: 'http://localhost:12345',
        brokerClientValidationUrl: 'https://snyk.io/no-such-url-ever',
      },
    });

    try {
      const res = await got(`${clientUrl}/systemcheck`, {
        responseType: 'json',
        throwHttpErrors: false,
      });
      t.equal(res.statusCode, 500, '500 statusCode');
      t.equal(res.body.ok, false, '{ ok: false } in body');
      t.equal(
        res.body.brokerClientValidationUrl,
        'https://snyk.io/no-such-url-ever',
        'validation url present',
      );

      client.close();
    } catch (err) {
      if (err) {
        return t.threw(err);
      }
    }
  });
});
