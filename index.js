const debug = require('debug')('kube-watcher:general')
const debugEvents = require('debug')('kube-watcher:events')

const FULL_DUMP_INTERVAL = process.env.FULL_DUMP_INTERVAL || 60000
const PODS_URL = process.env.PODS_URL || 'http://localhost:8001' +
  '/api/v1/namespaces/customer/pods'
const ENDPOINTS_URL = process.env.ENDPOINTS_URL || 'http://localhost:8001' +
  '/api/v1/namespaces/customer/endpoints'
const request = require('superagent')
const channels = {}
const pods$ = require('kube-observable')(PODS_URL + '?watch=true')
const eps$ = require('kube-observable')(ENDPOINTS_URL + '?watch=true')

let pods = {}
let connections = {}
fullDump()

function buildState (userPods = {}, userConnections = {}) {
  let state = {}

  for (let name in userPods) {
    let pod = userPods[name]
    let id = pod.metadata.labels.id || 'default'
    let type = pod.metadata.labels.app
    state[type] = state[type] || {}
    const srvEndpoint = userConnections[buildServiceNameFromPodName(name)] || {}
    // if there are any pods assigned to endpoint than requests should be processed
    // if all pods are down, there will be no pods assigned to service endpoint
    let isRunning = !!Object.keys(srvEndpoint).length
    state[type][id] = state[type][id] || {
      status: {
        running: isRunning,
        deployment: {
          inProgress: false,
          latestReady: isRunning
        }
      },
      pods: {}
    }
    state[type][id].pods[name] = computeStatus(name, pod.status, srvEndpoint)
  }
  state.gateway = state.gateway || {}
  state.workspace = state.workspace || {}
  state['sls-api'] = state['sls-api'] || {}
  state['kubeless-fn'] = state['kubeless-fn'] || {}
  for (let gk in state) {
    for (let entity of Object.values(state[gk])) {
      // TODO: replace 2 once scaling number will be available
      if (Object.keys(entity.pods).length >= 2) {
        // For now we expect 1 pod to run, if we have more deploying is true
        entity.status.deployment.inProgress = true
        let sortedPods = Object.values(entity.pods).sort(p => p.startTime)
        entity.status.deployment.latestReady = sortedPods[0].ready
      }
    }
  }
  return state
}
pods$.subscribe(obj => {
  try {
    if (obj.type === 'ADDED' || obj.type === 'MODIFIED') {
      pods[obj.object.metadata.name] = obj.object
      debugEvents(obj.type, obj.object.metadata.name)
    } else {
      delete pods[obj.object.metadata.name]
      debugEvents('DELETED', obj.object.metadata.name)
    }
    // triggering resend state to clients
    resend(obj.object.metadata.labels)
  } catch (err) {
    debug(err)
    throw err
  }
})

eps$.subscribe(obj => {
  if (obj.type === 'DELETED') {
    delete connections[obj.object.metadata.name]
    return
  }
  processEndpoint(obj.object)

  // triggering resend state to clients
  resend(obj.object.metadata.labels)
})

setInterval(fullDump, FULL_DUMP_INTERVAL)

const SseChannel = require('sse-channel')
const http = require('http')
function resendAll () {
  for (let key in channels) {
    let [producer, env] = key.split('-')
    resend({producer, env})
  }
}
function resend ({producer, env, environment}) {
  env = env || environment
  if (!producer || !env) {
    debug('Cannot update clients because user or env not provided', producer, env)
  }
  const key = `${producer}-${env}`
  const ch = channels[key]
  if (ch && ch.getConnectionCount()) { // don't send if no clients registered and connected
    const currentState = buildState(pods[key], connections[key])
    ch.send({
      data: JSON.stringify(currentState)
    })
  }
}

