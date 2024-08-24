import { Api } from './api';
import { Association, Message, TimelineID, Event, TimelineItem } from '../model/core';
import { Client } from './client';
import { CCDocument } from '..';

const WS = typeof window === 'undefined' ? require('ws') : window.WebSocket;

export interface TimelineEvent {
    timeline: TimelineID
    item: TimelineItem
    document?: CCDocument.Message<any> | CCDocument.Association<any> | CCDocument.Delete
    resource?: Message<any> | Association<any>
    _document: string
    signature: string
}

export class Socket {

    ws: any;
    api: Api;
    client?: Client;
    subscriptions: Map<string, Set<(event: TimelineEvent) => void>> = new Map()

    failcount = 0
    reconnecting = false

    constructor(api: Api, client?: Client) {
        this.api = api;
        this.client = client;
        this.connect()
        setInterval(() => {
            this.checkConnection()
        }, 1000)
        setInterval(() => {
            this.heartbeat()
        }, 30000)
    }

    connect() {
        this.ws = new WS('wss://' + this.api.host + '/api/v1/timelines/realtime');

        this.ws.onmessage = (rawevent: any) => {

            const event: Event = JSON.parse(rawevent.data);
            if (!event) return

            let document = undefined
            try {
                document = JSON.parse(event.document)
            } catch (e) {
                console.error('invalid json', event.document)
            }

            const timelineEvent: TimelineEvent = {
                timeline: event.timeline,
                item: event.item,
                document: document,
                _document: event.document,
                signature: event.signature,
                resource: event.resource
            }

            switch (timelineEvent.document?.type) { // TODO
                case 'message':
                    if (event.resource) {
                        const dummy_message: any = event.resource
                        dummy_message._document = dummy_message.document
                        dummy_message.document = JSON.parse(dummy_message.document)
                        dummy_message.ownAssociations = []
                        this.api.cacheMessage(dummy_message as Message<any>)
                    }
                break
                case 'association':
                    const association = timelineEvent.document as CCDocument.Association<any>
                    this.api.invalidateMessage(association.target)
                    this.client?.invalidateMessage(association.target)
                break
                case 'delete':
                    const deletion = timelineEvent.document as CCDocument.Delete
                    switch (deletion.target[0]) {
                        case 'm':
                            this.api.invalidateMessage(deletion.target)
                            this.client?.invalidateMessage(deletion.target)
                        break
                        case 'a':
                            const resource = timelineEvent.resource as Association<any>
                            if (resource.target) {
                                this.api.invalidateMessage(resource.target)
                                this.client?.invalidateMessage(resource.target)
                            }
                        break
                    }
                break
                default:
                console.info('unknown event document type', event)
            }

            this.distribute(event.timeline, timelineEvent)
        }

        this.ws.onerror = (event: any) => {
            console.info('socket error', event)
        }

        this.ws.onclose = (event: any) => {
            console.info('socket close', event)
        }

        this.ws.onopen = (event: any) => {
            console.info('socket open', event)
            this.ws.send(JSON.stringify({ type: 'listen', channels: Array.from(this.subscriptions.keys()) }))
        }
    }

    heartbeat() {
        this.ws.send(JSON.stringify({ type: 'h' }))
    }

    checkConnection() {
        if (this.ws.readyState !== WS.OPEN && !this.reconnecting) {
            this.failcount = 0
            this.reconnecting = true
            this.reconnect()
        }
    }

    reconnect() {
        if (this.ws.readyState === WS.OPEN) {
            console.info('reconnect confirmed')
            this.reconnecting = false
            this.failcount = 0
        } else {
            console.info('reconnecting. attempt: ', this.failcount)
            this.connect()
            this.failcount++
            setTimeout(() => {
                this.reconnect()
            }, 500 * Math.pow(1.5, Math.min(this.failcount, 15)))
        }
    }

    distribute(timelineID: string, event: TimelineEvent) {
        if (this.subscriptions.has(timelineID)) {
            this.subscriptions.get(timelineID)?.forEach(callback => {
                callback(event)
            })
        }
    }

    listen(timelines: TimelineID[], callback: (event: TimelineEvent) => void) {
        const currenttimelines = Array.from(this.subscriptions.keys())
        timelines.forEach(topic => {
            if (!this.subscriptions.has(topic)) {
                this.subscriptions.set(topic, new Set())
            }
            this.subscriptions.get(topic)?.add(callback)
        })
        const newtimelines = Array.from(this.subscriptions.keys())
        if (newtimelines.length > currenttimelines.length) {
            this.ws.send(JSON.stringify({ type: 'listen', channels: newtimelines }))
        }
    }

    unlisten(timelines: TimelineID[], callback: (event: TimelineEvent) => void) {
        const currenttimelines = Array.from(this.subscriptions.keys())
        timelines.forEach(topic => {
            if (this.subscriptions.has(topic)) {
                this.subscriptions.get(topic)?.delete(callback)

                if (this.subscriptions.get(topic)?.size === 0) {
                    this.subscriptions.delete(topic)
                }
            }
        })
        const newtimelines = Array.from(this.subscriptions.keys())
        if (newtimelines.length < currenttimelines.length) {
            this.ws.send(JSON.stringify({ type: 'unlisten', channels: newtimelines }))
        }
    }

    ping() {
        this.ws.send(JSON.stringify({ type: 'ping' }))
    }

    waitOpen() {
        return new Promise((resolve, reject) => {
            const maxNumberOfAttempts = 10
            const intervalTime = 200 //ms

            let currentAttempt = 0
            const interval = setInterval(() => {
                if (currentAttempt > maxNumberOfAttempts - 1) {
                    clearInterval(interval)
                    reject(new Error('Maximum number of attempts exceeded'))
                } else if (this.ws.readyState === WS.OPEN) {
                    clearInterval(interval)
                    resolve(true)
                }
                currentAttempt++
            }, intervalTime)
        })
    }
}


