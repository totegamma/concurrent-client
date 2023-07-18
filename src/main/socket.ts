import { ServerEvent, StreamID } from '../model/core';

const WS = typeof window === 'undefined' ? require('ws') : window.WebSocket;
type socketEvent = 'open' | 'close' | 'error' | 'MessageCreated' | 'MessageDeleted' | 'AssociationCreated' | 'AssociationDeleted'

export class Socket {

    ws: any;
    fns: Record<socketEvent, Set<(...args: any[]) => void>>

    on(type: socketEvent, fn: (...args: any[]) => void) {
        if (this.fns[type]) {
            this.fns[type].add(fn)
        } else {
            this.fns[type] = new Set([fn])
        }
    }
    off(type: socketEvent, fn: (...args: any[]) => void) {
        this.fns[type]?.delete(fn)
    }
    emit(type: socketEvent, ...args: any[]) {
        for (const fn of this.fns[type] || []) fn(...args)
    }

    constructor(domain: string) {

        this.fns = {
            open: new Set(),
            close: new Set(),
            error: new Set(),
            MessageCreated: new Set(),
            MessageDeleted: new Set(),
            AssociationCreated: new Set(),
            AssociationDeleted: new Set(),
        }

        this.ws = new WS('wss://' + domain + '/api/v1/socket');

        this.ws.onopen = () => {
            this.emit('open');
        }

        this.ws.onmessage = (rawevent: any) => {
            const event: ServerEvent = JSON.parse(rawevent.data);
            if (!event) return
            switch (event.type) {
                case 'message': {
                    switch (event.action) {
                        case 'create': {
                            this.emit('MessageCreated', event.body);
                            break
                        }
                        case 'delete': {
                            this.emit('MessageDeleted', event.body);
                            break
                        }
                        default:
                            console.log('unknown message action', event)
                            break
                    }
                    break
                }
                case 'association': {
                    switch (event.action) {
                        case 'create': {
                            this.emit('AssociationCreated', event.body);
                            break
                        }
                        case 'delete': {
                            this.emit('AssociationDeleted', event.body);
                            break
                        }
                        default:
                            console.log('unknown message action', event)
                            break
                    }
                    break
                }
                default: {
                    console.log('unknown event', event)
                    break
                }
            }
        }

        this.ws.onerror = (event: any) => {
            this.emit('error', event);
        }

        this.ws.onclose = (event: any) => {
            this.emit('close', event);
        }
    }

    listen(streams: StreamID[]) {
        this.ws.send(JSON.stringify({ channels: streams }))
    }

    waitOpen() {
        return new Promise((resolve, reject) => {
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


