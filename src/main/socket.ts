import { Api } from './api';
import { Association, Message, StreamEvent, StreamID } from '../model/core';

const WS = typeof window === 'undefined' ? require('ws') : window.WebSocket;

export class Socket {

    ws: any;
    api: Api;
    subscriptions: Map<string, Set<(event: StreamEvent) => void>> = new Map()

    onOpen?: (event: any) => void;
    onError?: (error: any) => void;
    onClose?: (event: any) => void;

    constructor(api: Api) {

        this.api = api;
        this.ws = new WS('wss://' + api.host + '/api/v1/socket');

        this.ws.onopen = () => {
            this.onOpen?.(null);
        }

        this.ws.onmessage = (rawevent: any) => {
            const event: StreamEvent = JSON.parse(rawevent.data);
            if (!event) return

            switch (event.type + '.' + event.action) {
                case 'message.create':
                    if (!event.body) return
                    api.cacheMessage(event.body as Message<any>)
                    break
                case 'message.delete':
                    api.invalidateMessage(event.body.id)
                    break
                case 'association.create': {
                    if (!event.body) return
                    const body = event.body as Association<any>
                    api.cacheAssociation(body)
                    api.invalidateMessage(body.targetID)
                    break
                }
                case 'association.delete': {
                    if (!event.body) return
                    const body = event.body as Association<any>
                    api.invalidateAssociation(body.id)
                    api.invalidateMessage(body.targetID)
                    break
                }
            }

            const stream = event.stream
            this.distribute(stream, event)
        }

        this.ws.onerror = (event: any) => {
            this.onError?.(event);
        }

        this.ws.onclose = (event: any) => {
            this.onClose?.(event);
        }
    }

    distribute(stream: string, event: StreamEvent) {
        if (this.subscriptions.has(stream)) {
            this.subscriptions.get(stream)?.forEach(callback => {
                callback(event)
            })
        }
    }

    listen(streams: StreamID[], callback: (event: StreamEvent) => void) {
        const currentStreams = Array.from(this.subscriptions.keys())
        streams.forEach(topic => {
            if (!this.subscriptions.has(topic)) {
                this.subscriptions.set(topic, new Set())
            }
            this.subscriptions.get(topic)?.add(callback)
        })
        const newStreams = Array.from(this.subscriptions.keys())
        if (newStreams.length > currentStreams.length) {
            this.ws.send(JSON.stringify({ type: 'listen', channels: newStreams }))
        }
    }

    unlisten(streams: StreamID[], callback: (event: StreamEvent) => void) {
        const currentStreams = Array.from(this.subscriptions.keys())
        streams.forEach(topic => {
            if (this.subscriptions.has(topic)) {
                this.subscriptions.get(topic)?.delete(callback)

                if (this.subscriptions.get(topic)?.size === 0) {
                    this.subscriptions.delete(topic)
                }
            }
        })
        const newStreams = Array.from(this.subscriptions.keys())
        if (newStreams.length < currentStreams.length) {
            this.ws.send(JSON.stringify({ type: 'unlisten', channels: newStreams }))
        }
    }

    ping() {
        this.ws.send(JSON.stringify({ type: 'ping' }))
    }

    waitOpen() {
        return new Promise((resolve, _) => {
            if (this.ws.readyState === WS.OPEN) {
                resolve(null);
            } else {
                this.ws.onopen = () => {
                    resolve(null);
                }
            }
        })
    }
}


