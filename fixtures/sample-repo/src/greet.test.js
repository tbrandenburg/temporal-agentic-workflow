const assert = require('node:assert/strict');
const { test } = require('node:test');
const { greet } = require('./greet');

test('greet() greets by name', () => {
  assert.equal(greet('world'), 'Hello, world!');
});
