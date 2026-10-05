import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import { startServer } from '../tools/server.mjs';

async function fixture(run) {
  const base = await mkdtemp(path.join(os.tmpdir(), 'mosaic-server-test-'));
  const root = path.join(base, 'runtime'), project = path.join(base, 'artwork');
  let server;
  try {
    await mkdir(path.join(root, 'site'), { recursive: true });
    await mkdir(path.join(root, 'engine'), { recursive: true });
    await mkdir(path.join(root, 'node_modules'), { recursive: true });
    await mkdir(project);
    await writeFile(path.join(root, 'site/index.html'), '<title>Studio</title>');
    await writeFile(path.join(root, 'engine/runtime.js'), 'export const ready = true;');
    await writeFile(path.join(root, '.env'), 'TOKEN=private');
    await writeFile(path.join(root, 'private.txt'), 'private');
    await writeFile(path.join(root, 'AGENTS.md'), 'private');
    await writeFile(path.join(root, 'package.json'), '{}');
    await writeFile(path.join(root, 'node_modules/private.js'), 'private');
    await writeFile(path.join(project, 'project.json'), '{"version":1}');
    await writeFile(path.join(project, 'scene.js'), 'export const scene = true;');
    await writeFile(path.join(project, '.hidden.js'), 'private');
    await writeFile(path.join(base, 'outside.js'), 'private');
    await symlink(path.join(base, 'outside.js'), path.join(project, 'escape.js'));
    await symlink(path.join(project, '.hidden.js'), path.join(project, 'alias.js'));
    await symlink(path.join(root, 'private.txt'), path.join(root, 'site/leak.js'));
    server = await startServer({ root, projectFile: path.join(project, 'project.json') });
    await run(server, root);
  } finally {
    await server?.close();
    await rm(base, { recursive: true, force: true });
  }
}

function request(server, rawPath, headers = {}, method = 'GET') {
  return new Promise((resolve, reject) => {
    const address = new URL(server.url);
    const req = http.request({ host: address.hostname, port: address.port, path: rawPath, headers, method }, res => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString(), headers: res.headers }));
    });
    req.on('error', reject); req.end();
  });
}

test('preview serves the studio and a mounted external project with correct MIME types', async () => {
  await fixture(async server => {
    assert.equal(server.server.address().address, '127.0.0.1');
    assert.equal((await request(server, '/')).body, '<title>Studio</title>');
    assert.equal((await request(server, '/site/')).status, 200);
    assert.equal((await request(server, '/project/project.json')).body, '{"version":1}');
    const script = await request(server, '/engine/runtime.js');
    assert.match(script.headers['content-type'], /javascript/);
    assert.equal(script.headers['x-content-type-options'], 'nosniff');
    const head = await request(server, '/project/scene.js', {}, 'HEAD');
    assert.equal(head.status, 200); assert.equal(head.body, '');
  });
});

test('a checkout with a project page opens on it and serves its media', async () => {
  await fixture(async (_, root) => {
    await writeFile(path.join(root, 'index.html'), '<title>Project</title>');
    await mkdir(path.join(root, 'home/media'), { recursive: true });
    await writeFile(path.join(root, 'home/media/film.mp4'), 'mp4');
    const server = await startServer({ root });
    try {
      assert.equal((await request(server, '/')).body, '<title>Project</title>');
      assert.equal((await request(server, '/site/')).body, '<title>Studio</title>');
      assert.equal((await request(server, '/home/media/film.mp4')).headers['content-type'], 'video/mp4');
    } finally {
      await server.close();
    }
  });
});

test('private files, traversal, escaped symlinks, and in-root private aliases are denied', async () => {
  await fixture(async server => {
    for (const pathname of ['/AGENTS.md', '/package.json', '/.env', '/node_modules/private.js', '/project/.hidden.js', '/project/../outside.js', '/project/%2e%2e/outside.js', '/project/%2Ehidden.js', '/project/escape.js', '/project/alias.js', '/site/leak.js', '/site/../../private.txt']) {
      const response = await request(server, pathname);
      assert.equal(response.status, 403, pathname);
      assert.doesNotMatch(response.body, /TOKEN=/);
    }
    assert.equal((await request(server, '/project/%00scene.js')).status, 400);
    assert.equal((await request(server, '/project/%zz')).status, 400);
    assert.equal((await request(server, '/project/missing.js')).status, 404);
  });
});

test('cross-origin requests, non-loopback hosts, and writes are denied', async () => {
  await fixture(async server => {
    assert.equal((await request(server, '/', { Origin: 'https://unrelated.example' })).status, 403);
    assert.equal((await request(server, '/', { Host: 'attacker.example:1234' })).status, 403);
    assert.equal((await request(server, '/project/project.json', {}, 'POST')).status, 405);
    await server.close();
    await assert.rejects(request(server, '/'), /ECONNREFUSED|ECONNRESET|socket hang up/);
  });
});

test('server rejects invalid ports without creating a listener', async () => {
  for (const port of [-1, 65536, 1.5, '0']) await assert.rejects(startServer({ port }), /port must/);
});
