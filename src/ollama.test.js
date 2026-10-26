import test from 'node:test';
import assert from 'node:assert/strict';
import { checkOllama, generateOllamaInsights } from './ollama.js';

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

test('Ollama connection check accepts an installed model with an implicit latest tag', async (context) => {
  context.mock.method(globalThis, 'fetch', async (url) => {
    assert.equal(url, '/ollama/api/tags');
    return jsonResponse({ models: [{ name: 'llama3.2:latest' }] });
  });

  assert.deepEqual(await checkOllama('llama3.2'), { model: 'llama3.2:latest' });
});

test('Ollama connection check recommends pulling a missing model', async (context) => {
  context.mock.method(globalThis, 'fetch', async () => jsonResponse({ models: [{ name: 'qwen2.5:latest' }] }));

  await assert.rejects(checkOllama('llama3.2'), /ollama pull llama3\.2.*Installed models/);
});

test('Ollama automatically uses the first installed model when none is configured', async (context) => {
  context.mock.method(globalThis, 'fetch', async () => jsonResponse({ models: [{ name: 'qwen3:8b' }] }));

  assert.deepEqual(await checkOllama(), { model: 'qwen3:8b' });
});

test('Ollama insights use local chat and return validated recommendations', async (context) => {
  context.mock.method(globalThis, 'fetch', async (url, options) => {
    assert.equal(url, '/ollama/api/chat');
    const body = JSON.parse(options.body);
    assert.equal(body.stream, false);
    assert.equal(body.format, 'json');
    assert.equal(body.model, 'llama3.2');
    assert.match(body.messages[1].content, /Bengaluru/);
    return jsonResponse({
      message: {
        content: JSON.stringify({ insights: [{ title: 'Review the time trade-off', text: 'The eco plan takes 8 minutes longer.' }] }),
      },
    });
  });

  const insights = await generateOllamaInsights({
    model: 'llama3.2',
    scenario: { area: 'Bengaluru', eco: { minutes: 140 } },
  });
  assert.deepEqual(insights, [{ title: 'Review the time trade-off', text: 'The eco plan takes 8 minutes longer.' }]);
});

test('Ollama insights reject malformed model output', async (context) => {
  context.mock.method(globalThis, 'fetch', async () => jsonResponse({ message: { content: '{"suggestions":[]}' } }));

  await assert.rejects(
    generateOllamaInsights({ model: 'llama3.2', scenario: {} }),
    /did not include an insights list/,
  );
});
