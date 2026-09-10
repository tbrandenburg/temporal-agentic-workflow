#!/usr/bin/env node
// Never exits within any reasonable timeout, exercising the
// subprocess-timeout failure path.
setInterval(() => {}, 1000);