// Create a regular HTTP server (works with express, too)
http.createServer(function (req, res) {
  // Note that you can add any client to an SSE channel, regardless of path.
  // Only requirement is not having written data to the response stream yet
  if (req.url.indexOf('/channels/') === 0) {
    const key = req.url.replace('/channels/', '').replace(/\/v\d*\//, '')
    channels[key] = channels[key] || new SseChannel({
      cors: {
        origins: ['*'],
        headers: ['Cache-Control', 'Accept', 'Authorization', 'Accept-Encoding', 'Access-Control-Request-Headers', 'User-Agent', 'Access-Control-Request-Method', 'Pragma', 'Connection', 'Host']
      }
    })
    channels[key].addClient(req, res)
      // We have to send state to client on new connection
      // For simplicity let's update all listeners (even old) on adding new client
    let [producer, env] = key.split('-')
    resend({producer, env})
  } else {
    res.writeHead(404)
    res.end()
  }
}).listen(7788, '0.0.0.0', function () {
  // eslint-disable-next-line
  console.log('Access SSE stream at http://127.0.0.1:7788/channels/{username}');
})

function computeStatus (name, kubeStatus, srvEndpoint) {
  const status = {
    stopped: false,
    servesRequests: !!srvEndpoint[name],
    failed: false,
    startTime: new Date(kubeStatus.startTime)
  }
  if (kubeStatus.conditions) {
    kubeStatus.conditions.forEach(c => {
      const st = c.status === 'True'
      status[c.type.toLowerCase()] = st
    })
  }

  let containers = {};
  [...kubeStatus.initContainerStatuses || [], ...kubeStatus.containerStatuses || []].forEach(cs => {
    if (cs.lastState && cs.lastState.terminated) {
      status.stopped = cs.lastState.terminated.exitCode === 0
      status.failed = cs.lastState.terminated.exitCode > 0
    }
    containers[cs.name] = {
      ready: cs.ready,
      restartCount: cs.restartCount,
      state: cs.state,
      lastState: cs.lastState
    }
      // Adding debug info to output
    if (status.stopped || status.failed) {
      status.containers = containers
    }
  })
  return status
}

function buildServiceNameFromPodName (podName) {
  // workspace-rest-dev-74f5dd7db5-fw655
  // we need workspace-rest-dev
  return podName.substr(0, podName.lastIndexOf('-', podName.lastIndexOf('-') - 1))
}

async function fullDump () {
  // complete reset of internal state.
  // This is becuase watch stream can potentially break and events will be missed
  try {
    pods = {}
    let {body} = await request.get(PODS_URL)
    body.items.forEach(processPod)
    debug('Full pods dump. #', body.items.length)

    connections = {}
    let res = await request.get(ENDPOINTS_URL)
    res.body.items.forEach(processEndpoint)
    debug('Full endpoints dump. #', res.body.items.length)
  } catch (err) {
    debug('failed to dump k8s state', err)
  }
  resendAll()
}

function processEndpoint (ep) {
  if (!ep.metadata.labels.producer) {
    // This is not LB endpoint, we ignore it
    return
  }
  if (!ep.subsets) {
    debug('No pods are running for service ', ep.metadata.name)
    // it may be ok (like scaled to zero)
    // probably, there is some deployemnt issue (orphan service, all pods failed etc.)
    return
  }
  let podConnections = {}
  for (const {addresses} of ep.subsets) {
    if (!addresses) {
      continue
    }

    for (const {targetRef} of addresses) {
      if (!targetRef || targetRef.kind !== 'Pod') {
        continue
      }
      podConnections[targetRef.name] = true
    }
  }
  let {producer, env, environment} = ep.metadata.labels
  let key = `${producer}-${env || environment}`
  connections[key] = connections[key] || {}
  connections[key][ep.metadata.name] = podConnections
}

function processPod (pod) {
  if (!pod.metadata.labels.producer) {
    // This is not LB endpoint, we ignore it
    return
  }
  let {producer, env, environment} = pod.metadata.labels
  let key = `${producer}-${env || environment}`
  pods[key] = pods[key] || {}
  pods[key][pod.metadata.name] = pod
}
