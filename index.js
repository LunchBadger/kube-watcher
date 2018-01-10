const PODS_URL = process.env.PODS_URL || 'http://localhost:8001' +
  '/api/v1/namespaces/customer/pods' +
  '?watch=true&timeoutSeconds=3';

const data = {};
const channels = {};
const OLD_ENTITY_CLEANUP_TIMEOUT = 60000;
const pods$ = require('kube-observable')(PODS_URL);
pods$.subscribe(obj => {
  // gateway-demo-dev-gateway-696bb497cd-s7b6p
  try {
    const parts = obj.object.metadata.name.split('-');
    if (parts.length < 4) { return; }

    const [instanceType, user, envType] = parts;
    data[user] = data[user] || {};
    channels[user] = channels[user] || new SseChannel({
      cors: {
        origins: ['*'],
        headers: ['Cache-Control', 'Accept', 'Authorization', 'Accept-Encoding', 'Access-Control-Request-Headers', 'User-Agent', 'Access-Control-Request-Method', 'Pragma', 'Connection', 'Host']
      }
    });
    data[user][envType] = data[user][envType] || {};
    data[user][envType][instanceType] = data[user][envType][instanceType] || {};
    const kubeStatus = obj.object.status;
    if (obj.type === 'ADDED' || obj.type === 'MODIFIED') {
      const status = {
        running: true,
        stopped: false,
        failed: false
      };

      if (kubeStatus.conditions) {
        status.pod = {};
        kubeStatus.conditions.forEach(c => {
          const st = c.status === 'True';
          status.pod[c.type.toLowerCase()] = st;
          if (!st) {
            status.running = false;
          }
        });
      }
      if (kubeStatus.containerStatuses) {
        status.containers = {};
        kubeStatus.containerStatuses.forEach(cs => {
          if (cs.state.terminated) {
            status.stopped = cs.state.terminated.exitCode === 0;
            status.failed = !status.stopped;
            setTimeout(function () {
              delete data[user][envType][instanceType][obj.object.metadata.name];
            }, OLD_ENTITY_CLEANUP_TIMEOUT);
          }
          status.containers[cs.name] = {
            ready: cs.ready,
            restartCount: cs.restartCount,
            state: cs.state
          };
        });
      }
      data[user][envType][instanceType][obj.object.metadata.name] = { status };
    } else {
      // for some reason may not happen for gateway, rely on MODIFIED
      delete data[user][envType][instanceType][obj.object.metadata.name];
    }
  } catch (err) {
    console.log(err);
    console.log(obj);
    throw err;
  }
});

const SseChannel = require('sse-channel');
const http = require('http');

// Set up an interval that broadcasts server date every second
setInterval(() => {
  for (const k of Object.keys(data)) {
    const ch = channels[k];
    if (ch) {
      ch.send({ data: JSON.stringify(data[k]) });
    }
  }
}, 3000);

// Create a regular HTTP server (works with express, too)
http.createServer(function (req, res) {
  // Note that you can add any client to an SSE channel, regardless of path.
  // Only requirement is not having written data to the response stream yet
  if (req.url.indexOf('/channels/') === 0) {
    const key = req.url.replace('/channels/', '');
    if (channels[key]) {
      channels[key].addClient(req, res);
    } else {
      res.statusCode = 404;
      res.end();
    }
  } else {
    res.writeHead(404);
    res.end();
  }
}).listen(7788, '0.0.0.0', function () {
  // eslint-disable-next-line
  console.log('Access SSE stream at http://127.0.0.1:7788/channels/{username}');
});
