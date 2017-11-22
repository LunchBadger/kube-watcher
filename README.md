# kube-watcher
Watch Kubernetes resources with a resilient RxJS Observable client.


implemented as https://github.com/LunchBadger/kube-watcher/blob/master/index.js

Let say you have `demo` user with ` dev` env 
access http://localhost:7788/channels/demo

you will get a stringified JSON 
{dev:  { gateway:{ gw-name: status}, workspace:{ws-name:status}}

```js
{
    "dev": {
        "gateway": {
            "gateway-demo-dev-gateway-696bb497cd-s7b6p": {
                "status": {
                    "phase": "Running",
                    "conditions": [
                        {
                            "type": "Initialized",
                            "status": "True",
                            "lastProbeTime": null,
                            "lastTransitionTime": "2017-11-22T14:55:45Z"
                        },
                        {
                            "type": "Ready",
                            "status": "True",
                            "lastProbeTime": null,
                            "lastTransitionTime": "2017-11-22T14:56:45Z"
                        },
                        {
                            "type": "PodScheduled",
                            "status": "True",
                            "lastProbeTime": null,
                            "lastTransitionTime": "2017-11-22T14:55:45Z"
                        }
                    ],
                    "hostIP": "10.0.0.70",
                    "podIP": "10.1.25.46",
                    "startTime": "2017-11-22T14:55:45Z",
                    "containerStatuses": [
                        {
                            "name": "gateway",
                            "state": {
                                "running": {
                                    "startedAt": "2017-11-22T14:56:44Z"
                                }
                            },
                            "lastState": {},
                            "ready": true,
                            "restartCount": 0,
                            "image": "410240865662.dkr.ecr.us-west-2.amazonaws.com/expressgateway/express-gateway:empty-config",
                            "imageID": "docker-pullable://410240865662.dkr.ecr.us-west-2.amazonaws.com/expressgateway/express-gateway@sha256:1ce81f9f6bbd958f0b500f56c5b3c03a35d429207fe889d06204c5fedfad8826",
                            "containerID": "docker://ed156ae7c14b9d5de3daca6f1e60ee5743a072628b3bd372acc160573c6fab50"
                        }
                    ],
                    "qosClass": "BestEffort"
                }
            }
        },
        "workspace": {
            "workspace-demo-dev-87c8978b-6bmnw": {
                "status": {
                    "phase": "Running",
                    "conditions": [
                        {
                            "type": "Initialized",
                            "status": "True",
                            "lastProbeTime": null,
                            "lastTransitionTime": "2017-11-22T15:03:38Z"
                        },
                        {
                            "type": "Ready",
                            "status": "True",
                            "lastProbeTime": null,
                            "lastTransitionTime": "2017-11-22T15:05:28Z"
                        },
                        {
                            "type": "PodScheduled",
                            "status": "True",
                            "lastProbeTime": null,
                            "lastTransitionTime": "2017-11-22T15:03:38Z"
                        }
                    ],
                    "hostIP": "10.0.0.70",
                    "podIP": "10.1.25.47",
                    "startTime": "2017-11-22T15:03:38Z",
                    "containerStatuses": [
                        {
                            "name": "lunchbadger-workspace",
                            "state": {
                                "running": {
                                    "startedAt": "2017-11-22T15:05:28Z"
                                }
                            },
                            "lastState": {},
                            "ready": true,
                            "restartCount": 0,
                            "image": "410240865662.dkr.ecr.us-west-2.amazonaws.com/lunchbadger-workspace:refactor",
                            "imageID": "docker-pullable://410240865662.dkr.ecr.us-west-2.amazonaws.com/lunchbadger-workspace@sha256:e515974632e4ed6bb78338003d3d6cdb6dea84f52c2d80614d11ab644f6f0b26",
                            "containerID": "docker://d30eabc1c86abc586d28e7cfd500f56acbdb3919958322028a7862804c196845"
                        }
                    ],
                    "qosClass": "BestEffort"
                }
            }
        }
    }
}
```
