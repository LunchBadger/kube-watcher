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
                "status": { running: true} 
            }
        },
        "workspace": {
            "workspace-demo-dev-87c8978b-6bmnw": {
                "status": { running: true} 
        }
    }
}
```
