import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { wrapHandler, validateChainKey } from './utils.js';

// minimal mocks for FastifyRequest and FastifyReply.
function mockRequest(serverLogError?: (err: unknown) => void) {
  return {
    server: {
      log: {
        error: serverLogError ?? (() => {}),
      },
    },
  } as any;
}

function mockReply() {
  let sentStatus = 0;
  let sentBody: any = null;
  const reply: any = {
    status(code: number) {
      sentStatus = code;
      return reply;
    },
    send(body: any) {
      sentBody = body;
      return reply;
    },
    get _status() {
      return sentStatus;
    },
    get _body() {
      return sentBody;
    },
  };
  return reply;
}

describe('wrapHandler', () => {
  it('returns handler result on success', async () => {
    const handler = wrapHandler(async () => ({ success: true }));
    const result = await handler(mockRequest(), mockReply());
    assert.deepEqual(result, { success: true });
  });

  it('catches Error and returns 500 with message', async () => {
    const reply = mockReply();
    const handler = wrapHandler(async () => {
      throw new Error('test error');
    });
    await handler(mockRequest(), reply);
    assert.equal(reply._status, 500);
    assert.deepEqual(reply._body, { error: 'test error' });
  });

  it('catches non-Error and returns 500 with Unknown error', async () => {
    const reply = mockReply();
    const handler = wrapHandler(async () => {
      throw 'string error';
    });
    await handler(mockRequest(), reply);
    assert.equal(reply._status, 500);
    assert.deepEqual(reply._body, { error: 'Unknown error' });
  });

  it('logs error via request.server.log.error', async () => {
    let loggedError: unknown = null;
    const handler = wrapHandler(async () => {
      throw new Error('logged');
    });
    await handler(
      mockRequest((err) => {
        loggedError = err;
      }),
      mockReply()
    );
    assert.ok(loggedError instanceof Error);
    assert.equal((loggedError as Error).message, 'logged');
  });
});

describe('validateChainKey', () => {
  it('returns chain key for valid chain', () => {
    const reply = mockReply();
    const result = validateChainKey('sepolia', reply);
    assert.equal(result, 'sepolia');
    assert.equal(reply._status, 0); // no error sent
  });

  it('returns null and sends 400 for invalid chain', () => {
    const reply = mockReply();
    const result = validateChainKey('invalidChain', reply);
    assert.equal(result, null);
    assert.equal(reply._status, 400);
    assert.ok(reply._body.error.includes('Unknown chain'));
    assert.ok(reply._body.error.includes('invalidChain'));
  });
});
