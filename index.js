const debug = require('debug')('kube-watcher:general');
const debugEvents = require('debug')('kube-watcher:events');

const FULL_DUMP_INTERVAL = process.env.FULL_DUMP_INTERVAL || 60000;
const PODS_URL = process.env.PODS_URL || 'http://localhost:8001' +
  '/api/v1/namespaces/customer/pods';
const ENDPOINTS_URL = process.env.ENDPOINTS_URL || 'http://localhost:8001' +
  '/api/v1/namespaces/customer/endpoints';
const request = require('superagent');
const channels = {}; // TODO handle remove of user\env
const pods$ = require('kube-observable')(PODS_URL + '?watch=true');
const eps$ = require('kube-observable')(ENDPOINTS_URL + '?watch=true');

const data = {};
let connections = {};
fullDump();

function rebuildPodState(pod) {
  const {
    instanceType,
    user,
    envType
  } = ensureState(pod.metadata);
  let isRunning = false;
  const srv = connections[buildServiceNameFromPodName(pod.metadata.name)];
  debug(buildServiceNameFromPodName(pod.metadata.name), srv);

  // If all good with pod ednpoint will have it listed.
  // Pod that have not passed readyness check will not be listed
  if (srv && srv[pod.metadata.name]) {
    isRunning = true;
  }
  const status = {
    running: isRunning,
    startTime: pod.status.startTime
  };
  const id = pod.metadata.labels.id || 'default';
  data[user][envType][instanceType][id] = data[user][envType][instanceType][id] || {
    pods: {}
  };
  data[user][envType][instanceType][id].pods[pod.metadata.name] = {
    status
  };

  const entityStatus = {running: false};

  data[user][envType][instanceType][id].status = entityStatus;
}
pods$.subscribe(obj => {
  try {
    const state = ensureState(obj.object.metadata);
    if (!state) {
      return;
    }
    const {
      instanceType,
      user,
      envType
    } = state;
    if (obj.type === 'ADDED' || obj.type === 'MODIFIED') {
      rebuildPodState(obj.object);
      debugEvents(obj.type, obj.object.metadata.name);
    } else {
      // for some reason may not happen for gateway, rely on MODIFIED
      delete data[user][`${envType}-${instanceType}`][obj.object.metadata.name];
      debugEvents('DELETED', obj.object.metadata.name);
    }
  } catch (err) {
    debug(err);
    throw err;
  }
});

eps$.subscribe(obj => {
  if (obj.type === 'DELETED') {
    delete connections[obj.object.metadata.name];
    return;
  }

  processEndpoint(obj.object);
});

function processEndpoint(ep) {
  connections[ep.metadata.name] = {};
  if (!ep.subsets) {
    debug('No pods are running for service ', ep.metadata.name);
    // it may be ok (like scaled to zero)
    // probably, there is some deployemnt issue (orphan service, all pods failed etc.)
    return;
  }
  for (const {
      addresses
    } of ep.subsets) {
    if (!addresses) {
      continue;
    }

    for (const {
        targetRef
      } of addresses) {
      if (!targetRef || targetRef.kind !== 'Pod') {
        continue;
      }
      connections[ep.metadata.name][targetRef.name] = true;
    }
  }
}

setInterval(fullDump, FULL_DUMP_INTERVAL);

const SseChannel = require('sse-channel');
const http = require('http');

// Set up an interval that broadcasts server date every second
setInterval(() => {
  for (const k of Object.keys(data)) {
    const ch = channels[k];
    if (ch) {
      const currentState = data[k];
      // for (const envName in currentState) {
      //   // ensure that env state has all types present for consistency
      //   const env = currentState[envName];
      //   env.gateway = env.gateway || {};
      //   env.workspace = env.workspace || {};
      //   env['sls-api'] = env['sls-api'] || {};
      //   env['kubeless-fn'] = env['kubeless-fn'] || {};
      // }
      if (ch.getConnectionCount()) {
        ch.send({
          data: JSON.stringify(currentState)
        });
      }
      if (k === 'ko6' || k === 'sk') {
       // console.log(JSON.stringify(currentState, null, 2));
      }
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

function ensureState({
  labels
}) {
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
  return {
    instanceType,
    user,
    envType
  };
}

function computeStatus(kubeStatus) {
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
      if (cs.lastState && cs.lastState.terminated) {
        status.stopped = cs.lastState.terminated.exitCode === 0;
        status.failed = cs.lastState.terminated.exitCode > 0;
      }
      status.containers[cs.name] = {
        ready: cs.ready,
        restartCount: cs.restartCount,
        state: cs.state,
        lastState: cs.lastState
      };
    });
  }
  status.summary = status.running ? 'RUNNING' : (status.failed ? 'FAILED' : 'STOPPED');
  return status;
}

function buildServiceNameFromPodName(podName) {
  // workspace-rest-dev-74f5dd7db5-fw655
  // we need workspace-rest-dev
  return podName.substr(0, podName.lastIndexOf('-', podName.lastIndexOf('-') - 1));
}

async function fullDump() {
  // complete reset of internal state.
  // This is becuase watch stream can potentially break and events will be missed
  await request.get(PODS_URL)
    .then(res => {
      // const newPodsState = {};
      // const list = res.body;
      // for (const pod of list.items) {
      //   const {
      //     instanceType,
      //     user,
      //     envType
      //   } = ensureState(pod.metadata);
      //   const status = computeStatus(pod.status);
      //   newPodsState[user][envType][instanceType][pod.metadata.name] = {
      //     status,
      //     id: pod.metadata.labels.id || null
      //   };
      // }

      // data = newPodsState;
      // debug('Full reload completed. #of pods', list.items.length);
    })
    .catch(err => debug(err));
  await request.get(ENDPOINTS_URL)
    .then(res => {
      connections = {};
      const list = res.body;
      for (const ep of list.items) {
        processEndpoint(ep);
      }

      debug('Full reload completed. #of services', list.items.length);
    })
    .catch(err => debug(err));
}
