const debug = require('debug')('kube-watcher:general');
const debugEvents = require('debug')('kube-watcher:events');

const FULL_DUMP_INTERVAL = process.env.FULL_DUMP_INTERVAL || 60000;
const PODS_URL = process.env.PODS_URL || 'http://localhost:8001' +
  '/api/v1/namespaces/customer/pods';
const request = require('superagent');
const channels = {}; // TODO handle remove of user\env
const pods$ = require('kube-observable')(PODS_URL + '?watch=true');

let data = {};

pods$.subscribe(obj => {
  // gateway-demo-dev-gateway-696bb497cd-s7b6p
  try {
    const state = ensureState(obj.object.metadata);
    if (!state) {
      return;
    }
    const {instanceType, user, envType} = state;
    const kubeStatus = obj.object.status;
    if (obj.type === 'ADDED' || obj.type === 'MODIFIED') {
      const status = computeStatus(kubeStatus);
      data[user][envType][instanceType][obj.object.metadata.name] = { status, id: obj.object.metadata.labels.id || 'lb-id-not-provided' };
      debugEvents(obj.type, obj.object.metadata.name, status);
    } else {
      // for some reason may not happen for gateway, rely on MODIFIED
      delete data[user][envType][instanceType][obj.object.metadata.name];
      debugEvents('DELETED', obj.object.metadata.name);
    }
  } catch (err) {
    debug(err);
    throw err;
  }
});

setInterval(() => {
  // complete reset of internal state.
  // This is becuase watch stream can potentially break and events will be missed
  request.get(PODS_URL)
    .then(res => {
      data = {};
      const list = res.body;
      for (const pod of list.items) {
        const {instanceType, user, envType} = ensureState(pod.metadata);
        const status = computeStatus(pod.status);
        data[user][envType][instanceType][pod.metadata.name] = { status, id: pod.metadata.labels.id || 'lb-id-not-provided' };
      }
      debug('Full reload completed. #of pods', list.items.length);
    })
    .catch(err => debug(err));
}, FULL_DUMP_INTERVAL);

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

function ensureState ({ name, labels }) {
  const user = labels.producer;
  if (!user) return null;
  const envType = labels.environment || 'dev';
  const instanceType = labels.app;

  if (!instanceType) return null;

  data[user] = data[user] || {};
  channels[user] = channels[user] || new SseChannel({
    cors: {
      origins: ['*'],
      headers: ['Cache-Control', 'Accept', 'Authorization', 'Accept-Encoding', 'Access-Control-Request-Headers', 'User-Agent', 'Access-Control-Request-Method', 'Pragma', 'Connection', 'Host']
    }
  });
  data[user][envType] = data[user][envType] || {};
  data[user][envType][instanceType] = data[user][envType][instanceType] || {};
  return {instanceType, user, envType};
}

function computeStatus (kubeStatus) {
  const status = {
    running: false,
    stopped: false,
    failed: false
  };

  if (kubeStatus.conditions) {
    status.pod = {};
    kubeStatus.conditions.forEach(c => {
      const st = c.status === 'True';
      status.pod[c.type.toLowerCase()] = st;
    });

    status.running = !!status.pod.ready;
  }

  if (kubeStatus.containerStatuses) {
    status.containers = {};
    kubeStatus.containerStatuses.forEach(cs => {
      if (cs.state.terminated) {
        status.stopped = cs.state.terminated.exitCode === 0;
        status.failed = !status.stopped;
      }
      status.containers[cs.name] = {
        ready: cs.ready,
        restartCount: cs.restartCount,
        state: cs.state
      };
    });
  }
  status.summary = status.running ? 'RUNNING' : (status.stopped ? 'STOPPED' : 'FAILED');
  return status;
}
